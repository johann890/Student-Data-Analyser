/* shell/events.js: Help, and every remaining listener: inputs, dialogs, keys, windows.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
var panelEl = document.getElementById('panelBody');
if (panelEl) panelEl.addEventListener('input', onExportNameInput);

var loadInput = document.getElementById('loadFile');
if (loadInput) loadInput.addEventListener('change', onGraphFileChosen);

// The library's own picker. Its own input rather than a shared one, because
// what happens to the file afterwards is different: Load replaces the canvas,
// Import merges into the store and leaves the canvas alone.
var libImportInput = document.getElementById('libImportFile');
if (libImportInput) libImportInput.addEventListener('change', onLibImportChosen);

/* The two data pickers. Shared by every Source rather than one pair per node:
   which node asked is carried on the input itself by pickHeadersFile(), and a
   dozen Sources would otherwise mean two dozen hidden inputs in the document
   for one dialog at a time. */
var headersInput = document.getElementById('headersFile');
if (headersInput) headersInput.addEventListener('change', onHeadersChosen);

var yearsInput = document.getElementById('yearFiles');
if (yearsInput) yearsInput.addEventListener('change', onYearFilesChosen);

/* The dialog's buttons are wired in the markup like the rest of the toolbar,
   but the field's keys are not something an attribute expresses well. Enter is
   handled here rather than by a <form>: there is no form on this page, and
   adding one would bring a submit-and-navigate default that has to be
   suppressed anyway. */
/* HELP
   ---------------------------------------------------------------------------
   The content is markup in the page, not a string built here, so this is only
   opening, closing and moving around it. */
function helpDialogEl() { return document.getElementById('helpDialog'); }
function helpOpen() {
  var d = helpDialogEl();
  return !!(d && d.classList.contains('open'));
}

// The control that opened it, so focus can go back where it came from.
var helpOpener = null;

function openHelp(btn) {
  var d = helpDialogEl();
  if (!d) return;
  helpOpener = btn || document.querySelector('.help-btn');
  d.classList.add('open');
  syncHelpNav();
  // Focus the scrolling region rather than the first link, so Page Down and the
  // arrow keys work the moment it opens. The common case is reading, not
  // tabbing to a section.
  var body = document.getElementById('helpBody');
  if (body) { body.setAttribute('tabindex', '-1'); body.focus(); }
}

function closeHelp() {
  var d = helpDialogEl();
  if (d) d.classList.remove('open');
  // Focus must leave the panel, not merely be hidden with it. Left inside a
  // closed dialog it belongs to nothing on screen, and the keyboard user is
  // stranded with no visible caret and no working shortcuts.
  var btn = helpOpener;
  helpOpener = null;
  if (btn && btn.focus) btn.focus();
}

/* The section a click asked for, held until the reader scrolls for themselves.
   Scroll position alone cannot answer this: the last sections are shorter than
   the reading area, so the content runs out before their headings can reach the
   top, and the link above the one that was clicked would stay marked instead. */
var helpNavPin = null;

function scrollHelpTo(id) {
  var el = document.getElementById(id);
  if (!el) return;
  helpNavPin = id;
  el.scrollIntoView({ block: 'start' });
  syncHelpNav();
}

/* Marks the section currently under the top of the reading area, unless a link
   was just clicked. Scrolling by hand clears the pin, so the mark goes back to
   reporting where the reader actually is rather than where they last jumped. */
function syncHelpNav() {
  var body = document.getElementById('helpBody');
  var nav = document.getElementById('helpNav');
  if (!body || !nav) return;
  var secs = body.querySelectorAll('section');
  if (!secs.length) return;
  var current = helpNavPin;
  if (!current) {
    // Measured from the reading area's own top edge rather than through
    // offsetTop: these sections' offsetParent is not the scrolling box, so
    // offsetTop carries an offset that has nothing to do with the scroll.
    var top = body.getBoundingClientRect().top;
    // 24px of slack normally: enough to cover the scroll-margin a section lands
    // on, so it counts as current the moment it has been scrolled to rather than
    // a pixel after. At the very bottom the test has to be looser, because the
    // scroll has run out and the last sections can no longer reach the top at
    // all: half the reading area, so whichever of them fills most of the screen
    // is the one marked.
    var atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 2;
    var mark = atEnd ? body.clientHeight / 2 : 24;
    current = secs[0].id;
    for (var i = 0; i < secs.length; i++) {
      if (secs[i].getBoundingClientRect().top - top <= mark) current = secs[i].id;
    }
  }
  var items = nav.querySelectorAll('.help-navitem');
  for (var j = 0; j < items.length; j++) {
    items[j].classList.toggle('current', items[j].getAttribute('data-goto') === current);
  }
}

var helpNavEl = document.getElementById('helpNav');
if (helpNavEl) {
  helpNavEl.addEventListener('click', function(e) {
    var btn = e.target.closest ? e.target.closest('.help-navitem') : null;
    if (btn) scrollHelpTo(btn.getAttribute('data-goto'));
  });
}
var helpBodyEl = document.getElementById('helpBody');
if (helpBodyEl) {
  helpBodyEl.addEventListener('scroll', syncHelpNav);
  // A pin belongs to the click that set it. These are the ways a reader scrolls
  // for themselves: Wheel, touch, keyboard, and a drag of the scrollbar, which
  // sends no wheel event but does press the mouse down on this element.
  var helpUnpin = ['wheel', 'touchmove', 'mousedown', 'keydown'];
  for (var u = 0; u < helpUnpin.length; u++) {
    helpBodyEl.addEventListener(helpUnpin[u], function() {
      helpNavPin = null;
    }, { passive: true });
  }
}

/* Same backdrop rule as the save dialog: a press that starts and ends on the
   backdrop dismisses, a drag that began on the card does not. */
var helpDlgEl = helpDialogEl();
if (helpDlgEl) {
  var helpBackdropPress = false;
  helpDlgEl.addEventListener('mousedown', function(e) {
    helpBackdropPress = (e.target === helpDlgEl);
  });
  helpDlgEl.addEventListener('mouseup', function(e) {
    if (helpBackdropPress && e.target === helpDlgEl) closeHelp();
    helpBackdropPress = false;
  });
}

/* Clicking away cancels, but only a press that both starts and ends on the
   backdrop counts. Checking the target on mousedown alone is not enough: a
   drag that begins inside the card (selecting the name by dragging across it,
   and overshooting) releases on the backdrop, and treating that as clicking
   away would discard the name mid-edit. */
var saveDialogEl_ = document.getElementById('saveDialog');
if (saveDialogEl_) {
  var backdropPress = false;
  saveDialogEl_.addEventListener('mousedown', function(e) {
    backdropPress = (e.target === saveDialogEl_);
  });
  saveDialogEl_.addEventListener('mouseup', function(e) {
    if (backdropPress && e.target === saveDialogEl_) closeSaveDialog();
    backdropPress = false;
  });
}

/* The clear confirmation dismisses the same way, and by the same rule. There
   is no field to drag across here, but the two cards should not answer the
   mouse differently for a reason the user cannot see. Dismissing is Cancel:
   the canvas is left alone. */
var clearDlgEl = clearDialogEl();
if (clearDlgEl) {
  var clearBackdropPress = false;
  clearDlgEl.addEventListener('mousedown', function(e) {
    clearBackdropPress = (e.target === clearDlgEl);
  });
  clearDlgEl.addEventListener('mouseup', function(e) {
    if (clearBackdropPress && e.target === clearDlgEl) closeClearDialog();
    clearBackdropPress = false;
  });
}

var saveNameEl = document.getElementById('saveName');
if (saveNameEl) {
  saveNameEl.addEventListener('input', function() {
    // The half-answered "replace?" goes with the name it was asked about.
    saveLibPending = '';
    updateSaveHint();
  });
  saveNameEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter')  { e.preventDefault(); confirmSaveGraph(); }
    // Escape is left to the document handler above, so cancelling behaves the
    // same whether or not the field happens to hold focus.
  });
}

document.addEventListener('click', closeProcMenu);

/* DESTRUCTIVE SHORTCUTS: THREE GUARDS
   ---------------------------------------------------------------------------
   Backspace deletes the selection, and there is no undo, so being wrong here
   costs the user work they cannot get back. It also cannot simply be dropped in
   favour of Delete: on a Mac keyboard the key labelled "delete" reports as
   Backspace, so removing it would leave those users with no shortcut at all.

   One guard is not enough, because the dangerous case is not "the user is typing
   in a field" (that is the easy case), but "the user believes they are typing
   in a field while the browser disagrees". render() rebuilds the whole canvas,
   and any control that triggered it is destroyed in the process; focus then
   falls back to <body>. The panel still looks active. The next Backspace is read
   as a canvas shortcut and deletes the node being configured.

     1. isTypingTarget:   The event landed on a control, or anywhere inside a
                          config or results panel.
     2. activeElement:    The same test against whatever actually holds focus,
                          which is not always the event target.
     3. keyboardContext:  Where the user last chose to work. Survives focus
                          being lost to <body>, which is the case the first two
                          cannot see.                                          */

function isTypingTarget(t) {
  if (!t || !t.tagName) return false;
  var tag = t.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable) return true;
  // Anything inside a panel or the save dialog counts, control or not: those
  // are the only places on screen where a keystroke could plausibly have been
  // meant as text. The dialog is listed even though its only focusable field is
  // an INPUT already caught above, because the guard is also asked about
  // document.activeElement, and a click on the dialog's own chrome moves focus
  // off the input while the dialog is still open.
  return !!(t.closest && t.closest('.node-config, .output-panel, .save-dialog'));
}

/* 'canvas' while the user is working on the graph, 'panel' while they are
   editing a node's configuration or the results panel. Recorded on mousedown in
   the capture phase, so it is still set for handlers that stop propagation.
   The connection delete badge does exactly that. */
var keyboardContext = 'canvas';

document.addEventListener('mousedown', function(e) {
  var t = e.target;
  if (!t || !t.closest) return;
  // The toolbar is deliberately not a panel: adding a node selects it, and
  // Backspace immediately afterwards to undo a mis-click is a reasonable thing
  // to want.
  keyboardContext = t.closest('.node-config, .output-panel') ? 'panel' : 'canvas';
}, true);

function safeToDelete(e) {
  return keyboardContext === 'canvas' &&
         !isTypingTarget(e.target) &&
         !isTypingTarget(document.activeElement);
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    // The dialog is modal, so it consumes the key. Without this, cancelling a
    // save would also clear the selection underneath it: A second, unasked-for
    // change from a keystroke that meant "never mind".
    if (saveDialogOpen())  { e.preventDefault(); closeSaveDialog(); return; }
    // Escape on a confirmation means "no", which is what Cancel means, so it
    // closes without clearing. The checkbox goes with it unread.
    if (clearDialogOpen()) { e.preventDefault(); closeClearDialog(); return; }
    /* The library, before Help and after the two small cards, which is the
       order they stack in. A rename in progress handles its own Escape and
       stops the event, so this is only reached when nothing inside the dialog
       has a smaller thing to abandon.

       A half-pressed Open or Delete is abandoned WITHOUT closing the dialog:
       the user asked a question of the button and Escape is the answer "no" to
       that question, not "shut the library". Pressing it twice still closes. */
    if (libraryOpen()) {
      e.preventDefault();
      if (libPending) { libPending = null; renderLibrary(); }
      else closeLibrary();
      return;
    }
    if (helpOpen())        { e.preventDefault(); closeHelp(); return; }
    closeProcMenu();
    clearSelection();
    return;
  }

  /* Help is modal, so nothing below here applies while it is open. Without
     this, reading the shortcut table with the canvas behind you would let a
     stray F or Delete rearrange or destroy the graph you came here to learn
     about. Escape above is the deliberate exception: it closes it. */
  if (helpOpen()) return;
  /* And the library, for the same reason. Its grid is scrollable and its cards
     carry buttons, so the keyboard is in use while it is up, and a stray F or
     Delete reaching the canvas would rearrange or destroy the graph the user
     came here to replace deliberately. */
  if (libraryOpen()) return;
  /* And the confirmation, for the same reason with more at stake. The check
     below catches this while focus is inside the card, but a click on the
     backdrop can leave focus on <body> with the dialog still up, and the one
     moment a stray Delete must not reach the canvas is while the user is being
     asked whether to destroy it. */
  if (clearDialogOpen()) return;
  if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;

  var mod = e.ctrlKey || e.metaKey;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    // The selection bar's Delete button stays available either way, so a user
    // whose keystroke is suppressed here is never stuck.
    if (selection.length && safeToDelete(e)) { e.preventDefault(); deleteSelection(); }
    return;
  }
  if (mod && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAll(); return; }

  if (e.key === ' ' && !spaceDown) {
    spaceDown = true;
    document.getElementById('canvas').classList.add('pan-ready');
    e.preventDefault();  // stop the page treating space as "scroll" or "click the focused button"
    return;
  }

  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); return; }
  if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); return; }
  if (e.key === '0' && mod)           { e.preventDefault(); zoomReset(); return; }
  if (e.key === 'f' || e.key === 'F') { if (!mod) { e.preventDefault(); zoomToFit(); } return; }
  if (e.key === 'w' || e.key === 'W') { if (!mod) { e.preventDefault(); toggleResultsPanel(); } return; }
  // Shift-slash on most layouts, so no modifier check: '?' is already shifted.
  if (e.key === '?') { e.preventDefault(); openHelp(); return; }
});

document.addEventListener('keyup', function(e) {
  if (e.key === ' ') {
    spaceDown = false;
    document.getElementById('canvas').classList.remove('pan-ready');
  }
});

// Held space plus a window switch would otherwise leave the canvas stuck in
// pan-ready with no keyup ever arriving to clear it.
window.addEventListener('blur', function() {
  spaceDown = false;
  var cv = document.getElementById('canvas');
  if (cv) { cv.classList.remove('pan-ready'); cv.classList.remove('panning'); }
  panning = null;
  // A marquee abandoned by an alt-tab would otherwise leave its rectangle
  // painted on the canvas with no drag left to clear it.
  if (marquee) {
    var box = marqueeEl();
    if (box) box.style.display = 'none';
    marquee = null;
  }
  if (cv) cv.classList.remove('selecting');
  drawArrows();
});

