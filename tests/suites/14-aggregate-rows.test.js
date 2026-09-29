/* AggregateRows.
   The third member of the aggregation family, and the one that runs across the
   page rather than down it:

     AggregateColumns   N rows x M cols  ->  1 row  x M cols
     AggregateRows      N rows x M cols  ->  N rows x L+1 cols  (L labels)

   It replaces the MEASURE columns and carries the LABEL columns. The split is
   isMeasurable(), the same test that already decides what the arithmetic may
   touch, so nothing was added to say which columns are which: a number that is
   not an identifier is a measure, and text, enums, ids and the nested course
   column are labels.

   That is a reversal. The node used to replace the whole row, on the position
   that row aggregation assumes a row of measures and that narrowing to them
   first is a Select. Consistent, and it made the node useless for the thing it
   is reached for most: averaging a breakdown produced a column of numbers with
   no labels beside them, and Select could not put them back, because a label
   has to survive the step to be in the result at all. These suites are written
   against the new contract, and the ones that pinned the old one say so where
   they were changed.

   Two invariants did NOT change, and are asserted hardest for that reason:
   the arithmetic never touches an identifier, and count still accepts any
   column. A label is therefore counted AND carried, which is the one place the
   two rules overlap. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const A = boot().app;
  const OPS = A.AGG_OPS.map(o => o.key);

  function rig(op, mid) {
    const h = boot();
    const made = h.build('source', ...(mid || []), 'aggregateRows', 'output');
    const n = made[made.length - 2], o = made[made.length - 1];
    if (op) h.set(n.id, 'op', op);
    return { ...h, s: made[0], mid: made.slice(1, -2), n, o };
  }
  /* The measure is the LAST column now, with the labels ahead of it, so a
     reader of these assertions has to be told which cell is the answer. Read
     from the end rather than by index, so a test does not silently start
     asserting about a label if the carried set ever changes width. */
  const values = t => t.rows.map(r => r[r.length - 1]);
  const labelCells = t => t.rows.map(r => r.slice(0, -1));
  const keysOf = t => t.columns.map(c => c.key);

  /* How the student schema splits, derived rather than written as a number, so
     a column added to the Source does not look like a regression here. gpa is
     the only measure among the eight, so seven labels come through and the
     measure is the eighth column out. */
  const CARRIED  = A.STUDENT_COLUMNS.filter(c => !A.isMeasurable(null, c)).length;
  const OUT_COLS = CARRIED + 1;

  describe('registration', () => {
    test('it appears in every table the registry keeps', () => {
      const { app } = boot();
      assert.ok(app.SHAPE.aggregateRows, 'no shape');
      assert.ok(app.NODE_SPEC.aggregateRows, 'no spec');
      assert.ok(app.CONNECT_RULES.aggregateRows, 'no wiring rules');
      assert.ok(app.NODE_PORTS.aggregateRows, 'no ports');
      assert.deepEqual(app.defaultCfg('aggregateRows'), { op: 'sum' });
    });

    test('it goes wherever its sibling goes', () => {
      const { app } = boot();
      assert.deepEqual(app.CONNECT_RULES.aggregateRows, app.CONNECT_RULES.aggregateColumns);
    });

    test('anything that can feed AggregateColumns can feed it', () => {
      const { app } = boot();
      Object.keys(app.CONNECT_RULES).forEach(from =>
        assert.equal(app.canConnect(from, 'aggregateRows'),
                     app.canConnect(from, 'aggregateColumns'), from));
    });

    test('it is offered in the Processing menu under Summarise', () => {
      const h = boot();
      const btn = [...h.doc.querySelectorAll('.proc-item')]
        .find(b => b.getAttribute('onclick').includes("'aggregateRows'"));
      assert.ok(btn, 'no menu entry');
      assert.includes(btn.className, 'cat-summarise');
    });

    test('adding one from the menu renders its shape', () => {
      const h = boot();
      h.w.addProcNode('aggregateRows');
      assert.equal(h.app.nodes[0].type, 'aggregateRows');
      assert.ok(h.q('.shape-aggrows'));
    });
  });

  describe('the shape of the result', () => {
    test('the labels come through, the measure is appended, one row per row in', () => {
      const r = rig('sum');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(t.rows.length, A.STUDENTS.length, 'a row in is a row out');
      assert.equal(t.columns.length, OUT_COLS);
      // The labels arrive in the order the header had them, and the measure is
      // last: asserted against the schema so this follows a column being added.
      assert.deepEqual(keysOf(t).slice(0, -1),
        A.STUDENT_COLUMNS.filter(c => !A.isMeasurable(null, c)).map(c => c.key));
      assert.equal(keysOf(t)[t.columns.length - 1], 'sum');
    });

    test('a measure column is consumed, a label column is not', () => {
      // gpa is the one measure on a student row, so it is the one column that
      // does NOT come out the other side under its own name.
      const r = rig('sum');
      r.w.runQuery();
      assert.excludes(keysOf(r.entry(r.o.id).table), 'gpa');
      assert.includes(keysOf(r.entry(r.o.id).table), 'id');
    });

    test('the carried cells are the cells that arrived, untouched', () => {
      const r = rig('sum');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      const keep = A.STUDENT_COLUMNS.filter(c => !A.isMeasurable(null, c)).map(c => c.key);
      assert.deepEqual(labelCells(t).slice(0, 3),
        A.STUDENTS.slice(0, 3).map(st => keep.map(k => st[k])));
    });

    test('it is the mirror of AggregateColumns, not a second spelling of it', () => {
      const rows = rig('sum'); rows.w.runQuery();
      const h = boot();
      const [s, ac, o] = h.build('source', 'aggregateColumns', 'output');
      h.set(ac.id, 'op', 'sum');
      h.w.runQuery();

      const byRow = rows.entry(rows.o.id).table;
      const byCol = h.entry(o.id).table;
      assert.equal(byRow.rows.length, A.STUDENTS.length);
      assert.equal(byRow.columns.length, OUT_COLS, 'the labels plus the measure');
      assert.equal(byCol.rows.length, 1);
      // One column per column that came in: Asserted against the schema, so a
      // column added to the Source does not look like a regression here.
      assert.equal(byCol.columns.length, A.STUDENT_COLUMNS.length);
    });

    test('the last column names the measure', () => {
      A.AGG_OPS.forEach(op => {
        const r = rig(op.key);
        r.w.runQuery();
        const cols = r.entry(r.o.id).table.columns;
        const c = cols[cols.length - 1];
        assert.equal(c.key, op.key, op.key);
        assert.equal(c.label, op.label, op.key);
        assert.equal(c.type, A.COLTYPE.NUMBER, op.key);
      });
    });

    test('the header it declares is the header it produces, for every measure', () => {
      OPS.forEach(op => {
        const r = rig(op);
        const declared = r.app.computeSchemas()[r.n.id].columns.map(c => c.key + ':' + c.label);
        const produced = r.app.evaluateGraph().res[r.n.id].table.columns.map(c => c.key + ':' + c.label);
        assert.deepEqual(produced, declared, op);
      });
    });

    test('the header follows what arrives, because the labels are part of it', () => {
      /* This is the assertion that turned over. It used to read "the header
         depends on the measure alone, not on what arrives", which was true
         while the whole row was replaced and is the precise thing that made
         the node lose its labels. The schema walk is handed the incoming
         header anyway, so nothing had to be given up to derive this. */
      const wide = rig('sum');
      const narrow = rig('sum', ['select']);
      narrow.set(narrow.mid[0].id, 'column:gender', false);
      const w = wide.app.computeSchemas()[wide.n.id].columns.map(c => c.key);
      const n = narrow.app.computeSchemas()[narrow.n.id].columns.map(c => c.key);
      assert.includes(w, 'gender');
      assert.excludes(n, 'gender', 'dropping a label upstream drops it here');
      assert.equal(n.length, w.length - 1);
    });

    test('dropping the only measure still leaves the measure column', () => {
      // There is nothing to compute from, which is a blank answer rather than
      // a missing column: the header is a promise the node keeps either way.
      const r = rig('sum', ['select']);
      r.set(r.mid[0].id, 'column:gpa', false);
      const cols = r.app.computeSchemas()[r.n.id].columns.map(c => c.key);
      assert.equal(cols[cols.length - 1], 'sum');
      assert.equal(cols.length, CARRIED + 1);
    });
  });

  describe('the values, against the raw data', () => {
    test('sum across a student row is their gpa alone', () => {
      /* Of the seven student columns only gpa is a measure: id is an
         identifier, gender/year/specialisation/letterGrade are not numbers, and
         courses is nested. So the row total is that one figure, which is the
         warning the panel gives by naming how many columns contribute. */
      const r = rig('sum');
      r.w.runQuery();
      assert.deepEqual(values(r.entry(r.o.id).table), A.STUDENTS.map(s => s.gpa));
    });

    test('count counts every column, because any column can answer it', () => {
      /* Unchanged by the labels change, and deliberately so. Count asks how
         many values a row holds, and a label is a value, so a carried column
         is counted AND carried. That overlap is the one place the two rules
         touch, and the panel names the contributing count for exactly this
         reason. */
      const r = rig('count');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      const width = A.STUDENT_COLUMNS.length;
      assert.deepEqual(values(t), A.STUDENTS.map(() => width),
        'every column, none blank');
      assert.equal(t.columns.length, OUT_COLS, 'and the labels still come through');
    });

    test('min, max and average of a single-measure row are that measure', () => {
      ['min', 'max', 'average', 'median'].forEach(op => {
        const r = rig(op);
        r.w.runQuery();
        assert.deepEqual(values(r.entry(r.o.id).table), A.STUDENTS.map(s => s.gpa), op);
      });
    });

    test('with two measures on the row, the arithmetic is real', () => {
      /* A Compare summary carries two measures per row (a count and an
         average) plus a branch label that must be left out of the sum, and
         that now comes through beside the answer rather than being dropped. */
      const h = boot();
      const s1 = h.add('source'), f1 = h.add('filter'),
            s2 = h.add('source'), f2 = h.add('filter'),
            c = h.add('compare'), ar = h.add('aggregateRows'), o = h.add('output');
      h.app.connect(s1.id, f1.id); h.app.connect(s2.id, f2.id);
      h.app.connect(f1.id, c.id);  h.app.connect(f2.id, c.id);
      h.app.connect(c.id, ar.id);  h.app.connect(ar.id, o.id);
      h.set(f1.id, 'crit.0.value:gpa', '60');
      h.set(f2.id, 'crit.0.value:gpa', '80');
      h.w.render();
      h.set(ar.id, 'op', 'sum');
      h.w.runQuery();

      const summary = h.app.evaluateGraph().res[c.id].table;
      const want = summary.rows.map(r => r[1] + r[2]);   // count + average, not the label
      const out = h.entry(o.id).table;
      assert.deepEqual(values(out), want, 'the label is not added in');
      // and the label is still there to say which branch each total belongs to
      assert.deepEqual(labelCells(out), summary.rows.map(r => [r[0]]));
      assert.deepEqual(out.columns.map(c2 => c2.key), ['branch', 'sum']);
    });

    test('a row with nothing measurable gives null, not zero', () => {
      const r = rig('sum', ['select']);
      ['id', 'gender', 'year', 'specialisation', 'gpa', 'courses']
        .forEach(k => r.set(r.mid[0].id, 'column:' + k, false));   // degree, letterGrade
      r.w.runQuery();
      assert.notOk(r.q('.error-box'), r.text('.error-box'));
      const t = r.entry(r.o.id).table;
      assert.equal(t.rows.length, A.STUDENTS.length, 'the rows are still there');
      assert.deepEqual(values(t), A.STUDENTS.map(() => null), 'there was nothing to sum');
      // the labels are all that survived, and they are all still here
      assert.deepEqual(keysOf(t), ['degree', 'letterGrade', 'sum']);
    });

    test('an empty table gives an empty result, not an error', () => {
      const h = boot();
      const [s, f, ar, o] = h.build('source', 'filter', 'aggregateRows', 'output');
      h.set(f.id, 'crit.0.value:gpa', '500');
      h.w.runQuery();
      assert.notOk(h.q('.error-box'));
      assert.equal(h.entry(o.id).table.rows.length, 0);
      assert.equal(h.entry(o.id).table.columns.length, OUT_COLS,
        'the header is still declared, labels and all');
    });
  });

  describe('composition', () => {
    test('Select in front decides which columns are combined', () => {
      // The answer to "specify which columns are aggregated", by composition
      const r = rig('count', ['select']);
      ['gender', 'year', 'degree', 'specialisation', 'letterGrade', 'courses']
        .forEach(k => r.set(r.mid[0].id, 'column:' + k, false));   // id + gpa
      r.w.runQuery();
      assert.deepEqual(values(r.entry(r.o.id).table), A.STUDENTS.map(() => 2));
    });

    test('and Select behind decides which labels are kept', () => {
      /* The composition that replaces the old "narrow first" advice. Narrowing
         first loses the label for good; narrowing afterwards is a choice the
         user can still make, and this is the path the panel hint points at. */
      const h = boot();
      const [s2, ar, sel, o] = h.build('source', 'aggregateRows', 'select', 'output');
      h.set(ar.id, 'op', 'sum');
      h.w.render();
      A.STUDENT_COLUMNS.filter(c => !A.isMeasurable(null, c))
        .forEach(c => h.set(sel.id, 'column:' + c.key, false));
      h.w.runQuery();
      const t = h.entry(o.id).table;
      assert.deepEqual(t.columns.map(c => c.key), ['sum'], 'back to one column');
      assert.deepEqual(t.rows.map(r => r[0]), A.STUDENTS.map(st => st.gpa));
    });

    test('an identifier is still excluded from the arithmetic', () => {
      const r = rig('sum', ['select']);
      ['gender', 'year', 'degree', 'specialisation', 'letterGrade', 'courses']
        .forEach(k => r.set(r.mid[0].id, 'column:' + k, false));   // id + gpa
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.deepEqual(values(t), A.STUDENTS.map(s => s.gpa),
        'the id must not be added in');
      /* The promise the old whole-row rule was defending, kept by the rule
         that replaced it: the id is still outside the sum. It is now shown
         beside it instead of thrown away, which is the whole change. */
      assert.deepEqual(keysOf(t), ['id', 'sum']);
      assert.deepEqual(labelCells(t), A.STUDENTS.map(s => [s.id]));
    });

    test('its result can be fed onward like any other table', () => {
      const h = boot();
      const [s, ar, agg, o] = h.build('source', 'aggregateRows', 'aggregate', 'output');
      h.set(ar.id, 'op', 'sum');
      h.set(agg.id, 'op', 'average');
      h.w.runQuery();
      const want = A.STUDENTS.reduce((a, s2) => a + s2.gpa, 0) / A.STUDENTS.length;
      assert.close(h.entry(o.id).table.rows[0][0], want, 1e-9);
    });

    test('a one-row, one-column result reaches the headline display', () => {
      /* A Take(1) alone no longer produces one cell, because seven labels come
         with it, so the headline needs the labels dropped as well as the rows.
         That is a Select, which is the composition the panel names. */
      const h = boot();
      const [s, t, ar, sel, o] =
        h.build('source', 'take', 'aggregateRows', 'select', 'output');
      h.set(t.id, 'n', '1');
      h.set(ar.id, 'op', 'sum');
      h.w.render();
      A.STUDENT_COLUMNS.filter(c => !A.isMeasurable(null, c))
        .forEach(c => h.set(sel.id, 'column:' + c.key, false));
      h.w.runQuery();
      assert.ok(h.q('.big-num'), 'one cell should headline');
      assert.includes(h.text('.result-head'), 'Sum');
    });

    test('a wide result does not headline, it tabulates', () => {
      const h = boot();
      const [s, t, ar, o] = h.build('source', 'take', 'aggregateRows', 'output');
      h.set(t.id, 'n', '1');
      h.w.runQuery();
      assert.notOk(h.q('.big-num'), 'labels came through, so this is a row');
      assert.equal(h.entry(o.id).table.columns.length, OUT_COLS);
    });

    test('branch metadata is dropped — the columns are not those columns', () => {
      const h = boot();
      const s1 = h.add('source'), s2 = h.add('source'),
            c = h.add('compare'), ar = h.add('aggregateRows'), o = h.add('output');
      h.app.connect(s1.id, c.id); h.app.connect(s2.id, c.id);
      h.app.connect(c.id, ar.id); h.app.connect(ar.id, o.id);
      h.w.render();
      const t = h.app.evaluateGraph().res[ar.id].table;
      assert.notOk(t.meta && t.meta.branches);
    });
  });

  describe('the panel', () => {
    test('it offers the measure but no column picker', () => {
      const r = rig();
      const keys = r.qa('[data-node="' + r.n.id + '"]').map(e => e.getAttribute('data-key'));
      assert.deepEqual(keys, ['op'], 'the measure applies across the row, so there is none to pick');
    });

    test('every measure is offered', () => {
      const r = rig();
      assert.deepEqual(r.optionsOf(r.n.id, 'op'), OPS);
    });

    test('the hint counts the columns that will actually contribute', () => {
      const r = rig('sum');
      const hint = r.qa('[data-node="' + r.n.id + '"]')[0]
        .closest('.node-config').textContent;
      assert.includes(hint, '1 of ' + A.STUDENT_COLUMNS.length,
        'naming the count is the warning');
      assert.includes(hint, 'Select', 'and it says how to change it');
    });

    test('the hint names the labels that will come through', () => {
      /* The shape of the result is what people get wrong about this node, and
         it changed: a reader who expects one column and gets eight should be
         told before the query runs. Naming them, not just counting them, makes
         the claim checkable against the node above. */
      const r = rig('sum');
      const hint = r.qa('[data-node="' + r.n.id + '"]')[0]
        .closest('.node-config').textContent.replace(/\s+/g, ' ');
      assert.includes(hint, CARRIED + ' label columns come through');
      A.STUDENT_COLUMNS.filter(c => !A.isMeasurable(null, c))
        .forEach(c => assert.includes(hint, c.label, c.key + ' should be named'));
      assert.includes(hint, 'Drop them with a Select');
      assert.excludes(hint, 'one column, one row per row in',
        'the old promise of a single column is gone');
    });

    test('and reads as English when there is only one of them', () => {
      const h = boot();
      const [s2, sf, ar, o] = h.build('source', 'selectFor', 'aggregateRows', 'output');
      h.set(sf.id, 'by', 'specialisation');
      h.w.render();
      const hint = h.qa('[data-node="' + ar.id + '"]')[0]
        .closest('.node-config').textContent.replace(/\s+/g, ' ');
      assert.includes(hint, '1 label column comes through: Specialisation');
      assert.includes(hint, 'Drop it with a Select');
    });

    test('with nothing to carry, the hint does not mention labels', () => {
      const r = rig('sum', ['select']);
      A.STUDENT_COLUMNS.filter(c => !A.isMeasurable(null, c))
        .forEach(c => r.set(r.mid[0].id, 'column:' + c.key, false));   // gpa only
      const hint = r.qa('[data-node="' + r.n.id + '"]')[0]
        .closest('.node-config').textContent.replace(/\s+/g, ' ');
      assert.excludes(hint, 'label column');
      assert.includes(hint, '1 of 1 column');
    });

    test('the hint follows the header, not a guess', () => {
      const r = rig('sum', ['select']);
      r.set(r.mid[0].id, 'column:courses', false);
      const hint = r.qa('[data-node="' + r.n.id + '"]')[0]
        .closest('.node-config').textContent;
      assert.includes(hint, 'of ' + (A.STUDENT_COLUMNS.length - 1));
    });
  });

  describe('the labels it carries', () => {

    // A one-node rig over a table written out here, because the interesting
    // cases are headers the archive does not happen to produce.
    const node = op => ({ id: 99, type: 'aggregateRows', cfg: { op } });
    const run  = (t, op) => A.applyAggregateRows(node(op || 'sum'), t, []);
    const col  = (key, label, type) => ({ key, label, type });
    const NUM = A.COLTYPE.NUMBER, TXT = A.COLTYPE.TEXT;

    test('a breakdown keeps its group label, which is the point of the change', () => {
      /* Select For -> Aggregate Rows. Before this, the averages came out with
         nothing saying which group each belonged to, which is what made the
         supervisor's "average enrolment for multiple courses" unanswerable. */
      const h = boot();
      const [s, sf, ar, o] = h.build('source', 'selectFor', 'aggregateRows', 'output');
      h.set(sf.id, 'by', 'specialisation');
      h.w.render();
      h.app.addStat(sf.id);
      h.w.render();
      h.set(sf.id, 'stat.1.op', 'average');
      h.w.render();
      h.set(sf.id, 'stat.1.col', 'gpa');
      h.set(ar.id, 'op', 'sum');
      h.w.runQuery();

      const grouped = h.app.evaluateGraph().res[sf.id].table;
      const t = h.entry(o.id).table;
      assert.deepEqual(t.columns.map(c => c.key), ['group', 'sum']);
      assert.deepEqual(labelCells(t), grouped.rows.map(r => [r[0]]),
        'every average still says which group it is');
      assert.deepEqual(values(t), grouped.rows.map(r => r[1] + r[2]));
    });

    test('an identifier counts as a label, not as a measure', () => {
      const t = A.makeTable([col('id', 'ID', NUM), col('a', 'A', NUM)], [[1001, 5]]);
      const out = run(t);
      assert.deepEqual(out.columns.map(c => c.key), ['id', 'sum']);
      assert.deepEqual(out.rows, [[1001, 5]], 'the id rides along, it is not summed');
    });

    test('the nested course column is a label too', () => {
      const t = A.studentsTable(A.STUDENTS.slice(0, 2));
      assert.includes(A.aggregateRowsCarried(t).map(c => c.key), 'courses');
    });

    test('a table of labels alone still produces the measure column', () => {
      const t = A.makeTable([col('g', 'G', TXT)], [['x'], ['y']]);
      const out = run(t);
      assert.deepEqual(out.columns.map(c => c.key), ['g', 'sum']);
      assert.deepEqual(out.rows, [['x', null], ['y', null]], 'nothing to sum');
    });

    test('a table of measures alone carries nothing, as it always did', () => {
      const t = A.makeTable([col('a', 'A', NUM), col('b', 'B', NUM)], [[1, 2]]);
      const out = run(t);
      assert.deepEqual(out.columns.map(c => c.key), ['sum']);
      assert.deepEqual(out.rows, [[3]]);
    });

    test('an empty header gives the measure column and no rows', () => {
      OPS.forEach(op => {
        const out = run(A.makeTable([], []), op);
        assert.deepEqual(out.columns.map(c => c.key), [op], op);
        assert.equal(out.rows.length, 0, op);
      });
    });

    describe('a label whose name collides with the measure', () => {
      test('a clashing key is suffixed, so colIndex cannot pick the wrong one', () => {
        const t = A.makeTable([col('sum', 'Total', TXT), col('a', 'A', NUM)], [['x', 5]]);
        const out = run(t);
        assert.deepEqual(out.columns.map(c => c.key), ['sum', 'sum_2']);
        assert.deepEqual(out.columns.map(c => c.label), ['Total', 'Sum'],
          'the labels did not clash, so neither was touched');
        assert.equal(A.colIndex(out, 'sum_2'), 1);
      });

      test('a clashing label is suffixed too, because it becomes a CSV header', () => {
        const t = A.makeTable([col('total', 'Sum', TXT), col('a', 'A', NUM)], [['x', 5]]);
        const out = run(t);
        assert.deepEqual(out.columns.map(c => c.key), ['total', 'sum'],
          'the keys did not clash, so neither was renamed');
        assert.deepEqual(out.columns.map(c => c.label), ['Sum', 'Sum 2']);
        assert.equal(A.serialiseTable(out, ',', true).split('\n')[0], 'Sum,Sum 2');
      });

      test('both at once', () => {
        const t = A.makeTable([col('sum', 'Sum', TXT), col('a', 'A', NUM)], [['x', 5]]);
        const out = run(t);
        assert.deepEqual(out.columns.map(c => c.key), ['sum', 'sum_2']);
        assert.deepEqual(out.columns.map(c => c.label), ['Sum', 'Sum 2']);
      });

      test('every key and label out is unique, for every measure', () => {
        const t = A.makeTable(
          OPS.map(o => col(o, A.AGG_OPS.find(x => x.key === o).label, TXT))
             .concat([col('a', 'A', NUM)]),
          [OPS.map(() => 'x').concat([5])]);
        OPS.forEach(op => {
          const out = run(t, op);
          const ks = out.columns.map(c => c.key), ls = out.columns.map(c => c.label);
          assert.equal(new Set(ks).size, ks.length, 'duplicate key for ' + op);
          assert.equal(new Set(ls).size, ls.length, 'duplicate label for ' + op);
        });
      });
    });

    test('the export carries the labels, not just the numbers', () => {
      const h = boot();
      const [s, sf, ar, o] = h.build('source', 'selectFor', 'aggregateRows', 'output');
      h.set(sf.id, 'by', 'specialisation');
      h.set(ar.id, 'op', 'sum');
      h.w.runQuery();
      const t = h.entry(o.id).table;
      const lines = A.serialiseTable(t, ',', true).split('\n');
      assert.equal(lines[0], 'Specialisation,Sum');
      // Checked against the table rather than against a name written here, so
      // this says "the label reached the file" and not "the file says SWEN".
      assert.equal(lines.length, t.rows.length + 1);
      assert.includes(lines[1], String(t.rows[0][0]));
    });

    test('the log says what was carried', () => {
      const h = boot();
      const [s, ar, o] = h.build('source', 'aggregateRows', 'output');
      h.set(ar.id, 'op', 'sum');
      h.w.runQuery();
      const log = h.entry(o.id).log.join(' | ');
      assert.includes(log, 'carried ' + CARRIED + ' label columns');
      assert.excludes(log, 'ignored', 'nothing is ignored any more');
    });

    test('nothing carried, nothing logged about it', () => {
      const t = A.makeTable([col('a', 'A', NUM)], [[1]]);
      const log = [];
      A.applyAggregateRows(node('sum'), t, log);
      assert.equal(log.filter(e => /carried/.test(JSON.stringify(e))).length, 0);
    });
  });

  describe('persistence', () => {
    test('the measure survives a round trip', () => {
      const r = rig('median');
      const json = JSON.stringify(r.app.serialiseGraph());
      r.w.clearAll();
      r.app.loadGraphFromText(json, r.doc.createElement('button'));
      const back = r.app.nodes.find(n => n.type === 'aggregateRows');
      assert.equal(back.cfg.op, 'median');
    });
  });
};
