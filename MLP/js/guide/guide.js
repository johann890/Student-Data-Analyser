/* guide/guide.js: the guided walkthrough. Loads a practice query, then talks
   through it.

   This file names no step. It reads five field names off a step object (target,
   node, within, title, body, plus an optional onEnter) and nothing else, so all
   the words live in guide/steps.js.

   The panel is parked at the bottom of the canvas, in the same place for every
   step, so the reader's eyes go back to one spot. That is why there is no
   placement arithmetic here: a panel that chases its target has to measure,
   flip, clamp and keep out of the way of gestures, none of which buys anything
   for a walkthrough that asks the reader to do nothing. The ring does move,
   since pointing is what it is for.

   LOAD ORDER: before results/panel-width.js. applyView() calls guidePlace(),
   and panel-width.js runs wirePanelResize() as it loads, which reaches
   applyView() before the first paint. Loaded any later, the page dies on
   "guidePlace is not defined". */

var GUIDE_PAD = 4;      // how far the ring stands off what it marks

/* The index of the step being shown, or null when nothing is running. An index
   and not a resolved step: render() throws away every .node element and resets
   nodeEls, so anything held would be stale the moment the canvas changed. */
var guideAt = null;
var guideSpotEl = null, guidePanelEl = null, guideMarkedEl = null;
var guidePending = false;

function guideRunning() { return guideAt !== null; }
function guideStep()    { return guideAt === null ? null : GUIDE_STEPS[guideAt]; }
function guideStepId()  { var s = guideStep(); return s ? s.id : null; }

/* The nth node of a type, in the order they were added. Steps use it to say
   "the Source" without the step data knowing any node id. Null when there is
   none, which guideResolve() is expected to cope with: the practice query can
   be edited while the walkthrough is up, including by deleting the node the
   current step is about. */
function guideNodeId(type, n) {
  var seen = 0;
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== type) continue;
    if (seen === (n || 0)) return nodes[i].id;
    seen++;
  }
  return null;
}

/* Built once, on first use, the way ensurePreviewEl() does it, so a page that
   never starts the walkthrough never grows either element.

   The buttons are wired with addEventListener rather than onclick attributes,
   unlike the rest of this page. Under jsdom the suite loads the page with
   runScripts: 'outside-only', where an inline handler never fires, so a control
   wired that way is a control the suite cannot press. The entry point in the
   Help dialog keeps its inline handler to match the surrounding markup. */
function ensureGuideEls() {
  if (guideSpotEl) return;

  guideSpotEl = document.createElement('div');
  guideSpotEl.className = 'guide-spot';
  guideSpotEl.id = 'guideSpot';
  document.body.appendChild(guideSpotEl);

  guidePanelEl = document.createElement('div');
  guidePanelEl.className = 'guide-panel';
  guidePanelEl.id = 'guidePanel';
  guidePanelEl.setAttribute('role', 'region');
  guidePanelEl.setAttribute('aria-label', 'Guided walkthrough');
  guidePanelEl.innerHTML =
    '<h4 class="guide-title"></h4>' +
    '<p class="guide-body"></p>' +
    '<div class="guide-foot">' +
      '<span class="guide-count"></span>' +
      '<button type="button" class="guide-nav guide-quit">Close</button>' +
      '<button type="button" class="guide-nav guide-back">Back</button>' +
      '<button type="button" class="guide-nav guide-next">Next</button>' +
    '</div>';
  document.body.appendChild(guidePanelEl);

  guidePanelEl.querySelector('.guide-quit').addEventListener('click', function () { endGuide(); });
  guidePanelEl.querySelector('.guide-back').addEventListener('click', function () { guideBack(); });
  guidePanelEl.querySelector('.guide-next').addEventListener('click', function () { guideNext(); });
}

/* Either a plain selector, or a node. A node has to go through nodeEls, because
   render() gives a .node element no id and no data attribute, so there is no
   selector in the document that names one node. That is forced, not chosen.

   Returning null is legal. A step whose node has been deleted still has copy
   worth reading, so the ring goes and the panel stays. */
function guideResolve(step) {
  if (!step) return null;
  if (step.node) {
    var id = step.node();
    if (id === null || id === undefined) return null;
    var el = nodeEls[id];
    if (!el) return null;
    return step.within ? el.querySelector(step.within) : el;
  }
  if (step.target) return document.querySelector(step.target);
  return null;
}

/* data-guide-target says, in the document, what the current step is about. It
   is there for the suite (jsdom lays nothing out, so every rect is zeros and
   the only honest assertion is which element was picked) and for anyone with
   devtools open. Nothing in the application reads it. */
function guideMark(el) {
  if (guideMarkedEl && guideMarkedEl !== el) guideMarkedEl.removeAttribute('data-guide-target');
  guideMarkedEl = el || null;
  if (el) el.setAttribute('data-guide-target', '');
}

function guideTargetEl() { return guideMarkedEl; }

/* Move the ring onto whatever the current step is about. The panel is not
   touched: it is placed by the stylesheet and stays where it is.

   Called from applyView(), which every geometry change already funnels through
   (zoom, pan, panel resize, panel show and hide, toolbar height, and window
   resize, since toolbar-height.js already listens for that and calls it), and
   from the end of render(), which is where nodes are thrown away and rebuilt.
   Between them the ring cannot be left behind. The first line is what the rest
   of the application pays: one comparison. */
function guidePlace() {
  if (guideAt === null || !guideSpotEl) return;

  var el = guideResolve(guideStep());
  guideMark(el);

  var r = el ? el.getBoundingClientRect() : null;
  if (!r || !(r.width || r.height)) { guideSpotEl.classList.remove('on'); return; }

  guideSpotEl.classList.add('on');
  guideSpotEl.style.left   = Math.round(r.left - GUIDE_PAD) + 'px';
  guideSpotEl.style.top    = Math.round(r.top  - GUIDE_PAD) + 'px';
  guideSpotEl.style.width  = Math.round(r.width  + GUIDE_PAD * 2) + 'px';
  guideSpotEl.style.height = Math.round(r.height + GUIDE_PAD * 2) + 'px';
}

function guideDraw() {
  var step = guideStep();
  if (!step) return;

  guidePanelEl.querySelector('.guide-title').textContent = step.title;
  guidePanelEl.querySelector('.guide-body').textContent = step.body;
  guidePanelEl.querySelector('.guide-count').textContent =
    (guideAt + 1) + ' of ' + GUIDE_STEPS.length;

  guidePanelEl.querySelector('.guide-back').disabled = guideAt === 0;
  guidePanelEl.querySelector('.guide-next').textContent =
    guideAt === GUIDE_STEPS.length - 1 ? 'Done' : 'Next';

  guidePanelEl.classList.add('on');
  guidePlace();
}

function guideGo(index) {
  if (index < 0 || index >= GUIDE_STEPS.length) return;
  guideAt = index;
  var step = GUIDE_STEPS[index];
  if (typeof step.onEnter === 'function') step.onEnter();
  guideDraw();
}

function guideNext() {
  if (guideAt === null) return;
  if (guideAt >= GUIDE_STEPS.length - 1) { endGuide(); return; }
  guideGo(guideAt + 1);
}

function guideBack() {
  if (guideAt === null || guideAt === 0) return;
  guideGo(guideAt - 1);
}

/* The practice query is LEFT on the canvas. It was loaded because the reader
   asked for it, and taking it away again on the way out would be a second
   surprise; it is also the thing they are most likely to want to poke at once
   the words have stopped. */
function endGuide() {
  if (guideAt === null) return;
  guideAt = null;
  guideMark(null);
  if (guideSpotEl)  guideSpotEl.classList.remove('on');
  if (guidePanelEl) guidePanelEl.classList.remove('on');
}

/* The one write this feature makes, and the reader asks for it by pressing the
   button.

   Asked once before it happens, the same way libOpenEntry() asks: the button
   becomes a question and needs a second press. There is no undo in this tool,
   so replacing a canvas without asking is not a thing to do for a walkthrough.
   The armed state lives on the button rather than in a dialog because the
   button is already in front of the reader and already says what it will do. */
function startGuide(btn) {
  var ex = (typeof libExampleGet === 'function') ? libExampleGet(GUIDE_EXAMPLE) : null;
  if (!ex) return;

  if (nodes.length && !guidePending) {
    guidePending = true;
    if (btn) {
      btn.textContent = 'Replace what is on the canvas?';
      btn.classList.add('armed');
    }
    return;
  }

  guidePending = false;
  if (btn) { btn.textContent = 'Start the walkthrough'; btn.classList.remove('armed'); }

  ensureGuideEls();
  closeHelp();
  /* Through the same loader a picked file and a library card go through, which
     is what makes the version guard, the port resolution and the repair apply
     here without being written a third time. */
  if (!loadGraphFromText(JSON.stringify(ex.graph), null)) return;
  zoomToFit();
  guideGo(0);
}

/* A half-armed button is disarmed by leaving the dialog, so that reopening Help
   later does not present a question the reader has forgotten answering. Called
   from closeHelp(). */
function guideDisarm() {
  guidePending = false;
  var btn = document.getElementById('guideStartBtn');
  if (btn) { btn.textContent = 'Start the walkthrough'; btn.classList.remove('armed'); }
}
