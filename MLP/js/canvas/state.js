/* canvas/state.js: Graph state, the world/zoom/pan transform, and selection.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   UI: The canvas, the panels, persistence, and every event wired to them
   ============================================================================
   Graph state, the view transform, selection, ports and port geometry; the
   config panels and results panel; export, save/load, canvas gestures, and the
   listeners that connect them. Loads last: the event wiring and the first
   paint at the foot of this file need the other two files already parsed.
   ============================================================================
   Part of the query builder. LOAD ORDER MATTERS, and the order is the script
   list at the foot of index.html. These are deliberately NOT ES modules; the tool is
   opened from Finder at file://, where module scripts are fetched with CORS
   against an opaque origin and refused. Classic scripts sharing one global
   scope are what works there, which is why nothing here is wrapped in an IIFE
   and why a name declared in one file is visible in the next.                */

/* ============================================================================
   STATE
   ============================================================================
   Every node owns its own configuration in node.cfg. Previously the config
   lived in the DOM and was scraped back by a saveState() pass before each
   re-render, which meant an unrendered panel read as "nothing set" (hence the
   defensive guard the Compare node needed) and made the graph impossible to
   serialise. The model is now authoritative: controls write into cfg on change,
   render() only reads. That is also what makes save/load possible at all.    */

var nodes = [];
var connections = [];   // [{from, to, port, color}]. Port names an input on the TO node
var idCtr = 0;
var drag = null;
var SNAP_DIST = 160;    // px proximity threshold, measured between shape edges
var hoverConn = null;
var exportData = {};    // outputNodeId -> {index, name, table, log}
var resultsFresh = false;
var nodeEls = {};       // nodeId -> DOM element, for the drag fast path

function uid() { return ++idCtr; }

/* The width of a node's slot, which is the width of its config panel: the shape
   is centred inside it and the panel fills it. Widened from 220 because the
   panels are grids of small controls and the value column was the one paying
   for every other column's minimum, which showed first on a criterion row
   carrying a variable chip. Every geometry that places a shape or an arrow
   reads this rather than a literal, so the stylesheet is the only other place
   the number appears. */
var NODE_W = 250;
var SHAPE = {
  /* The circle every query starts with, and the one shape a first-time reader
     looks for. Larger than the rest on purpose: it is the only node that can be
     in a state the canvas has to announce (no files loaded, drawn as a dashed
     ring), and that ring has to be legible at the zoom a whole graph is read
     at. Kept in step with .shape-source by 17-shape-styling. */
  source:  { w:120, h:120 },
  filter:  { w:106, h:84 },
  compare: { w:112, h:78 },
  // Taller than every other processing node because it is the only one with
  // two labelled port stubs down its left edge, and they need room not to
  // collide with each other or with the shape's own text.
  selectFor:{ w:118, h:88 },
  histogram:{ w:106, h:72 },
  sort:    { w:106, h:72 },
  reverse: { w:106, h:72 },
  take:    { w:106, h:72 },
  unique:  { w:106, h:72 },
  select:  { w:106, h:72 },
  project: { w:106, h:72 },
  aggregate:        { w:106, h:72 },
  aggregateColumns: { w:112, h:72 },
  aggregateRows:    { w:112, h:72 },
  combine:          { w:106, h:72 },
  output:  { w:106, h:66 }
};

/* ============================================================================
   VIEW: WORLD COORDINATES, ZOOM AND PAN
   ============================================================================
   Node x/y were previously viewport pixels: a node's position meant "this many
   pixels from the top-left of the visible canvas", so the reachable area was
   whatever the window happened to be, and a node dragged to the edge of a small
   window was at a different logical place than the same drag in a large one.

   They are now world coordinates in a fixed logical area, and the view is a
   separate concern: a scale plus a translation applied to one wrapper element.
   The model never knows what is on screen. That is what makes zoom possible
   without touching the graph, and it means a saved query means the same thing
   on any display, so the file format is untouched by this change.

       screen = world * z + pan            (pan is in screen px)
       world  = (screen - pan) / z

   Every conversion goes through toWorld/toScreen. Reading node positions
   straight off clientX again is the one way to reintroduce the bug this
   replaces, because it silently works at 100% and only skews at other zooms. */

var WORLD_W = 5000, WORLD_H = 3500;
var MIN_ZOOM = 0.3, MAX_ZOOM = 2;
var ZOOM_STEP = 1.2;

var view = { z: 1, x: 0, y: 0 };

function canvasBox() { return document.getElementById('canvas').getBoundingClientRect(); }

function toWorld(clientX, clientY) {
  var r = canvasBox();
  return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
}
function toScreen(wx, wy) {
  return { x: wx * view.z + view.x, y: wy * view.z + view.y };
}
function viewCentreWorld() {
  var r = canvasBox();
  return toWorld(r.left + r.width / 2, r.top + r.height / 2);
}

/* Pan is clamped so the world can never be dragged off screen entirely. When
   the world is smaller than the viewport (which is what zooming out far enough
   produces), there is no valid pan, so it is centred instead. Without this,
   zooming out leaves the graph pinned to a corner against dead space. */
function clampPan() {
  var r = canvasBox();
  var sw = WORLD_W * view.z, sh = WORLD_H * view.z;
  view.x = sw <= r.width  ? (r.width  - sw) / 2 : Math.min(0, Math.max(r.width  - sw, view.x));
  view.y = sh <= r.height ? (r.height - sh) / 2 : Math.min(0, Math.max(r.height - sh, view.y));
}

function applyView() {
  var vp = document.getElementById('viewport');
  if (vp) {
    vp.style.width  = WORLD_W + 'px';
    vp.style.height = WORLD_H + 'px';
    vp.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.z + ')';
  }
  var lbl = document.getElementById('zoomLevel');
  if (lbl) lbl.textContent = Math.round(view.z * 100) + '%';
  /* The refusal note and the node tip are anchored in world space but drawn
     outside the scaled layer, so both have to be re-projected whenever the
     transform moves. */
  placeConnNote();
  placeNodeTip();
}

/* Zoom about a fixed point: the world position under the cursor stays under the
   cursor. Anchoring to the canvas centre instead (the naive version) walks
   the graph away from wherever the user was looking, which is why wheel zoom
   passes the pointer through. */
function setZoom(z, clientX, clientY) {
  var r = canvasBox();
  if (clientX === undefined) { clientX = r.left + r.width / 2; clientY = r.top + r.height / 2; }
  var anchor = toWorld(clientX, clientY);
  view.z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  view.x = (clientX - r.left) - anchor.x * view.z;
  view.y = (clientY - r.top)  - anchor.y * view.z;
  clampPan();
  applyView();
  repositionPreview();
}

function zoomIn()    { setZoom(view.z * ZOOM_STEP); }
function zoomOut()   { setZoom(view.z / ZOOM_STEP); }
function zoomReset() { setZoom(1); }

/* Open on the middle of the world rather than its top-left corner. Not
   cosmetic: pan is clamped so the world can never show dead space around it, and
   at a corner two of those clamps are always active, so zooming out drags the
   graph diagonally into the corner instead of pulling away from the pointer,
   which reads as the canvas fighting back. From the middle there is world on
   every side and zoom is symmetric until an edge is genuinely approached. */
function centreView() {
  var r = canvasBox();
  view.x = r.width  / 2 - (WORLD_W / 2) * view.z;
  view.y = r.height / 2 - (WORLD_H / 2) * view.z;
  clampPan();
  applyView();
}

/* Measured, not assumed: a node's height depends on its config panel, which
   depends on the schema reaching it. SHAPE only describes the head. */
function nodeBox(node) {
  var el = nodeEls[node.id];
  // offsetHeight is a layout value and ignores ancestor transforms, so this is
  // a world-space height at any zoom.
  var h = el ? el.offsetHeight : SHAPE[node.type].h;
  return { x: node.x, y: node.y, w: NODE_W, h: h };
}

function graphBounds() {
  if (!nodes.length) return null;
  var b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  nodes.forEach(function(n) {
    var r = nodeBox(n);
    b.x1 = Math.min(b.x1, r.x);       b.y1 = Math.min(b.y1, r.y);
    b.x2 = Math.max(b.x2, r.x + r.w); b.y2 = Math.max(b.y2, r.y + r.h);
  });
  return b;
}

/* Fit caps at 100%: scaling a two-node graph up to fill the window would make
   the config text enormous and tell the user nothing. Fit is for seeing
   everything, not for filling space. */
function zoomToFit() {
  var b = graphBounds();
  if (!b) { setZoom(1); return; }
  var r = canvasBox(), pad = 70;
  var bw = Math.max(1, b.x2 - b.x1), bh = Math.max(1, b.y2 - b.y1);
  var z = Math.min((r.width - pad * 2) / bw, (r.height - pad * 2) / bh, 1);
  view.z = Math.max(MIN_ZOOM, z);
  view.x = (r.width  - bw * view.z) / 2 - b.x1 * view.z;
  view.y = (r.height - bh * view.z) / 2 - b.y1 * view.z;
  clampPan();
  applyView();
}

/* ============================================================================
   SELECTION
   ============================================================================
   Selection is transient view state keyed by node id, deliberately outside the
   graph model: it is not serialised, and it survives a render() because ids
   survive a render(). Changing it must not rebuild the canvas (a rebuild
   destroys any config control the user is mid-edit in), so every selection
   change goes through syncSelectionUI(), which only toggles classes. */

var selection = [];

function isSelected(id) { return selection.indexOf(id) !== -1; }

function setSelection(ids) {
  // Filter against live nodes so a deleted id can never linger and resurrect a
  // selection ring on a recycled element.
  selection = ids.filter(function(id, i) {
    return ids.indexOf(id) === i && findNode(id);
  });
  syncSelectionUI();
}
function selectOnly(id)     { setSelection([id]); }
function clearSelection()   { setSelection([]); }
function selectAll()        { setSelection(nodes.map(function(n){ return n.id; })); }
function addToSelection(id) { if (!isSelected(id)) setSelection(selection.concat([id])); }
function toggleSelected(id) {
  setSelection(isSelected(id)
    ? selection.filter(function(x){ return x !== id; })
    : selection.concat([id]));
}

function syncSelectionUI() {
  nodes.forEach(function(n) {
    var el = nodeEls[n.id];
    if (!el) return;
    if (isSelected(n.id)) el.classList.add('selected');
    else el.classList.remove('selected');
  });

  var bar = document.getElementById('selBar');
  var cnt = document.getElementById('selCount');
  if (!bar || !cnt) return;
  if (selection.length) {
    cnt.textContent = selection.length + ' node' + (selection.length === 1 ? '' : 's') + ' selected';
    bar.classList.add('show');
    syncSelOffButton();
  } else {
    bar.classList.remove('show');
  }
}

/* The button reads the selection it is about to act on, because "Switch off" on
   a selection that is already off is a button that appears to do nothing. It
   says the same thing the key does, and it is disabled outright when the
   selection holds nothing that can be switched: a selection of one Source. A
   label that changes is better than a button that argues after the fact. */
function syncSelOffButton() {
  var btn = document.getElementById('selOff');
  if (!btn) return;
  var targets = selection.map(findNode).filter(nodeCanBeOff);
  btn.disabled = targets.length === 0;
  var allOff = targets.length > 0 && targets.every(function(n){ return !!n.off; });
  btn.textContent = allOff ? 'Switch on' : 'Switch off';
  btn.classList.toggle('is-on', allOff);
}

/* Every node reachable from a start node, following edges in either direction.
   The connected component, which is what "this branch" means to someone looking
   at the canvas. Direction is ignored on purpose: a Compare node's two input
   chains are one visual branch even though no edge runs between them. */
function connectedComponent(startId) {
  var seen = [startId], queue = [startId];
  while (queue.length) {
    var id = queue.shift();
    connections.forEach(function(c) {
      var other = c.from === id ? c.to : (c.to === id ? c.from : null);
      if (other !== null && seen.indexOf(other) === -1) { seen.push(other); queue.push(other); }
    });
  }
  return seen;
}

function selectBranch(id) { setSelection(connectedComponent(id)); }

/* Bulk delete. Connections are dropped when either end goes, which is the same
   rule removeNode() has always used. Applied once over the whole set rather
   than once per node, so a graph is never briefly inconsistent mid-delete. */
function deleteSelection() {
  if (!selection.length) return;
  var doomed = selection.slice();
  doomed.forEach(forgetSourceData);
  rebuildRegistries();
  nodes = nodes.filter(function(n){ return doomed.indexOf(n.id) === -1; });
  connections = connections.filter(function(c) {
    return doomed.indexOf(c.from) === -1 && doomed.indexOf(c.to) === -1;
  });
  selection = [];
  cancelPreviewTimer(); hidePreview();
  /* The note names nodes by number, so it goes when nodes do. A sentence about
     "Filter #2" outliving Filter #2 is worse than no sentence. */
  hideConnNote();
  markStale();
  render();
}

/* Take sits anywhere a row stream does: it neither reads nor writes column
   structure, so anything that could feed a Filter can feed a Take and vice
   versa. Compare stays output-only. It is superseded, and widening its
   downstream reach now would be work thrown away when it retires. */
/* Every row-stream node accepts and produces a table, so they compose freely.
   The aggregation nodes are no exception: an Aggregate result is a one-row
   table like any other, and being able to feed it onward is the whole reason
   they exist as nodes rather than as Output settings.

   Compare stays output-only. It is superseded, and widening its reach now
   would be work thrown away when it retires. */
var TABLE_NODES = ['filter', 'sort', 'reverse', 'take', 'unique', 'select', 'project',
                   'aggregate', 'aggregateColumns', 'aggregateRows', 'combine',
                   /* A histogram takes a table and emits one, so it goes wherever
                      the other row nodes go. Downstream it IS a breakdown, in
                      SelectFor's shape, which is what lets a Sort or a Take
                      follow it without either of them knowing that. */
                   'histogram',
                   /* Both of its ports take an ordinary table, so anything that
                      produces one may feed it, including another SelectFor,
                      which is how a breakdown becomes the label set for the
                      next one. Which port a wire lands on is the port model's
                      business, not this list's: CONNECT_RULES answers "may
                      these two node types be joined at all". */
                   'selectFor'];
var CONNECT_RULES = {
  source:           TABLE_NODES.concat(['compare', 'output']),
  filter:           TABLE_NODES.concat(['compare', 'output']),
  sort:             TABLE_NODES.concat(['compare', 'output']),
  reverse:          TABLE_NODES.concat(['compare', 'output']),
  take:             TABLE_NODES.concat(['compare', 'output']),
  unique:           TABLE_NODES.concat(['compare', 'output']),
  select:           TABLE_NODES.concat(['compare', 'output']),
  project:          TABLE_NODES.concat(['compare', 'output']),
  aggregate:        TABLE_NODES.concat(['compare', 'output']),
  aggregateColumns: TABLE_NODES.concat(['compare', 'output']),
  aggregateRows:    TABLE_NODES.concat(['compare', 'output']),
  combine:          TABLE_NODES.concat(['compare', 'output']),
  histogram:        TABLE_NODES.concat(['compare', 'output']),
  /* Compare was output-only, on the grounds that it is superseded by SelectFor
     and widening its reach would be work thrown away. That reasoning held while
     the cost was hypothetical. It is not: a Compare's result is the only
     labelled multi-row answer the tool can currently produce ("how many in
     each year", "the average for each branch"), and refusing to let it be
     aggregated made "count per year, then average those counts" unbuildable
     through it. That is the exact example app.js:212 cites as the thing the
     table refactor existed to fix.

     Nothing downstream needed changing. Every row node already decides for
     itself whether a Compare's branch metadata still describes its rows, and
     says so where it does it. Sort and Take carry meta, Select and the
     one-column mode of Unique drop it. Those comments were written against this
     day arriving. */
  compare:          TABLE_NODES.concat(['compare', 'output']),
  selectFor:        TABLE_NODES.concat(['compare', 'output']),
  /* An Output takes wires out as well as in. It was the one node that could not
     be built on, and that exception was the single place where the canvas broke
     its own promise: every other node here composes with every other, and a
     user who reached an Output found the graph simply stopped.

     Wanting to narrow an answer you are looking at is an ordinary thing to want
     ("these 87 rows, but only the 2024 ones"), and the alternative was to go
     back and rebuild the chain in front of the Output, which is the same query
     written twice. An Output emits what it shows, so continuing from one reads
     as continuing from the table on screen. */
  output:           TABLE_NODES.concat(['compare', 'output'])
};
function canConnect(fromType, toType) {
  return (CONNECT_RULES[fromType] || []).indexOf(toType) !== -1;
}

