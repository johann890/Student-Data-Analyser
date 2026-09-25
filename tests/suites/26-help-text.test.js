/* WHERE AN EXPLANATION LIVES
   ===========================================================================
   The supervisor's note, in his words: the space a Select For node needs with
   all its explanation text is unacceptable; a panel should "at most" name the
   roles of the inputs and the outputs; justifications do not belong on a node;
   and the longer descriptions belong in Help, "in the style of Excel function
   documentation, i.e., explaining the function and providing sample usage
   scenarios (with sample inputs and outputs)".

   That is a placement rule, not a deletion, and placement is the thing a test
   can hold still. Three claims are worth pinning:

     - a panel states the shape of what comes out, and stays short doing it
     - a hint that describes an empty PORT disappears once the port is wired,
       because a wired port describes itself
     - the material taken off the panels is in Help, with a worked example

   The fourth is the reason the whole reduction was safe to make: Compare's
   tick boxes looked dead to him ("I tried ticking and unticking them and it
   did not seem to make a difference to the output"). They were not dead. The
   result on screen was stale and said so in a sentence about exporting, and
   the panel never named the columns the boxes control. Both are fixed, and
   both are asserted here: the panel now follows the boxes with no run at all,
   which is what makes them legible.                                          */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const panelsText = h => h.qa('.node-config').map(e => e.textContent).join(' ');

  // Every node that carries a config panel worth measuring, wired to a Source
  // so the panel is in its ordinary state rather than its empty one.
  const WIRED = ['filter', 'sort', 'reverse', 'take', 'unique', 'select',
                 'project', 'aggregate', 'aggregateColumns', 'aggregateRows',
                 'histogram'];

  function wired(type) {
    const h = boot();
    const src = h.add('source'), n = h.add(type), out = h.add('output');
    h.app.connect(src.id, n.id);
    h.app.connect(n.id, out.id);
    h.w.render();
    return { ...h, src, n, out };
  }

  /* The hints belonging to one node, rather than every hint on the canvas.
     Found by position rather than by a control, because Reverse has no
     controls to find it by and is exactly the node this has to work for:
     render() appends one .node per entry of app.nodes, in that order. */
  function nodeElFor(h, nodeId) {
    const i = h.app.nodes.findIndex(n => n.id === nodeId);
    return i === -1 ? null : h.qa('.node')[i];
  }

  function hintsOn(h, nodeId) {
    const el = nodeElFor(h, nodeId);
    if (!el) return [];
    return [...el.querySelectorAll('.cmp-hint')].map(d => d.textContent.trim());
  }

  /* The budget measures EXPLANATION, which is what the note was about. A
     warning is not explanation: Project's says a row stops being a student and
     a count after it counts enrolments, which is the one message in the tool
     whose absence makes a later number wrong by a factor of eight. It carries
     its own class already, and it is excluded here rather than squeezed. */
  function helpHintsOn(h, nodeId) {
    const el = nodeElFor(h, nodeId);
    if (!el) return [];
    return [...el.querySelectorAll('.cmp-hint:not(.proj-warn)')]
      .map(d => d.textContent.trim());
  }

  describe('a panel says what comes out, briefly', () => {

    /* A budget rather than a wording check, because the requirement he gave is
       about SPACE. Wording is free to change; the size is the promise. 240 is
       set above what every panel currently needs and far below what the worst
       of them used to take (Histogram's boundary paragraph alone was 260). */
    const BUDGET = 240;

    WIRED.forEach(type => {
      test(type + ' keeps its hints inside the budget', () => {
        const h = wired(type);
        const chars = helpHintsOn(h, h.n.id).join(' ').length;
        assert.ok(chars <= BUDGET,
          type + ' spends ' + chars + ' characters on hints, over the ' +
          BUDGET + ' a node panel is allowed');
      });
    });

    test('Select For, the node the note was written about, is the shortest of them', () => {
      const h = boot();
      const src = h.add('source'), sf = h.add('selectFor'), out = h.add('output');
      h.app.connect(src.id, sf.id, null, 'data');
      h.app.connect(sf.id, out.id);
      h.w.render();
      const chars = helpHintsOn(h, sf.id).join(' ').length;
      assert.ok(chars <= BUDGET,
        'Select For spends ' + chars + ' characters, over the ' + BUDGET + ' allowed');
    });

    test('the warning the budget excludes is still on the node', () => {
      const h = wired('project');
      const warn = nodeElFor(h, h.n.id).querySelector('.proj-warn');
      assert.ok(warn, 'Project lost the notice that a row stops being a student');
      assert.includes(warn.textContent, 'counts enrolments',
        'the factor-of-eight warning is the one hint that may not be trimmed away');
    });

    test('the shape of the result is still stated, on every node that changes it', () => {
      [['aggregate', 'Out: one row, one column'],
       ['aggregateColumns', 'Out: one row'],
       ['aggregateRows', 'Out: one column'],
       ['unique', 'Out:'],
       ['select', 'Out:'],
       ['take', 'Out:'],
       ['histogram', 'Out: one row per band']].forEach(([type, want]) => {
        const h = wired(type);
        assert.includes(hintsOn(h, h.n.id).join(' '), want,
          type + ' no longer says what it produces');
      });
    });

    test('no panel argues with the reader', () => {
      // The justifications he objected to, by their tell: a panel explaining
      // why it is the way it is rather than what it does.
      const BANNED = ['That is the reason', 'which is the gap', 'because it no longer',
                      'came to see', 'so two years binned'];
      WIRED.concat(['compare', 'combine', 'selectFor']).forEach(type => {
        const h = wired(type);
        const text = hintsOn(h, h.n.id).join(' ');
        BANNED.forEach(phrase => {
          assert.excludes(text, phrase, type + ' still argues: "' + phrase + '"');
        });
      });
    });
  });

  describe('a hint about an empty port goes away once the port is wired', () => {

    /* Reverse is the exception and is worth stating as one. Everywhere else a
       hint gives way to a control that says the same thing; Reverse has no
       controls at all, so there is nothing for it to give way to. Its hint
       keeps naming the Take pairing whether or not it is wired. */
    test('Reverse keeps its pairing in both states, having no control to defer to', () => {
      const h = boot();
      const rev = h.add('reverse');
      h.w.render();
      assert.includes(hintsOn(h, rev.id).join(' '), 'Take',
        'an unwired Reverse has to say what it is for');

      const wiredRev = wired('reverse');
      assert.includes(hintsOn(wiredRev, wiredRev.n.id).join(' '), 'Take',
        'a wired Reverse still has no control that names the pairing');
    });

    test('Select For drops the Labels sentence when Labels arrives', () => {
      const h = boot();
      const src = h.add('source'), sf = h.add('selectFor'), out = h.add('output');
      h.app.connect(src.id, sf.id, null, 'data');
      h.app.connect(sf.id, out.id);
      h.w.render();
      assert.includes(panelsText(h), 'Unconnected');

      const uq = h.add('unique');
      h.app.connect(src.id, uq.id);
      h.app.connect(uq.id, sf.id, null, 'labels');
      h.w.render();
      assert.excludes(panelsText(h), 'Unconnected',
        'a wired port describes itself through its own picker');
    });

    test('Histogram drops the width sentence once a width is typed', () => {
      const h = wired('histogram');
      assert.includes(hintsOn(h, h.n.id).join(' '), 'chosen from the data');
      h.set(h.n.id, 'width', '1');
      h.w.render();
      assert.excludes(hintsOn(h, h.n.id).join(' '), 'chosen from the data',
        'a typed width states itself');
    });
  });

  describe('Compare’s tick boxes are legible without running anything', () => {

    function comparison() {
      const h = boot();
      const s1 = h.add('source'), s2 = h.add('source'), c = h.add('compare'),
            o = h.add('output');
      h.app.connect(s1.id, c.id);
      h.app.connect(s2.id, c.id);
      h.app.connect(c.id, o.id);
      h.w.render();
      return { ...h, c, o };
    }

    test('the panel names the columns the boxes produce', () => {
      const h = comparison();
      const text = hintsOn(h, h.c.id).join(' ');
      assert.includes(text, 'Out: one row per branch');
      assert.includes(text, 'Students');
      assert.includes(text, 'Avg grade');
    });

    /* The heart of it. Unticking a box changed the answer all along, but the
       result on screen was the previous run's and nothing on the panel moved,
       so the control looked inert. It no longer does: the panel follows the
       box immediately, with no runQuery() in this test at all. */
    test('unticking a measure takes its column out of the panel, with no re-run', () => {
      const h = comparison();
      h.set(h.c.id, 'measure:average', false);
      h.w.render();
      const text = hintsOn(h, h.c.id).join(' ');
      assert.includes(text, 'Students', 'the measure still ticked must stay');
      assert.excludes(text, 'Avg grade', 'the unticked measure must leave the header');
    });

    test('and the run agrees with what the panel promised', () => {
      const h = comparison();
      h.set(h.c.id, 'measure:average', false);
      h.w.render();
      h.w.runQuery();
      const keys = h.entry(h.o.id).table.columns.map(c => c.key);
      assert.excludes(keys.join(','), 'average',
        'the panel and the result have to describe one table');
    });

    /* The sentence that made a live control look dead. It spoke about exports,
       so a number on screen that was out of date read as a warning about
       files. It has to name the results themselves. */
    test('the staleness note is about the results, not only the export', () => {
      const h = comparison();
      h.w.runQuery();
      h.set(h.c.id, 'measure:average', false);
      const note = h.doc.querySelector('.stale-note');
      assert.ok(note, 'editing a config after a run has to raise the note');
      assert.includes(note.textContent, 'results',
        'the note has to say the numbers on screen are out of date');
    });
  });

  /* THE HELP MAY NOT PROMISE BEHAVIOUR THE CODE DOES NOT HAVE
     -------------------------------------------------------------------------
     Two claims were found to be false on 2026-09-25, both about things a user
     would try once and then stop trusting the Help over:

       "Drag it away again and the wire goes", plus a shortcut table row saying
       a node dragged away breaks the wire. Nothing removes a connection except
       the x badge, removeNode() and deleteSelection(). The gesture invites the
       belief (dragging together IS how a wire is made) which is what makes the
       sentence expensive: a user drags the nodes apart, sees the wire hold, and
       now has to work out which of the two the tool got wrong.

       "Every node shows its own row count after a run." No node shows one. The
       count is on the wire preview and on the block in the results panel.

     Each is pinned here as a pair: what the code does, and what the Help says
     about it. A copy assertion on its own would only pin the words; a behaviour
     assertion on its own would not notice the words drifting back. */
  describe('the Help does not promise what the code will not do', () => {

    const helpText = h => h.doc.querySelector('.help-body').textContent;

    const mouse = (h, type, x, y) =>
      new h.w.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });

    // The real gesture, dragging one node a long way from the other.
    function dragFar(h, node) {
      const i = h.app.nodes.indexOf(node);
      const shape = h.qa('#viewport .node')[i].querySelector('.node-shape');
      shape.dispatchEvent(mouse(h, 'mousedown', 100, 100));
      h.doc.dispatchEvent(mouse(h, 'mousemove', 900, 700));
      h.doc.dispatchEvent(mouse(h, 'mouseup', 900, 700));
    }

    test('dragging a wired node away leaves the wire in place', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      assert.equal(h.app.connections.length, 1, 'arranged: they are wired');
      dragFar(h, o);
      assert.ok(Math.abs(o.x - s.x) > 400, 'arranged: it really did move away');
      assert.equal(h.app.connections.length, 1,
        'the wire went on its own, so the Help was right and this test is wrong');
    });

    test('and the Help does not say it goes', () => {
      const help = helpText(boot());
      assert.excludes(help, 'Drag it away again and the wire goes');
      assert.excludes(help, 'Break the wire');
    });

    test('the x on the wire is what removes it, and the Help says so', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      const c = h.app.connections[0];
      h.app.removeConnection(c.from, c.to, c.port);
      assert.equal(h.app.connections.length, 0);
      assert.includes(helpText(h), 'click the x',
        'the only way to remove a wire is not written down');
    });

    test('no node shows a row count after a run, so the Help claims none', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.w.runQuery();
      const rows = h.app.exportData[o.id].table.rows.length;
      assert.ok(rows > 0, 'arranged: the run produced rows');
      /* The shapes, not the whole panel. A Source panel legitimately states the
         row count of the FILES it holds, which is a fact about the data and not
         about the run, so reading the panels would confuse the two. */
      const shapes = h.qa('#viewport .node-shape').map(e => e.textContent).join(' ');
      assert.ok(shapes.length > 0, 'arranged: the shapes are on screen');
      assert.excludes(shapes, String(rows),
        'a node does show its count now, so the Help may say so again');
      assert.excludes(helpText(h), 'Every node shows its own row count');
    });

    test('the two places a count IS shown are the two the Help names', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.w.runQuery();
      const rows = h.app.exportData[o.id].table.rows.length;

      // On the block in the panel, as a badge beside the table.
      assert.includes(h.panel(), 'Rows ' + rows);

      // On the wire, which is what the preview counts.
      const t = h.app.edgeData(h.app.connections[0]).table;
      assert.equal(t.rows.length, rows, 'the edge carries what the Output received');

      const help = helpText(h);
      assert.includes(help, 'Hovering a wire shows the rows');
      assert.includes(help, 'row count of what reached its Output');
    });
  });

  describe('what came off the panels is in Help, with an example', () => {

    const helpText = h => h.doc.querySelector('.help-body').textContent;

    test('every node in the reference carries a worked example', () => {
      const h = boot();
      const defs = [...h.doc.querySelectorAll('.help-defs dt')];
      assert.ok(defs.length >= 13, 'the node reference lost entries');
      defs.forEach(dt => {
        const dd = dt.nextElementSibling;
        assert.ok(dd && dd.querySelector('.help-eg'),
          dt.textContent + ' has no worked example');
      });
    });

    test('an example shows a table in and a table out', () => {
      const h = boot();
      [...h.doc.querySelectorAll('.help-eg')].forEach((eg, i) => {
        const sides = eg.querySelectorAll('.help-eg-side table');
        assert.equal(sides.length, 2,
          'example ' + i + ' does not show both an input and an output');
        sides.forEach(t => {
          assert.ok(t.querySelectorAll('th').length, 'an example table has no header');
          assert.ok(t.querySelectorAll('tr').length > 1, 'an example table has no rows');
        });
        assert.ok(eg.querySelector('.help-eg-note'),
          'example ' + i + ' does not say which settings produced it');
      });
    });

    /* The explanations taken off panels in this change. Each one is true on
       every render and needed once, which is what made it reference material;
       none of them may simply have been deleted. */
    test('the explanations that left the panels are still written down', () => {
      const help = helpText(boot());
      [['band above', 'the histogram boundary rule'],
       ['multiple of the width', 'why bands do not start at the smallest value'],
       ['count of zero', 'what the Labels port buys']
      ].forEach(([phrase, what]) => {
        assert.includes(help, phrase, what + ' is documented nowhere now');
      });
    });

    /* His question, in his words: "how do I supply a (manually crafted)
       one-column table?" He went looking for a file and found the Source
       refusing one, because a Source reads the archive and nothing else. The
       route that does exist is Unique, and Help has to name it where the
       question is asked rather than leaving it to be discovered. */
    test('the Labels entry names the node that makes a one-column table', () => {
      const h = boot();
      const dt = [...h.doc.querySelectorAll('.help-defs dt')]
        .find(d => d.textContent.trim() === 'Select For');
      assert.ok(dt, 'the Select For entry is gone');
      const dd = dt.nextElementSibling.textContent;
      assert.includes(dd, 'Unique',
        'the one-column table has to be shown to come from somewhere');
    });
  });
};
