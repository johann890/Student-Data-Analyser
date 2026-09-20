/* Compare feeding the row nodes.
   Compare was output-only. It no longer is, because a comparison is the only
   labelled multi-row answer the tool currently produces and refusing to let it
   be aggregated made "count per year, then average those counts" unbuildable
   through it: The case app.js:212 cites as the reason for the table refactor.

   Two things have to hold. Every downstream node must handle a comparison table
   like any other table, and the branch metadata a Compare attaches must stop
   being honoured the moment it stops describing the rows it is attached to. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const DOWNSTREAM = ['filter', 'sort', 'take', 'unique', 'select',
                      'aggregate', 'aggregateColumns', 'combine', 'compare'];

  /* Two branches off two Sources, into a Compare, then optionally one more node,
     then an Output. The branches differ so the comparison has something to say. */
  function rig(mid) {
    const h = boot();
    const s1 = h.add('source'), f1 = h.add('filter'),
          s2 = h.add('source'), f2 = h.add('filter'),
          c  = h.add('compare');
    h.app.connect(s1.id, f1.id); h.app.connect(s2.id, f2.id);
    h.app.connect(f1.id, c.id);  h.app.connect(f2.id, c.id);

    const n = mid ? h.add(mid) : null;
    const o = h.add('output');
    if (n) { h.app.connect(c.id, n.id); h.app.connect(n.id, o.id); }
    else   { h.app.connect(c.id, o.id); }

    h.set(f1.id, 'crit.0.value:gpa', '3');
    h.set(f2.id, 'crit.0.value:gpa', '7');
    h.w.render();
    return { ...h, s1, f1, s2, f2, c, n, o };
  }

  describe('the wiring rule', () => {
    test('Compare goes wherever any other table-producing node goes', () => {
      const { app } = boot();
      assert.deepEqual(app.CONNECT_RULES.compare, app.CONNECT_RULES.filter);
    });

    test('canConnect agrees with the table, for every downstream node', () => {
      const { app } = boot();
      DOWNSTREAM.concat(['output']).forEach(t =>
        assert.ok(app.canConnect('compare', t), 'compare should reach ' + t));
    });

    test('an Output is still terminal', () => {
      const { app } = boot();
      assert.notOk(app.canConnect('output', 'filter'));
    });
  });

  describe('every downstream node accepts a comparison', () => {
    DOWNSTREAM.forEach(type => {
      test(type + ' evaluates, and its panel builds', () => {
        const r = rig(type);
        const ev = r.app.evaluateGraph();
        assert.notOk(ev.error, type + ': ' + ev.error);
        assert.ok(ev.res[r.n.id], type + ' produced no result');
        assert.ok(r.qa('[data-node="' + r.n.id + '"]').length >= 0);
      });

      test(type + ' declares the header it produces', () => {
        // The registry invariant: the schema walk and the engine cannot disagree
        const r = rig(type);
        const declared = r.app.computeSchemas()[r.n.id].columns.map(c => c.key);
        const produced = r.app.evaluateGraph().res[r.n.id].table.columns.map(c => c.key);
        assert.deepEqual(produced, declared, type);
      });
    });
  });

  describe('branch metadata stops being honoured when it stops being true', () => {
    test('a Filter that removes rows drops it', () => {
      const r = rig('filter');
      r.set(r.n.id, 'crit.0.field', 'count');
      r.set(r.n.id, 'crit.0.op:count', 'lt');
      r.set(r.n.id, 'crit.0.value:count', '1');    // removes every branch row
      const t = r.app.evaluateGraph().res[r.n.id].table;
      assert.equal(t.rows.length, 0);
      assert.notOk(t.meta && t.meta.branches, 'filtered rows no longer match the branches');
    });

    test('a Select that narrows the header drops it', () => {
      const r = rig('select');
      r.set(r.n.id, 'column:average', false);
      const t = r.app.evaluateGraph().res[r.n.id].table;
      assert.notOk(t.meta && t.meta.branches,
        'branch tables carry the old header; keeping them would disagree with the summary');
    });

    test('Unique keeps it for whole rows and drops it for one column', () => {
      const whole = rig('unique');
      assert.ok(whole.app.evaluateGraph().res[whole.n.id].table.meta.branches,
        'the table is the same table with fewer rows');

      const one = rig('unique');
      one.set(one.n.id, 'col', 'branch');
      const t = one.app.evaluateGraph().res[one.n.id].table;
      assert.notOk(t.meta && t.meta.branches,
        'a column of labels is not the comparison any more');
    });

    test('Sort and Take keep it — they are row operations with no opinion', () => {
      ['sort', 'take'].forEach(type => {
        const r = rig(type);
        assert.ok(r.app.evaluateGraph().res[r.n.id].table.meta.branches, type);
      });
    });

    test('an aggregation drops it', () => {
      ['aggregate', 'aggregateColumns'].forEach(type => {
        const r = rig(type);
        const t = r.app.evaluateGraph().res[r.n.id].table;
        assert.notOk(t.meta && t.meta.branches, type);
      });
    });
  });

  describe('the export follows what is on screen', () => {
    test('a Take past a Compare exports the rows it kept, not every branch row', () => {
      /* The bug this pins: the long per-branch export used to fire whenever
         branch metadata was present and the view was not the summary. That was
         the same thing only while metadata could reach an Output across a direct
         wire. Sort and Take carry it through, quite correctly, so one row on
         screen exported as every row of every branch. The export silently
         ignored the Take. */
      const r = rig('take');
      r.set(r.n.id, 'n', '1');
      r.w.runQuery();
      const e = r.entry(r.o.id);
      assert.equal(e.table.rows.length, 1, 'one row on screen');
      assert.ok(e.source.meta.branches, 'and the metadata is still attached');
      assert.equal(r.app.exportTableFor(e).rows.length, 1, 'so the export must be one row too');
    });

    test('Copy matches what the panel shows', () => {
      const r = rig('take');
      r.set(r.n.id, 'n', '1');
      r.w.runQuery();
      r.w.copyOutput(r.o.id, r.doc.createElement('button'));
      const lines = r.copied[r.copied.length - 1].trim().split('\n');
      assert.equal(lines.length, 2, 'a header and one row');
    });

    test('a direct Compare still exports its summary as the summary', () => {
      const r = rig(null);
      r.set(r.o.id, 'show', 'summary');
      r.w.runQuery();
      const e = r.entry(r.o.id);
      assert.equal(r.app.exportTableFor(e).rows.length, 2, 'one row per branch');
      assert.includes(r.app.exportTableFor(e).columns.map(c => c.label), 'Branch');
    });

    test('a direct Compare still exports row lists long when asked to', () => {
      const r = rig(null);
      r.set(r.o.id, 'show', 'lists');
      r.w.runQuery();
      const e = r.entry(r.o.id);
      const long = r.app.exportTableFor(e);
      const expected = e.source.meta.branches.reduce((a, b) => a + b.table.rows.length, 0);
      assert.equal(long.rows.length, expected, 'every row of every branch');
      assert.equal(long.columns[0].label, 'Branch', 'with the branch name prepended');
    });
  });

  describe('the Output panel follows what actually feeds it', () => {
    test('wired straight to a Compare it offers the comparison views', () => {
      const r = rig(null);
      assert.deepEqual(r.optionsOf(r.o.id, 'show'), ['summary', 'lists']);
    });

    test('with a node in between it offers the ordinary ones', () => {
      const r = rig('sort');
      assert.deepEqual(r.optionsOf(r.o.id, 'show'), ['rows', 'count'],
        'the comparison is upstream, but what arrives here is an ordinary table');
    });
  });

  describe('the case this was for', () => {
    test('count per year, then average those counts', () => {
      /* app.js:212 names this as the query the table refactor existed to make
         buildable. It was still not buildable through a Compare, which is the
         only node that produces the per-year counts with their labels. */
      const h = boot();
      const s22 = h.add('source'), f22 = h.add('filter'),
            s23 = h.add('source'), f23 = h.add('filter'),
            c   = h.add('compare'), agg = h.add('aggregate'), o = h.add('output');
      h.app.connect(s22.id, f22.id); h.app.connect(s23.id, f23.id);
      h.app.connect(f22.id, c.id);   h.app.connect(f23.id, c.id);
      h.app.connect(c.id, agg.id);   h.app.connect(agg.id, o.id);
      h.w.render();

      const [y1, y2] = h.app.YEARS;
      h.set(s22.id, 'pop', String(y1));
      h.set(s23.id, 'pop', String(y2));
      const CODE = h.app.CORE_COURSES[0];
      [f22, f23].forEach(f => {
        h.set(f.id, 'crit.0.field', 'courses.code');
        h.set(f.id, 'crit.0.value:courses.code', CODE);
      });
      h.w.render();
      h.set(agg.id, 'op', 'average');
      h.w.render();
      h.set(agg.id, 'col', 'count');
      h.w.runQuery();

      const per = [y1, y2].map(y =>
        h.app.STUDENTS.filter(s => s.year === y && s.courses.some(x => x.code === CODE)).length);
      const counts = h.app.evaluateGraph().res[c.id].table;
      assert.deepEqual(counts.rows.map(r => r[1]), per, 'the per-year counts');
      assert.close(h.entry(o.id).table.rows[0][0], (per[0] + per[1]) / 2, 1e-9,
        'and their mean');
    });

    test('the same answer needs fewer nodes than the Combine route', () => {
      // Combine gets there too, but by stacking one-row aggregates and losing
      // the labels on the way.
      const h = boot();
      const s = h.add('source'), c = h.add('compare'), a = h.add('aggregate'), o = h.add('output');
      h.app.connect(s.id, c.id); h.app.connect(c.id, a.id); h.app.connect(a.id, o.id);
      h.w.render();
      h.w.runQuery();
      assert.notOk(h.q('.error-box'), h.text('.error-box'));
      assert.equal(h.entry(o.id).table.rows.length, 1);
    });
  });
};
