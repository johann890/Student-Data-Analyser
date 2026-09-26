/* canvas/gestures.js: Marquee select and pan, both of which start on empty canvas.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   CANVAS GESTURES: MARQUEE SELECT AND PAN
   ============================================================================
   Both start with a press on empty canvas, so they are told apart by modifier
   rather than by target: plain drag selects, space or middle-button drags the
   view. That ordering is deliberate. Selection is the frequent action and gets
   the unmodified gesture; panning is occasional and is mostly unnecessary at
   all once the graph has been zoomed to fit. */

var spaceDown = false;
var marquee = null;   // { x0,y0 world | sx0,sy0 screen | additive | base }
var panning = null;   // { sx, sy, x0, y0 }

/* A press only starts a canvas gesture if it landed on canvas and nothing else.
   Connection hit-strokes are SVG children with their own handlers, and node
   elements re-enable pointer events on their painted parts, so anything that is
   not one of these three elements belongs to something that wants the event. */
function isCanvasBackground(target) {
  if (!target) return false;
  return target.id === 'canvas' || target.id === 'viewport' ||
         target.id === 'svg'    || target.id === 'hint';
}

function marqueeEl() { return document.getElementById('marquee'); }

function startPan(e) {
  panning = { sx: e.clientX, sy: e.clientY, x0: view.x, y0: view.y };
  document.getElementById('canvas').classList.add('panning');
  cancelPreviewTimer(); hidePreview();
  endConnHover();
}

/* Drop any connection hover and rebuild the arrows without their hit strokes.
   Called as a gesture begins, so a badge left under the cursor from a moment ago
   does not stay lit for the duration of the drag. drawArrows() sees
   gestureActive() and skips the interactive parts entirely. */
function endConnHover() {
  hoverConn = null;
  cancelPreviewTimer();
  hidePreview();
  drawArrows();
}

function startMarquee(e) {
  var r = canvasBox();
  var w = toWorld(e.clientX, e.clientY);
  marquee = {
    x0: w.x, y0: w.y,
    sx0: e.clientX - r.left, sy0: e.clientY - r.top,
    // Additive drags extend what is already selected, so several scattered
    // clusters can be gathered up with repeated boxes instead of one huge box
    // that inevitably catches something in between.
    additive: e.shiftKey || e.metaKey || e.ctrlKey,
    base: selection.slice(),
    moved: false,
    /* Node geometry is measured once, here, rather than per mousemove. Heights
       come from offsetHeight, and reading that forces the browser to flush
       layout; doing it for every node on every pointer event is the kind of
       cost that only shows up on the large graphs this feature exists to
       manage. Nothing can move during a marquee, so one snapshot is sound. */
    boxes: nodes.map(function(n) {
      var r2 = nodeBox(n);
      return { id:n.id, x:r2.x, y:r2.y, w:r2.w, h:r2.h };
    })
  };
  document.getElementById('canvas').classList.add('selecting');
  cancelPreviewTimer(); hidePreview();
  endConnHover();
}

function onCanvasMouseDown(e) {
  /* Pan is a view gesture, not a graph one, so it is allowed to start anywhere,
     including on top of a node. startDrag() bows out for these same two cases,
     and the event then bubbles here. */
  if (e.button === 1 || (e.button === 0 && spaceDown)) { e.preventDefault(); startPan(e); return; }
  if (!isCanvasBackground(e.target)) return;
  if (e.button !== 0) return;
  e.preventDefault();
  startMarquee(e);
}

function onCanvasMouseMove(e) {
  if (panning) {
    view.x = panning.x0 + (e.clientX - panning.sx);
    view.y = panning.y0 + (e.clientY - panning.sy);
    clampPan();
    applyView();
    return;
  }
  if (!marquee) return;

  var r = canvasBox();
  var sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (!marquee.moved &&
      (Math.abs(sx - marquee.sx0) > CLICK_SLOP || Math.abs(sy - marquee.sy0) > CLICK_SLOP)) {
    marquee.moved = true;
  }
  if (!marquee.moved) return;

  var box = marqueeEl();
  if (box) {
    box.style.display = 'block';
    box.style.left   = Math.min(marquee.sx0, sx) + 'px';
    box.style.top    = Math.min(marquee.sy0, sy) + 'px';
    box.style.width  = Math.abs(sx - marquee.sx0) + 'px';
    box.style.height = Math.abs(sy - marquee.sy0) + 'px';
  }

  // Live selection while dragging: the ring appears as the box sweeps over a
  // node, so the user can correct the box before releasing rather than
  // discovering afterwards that it caught one node too many.
  var w = toWorld(e.clientX, e.clientY);
  var hit = nodesInWorldRect(marquee.x0, marquee.y0, w.x, w.y, marquee.boxes);
  setSelection(marquee.additive ? marquee.base.concat(hit) : hit);
}

/* Overlap, not containment: a box has to fully enclose a node to select it under
   containment rules, which is unusable here because node heights vary with their
   config panels and the tall ones are the hard ones to enclose. Touching is
   enough. The same rule the marquee in most node editors uses.

   `boxes` is the snapshot taken when the drag began. Omitting it measures live,
   which is what a caller outside a drag wants. */
function nodesInWorldRect(ax, ay, bx, by, boxes) {
  var x1 = Math.min(ax, bx), x2 = Math.max(ax, bx);
  var y1 = Math.min(ay, by), y2 = Math.max(ay, by);
  var src = boxes || nodes.map(function(n) {
    var r = nodeBox(n);
    return { id:n.id, x:r.x, y:r.y, w:r.w, h:r.h };
  });
  return src.filter(function(r) {
    return r.x < x2 && r.x + r.w > x1 && r.y < y2 && r.y + r.h > y1;
  }).map(function(r){ return r.id; });
}

function onCanvasMouseUp() {
  if (panning) {
    panning = null;
    document.getElementById('canvas').classList.remove('panning');
    drawArrows();   // gesture over: the hit strokes and badges come back
    return;
  }
  if (!marquee) return;
  var box = marqueeEl();
  if (box) box.style.display = 'none';
  document.getElementById('canvas').classList.remove('selecting');
  // A press on empty canvas that never became a drag is a click-away, and the
  // ordinary meaning of that is "deselect".
  if (!marquee.moved && !marquee.additive) clearSelection();
  marquee = null;
  drawArrows();
}

/* Wheel zooms about the pointer. There is nothing scrollable on the canvas, so
   the wheel has no competing meaning here, and claiming it makes zoom reachable
   without first finding the toolbar. deltaY is normalised across deltaMode
   (Firefox reports lines, not pixels), and then clamped, so one notch of a coarse
   mouse wheel and one flick of a trackpad land in the same range instead of the
   former jumping several steps at once. */
function onCanvasWheel(e) {
  e.preventDefault();
  var dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;        // lines -> px
  else if (e.deltaMode === 2) dy *= 400;  // pages -> px
  var factor = Math.exp(-dy * 0.0016);
  factor = Math.max(0.78, Math.min(1.28, factor));
  setZoom(view.z * factor, e.clientX, e.clientY);
}

/* A canvas gesture must survive the pointer leaving the canvas (releasing over
   the results panel mid-marquee should still complete the selection), so move
   and up are bound to the document, not to the canvas. */

/* WIRING */
var canvasEl = document.getElementById('canvas');
canvasEl.addEventListener('change', onConfigInput);
canvasEl.addEventListener('input', onConfigInput);
canvasEl.addEventListener('mousedown', onCanvasMouseDown);
canvasEl.addEventListener('wheel', onCanvasWheel, { passive: false });
document.addEventListener('mousemove', onCanvasMouseMove);
document.addEventListener('mouseup', onCanvasMouseUp);

