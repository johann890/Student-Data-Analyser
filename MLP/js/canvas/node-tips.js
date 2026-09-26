/* canvas/node-tips.js: What a node does, after a deliberate hover on its shape.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   WHAT IS THIS NODE
   ============================================================================
   A node is a coloured shape with one word on it, and one word is not enough to
   tell Aggregate Columns from Aggregate Rows, or Select from Select For, on a
   canvas somebody else built. The menus say what each one does at the moment it
   is added and then that sentence is gone; this is the same sentence, available
   later, at the node itself.

   THREE SECONDS
   ---------------------------------------------------------------------------
   Long, deliberately, and much longer than the 450ms the edge preview waits on.
   The edge preview answers a question the user went looking for, by resting on
   a line they had to aim at. A node shape is the thing they drag, double-click
   and cross constantly on the way to somewhere else, so a short delay would put
   a panel over the canvas during ordinary work. Three seconds is longer than
   any of that: a pointer still on a shape after three seconds is not passing
   through it.

   It is also why there is no fade and no animation. Something that took three
   seconds to ask for should appear when it is asked for.

   A SIBLING OF THE SCALED LAYER
   ---------------------------------------------------------------------------
   Like the edge preview and the refusal note, and for the same reason: the tip
   has to stay readable at 30% zoom, which is exactly the zoom at which a shape
   is too small to read and the question is most likely to be asked. The cost is
   that its anchor is in world coordinates and has to be projected.            */

var NODE_TIP_DELAY = 3000;

/* One sentence, occasionally two, per node type. Written out here rather than
   scraped from the toolbar menus, which carry a shorter line for three of these
   and nothing at all for Source, Filter and Output: a menu item is read while
   choosing between neighbours, and this is read in front of one node with no
   neighbours to compare it against.

   The pairs that are hard to tell apart are written to be read against each
   other, because that is the confusion this exists to settle: Aggregate Columns
   says "down each column" where Aggregate Rows says "across each row", and
   Select says "the columns you tick" where Select For says "groups". */
var NODE_TIPS = {
  source: 'Reads the rows from your data files. Every query starts with one, ' +
          'and it will not run until its files are loaded.',
  filter: 'Keeps only the rows that match the conditions you set. Where there ' +
          'are several, all of them have to hold.',
  sort:   'Puts the rows in order by a column. Later keys break the ties the ' +
          'first one leaves.',
  reverse:'Flips the row order. Put it in front of a Take to keep the last few ' +
          'rather than the first.',
  take:   'Keeps the first few rows and drops the rest. Put a Sort in front to ' +
          'make those the top few.',
  unique: 'Drops repeated rows, or lists the distinct values of one column.',
  select: 'Keeps only the columns you tick. Every row comes through.',
  project:'Unfolds each student into one row per course they took. Counts after ' +
          'this count enrolments rather than people.',
  aggregate: 'Reduces the whole table to one value, such as a count or an average.',
  aggregateColumns: 'One row out, with the measure applied down each column.',
  aggregateRows:    'One column out, with the measure applied across each row.',
  combine:'Joins branches into one table: stack their rows, or match them up ' +
          'side by side on a shared column.',
  compare:'Puts branches side by side, one row each, so two cohorts can be read ' +
          'against one another.',
  selectFor: 'Splits the rows into groups by a column, and gives one row per ' +
             'group with a measure beside it.',
  histogram: 'Counts the rows into bands of a number, which is how a value’s ' +
             'spread becomes visible.',
  output: 'Where an answer appears in the results panel. You can carry on ' +
          'building from one.'
};

function nodeTipText(type) { return NODE_TIPS[type] || ''; }

var nodeTipEl = null;
var nodeTipTimer = null;
var nodeTipShape = null;    // the shape the pointer is currently over
var nodeTipAnchor = null;   // world coordinates, projected on every view change

function ensureNodeTipEl() {
  if (nodeTipEl) return nodeTipEl;
  nodeTipEl = document.createElement('div');
  nodeTipEl.className = 'node-tip';
  // Announced rather than only drawn, and never a pointer target: it appears
  // over the canvas the user is working on and must not swallow a click.
  nodeTipEl.setAttribute('role', 'tooltip');
  nodeTipEl.style.display = 'none';
  var cv = document.getElementById('canvas');
  if (cv) cv.appendChild(nodeTipEl);
  return nodeTipEl;
}

function cancelNodeTip() {
  if (nodeTipTimer) { clearTimeout(nodeTipTimer); nodeTipTimer = null; }
}

/* Clears the remembered shape as well as the panel. render() rebuilds every
   shape element, so a remembered one is detached the moment anything changes,
   and comparing against it afterwards would never match. */
function hideNodeTip() {
  cancelNodeTip();
  if (nodeTipEl) nodeTipEl.style.display = 'none';
  nodeTipAnchor = null;
  nodeTipShape = null;
}

// What is on screen, for a test and for nothing else in the application.
function nodeTipShown() {
  return (nodeTipEl && nodeTipEl.style.display !== 'none') ? nodeTipEl.textContent : null;
}

function armNodeTip(nodeId) {
  cancelNodeTip();
  if (!nodeTipText((findNode(nodeId) || {}).type)) return;
  nodeTipTimer = setTimeout(function() {
    nodeTipTimer = null;
    showNodeTip(nodeId);
  }, NODE_TIP_DELAY);
}

function showNodeTip(nodeId) {
  var node = findNode(nodeId);
  var text = node ? nodeTipText(node.type) : '';
  /* Both guards matter and neither is the other. The node can be deleted during
     the three seconds, and a gesture can begin in them: a tip that arrived
     mid-drag would follow the shape around the canvas explaining it. */
  if (!text || gestureActive()) return;
  var el = ensureNodeTipEl();
  el.textContent = text;
  // Anchored to the top edge of the shape, at its middle, which is the one side
  // of a node that is never covered by its own config panel.
  nodeTipAnchor = { x: node.x + NODE_W / 2, y: node.y };
  el.style.display = 'block';
  placeNodeTip();
}

function placeNodeTip() {
  if (!nodeTipEl || !nodeTipAnchor || nodeTipEl.style.display === 'none') return;
  var cv = document.getElementById('canvas');
  if (!cv) return;
  var at = toScreen(nodeTipAnchor.x, nodeTipAnchor.y);
  var cw = cv.clientWidth, ch = cv.clientHeight;
  var w = nodeTipEl.offsetWidth, h = nodeTipEl.offsetHeight;
  var GAP = 12;

  var left = Math.max(6, Math.min(at.x - w / 2, Math.max(6, cw - w - 6)));
  var top = at.y - h - GAP;
  /* Above the shape, because below it is the config panel and covering the
     controls somebody is reaching for is worse than covering empty canvas. It
     flips below only when there is no room above at all, which is a node
     dragged to the very top of the view. */
  if (top < 6) top = at.y + GAP;
  top = Math.max(6, Math.min(top, Math.max(6, ch - h - 6)));
  nodeTipEl.style.left = Math.round(left) + 'px';
  nodeTipEl.style.top = Math.round(top) + 'px';
}

/* ONE LISTENER, NOT TWO PER SHAPE PER RENDER
   ---------------------------------------------------------------------------
   Delegated from the canvas for the reason onConfigInput is: render() throws
   every shape away, and listeners attached to them go with it, so a rebuild
   under a stationary pointer would leave the tip armed against an element that
   no longer exists.

   `mouseover` fires for the shape's children too (the glyph, the label, the
   delete button, the port stubs). closest() maps all of them back to the one
   shape, and the comparison below is what keeps a pointer wandering across a
   glyph from restarting the three seconds over and over. */
function onNodeHover(e) {
  var t = e.target;
  var shape = (t && t.closest) ? t.closest('.node-shape') : null;
  if (shape === nodeTipShape) return;
  hideNodeTip();
  nodeTipShape = shape;
  if (!shape) return;
  var el = shape.parentNode;   // the .node wrapper, which knows which node it is
  var id = null;
  for (var k in nodeEls) if (nodeEls[k] === el) { id = parseInt(k, 10); break; }
  if (id !== null) armNodeTip(id);
}
