/* SELECT FOR — the group-by whose groups are named rather than wired.

   The node is assembled almost entirely out of parts that already had tests:
   applyCriterion decides which rows a label keeps, reduceValues computes the
   measures, and the port model carries the two inputs. So the interesting
   claims here are not "does a filter work" — 03-filter owns that — but the
   ones that are true only of this node:

     - a group IS a filter, so it groups by predicates that are not columns,
       and a row stays a student while it does
     - the Labels port produces rows the data alone cannot: a group nothing
       matches, counted as zero
     - share divides by the rows that came in, not by the sum of the groups,
       which is the only reading that survives groups overlapping
     - the schema walk and the evaluator build the one header together

   Everything countable is cross-checked against STUDENTS directly rather than
   against another run of the tool, so a wrong answer cannot pass by agreeing
   with itself. */

const { boot, hasDataDir } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  /* Source -> SelectFor -> Output, the shape almost every test here wants.
     The data port is named explicitly: connect() defaults to the primary port,
     which IS `data`, but a test that relied on the default would keep passing
     if the two ports were ever swapped. */
  function plain() {
    const h = boot();
    const src = h.add('source'), sf = h.add('selectFor'), out = h.add('output');
    h.app.connect(src.id, sf.id, null, 'data');
    h.app.connect(sf.id, out.id);
    h.w.render();
    return Object.assign(h, { src, sf, out });
  }

  // Set a config value and re-render, because every control on this panel can
  // change which other controls exist.
  function cfg(h, key, value) { h.set(h.sf.id, key, value); h.w.render(); }

  function runTable(h) { h.w.runQuery(); return h.entry(h.out.id).source; }

  const rowsOf = t => t.rows.map(r => r.slice());
  const keysOf = t => t.columns.map(c => c.key);
  const labelsOf = t => t.rows.map(r => String(r[0]));
  const valueUnder = (t, key, label) => {
    const ci = t.columns.findIndex(c => c.key === key);
    const row = t.rows.find(r => String(r[0]) === String(label));
    return row ? row[ci] : undefined;
  };
  const mean = v => v.reduce((a, b) => a + b, 0) / v.length;

  /* ---------------------------------------------------------------- the node */

  describe('the node is wired into every table that has to know about it', () => {
    test('the registry, the geometry and the ports all have an entry', () => {
      const A = boot().app;
      assert.ok(A.NODE_SPEC.selectFor, 'no registry entry');
      assert.ok(A.SHAPE.selectFor, 'no shape');
      assert.ok(A.NODE_PORTS.selectFor, 'no ports');
    });

    test('it declares two different ports, data first', () => {
      const A = boot().app;
      const ps = A.portsOf('selectFor');
      assert.deepEqual(ps.map(p => p.key), ['data', 'labels']);
      /* Data is primary, and three separate things depend on it: a version 1
         file lands its wires on the rows rather than the labels, the config
         panel describes the rows without asking which port, and the schema
         walk is handed the data header as its inSchema. */
      assert.equal(A.primaryPort('selectFor'), 'data');
    });

    test('both ports are single — neither is a place to merge tables', () => {
      const A = boot().app;
      A.portsOf('selectFor').forEach(p =>
        assert.notOk(p.multi, p.key + ' accepts several wires, so rows can vanish into it'));
    });

    test('a second wire into one port is refused', () => {
      const h = boot(), A = h.app;
      const a = h.add('source'), b = h.add('source'), sf = h.add('selectFor');
      A.connect(a.id, sf.id, null, 'data');
      h.w.render();
      assert.notOk(A.portAccepts(A.findNode(sf.id), 'data'), 'data took a second wire');
      assert.ok(A.portAccepts(A.findNode(sf.id), 'labels'), 'labels should still be free');
    });

    test('it takes a table from anything that makes one, and feeds anything that takes one', () => {
      const A = boot().app;
      ['source', 'filter', 'sort', 'unique', 'project', 'combine', 'compare', 'selectFor']
        .forEach(t => assert.ok(A.canConnect(t, 'selectFor'), t + ' cannot feed a SelectFor'));
      ['filter', 'sort', 'take', 'select', 'aggregate', 'combine', 'compare', 'output']
        .forEach(t => assert.ok(A.canConnect('selectFor', t), 'a SelectFor cannot feed a ' + t));
    });

    test('it renders two labelled port stubs, which no other node does', () => {
      const h = boot();
      h.w.addNode('selectFor');
      h.w.render();
      assert.deepEqual(h.qa('.node-port em').map(e => e.textContent), ['Data', 'Labels']);
    });
  });

  /* ------------------------------------------------------- grouping by a column */

  describe('grouping by a column', () => {
    test('one row per distinct value, counted against the dataset', () => {
      const h = plain();
      cfg(h, 'by', 'year');
      const t = runTable(h);
      assert.deepEqual(labelsOf(t), h.app.YEARS.map(String));
      h.app.YEARS.forEach(y => assert.equal(
        valueUnder(t, 'count', y),
        h.app.STUDENTS.filter(s => s.year === y).length,
        'the count for ' + y + ' disagrees with the dataset'));
    });

    test('every specialisation is a group, and the groups partition the cohort', () => {
      const h = plain();
      cfg(h, 'by', 'specialisation');
      const t = runTable(h);
      assert.deepEqual(labelsOf(t).slice().sort(), h.app.SPECS.slice().sort());
      const total = t.rows.reduce((a, r) => a + r[1], 0);
      assert.equal(total, h.app.STUDENTS.length,
        'a column split must account for every row exactly once');
      h.app.SPECS.forEach(sp => assert.equal(
        valueUnder(t, 'count', sp),
        h.app.STUDENTS.filter(s => s.specialisation === sp).length, sp));
    });

    test('the label column keeps the grouped column\'s type and its declared values', () => {
      const h = plain();
      cfg(h, 'by', 'year');
      const t = runTable(h);
      const g = t.columns[0];
      /* Not merely cosmetic. The type is what makes a Sort downstream order
         2022, 2023, 2024 rather than lexically, and the declared value set is
         what lets a downstream Filter offer the same dropdown it offered
         upstream. */
      assert.equal(g.key, 'group');
      assert.equal(g.label, 'Year');
      assert.equal(g.type, h.app.COLTYPE.ENUM);
      assert.deepEqual(g.values, h.app.colByKey(
        h.app.makeTable(h.app.STUDENT_COLUMNS, []), 'year').values);
    });

    test('groups come out in the column\'s own order, not the order rows arrived', () => {
      /* Reverse the rows in front of it. Appearance order would then put 2023
         first; the column's comparator must not care. */
      const h = boot(), A = h.app;
      const [src, rev, sf, out] = h.build('source', 'reverse', 'selectFor', 'output');
      h.set(sf.id, 'by', 'year'); h.w.render();
      h.w.runQuery();
      assert.deepEqual(h.entry(out.id).source.rows.map(r => r[0]), A.YEARS.slice());
    });

    test('the group key is fixed at "group" whatever is grouped on', () => {
      // So that a downstream node reaching for a column does not have to be
      // rewired every time the grouping changes.
      const h = plain();
      ['year', 'gender', 'specialisation'].forEach(by => {
        cfg(h, 'by', by);
        assert.equal(runTable(h).columns[0].key, 'group', 'grouping by ' + by);
      });
    });

    test('a saved grouping that no longer names a field falls back rather than grouping by nothing', () => {
      const h = plain();
      h.app.findNode(h.sf.id).cfg.by = 'no-such-column';
      h.w.render();
      const t = runTable(h);
      assert.equal(t.columns[0].key, 'group');
      assert.ok(t.rows.length > 0, 'an unresolvable field must not produce an empty breakdown');
    });
  });

  /* --------------------------------------- grouping by things that are not columns */

  describe('grouping by a predicate, which is what no other node can do', () => {
    test('by course: one group per code, cross-checked against the enrolments', () => {
      const h = plain();
      cfg(h, 'by', 'courses.code');
      const t = runTable(h);
      assert.equal(t.rows.length, h.app.COURSES.length);
      t.rows.forEach(([code, n]) => assert.equal(
        n, h.app.STUDENTS.filter(s => s.courses.some(c => c.code === code)).length,
        code + ' disagrees with the dataset'));
    });

    test('a row is still a student, so a count is still a count of students', () => {
      /* The trap Project exists to make visible, and the reason grouping by a
         course predicate is worth having: the same breakdown via Project counts
         enrolments, and the two numbers differ by the courses per student. */
      const h = plain();
      cfg(h, 'by', 'courses.code');
      const t = runTable(h);
      const anyCode = t.rows[0][0];
      const students = h.app.STUDENTS.filter(s => s.courses.some(c => c.code === anyCode));
      assert.equal(valueUnder(t, 'count', anyCode), students.length);
      assert.ok(students.length <= h.app.STUDENTS.length);
    });

    test('by subject, counted as whole students who took at least one', () => {
      const h = plain();
      cfg(h, 'by', 'courses.subject');
      const t = runTable(h);
      assert.deepEqual(labelsOf(t).slice().sort(), h.app.SUBJECTS.slice().sort());
      h.app.SUBJECTS.forEach(sub => assert.equal(
        valueUnder(t, 'count', sub),
        h.app.STUDENTS.filter(s => s.courses.some(c => c.subject === sub)).length, sub));
    });

    test('by level, with the label typed as a number so it sorts as one', () => {
      const h = plain();
      cfg(h, 'by', 'courses.level');
      const t = runTable(h);
      assert.equal(t.columns[0].type, h.app.COLTYPE.NUMBER);
      assert.deepEqual(labelsOf(t), h.app.LEVELS.map(String));
      h.app.LEVELS.forEach(l => assert.equal(
        valueUnder(t, 'count', l),
        h.app.STUDENTS.filter(s => s.courses.some(c => c.level === l)).length, 'level ' + l));
    });

    test('"grade in course" is not offered, because one label cannot supply it', () => {
      // It needs a course AND a mark. A bare value can only be one of them, and
      // a control that silently used a default course would answer a question
      // nobody asked.
      const h = plain();
      assert.excludes(h.optionsOf(h.sf.id, 'by'), 'courses.gradePoints');
    });

    test('the field list follows the incoming table, not the student schema', () => {
      /* Behind a Project a row is an enrolment, so the course predicates are
         gone and the enrolment columns are there instead. */
      const h = boot(), A = h.app;
      const [src, proj, sf, out] = h.build('source', 'project', 'selectFor', 'output');
      h.w.render();
      const offered = h.optionsOf(sf.id, 'by');
      assert.excludes(offered, 'courses.code', 'a projected row has no nested course list');
      assert.includes(offered, 'code', 'an enrolment row has a course code of its own');
    });
  });

  /* ------------------------------------------------------------------ measures */

  describe('the measures', () => {
    test('count is rows in the group, not non-blank cells', () => {
      const h = plain();
      cfg(h, 'by', 'gender');
      const t = runTable(h);
      t.rows.forEach(([g, n]) => assert.equal(
        n, h.app.STUDENTS.filter(s => s.gender === g).length, g));
    });

    test('every measure that takes a column is cross-checked against the dataset', () => {
      const cases = {
        average: v => mean(v),
        sum:     v => v.reduce((a, b) => a + b, 0),
        min:     v => Math.min(...v),
        max:     v => Math.max(...v),
        median:  v => {
          const s = v.slice().sort((a, b) => a - b), m = s.length >> 1;
          return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        }
      };
      Object.keys(cases).forEach(op => {
        const h = plain();
        cfg(h, 'by', 'specialisation');
        cfg(h, 'stat.0.op', op);
        cfg(h, 'stat.0.col', 'gpa');
        const t = runTable(h);
        assert.equal(keysOf(t)[1], op + '_gpa', op + ' names the column it measured');
        t.rows.forEach(([spec, got]) => {
          const want = cases[op](h.app.STUDENTS
            .filter(s => s.specialisation === spec).map(s => s.gpa));
          assert.close(got, want, 1e-9, op + ' of gpa for ' + spec);
        });
      });
    });

    test('the header names the column, so two averages are not one column twice', () => {
      const h = plain();
      cfg(h, 'by', 'year');
      cfg(h, 'stat.0.op', 'average');
      const t = runTable(h);
      assert.equal(t.columns[1].label, 'Average GPA');
    });

    test('measures are independent — several come out as several columns', () => {
      const h = plain();
      cfg(h, 'by', 'year');
      h.w.addStat(h.sf.id); h.w.render();
      cfg(h, 'stat.1.op', 'average');
      cfg(h, 'stat.1.col', 'gpa');
      const t = runTable(h);
      assert.deepEqual(keysOf(t), ['group', 'count', 'average_gpa']);
      h.app.YEARS.forEach(y => {
        assert.equal(valueUnder(t, 'count', y),
          h.app.STUDENTS.filter(s => s.year === y).length);
        assert.close(valueUnder(t, 'average_gpa', y),
          mean(h.app.STUDENTS.filter(s => s.year === y).map(s => s.gpa)), 1e-9);
      });
    });

    test('two identical measures get distinct keys, not one column nothing can reach', () => {
      /* colIndex() answers with the first match, so an unsuffixed duplicate is
         a column that exists in the header and can never be selected, sorted
         or exported by name. */
      const h = plain();
      cfg(h, 'by', 'year');
      h.w.addStat(h.sf.id); h.w.render();
      const t = runTable(h);
      const keys = keysOf(t);
      assert.deepEqual(keys, ['group', 'count', 'count_2']);
      keys.forEach(k => assert.equal(keys.filter(x => x === k).length, 1, k + ' is not unique'));
    });

    test('a measure with no column to apply to comes out blank, not zero', () => {
      /* Aggregate's decision, kept: a blank says "there was nothing to measure"
         and a zero is a claim about the data. Behind a Select that keeps only
         a text column there is no numeric column at all. */
      const h = boot(), A = h.app;
      const [src, sel, sf, out] = h.build('source', 'select', 'selectFor', 'output');
      h.w.render();
      A.findNode(sel.id).cfg.cols = ['specialisation'];
      h.w.render();
      h.set(sf.id, 'by', 'specialisation'); h.w.render();
      h.set(sf.id, 'stat.0.op', 'average'); h.w.render();
      h.w.runQuery();
      const t = h.entry(out.id).source;
      assert.ok(t.rows.length > 0, 'the groups should still be there');
      t.rows.forEach(r => assert.equal(r[1], null, 'expected blank, got a number'));
    });

    test('each group is measured over its own rows, not over the whole table', () => {
      /* The mistake this guards is one character wide — measuring the incoming
         table instead of the group's — and it produces a breakdown where every
         row is right-looking and identical. So the test asserts the values are
         DISTINCT as well as correct: a cross-check alone passes when every
         group is handed the cohort average, because the cohort average is a
         real number that one of the groups may well equal. */
      const h = plain();
      cfg(h, 'by', 'specialisation');
      cfg(h, 'stat.0.op', 'average');
      const t = runTable(h);
      assert.equal(keysOf(t)[1], 'average_gpa');
      t.rows.forEach(([spec, got]) => assert.close(got,
        mean(h.app.STUDENTS.filter(s => s.specialisation === spec).map(s => s.gpa)), 1e-9, spec));

      const whole = mean(h.app.STUDENTS.map(s => s.gpa));
      const distinct = new Set(t.rows.map(r => Number(r[1]).toFixed(9)));
      assert.ok(distinct.size > 1, 'every group got the same figure');
      assert.ok(t.rows.some(r => Math.abs(r[1] - whole) > 1e-6),
        'no group differs from the cohort average, so this test could not fail');
    });

    test('the first measure cannot be removed, so a breakdown always measures something', () => {
      const h = plain();
      h.w.removeStat(h.sf.id, 0);
      h.w.render();
      assert.equal(h.app.statsOf(h.app.findNode(h.sf.id)).length, 1);
      assert.equal(runTable(h).columns.length, 2);
    });
  });

  /* --------------------------------------------------------------------- share */

  describe('share divides by the rows that came in', () => {
    test('a column split sums to 100', () => {
      const h = plain();
      cfg(h, 'by', 'specialisation');
      cfg(h, 'stat.0.op', 'share');
      const t = runTable(h);
      assert.close(t.rows.reduce((a, r) => a + r[1], 0), 100, 1e-9);
      t.rows.forEach(([spec, pct]) => assert.close(pct,
        100 * h.app.STUDENTS.filter(s => s.specialisation === spec).length
            / h.app.STUDENTS.length, 1e-9, spec));
    });

    test('overlapping groups exceed 100, which is the honest answer', () => {
      /* Every student takes eight courses, so the course groups overlap
         eightfold and the shares must total 800%. Dividing by the sum of the
         groups instead would normalise that away and report 5% where 42% of
         students took a course — a number that is wrong, in range, and
         impossible to spot. */
      const h = plain();
      cfg(h, 'by', 'courses.code');
      cfg(h, 'stat.0.op', 'share');
      const t = runTable(h);
      const per = h.app.COURSES_PER_YEAR;
      assert.close(t.rows.reduce((a, r) => a + r[1], 0), 100 * per, 1e-6,
        'shares must be of the input, not of the sum of the groups');
      t.rows.forEach(([code, pct]) => assert.close(pct,
        100 * h.app.STUDENTS.filter(s => s.courses.some(c => c.code === code)).length
            / h.app.STUDENTS.length, 1e-9, code));
    });
  });

  /* --------------------------------------------------------------- the Labels port */

  describe('the Labels port', () => {
    /* data: one student.  labels: every course in the catalogue.
       Eight of the twenty groups can have a row; the other twelve exist only
       because the labels said so. */
    function withLabels() {
      const h = boot(), A = h.app;
      const dsrc = h.add('source'), take = h.add('take');
      const lsrc = h.add('source'), proj = h.add('project'), uniq = h.add('unique');
      const sf = h.add('selectFor'), out = h.add('output');
      A.connect(dsrc.id, take.id); A.connect(take.id, sf.id, null, 'data');
      A.connect(lsrc.id, proj.id); A.connect(proj.id, uniq.id);
      A.connect(uniq.id, sf.id, null, 'labels');
      A.connect(sf.id, out.id);
      h.w.render();
      h.set(take.id, 'n', '1'); h.w.render();
      h.set(uniq.id, 'col', 'code'); h.w.render();
      h.set(sf.id, 'by', 'courses.code'); h.w.render();
      return Object.assign(h, { sf, out, uniq, take });
    }

    test('a group nothing matches still gets a row, counted as zero', () => {
      const h = withLabels();
      h.w.runQuery();
      const t = h.entry(h.out.id).source;
      const took = h.app.STUDENTS[0].courses.map(c => c.code);
      assert.equal(t.rows.length, h.app.COURSES.length,
        'every label must produce a row');
      assert.equal(t.rows.filter(r => r[1] === 0).length,
        h.app.COURSES.length - took.length,
        'the courses this student did not take must appear, as zeros');
      took.forEach(c => assert.equal(valueUnder(t, 'count', c), 1, c));
    });

    test('and unwiring the labels makes exactly those rows disappear', () => {
      /* The other half of the claim, and the one that makes the first
         falsifiable: without the labels branch the same graph can only report
         the values the data contains. */
      const h = withLabels();
      h.w.runQuery();
      const withCount = h.entry(h.out.id).source.rows.length;
      h.w.removeConnection(h.uniq.id, h.sf.id, 'labels');
      h.w.runQuery();
      const withoutRows = h.entry(h.out.id).source.rows;
      assert.equal(withCount, h.app.COURSES.length);
      assert.equal(withoutRows.length, h.app.STUDENTS[0].courses.length);
      assert.equal(withoutRows.filter(r => r[1] === 0).length, 0,
        'grouping by the data can never produce a zero');
    });

    test('the labels branch\'s own row order is kept', () => {
      /* That order is a decision the user has already made, possibly with a
         Sort on that branch. Re-deriving it here would make the Sort
         invisible. */
      const h = withLabels();
      h.w.runQuery();
      const got = h.entry(h.out.id).source.rows.map(r => r[0]);
      const A = h.app;
      const branch = A.evaluateGraph().res[h.uniq.id].table;
      assert.deepEqual(got, branch.rows.map(r => r[0]));
    });

    test('a Sort on the labels branch reorders the breakdown', () => {
      const h = withLabels();
      const A = h.app;
      const srt = h.add('sort');
      h.w.removeConnection(h.uniq.id, h.sf.id, 'labels');
      A.connect(h.uniq.id, srt.id);
      A.connect(srt.id, h.sf.id, null, 'labels');
      h.w.render();
      h.set(srt.id, 'sort.0.col', 'code'); h.w.render();
      h.set(srt.id, 'sort.0.dir', 'desc'); h.w.render();
      h.w.runQuery();
      const got = h.entry(h.out.id).source.rows.map(r => r[0]);
      assert.deepEqual(got, got.slice().sort().reverse(),
        'the labels branch decides the order and this one was sorted Z to A');
    });

    test('duplicate labels make one group, not two identical ones', () => {
      /* The labels branch here is NOT deduplicated — it is the projected
         enrolment rows, eight per student. */
      const h = boot(), A = h.app;
      const dsrc = h.add('source');
      const lsrc = h.add('source'), proj = h.add('project');
      const sf = h.add('selectFor'), out = h.add('output');
      A.connect(dsrc.id, sf.id, null, 'data');
      A.connect(lsrc.id, proj.id); A.connect(proj.id, sf.id, null, 'labels');
      A.connect(sf.id, out.id);
      h.w.render();
      h.set(sf.id, 'by', 'courses.code'); h.w.render();
      h.set(sf.id, 'labelCol', 'code'); h.w.render();
      h.w.runQuery();
      const t = h.entry(out.id).source;
      assert.equal(t.rows.length, A.COURSES.length);
      const seen = t.rows.map(r => r[0]);
      seen.forEach(c => assert.equal(seen.filter(x => x === c).length, 1, c + ' twice'));
    });

    test('which column supplies the labels can be chosen', () => {
      const h = boot(), A = h.app;
      const dsrc = h.add('source'), lsrc = h.add('source');
      const sf = h.add('selectFor'), out = h.add('output');
      A.connect(dsrc.id, sf.id, null, 'data');
      A.connect(lsrc.id, sf.id, null, 'labels');
      A.connect(sf.id, out.id);
      h.w.render();
      h.set(sf.id, 'by', 'specialisation'); h.w.render();
      assert.includes(h.optionsOf(sf.id, 'labelCol'), 'specialisation');
      h.set(sf.id, 'labelCol', 'specialisation'); h.w.render();
      h.w.runQuery();
      assert.deepEqual(h.entry(out.id).source.rows.map(r => r[0]).slice().sort(),
        A.SPECS.slice().sort());
    });

    test('a nested course list is not offered as a label column', () => {
      // There is no single value in it to name a group with — the same
      // exclusion Sort and Unique make.
      const h = boot(), A = h.app;
      const dsrc = h.add('source'), lsrc = h.add('source'), sf = h.add('selectFor');
      A.connect(dsrc.id, sf.id, null, 'data');
      A.connect(lsrc.id, sf.id, null, 'labels');
      h.w.render();
      assert.excludes(h.optionsOf(sf.id, 'labelCol'), 'courses');
    });

    test('a label the column cannot be matched against is skipped and said so', () => {
      /* Words cannot be compared against a numeric column. Dropping the whole
         query would lose every other group; dropping the label silently would
         be a breakdown quietly missing rows, so it is counted in the log. */
      const h = boot(), A = h.app;
      const dsrc = h.add('source'), lsrc = h.add('source'), uniq = h.add('unique');
      const sf = h.add('selectFor'), out = h.add('output');
      A.connect(dsrc.id, sf.id, null, 'data');
      A.connect(lsrc.id, uniq.id); A.connect(uniq.id, sf.id, null, 'labels');
      A.connect(sf.id, out.id);
      h.w.render();
      h.set(uniq.id, 'col', 'gender'); h.w.render();
      h.set(sf.id, 'by', 'gpa'); h.w.render();
      h.w.runQuery();
      const e = h.entry(out.id);
      assert.equal(e.source.rows.length, 0);
      const log = e.log.join(' | ');
      assert.includes(log, 'SKIP');
      assert.includes(log, 'cannot be matched against');
    });

    test('blank label values are not a group', () => {
      const h = boot(), A = h.app;
      const dsrc = h.add('source'), lsrc = h.add('source'), sf = h.add('selectFor'), out = h.add('output');
      A.connect(dsrc.id, sf.id, null, 'data');
      A.connect(lsrc.id, sf.id, null, 'labels');
      A.connect(sf.id, out.id);
      h.w.render();
      h.set(sf.id, 'by', 'specialisation'); h.w.render();
      h.set(sf.id, 'labelCol', 'specialisation'); h.w.render();
      // Blank one student's specialisation so the labels branch carries an
      // empty cell alongside the real values.
      const keep = A.STUDENTS[0].specialisation;
      A.STUDENTS[0].specialisation = '';
      try {
        h.w.runQuery();
        assert.excludes(h.entry(out.id).source.rows.map(r => String(r[0])), '');
      } finally {
        A.STUDENTS[0].specialisation = keep;
      }
    });
  });

  /* --------------------------------------------------------- the registry invariant */

  describe('the schema walk and the evaluator build one header', () => {
    const CONFIGS = [
      { by: 'year' },
      { by: 'specialisation', op: 'average', col: 'gpa' },
      { by: 'courses.code', op: 'share' },
      { by: 'courses.level', op: 'median', col: 'gpa' },
      { by: 'gender', op: 'max', col: 'gpa' }
    ];

    CONFIGS.forEach(c => {
      test('they agree for ' + c.by + (c.op ? ' / ' + c.op : ''), () => {
        const h = plain();
        cfg(h, 'by', c.by);
        if (c.op)  cfg(h, 'stat.0.op', c.op);
        if (c.col) cfg(h, 'stat.0.col', c.col);
        const produced = runTable(h);
        const declared = h.app.computeSchemas()[h.sf.id];
        assert.deepEqual(
          declared.columns.map(x => [x.key, x.label, x.type]),
          produced.columns.map(x => [x.key, x.label, x.type]),
          'the header the schema pass promises is not the header that came out');
      });
    });

    test('the declared header carries no rows', () => {
      const h = plain();
      cfg(h, 'by', 'year');
      h.w.runQuery();
      assert.equal(h.app.computeSchemas()[h.sf.id].rows.length, 0);
    });

    test('the schema does not depend on the labels branch', () => {
      /* What labels supply is which groups exist, and that is rows. A header
         that changed when a wire was added would be a header the schema pass
         could get wrong on a half-built graph. */
      const h = boot(), A = h.app;
      const dsrc = h.add('source'), lsrc = h.add('source'), sf = h.add('selectFor');
      A.connect(dsrc.id, sf.id, null, 'data');
      h.w.render();
      h.set(sf.id, 'by', 'specialisation'); h.w.render();
      const before = A.computeSchemas()[sf.id].columns.map(c => c.key + '/' + c.label);
      A.connect(lsrc.id, sf.id, null, 'labels');
      h.w.render();
      const after = A.computeSchemas()[sf.id].columns.map(c => c.key + '/' + c.label);
      assert.deepEqual(after, before);
    });

    test('an unwired data port still describes itself', () => {
      const h = boot();
      const sf = h.add('selectFor');
      h.w.render();
      const s = h.app.computeSchemas()[sf.id];
      assert.ok(s.columns.length >= 2, 'a lone node must still have a header');
      assert.equal(s.columns[0].key, 'group');
    });
  });

  /* ------------------------------------------------------------------ downstream */

  describe('what comes out is an ordinary table', () => {
    test('Sort and Take turn a breakdown into a top-N', () => {
      const h = boot(), A = h.app;
      const [src, sf, srt, tk, out] = h.build('source', 'selectFor', 'sort', 'take', 'output');
      h.set(sf.id, 'by', 'courses.code'); h.w.render();
      h.set(srt.id, 'sort.0.col', 'count'); h.w.render();
      h.set(srt.id, 'sort.0.dir', 'desc'); h.w.render();
      h.set(tk.id, 'n', '3'); h.w.render();
      h.w.runQuery();
      const rows = h.entry(out.id).source.rows;
      assert.equal(rows.length, 3);
      const want = A.COURSES
        .map(c => [c.code, A.STUDENTS.filter(s => s.courses.some(x => x.code === c.code)).length])
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(r => r[1]);
      assert.deepEqual(rows.map(r => r[1]), want);
    });

    test('a breakdown can be filtered on its own label column', () => {
      const h = boot(), A = h.app;
      const [src, sf, fil, out] = h.build('source', 'selectFor', 'filter', 'output');
      h.set(sf.id, 'by', 'specialisation'); h.w.render();
      assert.includes(h.optionsOf(fil.id, 'crit.0.field'), 'group',
        'the label column must be filterable downstream');
      h.set(fil.id, 'crit.0.field', 'group'); h.w.render();
      h.set(fil.id, 'crit.0.value:group', A.SPECS[0]); h.w.render();
      h.w.runQuery();
      const rows = h.entry(out.id).source.rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0][0], A.SPECS[0]);
    });

    test('a breakdown can be aggregated, which is what Compare could not do', () => {
      const h = boot(), A = h.app;
      const [src, sf, sel, agg, out] = h.build('source', 'selectFor', 'select', 'aggregate', 'output');
      h.set(sf.id, 'by', 'specialisation'); h.w.render();
      A.findNode(sel.id).cfg.cols = ['count']; h.w.render();
      h.set(agg.id, 'op', 'average'); h.w.render();
      h.w.runQuery();
      const t = h.entry(out.id).source;
      assert.close(t.rows[0][0], A.STUDENTS.length / A.SPECS.length, 1e-9,
        'the average group size');
    });

    test('two breakdowns of the same shape stack in a Combine', () => {
      const h = boot(), A = h.app;
      const a = h.add('source'), b = h.add('source');
      const fa = h.add('filter'), fb = h.add('filter');
      const sa = h.add('selectFor'), sb = h.add('selectFor');
      const cmb = h.add('combine'), out = h.add('output');
      A.connect(a.id, fa.id); A.connect(fa.id, sa.id, null, 'data');
      A.connect(b.id, fb.id); A.connect(fb.id, sb.id, null, 'data');
      A.connect(sa.id, cmb.id); A.connect(sb.id, cmb.id); A.connect(cmb.id, out.id);
      h.w.render();
      h.set(fa.id, 'crit.0.field', 'year'); h.w.render();
      h.set(fa.id, 'crit.0.value:year', String(A.YEARS[0])); h.w.render();
      h.set(fb.id, 'crit.0.field', 'year'); h.w.render();
      h.set(fb.id, 'crit.0.value:year', String(A.YEARS[1])); h.w.render();
      h.set(sa.id, 'by', 'specialisation'); h.w.render();
      h.set(sb.id, 'by', 'specialisation'); h.w.render();
      h.w.runQuery();
      const t = h.entry(out.id).source;
      assert.equal(t.rows.length, A.SPECS.length * 2,
        'two breakdowns with matching headers must stack, not be refused');
      assert.equal(t.rows.reduce((acc, r) => acc + r[1], 0), A.STUDENTS.length);
    });

    test('the per-group tables ride along, in the shape the Output already reads', () => {
      const h = plain();
      cfg(h, 'by', 'year');
      const t = runTable(h);
      assert.ok(t.meta.branches, 'no branch metadata');
      assert.equal(t.meta.branches.length, t.rows.length);
      t.meta.branches.forEach(b => {
        assert.ok(b.label !== undefined && b.table, 'a branch needs a label and a table');
        assert.equal(b.table.rows.length,
          h.app.STUDENTS.filter(s => String(s.year) === String(b.label)).length);
      });
    });

    test('the Output offers the per-group view, or the metadata is unreachable', () => {
      /* The gap this node shipped with for an afternoon. meta.branches was
         emitted correctly and the renderer read it correctly, but the Output
         panel decided which two views to offer by asking "is a Compare wired
         in", so the view that shows the per-group detail could never be
         chosen. Branch metadata nothing can display is not a feature. */
      const h = plain();
      cfg(h, 'by', 'year');
      assert.deepEqual(h.optionsOf(h.out.id, 'show'), ['summary', 'lists']);
    });

    test('a fresh Output shows the breakdown, not a table per group', () => {
      /* Compare and SelectFor want different defaults out of the same word.
         "Show me the data" behind two hand-wired branches means their rows;
         behind a breakdown of eighty groups it means the breakdown, and
         defaulting the other way rendered most of a megabyte of markup to
         draw eighty tables nobody asked for. */
      const h = plain();
      cfg(h, 'by', 'courses.code');
      assert.equal(h.app.normaliseShow(h.app.findNode(h.out.id)), 'summary');
    });

    test('a fresh Output behind a Compare still shows its branches', () => {
      const h = boot(), A = h.app;
      const a = h.add('source'), b = h.add('source'), cmp = h.add('compare'), out = h.add('output');
      A.connect(a.id, cmp.id); A.connect(b.id, cmp.id); A.connect(cmp.id, out.id);
      h.w.render();
      assert.equal(A.normaliseShow(A.findNode(out.id)), 'lists');
    });

    test('the per-group cards are capped, and the export is not', () => {
      /* The same decision the row cap inside each table already makes, one
         level up. What is capped is the drawing; Copy and Save still write
         every group, which is where an answer that long belongs. */
      const h = plain();
      cfg(h, 'by', 'courses.code');
      h.set(h.out.id, 'show', 'lists'); h.w.render();
      h.w.runQuery();
      const groups = h.entry(h.out.id).source.rows.length;
      assert.ok(groups > h.app.DISPLAY_CARD_LIMIT,
        'this dataset no longer has enough groups for the cap to bind');
      assert.equal(h.qa('.cmp-branch-card').length, h.app.DISPLAY_CARD_LIMIT);
      assert.includes(h.text('.cmp-more-cards'),
        String(groups - h.app.DISPLAY_CARD_LIMIT) + ' more');

      const csv = h.app.serialiseTable(h.app.exportTableFor(h.entry(h.out.id)), ',', true);
      assert.equal(csv.trim().split('\n').length - 1,
        h.app.STUDENTS.length * h.app.COURSES_PER_YEAR,
        'every group\'s rows must still be exported');
    });

    test('an Output not fed by a breakdown still offers rows and count', () => {
      const h = boot();
      const [src, out] = h.build('source', 'output');
      assert.deepEqual(h.optionsOf(out.id, 'show'), ['rows', 'count']);
    });

    test('the per-group cards are headed as a breakdown, not as a comparison', () => {
      const h = plain();
      cfg(h, 'by', 'year');
      h.set(h.out.id, 'show', 'lists');
      h.w.runQuery();
      const panel = h.panel();
      assert.includes(panel, 'Breakdown');
      assert.excludes(panel, 'Comparison');
    });

    test('Compare keeps the wording it always had', () => {
      // The heading is read from meta now; a node that emits none must be
      // unaffected by that.
      const h = boot(), A = h.app;
      const a = h.add('source'), b = h.add('source'), cmp = h.add('compare'), out = h.add('output');
      A.connect(a.id, cmp.id); A.connect(b.id, cmp.id); A.connect(cmp.id, out.id);
      h.w.render();
      h.set(out.id, 'show', 'lists'); h.w.render();
      h.w.runQuery();
      assert.includes(h.panel(), 'Comparison');
    });

    test('with per-group detail it exports long, one row per group row', () => {
      const h = plain();
      cfg(h, 'by', 'year');
      h.set(h.out.id, 'show', 'lists');
      h.w.runQuery();
      const csv = h.app.serialiseTable(h.app.exportTableFor(h.entry(h.out.id)), ',', true);
      const lines = csv.trim().split('\n');
      assert.equal(lines.length - 1, h.app.STUDENTS.length,
        'the long export is every row of every group');
    });
  });

  /* ---------------------------------------------------------------- the panel */

  describe('the panel', () => {
    test('it offers a grouping field and one measure to begin with', () => {
      const h = plain();
      assert.ok(h.control(h.sf.id, 'by'), 'no grouping control');
      assert.ok(h.control(h.sf.id, 'stat.0.op'), 'no measure control');
    });

    test('the column picker appears only for measures that take a column', () => {
      const h = plain();
      assert.notOk(h.control(h.sf.id, 'stat.0.col'), 'Count does not measure a column');
      cfg(h, 'stat.0.op', 'average');
      assert.ok(h.control(h.sf.id, 'stat.0.col'), 'Average does');
      cfg(h, 'stat.0.op', 'share');
      assert.notOk(h.control(h.sf.id, 'stat.0.col'), 'Share does not');
    });

    test('measures can be added and removed', () => {
      const h = plain();
      h.w.addStat(h.sf.id); h.w.render();
      assert.ok(h.control(h.sf.id, 'stat.1.op'));
      h.w.removeStat(h.sf.id, 1); h.w.render();
      assert.notOk(h.control(h.sf.id, 'stat.1.op'));
    });

    test('the panel says where the groups are coming from, because a wire decides it', () => {
      const h = plain();
      const text = () => h.qa('.node-config').map(e => e.textContent).join(' ');
      assert.includes(text(), 'values found in the data');
      const lsrc = h.add('source');
      h.app.connect(lsrc.id, h.sf.id, null, 'labels');
      h.w.render();
      assert.includes(text(), 'Groups from the Labels branch');
      assert.excludes(text(), 'values found in the data');
    });

    test('it states the header that will come out', () => {
      const h = plain();
      cfg(h, 'by', 'year');
      cfg(h, 'stat.0.op', 'average');
      const text = h.qa('.node-config').map(e => e.textContent).join(' ');
      assert.includes(text, 'Average GPA');
    });

    test('config lives in the model, so typing does not depend on the DOM surviving', () => {
      const h = plain();
      cfg(h, 'by', 'gender');
      h.w.render(); h.w.render();
      assert.equal(h.app.findNode(h.sf.id).cfg.by, 'gender');
      assert.equal(h.control(h.sf.id, 'by').value, 'gender');
    });
  });

  /* ------------------------------------------------------------------ save/load */

  describe('a saved query comes back', () => {
    function built() {
      const h = boot(), A = h.app;
      const dsrc = h.add('source'), lsrc = h.add('source'), proj = h.add('project'), uniq = h.add('unique');
      const sf = h.add('selectFor'), out = h.add('output');
      A.connect(dsrc.id, sf.id, null, 'data');
      A.connect(lsrc.id, proj.id); A.connect(proj.id, uniq.id);
      A.connect(uniq.id, sf.id, null, 'labels');
      A.connect(sf.id, out.id);
      h.w.render();
      h.set(uniq.id, 'col', 'code'); h.w.render();
      h.set(sf.id, 'by', 'courses.code'); h.w.render();
      h.w.addStat(sf.id); h.w.render();
      h.set(sf.id, 'stat.1.op', 'share'); h.w.render();
      return Object.assign(h, { sf, out });
    }

    test('the file names the port each wire lands on', () => {
      const h = built();
      const g = h.app.serialiseGraph();
      const into = g.connections.filter(c => c.to === h.sf.id).map(c => c.port).sort();
      assert.deepEqual(into, ['data', 'labels']);
    });

    test('the answer is identical after a reload', () => {
      const a = built();
      a.w.runQuery();
      const before = a.app.serialiseTable(a.app.exportTableFor(a.entry(a.out.id)), ',', true);
      const json = JSON.stringify(a.app.serialiseGraph());

      const b = boot();
      b.app.loadGraphFromText(json, b.doc.createElement('button'));
      b.w.runQuery();
      const out = b.app.nodes.find(n => n.type === 'output');
      const after = b.app.serialiseTable(b.app.exportTableFor(b.entry(out.id)), ',', true);
      assert.equal(after, before);
    });

    test('the measures survive as measures, not as Compare\'s strings', () => {
      /* The reason this node's key is `stats` and not `measures`: mergeCfg
         resets anything under `measures` that is not an array to Compare's
         array of strings, and these are objects. */
      const a = built();
      const json = JSON.stringify(a.app.serialiseGraph());
      const b = boot();
      b.app.loadGraphFromText(json, b.doc.createElement('button'));
      const sf = b.app.nodes.find(n => n.type === 'selectFor');
      assert.deepEqual(sf.cfg.stats, [{ op: 'count', col: '' }, { op: 'share', col: '' }]);
    });

    test('a file supplying the wrong shape is repaired rather than trusted', () => {
      const b = boot();
      const json = JSON.stringify({
        kind: 'student-data-analyser-query', version: 3,
        nodes: [
          { id: 1, type: 'source', x: 100, y: 100, cfg: { pop: 'all', dataset: { headers: '', years: [] } } },
          { id: 2, type: 'selectFor', x: 300, y: 100,
            cfg: { by: { evil: 1 }, labelCol: ['x'], stats: 'count' } },
          { id: 3, type: 'output', x: 500, y: 100, cfg: { show: 'rows' } }
        ],
        connections: [{ from: 1, to: 2, port: 'data' }, { from: 2, to: 3, port: 'in' }]
      });
      b.app.loadGraphFromText(json, b.doc.createElement('button'));
      const sf = b.app.nodes.find(n => n.type === 'selectFor');
      assert.equal(typeof sf.cfg.by, 'string');
      assert.equal(typeof sf.cfg.labelCol, 'string');
      assert.deepEqual(sf.cfg.stats, [{ op: 'count', col: '' }]);
      b.w.runQuery();
      const out = b.app.nodes.find(n => n.type === 'output');
      assert.ok(b.entry(out.id).source.rows.length > 0, 'a repaired query must still run');
    });

    test('an array of junk measures becomes an array of usable ones', () => {
      const b = boot();
      const json = JSON.stringify({
        kind: 'student-data-analyser-query', version: 3,
        nodes: [
          { id: 1, type: 'source', x: 100, y: 100, cfg: { pop: 'all', dataset: { headers: '', years: [] } } },
          { id: 2, type: 'selectFor', x: 300, y: 100, cfg: { stats: [1, null, { op: 0 }] } },
          { id: 3, type: 'output', x: 500, y: 100, cfg: { show: 'rows' } }
        ],
        connections: [{ from: 1, to: 2, port: 'data' }, { from: 2, to: 3, port: 'in' }]
      });
      b.app.loadGraphFromText(json, b.doc.createElement('button'));
      const sf = b.app.nodes.find(n => n.type === 'selectFor');
      assert.equal(sf.cfg.stats.length, 3);
      sf.cfg.stats.forEach(s => assert.deepEqual(s, { op: 'count', col: '' }));
    });

    test('a wire that names no port lands on the data, not the labels', () => {
      // Which is what a file written before this node had two ports would mean.
      const b = boot();
      const json = JSON.stringify({
        kind: 'student-data-analyser-query', version: 1,
        nodes: [
          { id: 1, type: 'source', x: 100, y: 100, cfg: { pop: 'all', dataset: { headers: '', years: [] } } },
          { id: 2, type: 'selectFor', x: 300, y: 100, cfg: { by: 'year' } },
          { id: 3, type: 'output', x: 500, y: 100, cfg: { show: 'rows' } }
        ],
        connections: [{ from: 1, to: 2 }, { from: 2, to: 3 }]
      });
      b.app.loadGraphFromText(json, b.doc.createElement('button'));
      const sf = b.app.nodes.find(n => n.type === 'selectFor');
      assert.deepEqual(b.app.inputsOf(sf.id, 'data').length, 1);
      assert.deepEqual(b.app.inputsOf(sf.id, 'labels').length, 0);
      b.w.runQuery();
      const out = b.app.nodes.find(n => n.type === 'output');
      assert.equal(b.entry(out.id).source.rows.length, b.app.YEARS.length);
    });
  });

  /* ------------------------------------------------- against the real archive */

  /* Everything above runs on the synthetic dataset, where every student takes
     every kind of course and no group is ever empty. That is the wrong data to
     demonstrate this node's whole reason for existing on, so the claim is made
     once more against ../data, where a real cohort really does leave courses
     untaken.

     Returns early when ../data is absent, the same way 19 and 22 do, so a
     checkout carrying no student records is still runnable. */

  if (!hasDataDir()) {
    describe('against the real archive', () => {
      test('skipped: ../data is not present', () => assert.ok(true));
    });
  } else {
    describe('against the real archive', () => {
      /* One Source, two branches off it. The rows are the BCA students of
         2024; the groups are every course that ran in 2022. That is the shape
         of the question the archive was built to answer — what happened to
         the 2022 catalogue — and it cannot be asked of one table, because no
         one table holds both years' roles at once. */
      async function migration() {
        const h = boot(), A = h.app;
        const src = h.add('source');
        const ds = await h.loadArchive(src.id, [2022, 2024]);
        h.w.render();

        const year = h.add('filter'), deg = h.add('filter');
        const lyear = h.add('filter'), proj = h.add('project'), uniq = h.add('unique');
        const sf = h.add('selectFor'), out = h.add('output');
        A.connect(src.id, year.id); A.connect(year.id, deg.id);
        A.connect(deg.id, sf.id, null, 'data');
        A.connect(src.id, lyear.id); A.connect(lyear.id, proj.id); A.connect(proj.id, uniq.id);
        A.connect(uniq.id, sf.id, null, 'labels');
        A.connect(sf.id, out.id);
        h.w.render();

        h.set(year.id, 'crit.0.field', 'year'); h.w.render();
        h.set(year.id, 'crit.0.value:year', '2024'); h.w.render();
        h.set(deg.id, 'crit.0.field', 'degree'); h.w.render();
        h.set(deg.id, 'crit.0.value:degree', 'BCA'); h.w.render();
        h.set(lyear.id, 'crit.0.field', 'year'); h.w.render();
        h.set(lyear.id, 'crit.0.value:year', '2022'); h.w.render();
        h.set(uniq.id, 'col', 'code'); h.w.render();
        h.set(sf.id, 'by', 'courses.code'); h.w.render();
        return Object.assign(h, { src, sf, out, uniq, ds });
      }

      test('every 2022 course is reported against 2024, including the untaken ones', async () => {
        const h = await migration();
        h.w.runQuery();
        const t = h.entry(h.out.id).source;

        // The two facts, read off the archive rather than off another run.
        const ds = h.ds;
        const codes22 = new Set(ds.students.filter(s => s.year === 2022)
          .flatMap(s => s.courses.map(c => c.code)));
        const bca24 = ds.students.filter(s => s.year === 2024 && s.degree === 'BCA');
        const taken = new Set(bca24.flatMap(s => s.courses.map(c => c.code)));

        assert.equal(t.rows.length, codes22.size,
          'one row per course in the 2022 catalogue');
        const zeros = t.rows.filter(r => r[1] === 0).map(r => r[0]);
        assert.deepEqual(zeros.slice().sort(),
          [...codes22].filter(c => !taken.has(c)).sort(),
          'the zero rows must be exactly the 2022 courses no BCA student took in 2024');
        assert.ok(zeros.length > 0,
          'the archive no longer carries an untaken course, so this test cannot fail');

        t.rows.filter(r => r[1] > 0).forEach(([code, n]) => assert.equal(
          n, bca24.filter(s => s.courses.some(c => c.code === code)).length, code));
      });

      test('and those rows exist only because the labels branch is wired', async () => {
        const h = await migration();
        h.w.runQuery();
        const before = h.entry(h.out.id).source.rows.length;
        h.w.removeConnection(h.uniq.id, h.sf.id, 'labels');
        h.w.runQuery();
        const after = h.entry(h.out.id).source;
        assert.ok(after.rows.length < before,
          'dropping the labels must lose the untaken courses');
        assert.equal(after.rows.filter(r => r[1] === 0).length, 0);
      });

      test('a breakdown by degree accounts for the whole cohort of a year', async () => {
        const h = boot(), A = h.app;
        const src = h.add('source');
        const ds = (await h.loadArchive(src.id, [2024])).students;
        h.w.render();
        const sf = h.add('selectFor'), out = h.add('output');
        A.connect(src.id, sf.id, null, 'data'); A.connect(sf.id, out.id);
        h.w.render();
        h.set(sf.id, 'by', 'degree'); h.w.render();
        h.w.runQuery();
        const t = h.entry(out.id).source;
        const want = {};
        ds.forEach(s => { want[s.degree] = (want[s.degree] || 0) + 1; });
        assert.deepEqual(t.rows.map(r => r[0]).slice().sort(), Object.keys(want).sort());
        t.rows.forEach(([d, n]) => assert.equal(n, want[d], d));
        assert.equal(t.rows.reduce((a, r) => a + r[1], 0), ds.length);
      });

      test('grouping by level needs no Project, and the levels are the real ones', async () => {
        const h = boot(), A = h.app;
        const src = h.add('source');
        const ds = (await h.loadArchive(src.id, [2024])).students;
        h.w.render();
        const sf = h.add('selectFor'), out = h.add('output');
        A.connect(src.id, sf.id, null, 'data'); A.connect(sf.id, out.id);
        h.w.render();
        h.set(sf.id, 'by', 'courses.level'); h.w.render();
        h.w.runQuery();
        const t = h.entry(out.id).source;
        const levels = [...new Set(ds.flatMap(s => s.courses.map(c => c.level)))].sort();
        assert.deepEqual(t.rows.map(r => Number(r[0])), levels);
        // Whole students, counted once each however many papers at that level.
        t.rows.forEach(([lvl, n]) => assert.equal(
          n, ds.filter(s => s.courses.some(c => c.level === Number(lvl))).length, 'level ' + lvl));
      });
    });
  }
};
