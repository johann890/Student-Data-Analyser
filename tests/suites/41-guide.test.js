/* THE GUIDED WALKTHROUGH
   ===========================================================================
   A practice query is put on the canvas, and then the reader is walked around
   it. Nothing is asked of them: every step is about something already on the
   screen, so there is nothing to detect, nothing to wait for and no way to get
   stuck.

   That shape is what most of these assertions are protecting. An earlier design
   walked the reader through BUILDING a query and watched for each action, which
   needed two hooks into the application, a predicate per step, and the archive
   files to hand. The claims worth pinning now are much smaller:

     - the only write the feature makes is the practice query, and the reader
       asked for it. Everything after that reads and points.
     - it asks before replacing work, because there is no undo in this tool.
     - it survives its own target being deleted, since the practice query can be
       edited while the walkthrough is up.
     - it cannot throw on a page with no layout. jsdom returns zeros from every
       getBoundingClientRect(), which is exactly the input that puts NaN into a
       style property, and NaN in a style property is silent in a browser.

   What cannot be asserted here is where anything landed: nothing is laid out.
   The honest geometry question is which element a step resolved to, and that is
   asked two ways, through guideTargetEl() and through the data-guide-target
   attribute written onto the element itself.                                 */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const EM_DASH = '—';

  /* Started the way a reader starts it: press the button in the Help dialog.
     On an empty canvas that goes straight through, which is why the helper
     boots clean rather than building something first. */
  function walking() {
    const h = boot();
    h.w.openHelp(h.doc.querySelector('.help-btn'));
    h.w.startGuide(h.doc.getElementById('guideStartBtn'));
    return h;
  }

  /* Pressed rather than called. The panel's buttons are the one place in this
     page wired with addEventListener instead of an onclick attribute, because
     under runScripts: 'outside-only' an inline handler never fires, and a
     control the suite cannot press is a control it cannot vouch for. */
  function press(h, cls) {
    const btn = h.doc.querySelector('#guidePanel .' + cls);
    assert.ok(btn, 'no ' + cls + ' button on the panel');
    btn.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
    return btn;
  }

  const panelOn = h => h.doc.querySelector('#guidePanel').classList.contains('on');
  const spotOn  = h => h.doc.querySelector('#guideSpot').classList.contains('on');
  const nextBtn = h => h.doc.querySelector('#guidePanel .guide-next');

  // The graph as it would go to disk, minus the one field that always moves.
  function snapshot(h) {
    const g = h.app.serialiseGraph();
    delete g.savedAt;
    return JSON.stringify(g);
  }

  /* ══ 1. THE STEP DATA IS WELL FORMED ═════════════════════════════════════ */
  describe('the step data is well formed', () => {

    test('there are enough steps to be worth the button', () => {
      const h = boot();
      assert.ok(h.app.GUIDE_STEPS.length >= 5, 'too short to be a walkthrough');
    });

    test('step ids are unique', () => {
      const h = boot();
      const ids = h.app.GUIDE_STEPS.map(s => s.id);
      assert.deepEqual(ids.slice().sort(), [...new Set(ids)].sort(), 'duplicate step id');
    });

    test('a step points at one thing, never two', () => {
      const h = boot();
      h.app.GUIDE_STEPS.forEach(s =>
        assert.notOk(s.target && s.node, s.id + ' has both a selector and a node'));
    });

    test('every step has something to say, and no step asks for anything', () => {
      const h = boot();
      h.app.GUIDE_STEPS.forEach(s => {
        assert.ok(s.title && s.title.length, s.id + ' has no title');
        assert.ok(s.body && s.body.length, s.id + ' has no body');
        /* The whole point of this version. A doneWhen would mean the reader can
           be made to wait, which is the design that was taken out. */
        assert.equal(s.doneWhen, undefined, s.id + ' waits for the reader to do something');
        if (s.onEnter != null) assert.equal(typeof s.onEnter, 'function', s.id + ' onEnter');
        if (s.node != null)    assert.equal(typeof s.node, 'function', s.id + ' node');
      });
    });

    test('the practice query is one of the library examples, not a second copy', () => {
      const h = boot();
      const ex = h.app.libExampleGet(h.app.GUIDE_EXAMPLE);
      assert.ok(ex, 'GUIDE_EXAMPLE names an example that does not exist');
      assert.ok(ex.graph.nodes.length >= 3,
        'the practice query is too small to have three parts to talk about');
    });

    test('every selector a step names exists on the page', () => {
      const h = walking();
      h.app.GUIDE_STEPS.forEach(s => {
        if (!s.target) return;
        assert.ok(h.doc.querySelector(s.target),
          s.id + ' points at ' + s.target + ', which is not in the page');
      });
    });

    /* Each node a step asks for has to be IN the practice query, or the step
       rings nothing. This is the assertion that fails if the example is
       re-authored with a different shape. */
    test('every node a step asks for is in the practice query', () => {
      const h = walking();
      h.app.GUIDE_STEPS.forEach(s => {
        if (!s.node) return;
        assert.ok(s.node() !== null, s.id + ' asks for a node the practice query does not have');
      });
    });
  });

  /* ══ 2. STARTING IT ══════════════════════════════════════════════════════ */
  describe('starting it puts the practice query on the canvas', () => {

    test('the button lives in the Help dialog, in the first section', () => {
      const h = boot();
      const sec = h.doc.getElementById('help-guide');
      assert.ok(sec, 'there is no guide section in Help');
      const body = h.doc.getElementById('helpBody');
      assert.equal(body.querySelector('section'), sec,
        'the walkthrough is not the first thing in the dialog');
      const nav = h.doc.querySelector('#helpNav .help-navitem');
      assert.equal(nav.getAttribute('data-goto'), 'help-guide',
        'the nav does not lead with the walkthrough');
      assert.ok(sec.querySelector('#guideStartBtn'), 'the section has no start button');
    });

    test('pressing it loads the query, shuts Help and shows the panel', () => {
      const h = walking();
      const ex = h.app.libExampleGet(h.app.GUIDE_EXAMPLE);
      assert.equal(h.app.nodes.length, ex.graph.nodes.length, 'the practice query did not arrive');
      assert.notOk(h.app.helpOpen(), 'the walkthrough is running behind an open Help dialog');
      assert.ok(h.app.guideRunning());
      assert.ok(panelOn(h), 'the panel never appeared');
      assert.equal(h.app.guideStepId(), h.app.GUIDE_STEPS[0].id, 'it did not start at the start');
    });

    /* Starting it a second time takes two presses, because by then the practice
       query itself is on the canvas and counts as work to be asked about. That
       is consistent rather than clever: the button has no way to tell the
       practice query apart from something the reader built. */
    test('it always starts at step one, and never resumes', () => {
      const h = walking();
      press(h, 'guide-next');
      assert.equal(h.app.guideStepId(), h.app.GUIDE_STEPS[1].id);
      h.app.endGuide();

      h.w.openHelp(null);
      const btn = h.doc.getElementById('guideStartBtn');
      h.w.startGuide(btn);
      assert.ok(h.app.guidePendingNow(), 'it did not ask about the practice query it left behind');
      h.w.startGuide(btn);

      assert.ok(h.app.guideRunning(), 'the second press did not start it');
      assert.equal(h.app.guideStepId(), h.app.GUIDE_STEPS[0].id,
        'it resumed part way through, which it has no business remembering');
    });
  });

  /* ══ 3. IT ASKS BEFORE REPLACING WORK ════════════════════════════════════ */
  describe('it asks before replacing what is on the canvas', () => {

    test('a first press on a canvas with work on it only arms the button', () => {
      const h = boot();
      h.build('source', 'filter', 'output');
      const before = snapshot(h);
      h.w.openHelp(null);
      const btn = h.doc.getElementById('guideStartBtn');
      h.w.startGuide(btn);

      assert.equal(snapshot(h), before, 'it replaced the canvas without asking');
      assert.notOk(h.app.guideRunning(), 'it started anyway');
      assert.ok(h.app.helpOpen(), 'Help closed on the question');
      assert.ok(h.app.guidePendingNow(), 'nothing is armed, so the second press will ask again');
      assert.includes(btn.textContent.toLowerCase(), 'replace',
        'the button does not say it is waiting for an answer');
    });

    test('a second press goes through', () => {
      const h = boot();
      h.build('source', 'filter', 'output');
      h.w.openHelp(null);
      const btn = h.doc.getElementById('guideStartBtn');
      h.w.startGuide(btn);
      h.w.startGuide(btn);
      assert.ok(h.app.guideRunning(), 'the second press did not go through');
      assert.equal(h.app.nodes.length,
        h.app.libExampleGet(h.app.GUIDE_EXAMPLE).graph.nodes.length);
    });

    test('an empty canvas is not asked about, because there is nothing to lose', () => {
      const h = boot();
      h.w.openHelp(null);
      h.w.startGuide(h.doc.getElementById('guideStartBtn'));
      assert.ok(h.app.guideRunning(), 'it asked about an empty canvas');
    });

    test('leaving Help disarms the question', () => {
      const h = boot();
      h.build('source', 'output');
      h.w.openHelp(null);
      const btn = h.doc.getElementById('guideStartBtn');
      h.w.startGuide(btn);
      assert.ok(h.app.guidePendingNow(), 'it never armed');
      h.w.closeHelp();
      assert.notOk(h.app.guidePendingNow(),
        'a forgotten question is still armed behind a shut dialog');
      assert.includes(btn.textContent.toLowerCase(), 'start', 'the button still reads as armed');
    });
  });

  /* ══ 4. WALKING THROUGH IT ═══════════════════════════════════════════════ */
  describe('walking through it', () => {

    test('Next walks forward, Back walks back', () => {
      const h = walking();
      const ids = h.app.GUIDE_STEPS.map(s => s.id);
      press(h, 'guide-next');
      assert.equal(h.app.guideStepId(), ids[1]);
      press(h, 'guide-next');
      assert.equal(h.app.guideStepId(), ids[2]);
      press(h, 'guide-back');
      assert.equal(h.app.guideStepId(), ids[1]);
    });

    test('Next is never held back, because nothing is ever being waited for', () => {
      const h = walking();
      for (let i = 0; i < h.app.GUIDE_STEPS.length; i++) {
        assert.notOk(nextBtn(h).disabled, 'step ' + i + ' will not let the reader move on');
        if (i < h.app.GUIDE_STEPS.length - 1) press(h, 'guide-next');
      }
    });

    test('Back is held at the first step, because there is nowhere behind it', () => {
      const h = walking();
      assert.ok(h.doc.querySelector('#guidePanel .guide-back').disabled);
      press(h, 'guide-back');
      assert.equal(h.app.guideStepId(), h.app.GUIDE_STEPS[0].id);
    });

    test('the counter says where you are', () => {
      const h = walking();
      const n = h.app.GUIDE_STEPS.length;
      assert.equal(h.text('#guidePanel .guide-count'), '1 of ' + n);
      press(h, 'guide-next');
      assert.equal(h.text('#guidePanel .guide-count'), '2 of ' + n);
    });

    test('the last step offers Done, and Done ends it', () => {
      const h = walking();
      for (let i = 0; i < h.app.GUIDE_STEPS.length - 1; i++) press(h, 'guide-next');
      assert.equal(nextBtn(h).textContent, 'Done', 'the last step still says Next');
      press(h, 'guide-next');
      assert.notOk(h.app.guideRunning(), 'Done did not end it');
    });

    test('Close leaves from the middle', () => {
      const h = walking();
      press(h, 'guide-next');
      press(h, 'guide-quit');
      assert.notOk(h.app.guideRunning());
      assert.notOk(panelOn(h), 'the panel outlived the walkthrough');
      assert.notOk(spotOn(h), 'the ring outlived the walkthrough');
      assert.equal(h.doc.querySelectorAll('[data-guide-target]').length, 0,
        'the attribute outlived the walkthrough');
    });

    test('Escape leaves it, after Help and before the selection', () => {
      const h = walking();
      h.doc.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.notOk(h.app.guideRunning(), 'Escape did not leave the walkthrough');
    });

    test('with Help open, Escape closes Help first and leaves the walkthrough up', () => {
      const h = walking();
      h.w.openHelp(h.doc.querySelector('.help-btn'));
      h.doc.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.notOk(h.app.helpOpen(), 'Help stayed open');
      assert.ok(h.app.guideRunning(), 'Escape took both at once');
    });

    test('ending one that is not running is harmless', () => {
      const h = boot();
      h.app.endGuide();
      assert.notOk(h.app.guideRunning());
    });
  });

  /* ══ 5. IT POINTS, IT DOES NOT WRITE ═════════════════════════════════════ */
  describe('it points at the query, it does not write to it', () => {

    /* The load-bearing promise. The practice query arriving is the one write,
       and it happens before this snapshot is taken. */
    test('walking from end to end changes nothing', () => {
      const h = walking();
      const before = snapshot(h);
      const dataBefore = Object.keys(h.app.SOURCE_DATA || {}).length;
      for (let i = 0; i < h.app.GUIDE_STEPS.length - 1; i++) press(h, 'guide-next');
      press(h, 'guide-next');
      assert.equal(snapshot(h), before, 'a step wrote to the query it was describing');
      assert.equal(Object.keys(h.app.SOURCE_DATA || {}).length, dataBefore,
        'a step added or cleared source data');
    });

    test('the practice query is left behind when it ends', () => {
      const h = walking();
      const n = h.app.nodes.length;
      h.app.endGuide();
      assert.equal(h.app.nodes.length, n,
        'leaving took the practice query away, which the reader asked to have');
    });

    test('a toolbar step marks the real control', () => {
      const h = walking();
      const step = h.app.GUIDE_STEPS.find(s => s.target === '.run-btn');
      assert.ok(step, 'no step points at Run Query any more');
      h.app.guideGo(h.app.GUIDE_STEPS.indexOf(step));
      assert.equal(h.app.guideTargetEl(), h.doc.querySelector('.run-btn'));
      assert.ok(h.app.guideTargetEl().hasAttribute('data-guide-target'));
    });

    /* nodeEls is read off the window rather than through the test hook, because
       render() reassigns it wholesale and the harness bridges a fixed list. */
    test('a node step resolves through nodeEls, since no selector names a node', () => {
      const h = walking();
      const step = h.app.GUIDE_STEPS.find(s => s.node);
      h.app.guideGo(h.app.GUIDE_STEPS.indexOf(step));
      assert.equal(h.app.guideTargetEl(), h.w.nodeEls[step.node()],
        'the step did not find the node element');
    });

    test('only ever one thing is marked', () => {
      const h = walking();
      press(h, 'guide-next');
      press(h, 'guide-next');
      assert.equal(h.doc.querySelectorAll('[data-guide-target]').length, 1,
        'an earlier step left its mark behind');
    });

    /* The practice query can be edited while the walkthrough is up, so the step
       about a node has to survive that node being deleted. */
    test('a target that has gone takes the ring with it and leaves the panel', () => {
      const h = walking();
      const step = h.app.GUIDE_STEPS.find(s => s.node);
      h.app.guideGo(h.app.GUIDE_STEPS.indexOf(step));
      assert.ok(h.app.guideTargetEl(), 'nothing marked to begin with');

      h.w.removeNode(step.node());

      assert.equal(h.app.guideTargetEl(), null, 'it is still pointing at a deleted node');
      assert.notOk(spotOn(h), 'the ring is on with nothing to ring');
      assert.ok(panelOn(h), 'the copy is still worth reading and should still be up');
      assert.ok(h.app.guideRunning(), 'deleting a node ended the walkthrough');
    });
  });

  /* ══ 6. IT CANNOT THROW ON A PAGE WITH NO LAYOUT ═════════════════════════ */
  describe('placing it cannot throw on a page with no layout', () => {

    test('every step can be placed, and no NaN reaches a style property', () => {
      const h = walking();
      const spot = h.doc.getElementById('guideSpot');
      h.app.GUIDE_STEPS.forEach((s, i) => {
        h.app.guideGo(i);
        h.app.guidePlace();
        ['left', 'top', 'width', 'height'].forEach(k =>
          assert.excludes(String(spot.style[k]), 'NaN', s.id + ' put a NaN in ' + k));
      });
    });

    test('placing when nothing is running is harmless', () => {
      const h = boot();
      h.app.guidePlace();
      assert.notOk(h.app.guideRunning());
    });

    test('a zoom while it is up does not throw', () => {
      const h = walking();
      h.w.zoomIn();
      h.w.zoomOut();
      h.w.zoomToFit();
      assert.ok(h.app.guideRunning(), 'zooming ended the walkthrough');
    });
  });

  /* ══ 7. THE COPY ═════════════════════════════════════════════════════════ */
  describe('the copy says the right thing', () => {

    /* Behaviour and sentence as a pair, the way 26-help-text does it. A copy
       assertion on its own only holds the words still. */
    test('the step about wires says they are not drawn, and never says port', () => {
      const h = boot();
      const step = h.app.GUIDE_STEPS.find(s => /wire/i.test(s.title));
      assert.ok(step, 'nothing explains the wires any more');
      /* Nothing is clicked to start a wire and nothing is drawn by hand. Every
         other node graph tool works the other way, which is why this is the
         sentence most likely to drift. */
      assert.excludes(step.body.toLowerCase(), 'port');
      assert.includes(step.body.toLowerCase(), 'x on a wire');
    });

    test('the Run step makes the same promise Help makes', () => {
      const h = boot();
      const step = h.app.GUIDE_STEPS.find(s => s.target === '.run-btn');
      assert.includes(step.body, 'Run Query');
      assert.includes(step.body.toLowerCase(), 'nothing is calculated until you press');
      assert.includes(h.text('#help-start').toLowerCase(), 'nothing is calculated until you press',
        'Help and the walkthrough disagree about when work happens');
    });

    test('the Help section warns that it replaces the canvas, and the button does ask', () => {
      const h = boot();
      assert.includes(h.text('#help-guide').toLowerCase(), 'replaces what is on the canvas',
        'the section does not warn about the one thing the button destroys');
      h.build('source', 'output');
      h.w.openHelp(null);
      h.w.startGuide(h.doc.getElementById('guideStartBtn'));
      assert.ok(h.app.guidePendingNow(), 'the section promises a question that is not asked');
    });

    test('no step uses an em dash', () => {
      const h = boot();
      h.app.GUIDE_STEPS.forEach(s => {
        assert.excludes(s.title, EM_DASH, s.id + ' title');
        assert.excludes(s.body, EM_DASH, s.id + ' body');
      });
    });

    test('every body is a finished sentence', () => {
      const h = boot();
      h.app.GUIDE_STEPS.forEach(s =>
        assert.ok(/[.?]$/.test(s.body.trim()), s.id + ' does not end in a full stop'));
    });
  });
};
