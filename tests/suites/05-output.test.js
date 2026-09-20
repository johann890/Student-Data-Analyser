/* Output nodes.
   The governing requirement is that every Output emits a table (a count is a
   1x1 table), so one renderer and one exporter serve all of them.

   The Output's own Average and Course-breakdown shortcuts were removed: both
   made the same operation exist in two places, and the breakdown hid two of the
   three steps it actually performed (app.js:1790). Averaging is now an Aggregate
   wired in front, so the tests that covered the shortcuts test the node. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  // Catalogue-driven, for the reasons given in 03-filter.
  const A = boot().app;
  const CORE_SUBJECTS = new Set(A.CORE_COURSES.map(c => A.COURSE_BY_CODE[c].subject));
  const SUBJ = A.SUBJECTS.find(x => !CORE_SUBJECTS.has(x));

  function rig(show) {
    const h = boot();
    const [s, f, o] = h.build('source', 'filter', 'output');
    if (show) h.set(o.id, 'show', show);
    return { ...h, s, f, o };
  }

  describe('every output is a table', () => {
    test('count is a 1x1 table', () => {
      const r = rig('count');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(t.columns.length, 1);
      assert.equal(t.rows.length, 1);
      assert.equal(t.columns[0].label, 'Count');
      assert.equal(t.rows[0][0], r.app.STUDENTS.filter(x => x.gpa > 5).length);
    });

    test('count exports exactly as the two-line CSV that was asked for', () => {
      const r = rig('count');
      r.w.runQuery();
      const csv = r.app.serialiseTable(r.entry(r.o.id).table, ',', true);
      const lines = csv.split('\n');
      assert.equal(lines.length, 2);
      assert.equal(lines[0], 'Count');
      assert.ok(/^\d+$/.test(lines[1]), 'second line should be the bare number');
    });

    test('an Aggregate average is a 1x1 table that says what it measured', () => {
      const h = boot();
      const [s, f, a, o] = h.build('source', 'filter', 'aggregate', 'output');
      h.set(a.id, 'op', 'average');
      h.set(a.id, 'col', 'gpa');
      h.w.runQuery();
      const t = h.entry(o.id).table;
      assert.equal(t.columns.length, 1);
      assert.equal(t.rows.length, 1);
      const want = h.app.STUDENTS.filter(x => x.gpa > 70);
      assert.close(t.rows[0][0], want.reduce((a2, x) => a2 + x.gpa, 0) / want.length, 1e-9);
      // point 11: a count and an average must not look alike
      assert.includes(t.columns[0].label, 'Average');
      assert.includes(t.columns[0].label, 'GPA', 'and must name the column it reduced');
    });

    test('rows passes the incoming table through unchanged', () => {
      const r = rig('rows');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(t.rows.length, r.app.STUDENTS.filter(x => x.gpa > 5).length);
      assert.ok(r.app.hasCol(t, 'specialisation'));
    });
  });

  describe('every output copies and saves as a table', () => {
    // The requirement is that a scalar is a 1x1 table, not a bare number, so
    // that one serialiser covers every result shape.
    test('Copy on a count yields a header and a value, not just the number', () => {
      const r = rig('count');
      r.w.runQuery();
      r.w.copyOutput(r.o.id, r.doc.createElement('button'));
      const lines = r.copied[r.copied.length - 1].split('\n');
      assert.equal(lines.length, 2);
      assert.equal(lines[0], 'Count');
      assert.ok(/^\d+$/.test(lines[1]));
    });

    test('Copy on an Aggregate average carries its label', () => {
      const h = boot();
      const [s, f, a, o] = h.build('source', 'filter', 'aggregate', 'output');
      h.set(a.id, 'op', 'average');
      h.w.runQuery();
      h.w.copyOutput(o.id, h.doc.createElement('button'));
      const lines = h.copied[h.copied.length - 1].split('\n');
      assert.equal(lines.length, 2);
      assert.includes(lines[0], 'Average');
    });

    test('Save on every show type writes a CSV with a header row', () => {
      ['count', 'rows'].forEach(show => {
        const r = rig(show);
        r.w.runQuery();
        r.w.saveOutput(r.o.id, r.doc.createElement('button'));
        const f = r.saved[r.saved.length - 1];
        assert.ok(/\.csv$/.test(f.name), show + ' should save as CSV');
        const lines = f.content.split('\n');
        assert.ok(lines.length >= 2, show + ' should have a header and at least one row');
        assert.ok(lines[0].length > 0, show + ' has an empty header');
      });
    });

    test('the scalar display is a presentation of the same table', () => {
      const r = rig('count');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(r.text('.result-head'), t.columns[0].label);
      assert.equal(r.bigNum(), String(t.rows[0][0]));
    });

    test('an Output with no data path offers no export controls at all', () => {
      const h = boot();
      const [s, o1] = h.build('source', 'output');
      h.w.addNode('output'); const o2 = h.app.nodes[h.app.nodes.length - 1];
      h.w.render(); h.w.runQuery();
      assert.notOk(h.exportNameField(o2.id), 'nothing to name when there is nothing to export');
      assert.equal(h.qa('.result-actions').length, 1);
    });
  });

  describe('scalar display', () => {
    test('a scalar still renders as a headline number', () => {
      const r = rig('count');
      r.w.runQuery();
      assert.ok(r.q('.big-num'), 'expected the large display');
    });

    test('an Aggregate result gets the headline too, not a one-cell table', () => {
      /* The rule is the shape of the result, not which control produced it.
         Removing the Output shortcuts told people to move the calculation onto
         the canvas; rendering the answer smaller for having done so would have
         punished them for it. */
      const h = boot();
      const [s, a, o] = h.build('source', 'aggregate', 'output');
      h.set(a.id, 'op', 'average');
      h.w.runQuery();
      assert.ok(h.q('.big-num'), 'a 1x1 table should render as a headline number');
      assert.includes(h.text('.result-head'), 'Average', 'and must say what it is');
    });

    test('a 2-row result is a table, not a headline', () => {
      const h = boot();
      const [s, t, o] = h.build('source', 'take', 'output');
      h.set(t.id, 'n', '2');
      h.w.runQuery();
      assert.equal(h.q('.big-num'), null, 'two rows is not a scalar');
      assert.ok(h.q('.rtable'), 'it should render as a table');
    });

    test('the mean of zero rows shows a dash, not zero', () => {
      const h = boot();
      const [s, f, a, o] = h.build('source', 'filter', 'aggregate', 'output');
      h.set(f.id, 'crit.0.value:gpa', '500');   // matches nobody
      h.set(a.id, 'op', 'average');
      h.w.runQuery();
      assert.equal(h.bigNum(), '\u2014', 'showing 0 would assert something false about the data');
    });

    test('count of zero rows really is zero', () => {
      const r = rig('count');
      r.set(r.f.id, 'crit.0.value:gpa', '500');
      r.w.runQuery();
      assert.equal(r.bigNum(), '0');
    });

    test('the measured column is configurable, not hardwired', () => {
      const h = boot();
      const [s, a, o] = h.build('source', 'aggregate', 'output');
      h.set(a.id, 'op', 'max');
      h.set(a.id, 'col', 'gpa');
      h.w.runQuery();
      const want = Math.max(...h.app.STUDENTS.map(x => x.gpa));
      assert.equal(h.entry(o.id).table.rows[0][0], want);
    });
  });

  /* 'course breakdown' (5 tests) went with the Output's breakdown shortcut in
     52d5e6a. The same answer is now built on the canvas (filter, then group,
     then aggregate) where each step appears in the query log. The per-course
     aggregation itself is covered in 02-table-model's note. */

  describe('show-type normalisation', () => {
    test('an unknown stored value falls back rather than breaking', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.app.setCfg(o.id, 'show', 'nonsense');
      assert.includes(['count', 'rows'], h.app.normaliseShow(o));
    });

    test('compare-only values map back to row values when no Compare feeds it', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.app.setCfg(o.id, 'show', 'lists');
      assert.equal(h.app.normaliseShow(o), 'rows');
    });

    test('the retired "courses" value falls back rather than breaking a saved query', () => {
      // Files written before 52d5e6a can still name it.
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.app.setCfg(o.id, 'show', 'courses');
      assert.includes(['count', 'rows'], h.app.normaliseShow(o));
    });
  });

  describe('multiple outputs', () => {
    test('two Outputs on one Filter render independently', () => {
      const h = boot();
      const [s, f] = h.build('source', 'filter');
      h.w.addNode('output'); const o1 = h.app.nodes[h.app.nodes.length - 1];
      h.w.addNode('output'); const o2 = h.app.nodes[h.app.nodes.length - 1];
      h.app.connect(f.id, o1.id); h.app.connect(f.id, o2.id);
      h.w.render();
      h.set(o1.id, 'show', 'count');
      h.set(o2.id, 'show', 'rows');
      h.w.runQuery();
      assert.equal(h.qa('.result-block').length, 2);
      assert.equal(h.entry(o1.id).table.columns[0].label, 'Count');
      assert.equal(h.entry(o1.id).table.rows.length, 1);
      assert.ok(h.entry(o2.id).table.rows.length > 1, 'the other still shows rows');
    });

    test('an Output with no path to a Source says so and offers no exports', () => {
      const h = boot();
      const [s, o1] = h.build('source', 'output');
      h.w.addNode('output'); const o2 = h.app.nodes[h.app.nodes.length - 1];
      h.w.render();
      h.w.runQuery();
      assert.equal(h.qa('.result-block').length, 2);
      assert.includes(h.panel(), 'Not connected to a Source');
      assert.equal(h.entry(o2.id), undefined, 'nothing should be exportable');
    });
  });

  describe('display limits', () => {
    test('a long table truncates on screen but records every row for export', () => {
      const r = rig('rows');
      r.set(r.f.id, 'crit.0.value:gpa', '0');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(t.rows.length, r.app.STUDENTS.length, 'export keeps everything');
      assert.ok(r.qa('.rtable tbody tr').length < t.rows.length + 1, 'screen should truncate');
      assert.includes(r.panel(), 'more');
    });
  });
};
