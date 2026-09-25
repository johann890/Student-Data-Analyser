/* The results panel never outlives the graph it describes.

   The bug, as reported: load a saved query, delete every node, and the panel
   still reads "Loaded 4 nodes and 3 connections ... Press Run Query to evaluate
   it." beside a canvas that says "Add nodes using the toolbar above". Two
   halves of the screen disagreeing about whether there is a query.

   The cause is the first line of markStale(). It returns early when the results
   are already stale, which is the right shortcut for the note it adds and the
   wrong one for everything else: a load message, an error box and a set of
   result blocks all survive the deletion of every node that could explain them.
   Nothing else was watching, so whatever was in the panel stayed there.

   The rule these tests hold to is narrow and checkable: a block belongs to an
   Output, so a block whose Output is gone goes with it, and an empty canvas has
   no query to be stale about, so the panel goes back to where it starts. A
   graph that still has nodes in it keeps its message: "Loaded 4 nodes" is a
   statement about something that happened, and deleting one of them afterwards
   does not make it untrue. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

const START = 'Run a query to see results';

module.exports = ({ describe, test }) => {

  // A run with something in the panel to lose.
  function ran() {
    const h = boot();
    const [s, o] = h.build('source', 'output');
    h.w.runQuery();
    return { ...h, s, o };
  }

  // A graph that arrived from a file, which is the reported path.
  function loaded() {
    const h = boot();
    h.build('source', 'filter', 'output');
    const json = JSON.stringify(h.app.serialiseGraph());
    const b = boot();
    b.app.loadGraphFromText(json, b.doc.createElement('button'));
    return b;
  }

  const wipe = (h) => { h.app.selectAll(); h.app.deleteSelection(); };

  /* Read the opening line off its own element rather than comparing the whole
     panel. A failure here is a panel holding a table of eighty rows, and the
     useful report is "the placeholder is not there", not all eighty. */
  const opening = (h) => {
    const el = h.q('.panel-body .placeholder');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  };
  const backToStart = (h, note) => {
    assert.equal(h.qa('.result-block').length, 0, note || 'blocks left in the panel');
    assert.equal(opening(h), START, note || 'the panel is not back at its opening line');
  };

  describe('one opening line, in two places', () => {
    test('the constant is what the page ships with in its markup', () => {
      const h = boot();
      assert.equal(opening(h), START,
        'the panel markup and PANEL_START have drifted apart');
      assert.equal(h.app.PANEL_START, START);
    });
  });

  describe('the reported bug: delete every node after a load', () => {
    test('the load message is on screen to begin with', () => {
      const h = loaded();
      assert.includes(opening(h), 'Loaded 3 nodes');
    });

    test('deleting every node puts the panel back to its opening line', () => {
      const h = loaded();
      wipe(h);
      assert.equal(h.app.nodes.length, 0, 'the canvas really is empty');
      backToStart(h);
    });

    test('no trace of the loaded query is left in the panel', () => {
      const h = loaded();
      wipe(h);
      assert.excludes(opening(h), 'Loaded', 'the load message survived the deletion');
      assert.excludes(opening(h), 'Run Query to evaluate',
        'it still offers to evaluate a query that is not there');
    });
  });

  describe('results go when their Output goes', () => {
    test('deleting every node clears the result blocks', () => {
      const h = ran();
      assert.equal(h.qa('.result-block').length, 1);
      wipe(h);
      backToStart(h);
    });

    test('and clears what Copy and Save would have written', () => {
      const h = ran();
      assert.ok(h.entry(h.o.id), 'arranged: the run left an export entry');
      wipe(h);
      assert.equal(Object.keys(h.app.exportData).length, 0);
      assert.equal(h.app.resultsFresh, false);
    });

    test('deleting one Output of two takes only its block', () => {
      const h = boot();
      const [s, o1] = h.build('source', 'output');
      const o2 = h.add('output');
      h.app.connect(s.id, o2.id);
      h.w.render();
      h.w.runQuery();
      assert.equal(h.qa('.result-block').length, 2);

      h.app.setSelection([o2.id]);
      h.app.deleteSelection();
      assert.equal(h.qa('.result-block').length, 1);
      assert.ok(h.q('[data-output="' + o1.id + '"]'), 'the surviving Output keeps its block');
      assert.ok(!h.q('[data-output="' + o2.id + '"]'), 'the deleted one does not');
      assert.ok(!h.app.exportData[o2.id], 'and takes its export entry with it');
      assert.ok(h.app.exportData[o1.id], 'while the survivor keeps its own');
    });

    test('deleting the only Output empties the panel although nodes remain', () => {
      const h = ran();
      h.app.setSelection([h.o.id]);
      h.app.deleteSelection();
      assert.ok(h.app.nodes.length > 0, 'arranged: the Source is still there');
      backToStart(h);
    });
  });

  describe('the per-node delete button, not just the selection', () => {
    test('removeNode on the last node resets the panel', () => {
      const h = ran();
      h.w.removeNode(h.o.id);
      h.w.removeNode(h.s.id);
      assert.equal(h.app.nodes.length, 0);
      backToStart(h);
    });
  });

  describe('an error box is not a keepsake either', () => {
    test('a failed run followed by deleting everything leaves the opening line', () => {
      const h = boot();
      h.build('source');            // no Output, so the run refuses
      h.w.runQuery();
      assert.includes(h.panel(), 'Add an Output node');
      wipe(h);
      backToStart(h);
      assert.equal(h.qa('.error-box').length, 0, 'the error box outlived its graph');
    });
  });

  describe('what must NOT change', () => {
    test('a load message survives the deletion of one node out of three', () => {
      const h = loaded();
      h.app.setSelection([h.app.nodes[1].id]);
      h.app.deleteSelection();
      assert.includes(opening(h), 'Loaded 3 nodes',
        'a message about a past load is still true after one node goes');
    });

    test('deleting a node upstream of a live Output keeps the results and marks them stale', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.w.runQuery();
      h.app.setSelection([f.id]);
      h.app.deleteSelection();
      assert.equal(h.qa('.result-block').length, 1, 'the Output is still there, so its block is');
      assert.equal(h.app.resultsFresh, false);
      assert.ok(h.q('.stale-note'), 'and the block is marked stale');
    });

    test('clearing the canvas still ends at the same opening line', () => {
      const h = ran();
      h.w.clearAll();
      backToStart(h);
    });
  });
};
