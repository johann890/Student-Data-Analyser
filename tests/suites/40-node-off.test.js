/* THE OFF SWITCH
   ===========================================================================
   A node that is switched off stays wired, keeps its settings, and passes its
   input straight through.

   The question it exists to answer is "what does this look like without the
   filter", and before it the only way to ask was to delete the Filter. That
   loses the settings and leaves two loose ends to reconnect, so asking cost a
   rebuild and taking it back cost another. Both directions should cost one
   keystroke.

   The property that makes the feature safe to add is asserted first: a graph
   with nothing switched off produces exactly the query it produced before the
   switch existed, byte for byte on the way to disk.

   Two things here are behaviour rather than taste and are pinned as such:

     - Source cannot be switched off. It has no input to pass through, so the
       only meaning available is "emit nothing", which is the broken query the
       switch exists to avoid. A hand-edited file that asks for it is refused
       on load.
     - The two graph walks must agree. evaluateGraph and computeSchemas both
       have to bypass, or a switched-off Aggregate describes its aggregated
       headers to the panels downstream while passing its input's headers past
       them, and every field list below it is wrong.                          */

const { boot, appStyles } = require('../lib/harness');
const { assert } = require('../lib/assert');

const CSS = appStyles().replace(/\/\*[\s\S]*?\*\//g, '');

module.exports = ({ describe, test }) => {

  // What a node actually emits when the graph runs.
  const tableAt = (h, id) => h.app.evaluateGraph().res[id].table;
  const keysAt  = (h, id) => tableAt(h, id).columns.map(c => c.key);
  const rowsAt  = (h, id) => tableAt(h, id).rows.length;

  /* Switched through the same call the key and the button both reach, rather
     than by writing the flag onto the node. A model that can only be put into
     this state by hand is a model the application cannot actually produce. */
  function switchOff(h, ...nodeIds) {
    h.app.toggleNodesOff(nodeIds);
  }

  /* source -> filter -> output, with the Filter narrowing to something small
     enough that passing it through is plainly visible in the row count. The
     operand keys carry the field name, the way this node's panel builds them. */
  function chain(h) {
    const [s, f, o] = h.build('source', 'filter', 'output');
    h.set(f.id, 'crit.0.field', 'gpa');
    h.set(f.id, 'crit.0.op:gpa', 'gte');
    h.set(f.id, 'crit.0.value:gpa', '70');
    return { s, f, o };
  }

  /* ══ 1. NOTHING CHANGES UNTIL SOMETHING IS SWITCHED OFF ═══════════════════ */
  describe('a query with nothing switched off is the query it always was', () => {

    test('no node carries the flag merely for existing', () => {
      const h = boot();
      h.build('source', 'filter', 'take', 'histogram', 'output');
      h.app.nodes.forEach(n => {
        assert.notOk(n.off, n.type + ' should be on without being told to be');
        assert.notOk(h.app.isNodeOff(n), n.type + ' should not read as off');
      });
    });

    test('the saved file is byte for byte what it was', () => {
      const h = boot();
      const { f } = chain(h);
      const before = JSON.stringify(h.app.serialiseGraph().nodes);

      switchOff(h, f.id);
      switchOff(h, f.id);   // and back on again

      assert.equal(JSON.stringify(h.app.serialiseGraph().nodes), before,
        'switching off and on again must leave no trace in the file');
    });

    test('the flag is absent rather than false', () => {
      const h = boot();
      const { f } = chain(h);
      const saved = h.app.serialiseGraph().nodes.find(n => n.id === f.id);
      assert.notOk('off' in saved,
        'a file should not grow a line of "off": false for every node in it');
    });
  });

  /* ══ 2. WHAT OFF MEANS ════════════════════════════════════════════════════ */
  describe('a switched-off node passes its input through', () => {

    test('the rows that arrive are the rows that leave', () => {
      const h = boot();
      const { s, f } = chain(h);
      const upstream = rowsAt(h, s.id);
      assert.ok(rowsAt(h, f.id) < upstream, 'the filter should be doing something first');

      switchOff(h, f.id);
      assert.equal(rowsAt(h, f.id), upstream,
        'switched off, it should emit exactly what reached it');
    });

    test('the chain still runs: downstream gets the data, not an empty table', () => {
      const h = boot();
      const { s, f, o } = chain(h);
      switchOff(h, f.id);

      assert.equal(rowsAt(h, o.id), rowsAt(h, s.id),
        'this is the whole point: the branch keeps running');
      assert.ok(h.app.evaluateGraph().res[o.id].hasSource,
        'and it is still fed by a Source, so the panel treats it as answerable');
    });

    test('the settings survive, which is what deleting the node would lose', () => {
      const h = boot();
      const { f } = chain(h);
      const cfg = JSON.stringify(f.cfg);

      switchOff(h, f.id);
      assert.equal(JSON.stringify(f.cfg), cfg, 'nothing about the filter was discarded');

      switchOff(h, f.id);
      assert.ok(rowsAt(h, f.id) < rowsAt(h, h.app.nodes[0].id),
        'and switching it back on resumes exactly the filter it was');
    });

    test('the wires are untouched, so nothing has to be reconnected', () => {
      const h = boot();
      const { f } = chain(h);
      const wires = JSON.stringify(h.app.connections);
      switchOff(h, f.id);
      assert.equal(JSON.stringify(h.app.connections), wires);
    });

    test('a node that reshapes the columns passes the original columns through', () => {
      const h = boot();
      const [s, a, o] = h.build('source', 'aggregate', 'output');
      const all = keysAt(h, s.id);
      assert.ok(keysAt(h, a.id).length < all.length, 'Aggregate should be reshaping first');

      switchOff(h, a.id);
      assert.deepEqual(keysAt(h, a.id), all, 'switched off, the full header passes');
      assert.deepEqual(keysAt(h, o.id), all, 'and arrives downstream intact');
      assert.ok(s && o);
    });
  });

  /* ══ 3. THE TWO WALKS AGREE ═══════════════════════════════════════════════ */
  describe('the schema walk bypasses too', () => {

    /* The bug this exists to catch: computeSchemas keeps calling spec.schema on
       a node that evaluateGraph is bypassing. Nothing throws. The panels below
       simply offer field names that are not in the data flowing past them, and
       the first sign of it is a Filter that silently matches nothing. */
    test('a switched-off node describes what it passes, not what it would have made', () => {
      const h = boot();
      const [s, a, o] = h.build('source', 'aggregate', 'output');
      const passing = keysAt(h, s.id);

      switchOff(h, a.id);
      const schemas = h.app.computeSchemas();
      assert.deepEqual(schemas[a.id].columns.map(c => c.key), passing,
        'the schema walk must bypass wherever the evaluation does');
      assert.deepEqual(schemas[a.id].columns.map(c => c.key), keysAt(h, a.id),
        'the two walks must describe the same table');
      assert.ok(o);
    });

    test('a panel downstream offers what it would offer with the node gone', () => {
      const fields = (h, id) =>
        [...h.q('[data-node="' + id + '"][data-key="crit.0.field"]').options].map(o => o.value);

      // The filter wired straight to the Source: the answer to compare against.
      const direct = boot();
      const [, df] = direct.build('source', 'filter');
      const expected = fields(direct, df.id);

      // The same filter with a switched-off Aggregate between it and the Source.
      const h = boot();
      const [, a, f] = h.build('source', 'aggregate', 'filter');
      assert.notOk(JSON.stringify(fields(h, f.id)) === JSON.stringify(expected),
        'the Aggregate should be changing the field list while it is running');

      switchOff(h, a.id);
      h.w.render();
      assert.deepEqual(fields(h, f.id), expected,
        'switched off, the panel below it is built from what actually arrives');
    });
  });

  /* ══ 4. SOURCE IS REFUSED ═════════════════════════════════════════════════ */
  describe('a Source cannot be switched off', () => {

    test('the model refuses it', () => {
      const h = boot();
      const [s] = h.build('source', 'output');
      assert.notOk(h.app.nodeCanBeOff(s), 'there is no input to pass through');
      switchOff(h, s.id);
      assert.notOk(h.app.isNodeOff(s), 'and asking anyway changes nothing');
    });

    test('a selection holding one does the obvious thing to the rest', () => {
      const h = boot();
      const { s, f, o } = chain(h);
      h.app.setSelection([s.id, f.id, o.id]);
      const changed = h.app.toggleSelectionOff();

      assert.equal(changed, 2, 'the Source is passed over, not a reason to refuse the lot');
      assert.notOk(h.app.isNodeOff(s));
      assert.ok(h.app.isNodeOff(f));
      assert.ok(h.app.isNodeOff(o));
    });

    test('a hand-edited file asking for it is refused on load', () => {
      const h = boot();
      chain(h);
      const file = h.app.serialiseGraph();
      file.nodes.forEach(n => { n.off = true; });

      const loaded = h.app.deserialiseGraph(JSON.stringify(file));
      assert.notOk(loaded.error, 'the file should still load');
      const src = loaded.nodes.find(n => n.type === 'source');
      assert.notOk(src.off, 'a Source switched off by hand would emit nothing');
      assert.ok(loaded.nodes.find(n => n.type === 'filter').off,
        'while the rest of the file is honoured');
    });
  });

  /* ══ 5. A BRANCH AT A TIME ════════════════════════════════════════════════ */
  describe('the unit is the branch, not the node', () => {

    test('a selection moves to one state rather than each node flipping', () => {
      const h = boot();
      const [s, f, t, o] = h.build('source', 'filter', 'take', 'output');
      switchOff(h, f.id);                      // a mixed selection to start from

      h.app.setSelection([f.id, t.id, o.id]);
      h.app.toggleSelectionOff();
      assert.ok([f, t, o].every(n => h.app.isNodeOff(n)),
        'anything still running means the whole selection goes off');

      h.app.toggleSelectionOff();
      assert.ok([f, t, o].every(n => !h.app.isNodeOff(n)),
        'and only a selection that is entirely off comes back on');
      assert.ok(s);
    });

    test('double-clicking a node then switching off takes the whole arm out', () => {
      const h = boot();
      const { f } = chain(h);
      h.app.selectBranch(f.id);
      h.app.toggleSelectionOff();

      h.app.nodes.filter(n => n.type !== 'source')
        .forEach(n => assert.ok(h.app.isNodeOff(n), n.type + ' is part of the branch'));
    });
  });

  /* ══ 6. AN OUTPUT SWITCHED OFF LEAVES THE PANEL ═══════════════════════════ */
  describe('a switched-off Output drops out of the results panel', () => {

    test('its block is dressed out of sight', () => {
      const h = boot();
      const { o } = chain(h);
      h.w.runQuery();
      assert.notOk(h.q('.result-block').classList.contains('result-hidden'));

      switchOff(h, o.id);
      h.w.runQuery();
      assert.ok(h.q('.result-block').classList.contains('result-hidden'),
        'a branch that is off should not fill the panel with an answer nobody asked for');
    });

    test('the note names the switch that emptied it, not the tick box', () => {
      const h = boot();
      const { o } = chain(h);
      switchOff(h, o.id);
      h.w.runQuery();

      const note = h.q('.all-hidden-note');
      assert.notOk(note.classList.contains('result-hidden'), 'the panel should say why it is empty');
      assert.includes(note.textContent, 'switched off');
      assert.ok(!/Tick "Show in results panel"/.test(note.textContent),
        'sending the user to a box that is already ticked makes the tool look broken');
    });

    test('and names the tick box when that is what did it', () => {
      const h = boot();
      const { o } = chain(h);
      h.set(o.id, 'panel', false);
      h.w.runQuery();

      const note = h.q('.all-hidden-note');
      assert.notOk(note.classList.contains('result-hidden'));
      assert.includes(note.textContent, 'Show in results panel');
    });

    test('a mixed panel names both', () => {
      const h = boot();
      const [s, o1] = h.build('source', 'output');
      const o2 = h.add('output');
      h.app.connect(s.id, o2.id);
      h.w.render();

      h.set(o1.id, 'panel', false);
      switchOff(h, o2.id);
      h.w.runQuery();

      const note = h.q('.all-hidden-note');
      assert.notOk(note.classList.contains('result-hidden'));
      assert.includes(note.textContent, 'switched off');
      assert.includes(note.textContent, 'Show in results panel');
    });
  });

  /* ══ 7. IT SURVIVES A ROUND TRIP ══════════════════════════════════════════ */
  describe('saving and loading', () => {

    test('a switched-off node comes back switched off', () => {
      const h = boot();
      const { f, o } = chain(h);
      switchOff(h, f.id);

      const loaded = h.app.deserialiseGraph(JSON.stringify(h.app.serialiseGraph()));
      assert.notOk(loaded.error);
      assert.ok(loaded.nodes.find(n => n.id === f.id).off);
      assert.notOk(loaded.nodes.find(n => n.id === o.id).off,
        'and one that was running comes back running');
    });

    test('a query saved before the switch existed loads with everything on', () => {
      const h = boot();
      chain(h);
      const file = h.app.serialiseGraph();
      file.nodes.forEach(n => { delete n.off; });

      const loaded = h.app.deserialiseGraph(JSON.stringify(file));
      assert.notOk(loaded.error);
      loaded.nodes.forEach(n => assert.notOk(n.off, 'absent must mean on'));
    });
  });

  /* ══ 8. IT SAYS SO ON SCREEN ══════════════════════════════════════════════ */
  describe('the canvas shows which nodes are off', () => {

    test('the node carries the state without being hovered', () => {
      const h = boot();
      const { f } = chain(h);
      switchOff(h, f.id);
      h.w.render();

      const el = h.q('.node-off');
      assert.ok(el, 'a state that only appears on hover is a state nobody sees');
      assert.ok(el.querySelector('.node-config'),
        'and the settings stay on screen, because they are what the switch preserves');
    });

    test('the shape says so in words, not only in colour', () => {
      const h = boot();
      const { f } = chain(h);
      assert.equal(h.qa('.node-off-tag').length, 0, 'nothing is off yet');

      switchOff(h, f.id);
      h.w.render();
      const tag = h.q('.node-off-tag');
      assert.ok(tag, 'colour alone cannot be read aloud or described in a screenshot');
      assert.equal(tag.textContent, '(Off)');
      assert.ok(h.q('.node-off .node-shape').contains(tag),
        'it belongs to the shape, under the name, not to the panel below it');

      switchOff(h, f.id);
      h.w.render();
      assert.equal(h.qa('.node-off-tag').length, 0, 'and it goes when the node comes back on');
    });

    /* Every type, because the tag is appended to whatever shape is there rather
       than written into each shape's own markup, and the shapes differ: some
       centre a single word, some stack a glyph above one. A shape that swallowed
       the tag or pushed it outside itself would be invisible in a test that only
       ever looked at a Filter. */
    test('every node type that can be switched off gets one', () => {
      ['filter', 'sort', 'take', 'unique', 'select', 'project', 'aggregate',
       'histogram', 'output'].forEach(type => {
        const h = boot();
        const n = h.add(type);
        h.app.toggleNodesOff([n.id]);
        h.w.render();
        const tag = h.q('.node-off-tag');
        assert.ok(tag, type + ' should say it is off');
        assert.equal(tag.textContent, '(Off)', type + ' should say it the same way');
        assert.ok(h.q('.shape-' + type.toLowerCase()) === null ||
                  h.q('.node-off .node-shape').contains(tag),
          type + ' should carry the word on its own shape');
      });
    });

    test('the wires either side of it are drawn as off', () => {
      const h = boot();
      const { f } = chain(h);
      h.w.render();
      const colours = () => h.qa('#svg path[stroke]').map(p => p.getAttribute('stroke'));
      assert.notOk(colours().includes(h.app.EDGE_OFF_COLOR), 'nothing is off yet');

      switchOff(h, f.id);
      h.w.render();
      const off = h.qa('#svg path[stroke="' + h.app.EDGE_OFF_COLOR + '"]');
      assert.equal(off.length, 2, 'both the wire in and the wire out');
      off.forEach(p => assert.ok(p.getAttribute('stroke-dasharray'),
        'dashed as well as grey, so it reads as off on a dark canvas'));
    });

    test('the off colour is one no wire is ever assigned', () => {
      const h = boot();
      assert.ok(!h.app.EDGE_PALETTE.includes(h.app.EDGE_OFF_COLOR),
        'otherwise a wire of that colour reads as switched off');
    });

    test('the selection bar offers the way back', () => {
      const h = boot();
      const { f } = chain(h);
      h.app.setSelection([f.id]);
      assert.equal(h.q('#selOff').textContent, 'Switch off');

      h.app.toggleSelectionOff();
      h.app.setSelection([f.id]);
      assert.equal(h.q('#selOff').textContent, 'Switch on',
        'a button that appears to do nothing is worse than no button');
    });

    /* A CSS filter repaints the box-shadow it is applied to, so desaturating a
       switched-off shape also desaturates the blue selection ring drawn on it.
       The node then looked deselected the instant the key acted on it. Asserted
       against the stylesheet rather than a rendered colour because jsdom does
       not composite filters, and the scoping is the thing that must not be
       quietly dropped by a later edit. */
    test('a switched-off node that is selected still shows its ring', () => {
      assert.ok(/\.node-off:not\(\.selected\)\s+\.node-shape\s*\{[^}]*filter:/.test(CSS),
        'the drain must be scoped away from a selected node, or the ring goes grey with it');
      assert.ok(!/(^|\})\s*\.node-off\s+\.node-shape\s*\{[^}]*filter:/.test(CSS),
        'an unscoped drain would take the selection ring down with the colour');
    });

    test('a switched-off node is dashed whether or not it is selected', () => {
      assert.ok(/(^|\})\s*\.node-off\s+\.node-shape\s*\{[^}]*border-style:\s*dashed/.test(CSS),
        'the border is the signal that survives selection, so it cannot be scoped');
    });

    test('it is disabled when the selection holds nothing that can be switched', () => {
      const h = boot();
      const [s] = h.build('source', 'output');
      h.app.setSelection([s.id]);
      assert.ok(h.q('#selOff').disabled);
    });
  });
};
