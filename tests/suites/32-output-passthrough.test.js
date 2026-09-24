/* An Output that can be built on.
   ---------------------------------------------------------------------------
   Output used to be the one node with no way out of it. Every other node on the
   canvas composes with every other, and a user who reached an Output found the
   graph simply stopped: to narrow an answer they were looking at, they had to
   go back and rebuild the chain in front of it, which is the same query written
   twice. A usability test named this directly ("I could not apply a filter to
   the output of a result").

   The rule that settles what it means: what an Output SHOWS is what it passes
   on. The view is part of the graph rather than a coat of paint applied while
   rendering, so the table on screen and the table a node wired after it
   receives are one table and cannot drift apart. A Count emits its count; a row
   view narrowed to three columns emits three columns.

   The second half is the tick box. An Output used as a step is usually not also
   an answer worth the room, so it can be kept out of the results panel. That is
   a property of the view and of nothing else: it changes no table, and it must
   not invalidate a run. */

const fs = require('fs');
const path = require('path');
const { boot, APP_DIR } = require('../lib/harness');
const { assert } = require('../lib/assert');

const CSS = (() => {
  const f = fs.readdirSync(APP_DIR).filter(x => x.endsWith('.css'))[0];
  if (!f) throw new Error('no stylesheet found in ' + APP_DIR);
  return fs.readFileSync(path.join(APP_DIR, f), 'utf8');
})();

module.exports = ({ describe, test }) => {

  const A = boot().app;
  const ALL = A.studentsTable([]).columns.map(c => c.key);

  // source -> output, the shortest graph that has an Output with data on it.
  function rig() {
    const h = boot();
    const [s, o] = h.build('source', 'output');
    return { ...h, s, o };
  }

  // What a node actually receives when the graph runs, which is the question
  // every test in the middle section is really asking.
  const tableAt = (h, id) => h.app.evaluateGraph().res[id].table;
  const keysAt  = (h, id) => tableAt(h, id).columns.map(c => c.key);

  describe('wiring', () => {
    test('an Output takes wires out as well as in', () => {
      const app = boot().app;
      ['filter', 'sort', 'take', 'unique', 'select', 'project',
       'aggregate', 'combine', 'histogram', 'selectFor'].forEach(t => {
        assert.ok(app.canConnect('output', t), 'output -> ' + t + ' should be allowed');
      });
      assert.ok(app.canConnect('output', 'output'), 'an Output may feed another Output');
    });

    test('it is the same rule every other row node has, not a special case', () => {
      const app = boot().app;
      assert.deepEqual(app.CONNECT_RULES.output, app.CONNECT_RULES.filter,
        'a second, nearly-identical list is a place for the two to drift apart');
    });

    test('an Output still takes exactly one input', () => {
      const app = boot().app;
      const ports = app.portsOf('output');
      assert.equal(ports.length, 1);
      assert.notOk(ports[0].multi, 'taking wires out must not have made it multi-input');
    });

    test('a loop back through an Output is still refused', () => {
      /* Combine is the way to build one: it is multi-input, so it still has a
         free slot after the Output it feeds wires back into it. Letting an
         Output emit re-opens this, so the detector is worth a test rather than
         an assumption. */
      const h = boot();
      const [s, c, o] = h.build('source', 'combine', 'output');
      h.app.connect(o.id, c.id);
      const ev = h.app.evaluateGraph();
      assert.ok(ev.error, 'a cycle must be reported, not evaluated');
      assert.includes(ev.error, 'Circular');
    });
  });

  describe('what comes out of an Output', () => {
    test('a row view passes on the rows it is showing', () => {
      /* Reverse rather than Filter, because a fresh Filter carries a default
         criterion and is not a no-op: the rows that came out the far end would
         be fewer for a reason that has nothing to do with the Output. Reverse
         keeps every row and reorders them, so the two tables can be compared
         exactly. */
      const h = boot();
      const [s, o, rev] = h.build('source', 'output', 'reverse');
      const shown = tableAt(h, o.id);
      const after = tableAt(h, rev.id);

      assert.deepEqual(keysAt(h, rev.id), ALL);
      assert.equal(after.rows.length, shown.rows.length, 'no row is lost crossing an Output');
      assert.deepEqual(after.rows[0], shown.rows[shown.rows.length - 1],
        'and the rows that arrive are the rows that were shown');
    });

    test('a narrowed row view passes the columns it shows, not the ones that arrived', () => {
      const h = boot();
      const [s, o, f] = h.build('source', 'output', 'filter');
      ALL.filter(k => k !== 'id').forEach(k => h.set(o.id, 'column:' + k, false));

      assert.deepEqual(keysAt(h, o.id), ['id'], 'the Output emits its view');
      assert.deepEqual(keysAt(h, f.id), ['id'],
        'a node after a narrowed Output must see the narrowing, or the screen ' +
        'and the dataflow disagree about what came out of it');
    });

    test('a Count passes its count on, and counts once', () => {
      /* The regression this guards: the view used to be applied while rendering
         and is now applied while evaluating. Doing both would count the rows of
         a one-row count table and report 1 for every query ever run. */
      const h = boot();
      const [s, o] = h.build('source', 'output');
      const rows = tableAt(h, o.id).rows.length;
      h.set(o.id, 'show', 'count');
      h.w.runQuery();

      const t = tableAt(h, o.id);
      assert.deepEqual(t.columns.map(c => c.key), ['count']);
      assert.equal(t.rows[0][0], rows, 'the count of the rows that arrived');
      assert.equal(h.bigNum(), String(rows), 'and the same number on screen');
    });

    test('the schema walk and the evaluation agree about the columns', () => {
      /* The config panel of a node wired after an Output is built from the
         schema walk, and the rows it later receives come from the evaluation.
         A node offering a column it will never be handed is the bug this
         catches. */
      const h = boot();
      const [s, o, f] = h.build('source', 'output', 'filter');
      ALL.filter(k => k !== 'id' && k !== 'gpa').forEach(k => h.set(o.id, 'column:' + k, false));

      const arriving = h.app.inputSchema(f, h.app.computeSchemas()).columns.map(c => c.key);
      assert.deepEqual(arriving, ['id', 'gpa']);
      assert.deepEqual(keysAt(h, f.id), arriving,
        'what the panel promises and what the run delivers must be one list');
    });

    test('a Filter after an Output filters what that Output showed', () => {
      // The scenario the usability test asked for, end to end.
      const h = boot();
      const [s, o, f, o2] = h.build('source', 'output', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'specialisation');
      h.set(f.id, 'crit.0.value:specialisation', 'Cybersecurity');
      h.w.runQuery();

      const before = tableAt(h, o.id).rows.length;
      const after  = tableAt(h, o2.id).rows.length;
      assert.ok(after > 0, 'the filter should keep something');
      assert.ok(after < before, 'and should have narrowed what the first Output showed');
      assert.ok(h.entry(o2.id), 'the second Output is a result in its own right');
    });

    test('the OUTPUT step is logged once for each Output on the path', () => {
      const h = boot();
      const [s, o, f, o2] = h.build('source', 'output', 'filter', 'output');
      h.w.runQuery();

      const count = (id) => h.entry(id).log.filter(l => /OUTPUT/.test(l)).length;
      assert.equal(count(o.id), 1, 'logging it while rendering as well would print it twice');
      assert.equal(count(o2.id), 2, 'the data really did pass through two Outputs');
    });
  });

  describe('showing an Output in the panel', () => {
    test('a fresh Output is shown, and says so with a ticked box', () => {
      const r = rig();
      assert.equal(r.app.defaultCfg('output').panel, true);
      const box = r.control(r.o.id, 'panel');
      assert.ok(box, 'the Output panel should carry the tick box');
      assert.ok(box.checked);
    });

    test('unticking it hides that block and leaves the others alone', () => {
      const h = boot();
      const [s, o, f, o2] = h.build('source', 'output', 'filter', 'output');
      h.w.runQuery();
      assert.equal(h.qa('.result-block.result-hidden').length, 0);

      h.set(o.id, 'panel', false);
      const hidden = h.qa('.result-block.result-hidden');
      assert.equal(hidden.length, 1);
      assert.equal(hidden[0].getAttribute('data-output'), String(o.id));
    });

    test('hiding a block does not invalidate the run', () => {
      /* Being made to press Run Query again to get back a block you only asked
         to look away from would be a poor trade, and the answer on screen is
         still the answer. */
      const r = rig();
      r.w.runQuery();
      assert.ok(r.app.resultsFresh);
      r.set(r.o.id, 'panel', false);
      assert.ok(r.app.resultsFresh, 'a view setting must not stale the results');
      r.set(r.o.id, 'panel', true);
      assert.ok(r.app.resultsFresh);
    });

    test('the block comes back without another run', () => {
      const r = rig();
      r.w.runQuery();
      r.set(r.o.id, 'panel', false);
      r.set(r.o.id, 'panel', true);
      assert.equal(r.qa('.result-block.result-hidden').length, 0,
        'the blocks are drawn once and dressed, not rebuilt');
    });

    test('a note appears only when every Output is hidden', () => {
      const h = boot();
      const [s, o, f, o2] = h.build('source', 'output', 'filter', 'output');
      h.w.runQuery();
      const note = () => h.q('.all-hidden-note');
      assert.ok(note().classList.contains('result-hidden'), 'nothing to say while a block is visible');

      h.set(o.id, 'panel', false);
      assert.ok(note().classList.contains('result-hidden'), 'one of two hidden is not an empty panel');

      h.set(o2.id, 'panel', false);
      assert.notOk(note().classList.contains('result-hidden'),
        'an empty panel after a successful run must say which switch emptied it');

      h.set(o2.id, 'panel', true);
      assert.ok(note().classList.contains('result-hidden'));
    });

    test('a hidden Output still computes, and still feeds what is wired after it', () => {
      // Hiding is a view, not a mute. The chain has to keep working.
      const h = boot();
      const [s, o, f, o2] = h.build('source', 'output', 'filter', 'output');
      h.set(o.id, 'panel', false);
      h.w.runQuery();

      assert.ok(tableAt(h, o.id).rows.length > 0, 'a hidden Output is still evaluated');
      assert.ok(h.entry(o2.id).table.rows.length > 0,
        'and what it passes on still arrives');
    });

    test('hiding one Output does not renumber the others', () => {
      const h = boot();
      const [s, o, f, o2] = h.build('source', 'output', 'filter', 'output');
      h.w.runQuery();
      h.set(o.id, 'panel', false);

      const second = h.qa('[data-output="' + o2.id + '"] .result-block-label')[0];
      assert.equal(second.textContent.trim(), 'Output 2',
        'the labels name the Outputs, not the visible ones');
      assert.equal(h.entry(o2.id).index, 2);
    });
  });

  describe('the rule that actually hides it', () => {
    /* These assertions exist because the class went on correctly and the block
       stayed on screen anyway. A bare `.result-hidden { display: none }` ties on
       specificity with `.result-block { display: flex }` and loses to whichever
       is declared last, so every test that checked for the class passed while
       the panel was unchanged. Only the rendered page showed it. */
    function displayRulesFor(cls) {
      const out = [];
      const re = /([^{}]+)\{([^{}]*)\}/g;
      let m;
      while ((m = re.exec(CSS))) {
        const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
        const disp = /(?:^|;)\s*display:\s*([^;]+)/.exec(m[2]);
        if (disp && sel.split(',').some(x => x.trim().split(/\s+/).pop() === cls)) {
          out.push({ sel, display: disp[1].trim(), at: m.index });
        }
      }
      return out;
    }

    test('hiding a block beats the rule that lays the block out', () => {
      const hide = displayRulesFor('.result-block.result-hidden');
      assert.equal(hide.length, 1, 'exactly one rule should hide a result block');
      assert.equal(hide[0].display, 'none');

      const lay = displayRulesFor('.result-block');
      lay.forEach(r => {
        assert.ok(r.at < hide[0].at || hide[0].sel.includes('.result-block.result-hidden'),
          'a single-class hide would tie with ' + r.sel + ' and lose on order');
      });
    });

    test('the empty-panel note is hidden by a rule of its own', () => {
      const hide = displayRulesFor('.all-hidden-note.result-hidden');
      assert.equal(hide.length, 1);
      assert.equal(hide[0].display, 'none');
    });

    test('nothing relies on a bare .result-hidden', () => {
      const bare = /(^|\})\s*\.result-hidden\s*\{/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, ''));
      assert.notOk(bare,
        'a single-class rule is the version that was defeated by the cascade');
    });
  });

  describe('saving it', () => {
    test('a hidden Output is still hidden when the query is opened again', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(o.id, 'panel', false);

      const json = JSON.stringify(h.app.serialiseGraph());
      const b = boot();
      const g = b.app.deserialiseGraph(json);
      assert.equal(g.warnings.length, 0, g.warnings.join('; '));
      const out = g.nodes.find(n => n.type === 'output');
      assert.equal(out.cfg.panel, false);
    });

    test('a query saved before the setting existed shows its Output', () => {
      /* Every older file on anyone's disk is missing this key. The default has
         to be the visible one, or opening last term's query would present an
         empty panel. */
      const h = boot();
      const [s, o] = h.build('source', 'output');
      const g = h.app.serialiseGraph();
      g.nodes.forEach(n => { if (n.type === 'output') delete n.cfg.panel; });

      const b = boot();
      const loaded = b.app.deserialiseGraph(JSON.stringify(g));
      const out = loaded.nodes.find(n => n.type === 'output');
      assert.equal(out.cfg.panel, true);
      assert.notOk(b.app.hiddenInPanel(out));
    });

    test('a wire out of an Output survives the round trip', () => {
      const h = boot();
      const [s, o, f] = h.build('source', 'output', 'filter');
      const json = JSON.stringify(h.app.serialiseGraph());

      const b = boot();
      const g = b.app.deserialiseGraph(json);
      assert.equal(g.warnings.length, 0,
        'the loader validates wires against CONNECT_RULES: ' + g.warnings.join('; '));
      assert.ok(g.connections.some(c => c.from === o.id && c.to === f.id),
        'the wire out of the Output must load, not be dropped as illegal');
    });
  });
};
