/* Ticking a column on an Output answers without a run.

   The supervisor's words after the usability session were that the ticks
   changed and the output did not, and that he could not see what the tick
   boxes were there for in the first place. Two complaints, and the second is
   caused by the first: a control that does nothing visible is a control with no
   observable purpose, whatever the Help says about it.

   Every other tick box in the tool computes something, so a run is the honest
   answer for them and the panel says so beside the boxes. This one does not.
   engine.js says as much where outputTable() narrows ("Choosing which columns
   to look at changes no answer. It is a property of the view"), and the panel
   hint promises that Copy and Save follow the boxes. A box that answers only
   after Run Query breaks the engine's claim and the panel's promise at once.

   The exception is an Output that feeds another node. Then the narrowing is
   genuinely a computation for THAT branch, because what an Output shows is what
   it passes on. Both things are true at once, so the block is re-dressed AND
   the run is marked stale, rather than one being chosen over the other. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  function rig() {
    const h = boot();
    const [s, o] = h.build('source', 'output');
    h.w.runQuery();
    return { ...h, s, o };
  }

  // What the block on screen is actually showing, read from the DOM rather than
  // from the model, because the model being right while the screen is stale is
  // precisely the bug this suite exists for.
  const drawn = (h, id) =>
    h.qa('[data-output-view="' + id + '"] .rtable thead th').map(e => e.textContent.trim());

  // What Copy and Save would write.
  const exported = (h, id) => h.entry(id).table.columns.map(c => c.label);

  describe('the view is swappable', () => {
    test('a run wraps each Output block in a view element', () => {
      const r = rig();
      assert.equal(r.qa('[data-output-view="' + r.o.id + '"]').length, 1);
    });

    test('the wrapper sits inside the block, beside the query log', () => {
      const r = rig();
      const view = r.q('[data-output-view="' + r.o.id + '"]');
      assert.ok(view.closest('.result-block'), 'the view must live inside its block');
      assert.ok(r.q('.result-block .query-log'), 'the log is not swallowed by the view');
    });

    test('two Outputs get a wrapper each, keyed to their own node', () => {
      const h = boot();
      const [s, o1] = h.build('source', 'output');
      const o2 = h.add('output');
      h.app.connect(s.id, o2.id);
      h.w.render();
      h.w.runQuery();
      assert.equal(h.qa('[data-output-view]').length, 2);
      assert.ok(h.q('[data-output-view="' + o1.id + '"]'));
      assert.ok(h.q('[data-output-view="' + o2.id + '"]'));
    });

    test('the run keeps the table as it arrived, unnarrowed', () => {
      const r = rig();
      r.set(r.o.id, 'column:gpa', false);
      const e = r.entry(r.o.id);
      assert.includes(e.arrived.columns.map(c => c.key), 'gpa',
        'the arrived table is the one the view is re-derived from, so it keeps every column');
      assert.excludes(e.table.columns.map(c => c.key), 'gpa');
    });
  });

  describe('ticking answers immediately', () => {
    test('unticking a column removes it from the screen with no re-run', () => {
      const r = rig();
      const before = drawn(r, r.o.id);
      assert.includes(before, 'GPA');
      r.set(r.o.id, 'column:gpa', false);
      const after = drawn(r, r.o.id);
      assert.excludes(after, 'GPA', 'the block must redraw without Run Query');
      assert.equal(after.length, before.length - 1);
    });

    test('re-ticking puts it back, in header order rather than tick order', () => {
      const r = rig();
      const before = drawn(r, r.o.id);
      r.set(r.o.id, 'column:gpa', false);
      r.set(r.o.id, 'column:gpa', true);
      assert.deepEqual(drawn(r, r.o.id), before);
    });

    test('Copy and Save follow the boxes, as the hint promises', () => {
      const r = rig();
      r.set(r.o.id, 'column:gpa', false);
      assert.excludes(exported(r, r.o.id), 'GPA');
      assert.deepEqual(exported(r, r.o.id), drawn(r, r.o.id),
        'what is written must be what is drawn');
    });

    test('the rows are untouched, only the columns go', () => {
      const r = rig();
      const rows = r.entry(r.o.id).table.rows.length;
      r.set(r.o.id, 'column:gpa', false);
      assert.equal(r.entry(r.o.id).table.rows.length, rows);
    });

    test('several unticks compose', () => {
      const r = rig();
      const before = drawn(r, r.o.id).length;
      r.set(r.o.id, 'column:gpa', false);
      r.set(r.o.id, 'column:gender', false);
      assert.equal(drawn(r, r.o.id).length, before - 2);
    });
  });

  describe('what it does to the run', () => {
    test('a terminal Output stays fresh: nothing downstream to invalidate', () => {
      const r = rig();
      assert.ok(r.app.resultsFresh);
      r.set(r.o.id, 'column:gpa', false);
      assert.ok(r.app.resultsFresh, 'a pure view change must not ask for a run');
      assert.notOk(r.doc.getElementById('panelBody').classList.contains('stale'));
      assert.notOk(r.q('.stale-note'), 'nothing to re-run, so nothing to say');
    });

    test('an Output that feeds another node does stale the run', () => {
      const h = boot();
      const [s, o, f] = h.build('source', 'output', 'filter');
      h.w.runQuery();
      assert.ok(h.app.resultsFresh);
      h.set(o.id, 'column:gpa', false);
      assert.notOk(h.app.resultsFresh,
        'what an Output shows is what it passes on, so the branch below it is out of date');
      assert.ok(h.doc.getElementById('panelBody').classList.contains('stale'));
    });

    test('and is re-dressed anyway, because this block is not the stale part', () => {
      const h = boot();
      const [s, o, f] = h.build('source', 'output', 'filter');
      h.w.runQuery();
      h.set(o.id, 'column:gpa', false);
      assert.excludes(drawn(h, o.id), 'GPA',
        'marking stale is not a reason to leave the ticked box unanswered');
    });

    test('a Select keeps asking for a run: the same key, a different node', () => {
      const h = boot();
      const [s, sel, o] = h.build('source', 'select', 'output');
      h.w.runQuery();
      h.set(sel.id, 'column:gpa', false);
      assert.notOk(h.app.resultsFresh,
        'Select narrows the data itself, so it computes and must stale the run');
    });

    test('the Output show setting still stales the run', () => {
      const r = rig();
      r.set(r.o.id, 'show', 'count');
      assert.notOk(r.app.resultsFresh, 'a count is a computation, not a view of the rows');
    });
  });

  describe('when there is nothing to re-dress', () => {
    test('ticking before any run does not throw', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(o.id, 'column:gpa', false);
      assert.equal(o.cfg.cols.indexOf('gpa'), -1, 'the model still records the tick');
    });

    test('refreshOutputView reports that it could not', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      assert.notOk(h.app.refreshOutputView(o), 'no run, so no block and no export entry');
    });

    test('a hidden Output is still re-dressed, so turning it back on is current', () => {
      const r = rig();
      r.set(r.o.id, 'panel', false);
      r.set(r.o.id, 'column:gpa', false);
      r.set(r.o.id, 'panel', true);
      assert.excludes(drawn(r, r.o.id), 'GPA');
    });
  });

  describe('the boxes say what they are for', () => {
    const cfg = (h, id) => {
      const el = h.q('[data-node="' + id + '"][data-key^="column:"]');
      return el.closest('.node-config').textContent.replace(/\s+/g, ' ').trim();
    };

    test('an Output heads them "Columns to show"', () => {
      const r = rig();
      assert.includes(cfg(r, r.o.id), 'Columns to show');
    });

    test('and promises the update the code now delivers', () => {
      const r = rig();
      assert.includes(cfg(r, r.o.id), 'no re-run');
    });

    test('a Select heads them "Columns to keep" and asks for the run', () => {
      const h = boot();
      const [s, sel, o] = h.build('source', 'select', 'output');
      const t = cfg(h, sel.id);
      assert.includes(t, 'Columns to keep');
      assert.includes(t, 'Re-run the query');
    });

    test('the two groups do not read alike: they do different things', () => {
      const h = boot();
      const [s, sel, o] = h.build('source', 'select', 'output');
      h.w.runQuery();
      assert.excludes(cfg(h, o.id), 'Columns to keep');
      assert.excludes(cfg(h, sel.id), 'Columns to show');
    });

    test('an Output wired into something warns that the branch below needs a run', () => {
      const h = boot();
      const [s, o, f] = h.build('source', 'output', 'filter');
      assert.includes(cfg(h, o.id), 'does need a re-run');
    });

    test('and a terminal Output does not say it, because it is not true there', () => {
      const r = rig();
      assert.excludes(cfg(r, r.o.id), 'does need a re-run');
    });

    test('Compare heads its boxes "Columns to show" and asks for a run', () => {
      const h = boot();
      const [a] = h.build('source', 'filter');
      const b = h.add('filter');
      const cmp = h.add('compare');
      h.app.connect(a.id, cmp.id);
      h.app.connect(b.id, cmp.id);
      h.w.render();
      const el = h.q('[data-node="' + cmp.id + '"][data-key^="measure:"]');
      const t = el.closest('.node-config').textContent.replace(/\s+/g, ' ').trim();
      assert.includes(t, 'Columns to show');
      assert.includes(t, 'Each ticked box is one column');
      assert.includes(t, 'Re-run the query');
    });
  });
};
