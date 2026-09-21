/* The aggregation nodes.
   Two nodes, one implementation: Aggregate reduces a whole table to a single
   value, AggregateColumns reduces each column to one value on a single row.
   Neither had a suite before. These tests were written alongside the addition
   of Median, and cover the operation set as a whole rather than that one op.

   Following the convention of the other suites: every expected value is
   computed directly from STUDENTS, never from the tool's own answer. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const A = boot().app;
  const AVGS = A.STUDENTS.map(s => s.gpa);

  const mean   = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const median = xs => {
    const v = xs.slice().sort((a, b) => a - b), m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };

  // Source -> Aggregate -> Output, with the measure and column set
  function agg(op, col) {
    const h = boot();
    const [s, a, o] = h.build('source', 'aggregate', 'output');
    h.set(a.id, 'op', op);
    if (col && h.control(a.id, 'col')) h.set(a.id, 'col', col);
    h.w.runQuery();
    return { ...h, s, a, o, table: h.entry(o.id).table };
  }

  describe('the operation set', () => {
    test('every declared op has a key, a label and a verb', () => {
      A.AGG_OPS.forEach(o => {
        assert.ok(o.key, 'missing key');
        assert.ok(o.label, o.key + ' has no label');
        assert.ok(o.verb, o.key + ' has no verb');
        assert.equal(typeof o.needsCol, 'boolean', o.key + ' must declare needsCol');
      });
    });

    test('the set is the one that was settled on', () => {
      assert.deepEqual(A.AGG_OPS.map(o => o.key),
        ['count', 'sum', 'average', 'median', 'min', 'max']);
    });

    test('only Count works without a column', () => {
      A.AGG_OPS.forEach(o =>
        assert.equal(o.needsCol, o.key !== 'count', o.key));
    });

    test('every op is offered in the panel', () => {
      const h = boot();
      const [s, a, o] = h.build('source', 'aggregate', 'output');
      assert.deepEqual(h.optionsOf(a.id, 'op'), A.AGG_OPS.map(x => x.key));
    });
  });

  describe('reduceValues, against the raw data', () => {
    test('count counts rows, not values', () => {
      assert.equal(A.reduceValues('count', AVGS), AVGS.length);
    });

    test('sum, average, min and max agree with the dataset', () => {
      assert.equal(A.reduceValues('sum', AVGS), AVGS.reduce((a, b) => a + b, 0));
      assert.close(A.reduceValues('average', AVGS), mean(AVGS), 1e-9);
      assert.equal(A.reduceValues('min', AVGS), Math.min(...AVGS));
      assert.equal(A.reduceValues('max', AVGS), Math.max(...AVGS));
    });

    test('median agrees with the dataset', () => {
      assert.close(A.reduceValues('median', AVGS), median(AVGS), 1e-9);
    });

    test('an odd count takes the middle value', () => {
      assert.equal(A.reduceValues('median', [5, 1, 3]), 3);
      assert.equal(A.reduceValues('median', [9, 1, 2, 3, 4]), 3);
    });

    test('an even count averages the two middle values', () => {
      // Picking either alone would claim one is more central than its neighbour
      assert.equal(A.reduceValues('median', [1, 2, 3, 4]), 2.5);
      assert.equal(A.reduceValues('median', [10, 20]), 15);
    });

    test('it sorts numerically, not lexically', () => {
      /* The trap this guards: the default sort is lexical, which orders
         [100, 30, 9] as [100, 30, 9] and would return 30. */
      assert.equal(A.reduceValues('median', [100, 30, 9]), 30);
      assert.equal(A.reduceValues('median', [9, 100, 30]), 30, 'and is order-independent');
      assert.equal(A.reduceValues('median', [2, 10, 1]), 2);
    });

    test('blanks are skipped rather than counted as zero', () => {
      assert.equal(A.reduceValues('median', [1, null, 3, undefined, '']), 2);
      assert.equal(A.reduceValues('median', [4]), 4);
    });

    test('the median of nothing is null, not zero', () => {
      assert.equal(A.reduceValues('median', []), null);
      assert.equal(A.reduceValues('median', [null, '']), null);
    });

    test('median resists the outlier that moves the average', () => {
      // The reason for having both: one very low mark drags the mean down and
      // leaves the median where it was.
      const clean   = [70, 71, 72, 73, 74];
      const spoiled = [ 4, 71, 72, 73, 74];   // one mark replaced by a bad one
      assert.equal(A.reduceValues('median', clean), 72);
      assert.equal(A.reduceValues('median', spoiled), 72, 'the median should not have moved');
      assert.equal(A.reduceValues('average', clean), 72);
      assert.close(A.reduceValues('average', spoiled), 58.8, 1e-9, 'the mean should have');
    });
  });

  describe('Aggregate, through the graph', () => {
    test('count of everything is the row count', () => {
      assert.equal(agg('count').table.rows[0][0], A.STUDENTS.length);
    });

    test('each measure over gpa matches the dataset', () => {
      assert.close(agg('average', 'gpa').table.rows[0][0], mean(AVGS), 1e-9);
      assert.close(agg('median',  'gpa').table.rows[0][0], median(AVGS), 1e-9);
      assert.equal(agg('min', 'gpa').table.rows[0][0], Math.min(...AVGS));
      assert.equal(agg('max', 'gpa').table.rows[0][0], Math.max(...AVGS));
      assert.equal(agg('sum', 'gpa').table.rows[0][0], AVGS.reduce((a, b) => a + b, 0));
    });

    test('the result is always a 1x1 table', () => {
      A.AGG_OPS.forEach(o => {
        const t = agg(o.key, 'gpa').table;
        assert.equal(t.columns.length, 1, o.key + ' should emit one column');
        assert.equal(t.rows.length, 1, o.key + ' should emit one row');
      });
    });

    test('the column says which measure over which column', () => {
      // point 11: a count and a median must not look alike
      assert.equal(agg('median', 'gpa').table.columns[0].label, 'Median GPA');
      assert.equal(agg('average', 'gpa').table.columns[0].label, 'Average GPA');
      assert.equal(agg('count').table.columns[0].label, 'Count');
    });

    test('the measure is named in the query log', () => {
      assert.includes(agg('median', 'gpa').text('.query-log').toLowerCase(), 'median');
    });

    test('the schema walk and the engine agree about the header', () => {
      /* The registry invariant: a node cannot describe one header in
         computeSchemas and produce another in evaluateGraph. */
      A.AGG_OPS.forEach(o => {
        const r = agg(o.key, 'gpa');
        const declared = r.app.computeSchemas()[r.a.id].columns.map(c => c.key + ':' + c.label);
        const produced = r.app.evaluateGraph().res[r.a.id].table.columns.map(c => c.key + ':' + c.label);
        assert.deepEqual(produced, declared, o.key);
      });
    });

    test('an aggregate over no rows is blank, not zero', () => {
      const h = boot();
      const [s, f, a, o] = h.build('source', 'filter', 'aggregate', 'output');
      h.set(f.id, 'crit.0.value:gpa', '500');   // matches nobody
      ['average', 'median', 'min', 'max'].forEach(op => {
        h.set(a.id, 'op', op);
        h.w.runQuery();
        assert.equal(h.entry(o.id).table.rows[0][0], null, op + ' of nothing is undefined');
        assert.equal(h.bigNum(), '—', op + ' should show a dash, not a zero');
      });
    });

    test('count of no rows really is zero', () => {
      const h = boot();
      const [s, f, a, o] = h.build('source', 'filter', 'aggregate', 'output');
      h.set(f.id, 'crit.0.value:gpa', '500');
      h.set(a.id, 'op', 'count');
      h.w.runQuery();
      assert.equal(h.entry(o.id).table.rows[0][0], 0, 'counting nothing is a real zero');
    });

    test('an aggregate can be fed onward, which is why it is a node', () => {
      const h = boot();
      const [s, a, t, o] = h.build('source', 'aggregate', 'take', 'output');
      h.set(a.id, 'op', 'median');
      h.w.runQuery();
      assert.equal(h.entry(o.id).table.rows.length, 1);
    });
  });

  describe('AggregateColumns', () => {
    test('one row out, the same headers in', () => {
      const h = boot();
      const [s, a, o] = h.build('source', 'aggregateColumns', 'output');
      h.set(a.id, 'op', 'median');
      h.w.runQuery();
      const t = h.entry(o.id).table;
      assert.equal(t.rows.length, 1);
      assert.deepEqual(t.columns.map(c => c.key),
        A.studentsTable([]).columns.map(c => c.key));
    });

    test('the median lands under its own column', () => {
      const h = boot();
      const [s, a, o] = h.build('source', 'aggregateColumns', 'output');
      h.set(a.id, 'op', 'median');
      h.w.runQuery();
      const t = h.entry(o.id).table;
      assert.close(A.cellAt(t, t.rows[0], 'gpa'), median(AVGS), 1e-9);
    });

    test('non-numeric columns come out blank rather than guessed at', () => {
      const h = boot();
      const [s, a, o] = h.build('source', 'aggregateColumns', 'output');
      h.set(a.id, 'op', 'median');
      h.w.runQuery();
      const t = h.entry(o.id).table;
      assert.equal(A.cellAt(t, t.rows[0], 'specialisation'), null);
      assert.equal(A.cellAt(t, t.rows[0], 'letterGrade'), null);
    });

    test('Select in front narrows what gets reduced', () => {
      // The composition that answers "specify which columns are aggregated"
      const h = boot();
      const [s, sel, a, o] = h.build('source', 'select', 'aggregateColumns', 'output');
      h.set(sel.id, 'column:id', false);
      h.set(a.id, 'op', 'median');
      h.w.runQuery();
      assert.excludes(h.entry(o.id).table.columns.map(c => c.key), 'id');
    });
  });

  describe('persistence', () => {
    test('a saved query keeps its measure', () => {
      const h = boot();
      const [s, a, o] = h.build('source', 'aggregate', 'output');
      h.set(a.id, 'op', 'median');
      const json = JSON.stringify(h.app.serialiseGraph());
      assert.includes(json, 'median');
      h.w.clearAll();
      h.app.loadGraphFromText(json, h.doc.createElement('button'));
      const back = h.app.nodes.find(n => n.type === 'aggregate');
      assert.equal(back.cfg.op, 'median');
    });

    test('a file naming an op this build does not have falls back to count', () => {
      const h = boot();
      const [s, a, o] = h.build('source', 'aggregate', 'output');
      h.app.setCfg(a.id, 'op', 'mode');       // never existed
      assert.equal(h.app.aggOp(h.app.findNode(a.id)).key, 'count');
    });
  });
};
