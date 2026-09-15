/* The Reverse node.
   It exists for Take. Take deliberately keeps the FIRST N rows and does not
   rank, so "the last N" had no expression at all; Sort, Reverse, Take says it
   in three nodes that each do one thing. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const A = boot().app;

  function rig(...mid) {
    const h = boot();
    const made = h.build('source', ...mid, 'output');
    return { ...h, s: made[0], o: made[made.length - 1], mid: made.slice(1, -1) };
  }
  const ids = t => t.rows.map(r => A.cellAt(t, r, 'id'));

  describe('registration', () => {
    test('it appears in every table the registry keeps', () => {
      const { app } = boot();
      assert.ok(app.SHAPE.reverse, 'no shape');
      assert.ok(app.NODE_SPEC.reverse, 'no spec');
      assert.ok(app.CONNECT_RULES.reverse, 'no wiring rules');
      assert.ok(app.NODE_PORTS.reverse, 'no ports');
      assert.deepEqual(app.defaultCfg('reverse'), {}, 'nothing to configure');
    });

    test('it goes wherever any other row-shaping node goes', () => {
      const { app } = boot();
      assert.deepEqual(app.CONNECT_RULES.reverse, app.CONNECT_RULES.take);
      assert.deepEqual(app.CONNECT_RULES.reverse, app.CONNECT_RULES.sort);
    });

    test('anything that can feed a Take can feed a Reverse', () => {
      const { app } = boot();
      Object.keys(app.CONNECT_RULES).forEach(from => {
        assert.equal(app.canConnect(from, 'reverse'), app.canConnect(from, 'take'), from);
      });
    });

    test('it takes exactly one wire', () => {
      const h = boot();
      const r = h.add('reverse');
      assert.equal(h.app.portsOf('reverse').length, 1);
      assert.notOk(h.app.portDef('reverse', 'in').multi);
    });

    test('it is offered in the Processing menu under Reshape', () => {
      const h = boot();
      const btn = [...h.doc.querySelectorAll('.proc-item')]
        .find(b => b.getAttribute('onclick').includes("'reverse'"));
      assert.ok(btn, 'no menu entry');
      assert.includes(btn.className, 'cat-reshape');
      assert.includes(btn.textContent, 'Reverse');
    });

    test('adding one from the menu puts it on the canvas', () => {
      const h = boot();
      h.w.addProcNode('reverse');
      assert.equal(h.app.nodes.length, 1);
      assert.equal(h.app.nodes[0].type, 'reverse');
      assert.ok(h.q('.shape-reverse'), 'no shape rendered');
    });
  });

  describe('what it does to the table', () => {
    test('the last row comes first and the first comes last', () => {
      const r = rig('reverse');
      r.w.runQuery();
      const got = ids(r.entry(r.o.id).table);
      const want = A.STUDENTS.map(s => s.id).slice().reverse();
      assert.deepEqual(got, want);
    });

    test('the columns are untouched', () => {
      const plain = rig(); plain.w.runQuery();
      const rev   = rig('reverse'); rev.w.runQuery();
      assert.deepEqual(rev.entry(rev.o.id).table.columns.map(c => c.key),
                       plain.entry(plain.o.id).table.columns.map(c => c.key));
    });

    test('the row count is untouched', () => {
      const r = rig('reverse');
      r.w.runQuery();
      assert.equal(r.entry(r.o.id).table.rows.length, A.STUDENTS.length);
    });

    test('reversing twice is the original order', () => {
      const r = rig('reverse', 'reverse');
      r.w.runQuery();
      assert.deepEqual(ids(r.entry(r.o.id).table), A.STUDENTS.map(s => s.id));
    });

    test('an empty table reverses to an empty table, not an error', () => {
      const h = boot();
      const [s, f, rev, o] = h.build('source', 'filter', 'reverse', 'output');
      h.set(f.id, 'crit.0.value:gpa', '500');   // matches nobody
      h.w.runQuery();
      assert.notOk(h.q('.error-box'), h.text('.error-box'));
      assert.equal(h.entry(o.id).table.rows.length, 0);
    });

    test('a single row reverses to itself', () => {
      const h = boot();
      const [s, t, rev, o] = h.build('source', 'take', 'reverse', 'output');
      h.set(t.id, 'n', '1');
      h.w.runQuery();
      assert.equal(h.entry(o.id).table.rows.length, 1);
      assert.equal(ids(h.entry(o.id).table)[0], A.STUDENTS[0].id);
    });
  });

  describe('it does not reorder anybody else\'s rows', () => {
    test('a sibling branch off the same Source is unaffected', () => {
      /* The trap: reverse() is in place. One node's result object is read by
         every node wired downstream of it, so reversing t.rows directly would
         silently reorder a sibling branch — and only on graphs that fork, which
         is why it would survive casual testing. Sort guards the same way. */
      const h = boot();
      const s = h.add('source'), rev = h.add('reverse'),
            o1 = h.add('output'), o2 = h.add('output');
      h.app.connect(s.id, rev.id); h.app.connect(rev.id, o1.id);
      h.app.connect(s.id, o2.id);          // the sibling, straight off the Source
      h.w.render(); h.w.runQuery();

      assert.deepEqual(ids(h.entry(o2.id).table), A.STUDENTS.map(x => x.id),
        'the unreversed branch must still be in file order');
      assert.deepEqual(ids(h.entry(o1.id).table), A.STUDENTS.map(x => x.id).slice().reverse());
    });

    test('the Source table itself is not mutated', () => {
      const h = boot();
      const [s, rev, o] = h.build('source', 'reverse', 'output');
      h.w.runQuery();
      const src = h.app.evaluateGraph().res[s.id].table;
      assert.deepEqual(ids(src), A.STUDENTS.map(x => x.id));
    });
  });

  describe('the pairing with Take', () => {
    test('Sort, Reverse, Take gives the bottom N', () => {
      const h = boot();
      const [s, sort, rev, take, o] = h.build('source', 'sort', 'reverse', 'take', 'output');
      h.set(sort.id, 'sort.0.col', 'gpa');
      h.set(sort.id, 'sort.0.dir', 'asc');
      h.set(take.id, 'n', '5');
      h.w.runQuery();

      const got = h.entry(o.id).table.rows.map(r => A.cellAt(h.entry(o.id).table, r, 'gpa'));
      const want = A.STUDENTS.map(x => x.gpa).sort((a, b) => a - b).slice(-5).reverse();
      assert.deepEqual(got, want, 'the five highest, highest first');
    });

    test('without the Reverse the same graph gives the top N', () => {
      const h = boot();
      const [s, sort, take, o] = h.build('source', 'sort', 'take', 'output');
      h.set(sort.id, 'sort.0.col', 'gpa');
      h.set(sort.id, 'sort.0.dir', 'asc');
      h.set(take.id, 'n', '5');
      h.w.runQuery();
      const t = h.entry(o.id).table;
      const got = t.rows.map(r => A.cellAt(t, r, 'gpa'));
      assert.deepEqual(got, A.STUDENTS.map(x => x.gpa).sort((a, b) => a - b).slice(0, 5));
    });

    test('it reverses an order no Sort produced', () => {
      /* The case Sort's own direction setting cannot cover: a Compare's rows
         are in the order its branches were wired, and there is no key to sort
         on that would reproduce that order. */
      const h = boot();
      const s1 = h.add('source'), f1 = h.add('filter'),
            s2 = h.add('source'), f2 = h.add('filter'),
            c = h.add('compare'), rev = h.add('reverse'), o = h.add('output');
      h.app.connect(s1.id, f1.id); h.app.connect(s2.id, f2.id);
      h.app.connect(f1.id, c.id);  h.app.connect(f2.id, c.id);
      h.app.connect(c.id, rev.id); h.app.connect(rev.id, o.id);
      h.set(f1.id, 'crit.0.value:gpa', '60');
      h.set(f2.id, 'crit.0.value:gpa', '80');
      h.w.render(); h.w.runQuery();

      const ev = h.app.evaluateGraph();
      const before = ev.res[c.id].table.rows.map(r => r[1]);
      const after  = ev.res[rev.id].table.rows.map(r => r[1]);
      assert.deepEqual(after, before.slice().reverse());
    });
  });

  describe('it is a pure row operation', () => {
    test('the header it declares is the header it produces', () => {
      const h = boot();
      const [s, rev, o] = h.build('source', 'reverse', 'output');
      const declared = h.app.computeSchemas()[rev.id].columns.map(c => c.key);
      const produced = h.app.evaluateGraph().res[rev.id].table.columns.map(c => c.key);
      assert.deepEqual(produced, declared);
      assert.deepEqual(declared, A.studentsTable([]).columns.map(c => c.key),
        'and it is the header that arrived');
    });

    test('meta rides through — the same rows in a different order', () => {
      const h = boot();
      const s1 = h.add('source'), s2 = h.add('source'), c = h.add('compare'),
            rev = h.add('reverse'), o = h.add('output');
      h.app.connect(s1.id, c.id); h.app.connect(s2.id, c.id);
      h.app.connect(c.id, rev.id); h.app.connect(rev.id, o.id);
      h.w.render();
      assert.ok(h.app.evaluateGraph().res[rev.id].table.meta.branches);
    });

    test('it announces itself in the query log', () => {
      const r = rig('reverse');
      r.w.runQuery();
      assert.includes(r.text('.query-log').toUpperCase(), 'REVERSE');
    });

    test('it can be fed onward like any other table node', () => {
      const r = rig('reverse', 'aggregate');
      r.w.runQuery();
      assert.notOk(r.q('.error-box'), r.text('.error-box'));
      assert.equal(r.entry(r.o.id).table.rows.length, 1);
    });
  });

  describe('the panel', () => {
    test('it offers no controls, because there is nothing to choose', () => {
      const h = boot();
      const [s, rev, o] = h.build('source', 'reverse', 'output');
      assert.equal(h.qa('[data-node="' + rev.id + '"]').length, 0);
    });

    test('it explains itself instead, and names the pairing', () => {
      const h = boot();
      const [s, rev, o] = h.build('source', 'reverse', 'output');
      const el = h.doc.querySelectorAll('.node')[1];
      assert.includes(el.textContent, 'Take', 'the panel should say what it is for');
    });
  });

  describe('persistence', () => {
    test('a graph containing one survives a round trip', () => {
      const h = boot();
      const [s, sort, rev, take, o] = h.build('source', 'sort', 'reverse', 'take', 'output');
      h.set(take.id, 'n', '3');
      h.w.runQuery();
      const before = h.app.serialiseTable(h.app.exportTableFor(h.entry(o.id)), ',', true);

      const json = JSON.stringify(h.app.serialiseGraph());
      h.w.clearAll();
      h.app.loadGraphFromText(json, h.doc.createElement('button'));
      assert.includes(h.app.nodes.map(n => n.type), 'reverse');
      h.w.runQuery();
      const out = h.app.nodes.find(n => n.type === 'output');
      assert.equal(h.app.serialiseTable(h.app.exportTableFor(h.entry(out.id)), ',', true), before);
    });
  });
};
