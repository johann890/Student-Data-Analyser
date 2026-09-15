/* Choosing columns on an Output.
   A deliberate duplication of what Select does. The Output's other shortcuts
   were removed for being exactly that, so the distinction matters: Average and
   the course breakdown COMPUTED — they hid steps that changed the answer, in a
   place the query log could not describe. Choosing which columns to look at
   changes no answer. It is a property of the view, which is what an Output is.

   Both routes stay open and they compose: a Select upstream narrows what
   arrives, this narrows what is shown of it. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const A = boot().app;
  const ALL = A.studentsTable([]).columns.map(c => c.key);

  function rig() {
    const h = boot();
    const [s, o] = h.build('source', 'output');
    return { ...h, s, o };
  }
  const shown = h => h.entry(h.o.id).table.columns.map(c => c.key);

  describe('the control', () => {
    test('a fresh Output shows every column', () => {
      const r = rig();
      r.w.runQuery();
      assert.deepEqual(shown(r), ALL);
      assert.equal(r.app.defaultCfg('output').cols, null, 'null means every column');
    });

    test('one box per incoming column, all ticked', () => {
      const r = rig();
      const boxes = r.qa('[data-node="' + r.o.id + '"][data-key^="column:"]');
      assert.deepEqual(boxes.map(b => b.getAttribute('data-key').slice(7)), ALL);
      boxes.forEach(b => assert.ok(b.checked, b.getAttribute('data-key')));
    });

    test('the boxes follow the header that arrives, not the student schema', () => {
      const h = boot();
      const [s, sel, o] = h.build('source', 'select', 'output');
      h.set(sel.id, 'column:gpa', false);
      const keys = h.qa('[data-node="' + o.id + '"][data-key^="column:"]')
        .map(b => b.getAttribute('data-key').slice(7));
      assert.excludes(keys, 'gpa', 'a column that stopped arriving must stop being offered');
      assert.equal(keys.length, ALL.length - 1);
    });

    test('an unconnected Output says so rather than offering nothing', () => {
      const h = boot();
      h.w.addNode('output');
      h.w.render();
      assert.ok(h.text('.node-config'));
    });
  });

  describe('what it does', () => {
    test('unticking hides that column', () => {
      const r = rig();
      r.set(r.o.id, 'column:gender', false);
      r.w.runQuery();
      assert.excludes(shown(r), 'gender');
      assert.equal(shown(r).length, ALL.length - 1);
    });

    test('no rows are lost', () => {
      const r = rig();
      r.set(r.o.id, 'column:gender', false);
      r.set(r.o.id, 'column:courses', false);
      r.w.runQuery();
      assert.equal(r.entry(r.o.id).table.rows.length, A.STUDENTS.length);
    });

    test('the values left behind are the right ones', () => {
      const r = rig();
      ['gender', 'year', 'specialisation', 'letterGrade', 'courses']
        .forEach(k => r.set(r.o.id, 'column:' + k, false));
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.deepEqual(t.columns.map(c => c.key), ['id', 'gpa']);
      assert.deepEqual(t.rows[0], [A.STUDENTS[0].id, A.STUDENTS[0].gpa]);
    });

    test('columns keep the order they arrive in, not the order they were ticked', () => {
      const r = rig();
      r.set(r.o.id, 'column:id', false);
      r.set(r.o.id, 'column:id', true);      // off and on again
      r.w.runQuery();
      assert.deepEqual(shown(r), ALL, 'id should return to the front, not go to the end');
    });

    test('re-ticking restores the column', () => {
      const r = rig();
      r.set(r.o.id, 'column:gender', false);
      r.w.runQuery();
      assert.excludes(shown(r), 'gender');
      r.set(r.o.id, 'column:gender', true);
      r.w.runQuery();
      assert.deepEqual(shown(r), ALL);
    });

    test('the last ticked box is locked, so an Output can never show nothing', () => {
      const r = rig();
      ALL.slice(0, ALL.length - 1).forEach(k => r.set(r.o.id, 'column:' + k, false));
      const ticked = r.qa('[data-node="' + r.o.id + '"][data-key^="column:"]').filter(b => b.checked);
      assert.equal(ticked.length, 1);
      assert.ok(ticked[0].disabled, 'the last one must not be untickable');
      r.w.runQuery();
      assert.equal(shown(r).length, 1);
    });

    /* Two independent guards stop an Output showing nothing, and they are tested
       separately because a test that only checks the outcome passes when either
       one is removed — which is how the first version of this test was written,
       and it could not fail. */
    test('setCfg refuses to write an empty selection', () => {
      // The backstop behind the disabled box: bypass the control entirely
      const r = rig();
      ALL.forEach(k => r.app.setCfg(r.o.id, 'column:' + k, false));
      const cols = r.app.findNode(r.o.id).cfg.cols;
      assert.ok(Array.isArray(cols), 'cols should still be a list');
      assert.ok(cols.length >= 1, 'the last untick must be refused, not written as []');
    });

    test('and selectedCols falls back if an empty list reaches it anyway', () => {
      // The second guard, reached only by a hand-edited file
      const r = rig();
      r.app.findNode(r.o.id).cfg.cols = [];
      r.w.runQuery();
      assert.deepEqual(shown(r), ALL, 'an empty list means the config is meaningless, so show everything');
    });

    test('an Output never shows an empty table, whichever guard is doing the work', () => {
      const r = rig();
      ALL.forEach(k => r.app.setCfg(r.o.id, 'column:' + k, false));
      r.w.runQuery();
      assert.ok(shown(r).length >= 1);
    });
  });

  describe('it changes the view, never the answer', () => {
    test('the row count is untouched', () => {
      const r = rig();
      const before = (r.w.runQuery(), r.entry(r.o.id).table.rows.length);
      r.set(r.o.id, 'column:courses', false);
      r.w.runQuery();
      assert.equal(r.entry(r.o.id).table.rows.length, before);
    });

    test('a count counts rows however few columns are shown', () => {
      const r = rig();
      r.set(r.o.id, 'column:gender', false);
      r.set(r.o.id, 'show', 'count');
      r.w.runQuery();
      assert.equal(r.entry(r.o.id).table.rows[0][0], A.STUDENTS.length);
    });

    test('nothing upstream can see it', () => {
      // An Output has no outgoing edges, so its narrowing is invisible to the graph
      const r = rig();
      r.set(r.o.id, 'column:gender', false);
      const src = r.app.evaluateGraph().res[r.s.id].table;
      assert.deepEqual(src.columns.map(c => c.key), ALL);
    });
  });

  describe('the picker appears only where it means something', () => {
    test('not on the count view — a count has one column of its own', () => {
      const r = rig();
      r.set(r.o.id, 'show', 'count');
      assert.deepEqual(r.qa('[data-node="' + r.o.id + '"]').map(e => e.getAttribute('data-key')),
        ['show']);
    });

    test('not on a Compare-fed Output — Compare already picks its measures', () => {
      const h = boot();
      const s1 = h.add('source'), s2 = h.add('source'),
            c = h.add('compare'), o = h.add('output');
      h.app.connect(s1.id, c.id); h.app.connect(s2.id, c.id); h.app.connect(c.id, o.id);
      h.w.render();
      assert.deepEqual(h.qa('[data-node="' + o.id + '"]').map(e => e.getAttribute('data-key')),
        ['show'], 'offering a second way to hide measures would be the bad kind of duplication');
    });

    test('a comparison reaches an Output unchanged', () => {
      const h = boot();
      const s1 = h.add('source'), s2 = h.add('source'),
            c = h.add('compare'), o = h.add('output');
      h.app.connect(s1.id, c.id); h.app.connect(s2.id, c.id); h.app.connect(c.id, o.id);
      h.w.render(); h.w.runQuery();
      const t = h.entry(o.id).table;
      assert.equal(t.columns[0].key, 'branch');
      assert.ok(h.entry(o.id).source.meta.branches, 'and its metadata survives');
    });

    test('it comes back when the view returns to rows', () => {
      const r = rig();
      r.set(r.o.id, 'show', 'count');
      assert.equal(r.control(r.o.id, 'column:gender'), null);
      r.set(r.o.id, 'show', 'rows');
      assert.ok(r.control(r.o.id, 'column:gender'));
    });
  });

  describe('Copy and Save follow what is shown', () => {
    test('the CSV carries the chosen columns and every row', () => {
      const r = rig();
      ['gender', 'courses'].forEach(k => r.set(r.o.id, 'column:' + k, false));
      r.w.runQuery();
      r.w.saveOutput(r.o.id, r.doc.createElement('button'));
      const lines = r.saved[r.saved.length - 1].content.split('\n');
      assert.equal(lines[0], 'ID,Year,Specialisation,GPA,Grade');
      assert.equal(lines.length - 1, A.STUDENTS.length, 'display truncates rows; export never does');
    });

    test('Copy matches', () => {
      const r = rig();
      ['gender', 'courses'].forEach(k => r.set(r.o.id, 'column:' + k, false));
      r.w.runQuery();
      r.w.copyOutput(r.o.id, r.doc.createElement('button'));
      const head = r.copied[r.copied.length - 1].split('\n')[0].split('\t');
      assert.deepEqual(head, ['ID', 'Year', 'Specialisation', 'GPA', 'Grade']);
    });
  });

  describe('it composes with Select rather than competing', () => {
    test('a column dropped upstream is simply not offered', () => {
      const h = boot();
      const [s, sel, o] = h.build('source', 'select', 'output');
      h.set(o.id, 'column:gender', false);       // hidden at the Output
      h.set(sel.id, 'column:gpa', false);   // dropped upstream
      h.w.runQuery();
      const keys = h.entry(o.id).table.columns.map(c => c.key);
      assert.excludes(keys, 'gender');
      assert.excludes(keys, 'gpa');
      assert.equal(keys.length, ALL.length - 2);
    });

    test('a selection naming columns that stopped arriving falls back rather than emptying', () => {
      const h = boot();
      const [s, sel, o] = h.build('source', 'select', 'output');
      h.set(o.id, 'column:id', false);           // cols now names the other six
      ['gender', 'year', 'specialisation', 'gpa', 'letterGrade']
        .forEach(k => h.set(sel.id, 'column:' + k, false));   // only id and courses arrive
      h.w.runQuery();
      const keys = h.entry(o.id).table.columns.map(c => c.key);
      assert.ok(keys.length >= 1, 'an Output must never show an empty table');
      assert.includes(keys, 'courses');
    });
  });

  describe('persistence', () => {
    test('the selection survives a round trip', () => {
      const r = rig();
      ['gender', 'courses'].forEach(k => r.set(r.o.id, 'column:' + k, false));
      r.w.runQuery();
      const before = r.app.serialiseTable(r.app.exportTableFor(r.entry(r.o.id)), ',', true);

      const json = JSON.stringify(r.app.serialiseGraph());
      assert.includes(json, '"cols"');
      r.w.clearAll();
      r.app.loadGraphFromText(json, r.doc.createElement('button'));
      r.w.runQuery();
      const out = r.app.nodes.find(n => n.type === 'output');
      assert.equal(r.app.serialiseTable(r.app.exportTableFor(r.entry(out.id)), ',', true), before);
    });

    test('a file written before the key existed loads showing every column', () => {
      const raw = JSON.stringify({
        kind: 'student-data-analyser-query', version: 1,
        nodes: [{ id: 1, type: 'output', x: 0, y: 0, cfg: { show: 'rows' } }],
        connections: []
      });
      const r = boot().app.deserialiseGraph(raw);
      assert.equal(r.nodes[0].cfg.cols, null, 'absent means every column, not none');
    });

    test('a file naming columns that are not strings is repaired', () => {
      const raw = JSON.stringify({
        kind: 'student-data-analyser-query', version: 1,
        nodes: [{ id: 1, type: 'output', x: 0, y: 0, cfg: { show: 'rows', cols: [{}, 'id', 7] } }],
        connections: []
      });
      const r = boot().app.deserialiseGraph(raw);
      assert.deepEqual(r.nodes[0].cfg.cols, ['id']);
    });
  });
};
