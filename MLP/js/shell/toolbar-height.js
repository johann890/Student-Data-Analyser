/* shell/toolbar-height.js: The toolbar height, its drag handle and the scale it maps to.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   TOOLBAR HEIGHT
   ============================================================================
   The same bargain as the results panel, turned ninety degrees: the bar can be
   pulled down for more room, and the room comes out of the canvas rather than
   out of a layer floating over it.

   What the drag sets is a scale, not a height. A bar that grew taller while its
   buttons stayed 22px would be a band of empty grey with the same controls
   stranded in it, which is more room for nothing. One multiplier drives every
   measurement in the stylesheet instead, so the bar keeps its proportions and
   the controls grow into the height the user asked for.

   The default is the floor. Pulling up goes back to the bar as designed and
   stops there, because below it the labels start colliding and there is nothing
   to be gained that zooming the browser does not already do better. The ceiling
   is whichever comes first: a scale the controls still look deliberate at, or
   the point where the canvas has shrunk to CANVAS_MIN_H and giving away more
   would leave nowhere to build a query.

   Stored with the panel width and for the same reason: it is a fact about this
   person's screen, not about the query, and a saved .json carries neither. */

var BAR_S_MIN    = 1;     // the bar as designed, and the smallest it goes
var BAR_S_MAX    = 2.4;   // past this the controls read as a mistake rather than a choice
var BAR_S_STEP   = 0.05;  // the grain the drag lands on, and the table's resolution
var CANVAS_MIN_H = 260;   // the canvas is never squeezed past this, however tall the bar
var BAR_HANDLE_H = 5;     // matches .toolbar-resize in the stylesheet

var barScale = BAR_S_MIN;
var barFill  = 0;   // px of padding making up the difference to the dragged height

function toolbarEl()       { return document.getElementById('toolbar'); }
function toolbarResizeEl() { return document.getElementById('toolbarResize'); }

/* Height is not a multiple of the scale, because the bar wraps. Somewhere
   between 1 and the ceiling the controls stop fitting on one row and the bar
   gains a whole row at once, and where that happens depends on the window
   width and on what is in the bar. Nothing here predicts it. The scales are
   applied to the real bar and the resulting heights written down, which is the
   only way to be right about a layout the browser decides.

   Built on demand and rebuilt when the window's width changes, since that moves
   the wrap points. Twenty-nine measurements, once per width, against a lookup
   per mousemove, which is the way round that keeps the drag smooth.

   Keyed on the width it was measured at rather than cleared by the resize
   event, because a resize event that arrives late or not at all leaves a table
   describing a window that is no longer there, and every ceiling read out of it
   is then wrong in the direction that lets the bar overflow. */
var barSteps = null;
var barStepsW = -1;

/* How many rows the controls have wrapped onto, counted from where they
   actually are. Grouped by vertical centre rather than by top edge: the bar
   centres its items, so a 10px label and a 25px button on the SAME row start at
   different heights and only their centres agree. The hidden file inputs have
   no box at all and are skipped, which is why this asks each child for its
   rects rather than trusting the child list. */
function barRowCount(t) {
  var mids = [], tallest = 0;
  for (var i = 0; i < t.children.length; i++) {
    var c = t.children[i];
    if (!c.getClientRects().length) continue;
    var r = c.getBoundingClientRect();
    if (!r.height) continue;
    mids.push(r.top + r.height / 2);
    if (r.height > tallest) tallest = r.height;
  }
  if (!mids.length) return 1;
  mids.sort(function(a, b) { return a - b; });
  var rows = 1;
  for (var j = 1; j < mids.length; j++) {
    // Anything further apart than most of a control's height is the next row.
    if (mids[j] - mids[j - 1] > tallest * 0.6) rows++;
  }
  return rows;
}

/* One scale, in one of the two layouts, measured on the real bar.
   A group is one flex item and cannot be broken, so past a certain size the
   widest of them is wider than the window and hangs off the right edge with a
   button on it. scrollWidth is how the bar reports that. */
function measureBarAt(t, root, sv, stacked) {
  root.style.setProperty('--bar-s', String(sv));
  root.style.setProperty('--bar-fill', '0px');
  t.classList.toggle('stacked', stacked);
  return {
    s: sv,
    stacked: stacked,
    h: t.getBoundingClientRect().height,
    rows: barRowCount(t),
    fits: t.scrollWidth <= t.clientWidth + 1
  };
}

/* One row for as long as one row works, and the chosen break after that, so the
   bar has two shapes rather than a series of accidents. Each is measured, not
   predicted: whether the unstacked bar still fits on one row depends on the
   window width and on what is in the bar. */
function buildBarSteps() {
  var t = toolbarEl();
  if (!t) return null;
  var root = document.documentElement;
  var keepVar = root.style.getPropertyValue('--bar-s');
  var keepFill = root.style.getPropertyValue('--bar-fill');
  var keepCls = t.classList.contains('stacked');
  var out = [];
  for (var v = BAR_S_MIN; v <= BAR_S_MAX + 1e-9; v += BAR_S_STEP) {
    var sv = Math.round(v * 100) / 100;
    var flat = measureBarAt(t, root, sv, false);
    out.push(flat.rows === 1 && flat.fits ? flat : measureBarAt(t, root, sv, true));
  }
  t.classList.toggle('stacked', keepCls);
  if (keepVar) root.style.setProperty('--bar-s', keepVar);
  else root.style.removeProperty('--bar-s');
  if (keepFill) root.style.setProperty('--bar-fill', keepFill);
  else root.style.removeProperty('--bar-fill');
  return out;
}

function barStepFor(sv) {
  var steps = barStepTable();
  if (!steps) return null;
  for (var i = 0; i < steps.length; i++) {
    if (Math.abs(steps[i].s - sv) < 1e-9) return steps[i];
  }
  return null;
}

function barStepTable() {
  if (!barSteps || barStepsW !== window.innerWidth) {
    barSteps = buildBarSteps();
    barStepsW = window.innerWidth;
  }
  return barSteps;
}

/* The tallest the bar may be before the canvas is not worth having. */
function barHeightBudget() {
  return window.innerHeight - CANVAS_MIN_H - BAR_HANDLE_H;
}

/* Three limits, and the lowest wins. Height keeps the canvas worth having.
   Width keeps every control on screen, since a group cannot wrap inside itself
   and a group wider than the window puts its last button past the right edge.
   Rows keep the bar worth looking at: one extra row is the controls given more
   room, but a third puts Run Query alone on a line of its own, which is not
   more room for anything. One extra row rather than a count of two, because a
   narrow window may already need two at the default size.

   The scan stops at the first step that fails rather than taking the last one
   that passes, so the ceiling is a size everything below it also clears. */
function barMaxScale() {
  var steps = barStepTable();
  if (!steps || !steps.length) return BAR_S_MIN;
  var budget = barHeightBudget();
  var maxRows = steps[0].rows + 1;
  var best = steps[0].s;
  for (var i = 0; i < steps.length; i++) {
    var st = steps[i];
    if (st.h > budget || st.rows > maxRows || !st.fits) break;
    best = st.s;
  }
  return best;
}

/* The largest scale whose bar is no taller than the height asked for, so the
   bottom edge follows the pointer across a wrap instead of running ahead of it. */
function clampBarScale(v) {
  if (typeof v !== 'number' || !isFinite(v)) return BAR_S_MIN;
  var stepped = Math.round(v / BAR_S_STEP) * BAR_S_STEP;
  stepped = Math.round(stepped * 100) / 100;
  return Math.max(BAR_S_MIN, Math.min(barMaxScale(), stepped));
}

/* One write, to the custom property the stylesheet reads, exactly as the panel
   width works. The canvas has just changed height without a window resize event
   firing, so the two things that measure it are told by hand. */
function applyBarScale(v, persist, fill) {
  barScale = clampBarScale(v);
  barFill = (typeof fill === 'number' && isFinite(fill) && fill > 0) ? fill : 0;
  var root = document.documentElement;
  root.style.setProperty('--bar-s', String(barScale));
  /* Half above, half below, and not rounded to whole pixels: the measured
     heights are fractional, so rounding the difference left the bar up to a
     pixel away from the height the drag asked for. Trimmed to two places so the
     value reads as a number rather than as floating-point noise. */
  root.style.setProperty('--bar-fill', String(+(barFill / 2).toFixed(2)) + 'px');
  var t = toolbarEl();
  var step = barStepFor(barScale);
  if (t) t.classList.toggle('stacked', !!(step && step.stacked));
  clampPan();
  applyView();
  if (persist !== false) saveBarPrefs();
}

/* The height asked for, resolved into the biggest controls that fit inside it
   and the padding that makes up the rest. The fill is capped at the point where
   the next size up would be the natural fit, so the bar is never more padding
   than it needs, and at the ceiling there is no next size and so no fill: past
   the top the bar simply stops, rather than inflating. */
function barFitForHeight(h) {
  var steps = barStepTable();
  if (!steps || !steps.length) return { s: BAR_S_MIN, fill: 0 };
  var cap = barMaxScale();
  var idx = 0;
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].s > cap) break;
    if (steps[i].h <= h) idx = i;
  }
  var here = steps[idx];
  var next = (idx + 1 < steps.length && steps[idx + 1].s <= cap) ? steps[idx + 1] : null;
  var room = next ? Math.max(0, next.h - here.h) : 0;
  return { s: here.s, fill: Math.max(0, Math.min(room, h - here.h)) };
}

var BAR_STORE = 'sda.toolbar.v1';

function saveBarPrefs() {
  try {
    window.localStorage.setItem(BAR_STORE, JSON.stringify({ s: barScale, f: barFill }));
  } catch (e) { /* the height still holds for this session */ }
}

function loadBarPrefs() {
  var raw = null;
  try { raw = window.localStorage.getItem(BAR_STORE); } catch (e) { return; }
  if (!raw) return;
  var p;
  try { p = JSON.parse(raw); } catch (e) { return; }
  if (!p || typeof p.s !== 'number') return;
  applyBarScale(p.s, false, typeof p.f === 'number' ? p.f : 0);
}

/* DRAG */
var barDrag = null;

function onBarResizeDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();   // stop the drag turning into a text selection
  var t = toolbarEl();
  barStepTable();       // measured before the first move, not during it
  barDrag = {
    startY: e.clientY,
    startH: t ? t.getBoundingClientRect().height : 0,
    moved: false
  };
  document.body.classList.add('toolbar-resizing');
  var h = toolbarResizeEl();
  if (h) h.classList.add('dragging');
}

/* The handle sits on the bar's bottom edge, so the edge follows the pointer.
   The height the drag asks for is read back through the table as the scale that
   produces it, which is what keeps the two together even where a wrap makes the
   bar jump a whole row. */
function onBarResizeMove(e) {
  if (!barDrag) return;
  var dy = e.clientY - barDrag.startY;
  if (Math.abs(dy) > 2) barDrag.moved = true;
  var fit = barFitForHeight(barDrag.startH + dy);
  applyBarScale(fit.s, false, fit.fill);
}

function onBarResizeUp() {
  if (!barDrag) return;
  barDrag = null;
  document.body.classList.remove('toolbar-resizing');
  var h = toolbarResizeEl();
  if (h) h.classList.remove('dragging');
  saveBarPrefs();
}

function onBarResizeDouble() { applyBarScale(BAR_S_MIN); }

/* A focusable separator answers the arrow keys, which is the only way to reach
   the height without a mouse. */
function onBarResizeKey(e) {
  var step = e.shiftKey ? 0.25 : 0.08;
  if (e.key === 'ArrowDown')    { e.preventDefault(); applyBarScale(barScale + step); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); applyBarScale(barScale - step); }
  else if (e.key === 'Home')    { e.preventDefault(); onBarResizeDouble(); }
}

(function wireBarResize() {
  var h = toolbarResizeEl();
  if (!h) return;
  h.addEventListener('mousedown', onBarResizeDown);
  h.addEventListener('dblclick', onBarResizeDouble);
  h.addEventListener('keydown', onBarResizeKey);
  document.addEventListener('mousemove', onBarResizeMove);
  document.addEventListener('mouseup', onBarResizeUp);
  loadBarPrefs();
})();

// A resize moves the ceiling, so the scale is re-clamped rather than left with
// the canvas squeezed out from under it. The table looks after itself: it
// notices the width it was measured at is not the width any more.
window.addEventListener('resize', function() {
  applyBarScale(barScale, false, barFill);
});

// Panning and marquee use screen-space maths against the canvas box, and zoomed
// out far enough the world is centred rather than pinned. Both need revisiting
// when the canvas changes size. A narrower window also lowers the ceiling on
// the panel, so the stored width is re-clamped rather than left overhanging.
window.addEventListener('resize', function() {
  applyPanelWidth(panelWidth, false);
  clampPan();
  applyView();
});

