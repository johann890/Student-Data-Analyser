/* canvas/render.js: The repaint, dragging a node, and making or removing a connection.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
function render() {
  /* Every shape element is about to be thrown away, and a tip armed against
     one of them would fire against something detached. Cleared before the
     rebuild rather than after, so nothing can arrive in between. */
  hideNodeTip();
  var vp = document.getElementById('viewport');
  var old = vp.querySelectorAll('.node');
  for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
  nodeEls = {};
  document.getElementById('hint').style.display = nodes.length === 0 ? 'block' : 'none';

  // A node deleted while selected must not leave its id behind, or the count in
  // the selection bar drifts away from what is actually ringed on screen.
  selection = selection.filter(function(id){ return findNode(id); });

  var schemas = computeSchemas();

  nodes.forEach(function(node) {
    var el = document.createElement('div');
    el.className = 'node' + (isSelected(node.id) ? ' selected' : '') +
                   (isNodeOff(node) ? ' node-off' : '');
    el.style.left = node.x + 'px';
    el.style.top  = node.y + 'px';
    el.innerHTML = shapeHTML(node) + configHTML(node, schemas);
    vp.appendChild(el);
    nodeEls[node.id] = el;

    var shape = el.querySelector('.node-shape');
    /* The word, under the name, on the shape itself.

       The drained colour and the dashed border say "off" to someone who already
       knows the switch exists. This says it to everyone else, and it is the one
       signal that survives being described: a user pointing at a screenshot can
       say which node is off, and a marker can read the query without being told
       the convention.

       Appended here rather than written into each shape's markup because there
       are eighteen of those and they differ in what they already hold. It is
       positioned out of the flow, so a shape that stacks a glyph above its name
       is not re-laid-out by gaining a second line, and a shape that centres one
       word does not shuffle it upwards to make room. */
    if (shape && isNodeOff(node)) {
      var offTag = document.createElement('span');
      offTag.className = 'node-off-tag';
      offTag.textContent = '(Off)';
      shape.appendChild(offTag);
    }
    if (shape) {
      shape.addEventListener('mousedown', function(e){ startDrag(e, node.id); });
      // Double-click selects the whole connected branch. The cheapest route to
      // "delete this entire arm of the query" without dragging a box around it,
      // which is awkward when branches interleave on screen.
      shape.addEventListener('dblclick', function(e) {
        e.preventDefault(); e.stopPropagation();
        selectBranch(node.id);
      });
    }
  });

  syncSelectionUI();
  /* The dock's chips are not rebuilt here, only the lines saying what each
     variable is used by: deleting a node changes that without changing the
     variable. A rebuild would take away the field the user may be typing in,
     which is the same reason selection is synced rather than re-rendered. */
  syncVarUsage();
  drawArrows();
}

/* Delegated config listener: One handler for every control on the canvas.
   Registered once at start-up rather than per element per render, so a rebuild
   cannot leave stale listeners behind.

   Selects and checkboxes re-render (the panel's shape may depend on them);
   text and number inputs do not, because rebuilding the DOM mid-keystroke
   destroys the element being typed into. */
function onConfigInput(e) {
  var el = e.target;
  if (!el || !el.getAttribute) return;
  var nid = el.getAttribute('data-node');
  var key = el.getAttribute('data-key');
  if (!nid || !key) return;

  var value = el.type === 'checkbox' ? el.checked : el.value;
  var id = parseInt(nid, 10);
  var node = findNode(id);
  setCfg(id, key, value);
  /* Showing or hiding an Output in the panel computes nothing, so it must not
     invalidate the run. Being made to press Run Query again to get back a block
     you only asked to look away from would be a poor trade, and the answer on
     screen is still the answer. The blocks already drawn are re-dressed. */
  if (key === 'panel') applyPanelVisibility();
  /* Same rule, one node further in: which columns an Output SHOWS computes
     nothing either. The same key on a Select does narrow the table that travels
     on, so the node type is part of the test and not just the key.

     Re-dressing and marking stale are both done when both are true. The block
     in front of the user is correct the moment the box is ticked, and the note
     above it is about the blocks BELOW this Output, which really are out of
     date. Choosing one would either lie about this block or lie about those. */
  else if (node && node.type === 'output' && key.indexOf('column:') === 0) {
    if (!refreshOutputView(node) || outputFeedsAnother(node)) markStale();
  }
  else markStale();

  var reshapes = el.tagName === 'SELECT' || el.type === 'checkbox';
  if (reshapes && e.type === 'change') {
    render();
    // render() replaces the element that was just used, so the control loses
    // focus mid-interaction. Put it back on its replacement.
    var again = document.querySelector('[data-node="' + nid + '"][data-key="' + key.replace(/"/g, '\\"') + '"]');
    // A control can also disappear rather than be replaced: One select's value
    // decides which others the panel offers. Falling back to the same node's
    // panel keeps focus with the user's work instead of dropping it on <body>,
    // where the next Backspace would be read as a canvas shortcut.
    if (!again) again = document.querySelector('[data-node="' + nid + '"]');
    if (again && again.focus) again.focus();
  }
}

/* ARROWS */
function getNodeEdgeColor(node) {
  var incoming = connections.filter(function(c){ return c.to === node.id; });
  if (incoming.length) return incoming[0].color;
  return node.color || EDGE_PALETTE[0];
}

function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

function drawArrow(parent, p0, tip, color, opacity, isGhost) {
  var ah = 14;
  var pathEndX = tip.x - ah, pathEndY = tip.y;
  var dx = Math.max(40, Math.abs(tip.x - p0.x) * 0.45);
  var p1x = p0.x + dx, p1y = p0.y;
  var p2x = pathEndX - Math.max(10, dx * 0.2), p2y = pathEndY;

  var pathEl = svgEl('path');
  pathEl.setAttribute('d', 'M ' + p0.x + ' ' + p0.y + ' C ' + p1x + ' ' + p1y + ' ' + p2x + ' ' + p2y + ' ' + pathEndX + ' ' + pathEndY);
  pathEl.setAttribute('stroke', color);
  pathEl.setAttribute('stroke-width', isGhost ? '1.5' : '2');
  pathEl.setAttribute('fill', 'none');
  pathEl.setAttribute('opacity', opacity);
  if (isGhost) pathEl.setAttribute('stroke-dasharray', '6 4');

  var ang = Math.atan2(tip.y - pathEndY, tip.x - pathEndX), spread = 0.42;
  var arrowEl = svgEl('polygon');
  arrowEl.setAttribute('points',
    tip.x + ',' + tip.y + ' ' +
    (tip.x - ah * Math.cos(ang - spread)) + ',' + (tip.y - ah * Math.sin(ang - spread)) + ' ' +
    (tip.x - ah * Math.cos(ang + spread)) + ',' + (tip.y - ah * Math.sin(ang + spread)));
  arrowEl.setAttribute('fill', color);
  arrowEl.setAttribute('opacity', isGhost ? opacity : Math.min(1, parseFloat(opacity) + 0.2));

  // Cubic bezier at t=0.5 -> (P0 + 3P1 + 3P2 + P3) / 8, used as a midpoint
  // fallback where getPointAtLength is unavailable.
  pathEl._mid = {
    x: (p0.x + 3 * p1x + 3 * p2x + pathEndX) / 8,
    y: (p0.y + 3 * p1y + 3 * p2y + pathEndY) / 8
  };

  parent.appendChild(pathEl);
  parent.appendChild(arrowEl);
  return pathEl;
}

/* DRAG
   onMove used to call render(), tearing down and rebuilding every node's DOM at
   pointer rate. Now it moves the existing elements and redraws only the arrows;
   panel contents cannot change during a drag, so there is nothing to rebuild.
   This was previously masked by the fact that config lived in the DOM. A full
   rebuild was needed to avoid losing it. With the model authoritative, it is
   not. */
var ghostTarget = null;
/* The nearest node the drag came close to and could NOT wire to. Tracked beside
   the ghost target and in the same sweep, because the refusal has to name a
   node and the drop handler no longer has the geometry to find one. */
var missTarget = null;

// Below this many screen pixels a press-and-release is a click, not a drag. It
// is measured in screen space on purpose: the gesture is about the user's hand,
// not about how much world the hand covered, and a world-space threshold would
// demand pixel-perfect stillness when zoomed out.
var CLICK_SLOP = 4;

function startDrag(e, nodeId) {
  var tag = e.target.tagName;
  if (tag === 'SELECT' || tag === 'INPUT' || tag === 'BUTTON' || tag === 'OPTION') return;
  if (e.button !== 0) return;          // middle-drag over a node is a pan, handled upstream
  if (spaceDown) return;               // ditto space-drag
  e.preventDefault();
  // The press that starts a drag ends any hover the pointer was resting in.
  hideNodeTip();
  var node = findNode(nodeId);
  if (!node) return;

  /* Selection is resolved on mousedown rather than on click, because the answer
     decides what the drag about to happen will move. Three cases:
       additive click:   Toggle this node, and if that deselected it, no drag
       unselected node:  Becomes the whole selection
       selected node:    Selection is left alone, so a group can be dragged
                         without the press collapsing it to one node first    */
  if (e.shiftKey || e.metaKey || e.ctrlKey) {
    toggleSelected(nodeId);
    if (!isSelected(nodeId)) return;
  } else if (!isSelected(nodeId)) {
    selectOnly(nodeId);
  }

  var w = toWorld(e.clientX, e.clientY);
  var moving = isSelected(nodeId) && selection.length > 1
    ? selection.map(findNode).filter(Boolean)
    : [node];

  drag = {
    node: node,
    // Offsets captured once, in world space, so the grab point stays under the
    // cursor even if the zoom changes mid-drag.
    group: moving.map(function(n){ return { node:n, dx: w.x - n.x, dy: w.y - n.y }; }),
    startX: e.clientX, startY: e.clientY,
    moved: false
  };
  ghostTarget = null;
  missTarget = null;
  cancelPreviewTimer(); hidePreview(); hideConnNote();
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function onMove(e) {
  if (!drag) return;
  if (!drag.moved &&
      (Math.abs(e.clientX - drag.startX) > CLICK_SLOP ||
       Math.abs(e.clientY - drag.startY) > CLICK_SLOP)) {
    drag.moved = true;
  }
  if (!drag.moved) return;

  var w = toWorld(e.clientX, e.clientY);
  drag.group.forEach(function(g) {
    var s = SHAPE[g.node.type];
    // Clamped to the world, not the viewport: the reachable area is a property
    // of the document, not of the window it happens to be shown in.
    g.node.x = Math.max(0, Math.min(WORLD_W - NODE_W, w.x - g.dx));
    g.node.y = Math.max(0, Math.min(WORLD_H - s.h,    w.y - g.dy));
    var el = nodeEls[g.node.id];
    if (el) { el.style.left = g.node.x + 'px'; el.style.top = g.node.y + 'px'; }
  });

  /* Snap-to-connect stays a single-node gesture. With several nodes moving there
     is no defensible answer to which one the ghost edge should come from, and
     guessing would wire up a connection the user never aimed at. The one kind
     of mistake that is tedious to undo, since it has to be found first. */
  ghostTarget = null;
  missTarget = null;
  if (drag.group.length === 1) {
    var dn = drag.node, best = null, bestDist = SNAP_DIST;
    var miss = null, missDist = SNAP_DIST;
    nodes.forEach(function(n) {
      if (n.id === dn.id) return;
      var dir = resolveDirection(dn, n);
      if (!dir) {
        /* Close enough to have been aimed at, impossible to wire. Remembered so
           that the release can say why instead of doing nothing at all. */
        var gap = snapDistance(dn, n);
        if (gap < missDist) { missDist = gap; miss = n.id; }
        return;
      }
      var dx = dir.tip.x - dir.p0.x, dy = dir.tip.y - dir.p0.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) { bestDist = dist; best = n; }
    });
    ghostTarget = best ? best.id : null;
    // A miss only matters when nothing else was going to happen.
    missTarget = ghostTarget === null ? miss : null;
  }

  drawArrows();
}

function onUp() {
  var wired = false;
  var refusal = null, refusalAt = null;
  if (drag && drag.moved && ghostTarget !== null) {
    var gt = findNode(ghostTarget);
    var dir = gt ? resolveDirection(drag.node, gt) : null;
    if (dir) {
      // Same pair, same port is the duplicate to refuse. The same pair on two
      // different ports is legitimate. One table can be both the data and the
      // labels, so the port is part of the identity of a connection.
      var exists = connections.some(function(c) {
        return c.from === dir.from.id && c.to === dir.to.id && c.port === dir.port;
      });
      if (!exists) {
        connections.push({ from: dir.from.id, to: dir.to.id, port: dir.port,
                           color: pickEdgeColor(dir.from) });
        markStale();
        wired = true;
      } else {
        /* The ghost arrow appeared and the drop wired nothing. Only reachable on
           Combine and Compare, whose ports go on accepting wires, and the one
           refusal in the tool that contradicts something the user was just
           shown. It is said out loud for that reason. */
        refusal = upstreamLabel(dir.from) + ' already feeds ' + upstreamLabel(dir.to) +
          '. A second wire between the same two nodes would carry the same rows twice.';
        refusalAt = midWorld(dir.from, dir.to);
      }
    }
  } else if (drag && drag.moved && missTarget !== null) {
    var mt = findNode(missTarget);
    refusal = mt ? connectRefusal(drag.node, mt) : null;
    if (refusal) refusalAt = midWorld(drag.node, mt);
  }
  var moved = drag && drag.moved;
  drag = null;
  ghostTarget = null;
  missTarget = null;
  if (refusal) showConnNote(refusal, refusalAt);
  document.removeEventListener('mousemove', onMove);
  document.removeEventListener('mouseup', onUp);

  /* Only a wiring change can alter what a config panel offers, so only a wiring
     change earns a full rebuild. A plain move (and a plain click, which is now
     most mousedowns since clicking selects) redraws the arrows and stops there.
     Rebuilding on every click would drop focus from whatever control the user
     had open and re-run schema propagation for nothing. */
  if (wired) render();
  else if (moved) drawArrows();
}

// First outgoing edge inherits the upstream colour; later ones take a distinct
// palette colour so branches stay visually separable.
function pickEdgeColor(fromNode) {
  var outgoing = connections.filter(function(c){ return c.from === fromNode.id; });
  if (outgoing.length === 0) return getNodeEdgeColor(fromNode);
  var used = outgoing.map(function(c){ return c.color; });
  for (var i = 0; i < EDGE_PALETTE.length; i++) {
    if (used.indexOf(EDGE_PALETTE[i]) === -1) return EDGE_PALETTE[i];
  }
  return getNodeEdgeColor(fromNode);
}

/* CONNECTION REMOVAL */
// The port is part of a connection's identity: two wires from one node into two
// different ports of the same target are distinct edges, and hovering or
// deleting one must not pick up the other.
function connKey(c) { return c.from + '->' + c.to + ':' + c.port; }

function removeConnection(from, to, port) {
  connections = connections.filter(function(c) {
    return !(c.from === from && c.to === to && c.port === port);
  });
  hoverConn = null;
  markStale();
  render();
}

function buildDeleteBadge(conn, pathEl) {
  var mid;
  try { mid = pathEl.getPointAtLength(pathEl.getTotalLength() / 2); }
  catch (err) { mid = pathEl._mid; }
  if (!mid) return null;

  var g = svgEl('g');
  g.setAttribute('class', 'conn-delete');
  /* Counter-scaled so the badge stays the same size on screen at any zoom. It
     lives in the scaled layer because it has to sit on the line, but a target
     that shrinks with the view would be at its least clickable exactly when
     there are most connections to tidy up. */
  g.setAttribute('transform',
    'translate(' + mid.x + ',' + mid.y + ') scale(' + (1 / view.z) + ')');

  var circle = svgEl('circle');
  circle.setAttribute('r', '9');
  g.appendChild(circle);

  var r = 3.6;
  [[-r,-r,r,r], [-r,r,r,-r]].forEach(function(p) {
    var line = svgEl('line');
    line.setAttribute('x1', p[0]); line.setAttribute('y1', p[1]);
    line.setAttribute('x2', p[2]); line.setAttribute('y2', p[3]);
    g.appendChild(line);
  });

  var title = svgEl('title');
  title.textContent = 'Remove this connection';
  g.appendChild(title);

  g.addEventListener('mousedown', function(e){ e.stopPropagation(); });
  g.addEventListener('click', function(e) {
    e.stopPropagation();
    removeConnection(conn.from, conn.to, conn.port);
  });
  return g;
}

