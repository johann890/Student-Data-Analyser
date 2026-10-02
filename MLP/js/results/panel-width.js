/* results/panel-width.js: the results panel width, its Show/Hide state and its
   drag handle.

   An eighteen-column table cannot be read in 300px, but a panel permanently
   that wide leaves too little canvas. So the panel is the user's to open, close
   and size, and it opens itself when it has an answer.

   It starts open, because a feature that is not on screen when the application
   first opens is one the user has to be told about.

   Open/shut and width are separate controls:

     Hide / Show   the only way in and out by hand. Either button names the
                   press rather than the state.
     the handle    width only, between PANEL_MIN and whatever the canvas floor
                   leaves. Pushed to the end of its range it stays there: it
                   cannot shut the panel and cannot drag one open.
     Run Query     opens the panel, since that is where the answer appears.

   The two were briefly one gesture, with the handle shutting the panel if
   dragged far enough. They are separate again because someone pushing the panel
   as narrow as it goes and someone closing it do the same thing with the mouse,
   and only one of them wants it to disappear.

   Closed is a 34px strip rather than nothing, so there is always a way back
   that does not need a keyboard shortcut.

   Opening and closing narrows the canvas rather than floating over it: an
   overlay would hide whatever node sat under it, and the pan clamp would still
   be working from the old canvas box.

   None of this is saved with a query. Panel width is a property of the person
   and the screen, not of the question. */

var PANEL_MIN     = 240;   // narrower than this and the table headers wrap
var PANEL_DEFAULT = 300;   // matches the CSS default, which is the real one
var PANEL_STRIP   = 34;    // the closed strip, and again the CSS holds the real one
/* The canvas floor, and so the panel's ceiling: the widest the panel goes is
   whatever is left after this. Raised from 320, which let the panel take about
   three quarters of a 1280px window. At that width the canvas holds barely two
   nodes side by side, and the graph being built is the thing the panel's
   results are about. A few points back leaves the canvas usable at any panel
   width someone would actually settle on. */
var CANVAS_MIN    = 400;
var HANDLE_W      = 5;

var panelWidth  = PANEL_DEFAULT;  // the width the panel has while it is open
/* Open on a first run, for the reason at the top of this file. A named constant
   rather than a literal in the assignment below, because two separate places
   need to mean "what the panel does when nobody has said otherwise": the
   starting value, and the fallback in loadPanelPrefs() for a stored record that
   predates the setting. Spelling it once is what keeps those two answers the
   same one. */
var PANEL_OPEN_AT_FIRST = true;

var panelHidden = !PANEL_OPEN_AT_FIRST;

function panelResizeEl()  { return document.getElementById('panelResize'); }
function panelHideBtnEl() { return document.getElementById('panelHideBtn'); }
function panelShowBtnEl() { return document.getElementById('panelShowBtn'); }

function panelMaxWidth() {
  return Math.max(PANEL_MIN, window.innerWidth - CANVAS_MIN - HANDLE_W);
}
function clampPanelWidth(w) {
  if (typeof w !== 'number' || !isFinite(w)) return PANEL_DEFAULT;
  return Math.round(Math.max(PANEL_MIN, Math.min(panelMaxWidth(), w)));
}

/* One write, to the custom property the stylesheet reads. Everything else here
   only decides what number to pass in.

   The property is written whether the panel is open or closed, and the closed
   width is the stylesheet's business rather than this number's. That is what
   lets Show restore a width without having to remember one separately: while
   the panel is closed, --panel-w still holds the width it will come back to. */
function applyPanelWidth(w, persist) {
  panelWidth = clampPanelWidth(w);
  document.documentElement.style.setProperty('--panel-w', panelWidth + 'px');
  // The canvas has just changed size without a window resize event firing, so
  // the two things that measure it have to be told by hand.
  clampPan();
  applyView();
  if (persist !== false) savePanelPrefs();
}

/* The one write for the other half of the state. Same shape as the width: set
   the class the stylesheet reads, then tell the two things that measure the
   canvas, because it just changed size by the width of a panel. */
function applyPanelHidden(persist) {
  document.body.classList.toggle('panel-hidden', panelHidden);
  syncPanelButtons();
  clampPan();
  applyView();
  if (persist !== false) savePanelPrefs();
}

/* Two buttons rather than one whose label flips, because the two states do not
   share a place to put it: the open panel's button belongs in its header, and
   the closed panel has no header to put anything in. Each button lives in the
   state its own label is true in, and the stylesheet shows one at a time, so
   neither ever reads as a lie about what pressing it does.

   aria-expanded rather than aria-pressed. This is not a control that stays
   down; it is one that opens and closes a region, and that is the attribute
   for it. Both buttons carry it, because either can be the one a screen reader
   is sitting on. */
function syncPanelButtons() {
  var open = !panelHidden;
  [panelHideBtnEl(), panelShowBtnEl()].forEach(function(b) {
    if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

function showResultsPanel() {
  if (!panelHidden) return;
  panelHidden = false;
  applyPanelHidden();
}

function hideResultsPanel() {
  if (panelHidden) return;
  panelHidden = true;
  applyPanelHidden();
}

function toggleResultsPanel() {
  panelHidden = !panelHidden;
  applyPanelHidden();
  /* Focus would otherwise sit on a button that is about to be display:none, at
     which point the browser drops focus to <body> without telling anyone. Hand
     it to the button that replaces it, so the keyboard stays where the user
     left it and the W shortcut still reaches a control that means something. */
  var next = panelHidden ? panelShowBtnEl() : panelHideBtnEl();
  if (next && document.activeElement && document.activeElement.tagName === 'BUTTON') {
    next.focus();
  }
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
      w: panelWidth, hidden: panelHidden
    }));
  } catch (e) { /* the state still holds for this session */ }
}

/* The key is not versioned past v1 even though the stored shape changed: a
   record written by the Wide button carries a width, which is still meaningful,
   and a `wide` flag, which is not. Reading the width and ignoring the flag
   leaves someone who used the old panel with the width they had chosen and the
   new starting state, which is what a version bump would have given them minus
   the width. Since that starting state is open, and the old panel was always
   open, they notice nothing but their own width. The stale keys go on the next
   write. */
function loadPanelPrefs() {
  var raw = null;
  try { raw = window.localStorage.getItem(PANEL_STORE); } catch (e) { return; }
  if (!raw) return;
  var p;
  try { p = JSON.parse(raw); } catch (e) { return; }
  if (!p || typeof p.w !== 'number') return;
  /* Assigned either way. Falling through and leaving panelHidden alone would
     read the same at boot, when it still holds its starting value, and would
     quietly mean "whatever the panel happens to be doing right now" anywhere
     else. A record that does not name a state gets the default state, said
     rather than inherited. */
  panelHidden = (typeof p.hidden === 'boolean') ? p.hidden : !PANEL_OPEN_AT_FIRST;
  applyPanelWidth(p.w, false);
  applyPanelHidden(false);
}

/* DRAG */
var panelDrag = null;

/* Refused while the panel is shut. The stylesheet takes the handle out of the
   layout in that state so there is nothing to grab, and this is the same answer
   given twice: the handle is not a way to open the panel, and a drag that
   started before the state changed does not become one. */
function onPanelResizeDown(e) {
  if (e.button !== 0 || panelHidden) return;
  e.preventDefault();   // stop the drag turning into a text selection
  panelDrag = { startX: e.clientX, startW: panelWidth };
  document.body.classList.add('panel-resizing');
  var h = panelResizeEl();
  if (h) h.classList.add('dragging');
}

/* Width only. Pushed past either end of the range the panel sits at that end
   and waits: clampPanelWidth() is what stops it, and stopping is all it does.
   The panel cannot be closed from here, so a drag can always be undone by
   dragging back, which is the property that makes it safe not to aim. */
function onPanelResizeMove(e) {
  if (!panelDrag) return;
  var dx = panelDrag.startX - e.clientX;   // the panel is on the right, so leftwards widens
  applyPanelWidth(panelDrag.startW + dx, false);   // one write at the end, not one per frame
}

function onPanelResizeUp() {
  if (!panelDrag) return;
  panelDrag = null;
  document.body.classList.remove('panel-resizing');
  var h = panelResizeEl();
  if (h) h.classList.remove('dragging');
  savePanelPrefs();
}

/* Double-click is the way back to the width the panel ships with. Like the drag
   it only ever means a width, so a shut panel is left shut. */
function onPanelResizeDouble() {
  if (panelHidden) return;
  applyPanelWidth(PANEL_DEFAULT);
}

/* The handle is a focusable separator, so it answers the arrow keys too. This
   is the only way to reach the width without a mouse. The stylesheet takes the
   handle out of the tab order while the panel is shut, so these only ever
   arrive at a panel that is open, and the guard is the belt to that braces. */
function onPanelResizeKey(e) {
  if (panelHidden) return;
  var step = e.shiftKey ? 40 : 10;
  if (e.key === 'ArrowLeft')       { e.preventDefault(); applyPanelWidth(panelWidth + step); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); applyPanelWidth(panelWidth - step); }
  else if (e.key === 'Home')       { e.preventDefault(); onPanelResizeDouble(); }
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
  /* The starting state has to reach the document even when there is nothing
     stored, because the default lives in this file and the stylesheet's is the
     open panel. Cheap, and it means one less way for the two to disagree. */
  applyPanelHidden(false);
})();
