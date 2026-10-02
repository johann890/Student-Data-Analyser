/* METAMORPHIC PROPERTIES: laws the engine must obey for ANY input.

   Every other suite in here checks an example: this graph, over this archive,
   gives this answer. That catches a wrong answer somebody thought to look for.
   It cannot catch a wrong answer nobody anticipated, because the expected value
   is written by the same person who wrote the code.

   A metamorphic property is the other half. It states a relation between two
   runs rather than the value of one, so it needs no expected answer at all:
   filtering on a predicate and on its negation must together return exactly the
   rows that went in, whatever the predicate, whatever the data. A property is
   then checked over many randomly generated configurations, and a violation is
   a real defect rather than a disagreement about what the answer should be.

   WHY THIS MATTERS FOR THIS PROJECT. The tool's output is a number somebody
   will put in a report about real students. A wrong row count is not a crash:
   it is a plausible answer that is wrong, which is the one failure mode the
   example tests are weakest against. These laws are what rules it out across
   the whole input space rather than at the points somebody sampled.

   RANDOM, BUT NOT UNREPEATABLE. The generator is seeded, and the seed is fixed
   so that a run is deterministic and a CI failure can be reproduced exactly.
   PROP_SEED changes it, and PROP_CASES how many cases each property gets, so
   the same suite doubles as a fuzzer:

       PROP_SEED=12345 PROP_CASES=200 node run.js 44-properties

   Each case prints its own seed in the failure message, so a case found by a
   long fuzzing run can be replayed on its own.

   These drive node.cfg directly rather than through the control panels. The
   DOM path is what the other suites exercise; what is under test here is the
   engine's semantics, and generating hundreds of configurations through
   rendered controls would test the renderer hundreds of times and the laws
   once. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

/* ONE WINDOW FOR THE WHOLE SUITE, REBUILT PER CASE.
   A property run over forty cases is hundreds of graphs, and booting a window
   for each one exhausts the heap: a JSDOM window carrying the application costs
   about 8MB that closing it does not release, and the runner only disposes
   windows between SUITES. Measured: a per-case boot died with "Ineffective
   mark-compacts near heap limit" partway through the second property.

   So the suite boots once and clears the canvas between cases. clearAll() is
   the application's own reset, which is a better starting point than a fresh
   window in any case: it is the state a user is in after pressing Clear. The
   synthetic dataset a Source falls back to is not held in SOURCE_DATA, so it
   survives the clear and every case has data. */

const SEED  = Number(process.env.PROP_SEED  || 20261002);
const CASES = Number(process.env.PROP_CASES || 40);

/* mulberry32: small, fast and stable across node versions, which matters
   because a seed is only useful if it means the same thing next year. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = ({ describe, test }) => {

  const H = boot();
  const A0 = H.app;
  const STUDENTS = A0.STUDENTS;

  /* The columns a generated predicate may use, split by what can be done with
     them. Read off the real header rather than listed, so a column that stops
     existing takes its cases with it instead of silently generating nothing. */
  const NUMERIC = ['gpa', 'year'];
  const ENUM    = ['gender', 'degree', 'specialisation'];

  const GPAS = STUDENTS.map(s => s.gpa).filter(Number.isFinite);
  const GPA_MIN = Math.min(...GPAS), GPA_MAX = Math.max(...GPAS);

  // ---------------------------------------------------------------- helpers

  /* A chain of nodes, wired in order, with no Output: these read the table at a
     node directly from the evaluator rather than through the results panel, so
     a property is about the engine and not about rendering. */
  function chain(...types) {
    H.w.clearAll();
    const made = types.map(t => H.add(t));
    for (let i = 0; i < made.length - 1; i++) H.app.connect(made[i].id, made[i + 1].id);
    return { h: H, n: made };
  }

  function tableAt(h, id) {
    const run = H.app.evaluateGraph();
    assert.notOk(run.error, 'the graph did not evaluate: ' + run.error);
    const r = run.res[id];
    assert.ok(r && r.table, 'no table at node ' + id);
    return r.table;
  }

  const rowKeys = (t) => t.rows.map(r => JSON.stringify(r));
  const colKeys = (t) => t.columns.map(c => c.key);
  const bag = (t) => rowKeys(t).slice().sort();

  function criterion(field, op, value) {
    const c = { field: field, values: {}, ops: {}, course: A0.defaultCourse(), vars: {} };
    c.ops[field] = op;
    c.values[field] = String(value);
    return c;
  }

  /* One property, over CASES generated configurations. The case index and the
     seed go in every message, because a property that fails on case 37 of 40 is
     only actionable if case 37 can be run again. */
  function forEachCase(name, body) {
    test(name, () => {
      const r = rng(SEED);
      for (let i = 0; i < CASES; i++) {
        try {
          body(r, i);
        } catch (e) {
          e.message = 'case ' + i + ' of ' + CASES + ' (PROP_SEED=' + SEED + '): ' + e.message;
          throw e;
        }
      }
    });
  }

  const pick = (r, list) => list[Math.floor(r() * list.length)];
  const gpaThreshold = (r) => (GPA_MIN - 1 + r() * (GPA_MAX - GPA_MIN + 2)).toFixed(3);

  // ------------------------------------------------------- the laws

  describe('a predicate and its negation partition the rows', () => {

    /* THE CENTRAL ONE. Whatever the column, whatever the threshold, the rows
       kept by `greater than` and the rows kept by `at most` must together be
       exactly the rows that went in: none lost, none invented, none in both.
       A Filter that dropped a blank, mis-parsed a number or compared a number
       as text would break this at some threshold without breaking any example
       test that did not happen to sit on that value. */
    forEachCase('gt and lte over a number cover every row exactly once', (r) => {
      const col = pick(r, NUMERIC);
      const t = gpaThreshold(r);
      const value = col === 'gpa' ? t : String(2022 + Math.floor(r() * 3));

      const { h, n } = chain('source', 'filter');
      const all = tableAt(h, n[0].id);

      H.app.findNode(n[1].id).cfg.criteria = [criterion(col, 'gt', value)];
      const kept = tableAt(h, n[1].id);

      H.app.findNode(n[1].id).cfg.criteria = [criterion(col, 'lte', value)];
      const rest = tableAt(h, n[1].id);

      assert.equal(kept.rows.length + rest.rows.length, all.rows.length,
        col + ' ' + value + ': the two halves do not add up to the whole');

      const inKept = new Set(rowKeys(kept));
      rowKeys(rest).forEach(k => assert.notOk(inKept.has(k),
        col + ' ' + value + ': a row is in both halves'));

      assert.deepEqual(bag(kept).concat(bag(rest)).sort(), bag(all).slice().sort(),
        col + ' ' + value + ': the halves are not the same rows that went in');
    });

    forEachCase('eq and ne over a text column do the same', (r) => {
      const col = pick(r, ENUM);
      const seen = [...new Set(STUDENTS.map(s => s[col]).filter(v => v !== undefined))];
      const value = pick(r, seen.concat(['nothing-matches-this']));

      const { h, n } = chain('source', 'filter');
      const all = tableAt(h, n[0].id);
      H.app.findNode(n[1].id).cfg.criteria = [criterion(col, 'eq', value)];
      const kept = tableAt(h, n[1].id);
      H.app.findNode(n[1].id).cfg.criteria = [criterion(col, 'ne', value)];
      const rest = tableAt(h, n[1].id);

      assert.equal(kept.rows.length + rest.rows.length, all.rows.length,
        col + ' = ' + value + ': the two halves do not add up to the whole');
      assert.deepEqual(bag(kept).concat(bag(rest)).sort(), bag(all).slice().sort(),
        col + ' = ' + value + ': the halves are not the rows that went in');
    });

    /* A filter that cannot exclude anything must change nothing at all, down to
       the order. This is the identity case of the law above and it is worth its
       own statement: a Filter that reordered or re-boxed its rows while keeping
       all of them would satisfy the partition and still be wrong. */
    forEachCase('a predicate nothing can fail is the identity', (r) => {
      const { h, n } = chain('source', 'filter');
      const all = tableAt(h, n[0].id);
      H.app.findNode(n[1].id).cfg.criteria =
        [criterion('gpa', 'gte', String(GPA_MIN - 1 - r()))];
      const kept = tableAt(h, n[1].id);
      assert.deepEqual(rowKeys(kept), rowKeys(all), 'an always-true filter changed the table');
      assert.deepEqual(colKeys(kept), colKeys(all), 'an always-true filter changed the header');
    });
  });

  describe('the row-order nodes compose the way their names promise', () => {

    forEachCase('Reverse twice is the identity', (r) => {
      const { h, n } = chain('source', 'filter', 'reverse', 'reverse');
      H.app.findNode(n[1].id).cfg.criteria = [criterion('gpa', 'gt', gpaThreshold(r))];
      assert.deepEqual(rowKeys(tableAt(h, n[3].id)), rowKeys(tableAt(h, n[1].id)),
        'reversing twice did not come back to where it started');
    });

    forEachCase('Sort is idempotent', (r) => {
      const col = pick(r, NUMERIC.concat(ENUM));
      const dir = r() < 0.5 ? 'asc' : 'desc';
      const { h, n } = chain('source', 'sort', 'sort');
      [n[1], n[2]].forEach(s => { H.app.findNode(s.id).cfg.keys = [{ col: col, dir: dir }]; });
      assert.deepEqual(rowKeys(tableAt(h, n[2].id)), rowKeys(tableAt(h, n[1].id)),
        'sorting an already sorted table by ' + col + ' ' + dir + ' moved rows');
    });

    /* Take(n) then Take(m) must equal Take(min(n,m)). A node that treated its
       count as a position, or that clamped before comparing, breaks this on
       exactly the pairs nobody writes an example for. */
    forEachCase('Take composes to the smaller of the two counts', (r) => {
      const a = 1 + Math.floor(r() * 90);
      const b = 1 + Math.floor(r() * 90);

      // Read before building the second graph: they share one canvas.
      const twice = chain('source', 'take', 'take');
      H.app.findNode(twice.n[1].id).cfg.n = String(a);
      H.app.findNode(twice.n[2].id).cfg.n = String(b);
      const composed = rowKeys(tableAt(H, twice.n[2].id));

      const once = chain('source', 'take');
      H.app.findNode(once.n[1].id).cfg.n = String(Math.min(a, b));
      const direct = rowKeys(tableAt(H, once.n[1].id));

      assert.deepEqual(composed, direct,
        'Take ' + a + ' then Take ' + b + ' is not Take ' + Math.min(a, b));
    });

    forEachCase('Take keeps a prefix, and never invents a row', (r) => {
      const k = 1 + Math.floor(r() * 120);
      const { h, n } = chain('source', 'take');
      H.app.findNode(n[1].id).cfg.n = String(k);
      const all = tableAt(h, n[0].id), got = tableAt(h, n[1].id);
      assert.equal(got.rows.length, Math.min(k, all.rows.length),
        'Take ' + k + ' of ' + all.rows.length + ' returned the wrong number of rows');
      assert.deepEqual(rowKeys(got), rowKeys(all).slice(0, got.rows.length),
        'Take ' + k + ' did not keep the FIRST rows');
    });

    forEachCase('Unique is idempotent', (r) => {
      const col = r() < 0.5 ? '' : pick(r, ENUM);
      const { h, n } = chain('source', 'unique', 'unique');
      [n[1], n[2]].forEach(u => { H.app.findNode(u.id).cfg.col = col; });
      assert.deepEqual(rowKeys(tableAt(h, n[2].id)), rowKeys(tableAt(h, n[1].id)),
        'deduplicating an already unique table (col "' + col + '") changed it');
    });

    /* Filtering and sorting are independent: doing either first must give the
       same rows, even though the order differs. Stated as a bag rather than a
       list for exactly that reason. */
    forEachCase('Filter and Sort commute as a set of rows', (r) => {
      const t = gpaThreshold(r);
      const col = pick(r, NUMERIC.concat(ENUM));

      const fs = chain('source', 'filter', 'sort');
      H.app.findNode(fs.n[1].id).cfg.criteria = [criterion('gpa', 'gt', t)];
      H.app.findNode(fs.n[2].id).cfg.keys = [{ col: col, dir: 'asc' }];
      const filteredFirst = bag(tableAt(H, fs.n[2].id));

      const sf = chain('source', 'sort', 'filter');
      H.app.findNode(sf.n[1].id).cfg.keys = [{ col: col, dir: 'asc' }];
      H.app.findNode(sf.n[2].id).cfg.criteria = [criterion('gpa', 'gt', t)];
      const sortedFirst = bag(tableAt(H, sf.n[2].id));

      assert.deepEqual(filteredFirst, sortedFirst,
        'filtering before sorting kept different rows than sorting before filtering');
    });
  });

  describe('the column nodes leave the rows alone', () => {

    forEachCase('Select narrows the header and keeps every row', (r) => {
      const { h, n } = chain('source', 'select');
      const all = tableAt(h, n[0].id);
      const keys = colKeys(all).filter(() => r() < 0.6);
      H.app.findNode(n[1].id).cfg.cols = keys.length ? keys : null;
      const got = tableAt(h, n[1].id);

      assert.equal(got.rows.length, all.rows.length, 'Select changed the number of rows');
      colKeys(got).forEach(k => assert.includes(colKeys(all), k,
        'Select produced a column that was not in its input: ' + k));
      if (keys.length) {
        assert.deepEqual(colKeys(got), keys, 'Select kept columns other than the ones chosen');
      }
    });
  });

  describe('the summarising nodes account for every row they were given', () => {

    /* A breakdown must be a partition. Grouping on a column every row has a
       value for, the group counts have to add up to the rows that went in:
       a row in no group is a row quietly dropped from somebody's answer, and a
       row in two groups is one counted twice. */
    forEachCase('SelectFor group counts add up to the rows in', (r) => {
      /* Both grains, so the law is checked over an enrolment table as well as a
         student one. The columns chosen are ones every row has a value for: a
         group column with blanks is a different law, where the blanks are
         reported as a SKIP line, and 23-selectfor is where that one lives. */
      const enrolments = r() < 0.5;
      H.w.clearAll();
      const src = H.add('source');
      let feed = src;
      if (enrolments) {
        const p = H.add('project');
        H.app.connect(src.id, p.id);
        feed = p;
      }
      const sf = H.add('selectFor');
      H.app.connect(feed.id, sf.id, '#fff', 'data');
      const col = pick(r, enrolments ? ['subject', 'level', 'year'] : ['gender', 'year', 'degree']);
      H.app.findNode(sf.id).cfg.by = col;

      const all = tableAt(H, feed.id);
      const out = tableAt(H, sf.id);
      const ci = out.columns.findIndex(c => /count/i.test(c.label));
      assert.ok(ci !== -1, 'the breakdown has no Count column to add up');

      const total = out.rows.reduce((a, row) => a + Number(row[ci] || 0), 0);
      assert.equal(total, all.rows.length,
        'grouping ' + (enrolments ? 'enrolments' : 'students') + ' by ' + col +
        ': the groups hold ' + total + ' rows of ' + all.rows.length);
    });

    /* Over both grains and several columns, not just GPA at student grain. A
       mutation that dropped the lowest value was caught by the grade histogram
       and NOT by this property while it only ever looked at one column of one
       table, which is how narrow generation turns a real law into a weak one. */
    forEachCase('Histogram bin counts add up to the rows with a value', (r) => {
      const width = [0.5, 1, 2, 2.5][Math.floor(r() * 4)];
      const enrolments = r() < 0.5;
      const { n } = enrolments
        ? chain('source', 'project', 'histogram')
        : chain('source', 'histogram');
      const hist = n[n.length - 1], feed = n[n.length - 2];

      const all = tableAt(H, feed.id);
      const keys = colKeys(all);
      const hasValue = (row, k) => {
        const v = row[keys.indexOf(k)];
        return v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
      };
      const numeric = keys.filter(k =>
        k !== 'id' && k !== 'studentId' && all.rows.some(row => hasValue(row, k)));
      if (!numeric.length) return;
      const col = pick(r, numeric);

      H.app.findNode(hist.id).cfg.by = col;
      H.app.findNode(hist.id).cfg.width = String(width);

      const withValue = all.rows.filter(row => hasValue(row, col)).length;
      const out = tableAt(H, hist.id);
      const ci = out.columns.findIndex(c => /count/i.test(c.label));
      assert.ok(ci !== -1, 'the histogram has no Count column');
      const total = out.rows.reduce((a, row) => a + Number(row[ci] || 0), 0);
      assert.equal(total, withValue,
        (enrolments ? 'enrolments' : 'students') + ', ' + col + ', bands of ' + width +
        ': the bands hold ' + total + ' rows of the ' + withValue + ' that have a value');
    });

    /* Sum is additive over a partition. This is the law that catches a measure
       skipping blanks in one branch and not the other, which is the defect
       class the SKIP lines exist for. */
    forEachCase('a sum over the whole equals the sum over each half', (r) => {
      const t = gpaThreshold(r);
      const whole = chain('source', 'aggregate');
      H.app.findNode(whole.n[1].id).cfg.stats = [{ op: 'sum', col: 'gpa' }];
      const total = Number(tableAt(H, whole.n[1].id).rows[0][0]);

      const half = (op) => {
        const c = chain('source', 'filter', 'aggregate');
        H.app.findNode(c.n[1].id).cfg.criteria = [criterion('gpa', op, t)];
        H.app.findNode(c.n[2].id).cfg.stats = [{ op: 'sum', col: 'gpa' }];
        return Number(tableAt(H, c.n[2].id).rows[0][0]) || 0;
      };
      const upper = half('gt'), lower = half('lte');

      assert.close(upper + lower, total, 1e-6,
        'at gpa ' + t + ' the halves sum to a different total than the whole');
    });

    forEachCase('a count is the number of rows, and nothing else', (r) => {
      const c = chain('source', 'filter', 'aggregate');
      H.app.findNode(c.n[1].id).cfg.criteria = [criterion('gpa', 'gt', gpaThreshold(r))];
      H.app.findNode(c.n[2].id).cfg.stats = [{ op: 'count', col: '' }];
      assert.equal(Number(tableAt(H, c.n[2].id).rows[0][0]),
                   tableAt(H, c.n[1].id).rows.length,
        'Count disagrees with the number of rows it was given');
    });
  });

  describe('changing what a row means does not change who is in the table', () => {

    /* Project turns one student into one row per course. The students are the
       same students: counting the distinct ids after it must give back the
       number of students that went in. This is the law behind the warning in
       applyProject that a granularity switch once made "count students" wrong
       by a factor of eight. */
    test('Project keeps every student, and invents none', () => {
      const { h, n } = chain('source', 'project');
      const before = tableAt(h, n[0].id);
      const after = tableAt(h, n[1].id);

      const idIn = colKeys(before).indexOf('id');
      const idOut = colKeys(after).findIndex(k => k === 'id' || k === 'studentId');
      assert.ok(idOut !== -1, 'the unfolded table has no student identifier');

      const was = new Set(before.rows.map(row => String(row[idIn])));
      const now = new Set(after.rows.map(row => String(row[idOut])));
      assert.equal(now.size, was.size,
        'unfolding changed the number of distinct students from ' + was.size + ' to ' + now.size);
      [...was].forEach(id => assert.ok(now.has(id), 'student ' + id + ' vanished when unfolded'));

      const courses = before.rows.reduce((a, row, i) =>
        a + (STUDENTS[i] && STUDENTS[i].courses ? STUDENTS[i].courses.length : 0), 0);
      assert.equal(after.rows.length, courses,
        'one row per course is not what came out');
    });
  });
};
