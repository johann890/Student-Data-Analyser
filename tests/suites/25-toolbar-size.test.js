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

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

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

  /* jsdom is built here with no origin, so it has no localStorage: the same
     situation as a private window, which the application already expects and
     guards every access against. A test about remembering needs somewhere to
     remember, so it brings its own. */
  function withStorage(h) {
    const mem = {};
    Object.defineProperty(h.w, 'localStorage', {
      configurable: true,
      value: {
        getItem: k => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: k => { delete mem[k]; }
      }
    });
    return h;
  }

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
      assert.ok(groups.length >= 4, 'the bar is not grouped');
      groups.forEach(g => assert.ok(g.children.length >= 1, 'an empty group'));
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

    test('all three dropdowns are inside the bar and survive its resizing', () => {
      const h = boot();
      const ids = h.qa('.proc-menu').map(m => m.id).sort();
      assert.deepEqual(ids, ['distMenu', 'procMenu', 'reshapeMenu']);
      h.qa('.proc-menu').forEach(m =>
        assert.ok(m.closest('.toolbar'), m.id + ' is not in the bar'));
      /* Each hangs off its own button rather than off the bar, so a bar that
         has grown taller or wrapped still opens its menus under them. */
      h.qa('.proc-menu').forEach(m =>
        assert.ok(m.closest('.proc-wrap'), m.id + ' is not anchored to a button'));
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
      const h = withStorage(sized(1200));
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
      const tall = withStorage(sized(1200));
      tall.app.applyBarScale(tall.app.BAR_S_MAX, true);
      const raw = tall.w.localStorage.getItem('sda.toolbar.v1');

      const short = withStorage(sized(420));
      short.w.localStorage.setItem('sda.toolbar.v1', raw);
      short.app.loadBarPrefs();
      assert.ok(short.app.barScaleNow() <= short.app.barMaxScale(),
        'a size saved on a big screen must not squeeze the canvas out on a small one');
    });

    test('no storage at all is not a reason for the bar to stop working', () => {
      // A private window, or a file:// origin with site data blocked.
      const h = sized(1200);
      assert.equal(h.w.localStorage, undefined, 'this jsdom was expected to have none');
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
