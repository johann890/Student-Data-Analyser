/* THE TOOLBAR'S HEIGHT: the handle under the bar, and the arithmetic behind it.

   The bar can be dragged taller and its controls grow with it. Two things make
   that harder than setting a height:

     - the controls wrap. Somewhere between the default size and the ceiling
       they stop fitting on one row and the bar gains a whole row at once, at a
       point that depends on the window width and on what is in the bar. Nothing
       predicts it; the sizes are applied to the real bar and the heights are
       written down
     - so no arrangement has a height in between, and a drag through that point
       would jump a whole row. The difference is made up with padding, which is
       what lets the bar follow the pointer smoothly across the wrap

   jsdom does no layout, so the measuring itself cannot be tested here: that is
   done in a browser. What IS tested here is everything the measurement feeds,
   with the heights supplied by standing in for the bar's own measurement. Each
   test therefore describes a bar of a stated shape and asks what the code does
   about it, rather than hoping the environment produces one.

   The structural half needs no layout at all: which menus exist, where the
   break is, and that the groups are the thing that wraps. */

const { boot, withoutStorage, appStyles } = require('../lib/harness');
const { assert } = require('../lib/assert');

const CSS = appStyles();

module.exports = ({ describe, test }) => {

  /* A bar of a known shape. `heights` maps a size to the height the bar would
     be at that size, so a test can describe a wrap ("one row until 1.2, two
     rows after") and check what the code makes of it. Everything else about
     the measurement is left alone. */
  function withBar(h, heightFor) {
    const t = h.doc.getElementById('toolbar');
    const scaleNow = () =>
      Number(h.doc.documentElement.style.getPropertyValue('--bar-s') || 1);
    t.getBoundingClientRect = () => ({
      height: heightFor(scaleNow()), width: 1280, top: 0, left: 0, right: 1280,
      bottom: heightFor(scaleNow())
    });
    h.app.barStepsDrop();
    return t;
  }

  // One row up to 1.2, two rows after it: the real shape at a laptop width.
  const wrapping = s => (s <= 1.2 ? Math.round(44 * s) : Math.round(44 * s) + 52);

  /* This suite used to bring its own localStorage, because jsdom is built with
     no origin and has none. The harness supplies one now — the query library
     needs it, and a facility jsdom lacks belongs at the same seam as the
     download and clipboard shims rather than in whichever suite noticed first.
     So `withStorage` is gone and `boot()` already has somewhere to remember.

     The test that storage may be absent altogether now says so with
     `withoutStorage`, rather than relying on jsdom's silence. */

  function sized(innerHeight) {
    const h = boot();
    Object.defineProperty(h.w, 'innerHeight', { value: innerHeight, configurable: true });
    withBar(h, wrapping);
    return h;
  }

  /* ------------------------------------------------------------- structure */

  describe('the bar is built to be resized', () => {
    test('there is a handle under it, and it says what it is', () => {
      const h = boot();
      const grip = h.doc.getElementById('toolbarResize');
      assert.ok(grip, 'no handle');
      assert.equal(grip.getAttribute('role'), 'separator');
      assert.equal(grip.getAttribute('aria-orientation'), 'horizontal');
      assert.ok(grip.hasAttribute('tabindex'),
        'a separator that cannot be focused cannot be resized without a mouse');
    });

    test('the handle sits between the bar and the canvas, not inside either', () => {
      // Which is what makes a taller bar shorten the canvas rather than cover it.
      const h = boot();
      const bar = h.doc.getElementById('toolbar');
      const grip = h.doc.getElementById('toolbarResize');
      const main = h.doc.querySelector('.main');
      assert.equal(grip.previousElementSibling, bar);
      assert.equal(grip.nextElementSibling, main);
    });

    test('the controls are grouped, and the groups are what wrap', () => {
      /* A wrap between groups keeps a heading with its buttons. Left to the
         controls themselves it lands wherever the row runs out, which strands
         QUERY at the end of one row and Save at the start of the next. */
      const h = boot();
      const groups = h.qa('.tgroup');
      assert.ok(groups.length >= 3, 'the bar is not grouped');
      groups.forEach(g => assert.ok(g.children.length >= 1, 'an empty group'));
      // Every control in the bar is inside a group or is Run Query, which is
      // pushed to the corner on its own. Anything else would wrap by itself.
      h.qa('.toolbar > button').forEach(b =>
        assert.includes(b.className, 'run-btn', b.className + ' is a loose control in the bar'));
    });

    test('the break is a real element, before the Query group', () => {
      const h = boot();
      const brk = h.doc.querySelector('.tbreak');
      assert.ok(brk, 'no break element, so the wrap point is whatever flex decides');
      const after = brk.nextElementSibling;
      // The divider is hidden while stacked, so Query is what follows it.
      const text = (after.textContent + (after.nextElementSibling || {}).textContent) || '';
      assert.includes(text.toLowerCase(), 'query',
        'the break is not in front of the Query group');
    });

    /* Every dropdown the bar carries, node menus and the variables menu alike.
       The claim is about the bar rather than about what is behind any one
       button, so a dropdown added later is covered by being added. */
    test('every dropdown is inside the bar and survives its resizing', () => {
      const h = boot();
      const ids = h.qa('.proc-menu').map(m => m.id).sort();
      assert.deepEqual(ids, ['distMenu', 'procMenu', 'reshapeMenu', 'varDock']);
      h.qa('.proc-menu').forEach(m =>
        assert.ok(m.closest('.toolbar'), m.id + ' is not in the bar'));
      /* Each hangs off its own button rather than off the bar, so a bar that
         has grown taller or wrapped still opens its menus under them. */
      h.qa('.proc-menu').forEach(m =>
        assert.ok(m.closest('.proc-wrap'), m.id + ' is not anchored to a button'));
    });
  });

  /* ------------------------------------------------------- the view dock */

  describe('the view controls sit on the canvas, not in the bar', () => {
    test('zoom and Fit are in a dock on the canvas', () => {
      const h = boot();
      const dock = h.doc.getElementById('viewDock');
      assert.ok(dock, 'no view dock');
      assert.ok(dock.closest('.canvas'), 'the dock is not on the canvas');
      assert.notOk(dock.closest('.toolbar'), 'the dock is still in the bar');
      assert.ok(dock.querySelector('#zoomLevel'), 'no zoom readout');
      assert.equal(dock.querySelectorAll('.zoom-btn').length, 2, 'zoom in and out');
      assert.ok([...dock.querySelectorAll('button')].some(b => /Fit/.test(b.textContent)),
        'no Fit button');
    });

    test('nothing about the view is left in the bar', () => {
      const h = boot();
      const bar = h.doc.getElementById('toolbar');
      assert.notOk(bar.querySelector('.zoom-group'), 'the zoom group is still in the bar');
      assert.notOk(/Fit/.test(bar.textContent), 'Fit is still in the bar');
      assert.notOk(/VIEW/i.test(bar.textContent), 'the View heading outlived its group');
    });

    test('each button is still wired to the view function it names', () => {
      /* jsdom is built with scripts off, so an inline handler never runs here
         and clicking would prove nothing. What the markup promises is checked
         instead, and the functions themselves below. */
      const h = boot();
      const dock = h.doc.getElementById('viewDock');
      const wired = [...dock.querySelectorAll('button')]
        .map(b => (b.getAttribute('onclick') || '').replace(/\(\)$/, ''));
      assert.deepEqual(wired, ['zoomOut', 'zoomReset', 'zoomIn', 'zoomToFit']);
      wired.forEach(fn => assert.ok(typeof h.w[fn] === 'function',
        fn + ' is named by a button and is not a function'));
    });

    test('the readout follows the zoom the dock sets', () => {
      const h = boot();
      const read = () => h.doc.getElementById('zoomLevel').textContent;
      h.w.zoomIn(); h.w.render();
      assert.notOk(read() === '100%', 'zoom in did not move the readout');
      h.w.zoomReset(); h.w.render();
      assert.equal(read(), '100%', 'the readout does not return to 100%');
      h.w.zoomOut(); h.w.render();
      assert.notOk(read() === '100%', 'zoom out did not move the readout');
      h.w.zoomToFit(); h.w.render();
      assert.ok(read().endsWith('%'), 'Fit left the readout unreadable');
    });

    test('a press on the dock is not a press on the canvas', () => {
      /* It sits inside the canvas element, so without this a click on Fit
         would also start a marquee and clear the selection behind it. */
      const h = boot();
      const dock = h.doc.getElementById('viewDock');
      assert.notOk(h.app.isCanvasBackground(dock), 'the dock reads as empty canvas');
      dock.querySelectorAll('*').forEach(el =>
        assert.notOk(h.app.isCanvasBackground(el), el.className + ' reads as empty canvas'));
    });

    test('the selection bar steps up when the canvas is too narrow for both', () => {
      /* At the panel's full width the canvas is down to its floor, and the two
         overlays do not fit in one row. jsdom evaluates no container queries,
         so what is checked here is that the rule exists and that it is placed
         where it can win: a container query carries no specificity of its own,
         so written above `.sel-bar` it loses to it on source order and does
         nothing at all. That is exactly how it was written the first time. */
      assert.includes(CSS, 'container-type: inline-size',
        'the canvas is not a container, so the bar cannot answer to its width');
      const rule = CSS.indexOf('@container');
      const plain = CSS.indexOf('.sel-bar {');
      assert.ok(rule > -1, 'no container query for the narrow case');
      assert.ok(rule > plain,
        'the container query is above the rule it overrides, so it never wins');
    });

    test('it keeps out of the selection bar\'s corner', () => {
      // Both are bottom-anchored overlays and both are on screen at once
      // whenever someone zooms with nodes selected.
      const h = boot();
      const dock = h.doc.getElementById('viewDock');
      const bar = h.doc.getElementById('selBar');
      assert.ok(dock.closest('.canvas') && bar.closest('.canvas'));
      assert.notOk(dock === bar.parentElement || bar === dock.parentElement);
    });
  });

  /* -------------------------------------------------- the panel's ceiling */

  describe('the results panel leaves the canvas something to work with', () => {
    function atWidth(px) {
      const h = boot();
      Object.defineProperty(h.w, 'innerWidth', { value: px, configurable: true });
      return h;
    }

    test('the widest panel still leaves the canvas its minimum', () => {
      [1024, 1280, 1440, 1920].forEach(w => {
        const A = atWidth(w).app;
        const max = A.panelMaxWidth();
        assert.equal(w - max - A.HANDLE_W, A.CANVAS_MIN,
          'at ' + w + 'px the canvas is left with the wrong amount');
      });
      /* The share the panel can take rises with the window, because the floor
         is a number of pixels rather than a fraction: a canvas is unusable
         below a certain size, not below a certain proportion. Pinned at the
         laptop width this is mostly used at. */
      [[1280, 0.7], [1024, 0.65]].forEach(([w, cap]) => {
        const A = atWidth(w).app;
        const share = A.panelMaxWidth() / w;
        assert.ok(share <= cap,
          'at ' + w + 'px the panel can take ' + Math.round(100 * share) + '% of the window');
      });
    });

    test('the canvas floor is what sets the ceiling, and it is not a token amount', () => {
      /* Raised from 320, which let the panel take about three quarters of a
         1280px window and left the canvas holding barely two nodes side by
         side. This is the number that decision lives in. */
      const A = boot().app;
      assert.ok(A.CANVAS_MIN >= 400, 'the canvas floor is back where it was');
    });

    test('a width past the ceiling is clamped rather than honoured', () => {
      const A = atWidth(1280).app;
      assert.equal(A.clampPanelWidth(99999), A.panelMaxWidth());
      assert.equal(A.clampPanelWidth(10), A.PANEL_MIN, 'and it has a floor of its own');
    });

    /* The Wide preset this used to pin is gone with the Wide button. What is
       left in its place is the shut strip, which has a floor of its own to
       answer for: it is the only thing on that edge saying the panel exists,
       and a strip that has been rounded away is a panel with no way back. */
    test('the shut strip is wide enough to hold the button that reopens it', () => {
      const A = atWidth(1280).app;
      assert.ok(A.PANEL_STRIP >= 24, 'the strip is too thin to put a control in');
      assert.ok(A.PANEL_STRIP < A.PANEL_MIN, 'the strip is not a narrow panel, it is a strip');
    });

  });

  /* ------------------------------------------------- the panel's two states */

  describe('the results panel opens and shuts', () => {
    test('a first run starts it open, because that is where the answers appear', () => {
      /* Shut by default the panel rests on someone noticing a 34px strip and
         guessing what is behind it. Open, it explains itself. */
      const h = boot();
      assert.notOk(h.app.panelHiddenNow(), 'the panel is shut before anyone asked for that');
      assert.notOk(h.doc.body.classList.contains('panel-hidden'),
        'the document says shut while the script says open');
    });

    test('and the strip is what is left after closing it, not what it opens as', () => {
      const h = boot();
      h.app.hideResultsPanel();
      assert.ok(h.doc.body.classList.contains('panel-hidden'),
        'the state never reached the document, so only the script believes it');
    });

    test('shut leaves a strip, and the strip holds the way back', () => {
      const h = boot();
      h.app.hideResultsPanel();
      const show = h.doc.getElementById('panelShowBtn');
      assert.ok(show, 'nothing is left to reopen the panel with');
      assert.ok(show.closest('.panel-strip'), 'Show is not on the strip');
      assert.equal(show.textContent.trim(), 'Show');
    });

    test('Show and Hide are one control, and each names its own press', () => {
      const h = boot();
      const show = h.doc.getElementById('panelShowBtn');
      const hide = h.doc.getElementById('panelHideBtn');
      assert.equal(hide.textContent.trim(), 'Hide');
      [show, hide].forEach(b => assert.equal(b.getAttribute('onclick'), 'toggleResultsPanel()'));

      h.app.toggleResultsPanel();
      assert.ok(h.app.panelHiddenNow(), 'the toggle did not shut it');
      assert.ok(h.doc.body.classList.contains('panel-hidden'));
      assert.equal(show.getAttribute('aria-expanded'), 'false',
        'the state is announced on whichever button a reader is sitting on');
      assert.equal(hide.getAttribute('aria-expanded'), 'false');

      h.app.toggleResultsPanel();
      assert.notOk(h.app.panelHiddenNow(), 'the toggle does not open it again');
      assert.equal(hide.getAttribute('aria-expanded'), 'true');
    });

    test('shutting keeps the width, so opening comes back to it', () => {
      /* The whole reason the shut state is a class and not a width of zero.
         Someone who has sized the panel to suit their screen should not have to
         do it again every time they put it away. */
      const h = boot();
      h.app.showResultsPanel();
      h.app.applyPanelWidth(420, false);
      h.app.hideResultsPanel();
      assert.equal(h.app.panelWidthNow(), 420, 'shutting the panel cost the width');
      h.app.showResultsPanel();
      assert.equal(h.app.panelWidthNow(), 420, 'it came back at a width nobody chose');
    });

    test('opening an open panel is not a toggle in disguise', () => {
      // showResultsPanel() is called on every Run Query, including the ones
      // pressed while the panel is already open.
      const h = boot();
      h.app.showResultsPanel();
      h.app.showResultsPanel();
      assert.notOk(h.app.panelHiddenNow(), 'the second call shut it');
    });

    test('Run Query opens it, including when it refuses to run', () => {
      /* The refusal is the case that matters: it is written to the panel and
         then returns, so if the panel were still shut the button would look
         like it did nothing at all. An empty canvas takes the first refusal. */
      const h = boot();
      h.app.hideResultsPanel();
      h.w.runQuery();
      assert.notOk(h.app.panelHiddenNow(), 'Run Query left the panel shut');
      assert.includes(h.doc.getElementById('panelBody').innerHTML, 'Source',
        'the refusal did not reach the panel it just opened');
    });

    test('an error from anywhere else opens it too', () => {
      // A file that will not load reports itself through showError(), nowhere
      // near runQuery(), and the panel may well be shut when it does.
      const h = boot();
      h.app.hideResultsPanel();
      h.app.showError('Could not read that file.');
      assert.notOk(h.app.panelHiddenNow(), 'the error went into a panel nobody can see');
    });

    /* The handle sets a width and nothing else. Dragging it is the one gesture
       here nobody aims, so it must not be able to destroy what it is dragging:
       pushed past the end of its range the panel sits at the end of its range. */
    test('the handle cannot shut the panel, however far it is pushed', () => {
      const h = boot();
      h.app.showResultsPanel();
      h.app.applyPanelWidth(-9999, false);
      assert.notOk(h.app.panelHiddenNow(), 'a resize closed the panel');
      assert.equal(h.app.panelWidthNow(), h.app.PANEL_MIN, 'it stopped somewhere other than the floor');
    });

    test('and it is not there to drag a shut panel open', () => {
      /* Belt and braces: the stylesheet takes the handle out of the layout while
         the panel is shut, and the handler refuses anyway, so a drag already in
         flight when the state changed cannot finish as an open. */
      const h = boot();
      h.app.hideResultsPanel();
      const handle = h.doc.getElementById('panelResize');
      handle.dispatchEvent(new h.w.MouseEvent('mousedown', { button: 0, clientX: 900, bubbles: true }));
      h.doc.dispatchEvent(new h.w.MouseEvent('mousemove', { clientX: 400, bubbles: true }));
      h.doc.dispatchEvent(new h.w.MouseEvent('mouseup', { bubbles: true }));
      assert.ok(h.app.panelHiddenNow(), 'the panel was dragged open');
    });

    test('a placeholder is not news, and does not open anything', () => {
      // Clear writes through setOutput(). Someone who has just cleared the
      // canvas is not asking to be shown an empty panel.
      const h = boot();
      h.app.hideResultsPanel();
      h.app.setOutput('<div class="placeholder">Run a query to see results</div>');
      assert.ok(h.app.panelHiddenNow(), 'a placeholder opened the panel');
    });

    test('the state is remembered, and an old record opens at the new default', () => {
      const h = boot();
      h.app.hideResultsPanel();
      h.app.savePanelPrefs();
      const saved = JSON.parse(h.w.localStorage.getItem('sda.resultsPanel.v1'));
      assert.equal(saved.hidden, true, 'the panel state was not written down');
      assert.equal(typeof saved.w, 'number');

      /* A record written by the Wide button has a width and a `wide` flag and
         no `hidden`. The width is still meaningful and is kept; the flag names
         a button that no longer exists and is ignored, which leaves the panel
         at its new starting state rather than at a guess.

         Since the new default is open and the old panel was always open, such a
         user notices nothing but their own width coming back.

         The record goes in after the panel is moved, not before: every state
         change writes one of its own, so planting it first would only mean
         reading back what hideResultsPanel() had just saved over it. */
      h.app.hideResultsPanel();
      h.w.localStorage.setItem('sda.resultsPanel.v1',
        JSON.stringify({ w: 480, base: 300, wide: true }));
      h.app.loadPanelPrefs();
      assert.equal(h.app.panelWidthNow(), 480, 'the width someone chose was thrown away');
      assert.notOk(h.app.panelHiddenNow(), 'a flag for a removed button decided the new state');
    });
  });

  /* ---------------------------------------------------------- the ceiling */

  describe('it cannot be pulled too far', () => {
    test('the default size is the floor', () => {
      const h = sized(900);
      const A = h.app;
      assert.equal(A.clampBarScale(0.2), A.BAR_S_MIN, 'the bar shrank below its design size');
      assert.equal(A.clampBarScale(-3), A.BAR_S_MIN);
      assert.equal(A.clampBarScale('wide'), A.BAR_S_MIN, 'nonsense falls back rather than throwing');
    });

    test('the canvas is never squeezed past its minimum', () => {
      const h = sized(420);
      const A = h.app;
      const budget = A.barHeightBudget();
      assert.equal(budget, 420 - A.CANVAS_MIN_H - A.BAR_HANDLE_H);
      const max = A.barMaxScale();
      const table = A.barStepTable();
      const at = table.find(x => Math.abs(x.s - max) < 1e-9);
      assert.ok(at.h <= budget, 'the tallest allowed bar leaves too little canvas');
      const next = table[table.indexOf(at) + 1];
      if (next) assert.ok(next.h > budget, 'it stopped short of what would fit');
    });

    test('a short window lowers the ceiling, a tall one raises it', () => {
      assert.ok(sized(420).app.barMaxScale() < sized(1200).app.barMaxScale(),
        'the ceiling ignores how much room there is');
    });

    test('dragging past the ceiling does nothing rather than inflating the bar', () => {
      const h = sized(900);
      const A = h.app;
      const max = A.barMaxScale();
      const fit = A.barFitForHeight(99999);
      assert.equal(fit.s, max, 'a huge drag should land exactly on the ceiling');
      assert.equal(fit.fill, 0, 'at the ceiling there is no next size, so no padding to add');
    });

    test('the table is rebuilt when the window width changes', () => {
      /* A resize event that arrives late, or not at all, would otherwise leave
         a ceiling measured for a window that is no longer there. */
      const h = sized(900);
      const A = h.app;
      const before = A.barStepTable();
      Object.defineProperty(h.w, 'innerWidth', { value: 640, configurable: true });
      const after = A.barStepTable();
      assert.notOk(before === after, 'the table survived a width change');
    });
  });

  /* ------------------------------------------------------------- the drag */

  describe('the bar follows the pointer', () => {
    test('a height between two sizes is made up with padding', () => {
      const h = sized(1200);
      const A = h.app;
      const table = A.barStepTable();
      // The step either side of the wrap, which is the gap worth covering.
      const below = table.filter(x => x.s <= 1.2).pop();
      const above = table.find(x => x.s > 1.2);
      assert.ok(above.h - below.h > 10, 'this table has no wrap in it to test');

      const wanted = below.h + Math.round((above.h - below.h) / 2);
      const fit = A.barFitForHeight(wanted);
      assert.equal(fit.s, below.s, 'mid-way across a wrap it should still be the smaller size');
      assert.equal(below.h + fit.fill, wanted,
        'the bar must come to exactly the height the drag asked for');
    });

    test('the padding never exceeds the gap to the next size', () => {
      const h = sized(1200);
      const A = h.app;
      const table = A.barStepTable();
      for (let i = 0; i < table.length - 1; i++) {
        if (table[i + 1].s > A.barMaxScale()) break;
        const gap = table[i + 1].h - table[i].h;
        const fit = A.barFitForHeight(table[i].h + gap + 500);
        assert.ok(fit.s > table[i].s || fit.fill <= gap,
          'the bar would be more padding than it needs at size ' + table[i].s);
      }
    });

    test('every height in range is reachable exactly', () => {
      const h = sized(1200);
      const A = h.app;
      const table = A.barStepTable();
      const top = table.find(x => Math.abs(x.s - A.barMaxScale()) < 1e-9);
      for (let want = table[0].h; want <= top.h; want += 7) {
        const fit = A.barFitForHeight(want);
        const at = table.find(x => Math.abs(x.s - fit.s) < 1e-9);
        assert.equal(at.h + fit.fill, want,
          'a drag to ' + want + 'px produced a bar of ' + (at.h + fit.fill) + 'px');
      }
    });

    test('a height below the default gives the default, with no padding', () => {
      const h = sized(1200);
      const fit = h.app.barFitForHeight(5);
      assert.equal(fit.s, h.app.BAR_S_MIN);
      assert.equal(fit.fill, 0);
    });
  });

  /* ------------------------------------------------------- applying a size */

  describe('applying a size', () => {
    test('one custom property carries the size, and the padding is split in two', () => {
      const h = sized(1200);
      const A = h.app;
      A.applyBarScale(1.1, false, 12);
      assert.equal(h.doc.documentElement.style.getPropertyValue('--bar-s'), '1.1');
      assert.equal(h.doc.documentElement.style.getPropertyValue('--bar-fill'), '6px',
        'half above and half below, or the controls sit off-centre');
      assert.equal(A.barScaleNow(), 1.1);
      assert.equal(A.barFillNow(), 12);
    });

    test('the stacked layout is applied from the table, not guessed', () => {
      const h = sized(1200);
      const A = h.app;
      const bar = h.doc.getElementById('toolbar');
      const stackedAt = s => { A.applyBarScale(s, false); return bar.className.indexOf('stacked') !== -1; };
      const table = A.barStepTable();
      table.forEach(step => {
        if (step.s > A.barMaxScale()) return;
        assert.equal(stackedAt(step.s), !!step.stacked,
          'the layout at size ' + step.s + ' disagrees with what was measured for it');
      });
    });

    test('measuring the bar leaves it exactly as it was found', () => {
      /* The table is built by applying every size to the real bar. Anything it
         forgets to put back is a change the user never asked for. */
      const h = sized(1200);
      const A = h.app;
      A.applyBarScale(1.15, false, 8);
      const bar = h.doc.getElementById('toolbar');
      const varBefore = h.doc.documentElement.style.getPropertyValue('--bar-s');
      const fillBefore = h.doc.documentElement.style.getPropertyValue('--bar-fill');
      const clsBefore = bar.className;

      A.barStepsDrop();
      A.buildBarSteps();

      assert.equal(h.doc.documentElement.style.getPropertyValue('--bar-s'), varBefore);
      assert.equal(h.doc.documentElement.style.getPropertyValue('--bar-fill'), fillBefore);
      assert.equal(bar.className, clsBefore);
    });
  });

  /* ------------------------------------------------------------ remembering */

  describe('the size is remembered, and is nobody else\'s business', () => {
    test('it survives a reload', () => {
      const h = sized(1200);
      const A = h.app;
      A.applyBarScale(1.15, true, 6);
      const stored = JSON.parse(h.w.localStorage.getItem('sda.toolbar.v1'));
      assert.equal(stored.s, 1.15);
      assert.equal(stored.f, 6);

      A.applyBarScale(1, false, 0);
      A.loadBarPrefs();
      assert.equal(A.barScaleNow(), 1.15, 'the stored size did not come back');
      assert.equal(A.barFillNow(), 6);
    });

    test('a stored size too tall for this window is clamped, not honoured', () => {
      const tall = sized(1200);
      tall.app.applyBarScale(tall.app.BAR_S_MAX, true);
      const raw = tall.w.localStorage.getItem('sda.toolbar.v1');

      const short = sized(420);
      short.w.localStorage.setItem('sda.toolbar.v1', raw);
      short.app.loadBarPrefs();
      assert.ok(short.app.barScaleNow() <= short.app.barMaxScale(),
        'a size saved on a big screen must not squeeze the canvas out on a small one');
    });

    test('no storage at all is not a reason for the bar to stop working', () => {
      // A private window, or a file:// origin with site data blocked.
      const h = withoutStorage(sized(1200));
      assert.equal(h.w.localStorage, undefined, 'this window was meant to have none');
      h.app.applyBarScale(1.2, true);          // persist: true, with nowhere to persist
      assert.equal(h.app.barScaleNow(), 1.2, 'the size did not take effect');
      h.app.loadBarPrefs();                     // and reading it back must not throw
    });

    test('it is not written into a saved query', () => {
      // A graph emailed to a supervisor must not rearrange his interface.
      const h = sized(1200);
      h.app.applyBarScale(1.3, true, 4);
      const text = JSON.stringify(h.app.serialiseGraph());
      assert.excludes(text, 'bar-s');
      assert.excludes(text, 'toolbar');
    });
  });
};
