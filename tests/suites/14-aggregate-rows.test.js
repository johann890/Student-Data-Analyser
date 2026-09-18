/* AggregateRows.
   The third member of the aggregation family, and the one that runs across the
   page rather than down it:

     AggregateColumns   N rows x M cols  ->  1 row  x M cols
     AggregateRows      N rows x M cols  ->  N rows x 1 col

   It replaces the whole row rather than adding to it. The settled position is
   that row aggregation assumes a row of measures — totalling a row that still
   carries a student id is not a meaningful operation — so narrowing to the
   measures first is a Select, and neither node grows a column picker for the
   other's benefit. */

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
  const values = t => t.rows.map(r => r[0]);

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
    test('one column out, one row per row in', () => {
      const r = rig('sum');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(t.columns.length, 1);
      assert.equal(t.rows.length, A.STUDENTS.length);
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
      assert.equal(byRow.columns.length, 1);
      assert.equal(byCol.rows.length, 1);
      // One column per column that came in — asserted against the schema, so a
      // column added to the Source does not look like a regression here.
      assert.equal(byCol.columns.length, A.STUDENT_COLUMNS.length);
    });

    test('the column names the measure', () => {
      A.AGG_OPS.forEach(op => {
        const r = rig(op.key);
        r.w.runQuery();
        const c = r.entry(r.o.id).table.columns[0];
        assert.equal(c.key, op.key);
        assert.equal(c.label, op.label);
        assert.equal(c.type, A.COLTYPE.NUMBER);
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

    test('the header depends on the measure alone, not on what arrives', () => {
      // Which is why the schema walk can answer without looking upstream
      const wide = rig('sum');
      const narrow = rig('sum', ['select']);
      narrow.set(narrow.mid[0].id, 'column:gpa', false);
      assert.deepEqual(
        wide.app.computeSchemas()[wide.n.id].columns.map(c => c.key),
        narrow.app.computeSchemas()[narrow.n.id].columns.map(c => c.key));
    });
  });

  describe('the values, against the raw data', () => {
    test('sum across a student row is their gpa alone', () => {
      /* Of the seven student columns only gpa is a measure: id is an
         identifier, gender/year/specialisation/letterGrade are not numbers, and
         courses is nested. So the row total is that one figure — which is the
         warning the panel gives by naming how many columns contribute. */
      const r = rig('sum');
      r.w.runQuery();
      assert.deepEqual(values(r.entry(r.o.id).table), A.STUDENTS.map(s => s.gpa));
    });

    test('count counts every column, because any column can answer it', () => {
      const r = rig('count');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      const width = A.STUDENT_COLUMNS.length;
      assert.deepEqual(values(t), A.STUDENTS.map(() => width),
        'every column, none blank');
    });

    test('min, max and average of a single-measure row are that measure', () => {
      ['min', 'max', 'average', 'median'].forEach(op => {
        const r = rig(op);
        r.w.runQuery();
        assert.deepEqual(values(r.entry(r.o.id).table), A.STUDENTS.map(s => s.gpa), op);
      });
    });

    test('with two measures on the row, the arithmetic is real', () => {
      /* A Compare summary carries two measures per row — a count and an
         average — plus a branch label that must be left out of the sum. */
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
      assert.deepEqual(values(h.entry(o.id).table), want);
    });

    test('a row with nothing measurable gives null, not zero', () => {
      const r = rig('sum', ['select']);
      ['id', 'gender', 'year', 'specialisation', 'gpa', 'courses']
        .forEach(k => r.set(r.mid[0].id, 'column:' + k, false));   // letterGrade only
      r.w.runQuery();
      assert.notOk(r.q('.error-box'), r.text('.error-box'));
      const t = r.entry(r.o.id).table;
      assert.equal(t.rows.length, A.STUDENTS.length, 'the rows are still there');
      assert.deepEqual(values(t), A.STUDENTS.map(() => null), 'there was nothing to sum');
    });

    test('an empty table gives an empty result, not an error', () => {
      const h = boot();
      const [s, f, ar, o] = h.build('source', 'filter', 'aggregateRows', 'output');
      h.set(f.id, 'crit.0.value:gpa', '500');
      h.w.runQuery();
      assert.notOk(h.q('.error-box'));
      assert.equal(h.entry(o.id).table.rows.length, 0);
      assert.equal(h.entry(o.id).table.columns.length, 1, 'the column is still declared');
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

    test('an identifier is still excluded from the arithmetic', () => {
      const r = rig('sum', ['select']);
      ['gender', 'year', 'degree', 'specialisation', 'letterGrade', 'courses']
        .forEach(k => r.set(r.mid[0].id, 'column:' + k, false));   // id + gpa
      r.w.runQuery();
      assert.deepEqual(values(r.entry(r.o.id).table), A.STUDENTS.map(s => s.gpa),
        'the id must not be added in');
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

    test('a one-row result reaches the headline display', () => {
      const h = boot();
      const [s, t, ar, o] = h.build('source', 'take', 'aggregateRows', 'output');
      h.set(t.id, 'n', '1');
      h.w.runQuery();
      assert.ok(h.q('.big-num'));
      assert.includes(h.text('.result-head'), 'Sum');
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

    test('the hint follows the header, not a guess', () => {
      const r = rig('sum', ['select']);
      r.set(r.mid[0].id, 'column:courses', false);
      const hint = r.qa('[data-node="' + r.n.id + '"]')[0]
        .closest('.node-config').textContent;
      assert.includes(hint, 'of ' + (A.STUDENT_COLUMNS.length - 1));
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
