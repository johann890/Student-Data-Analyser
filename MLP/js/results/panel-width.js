/* results/panel-width.js: The results panel width, its drag handle and the Wide button.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   RESULTS PANEL WIDTH
   ============================================================================
   A results table with eighteen columns cannot be read in 300px, but a panel
   permanently wide enough for eighteen columns leaves too little canvas to lay
   a graph out in. So the width is neither fixed nor automatic: it is the user's
   to set, with a sensible narrow default to come back to.

   Two controls, because there are two different intentions behind widening:

     the handle:   Settle on a width that suits this machine and this dataset,
                   and leave it there
     Wide:         This one table has too many columns; show me all of them,
                   then give me my canvas back

   Wide remembers the width it left, so using it does not cost the user the
   width they had chosen with the handle.

   Widening narrows the canvas rather than floating over it. The alternative
   (an overlay) would hide whatever node happened to be under it, and the pan
   clamp would still be working from the old, larger canvas box. Shrinking keeps
   one source of truth for how much canvas there is.

   None of this is written into a saved query. A .json file records the
   question; how wide someone likes their panel is a property of the person and
   the screen, not of the query, and a graph emailed to a supervisor should not
   rearrange his interface when he opens it. */

var PANEL_MIN     = 240;   // narrower than this and the table headers wrap
var PANEL_DEFAULT = 300;   // matches the CSS default, which is the real one
var PANEL_WIDE    = 720;   // enough for the full enrolment row at 11px
/* The canvas floor, and so the panel's ceiling: the widest the panel goes is
   whatever is left after this. Raised from 320, which let the panel take about
   three quarters of a 1280px window. At that width the canvas holds barely two
   nodes side by side, and the graph being built is the thing the panel's
   results are about. A few points back leaves the canvas usable at any panel
   width someone would actually settle on. */
var CANVAS_MIN    = 400;
var HANDLE_W      = 5;

var panelWidth   = PANEL_DEFAULT;  // what the panel is now
var panelRestore = PANEL_DEFAULT;  // what Wide goes back to
var panelWide    = false;

function panelResizeEl() { return document.getElementById('panelResize'); }
function panelWideBtnEl() { return document.getElementById('panelWideBtn'); }

function panelMaxWidth() {
  return Math.max(PANEL_MIN, window.innerWidth - CANVAS_MIN - HANDLE_W);
}
function clampPanelWidth(w) {
  if (typeof w !== 'number' || !isFinite(w)) return PANEL_DEFAULT;
  return Math.round(Math.max(PANEL_MIN, Math.min(panelMaxWidth(), w)));
}

/* One write, to the custom property the stylesheet reads. Everything else here
   only decides what number to pass in. */
function applyPanelWidth(w, persist) {
  panelWidth = clampPanelWidth(w);
  document.documentElement.style.setProperty('--panel-w', panelWidth + 'px');
  // The canvas has just changed size without a window resize event firing, so
  // the two things that measure it have to be told by hand.
  clampPan();
  applyView();
  if (persist !== false) savePanelPrefs();
}

/* The button names what the next press does, not what the panel is: while the
   panel is wide the only thing left to ask for is a thin one, so the label
   reads Thin. aria-pressed still carries the state for a screen reader. */
function syncPanelWideBtn() {
  var b = panelWideBtnEl();
  if (!b) return;
  b.setAttribute('aria-pressed', panelWide ? 'true' : 'false');
  b.textContent = panelWide ? 'Thin' : 'Wide';
  b.title = panelWide
    ? 'Back to the narrower panel  ( W )'
    : 'Widen the panel to see every column  ( W )';
}

function togglePanelWide() {
  if (panelWide) {
    panelWide = false;
    applyPanelWidth(panelRestore);
  } else {
    panelRestore = panelWidth;
    panelWide = true;
    // Never narrower than it already is: someone who has dragged past the wide
    // preset asked for that width, and Wide should not take it away.
    applyPanelWidth(Math.max(PANEL_WIDE, panelWidth));
  }
  syncPanelWideBtn();
  // Focus would otherwise sit on a button whose meaning just inverted, and the
  // W shortcut is suppressed while a control has focus. Hand it back to the page.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

/* Persisted outside the document, so it survives a reload. A preference the
   user should only have to express once. localStorage throws rather than
   returns null in some file:// and private-window configurations, so every
   access is guarded: failing to remember is a minor loss, and never a reason
   for the panel not to work. */
var PANEL_STORE = 'sda.resultsPanel.v1';

function savePanelPrefs() {
  try {
    window.localStorage.setItem(PANEL_STORE, JSON.stringify({
      w: panelWidth, base: panelRestore, wide: panelWide
    }));
  } catch (e) { /* width still holds for this session */ }
}

function loadPanelPrefs() {
  var raw = null;
  try { raw = window.localStorage.getItem(PANEL_STORE); } catch (e) { return; }
  if (!raw) return;
  var p;
  try { p = JSON.parse(raw); } catch (e) { return; }
  if (!p || typeof p.w !== 'number') return;
  panelRestore = clampPanelWidth(typeof p.base === 'number' ? p.base : PANEL_DEFAULT);
  panelWide = !!p.wide;
  applyPanelWidth(p.w, false);
  syncPanelWideBtn();
}

/* DRAG */
var panelDrag = null;

function onPanelResizeDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();   // stop the drag turning into a text selection
  panelDrag = { startX: e.clientX, startW: panelWidth, moved: false };
  document.body.classList.add('panel-resizing');
  var h = panelResizeEl();
  if (h) h.classList.add('dragging');
}

function onPanelResizeMove(e) {
  if (!panelDrag) return;
  var dx = panelDrag.startX - e.clientX;   // the panel is on the right, so leftwards widens
  if (Math.abs(dx) > 2) panelDrag.moved = true;
  applyPanelWidth(panelDrag.startW + dx, false);   // one write at the end, not one per frame
}

function onPanelResizeUp() {
  if (!panelDrag) return;
  var moved = panelDrag.moved;
  panelDrag = null;
  document.body.classList.remove('panel-resizing');
  var h = panelResizeEl();
  if (h) h.classList.remove('dragging');
  if (moved) {
    // A deliberate drag is the user choosing a width. It becomes the width Wide
    // returns to, and Wide stops claiming to be the reason the panel is wide.
    panelWide = false;
    panelRestore = panelWidth;
    syncPanelWideBtn();
  }
  savePanelPrefs();
}

function onPanelResizeDouble() {
  panelWide = false;
  panelRestore = PANEL_DEFAULT;
  applyPanelWidth(PANEL_DEFAULT);
  syncPanelWideBtn();
}

/* The handle is a focusable separator, so it answers the arrow keys too. This
   is the only way to reach the width without a mouse. */
function onPanelResizeKey(e) {
  var step = e.shiftKey ? 40 : 10;
  if (e.key === 'ArrowLeft')       { e.preventDefault(); nudgePanel(step); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); nudgePanel(-step); }
  else if (e.key === 'Home')       { e.preventDefault(); onPanelResizeDouble(); }
}
function nudgePanel(by) {
  panelWide = false;
  applyPanelWidth(panelWidth + by);
  panelRestore = panelWidth;
  syncPanelWideBtn();
}

(function wirePanelResize() {
  var h = panelResizeEl();
  if (!h) return;
  h.addEventListener('mousedown', onPanelResizeDown);
  h.addEventListener('dblclick', onPanelResizeDouble);
  h.addEventListener('keydown', onPanelResizeKey);
  document.addEventListener('mousemove', onPanelResizeMove);
  document.addEventListener('mouseup', onPanelResizeUp);
  loadPanelPrefs();
})();

