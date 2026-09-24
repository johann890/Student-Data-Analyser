/* ============================================================================
   UI: The canvas, the panels, persistence, and every event wired to them
   ============================================================================
   Graph state, the view transform, selection, ports and port geometry; the
   config panels and results panel; export, save/load, canvas gestures, and the
   listeners that connect them. Loads last: the event wiring and the first
   paint at the foot of this file need the other two files already parsed.
   ============================================================================
   Part of the query builder. LOAD ORDER MATTERS: data.js, engine.js, ui.js.
   See querybuilder_MMP.html. These are deliberately NOT ES modules; the tool is
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

var NODE_W = 220;
var SHAPE = {
  source:  { w:100, h:100 },
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
  } else {
    bar.classList.remove('show');
  }
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

/* ============================================================================
   INPUT PORTS
   ============================================================================
   A connection now names the input it lands on, not just the node. Previously
   two wires into one node were silently unioned: the merge happened in
   evaluateGraph, was invisible on the canvas, and (as the histogram case
   showed) could discard rows without saying so. A node now declares its
   inputs, and each wire occupies one.

   Two arities:
     single:  Exactly one wire. A second is refused at the point of wiring.
     multi:   Many wires, because taking several tables IS the node's job.
              Combine and Compare, and nothing else.

   The implicit union is gone with it: a node with one input has one table, so
   there is nothing to reconcile. Where several tables must become one, the user
   says so by wiring a Combine, which is the node whose settings decide how.

   Declaring ports as data rather than as branches is what lets the geometry,
   the wiring rules, the evaluator and the schema pass all agree about a node
   they have never heard of. SelectFor (data + labels) and any future two-input
   node are an entry in this table plus their implementation: Nothing here
   changes.                                                                   */

var SINGLE_IN = [{ key:'in', label:'In' }];

var NODE_PORTS = {
  source:           [],
  filter:           SINGLE_IN,
  sort:             SINGLE_IN,
  reverse:          SINGLE_IN,
  take:             SINGLE_IN,
  unique:           SINGLE_IN,
  select:           SINGLE_IN,
  project:          SINGLE_IN,
  aggregate:        SINGLE_IN,
  aggregateColumns: SINGLE_IN,
  aggregateRows:    SINGLE_IN,
  combine:          [{ key:'in', label:'Tables',   multi:true }],
  compare:          [{ key:'in', label:'Branches', multi:true }],
  /* The two-input node the port model was generalised for, and the entry is
     the whole of its declaration. Geometry, stub rendering, snap-to-connect,
     the arity refusal and the save-file port resolution all read this table
     and needed no case added for it.

     `data` is first, so it is the primary port. That is load-bearing three
     times over: a version 1 file and any wire that does not name a port land
     on the rows rather than on the labels, inputSchema() describes the data in
     the config panel without being told which port to look at, and the schema
     walk is handed the data header as its inSchema for free. */
  selectFor:        [{ key:'data', label:'Data' }, { key:'labels', label:'Labels' }],
  output:           SINGLE_IN
};

function portsOf(type) { return NODE_PORTS[type] || SINGLE_IN; }

// The port a wire lands on when the file or the caller does not say. Every
// node's first port is its data input, which keeps legacy graphs meaningful.
function primaryPort(type) {
  var p = portsOf(type);
  return p.length ? p[0].key : 'in';
}

function portDef(type, key) {
  var p = portsOf(type);
  for (var i = 0; i < p.length; i++) if (p[i].key === key) return p[i];
  return null;
}

// Unknown ports resolve to the primary one rather than vanishing: a hand-edited
// file naming a port that no longer exists still loads as a data connection.
function normalisePort(type, key) {
  return portDef(type, key) ? key : primaryPort(type);
}

function wiresInto(nodeId, portKey) {
  return connections.filter(function(c) {
    return c.to === nodeId && (portKey === undefined || c.port === portKey);
  });
}

/* A port accepts a wire when it is multi, or when it is single and empty.
   `ignore` skips one existing connection, so a check can ask "would this be
   free if that wire were not there", which is what a re-wire needs. */
function portAccepts(node, portKey, ignore) {
  var def = portDef(node.type, portKey);
  if (!def) return false;
  if (def.multi) return true;
  return wiresInto(node.id, portKey).filter(function(c) {
    return c !== ignore;
  }).length === 0;
}

function freePortsOn(node) {
  return portsOf(node.type).filter(function(p) {
    return portAccepts(node, p.key);
  });
}

/* ============================================================================
   PORT GEOMETRY
   ============================================================================
   Ports are spaced down the left edge of the shape. One port sits at mid-height,
   which is exactly where the single entry point used to be, so a one-input node
   is pixel-identical to what it was before this change, and every existing
   arrow lands where it always did.

   n ports divide the edge into n+1 intervals and sit on the interior boundaries,
   so they are evenly spaced and symmetric about the centre whatever n is.     */
function shapeExit(node) {
  var s = SHAPE[node.type];
  return { x: node.x + (NODE_W - s.w) / 2 + s.w, y: node.y + s.h / 2 };
}

function portOffsetY(type, portKey) {
  var ps = portsOf(type);
  if (ps.length < 2) return SHAPE[type].h / 2;
  var i = 0;
  for (var k = 0; k < ps.length; k++) if (ps[k].key === portKey) { i = k; break; }
  return SHAPE[type].h * (i + 1) / (ps.length + 1);
}

function shapeEntry(node, portKey) {
  var s = SHAPE[node.type];
  return {
    x: node.x + (NODE_W - s.w) / 2,
    y: node.y + portOffsetY(node.type, portKey === undefined ? primaryPort(node.type) : portKey)
  };
}

/* Direction resolution was duplicated verbatim between the drop handler and the
   ghost-arrow preview; they had to agree or the preview would lie about what
   dropping would do. One function now serves both.

   It also chooses the port. A node dragged towards a two-input node aims at
   whichever free port is nearest, so the gesture that used to mean "connect"
   now means "connect to this input" without a second interaction. A node whose
   every port is taken offers no target at all: the ghost arrow does not appear,
   which is the refusal made visible before the drop rather than after it. */
function nearestFreePort(from, to) {
  var ex = shapeExit(from);
  var best = null, bestD = Infinity;
  freePortsOn(to).forEach(function(p) {
    var en = shapeEntry(to, p.key);
    var d = Math.pow(en.x - ex.x, 2) + Math.pow(en.y - ex.y, 2);
    if (d < bestD) { bestD = d; best = { port:p.key, p0:ex, tip:en, d:d }; }
  });
  return best;
}

function resolveDirection(a, b) {
  var fwd = canConnect(a.type, b.type) ? nearestFreePort(a, b) : null;
  var rev = canConnect(b.type, a.type) ? nearestFreePort(b, a) : null;
  if (!fwd && !rev) return null;
  if (fwd && (!rev || fwd.d <= rev.d)) {
    return { from:a, to:b, port:fwd.port, p0:fwd.p0, tip:fwd.tip };
  }
  return { from:b, to:a, port:rev.port, p0:rev.p0, tip:rev.tip };
}

/* DEFAULT CONFIG PER NODE TYPE
   Written out in full rather than filled in lazily, so a saved file always
   contains every key a node uses and loading never depends on defaults that
   may have changed since the file was written. */
function defaultCfg(type) {
  /* `dataset` records the NAMES of the files this Source was given, and never
     their contents. See the loader section. It is the one cfg key whose value
     is a description of state held outside the model, which is exactly what
     makes a saved query re-openable without carrying student records in it. */
  if (type === 'source')  return { pop:'all', dataset:{ headers:'', years:[] } };
  if (type === 'filter')  return { criteria:[newCriterion()] };
  if (type === 'compare') return { measures:DEFAULT_MEASURES.slice(), sort:'wired', labels:{} };
  if (type === 'sort')    return { keys: [newSortKey()] };
  if (type === 'take')    return { n: String(TAKE_DEFAULT) };
  // Reverse has nothing to configure: it takes no column, no direction and no
  // count. An empty cfg is the honest answer, not a placeholder key.
  if (type === 'reverse') return {};
  // col:'' means all columns: Whole-row deduplication. Naming a column
  // switches to the label-producing mode and rewrites the header.
  if (type === 'unique')  return { col: '' };
  // Both aggregation nodes share one config shape: which measure, and (for the
  // measures that need one) which column. col:'' means "resolve against
  // whatever arrives", which is what keeps a saved query working after the
  // Source granularity is changed underneath it.
  if (type === 'aggregate')        return { op: AGG_DEFAULT_OP, col: '' };
  if (type === 'aggregateColumns') return { op: 'sum' };
  // Same shape, and sum for the same reason: totalling is the measure a row of
  // measures is usually wanted for, and it is the one that is obviously wrong
  // if the input is not a row of measures.
  if (type === 'aggregateRows')    return { op: 'sum' };
  // dedupe defaults off: merge stacks rows, and discarding identical rows is a
  // decision the user makes rather than one the node makes quietly.
  if (type === 'combine') return { mode: 'merge', dedupe: false, base: '', key: '' };
  // cols:null means "every column", so a fresh Select is a pass-through and
  // only becomes a narrowing once the user unticks something. An explicit list
  // of every key would go stale the moment the node was rewired.
  if (type === 'select')  return { cols: null };
  // Nothing to configure: what it unfolds is decided by the data, not by a
  // setting. A node with no options is the honest shape for an operation with
  // no choices in it.
  if (type === 'project') return {};
  /* `by` empty means "the first field this table can be grouped by", resolved
     against whatever arrives. The same convention Aggregate's col:'' uses,
     and for the same reason: an explicit key written at creation time goes
     stale the moment the node is rewired.

     `stats` is named that rather than `measures` deliberately. Compare owns
     `measures` and its elements are strings; these are {op, col} objects, and
     mergeCfg validates that key by resetting anything that is not an array to
     Compare's string defaults. One key, two element types, one validator is a
     collision waiting for the first hand-edited file, so they get separate
     keys and separate guards.

     `labelCol` is which column of the labels branch supplies the values, and
     is ignored entirely while nothing is wired there. */
  if (type === 'selectFor') return { by:'', stats:[newStat()], labelCol:'' };
  /* `by` empty means "the first column that can be binned", resolved against
     the arriving table the way SelectFor resolves its own. `width` is stored as
     typed and coerced on read, exactly as Take stores N. `stats` is the same
     key and the same shape SelectFor uses, because it is the same machinery. */
  if (type === 'histogram') return { by:'', width:'', stats:[newStat()] };
  // cols:null means "every column", the same convention Select uses, so the
  // validator mergeCfg already applies to that key covers this one too.
  /* `panel` is whether this Output draws a block in the results panel. It is
     true by default because an Output that showed nothing anywhere would be a
     puzzle, and it is a view setting rather than a computed one: turning it off
     hides the block and changes no answer, which is why nothing marks the run
     stale when it changes. An Output used purely as a step in a chain is what
     it is for. */
  if (type === 'output')  return { show:'rows', filename:'', cols:null, panel:true };
  return {};
}

/* A criterion keeps a value and an operator per field, not one of each. Switching
   the field selector from Avg to Gender and back therefore restores the original
   threshold instead of a default, and the same criterion object works against
   any table schema, including ones with columns that did not exist when it was
   created. */
function newCriterion() {
  return { field:'gpa', values:{}, ops:{}, course:defaultCourse() };
}

function critValue(c, field, col) {
  if (c.values && c.values[field] !== undefined) return c.values[field];
  if (col && col.def !== undefined) return col.def;
  if (col && col.values && col.values.length) return String(col.values[0]);
  /* A column can declare an order without declaring a value set (letterGrade
     carries GRADE_ORDER and nothing else), and that order is just as good a
     source of a default. Without this the control renders with nothing
     selected, the browser shows option one, and the model still says "", which
     is precisely the disagreement between panel and model that the sort keys
     go out of their way to avoid. */
  if (col && col.order && col.order.length) return String(col.order[0]);
  return '';
}
function critOp(c, field, fallback) {
  if (c.ops && c.ops[field] !== undefined) return c.ops[field];
  return fallback;
}

/* THE SECOND BOUND
   A range needs two values where every other comparison needs one. It is stored
   under a derived key in the same per-field map ("gpa" holds the low bound
   and "gpa:max" the high one), which means no change to the criterion
   shape, no change to the save format, and no change to setCfg: a control named
   `crit.0.value:gpa:max` already routes to values['gpa:max'] through
   the parser that was there.

   Keeping the low bound under the plain key is what makes switching operators
   feel continuous. "At least 70" then "between" carries the 70 in as the floor,
   rather than resetting to a default the user has to retype. */
function rangeKey(field) { return field + ':max'; }

/* THE CHOSEN LIST
   Stored under a derived key in the same per-field map the second bound uses
   ("courses.code" holds the single value and "courses.code:list" the chosen
   set), for the same three reasons: no change to the criterion shape, none to
   the save format, and none to the guard in mergeCfg, which only requires that
   `values` be an object and passes whatever is under it through untouched.

   Keeping the single value under the plain key is what makes switching
   operators continuous, exactly as it is for a range. Picking three courses,
   going back to "is", then returning to "is one of" finds the three still
   ticked rather than a cleared band.

   Two shapes are accepted on the way in. An ARRAY is what the tick boxes write.
   A STRING is what the free-text control writes, stored as typed and split on
   read, the same arrangement Histogram uses for its bin width and Take for its
   N: a half-typed "COMP103, SW" has to survive in the model or the field
   re-renders under the user mid-word. It also makes a hand-edited query file
   forgiving, which matters because this is the one setting somebody might
   plausibly want to paste a list into. */
function listKey(field) { return field + ':list'; }

function critList(c, field, col) {
  var raw = c && c.values ? c.values[listKey(field)] : undefined;
  var parts = Array.isArray(raw) ? raw
            : (typeof raw === 'string' ? raw.split(',') : []);
  var out = [], seen = {};
  parts.forEach(function(v) {
    var s = String(v == null ? '' : v).trim();
    // Blanks come from a trailing comma mid-typing, and a repeat changes no
    // answer (a set contains a value once), so both go quietly.
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
  });
  return orderList(out, col);
}

/* Put a picked list into the column's own declared order, where it has one.
   The same reasoning cfg.cols follows when it stores kept columns in header
   order rather than tick order: unticking a box and ticking it again should put
   the value back where it was, not on the end. A free-typed list has no
   declared order to sort into, so it keeps the order it was written in. */
function orderList(values, col) {
  var declared = (col && (col.values || col.order)) || null;
  if (!declared || !declared.length) return values;
  var rank = {};
  declared.forEach(function(v, i){ rank[String(v)] = i; });
  var known = values.filter(function(v){ return rank[v] !== undefined; });
  var rest  = values.filter(function(v){ return rank[v] === undefined; });
  known.sort(function(a, b){ return rank[a] - rank[b]; });
  return known.concat(rest);
}

/* Whether this field's list is picked from a set or typed. The two course
   fields reach inside the nested column, so their value sets are the
   catalogue's rather than any column's, and `col` is null for them. */
function listChoices(kind, col) {
  if (kind === 'courseSubject') return SUBJECTS.slice();
  if (kind === 'courseCode')    return COURSES.map(function(c){ return c.code; });
  if (kind === 'courseLevel')   return (LEVELS.length ? LEVELS : [1, 2, 3, 4]).map(String);
  var vals = (col && (col.values || col.order)) || [];
  return vals.map(String);
}

/* What orderList should sort a freshly ticked value into, resolved against the
   header actually arriving at this node. The two course fields have no column
   of their own, so they are handed a stand-in carrying the catalogue's order:
   without it a ticked course would land on the end of the list rather than back
   where it was, which is the one thing orderList exists to prevent. */
function fieldColumnFor(node, fieldKey) {
  var f = fieldByKey(inputSchema(node, computeSchemas()), fieldKey);
  if (!f) return null;
  if (f.column) return f.column;
  var choices = listChoices(f.kind, null);
  return choices.length ? { values: choices } : null;
}

/* The high bound defaults to the top of a declared order, and to the low bound
   where there is no top to reach for. Both are shown in the panel and stated in
   the hint, so neither default is a surprise the user discovers from an empty
   result. */
function critHigh(c, field, col) {
  if (c.values && c.values[rangeKey(field)] !== undefined) return c.values[rangeKey(field)];
  if (col && col.order && col.order.length) return String(col.order[col.order.length - 1]);
  if (col && col.values && col.values.length) return String(col.values[col.values.length - 1]);
  return critValue(c, field, col);
}

/* The pair, ranked and put the right way round. A user who types the bounds in
   the other order means the band between them: refusing, or returning nothing,
   would be a technicality rather than an answer. The log prints what was
   actually applied, so the swap is visible rather than silent. */
function critRange(c, field, col) {
  var rankOf = rankerFor(col);
  var loRaw = critValue(c, field, col);
  var hiRaw = critHigh(c, field, col);
  var lo = rankOf(loRaw), hi = rankOf(hiRaw);
  var swapped = lo !== null && hi !== null && lo > hi;
  return swapped
    ? { lo: hi, hi: lo, loRaw: hiRaw, hiRaw: loRaw, swapped: true }
    : { lo: lo, hi: hi, loRaw: loRaw, hiRaw: hiRaw, swapped: false };
}

/* CONFIG WRITES
   One entry point. Every control carries data-node / data-key attributes and a
   single delegated listener routes through here, so there is exactly one place
   where user input becomes model state. */
function setCfg(nodeId, key, value) {
  var n = findNode(nodeId);
  if (!n) return;
  n.cfg = n.cfg || defaultCfg(n.type);

  var m = key.match(/^crit\.(\d+)\.(.+)$/);
  if (m) {
    var c = n.cfg.criteria && n.cfg.criteria[parseInt(m[1], 10)];
    if (!c) return;
    var sub = m[2];
    if (sub === 'field')       c.field = value;
    else if (sub === 'course') c.course = value;
    /* One tick box in a chosen list. It carries the field and the value it
       stands for ("pick:courses.code:COMP103") because a checkbox reports only
       whether it is on, not what it is about. The field key is split off at the
       FIRST colon: no field key contains one (`value:gpa:max` relies on the
       same fact from the other side), while a value might. */
    else if (sub.indexOf('pick:') === 0) {
      var rest = sub.slice(5);
      var at = rest.indexOf(':');
      if (at === -1) return;
      var fk = rest.slice(0, at), pv = rest.slice(at + 1);
      var fcol = fieldColumnFor(n, fk);
      var cur = critList(c, fk, fcol);
      var was = cur.indexOf(pv);
      if (value && was === -1) cur.push(pv);
      if (!value && was !== -1) cur.splice(was, 1);
      c.values = c.values || {};
      c.values[listKey(fk)] = orderList(cur, fcol);
    }
    else if (sub.indexOf('value:') === 0) { c.values = c.values || {}; c.values[sub.slice(6)] = value; }
    else if (sub.indexOf('op:') === 0)    { c.ops = c.ops || {};       c.ops[sub.slice(3)] = value; }
    return;
  }
  var sk = key.match(/^sort\.(\d+)\.(col|dir)$/);
  if (sk) {
    var list = n.cfg.keys || (n.cfg.keys = []);
    var k = list[parseInt(sk[1], 10)];
    if (!k) return;
    k[sk[2]] = value;
    return;
  }
  /* Same shape as the sort-key parser above, because it is the same control:
     an ordered list of rows, each with its own selects. Sharing the shape is
     what keeps the two panels behaving identically for the user. */
  var st = key.match(/^stat\.(\d+)\.(op|col)$/);
  if (st) {
    var stats = n.cfg.stats || (n.cfg.stats = []);
    var stat = stats[parseInt(st[1], 10)];
    if (!stat) return;
    stat[st[2]] = value;
    return;
  }
  if (key.indexOf('label:') === 0) {
    n.cfg.labels = n.cfg.labels || {};
    n.cfg.labels[key.slice(6)] = value;
    return;
  }
  if (key.indexOf('column:') === 0) {
    /* Stored as the list of keys to KEEP, resolved against the header that is
       actually arriving. That is why the schema is recomputed here rather than
       read from a cached list: the first untick has to turn "everything" into
       an explicit set, and only the live header knows what everything is. */
    var ck = key.slice(7);
    var head = inputSchema(n, computeSchemas());
    var all = head.columns.map(function(c){ return c.key; });
    var cur = Array.isArray(n.cfg.cols)
      ? all.filter(function(k){ return n.cfg.cols.indexOf(k) !== -1; })
      : all.slice();
    var cAt = cur.indexOf(ck);
    if (value && cAt === -1) cur.push(ck);
    if (!value && cAt !== -1) cur.splice(cAt, 1);
    if (!cur.length) return;   // the panel disables the last box; this is the backstop
    // Stored in header order, not tick order, so unticking and re-ticking a box
    // puts the column back where it was rather than at the end.
    n.cfg.cols = all.filter(function(k){ return cur.indexOf(k) !== -1; });
    return;
  }
  if (key.indexOf('measure:') === 0) {
    var mk = key.slice(8);
    var list = (n.cfg.measures || []).slice();
    var at = list.indexOf(mk);
    if (value && at === -1) list.push(mk);
    if (!value && at !== -1) list.splice(at, 1);
    // Preserve the declared order so ticking boxes out of order still yields a
    // stable column order. Sorting uses the first ticked column.
    n.cfg.measures = MEASURES.filter(function(x){ return list.indexOf(x.key) !== -1; })
                             .map(function(x){ return x.key; });
    return;
  }
  n.cfg[key] = value;
}

function findNode(id) {
  for (var i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i];
  return null;
}
/* Ids wired into a node, optionally restricted to one port. Called without a
   port it answers "everything upstream of this node", which is what the config
   panels and the colour picker want; called with one it answers "what is on
   this input", which is what the evaluator and the schema pass want. */
function inputsOf(nodeId, portKey) {
  return wiresInto(nodeId, portKey).map(function(c){ return c.from; });
}

/* ADD / REMOVE */
/* Placement is relative to what the user is looking at, not to the world. Random
   scatter across a 5000px world would drop most new nodes off screen; scatter
   across the viewport would put them wherever the window edge happens to be.
   The middle of the current view is the only spot that is always visible and
   always means the same thing.

   The step-out loop keeps a run of clicks from stacking nodes on one pixel: each
   new node takes the first free slot on a widening diagonal. Cheap because it
   only ever inspects nodes already placed, and n is small by construction. */
var PLACE_STEP = 46;
var PLACE_CLEAR = 34;

function freeSpotNear(cx, cy) {
  for (var ring = 0; ring < 40; ring++) {
    var x = cx + ring * PLACE_STEP, y = cy + ring * PLACE_STEP;
    x = Math.max(10, Math.min(WORLD_W - NODE_W - 10, x));
    y = Math.max(10, Math.min(WORLD_H - 160, y));
    var clash = nodes.some(function(n) {
      return Math.abs(n.x - x) < PLACE_CLEAR && Math.abs(n.y - y) < PLACE_CLEAR;
    });
    if (!clash) return { x: Math.round(x), y: Math.round(y) };
  }
  return { x: Math.round(cx), y: Math.round(cy) };
}

function addNode(type) {
  var c = viewCentreWorld();
  var spot = freeSpotNear(c.x - NODE_W / 2, c.y - SHAPE[type].h / 2);
  var color = EDGE_PALETTE[edgeColorIndex++ % EDGE_PALETTE.length];
  var id = uid();
  nodes.push({
    id: id, type: type,
    x: spot.x, y: spot.y,
    color: color,
    cfg: defaultCfg(type)
  });
  /* The new node is deliberately NOT selected. Selection means "the thing I am
     about to act on", and arriving from the toolbar is not that. The user
     picked a node type, not a target. Selecting happens by clicking or dragging
     a node, which is the point at which they have actually pointed at one.

     The existing selection is cleared, though. Leaving it would mean that after
     selecting a few nodes and then adding one, Backspace deletes the old
     selection rather than the node just added: The opposite of what the last
     action suggests, and unrecoverable without undo. */
  selection = [];
  markStale();
  render();
}

/* Deleting a Source deletes what it was holding. Node ids are handed out by a
   counter that resets on load, so leaving the data behind would let a later
   node inherit a cohort it was never given, and in the meantime its rows would
   still be feeding the registries from nowhere. */
function forgetSourceData(id) {
  delete SOURCE_DATA[id];
  delete PENDING_HEADERS[id];
  delete SOURCE_NOTICE[id];
}

function removeNode(id) {
  nodes = nodes.filter(function(n){ return n.id !== id; });
  connections = connections.filter(function(c){ return c.from !== id && c.to !== id; });
  selection = selection.filter(function(x){ return x !== id; });
  forgetSourceData(id);
  rebuildRegistries();
  markStale();
  render();
}

function clearAll() {
  // Clearing the canvas clears the data with it: the Sources that held it are
  // about to stop existing, and leaving it behind would leak a cohort into the
  // registries with no node on screen accounting for it.
  clearAllSourceData();
  nodes = []; connections = []; edgeColorIndex = 0;
  exportData = {}; resultsFresh = false;
  // Clear starts a new query, so the name of the old one should not follow it
  // into the next Save dialog.
  lastQueryName = '';
  selection = [];
  cancelPreviewTimer(); hidePreview();
  view.z = 1; centreView();
  render();
  setOutput('<div class="placeholder">Run a query to see results</div>');
}
/* CLEAR CONFIRMATION
   ---------------------------------------------------------------------------
   Clear is the only control in the bar that destroys work with no way back:
   the graph goes, and the loaded data goes with it, because the Sources
   holding it stop existing. It also sits in the same run of buttons as Help
   and a short distance from Run Query, which is pressed constantly, so the
   accidental press is a real one rather than a hypothetical.

   clearAll() stays the unconditional act. The guard is a separate entry point,
   so anything that clears the canvas as a step in some larger operation keeps
   doing so without a dialog appearing in the middle of it. */

/* Held for the session and nowhere else. Persisting the answer would let one
   impatient afternoon switch the guard off for every future one, and a user
   who does not remember dismissing it has no way back except reloading the
   page. A reload is a low enough price for the reverse mistake. */
var skipClearConfirm = false;

function clearDialogEl() { return document.getElementById('clearDialog'); }
function clearDialogOpen() {
  var d = clearDialogEl();
  return !!(d && d.classList.contains('open'));
}

// The control that opened it, so focus goes back to the press it came from
// rather than to <body> when the card disappears.
var clearDialogBtn = null;

function requestClearAll(btn) {
  // An empty canvas is nothing to lose, so there is nothing to confirm. Asking
  // anyway would teach the user to dismiss the prompt unread, which is exactly
  // the habit that makes it useless on the press that matters.
  if (skipClearConfirm || nodes.length === 0) { clearAll(); return; }

  var d = clearDialogEl();
  // No markup, no guard: an older page, or a headless harness that loaded the
  // script alone. A missing dialog should leave Clear working, not silent.
  if (!d) { clearAll(); return; }

  clearDialogBtn = btn || null;
  var box = document.getElementById('clearDontAsk');
  // Unticked on every open. It is a choice about this press, made now, not a
  // box left however it was last seen.
  if (box) box.checked = false;
  d.classList.add('open');
  // Focus lands on Cancel, not on the destructive button. The dialog exists
  // because the last press may have been a mistake, and a stray Enter into a
  // freshly opened card should not finish the job the guard just interrupted.
  var cancel = document.getElementById('clearCancel');
  if (cancel && cancel.focus) cancel.focus();
}

function closeClearDialog() {
  var d = clearDialogEl();
  if (d) d.classList.remove('open');
  var btn = clearDialogBtn;
  clearDialogBtn = null;
  if (btn && btn.focus) btn.focus();
}

function confirmClearAll() {
  var box = document.getElementById('clearDontAsk');
  /* Read only on the way through a confirm. Ticking the box and then
     cancelling is not an answer to "clear this?", so it cannot stand in for
     one next time; the checkbox suppresses a question the user has answered,
     not one they backed out of. */
  if (box && box.checked) skipClearConfirm = true;
  closeClearDialog();
  clearAll();
}

/* Every one of these buttons calls render(), which destroys the button that was
   just clicked along with the rest of the panel. Focus then falls to <body>,
   leaving the user looking at a panel the keyboard no longer considers active.
   The state that made a stray Backspace destructive. Putting focus back on the
   rebuilt panel keeps the two in agreement, and gives keyboard users somewhere
   sensible to tab on from rather than the top of the document. */
function focusCfg(nodeId, keyPrefix) {
  var el = nodeEls[nodeId];
  if (!el) return;
  var ctl = keyPrefix ? el.querySelector('[data-key^="' + keyPrefix + '"]') : null;
  if (!ctl) ctl = el.querySelector('[data-node]');
  if (ctl && ctl.focus) ctl.focus();
}

function addCriterion(nodeId) {
  var n = findNode(nodeId);
  if (!n || n.type !== 'filter') return;
  n.cfg.criteria.push(newCriterion());
  markStale();
  render();
  focusCfg(nodeId, 'crit.' + (n.cfg.criteria.length - 1) + '.');
}
function removeCriterion(nodeId, idx) {
  var n = findNode(nodeId);
  if (!n || n.type !== 'filter') return;
  n.cfg.criteria.splice(idx, 1);
  markStale();
  render();
  focusCfg(nodeId);
}

/* Sort keys use the same add/remove shape as filter criteria (one list, the
   first row not removable), so the two panels behave identically. Priority is
   list position: the first key decides, later ones break ties. */
function addSortKey(nodeId) {
  var n = findNode(nodeId);
  if (!n || n.type !== 'sort') return;
  n.cfg.keys = n.cfg.keys || [];
  n.cfg.keys.push(newSortKey());
  markStale();
  render();
  focusCfg(nodeId, 'sort.' + (n.cfg.keys.length - 1) + '.');
}
function removeSortKey(nodeId, idx) {
  var n = findNode(nodeId);
  if (!n || n.type !== 'sort') return;
  n.cfg.keys.splice(idx, 1);
  if (!n.cfg.keys.length) n.cfg.keys.push(newSortKey());
  markStale();
  render();
  focusCfg(nodeId);
}

/* SelectFor's measures use the same list shape again (add at the end, first
   row not removable), so a third panel does not introduce a third set of
   manners.

   Guarded on holding a measure list rather than on being one named type. A
   second node arrived with the same list a fortnight later and the buttons
   under it did nothing: the panel rendered them, the handler checked the type
   and returned. Asking what the node HAS rather than what it IS is what makes
   the next such node work without an edit here. */
function hasStats(n) { return !!n && (n.type === 'selectFor' || n.type === 'histogram'); }

function addStat(nodeId) {
  var n = findNode(nodeId);
  if (!hasStats(n)) return;
  n.cfg.stats = n.cfg.stats || [];
  n.cfg.stats.push(newStat());
  markStale();
  render();
  focusCfg(nodeId, 'stat.' + (n.cfg.stats.length - 1) + '.');
}
function removeStat(nodeId, idx) {
  var n = findNode(nodeId);
  if (!hasStats(n)) return;
  n.cfg.stats.splice(idx, 1);
  // A breakdown with no measures is a list of labels, which Unique already
  // does better. The first row is not removable and this is its backstop.
  if (!n.cfg.stats.length) n.cfg.stats.push(newStat());
  markStale();
  render();
  focusCfg(nodeId);
}

/* ---------------------------------------------------- THE PICKERS THEMSELVES

   Two inputs, not one, because the two steps are genuinely ordered: a year file
   cannot be parsed without the column list. `accept` is set on the header input
   as a courtesy to the dialog and trusted by neither check above, and on the
   year picker it is absent, since the archive's year files carry no extension
   for a filter to match on.                                                  */

function pickHeadersFile(nodeId) {
  var input = document.getElementById('headersFile');
  if (!input) return;
  input.value = '';          // or choosing the same file twice fires no change
  input._node = nodeId;
  input.click();
}

function pickYearFiles(nodeId) {
  var input = document.getElementById('yearFiles');
  if (!input) return;
  input.value = '';
  input._node = nodeId;
  input.click();
}

function onHeadersChosen(e) {
  var input = e.target;
  var nodeId = input._node;
  var file = input.files && input.files[0];
  if (!file || nodeId == null) return;
  loadHeadersFor(nodeId, file);
}

function onYearFilesChosen(e) {
  var input = e.target;
  var nodeId = input._node;
  if (nodeId == null || !input.files || !input.files.length) return;
  loadYearFilesFor(nodeId, input.files);
}
/* ============================================================================
   RENDER: CONFIG PANELS
   ============================================================================
   Controls carry data-node / data-key and are read by one delegated listener.
   Nothing here reads the DOM back: render() is a pure function of the model,
   which is what makes the drag fast path and save/load safe.                  */

function ctl(nodeId, key, extra) {
  return ' data-node="' + nodeId + '" data-key="' + esc(key) + '"' + (extra || '');
}
function opt(val, cur, label) {
  return '<option value="' + esc(val) + '"' + (String(cur) === String(val) ? ' selected' : '') + '>' +
    esc(label === undefined ? val : label) + '</option>';
}
/* The archive names a course by code and never by title, so a loaded catalogue
   has name === code and there is nothing to append. Saying "AIML427" beats
   saying "AIML427: AIML427", and the synthetic catalogue, which does carry
   titles, still gets both. One function, because the course dropdown and its
   tooltip must not disagree about how a course is written. */
function courseLabel(c) {
  if (!c) return '';
  return (c.name && c.name !== c.code) ? c.code + ': ' + c.name : c.code;
}
function courseTitle(code) {
  var c = COURSE_BY_CODE[code];
  return c ? courseLabel(c) : String(code);
}

// Grouped by subject so a 31-course catalogue stays navigable and a longer real
// one degrades gracefully instead of becoming a single flat list.
function courseSelect(nodeId, key, cur) {
  var sel = cur || defaultCourse();
  var html = '<select class="course-sel" title="' + esc(courseTitle(sel)) + '"' + ctl(nodeId, key) + '>';
  SUBJECTS.forEach(function(subj) {
    var inSubj = COURSES.filter(function(c){ return c.subject === subj; });
    if (!inSubj.length) return;
    html += '<optgroup label="' + esc(subj) + '">';
    inSubj.forEach(function(c) {
      html += '<option value="' + c.code + '"' + (sel === c.code ? ' selected' : '') + '>' +
        esc(courseLabel(c)) + '</option>';
    });
    html += '</optgroup>';
  });
  return html + '</select>';
}

function opSelect(nodeId, key, ops, cur) {
  var groups = opGroups(ops);
  /* Only worth grouping when there is something to separate. A field with no
     range on offer gets a plain list, as before, and so does one with only two
     operators: two headings over one option each is decoration, not structure,
     which is what the two-item "Took course" selector would otherwise get. */
  var body = (groups.length < 2 || ops.length < 3)
    ? ops.map(function(o){ return opt(o, cur, opLabel(o)); }).join('')
    : groups.map(function(g) {
        return '<optgroup label="' + esc(g.label) + '">' +
          g.ops.map(function(o){ return opt(o, cur, opLabel(o)); }).join('') +
        '</optgroup>';
      }).join('');
  /* Marked when a band is open so the row can give the control room for its
     longer label. "in range" and "is one of" will not fit the 38px column the
     comparator symbols live in, and the value box either would have shared that
     row with has moved into the band below anyway. The two marks differ only in
     colour, each matching the band it opens, so the operator and its band read
     as one control rather than two. */
  var wide = cur === 'between' ? ' class="op-wide"'
           : cur === 'in'      ? ' class="op-list"'
           : '';
  return '<select' + wide + ctl(nodeId, key) + '>' + body + '</select>';
}

/* One criterion row. Its shape follows the field's type, and the field list
   follows the incoming table, so this function knows nothing about students. */
/* THE RANGE BAND
   A range is the one criterion that needs a second value, and squeezing it into
   the same row as the first would leave three controls and two numbers fighting
   over 220px. It gets its own strip below the row instead, banded down the left
   the way a criterion is banded, so it reads as part of that criterion rather
   than as a new one, and coloured, so a filter carrying a band is visibly
   doing something different from one that is not.

   It exists only while `between` is the operator. Choosing it adds the band and
   choosing anything else takes it away, which is the whole of the "add it or
   not": there is no separate switch to get out of step with the operator.

   The colour is the one this interface already uses for a state worth noticing
   (the amber of the stale-results notice), rather than a new hue invented for
   one control. */
function rangeBandHTML(nid, ci, cur, c, renderBound) {
  var rng = critRange(c, cur.key, cur.column);
  var hiKey = 'crit.' + ci + '.value:' + rangeKey(cur.key);
  return '<div class="crit-range">' +
    '<span class="crit-range-tag">range</span>' +
    '<div class="crit-range-pair">' +
      renderBound('crit.' + ci + '.value:' + cur.key, rng.loRaw) +
      '<span class="crit-range-to">to</span>' +
      renderBound(hiKey, rng.hiRaw) +
    '</div>' +
    '<div class="crit-range-note">' +
      (rng.lo === null || rng.hi === null
        ? (cur.column && cur.column.type === COLTYPE.NUMBER
            ? 'Both ends have to be numbers. The query will not run until they are.'
            : 'Both ends have to be values this column holds.')
        : rng.lo === rng.hi
        /* The two bounds start equal on a plain number column, which has no
           declared span to open the band across. Saying so, and saying what to
           do, beats leaving the user to work out why a range behaves like an
           equals. */
        ? 'Both ends are ' + esc(String(rng.loRaw)) + ', so this keeps only ' +
          'rows equal to it. Change one end to widen the band.'
        : 'Keeps rows from ' + esc(String(rng.loRaw)) + ' to ' + esc(String(rng.hiRaw)) +
          ', both included.' + (rng.swapped ? ' (Bounds read the other way round.)' : '')) +
    '</div>' +
  '</div>';
}

/* THE LIST BAND
   The range band's sibling, and deliberately built to the same pattern: it
   appears only while its operator is chosen, it is banded down the left so it
   reads as part of the criterion rather than as a criterion of its own, and it
   carries a one-line note saying what the current setting actually keeps.

   It is a different colour from the range band. Both are bands under a
   criterion and a reader glancing at a panel should be able to tell which one
   they are looking at without reading the tag, so the range keeps the amber it
   had and the list takes the violet this interface already uses for the
   measure tick boxes it borrows its controls from.

   TICK BOXES RATHER THAN A MULTI-SELECT.
   A native <select multiple> is the obvious control and the wrong one: it
   needs ctrl-click to choose a second value, which is undiscoverable, and it
   silently discards the whole selection when a plain click lands in it. Tick
   boxes cost more pixels and cannot be got wrong. They are also the control
   this panel already uses for "choose several of these" in the Select and
   Compare panels, so it is not a new idea, only a new place.

   A column with no declared values (a name, a free number) has nothing to tick,
   so it gets a text box and the list is split on commas. */
function listBandHTML(nid, ci, cur, c) {
  var choices = listChoices(cur.kind, cur.column);
  var chosen = critList(c, cur.key, cur.column);
  var n = chosen.length;
  var picked = {};
  chosen.forEach(function(v){ picked[v] = true; });

  var body;
  if (choices.length) {
    var box = function(v, label, title) {
      return '<label class="crit-pick' + (picked[v] ? ' on' : '') + '"' +
          (title ? ' title="' + esc(title) + '"' : '') + '>' +
        '<input type="checkbox"' + (picked[v] ? ' checked' : '') +
          ctl(nid, 'crit.' + ci + '.pick:' + cur.key + ':' + v) + '>' +
        '<span>' + esc(label) + '</span></label>';
    };
    /* The course catalogue is grouped by subject for the reason courseSelect
       groups its own options: eighty-odd codes in one flat run is a wall, and
       the same list under thirteen headings is a thing you can find COMP103 in.
       Every other field here has few enough values to stay flat. */
    if (cur.kind === 'courseCode') {
      body = SUBJECTS.map(function(subj) {
        var inSubj = COURSES.filter(function(x){ return x.subject === subj; });
        if (!inSubj.length) return '';
        return '<div class="crit-list-group">' + esc(subj) + '</div>' +
          '<div class="crit-list-picks">' +
            inSubj.map(function(x){ return box(x.code, x.code, courseLabel(x)); }).join('') +
          '</div>';
      }).join('');
    } else {
      body = '<div class="crit-list-picks">' +
        choices.map(function(v) {
          return box(v, cur.kind === 'courseLevel' ? v + '00-level' : v, '');
        }).join('') + '</div>';
    }
  } else {
    /* Stored as typed, split on read. The raw string is what goes back into the
       box so a half-written entry survives the re-render that every keystroke
       causes; critList does the tidying when the query runs. */
    var raw = c.values && c.values[listKey(cur.key)];
    var shown = Array.isArray(raw) ? raw.join(', ') : (raw === undefined ? '' : String(raw));
    body = '<input type="text" class="crit-list-text" placeholder="value, value, value" ' +
      'value="' + esc(shown) + '"' + ctl(nid, 'crit.' + ci + '.value:' + listKey(cur.key)) + '>';
  }

  /* WHY THERE MIGHT BE NOTHING TO TICK.
     Two different states produce an empty choice list and they want different
     sentences. A course field or a category has values, but they come from the
     loaded archive: SPECS, YEARS and the course catalogue are all filled by the
     loader and are empty on a Source nobody has given files to yet. A name or a
     free number never has a set to offer at all.

     The band falls back to a text box either way, which is the useful behaviour
     (a typed list still works, and it turns into ticked boxes the moment the
     files arrive). But telling somebody to type a course code when the reason
     they cannot pick one is that they have not loaded their data would be the
     panel answering a question they did not ask. */
  var awaitingData = !choices.length &&
    (cur.kind === 'courseCode' || cur.kind === 'courseSubject' ||
     (cur.column && cur.column.type === COLTYPE.ENUM));

  var note = !n
    ? 'Nothing chosen, so this query will not run. ' +
      (choices.length ? 'Tick at least one.'
        : awaitingData
        ? 'Load the data files on the Source and these become tick boxes; ' +
          'until then, type the values separated by commas.'
        : 'Type at least one value, separated by commas.')
    : n === 1
    /* Said for the same reason the range band says it when both ends match: a
       list of one behaves exactly like the operator the user just moved away
       from, and leaving them to work that out from an unchanged row count is
       the kind of silence this panel avoids. */
    ? 'One value chosen, so this keeps the same rows "is" would. Choose another to widen it.'
    : 'Keeps rows matching any of the ' + n + ' chosen' +
      (cur.kind === 'courseCode' || cur.kind === 'courseSubject'
        ? ', so a student counts once however many of them they took.' : '.');

  return '<div class="crit-list">' +
    '<span class="crit-list-tag">list' +
      (n ? '<b>' + n + '</b>' : '') + '</span>' +
    (n && choices.length
      ? '<button class="crit-list-clear" onclick="clearCritList(' + nid + ',' + ci + ')">clear</button>'
      : '') +
    body +
    '<div class="crit-list-note">' + note + '</div>' +
  '</div>';
}

/* What the two wildcards mean, beside the box they are typed into. A pattern
   language is not guessable from an empty field, and the alternative to saying
   it here is a user typing a course code and wondering what the operator was
   for. One line, no justification: the reasoning lives in Help. */
function patternNoteHTML(kind) {
  return '<div class="crit-pattern-note"><b>*</b> is any run of characters, ' +
    '<b>?</b> is one. ' +
    (kind === 'courseSubject'
      ? 'So <b>SW*</b> is every subject starting SW.'
      : 'So <b>SWEN*</b> is every SWEN course and <b>*4??</b> every 400 level.') +
    '</div>';
}

/* Untick everything in one click. Eighty-two courses is a plausible list to
   have opened by accident, and clearing it one box at a time is not a thing to
   ask of anybody. */
function clearCritList(nodeId, ci) {
  var n = findNode(nodeId);
  var c = n && n.cfg && n.cfg.criteria && n.cfg.criteria[ci];
  if (!c) return;
  var f = fieldByKey(inputSchema(n, computeSchemas()), c.field);
  if (!f) return;
  c.values = c.values || {};
  c.values[listKey(f.key)] = [];
  markStale();
  render();
}

function criterionHTML(node, ci, c, schema) {
  var fields = filterFields(schema);
  if (!fields.length) {
    return '<div class="criterion-row"><div class="cmp-hint">No columns upstream. Connect a Source.</div></div>';
  }
  var cur = fieldByKey(schema, c.field) || fields[0];
  var nid = node.id;
  var remove = ci > 0
    ? '<button class="remove-criterion-btn" onclick="removeCriterion(' + nid + ',' + ci + ')">x</button>'
    : '';

  var plain = fields.filter(function(f){ return f.key.indexOf('courses.') !== 0; });
  var crs   = fields.filter(function(f){ return f.key.indexOf('courses.') === 0; });
  var fieldSel = '<select class="ft-sel"' + ctl(nid, 'crit.' + ci + '.field') + '>' +
    (plain.length ? '<optgroup label="Row">' + plain.map(function(f){ return opt(f.key, cur.key, f.label); }).join('') + '</optgroup>' : '') +
    (crs.length   ? '<optgroup label="Courses">' + crs.map(function(f){ return opt(f.key, cur.key, f.label); }).join('') + '</optgroup>' : '') +
  '</select>';

  var vKey = 'crit.' + ci + '.value:' + cur.key;
  var oKey = 'crit.' + ci + '.op:' + cur.key;
  var body;

  /* The two nested-column fields gained an operator select when the list
     arrived. They had none before, because "took this" was the only thing
     either of them could say. */
  if (cur.kind === 'courseSubject') {
    var sOp = critOp(c, cur.key, 'eq');
    if (CODE_OPS.indexOf(sOp) === -1) sOp = CODE_OPS[0];
    body = (sOp === 'in'
      ? '<div class="criterion-controls two-col">' + fieldSel +
          opSelect(nid, oKey, CODE_OPS, sOp) + '</div>' +
        listBandHTML(nid, ci, cur, c)
      : sOp === 'matches'
      ? '<div class="criterion-controls">' + fieldSel +
          opSelect(nid, oKey, CODE_OPS, sOp) +
          '<input type="text" placeholder="SW*" spellcheck="false" ' +
            'value="' + esc(critValue(c, cur.key, null) || '') + '"' + ctl(nid, vKey) + '>' +
        '</div>' + patternNoteHTML(cur.kind)
      : '<div class="criterion-controls">' + fieldSel +
          opSelect(nid, oKey, CODE_OPS, sOp) +
          '<select' + ctl(nid, vKey) + '>' +
            SUBJECTS.map(function(s){ return opt(s, critValue(c, cur.key, null) || defaultSubject()); }).join('') +
          '</select></div>');

  } else if (cur.kind === 'courseCode') {
    var cOp = critOp(c, cur.key, 'eq');
    if (CODE_OPS.indexOf(cOp) === -1) cOp = CODE_OPS[0];
    body = (cOp === 'in'
      ? '<div class="criterion-controls two-col">' + fieldSel +
          opSelect(nid, oKey, CODE_OPS, cOp) + '</div>' +
        listBandHTML(nid, ci, cur, c)
      : cOp === 'matches'
      ? '<div class="criterion-controls stack">' + fieldSel +
          '<div class="cc-pair">' + opSelect(nid, oKey, CODE_OPS, cOp) +
            '<input type="text" placeholder="SWEN*" spellcheck="false" ' +
              'value="' + esc(critValue(c, cur.key, null) || '') + '"' + ctl(nid, vKey) + '>' +
          '</div></div>' + patternNoteHTML(cur.kind)
      : '<div class="criterion-controls stack">' + fieldSel +
          '<div class="cc-pair">' + opSelect(nid, oKey, CODE_OPS, cOp) +
            courseSelect(nid, vKey, critValue(c, cur.key, null) || defaultCourse()) +
          '</div></div>');

  } else if (cur.kind === 'courseLevel') {
    /* A select rather than a number box: the levels are the handful the loaded
       files actually contain, and offering a free number invites "level 7",
       which every file answers with nothing. */
    var lOp = critOp(c, cur.key, 'eq');
    var lvlDef = { def: String(defaultLevel() || 4) };
    var lvlBox = function(key, val) {
      return '<select' + ctl(nid, key) + '>' +
        (LEVELS.length ? LEVELS : [1, 2, 3, 4]).map(function(v) {
          return opt(String(v), String(val), v + '00-level');
        }).join('') + '</select>';
    };
    body = (lOp === 'between' || lOp === 'in'
      ? '<div class="criterion-controls two-col">' + fieldSel +
          opSelect(nid, oKey, NUM_OPS, lOp) + '</div>' +
        (lOp === 'in'
          ? listBandHTML(nid, ci, cur, c)
          : rangeBandHTML(nid, ci, { key: cur.key, column: lvlDef }, c, lvlBox))
      : '<div class="criterion-controls">' + fieldSel +
          opSelect(nid, oKey, NUM_OPS, lOp) +
          lvlBox(vKey, critValue(c, cur.key, lvlDef)) +
        '</div>');

  } else if (cur.kind === 'courseGrade') {
    // MARK_OPS rather than NUM_OPS: a mark in one named course is a threshold,
    // and the list operator has no meaning here. See the comment on MARK_OPS.
    var mOp = critOp(c, cur.key, 'gte');
    if (MARK_OPS.indexOf(mOp) === -1) mOp = 'gte';
    var markBox = function(key, val) {
      return '<input type="number" min="0" max="9" value="' + esc(val) + '"' + ctl(nid, key) + '>';
    };
    body = '<div class="criterion-controls stack">' + fieldSel +
      courseSelect(nid, 'crit.' + ci + '.course', c.course) +
      (mOp === 'between'
        ? opSelect(nid, oKey, MARK_OPS, mOp)
        : '<div class="cc-pair">' + opSelect(nid, oKey, MARK_OPS, mOp) +
            markBox(vKey, critValue(c, cur.key, { def:'5' })) + '</div>') +
      '</div>' +
      (mOp === 'between'
        ? rangeBandHTML(nid, ci, { key: cur.key, column: { def:'5' } }, c, markBox)
        : '');

  } else if (cur.kind === COLTYPE.NUMBER) {
    var nOp = critOp(c, cur.key, 'gt');
    var numBox = function(key, val) {
      return '<input type="number" value="' + esc(val) + '"' + ctl(nid, key) + '>';
    };
    // The single box gives way to the band rather than sitting beside it: Two
    // places to type a lower bound would be one too many, so with the range on
    // the row has only two cells and the operator can have the spare width.
    body = (nOp === 'between' || nOp === 'in'
      ? '<div class="criterion-controls two-col">' + fieldSel +
          opSelect(nid, oKey, NUM_OPS, nOp) + '</div>' +
        (nOp === 'in'
          ? listBandHTML(nid, ci, cur, c)
          : rangeBandHTML(nid, ci, cur, c, numBox))
      : '<div class="criterion-controls">' + fieldSel +
          opSelect(nid, oKey, NUM_OPS, nOp) +
          numBox(vKey, critValue(c, cur.key, cur.column)) +
        '</div>');

  } else if (cur.kind === COLTYPE.ENUM || isRangeable(cur.column)) {
    var vals = (cur.column && cur.column.values) || (cur.column && cur.column.order) || [];
    // Enum criteria carry an operator too. Without one, "specialisation is NOT
    // Data Science" is unaskable. The engine has always supported it, but
    // there was no control to reach it with.
    var eOps = opsFor(cur.kind, cur.column);
    var eOp = critOp(c, cur.key, 'eq');
    if (eOps.indexOf(eOp) === -1) eOp = eOps[0];
    var enumOp = opSelect(nid, oKey, eOps, eOp);
    var pick = function(key, val) {
      return '<select' + ctl(nid, key) + '>' +
        vals.map(function(v){ return opt(v, String(val)); }).join('') + '</select>';
    };
    var valSel = pick(vKey, critValue(c, cur.key, cur.column));
    // Long option text (specialisations, course names) will not survive the
    // 80px field column, so those wrap onto their own row.
    var wide = vals.some(function(v){ return String(v).length > 8; });
    body = (eOp === 'between' || eOp === 'in'
      // Both bounds, or the whole list, live in the band, so the row is field
      // and operator only, and the operator gets the width its label needs,
      // wide values or not.
      ? '<div class="criterion-controls two-col">' + fieldSel + enumOp + '</div>' +
        (eOp === 'in'
          ? listBandHTML(nid, ci, cur, c)
          : rangeBandHTML(nid, ci, cur, c, pick))
      : wide
      ? '<div class="criterion-controls stack">' + fieldSel +
          '<div class="cc-pair">' + enumOp + valSel + '</div></div>'
      : '<div class="criterion-controls">' + fieldSel + enumOp + valSel + '</div>');

  } else {
    /* A column with no declared values: a name, or a number the schema does not
       type as one. There is nothing to tick, so the list is typed, and the band
       renders a text box instead of a grid. */
    var tOp = critOp(c, cur.key, 'eq');
    if (ENUM_OPS.indexOf(tOp) === -1) tOp = 'eq';
    body = (tOp === 'in'
      ? '<div class="criterion-controls two-col">' + fieldSel +
          opSelect(nid, oKey, ENUM_OPS, tOp) + '</div>' +
        listBandHTML(nid, ci, cur, c)
      : '<div class="criterion-controls">' + fieldSel +
          opSelect(nid, oKey, ENUM_OPS, tOp) +
          '<input type="text" value="' + esc(critValue(c, cur.key, cur.column)) + '"' + ctl(nid, vKey) + '>' +
        '</div>');
  }

  return '<div class="criterion-row">' + body + remove + '</div>';
}

/* A short name for an upstream node, for panels that must let the user point at
   one input rather than another. Compare labels its branches from the query
   that produced them, which needs results; this is needed at render time,
   before anything has run, so it names the node instead. */
var NODE_LABELS = {
  source:'Source', filter:'Filter', sort:'Sort', reverse:'Reverse', take:'Take',
  unique:'Unique', select:'Select', project:'Project',
  aggregate:'Aggregate', aggregateColumns:'Agg. Columns', aggregateRows:'Agg. Rows',
  combine:'Combine', compare:'Compare', selectFor:'Select For',
  histogram:'Histogram', output:'Output'
};
function upstreamLabel(node) {
  return (NODE_LABELS[node.type] || node.type) + ' #' + node.id;
}

/* THE FILE SECTION ON A SOURCE PANEL
   ---------------------------------------------------------------------------
   Two rows, in the order the two steps have to happen in, each showing what is
   currently held rather than only offering a button. A Source that says
   "headers.txt, 27 columns" and "mcs-students-2022, 2170 rows" is a Source
   whose answer can be checked against the files on disk, which is the whole
   reason the names are shown at all.

   The year button is disabled until a header is in hand. The ordering is a real
   constraint rather than a stylistic one (a year file is a list of fields with
   no names on it), so the control says so by being unavailable, and the hint
   underneath says why. */
function sourceFilesHTML(node) {
  var id = node.id;
  var data = datasetFor(node);
  var header = headerFor(id);
  var want = datasetCfg(node);
  var notice = SOURCE_NOTICE[id];

  var html = '<div class="cfg-label">Data files</div><div class="src-files">';

  // 1: The column file
  html += '<div class="src-file' + (header ? ' done' : '') + '">' +
    '<span class="src-step">1</span>' +
    '<span class="src-what">' +
      (header
        ? '<b>' + esc(header.name) + '</b><small>' +
            (header.columns.length ? header.columns.length + ' columns' : 'built in') + '</small>'
        : '<b>' + esc(DATA_HEADERS_NAME) + '</b><small>not loaded</small>') +
    '</span>' +
    '<button class="src-btn" onclick="pickHeadersFile(' + id + ')">' +
      (header ? 'Replace' : 'Choose') + '</button>' +
  '</div>';

  /* 2: The year files.
     A list rather than one line of comma-separated names, because they are a
     collection the user adds to and takes from: each one has to be countable on
     its own and removable on its own. Naming them all in a single label made
     four files look like one thing that had to be re-picked whole. */
  var files = (data && !data.synthetic) ? data.files : [];
  var full = files.length >= MAX_YEAR_FILES;
  html += '<div class="src-file' + (files.length ? ' done' : '') + '">' +
    '<span class="src-step">2</span>' +
    '<span class="src-what">' +
      (files.length
        ? '<b>' + files.length + ' year file' + (files.length === 1 ? '' : 's') + '</b>' +
          '<small>' + files.reduce(function(a, f){ return a + f.rows; }, 0) + ' rows, ' +
          files.reduce(function(a, f){ return a + f.students; }, 0) + ' students</small>'
        : '<b>' + yearFileNameFor(want.years.length ? want.years[0] : 'YYYY') + '</b>' +
          '<small>' + (want.years.length
            ? (want.years.length === 1 ? 'wanted by this query'
               : want.years.length + ' wanted by this query')
            : 'not loaded') + '</small>') +
    '</span>' +
    '<button class="src-btn"' + (header && !full ? '' : ' disabled') +
      ' title="' + (full ? esc('This Source is holding the most year files it can.')
                         : 'Choose one or more mcs-students-YYYY files') + '"' +
      ' onclick="pickYearFiles(' + id + ')">' +
      (files.length ? 'Add' : 'Choose') + '</button>' +
  '</div>';

  /* Each loaded year, with the control that drops it. Indented under step 2
     rather than being three more numbered steps: they are the contents of one
     step, and numbering them would say the order they were chosen in matters. */
  if (files.length) {
    html += '<div class="src-years">' + files.map(function(f) {
      return '<div class="src-year">' +
        '<span class="src-year-name">' + esc(f.name) + '</span>' +
        '<span class="src-year-count">' + f.students + ' students</span>' +
        '<button class="src-year-drop" title="' +
          esc('Remove ' + f.name + ' from this Source') + '"' +
          ' onclick="removeSourceYear(' + id + ',' + f.year + ')">x</button>' +
      '</div>';
    }).join('') + '</div>';
  } else if (want.years.length > 1) {
    // Nothing loaded, but the saved query knows what it wants. Naming all of
    // them is the difference between re-picking the right files and guessing.
    html += '<div class="src-years">' + want.years.map(function(y) {
      return '<div class="src-year wanted">' +
        '<span class="src-year-name">' + esc(yearFileNameFor(y)) + '</span>' +
        '<span class="src-year-count">not loaded</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  html += '</div>';

  if (!header) {
    html += '<div class="src-hint">A year file has no column names in it, so ' +
      esc(DATA_HEADERS_NAME) + ' has to come first.</div>';
  }
  if (data && !data.synthetic) {
    html += '<button class="src-clear" onclick="clearSourceData(' + id + ')">' +
      'Unload everything, including ' + esc(DATA_HEADERS_NAME) + '</button>';
  }
  if (notice) {
    html += '<div class="src-notice ' + (notice.kind === 'error' ? 'bad' : 'ok') + '">' +
      esc(notice.text) + '</div>';
  }
  return html;
}

function configHTML(node, schemas) {
  var id = node.id;
  var cfg = node.cfg = node.cfg || defaultCfg(node.type);
  var schema = inputSchema(node, schemas);
  var html = '<div class="node-config">';

  if (node.type === 'source') {
    html += sourceFilesHTML(node);

    /* The population offers THIS Source's years, not every year loaded anywhere
       on the canvas. Offering a year this Source cannot answer would be
       offering an empty result dressed as a choice. */
    var data = datasetFor(node);
    var years = data ? data.years : [];
    html += '<div class="cfg-label">Population</div>' +
      '<select' + ctl(id, 'pop') + (years.length ? '' : ' disabled') + '>' +
        opt('all', cfg.pop, 'All students') +
        years.map(function(y){ return opt(String(y), cfg.pop, y + ' only'); }).join('') +
      '</select>';
  }

  if (node.type === 'filter') {
    html += '<div class="criteria-list">' +
      cfg.criteria.map(function(c, ci){ return criterionHTML(node, ci, c, schema); }).join('') +
    '</div>' +
    '<button class="add-criterion-btn" onclick="addCriterion(' + id + ')">+ add condition</button>';
  }

  if (node.type === 'compare') {
    var inIds = inputsOf(id);
    var labels = cfg.labels || {};
    html += '<div class="cfg-label">Branches (' + inIds.length + ')</div>';
    if (inIds.length === 0) {
      html += '<div class="cmp-hint">Drag a Source or Filter next to this node to add a branch.</div>';
    } else {
      if (inIds.length === 1) {
        html += '<div class="cmp-hint">One branch connected. Add another to compare against.</div>';
      }
      html += '<div class="cmp-branches">';
      inIds.forEach(function(inId, i) {
        var up = findNode(inId);
        html += '<div class="cmp-branch">' +
          '<span class="cmp-swatch" style="background:' + (up ? getNodeEdgeColor(up) : '#555') + '"></span>' +
          '<input type="text" class="cmp-label-input" placeholder="Branch ' + (i + 1) + ' (auto)" ' +
            'value="' + esc(labels[inId] || '') + '"' + ctl(id, 'label:' + inId) + '>' +
        '</div>';
      });
      html += '</div>';
    }

    var picked = measuresOf(node);
    html += '<div class="cfg-label">Columns</div><div class="cmp-measures">' +
      MEASURES.map(function(m) {
        return '<label class="cmp-measure">' +
          '<input type="checkbox"' + (picked.indexOf(m.key) !== -1 ? ' checked' : '') +
            ctl(id, 'measure:' + m.key) + '>' +
          '<span>' + esc(m.label) + '</span></label>';
      }).join('') +
    '</div>' +
    '<div class="cfg-label">Order</div>' +
    '<select' + ctl(id, 'sort') + '>' +
      opt('wired', cfg.sort, 'As connected') +
      opt('desc',  cfg.sort, 'Highest first') +
      opt('asc',   cfg.sort, 'Lowest first') +
      opt('label', cfg.sort, 'Label A–Z') +
    '</select>';
    // Named only when an order that actually ranks is chosen.
    if (cfg.sort === 'desc' || cfg.sort === 'asc') {
      html += '<div class="cmp-hint">Ranked by the first ticked column.</div>';
    }
    /* The columns named here follow the tick boxes immediately, which is what
       makes the boxes legible: a run is not needed to see what they do. */
    html += '<div class="cmp-hint">Out: one row per branch \u2014 ' +
      compareColumns(measuresOf(node)).map(function(c){ return '<b>' + esc(c.label) + '</b>'; }).join(', ') +
      '.</div>';
  }

  if (node.type === 'selectFor') {
    /* `schema` is the DATA port, because data is the primary port. The labels
       branch is fetched separately and only when something is actually wired
       to it: inputSchema() falls back to the student header when a port is
       empty, which is right for a panel describing the rows and wrong for one
       asking which column holds the labels. It would offer 27 columns of a
       table that is not there. */
    var gfields = groupFields(schema);
    var labelWires = inputsOf(id, 'labels');
    var gf = groupField(node, schema);

    if (!gfields.length) {
      html += '<div class="cmp-hint">Nothing to group by. Wire a table into ' +
        '<b>Data</b>.</div>';
    } else {
      html += '<div class="cfg-label">For each</div>' +
        '<select' + ctl(id, 'by') + '>' +
          gfields.map(function(f) {
            return opt(f.key, gf ? gf.key : '', f.label);
          }).join('') +
        '</select>';
    }

    /* Where the groups come from is decided by a wire rather than by a
       control, so it is the one thing the settings cannot show. Said in one
       line while the port is empty, and dropped once it is wired, because a
       connected port describes itself: the picker below it names the column
       the labels are read from. What the port BUYS (zero-count groups, labels
       from another branch) is reference material and lives in Help. */
    if (labelWires.length) {
      var lschema = inputSchema(node, schemas, 'labels');
      var lcols = labelCols(lschema);
      var lchosen = (cfg.labelCol && colByKey(lschema, cfg.labelCol) &&
                     colByKey(lschema, cfg.labelCol).type !== COLTYPE.COURSES)
        ? cfg.labelCol
        : (lcols.length ? lcols[0].key : '');
      html += '<div class="cfg-label">Groups from the Labels branch</div>' +
        (lcols.length
          ? '<select' + ctl(id, 'labelCol') + '>' +
              lcols.map(function(c){ return opt(c.key, lchosen, c.label); }).join('') +
            '</select>'
          : '<div class="cmp-hint">No column on that branch can supply labels. ' +
              'Put a <b>Project</b> in front of it.</div>');
    } else {
      html += '<div class="cmp-hint"><b>Labels</b> (optional). Unconnected: the ' +
        'groups are the values found in the column above.</div>';
    }

    var stats = statsOf(node);
    html += '<div class="cfg-label">Measure</div><div class="stat-list">' +
      stats.map(function(st, si) {
        var sop = selectForOp(st && st.op);
        var scol = sop.needsCol ? statCol(st, schema) : null;
        return '<div class="stat-row">' +
          '<select class="stat-op"' + ctl(id, 'stat.' + si + '.op') + '>' +
            SELECTFOR_OPS.map(function(o){ return opt(o.key, sop.key, o.label); }).join('') +
          '</select>' +
          // The column select appears only for the measures that take one, so
          // the row does not carry a control that means nothing for Count.
          (sop.needsCol
            ? '<select class="stat-col"' + ctl(id, 'stat.' + si + '.col') + '>' +
                measurableCols(schema).map(function(c) {
                  return opt(c.key, scol ? scol.key : '', c.label);
                }).join('') +
              '</select>'
            : '<span class="stat-nocol"></span>') +
          (si > 0
            ? '<button class="remove-criterion-btn" onclick="removeStat(' + id + ',' + si + ')">x</button>'
            : '<span class="stat-nodel"></span>') +
        '</div>';
      }).join('') +
    '</div>' +
    '<button class="add-criterion-btn sort-add" onclick="addStat(' + id + ')">+ add measure</button>';

    if (statsOf(node).some(function(st){ return selectForOp(st && st.op).needsCol; }) &&
        !measurableCols(schema).length) {
      html += '<div class="cmp-hint">No numeric column upstream: Those ' +
        'measures will come out blank.</div>';
    }

    // Say what comes out, in the words the header will use, for the same
    // reason the Aggregate panels do: the shape is the part people get wrong.
    html += '<div class="cmp-hint">Out: one row per group \u2014 ' +
      selectForColumns(node, schema).map(function(c){ return '<b>' + esc(c.label) + '</b>'; }).join(', ') +
      '. Not ordered; put a <b>Sort</b> after it.</div>';
  }

  if (node.type === 'histogram') {
    var bcols = binnableCols(schema);
    var bf = binField(node, schema);

    if (!bcols.length) {
      html += '<div class="cmp-hint">Nothing to bin. This node needs a number ' +
        'column.</div>';
    } else {
      html += '<div class="cfg-label">Distribution of</div>' +
        '<select' + ctl(id, 'by') + '>' +
          bcols.map(function(c){ return opt(c.key, bf ? bf.key : '', c.label); }).join('') +
        '</select>' +
        '<div class="cfg-label">In bands of</div>' +
        // Left empty it says "auto", because empty is a real setting here: the
        // width is then chosen from the data, which the panel cannot see.
        '<input type="number" min="0" step="any" placeholder="auto" ' +
          'value="' + esc(cfg.width === undefined ? '' : cfg.width) + '"' + ctl(id, 'width') + '>';

      /* Shown only while the width is the one thing still undecided. Once a
         number is typed the control states itself. The boundary rule (which
         side of a shared edge a value falls on) is the one thing about a
         histogram a reader cannot check by looking at it, and it is true on
         every render, which is what makes it reference material rather than a
         panel hint: it is explained in Help instead of asserted here. */
      if (binWidth(node) === null) {
        html += '<div class="cmp-hint">Empty: the width is chosen from the data.</div>';
      }
    }

    var hstats = statsOf(node);
    html += '<div class="cfg-label">Measure</div><div class="stat-list">' +
      hstats.map(function(st, si) {
        var hop = selectForOp(st && st.op);
        var hcol = hop.needsCol ? statCol(st, schema) : null;
        return '<div class="stat-row">' +
          '<select class="stat-op"' + ctl(id, 'stat.' + si + '.op') + '>' +
            SELECTFOR_OPS.map(function(o){ return opt(o.key, hop.key, o.label); }).join('') +
          '</select>' +
          (hop.needsCol
            ? '<select class="stat-col"' + ctl(id, 'stat.' + si + '.col') + '>' +
                measurableCols(schema).map(function(c) {
                  return opt(c.key, hcol ? hcol.key : '', c.label);
                }).join('') +
              '</select>'
            : '<span class="stat-nocol"></span>') +
          (si > 0
            ? '<button class="remove-criterion-btn" onclick="removeStat(' + id + ',' + si + ')">x</button>'
            : '<span class="stat-nodel"></span>') +
        '</div>';
      }).join('') +
    '</div>' +
    '<button class="add-criterion-btn sort-add" onclick="addStat(' + id + ')">+ add measure</button>';

    html += '<div class="cmp-hint">Out: one row per band \u2014 ' +
      histogramColumns(node, schema).map(function(c){ return '<b>' + esc(c.label) + '</b>'; }).join(', ') +
      '. Empty bands are kept, as zero.</div>';
  }

  if (node.type === 'sort') {
    var scols = sortableCols(schema);
    if (!scols.length) {
      html += '<div class="cmp-hint">No sortable columns upstream. Connect a Source.</div>';
    } else {
      var skeys = cfg.keys && cfg.keys.length ? cfg.keys : [newSortKey()];
      html += '<div class="cfg-label">Sort by</div><div class="sort-list">' +
        skeys.map(function(k, si) {
          // A saved key can outlive its column: Rewiring a Source from students
          // to enrolments is enough. Show the fallback the engine will actually
          // use, rather than a select silently displaying option one while the
          // model still says something else.
          var kc = k.col ? colByKey(schema, k.col) : null;
          var chosen = (kc && kc.type !== COLTYPE.COURSES) ? k.col : scols[0].key;
          var scol = colByKey(schema, chosen);
          var sdir = k.dir === 'desc' ? 'desc' : 'asc';
          return '<div class="sort-row">' +
            '<span class="sort-rank">' + (si + 1) + '</span>' +
            '<select class="sort-col"' + ctl(id, 'sort.' + si + '.col') + '>' +
              scols.map(function(c){ return opt(c.key, chosen, c.label); }).join('') +
            '</select>' +
            '<select class="sort-dir"' + ctl(id, 'sort.' + si + '.dir') + '>' +
              SORT_DIRS.map(function(d){ return opt(d, sdir, dirLabel(scol, d)); }).join('') +
            '</select>' +
            (si > 0
              ? '<button class="remove-criterion-btn" onclick="removeSortKey(' + id + ',' + si + ')">x</button>'
              : '<span class="sort-nodel"></span>') +
          '</div>';
        }).join('') +
      '</div>';
      // Offering more keys than there are columns invites a sort key that can
      // never break a tie the earlier ones did not already settle.
      if (skeys.length < scols.length) {
        html += '<button class="add-criterion-btn sort-add" onclick="addSortKey(' + id + ')">+ add tie-breaker</button>';
      }
      if (skeys.length > 1) {
        html += '<div class="cmp-hint">Row 1 decides; the rest break its ties.</div>';
      }
    }
  }

  if (node.type === 'reverse') {
    /* The exception to the rule the other panels follow. Everywhere else a hint
       is dropped once a control describes the same thing; here there is no
       control to drop it in favour of, because there is nothing to choose. The
       hint IS the panel, so the pairing with Take stays in both states: on its
       own Reverse looks like a node that does nothing useful, and that pairing
       is the whole point of it. Shortened rather than removed. */
    var rn = inputsOf(id).length
      ? 'Out: the same rows and columns, last one first.'
      : 'Wire a table in.';
    html += '<div class="cmp-hint">' + rn +
      ' Before a <b>Take</b>, that is the last few rows.</div>';
  }

  if (node.type === 'take') {
    // Bound to cfg.n verbatim, so a partially typed value is preserved between
    // renders. The engine's fallback is what protects the Run, not the control.
    html += '<div class="cfg-label">Keep first</div>' +
      '<input type="number" min="' + TAKE_MIN + '" step="1" ' +
        'value="' + esc(cfg.n === undefined ? '' : cfg.n) + '"' + ctl(id, 'n') + '>' +
      '<div class="cmp-hint">Out: the first ' + takeCount(node) +
        ' rows as they arrive. Put a <b>Sort</b> in front to rank them.</div>';
  }

  if (node.type === 'unique') {
    /* One selector, defaulting to whole rows. The two modes are genuinely
       different operations (one keeps the table's shape, the other reduces it
       to a list), so the control says which is which in words rather than
       leaving the user to infer it from the result. */
    var ucols = uniqueCols(schema);
    var ucur  = uniqueCol(node, schema);
    html += '<div class="cfg-label">Distinct</div>' +
      '<select' + ctl(id, 'col') + '>' +
        opt('', ucur ? 'x' : '', 'Whole rows') +
        ucols.map(function(c) {
          return opt(c.key, ucur ? ucur.key : '', 'Values of ' + c.label);
        }).join('') +
      '</select>';
    html += '<div class="cmp-hint">' + (ucur
      ? 'Out: one column of distinct <b>' + esc(ucur.label) + '</b> values.'
      : 'Out: the same columns, with repeated rows removed.') +
      '</div>';
  }

  if (node.type === 'aggregate' || node.type === 'aggregateColumns' ||
      node.type === 'aggregateRows') {
    var isCols = node.type === 'aggregateColumns';
    var isRows = node.type === 'aggregateRows';
    var op = aggOp(node);

    html += '<div class="cfg-label">Measure</div>' +
      '<select' + ctl(id, 'op') + '>' +
        AGG_OPS.map(function(o){ return opt(o.key, op.key, o.label); }).join('') +
      '</select>';

    if (!isCols && !isRows && op.needsCol) {
      // Only the whole-table Aggregate picks a column: AggregateColumns applies
      // the measure to every column at once, which is the point of it.
      var mcols = measurableCols(schema);
      var chosen = aggregateCol(node, schema);
      html += '<div class="cfg-label">Of column</div>' +
        (mcols.length
          ? '<select' + ctl(id, 'col') + '>' +
              mcols.map(function(c){ return opt(c.key, chosen ? chosen.key : '', c.label); }).join('') +
            '</select>'
          : '<div class="cmp-hint">No numeric column upstream: The result will be blank.</div>');
    }

    // Say what will come out, in the same words the result will use. The shape
    // of an aggregation is the thing people get wrong about it, and stating it
    // before the query runs is cheaper than explaining it afterwards.
    if (isRows) {
      /* Naming the count of contributing columns is the whole warning: if it
         says 1, the measure is reducing a single column to itself, and if it
         counts a column the user thinks of as a label, the label is being
         added into the total. */
      var rIdx = aggregateRowsIdx(node, schema);
      var rTotal = schema.columns.length;
      var rSkip = rTotal - rIdx.length;
      html += '<div class="cmp-hint">' +
        'Out: one column, one row per row in \u2014 ' + esc(op.label.toLowerCase()) +
        ' across ' + (rTotal
          ? rIdx.length + ' of ' + rTotal + ' column' + (rTotal === 1 ? '' : 's')
          : 'each row') + '.' +
        (rSkip > 0
          ? ' ' + rSkip + ' non-measure column' + (rSkip === 1 ? ' is' : 's are') +
            ' ignored. Put a <b>Select</b> in front.'
          : '') +
        '</div>';
    } else if (isCols) {
      var ncols = schema.columns.length;
      html += '<div class="cmp-hint">Out: one row, ' +
        (ncols ? ncols + ' column' + (ncols === 1 ? '' : 's') : 'one column per column in') +
        ', same headers, ' + esc(op.label.toLowerCase()) + ' down each.' +
        (op.key === 'count' ? '' : ' Non-numeric columns come out blank.') +
        '</div>';
    } else {
      html += '<div class="cmp-hint">Out: one row, one column \u2014 ' +
        esc(aggregateColumn(node, schema).label) + '.</div>';
    }
  }

  if (node.type === 'select') {
    var availCols = schema.columns;
    if (!availCols.length) {
      html += '<div class="cmp-hint">Nothing upstream yet. Wire a Source in to choose columns.</div>';
    } else {
      var kept = selectedCols(node, schema).map(function(c){ return c.key; });
      html += '<div class="cfg-label">Keep</div><div class="cmp-measures sel-cols">' +
        availCols.map(function(c) {
          // The last ticked box is disabled rather than hidden. A Select with no
          // columns is a table with nothing in it, and the panel it leaves behind
          // offers no way back. Every box would be unticked and identical.
          var on = kept.indexOf(c.key) !== -1;
          var locked = on && kept.length === 1;
          return '<label class="cmp-measure' + (locked ? ' locked' : '') + '"' +
              (locked ? ' title="At least one column has to be kept"' : '') + '>' +
            '<input type="checkbox"' + (on ? ' checked' : '') + (locked ? ' disabled' : '') +
              ctl(id, 'column:' + c.key) + '>' +
            '<span>' + esc(c.label) + '</span></label>';
        }).join('') +
      '</div>';
      html += '<div class="cmp-hint">Out: ' + kept.length + ' of ' +
        availCols.length + ' columns, in the order they arrive. Rows are never ' +
        'touched.</div>';
    }
  }

  if (node.type === 'project') {
    /* No controls, so the panel exists entirely to say what the node does to
       the meaning of a row. That is the thing this node was asked to make
       visible, and a panel that said nothing would put it back where it was
       when it lived hidden on the Source. */
    if (!canProject(schema)) {
      html += '<div class="cmp-hint">No course data here, so rows pass through ' +
        'unchanged. Wire this after a <b>Source</b> or a <b>Filter</b>.</div>';
    } else {
      var pCols = projectColumns(schema);
      var pGained = enrolmentColumns().map(function(c){ return c.label; }).join(', ');
      html += '<div class="cfg-label">One row per course</div>' +
        '<div class="cmp-hint proj-warn">Every row becomes one row per course ' +
        'taken, so a row is an enrolment from here on, not a student. ' +
        '<b>A count after this counts enrolments.</b></div>' +
        '<div class="cmp-hint">Out: ' + pCols.length + ' columns. Adds ' +
        esc(pGained) + '. ID becomes Student.</div>';
    }
  }

  if (node.type === 'combine') {
    var cinIds = inputsOf(id);
    var cmode = combineMode(node);

    html += '<div class="cfg-label">Inputs (' + cinIds.length + ')</div>';
    if (cinIds.length === 0) {
      html += '<div class="cmp-hint">Wire two branches into this node to stack them.</div>';
    } else if (cinIds.length === 1) {
      html += '<div class="cmp-hint">One input, passed straight through. Add another to combine.</div>';
    }

    html += '<div class="cfg-label">Mode</div>' +
      '<select' + ctl(id, 'mode') + '>' +
        COMBINE_MODES.map(function(m){ return opt(m.key, cmode.key, m.label); }).join('') +
      '</select>';

    if (cmode.key === 'merge') {
      html += '<label class="cmb-check"><input type="checkbox"' +
          (cfg.dedupe ? ' checked' : '') + ctl(id, 'dedupe') + '>' +
        '<span>Drop duplicate rows</span></label>' +
        '<div class="cmp-hint">Off: duplicates are kept. On: a set union.</div>';
    } else {
      // Difference is not symmetric, so the base has to be named rather than
      // inferred from the order the wires happened to be drawn.
      var baseId = combineBaseId(node, cinIds);
      if (cinIds.length > 1) {
        html += '<div class="cfg-label">Base</div>' +
          '<select' + ctl(id, 'base') + '>' +
            cinIds.map(function(inId) {
              var up = findNode(inId);
              return opt(String(inId), String(baseId), up ? (upstreamLabel(up)) : ('Input ' + inId));
            }).join('') +
          '</select>';
      }
      /* The key column comes from the BASE, not from whichever wire happened to
         be drawn first. They are usually the same table, and were always assumed
         to be, but join makes the difference visible: pick the second input as
         the base and the picker would otherwise offer columns the base does not
         have, then refuse the key it just offered. */
      var baseSchema = (schemas && schemas[combineBaseId(node, cinIds)]) || schema;
      var kcols = combineKeyCols(baseSchema);
      var kcur = combineKeyCol(node, baseSchema);
      html += '<div class="cfg-label">Match rows on</div>' +
        (kcols.length
          ? '<select' + ctl(id, 'key') + '>' +
              kcols.map(function(c){ return opt(c.key, kcur ? kcur.key : '', c.label); }).join('') +
            '</select>'
          : '<div class="cmp-hint">No column upstream to match on.</div>');
      if (cmode.key === 'join') {
        html += '<label class="cmb-check"><input type="checkbox"' +
            (cfg.keepUnmatched ? ' checked' : '') + ctl(id, 'keepUnmatched') + '>' +
          '<span>Keep base rows with no match</span></label>';
      }
      html += '<div class="cmp-hint">' +
        (cmode.key === 'intersect'
          ? 'Keeps base rows whose value also appears in every other input.'
          : cmode.key === 'difference'
          ? 'Keeps base rows whose value appears in none of the other inputs.'
          : 'Out: the base\u2019s rows, never more, with the other inputs\u2019 ' +
            'columns added on. A repeated key uses its first matching row.') +
        '</div>';
    }
  }

  if (node.type === 'output') {
    var show = normaliseShow(node);
    cfg.show = show;

    /* First, because it is the larger question: is this Output an answer to
       read, or a step on the way to one? Everything below describes how the
       block is drawn, and none of it matters while it is not being drawn. */
    html += '<label class="cmb-check"><input type="checkbox"' +
        (hiddenInPanel(node) ? '' : ' checked') + ctl(id, 'panel') + '>' +
      '<span>Show in results panel</span></label>';

    html += '<div class="cfg-label">Show</div><select' + ctl(id, 'show') + '>';
    if (branchesFeedOutput(node)) {
      html += opt('summary', show, 'Summary table') +
              opt('lists',   show, 'Summary + row lists');
    } else {
      html += opt('rows',    show, 'Rows (raw data)') +
              opt('count',   show, 'Count');
    }
    html += '</select>';

    /* The column picker appears only on the row view. It is the same control as
       Select's, deliberately (two panels that do the same thing should look
       the same), and it reads the header that is actually arriving, so an
       Output rewired behind a different branch offers that branch's columns. */
    if (show === 'rows') {
      var oCols = schema.columns;
      if (!oCols.length) {
        html += '<div class="cmp-hint">Nothing wired in yet. Connect a Source to ' +
          'choose which columns to show.</div>';
      } else {
        var oKept = outputCols(node, schema).map(function(c){ return c.key; });
        html += '<div class="cfg-label">Show columns</div><div class="cmp-measures sel-cols">' +
          oCols.map(function(c) {
            // Last box locked for Select's reason: an Output showing no columns
            // has nothing to show, and the panel it leaves behind offers no way
            // back, since every box would be unticked and identical.
            var on = oKept.indexOf(c.key) !== -1;
            var locked = on && oKept.length === 1;
            return '<label class="cmp-measure' + (locked ? ' locked' : '') + '"' +
                (locked ? ' title="At least one column has to be shown"' : '') + '>' +
              '<input type="checkbox"' + (on ? ' checked' : '') + (locked ? ' disabled' : '') +
                ctl(id, 'column:' + c.key) + '>' +
              '<span>' + esc(c.label) + '</span></label>';
          }).join('') +
        '</div>';
        html += '<div class="cmp-hint">Showing ' + oKept.length + ' of ' +
          oCols.length + ' columns. No rows are lost, and Copy and Save follow ' +
          'this.</div>';
      }
    }

    // The file name deliberately lives with the Copy/Save buttons in the results
    // panel rather than here. It describes the exported file, not the query, and
    // putting it on the node implied it was part of what gets computed.
  }

  return html + '</div>';
}

/* Port stubs are drawn only where they carry information. On a node with more
   than one input, where the user has to know which is which. A single-input
   node shows nothing: it has one entry point, in the place arrows have always
   landed, and decorating it would be noise on every node on the canvas.

   Each stub is positioned by the same fraction as portOffsetY, so the marker on
   the shape and the arrowhead in the SVG are placed by one rule rather than two
   that have to be kept in step. An occupied port is styled differently, which
   is how a user sees that a single input is full before trying to drop on it. */
function portsHTML(node) {
  var ps = portsOf(node.type);
  if (ps.length < 2) return '';
  return '<span class="node-ports">' + ps.map(function(p, i) {
    var taken = wiresInto(node.id, p.key).length > 0;
    var top = 100 * (i + 1) / (ps.length + 1);
    return '<span class="node-port' + (taken ? ' filled' : '') + '"' +
           ' style="top:' + top + '%"' +
           ' title="' + esc(p.label) + (p.multi ? ' (accepts several)' : '') + '">' +
           '<i></i><em>' + esc(p.label) + '</em></span>';
  }).join('') + '</span>';
}

function shapeHTML(node) {
  var removeBtn = '<button class="node-remove" onclick="removeNode(' + node.id + ')">x</button>' +
                  portsHTML(node);
  if (node.type === 'source') {
    /* A Source with no files looks exactly like a Source with files until you
       open its panel, and on a graph of a dozen nodes that is the difference
       between "why is this empty" and "load that one". The dashed ring says
       which, and it says it around the whole shape.

       A badge in the corner did the same job and was a worse way to do it: the
       delete button lives at top-right, so the two occupied the same spot and
       the badge read as something to click. The border carries the state
       without competing for that corner. */
    return '<div class="node-shape shape-source' +
      (hasSourceData(node) ? '' : ' no-data') + '">' +
      removeBtn + 'Source</div>';
  }
  if (node.type === 'filter') return '<div class="node-shape shape-filter">' + removeBtn + 'Filter</div>';
  if (node.type === 'compare') {
    var glyph = '<span class="cmp-glyph"><i style="width:26px"></i><i style="width:16px"></i><i style="width:21px"></i></span>';
    return '<div class="node-shape shape-compare">' + removeBtn + glyph + 'Compare</div>';
  }
  if (node.type === 'sort') {
    // Bars of increasing length: the glyph says "ordered", and reads as
    // distinct from Take's equal-length bars with a cut through them.
    var sbars = '<span class="sort-glyph"><i style="width:9px"></i>' +
      '<i style="width:16px"></i><i style="width:23px"></i></span>';
    return '<div class="node-shape shape-sort">' + removeBtn + sbars + 'Sort</div>';
  }
  if (node.type === 'reverse') {
    /* Sort's ascending bars, upside down, with a turn arrow beside them. Read
       against Sort the inversion is the message: same bars, opposite order. The
       arrow is what stops it being mistaken for "sort descending", which is a
       different node reached a different way. */
    var rv = '<span class="rev-glyph">' +
      '<span class="rev-bars"><i style="width:23px"></i>' +
      '<i style="width:16px"></i><i style="width:9px"></i></span>' +
      '<b class="rev-turn"></b></span>';
    return '<div class="node-shape shape-reverse">' + removeBtn + rv + 'Reverse</div>';
  }
  if (node.type === 'take') {
    // Three kept bars above the cut, one dropped below it. The glyph says
    // "first few, rest discarded" without repeating the word on the label.
    var bars = '<span class="take-glyph">' +
      '<i></i><i></i><i></i><b></b><i class="cut"></i></span>';
    return '<div class="node-shape shape-take">' + removeBtn + bars + 'Take</div>';
  }
  if (node.type === 'unique') {
    /* Two pairs, each a value and its repeat. The first of each pair is solid,
       meaning kept, and the second is an empty outline of the same width,
       the same value again, dropped. Matching widths say "the same value";
       the outline is what says "not kept".

       The previous glyph struck a line through the repeat, which read as Take's
       cut rule and so said "everything below here is discarded" rather than
       "this one is a duplicate". Two pairs rather than one also matter: a
       single repeat looks like a rule separating a top group from a bottom one,
       which is exactly the wrong reading. */
    var uq = '<span class="uniq-glyph">' +
      '<i class="wide"></i><i class="wide dupe"></i>' +
      '<i class="narrow"></i><i class="narrow dupe"></i></span>';
    return '<div class="node-shape shape-unique">' + removeBtn + uq + 'Unique</div>';
  }
  if (node.type === 'select') {
    /* Three columns with the middle one hollow. Every other glyph on the canvas
       is read top to bottom because it says something about rows; this one is
       read left to right, which is the distinction the node exists to make. The
       dropped column is outlined rather than absent, so the glyph shows a
       choice being made rather than a table that happens to be narrow. */
    var sg = '<span class="sel-glyph"><i></i><i class="off"></i><i></i></span>';
    return '<div class="node-shape shape-select">' + removeBtn + sg + 'Select</div>';
  }
  if (node.type === 'project') {
    /* One bar fanning out into three. Every other glyph on the canvas shows
       rows being kept, dropped, reordered or reduced; this is the only one that
       shows them multiplying, which is the single fact about this node worth
       recognising from across the canvas. Drawn left to right, like Select's,
       because both change the header, but opening out rather than narrowing. */
    var pj = '<span class="proj-glyph">' +
      '<i class="proj-one"></i><b class="proj-fan"></b>' +
      '<span class="proj-many"><i></i><i></i><i></i></span></span>';
    return '<div class="node-shape shape-project">' + removeBtn + pj + 'Project</div>';
  }
  if (node.type === 'aggregate') {
    // Rows funnelling into a single dot: many values, one value out.
    var ag = '<span class="agg-glyph"><i></i><i></i><i></i><b></b></span>';
    return '<div class="node-shape shape-aggregate">' + removeBtn + ag + 'Aggregate</div>';
  }
  if (node.type === 'aggregateColumns') {
    // The same funnel turned ninety degrees: three columns, each collapsing to
    // its own value, so the pair read as variants of one idea rather than two
    // unrelated nodes.
    var agc = '<span class="aggc-glyph">' +
      '<span class="aggc-col"><i></i><i></i><b></b></span>' +
      '<span class="aggc-col"><i></i><i></i><b></b></span>' +
      '<span class="aggc-col"><i></i><i></i><b></b></span></span>';
    return '<div class="node-shape shape-aggcols">' + removeBtn + agc + 'Agg. Columns</div>';
  }
  if (node.type === 'aggregateRows') {
    /* AggregateColumns' glyph turned through ninety degrees: three ROWS, each
       collapsing rightwards to its own value. Read beside its sibling the axis
       is the whole message: One reduces down the page, the other across it. */
    var aggr = '<span class="aggr-glyph">' +
      '<span class="aggr-row"><i></i><i></i><b></b></span>' +
      '<span class="aggr-row"><i></i><i></i><b></b></span>' +
      '<span class="aggr-row"><i></i><i></i><b></b></span></span>';
    return '<div class="node-shape shape-aggrows">' + removeBtn + aggr + 'Agg. Rows</div>';
  }
  if (node.type === 'combine') {
    // Two streams converging into one: the mirror image of Compare's glyph,
    // which holds branches apart rather than joining them.
    var cg = '<span class="cmb-glyph">' +
      '<span class="cmb-in"><i></i><i></i></span>' +
      '<b></b>' +
      '<span class="cmb-out"><i></i></span></span>';
    return '<div class="node-shape shape-combine">' + removeBtn + cg + 'Combine</div>';
  }
  if (node.type === 'selectFor') {
    /* Three labelled rows, each with its own bar: the output shape drawn
       literally. Compare's glyph is three bars held apart with nothing naming
       them, and that is the difference between the two nodes. These groups
       have names, which is what makes them nameable in one control instead of
       wired one at a time. */
    var sfg = '<span class="sf-glyph">' +
      '<span class="sf-row"><b></b><i style="width:18px"></i></span>' +
      '<span class="sf-row"><b></b><i style="width:11px"></i></span>' +
      '<span class="sf-row"><b></b><i style="width:15px"></i></span></span>';
    return '<div class="node-shape shape-selectfor">' + removeBtn + sfg + 'Select For</div>';
  }
  if (node.type === 'histogram') {
    /* Bars of unequal height with no gaps between them, which is the one thing
       that distinguishes a histogram from the bar charts the other glyphs draw:
       Sort's bars ascend and are spaced, Compare's three are held apart. Touching
       bars say the axis underneath is continuous, which is the whole idea here. */
    var hg = '<span class="hist-glyph">' +
      '<i style="height:5px"></i><i style="height:9px"></i><i style="height:14px"></i>' +
      '<i style="height:11px"></i><i style="height:6px"></i></span>';
    return '<div class="node-shape shape-histogram">' + removeBtn + hg + 'Histogram</div>';
  }
  if (node.type === 'output') return '<div class="node-shape shape-output">' + removeBtn + 'Output</div>';
  return '';
}

function render() {
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
    el.className = 'node' + (isSelected(node.id) ? ' selected' : '');
    el.style.left = node.x + 'px';
    el.style.top  = node.y + 'px';
    el.innerHTML = shapeHTML(node) + configHTML(node, schemas);
    vp.appendChild(el);
    nodeEls[node.id] = el;

    var shape = el.querySelector('.node-shape');
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
  setCfg(parseInt(nid, 10), key, value);
  /* Showing or hiding an Output in the panel computes nothing, so it must not
     invalidate the run. Being made to press Run Query again to get back a block
     you only asked to look away from would be a poor trade, and the answer on
     screen is still the answer. The blocks already drawn are re-dressed. */
  if (key === 'panel') applyPanelVisibility();
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
  cancelPreviewTimer(); hidePreview();
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
  if (drag.group.length === 1) {
    var dn = drag.node, best = null, bestDist = SNAP_DIST;
    nodes.forEach(function(n) {
      if (n.id === dn.id) return;
      var dir = resolveDirection(dn, n);
      if (!dir) return;
      var dx = dir.tip.x - dir.p0.x, dy = dir.tip.y - dir.p0.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) { bestDist = dist; best = n; }
    });
    ghostTarget = best ? best.id : null;
  }

  drawArrows();
}

function onUp() {
  var wired = false;
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
      }
    }
  }
  var moved = drag && drag.moved;
  drag = null;
  ghostTarget = null;
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

/* EDGE DATA PREVIEW
   After a deliberate dwell, show the first few rows travelling along a
   connection. The upstream node's emitted table, recomputed live so it is
   current even mid-edit. A plausibility aid: the "of N" total is the real
   signal, the rows are dataset-ordered texture rather than a sample. */
var PREVIEW_DELAY = 450;
var previewTimer = null;
var previewEl = null;

function cancelPreviewTimer() {
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
}
function armPreviewTimer(conn, pathEl) {
  cancelPreviewTimer();
  previewTimer = setTimeout(function() {
    previewTimer = null;
    showPreview(conn, pathEl);
  }, PREVIEW_DELAY);
}
function ensurePreviewEl() {
  if (previewEl) return previewEl;
  previewEl = document.createElement('div');
  previewEl.className = 'edge-preview';
  previewEl.style.display = 'none';
  document.getElementById('canvas').appendChild(previewEl);
  return previewEl;
}
function hidePreview() {
  if (previewEl) previewEl.style.display = 'none';
  previewAnchor = null;
}

// No saveState() call is needed any more: the model is already current, because
// every keystroke wrote straight into it.
function edgeData(conn) {
  var ev = evaluateGraph();
  if (ev.error) return { error: ev.error };
  var r = ev.res[conn.from];
  if (!r) return { error: 'unresolved' };
  if (!r.hasSource) return { incomplete: true };
  return { table: r.table };
}

// Preview columns are capped, not chosen: a join result carries both inputs'
// headers and runs to a dozen columns, which no floating panel can hold.
// Paired with the .edge-preview width in the stylesheet: Six columns at the
// density four had. Raising this without widening that crowds the cells until
// every one of them ellipsises away to nothing.
var PREVIEW_COLS = 6;
var PREVIEW_ROWS = 5;

/* Which columns to show is a choice, not just a slice. Long free-text columns
   (a course title, a specialisation) consume the whole panel and tell you least
   about whether the right rows are flowing, so they yield to shorter ones. The
   count above the table is the real signal; these rows are texture. */
function previewColumns(t) {
  var wide = [], narrow = [];
  t.columns.forEach(function(c) {
    (c.type === COLTYPE.TEXT || c.key === 'specialisation' ? wide : narrow).push(c);
  });
  var picked = narrow.slice(0, PREVIEW_COLS);
  for (var i = 0; picked.length < PREVIEW_COLS && i < wide.length; i++) picked.push(wide[i]);
  // Keep the table's own left-to-right order rather than the order picked in
  return t.columns.filter(function(c){ return picked.indexOf(c) !== -1; });
}

function previewTableHTML(t) {
  var cols = previewColumns(t);
  var hidden = t.columns.length - cols.length;
  var moreHead = hidden > 0 ? '<th class="ep-more-col" title="' + hidden + ' more columns">…</th>' : '';
  var moreCell = hidden > 0 ? '<td class="ep-more-col">…</td>' : '';

  var head = cols.map(function(c) {
    return '<th title="' + esc(c.label) + '">' + esc(c.label) + '</th>';
  }).join('') + moreHead;

  var body = t.rows.slice(0, PREVIEW_ROWS).map(function(r) {
    return '<tr>' + cols.map(function(c) {
      var v = r[colIndex(t, c.key)];
      var shown = fmtCell(c, v);
      // Truncation is visual only, so the full value goes in the tooltip
      var ttl = cellTitle(c, v) || shown;
      return '<td title="' + esc(ttl) + '">' + esc(shown) + '</td>';
    }).join('') + moreCell + '</tr>';
  }).join('');

  return '<table class="ep-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
}

function showPreview(conn, pathEl) {
  var res = edgeData(conn);
  var el = ensurePreviewEl();
  var body;

  if (res.error) {
    body = '<div class="ep-note">Can\'t preview: ' +
      (res.error.indexOf('Circular') === 0 ? 'circular connection.' : 'graph unresolved.') + '</div>';
  } else if (res.incomplete) {
    body = '<div class="ep-note">No data on this edge yet. Upstream isn\'t connected to a Source.</div>';
  } else {
    var t = res.table, n = t.rows.length;
    var count = '<div class="ep-count"><span class="ep-num">' + n + '</span> row' + (n === 1 ? '' : 's') + ' on this edge</div>';
    body = n === 0
      ? count + '<div class="ep-note">Empty table. Nothing passes this point.</div>'
      : count + previewTableHTML(t) +
        '<div class="ep-foot">showing ' + Math.min(PREVIEW_ROWS, n) + ' of ' + n + ', in table order</div>';
  }
  el.innerHTML = body;
  previewAnchor = pathEl._mid || { x:0, y:0 };
  el.style.display = 'block';
  placePreview();
}

/* The preview is a sibling of the scaled layer, not a child of it, so its text
   stays at a readable size when the canvas is zoomed out, which is exactly when
   a row count is most useful and the nodes themselves are least readable. The
   cost is that its anchor arrives in world coordinates and has to be projected
   here. Kept as its own function so a zoom mid-hover can re-place the panel
   rather than leaving it stranded where the edge used to be. */
var previewAnchor = null;

function placePreview() {
  if (!previewEl || !previewAnchor || previewEl.style.display === 'none') return;
  var mid = toScreen(previewAnchor.x, previewAnchor.y);
  var cv = document.getElementById('canvas');
  var cw = cv.clientWidth, ch = cv.clientHeight;
  var pw = previewEl.offsetWidth, ph = previewEl.offsetHeight;
  var GAP = 26; // clears the ~9px badge radius plus breathing room

  var left = Math.max(6, Math.min(mid.x - pw / 2, cw - pw - 6));
  var top = mid.y - ph - GAP;
  previewEl.classList.remove('ep-below');
  if (top < 6) { top = mid.y + GAP; previewEl.classList.add('ep-below'); }
  // Flipping below can push it off the bottom on a short canvas; clamp last.
  top = Math.min(top, ch - ph - 6);
  previewEl.style.left = Math.round(left) + 'px';
  previewEl.style.top = Math.round(top) + 'px';
}

function repositionPreview() { placePreview(); }

/* True while any canvas gesture is in flight: Dragging a node, sweeping a
   marquee, or panning.

   Connections carry two hover affordances: a delete badge and the data-preview
   panel. Both are helpful when the pointer is resting on a line and actively
   unhelpful while it is travelling across one. Sweeping a marquee used to light
   up every arrow it crossed and pop a preview over the box being drawn, which
   read as the selection picking up the arrows themselves. It never did (only
   node ids ever enter the selection), but the feedback said otherwise, and
   feedback is what the user has to go on. */
function gestureActive() { return !!(drag || marquee || panning); }

function drawArrows() {
  var svg = document.getElementById('svg');
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  cancelPreviewTimer(); // a rebuild invalidates the path a pending preview was armed on

  connections.forEach(function(conn) {
    var a = findNode(conn.from), b = findNode(conn.to);
    if (!a || !b) return;
    var p0 = shapeExit(a), tip = shapeEntry(b, conn.port);

    var g = svgEl('g');
    svg.appendChild(g);
    var pathEl = drawArrow(g, p0, tip, conn.color, '0.9', false);

    if (gestureActive()) return; // no hover affordances mid-gesture

    // Invisible fat stroke so the 2px line is comfortably hoverable, extended to
    // the true tip so the arrowhead counts as part of the line.
    var hit = svgEl('path');
    hit.setAttribute('d', pathEl.getAttribute('d') + ' L ' + tip.x + ' ' + tip.y);
    hit.setAttribute('class', 'conn-hit');
    // Widened as the view shrinks, so the grab band stays ~20 screen px. The CSS
    // value is the 100% case; this overrides it per zoom level.
    hit.setAttribute('stroke-width', 20 / view.z);
    g.appendChild(hit);

    var badge = null, hovered = false;
    function setHover(on) {
      if (on === hovered) return;
      hovered = on;
      if (on) {
        badge = buildDeleteBadge(conn, pathEl);
        if (badge) g.appendChild(badge);
      } else if (badge && badge.parentNode) {
        badge.parentNode.removeChild(badge);
        badge = null;
      }
      hoverConn = on ? connKey(conn) : null;
    }

    // mousemove rather than mouseenter, so hover still engages when the SVG is
    // rebuilt beneath a stationary cursor
    hit.addEventListener('mousemove', function() {
      // Second line of defence. The hit strokes are not built at all while a
      // gesture is running, but one begun *before* the gesture started is still
      // in the DOM and would otherwise light up as the marquee swept past it.
      if (gestureActive()) return;
      setHover(true);
      armPreviewTimer(conn, pathEl);
    });
    g.addEventListener('mouseleave', function() {
      setHover(false);
      cancelPreviewTimer();
      hidePreview();
    });

    if (hoverConn === connKey(conn)) setHover(true);
  });

  if (drag && ghostTarget !== null) {
    var gt = findNode(ghostTarget);
    var dir = gt ? resolveDirection(drag.node, gt) : null;
    if (dir) drawArrow(svg, dir.p0, dir.tip, '#aaaaaa', '0.55', true);
  }
}

/* ============================================================================
   RESULTS PANEL: One renderer for every table
   ============================================================================
   Previously there was a card per output type, plus a separate Compare path.
   They rendered the same kinds of thing in slightly different ways and had to
   be kept in step by hand. Every result is now a table, so there is one
   function.                                                                   */

var DISPLAY_ROW_LIMIT = 50;
/* How many per-group tables the "summary + row lists" view will draw. Ten is
   more than a Compare has ever had and few enough that a breakdown by course
   stays a page rather than a download. */
var DISPLAY_CARD_LIMIT = 10;

function tableHTML(t, title, badge) {
  if (t.columns.length === 0) {
    return card(title, '<div class="cmp-empty">Nothing to show. This Output has no columns.</div>', badge);
  }

  var head = t.columns.map(function(c) {
    return '<th' + (c.type === COLTYPE.NUMBER ? ' class="cmp-num"' : '') + '>' + esc(c.label) + '</th>';
  }).join('');

  var body = t.rows.slice(0, DISPLAY_ROW_LIMIT).map(function(r) {
    return '<tr>' + t.columns.map(function(c, i) {
      var ttl = cellTitle(c, r[i]);
      var cls = c.type === COLTYPE.NUMBER ? 'cmp-num'
              : c.type === COLTYPE.COURSES ? 'cmp-num crs-cell' : '';
      return '<td' + (cls ? ' class="' + cls + '"' : '') +
        (ttl ? ' title="' + esc(ttl) + '"' : '') + '>' + esc(fmtCell(c, r[i])) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  var more = t.rows.length > DISPLAY_ROW_LIMIT
    ? '<tr><td colspan="' + t.columns.length + '" class="cmp-more">... ' +
      (t.rows.length - DISPLAY_ROW_LIMIT) + ' more. Copy and Save include every row</td></tr>'
    : '';

  var empty = t.rows.length === 0
    ? '<div class="cmp-empty">No rows match this query.</div>' : '';

  return card(title,
    '<div style="overflow-x:auto"><table class="rtable">' +
      '<thead><tr>' + head + '</tr></thead><tbody>' + body + more + '</tbody></table></div>' + empty,
    badge);
}

function card(title, body, badge) {
  return '<div class="result-card">' +
    '<div class="result-head">' + esc(title) +
      (badge ? ' <span class="result-badge">' + esc(badge) + '</span>' : '') + '</div>' +
    body +
  '</div>';
}

// A 1x1 result still reads better as a headline number than as a one-cell
// table, so scalars keep the large display. It is the same table underneath;
// only the presentation differs, and the export path never sees this.
function scalarHTML(t) {
  var c = t.columns[0], r = t.rows[0] || [];
  /* The mean of nothing is undefined, not zero. Printing "0" asserts something
     false about the data; an em dash says there was nothing to average.

     reduceValues() returns null for exactly that case, and now that any 1x1
     table reaches this renderer an aggregate over no rows arrives here rather
     than as a blank table cell. An empty headline is as uninformative as a
     wrong one, so the same em dash covers it. */
  var blank = r[0] === null || r[0] === undefined ||
              (c.key === 'average' && t.columns.length > 1 && Number(r[1]) === 0);
  var extra = t.columns.length > 1
    ? '<span class="big-sub">' + esc(t.columns[1].label + ': ' + fmtCell(t.columns[1], r[1])) + '</span>'
    : '';
  return '<div class="result-card">' +
    '<div class="result-head">' + esc(c.label) + '</div>' +
    '<div class="result-big"><span class="big-num">' + (blank ? '&mdash;' : esc(fmtCell(c, r[0]))) + '</span>' + extra + '</div>' +
  '</div>';
}

function resultHTML(node, r) {
  var show = normaliseShow(node);
  /* Already the view. The Output applied it during evaluation so that the table
     drawn here and the table a node wired after this Output receives are one
     table rather than two computations that have to be kept in agreement. */
  var t = r.table;

  if (show === 'count') return scalarHTML(t);

  if (show === 'summary' || show === 'lists') {
    /* Read off the view rather than off what arrived, which is the same object
       in these two views: outputTable() returns its input untouched for summary
       and lists, and they are the only views a branch table reaches. */
    var branches = (t.meta && t.meta.branches) || null;
    if (branches) {
      /* Compare-fed or SelectFor-fed: the summary first, then per-branch
         detail if asked for. The heading comes from the meta rather than
         being hardcoded, because "Comparison / 12 branches" over a breakdown
         by course names the node that did not produce it. Compare emits no
         title and keeps the wording it always had. */
      var bTitle = (r.table.meta && r.table.meta.title) || 'Comparison';
      var bUnit  = (r.table.meta && r.table.meta.unit)  ||
                   (branches.length === 1 ? 'branch' : 'branches');
      var html = tableHTML(t, bTitle, branches.length + ' ' + bUnit);
      if (show === 'lists') {
        /* Capped for the reason the rows inside each card are capped, one
           level up. A Compare has two or three branches and this never binds;
           a breakdown by course has seventy-eight groups, and rendering a
           table for each produced most of a megabyte of markup to show
           something nobody scrolls to. Copy and Save are unaffected. They
           write every group, which is where an answer that long belongs. */
        html += branches.slice(0, DISPLAY_CARD_LIMIT).map(function(b) {
          return '<div class="cmp-branch-card">' +
            tableHTML(b.table, b.label, String(b.table.rows.length)) + '</div>';
        }).join('');
        if (branches.length > DISPLAY_CARD_LIMIT) {
          html += '<div class="cmp-more-cards">... ' +
            (branches.length - DISPLAY_CARD_LIMIT) + ' more ' + bUnit +
            ' not shown. Copy and Save include every one</div>';
        }
      }
      return html;
    }
  }

  /* A single value is a single value however it was produced. Until now only
     the Output's own Count setting reached the headline display, so moving the
     same calculation onto the canvas (an Aggregate wired in front, which is
     exactly what removing the Output shortcuts told people to do) demoted the
     answer to a one-cell table. The rule is the shape of the result, not which
     control happened to produce it.

     Placed after the Compare branch above so a one-branch, one-measure summary
     still renders as the comparison it is. */
  if (t.columns.length === 1 && t.rows.length === 1) return scalarHTML(t);

  return tableHTML(t, 'Rows', String(t.rows.length));
}

/* SHOWING AN OUTPUT IN THE PANEL
   ---------------------------------------------------------------------------
   Now that a node can be wired after an Output, an Output is often a step
   rather than an answer: someone wanting the 2024 rows of a result wants that
   result narrowed, not the whole result and the narrowed one stacked above each
   other in the panel. The tick box lets an Output be a step without its block
   taking up the room an answer deserves.

   It is a property of the view and of nothing else. It changes no table, so it
   does not mark the run stale, and the blocks are drawn either way and then
   dressed out of sight, so turning one back on is a class on an element that is
   already there rather than another walk of the graph. */
function hiddenInPanel(node) {
  return !!(node.cfg && node.cfg.panel === false);
}

function outputNodes() {
  return nodes.filter(function(n){ return n.type === 'output'; });
}

/* Drawn always, shown only when nothing else is. A panel that sits empty after
   a run that succeeded reads as a tool that has failed, so it names the switch
   that emptied it rather than leaving the user to find the tick box again. */
function allHiddenNoteHTML(outs) {
  var allHidden = outs.length > 0 && outs.every(hiddenInPanel);
  return '<div class="all-hidden-note' + (allHidden ? '' : ' result-hidden') + '">' +
    'Every Output is hidden from this panel. Tick "Show in results panel" on an ' +
    'Output node to see its answer here.</div>';
}

function applyPanelVisibility() {
  var pb = document.getElementById('panelBody');
  if (!pb) return;
  outputNodes().forEach(function(n) {
    var el = pb.querySelector('[data-output="' + n.id + '"]');
    if (el) el.classList.toggle('result-hidden', hiddenInPanel(n));
  });
  var note = pb.querySelector('.all-hidden-note');
  if (note) {
    var outs = outputNodes();
    note.classList.toggle('result-hidden', !(outs.length > 0 && outs.every(hiddenInPanel)));
  }
}

function runQuery() {
  var srcNodes = nodes.filter(function(n){ return n.type === 'source'; });
  var outNodes = nodes.filter(function(n){ return n.type === 'output'; });

  if (srcNodes.length === 0) { showError('Add a Source node.'); return; }
  if (outNodes.length === 0) { showError('Add an Output node.'); return; }

  /* Checked before the topological sort rather than inside it, so that a graph
     whose Sources are all empty says so plainly instead of reporting whichever
     one the ordering happened to reach first. Every unloaded Source is named,
     because fixing one and re-running to be told about the next is a poor way
     to find out there were three. */
  var starved = srcNodes.filter(function(n){ return !hasSourceData(n); });
  if (starved.length) {
    showError(starved.length === 1
      ? sourceDataError(starved[0])
      : starved.length + ' Source nodes have no data: ' +
        starved.map(function(n){ return '#' + n.id; }).join(', ') +
        '. Open each one and load ' + DATA_HEADERS_NAME + ', then its year files.');
    return;
  }
  if (connections.length === 0) {
    showError('Drag nodes close together to connect them, then drop to confirm the connection.');
    return;
  }

  var ev = evaluateGraph();
  if (ev.error) { showError(ev.error); return; }

  exportData = {};
  var html = '';

  outNodes.forEach(function(onode, oi) {
    var r = ev.res[onode.id] || { table: makeTable([], []), log: [], hasSource: false };
    var body, actions = '';

    if (!r.hasSource) {
      body = '<div class="error-box">Not connected to a Source. This Output has no data path.</div>';
    } else {
      var show = normaliseShow(onode);
      /* Both of these are the evaluator's work now. The view was applied when
         the Output was evaluated, and the OUTPUT line was logged there too, so
         re-applying either here would count the rows of a count and print the
         step twice. */
      var t = r.table;
      var log = r.log;

      /* What ARRIVED at the Output, for the per-branch export. In the two views
         that carry branches it is the same table as the view, but asking the
         graph is honest where assuming they are equal is a fact that has to
         stay true. */
      var upIds = inputsOf(onode.id, primaryPort('output'));
      var upstream = upIds.length ? ev.res[upIds[0]] : null;

      exportData[onode.id] = {
        index: oi + 1,
        show: show,
        name: exportNameOf(onode, oi + 1),
        table: t,
        source: upstream ? upstream.table : t,
        log: log.map(logText)
      };

      body = '<div class="query-log">' + log.map(logHTML).join('\n') + '</div>' + resultHTML(onode, r);

      actions = '<div class="result-actions">' +
        exportNameHTML(onode, oi + 1) +
        '<button class="rbtn" onclick="copyOutput(' + onode.id + ',this)">Copy</button>' +
        '<button class="rbtn" onclick="saveOutput(' + onode.id + ',this)">Save</button>' +
      '</div>';
    }

    var showLabel = outNodes.length > 1;
    var head = (showLabel || actions)
      ? '<div class="result-block-head">' +
          (showLabel ? '<div class="result-block-label">Output ' + (oi + 1) + '</div>' : '<div></div>') +
          actions +
        '</div>'
      : '';
    html += '<div class="result-block' + (hiddenInPanel(onode) ? ' result-hidden' : '') +
      '" data-output="' + onode.id + '">' + head + body + '</div>';
  });

  html += allHiddenNoteHTML(outNodes);

  setOutput(html);
  resultsFresh = true;
}

/* EXPORT FILE NAME
   Sits next to Copy and Save because that is where it is used. The value is
   still stored on the node, so it travels with a saved query: The model owns
   it, only the control moved.

   Editing it must NOT mark the results stale. The name has no bearing on what
   was computed, and invalidating the run would leave the user unable to press
   the very Save button they were naming the file for. */
function defaultExportName(index) { return 'output' + index; }

function exportNameOf(node, index) {
  var v = node.cfg && node.cfg.filename;
  return (v && String(v).trim()) ? String(v).trim() : defaultExportName(index);
}

function exportNameHTML(node, index) {
  return '<label class="export-name" ' +
    'title="File name for Save. Leave blank to use the default.">' +
    '<input type="text" spellcheck="false" ' +
      'placeholder="' + esc(defaultExportName(index)) + '" ' +
      'value="' + esc((node.cfg && node.cfg.filename) || '') + '" ' +
      'data-export-name="' + node.id + '">' +
    '<span class="export-ext">.csv</span>' +
  '</label>';
}

/* Delegated on the results panel, which is rebuilt on every run. Per-element
   listeners would be re-attached each time and leak. */
function onExportNameInput(e) {
  var el = e.target;
  if (!el || !el.getAttribute) return;
  var id = el.getAttribute('data-export-name');
  if (!id) return;
  var node = findNode(parseInt(id, 10));
  if (!node) return;
  node.cfg = node.cfg || defaultCfg(node.type);
  node.cfg.filename = el.value;
  var entry = exportData[node.id];
  if (entry) entry.name = exportNameOf(node, entry.index);
  // No markStale() here, by design. See the note above.
}

/* ============================================================================
   EXPORT: One serialiser, because there is one data shape
   ============================================================================ */

function markStale() {
  if (!resultsFresh) return;
  resultsFresh = false;
  var pb = document.getElementById('panelBody');
  if (!pb || !pb.querySelector('.result-block')) return;
  pb.classList.add('stale');
  if (!pb.querySelector('.stale-note')) {
    var note = document.createElement('div');
    note.className = 'stale-note';
    note.textContent = 'These results are from an earlier version of the graph. Re-run the query.';
    pb.insertBefore(note, pb.firstChild);
  }
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/* Today, as the one date format this tool writes. Its own function because two
   things want it and only one of them wants the time with it: a suggested name
   is read by a person, and the minute it was suggested is noise to them. */
function dateStamp() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function timeStamp(fileSafe) {
  var d = new Date();
  var time = pad2(d.getHours()) + (fileSafe ? '' : ':') + pad2(d.getMinutes());
  return dateStamp() + (fileSafe ? '-' : ' ') + time;
}

function csvCell(v) {
  var s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// The whole export layer, for every result shape the tool can produce.
function serialiseTable(t, sep, quote) {
  var cell = quote ? csvCell : function(v){ return String(v); };
  return [t.columns.map(function(c){ return cell(c.label); }).join(sep)]
    .concat(t.rows.map(function(r) {
      return t.columns.map(function(c, i){ return cell(exportCell(c, r[i])); }).join(sep);
    }))
    .join('\n');
}

// Compare with per-branch detail exports long: one row per branch row, branch
// name prepended. That is the shape a pivot table wants.
function exportTableFor(e) {
  var branches = e.source && e.source.meta && e.source.meta.branches;
  /* Only the "Summary + row lists" view exports long. The test used to be
     "branches exist and the view is not the summary", which was the same thing
     while branch metadata could only reach an Output across a direct wire from
     a Compare. The two views available there are exactly summary and lists.

     It stopped being the same thing when Compare was allowed to feed the row
     nodes. Sort and Take carry meta through, quite correctly, so a
     Compare -> Take(1) -> Output showed one row on screen and exported every
     row of every branch: the export silently ignored the Take. Naming the one
     view that means "long" keeps the two in step whatever arrives. */
  if (!branches || e.show !== 'lists') return e.table;

  var per = branches.map(function(b) {
    return { label: b.label, t: b.table };
  }).filter(function(x){ return x.t.columns.length; });
  if (!per.length) return e.table;

  // Branches reach a Compare independently, so two of them can carry different
  // headers (one student stream, one enrolment stream). Stacking those would
  // emit rows whose cells do not line up with the header. Only branches
  // matching the first are included; the summary still counts all of them.
  var want = schemaKey(per[0].t);
  per = per.filter(function(x){ return schemaKey(x.t) === want; });

  var cols = [{ key:'branch', label:'Branch', type:COLTYPE.TEXT }].concat(per[0].t.columns);
  var rows = [];
  per.forEach(function(x) {
    x.t.rows.forEach(function(r){ rows.push([x.label].concat(r)); });
  });
  return makeTable(cols, rows);
}

/* Strip path separators and characters Windows rejects, collapse whitespace,
   then trim the separators back off the ends. Otherwise a name made entirely
   of slashes sanitises to a lone "-" rather than falling back. */
/* The fallback is a parameter because the two things this names have different
   right answers: a results export is an "output", a saved graph is a "query".
   Existing callers pass one argument and keep the original default. */
function safeName(s, fallback) {
  var out = String(s).trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || fallback || 'output';
}

function flashBtn(btn, msg) {
  if (!btn) return;
  if (btn._orig === undefined) btn._orig = btn.textContent;
  btn.textContent = msg;
  btn.classList.add('rbtn-done');
  clearTimeout(btn._t);
  btn._t = setTimeout(function() {
    btn.textContent = btn._orig;
    btn.classList.remove('rbtn-done');
  }, 1500);
}

// execCommand fallback. Navigator.clipboard needs a secure context, which is
// not guaranteed when the page is opened straight off the filesystem.
function legacyCopy(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (err) { return false; }
}

function writeClipboard(text, btn) {
  function done(ok) { flashBtn(btn, ok ? 'Copied ✓' : 'Copy failed'); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function(){ done(true); },
                                            function(){ done(legacyCopy(text)); });
  } else {
    done(legacyCopy(text));
  }
}

/* WRITING A FILE FROM A PAGE THAT IS NOT BEING SERVED.

   This tool is opened from a file:// URL with no build step, and that makes
   saving harder than it looks. Three separate things went wrong here, and the
   first two fixes each traded one failure for another:

   1. The anchor was removed and the object URL revoked 1s after .click().
      WebKit starts a download asynchronously and reads the blob AFTER the
      handler returns, so a revoke on a timer is a race against the browser.
      Losing it produces exactly "WebKitBlobResource error 1" on a blob:null
      URL:  The blob is not missing because the origin is opaque, it is missing
      because we threw it away while WebKit was still fetching it.

   2. Swapping the blob for a data: URI avoided the race but introduced a size
      ceiling. A saved query is 2-10KB and rode under it; a CSV export of a year
      file is ~320KB, and ~460KB once percent-encoded into a URL. That is why
      Save Query worked and Save CSV did not. The same code, told to carry
      fifty times as much.

   3. A CSV announced as text/csv is something Safari knows how to display, so
      it displays it: the tab fills with rows and no file is written. WebKit
      weighs its own idea of the type against the download attribute and wins.

   So: a blob, which has no size ceiling and does not inflate; typed as
   application/octet-stream, which leaves nothing to render, so a download is
   the only thing left to do with the bytes; and torn down long after the click
   rather than in a race with it. The 40 second delay is what FileSaver.js
   settled on for the same reason.

   Nothing downstream reads that type. The extension on the download attribute
   decides the file on disk and what opens it, and that is still .csv. */
var FORCE_DOWNLOAD_TYPE = 'application/octet-stream';
var DOWNLOAD_TEARDOWN_MS = 40000;

function downloadFile(name, content) {
  try {
    var url = URL.createObjectURL(new Blob([content], { type: FORCE_DOWNLOAD_TYPE }));
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    /* Both the anchor and the URL outlive the click, because the download that
       reads them has not necessarily started yet. */
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, DOWNLOAD_TEARDOWN_MS);
    return true;
  } catch (err) { return false; }
}

// Shared guard: the payload must exist and still match the graph that made it
function exportEntry(id, btn) {
  var e = exportData[id];
  if (!e || !resultsFresh) { flashBtn(btn, 'Re-run first'); return null; }
  return e;
}

function copyOutput(id, btn) {
  var e = exportEntry(id, btn);
  if (e) writeClipboard(serialiseTable(exportTableFor(e), '\t', false), btn);
}

/* The name written is the name typed, with nothing appended. A timestamp used
   to be added for uniqueness, which meant the field never actually decided the
   filename. Two saves of "grades" produced two differently-named files, and
   the user who had just named the file could not predict what they would get.
   Re-saving now overwrites, or is de-duplicated by the browser, which is what
   every other download on the machine does.

   This also makes the two export paths agree: queryFileName() already writes a
   typed name verbatim and reserves the timestamp for the *default* name, where
   it is a convenience rather than an override. defaultExportName() plays that
   role here. Different Outputs still get distinct names without one. */
function saveOutput(id, btn) {
  var e = exportEntry(id, btn);
  if (!e) return;
  var name = safeName(e.name) + '.csv';
  flashBtn(btn, downloadFile(name, serialiseTable(exportTableFor(e), ',', true))
    ? 'Saved ✓' : 'Save failed');
}

function showError(msg) {
  exportData = {};
  resultsFresh = false;
  setOutput('<div class="error-box">' + esc(msg) + '</div>');
}
function setOutput(html) {
  var pb = document.getElementById('panelBody');
  pb.classList.remove('stale');
  pb.innerHTML = html;
}

/* ============================================================================
   SAVE / LOAD
   ============================================================================
   A query is an artefact you keep and re-run against next year's data, not
   something you rebuild each session. That is why this matters: the saved file
   describes the query, never the results, so loading it and pressing Run
   re-evaluates against whatever the dataset now contains.

   This was impossible before the config moved into the model. Scraping values
   out of the DOM meant an unrendered panel was indistinguishable from an unset
   one, so there was no complete picture of the graph to write down.           */

/* Version 2 adds the `port` field to each connection. Version 1 files still
   load: the loader resolves a missing port to the target's primary input, which
   is what a version 1 wire meant when every node had exactly one. The guard
   below only refuses files from a *newer* tool, so the format widened without
   breaking anything already written. */
/* Version 3 adds `dataset` to a Source's config: the NAMES of the files it was
   given, never their contents. Version 1 and 2 files still load. A Source with
   no dataset key gets the empty one from defaultCfg() and simply asks for its
   files without being able to name them. The guard below still only refuses
   files from a newer tool. */
var FILE_VERSION = 3;
var FILE_KIND = 'student-data-analyser-query';

function serialiseGraph() {
  return {
    kind: FILE_KIND,
    version: FILE_VERSION,
    savedAt: new Date().toISOString(),
    // Positions are part of the query: a saved graph should open looking like
    // the one that was saved, not re-scattered at random.
    nodes: nodes.map(function(n) {
      return { id:n.id, type:n.type, x:n.x, y:n.y, color:n.color, cfg:n.cfg };
    }),
    connections: connections.map(function(c) {
      return { from:c.from, to:c.to, port:c.port, color:c.color };
    })
  };
}

/* NAMING A SAVED QUERY
   ---------------------------------------------------------------------------
   A saved query is kept and re-opened, so the name is how it is found again
   months later. A timestamp alone does not say whether the file is the grade
   histogram or the migration analysis, and renaming afterwards in the file
   manager is a step nobody takes.

   The extension is not the user's to choose. It is decided by the format, and
   the loader below refuses anything else, so offering it as editable text would
   let someone type a name the tool then declines to open. It is therefore shown
   beside the field but sits outside the input. The same treatment the CSV
   export name already uses, so the two read as the same kind of control.

   A name typed with ".json" already on the end is accepted and the duplicate
   dropped, because a user who types the extension is not making a mistake, and
   "query.json.json" would be a poor way of telling them so. */
var QUERY_EXT = '.json';

/* "untitled" rather than "query", because this name is only ever reached by
   someone who did not give one. Every file this tool writes is a query, so
   naming one of them "query" says nothing about it; "untitled" says the one
   thing that is actually true, which is that it still needs a name. Used for
   both destinations: the file on disk and the card in the library. */
function defaultQueryName() { return 'untitled-' + dateStamp(); }

/* Typed text to written filename. Two things happen on the way: the extension
   is stripped if present so it can be re-added exactly once, and the rest goes
   through the same sanitiser as every other file this tool writes. A name is
   a name whether it came from a config field or a dialog. */
/* Repeated, not once: someone correcting a name by hand can leave
   "report.json.json" behind, and the intent is plainly one extension. Its own
   function because the hint below has to strip identically. Two copies of this
   rule would drift, and the symptom would be a hint that fires on names it
   should not. */
function stripQueryExt(s) {
  return String(s == null ? '' : s).trim().replace(/(\.json)+$/i, '');
}

function queryFileName(raw) {
  return safeName(stripQueryExt(raw), defaultQueryName()) + QUERY_EXT;
}

// Which toolbar button opened the dialog, so its confirmation flashes on the
// control the user actually pressed rather than somewhere in the dialog that is
// about to disappear.
var saveDialogBtn = null;

/* The name last saved under, this session only. Never persisted. Save, adjust
   the graph, save again is the ordinary loop, and it almost always wants the
   same name; offering a fresh timestamp each time would leave a folder of
   near-identical files distinguishable only by the minute they were written.
   Cancelling does not set it, so a name is only remembered once it named
   something. */
var lastQueryName = '';

function saveDialogEl()  { return document.getElementById('saveDialog'); }
function saveNameInput() { return document.getElementById('saveName'); }
function saveDialogOpen() {
  var d = saveDialogEl();
  return !!(d && d.classList.contains('open'));
}

function saveGraph(btn) {
  if (nodes.length === 0) { flashBtn(btn, 'Nothing to save'); return; }
  openSaveDialog(btn);
}

function openSaveDialog(btn) {
  var d = saveDialogEl(), input = saveNameInput();
  // If the markup is absent: An older page, or a headless harness that loaded
  // the script alone. Saving still works, it just uses the default name. A
  // missing dialog should not cost the user their query.
  if (!d || !input) { writeQueryFile(defaultQueryName() + QUERY_EXT, btn); return; }

  saveDialogBtn = btn || null;
  saveLibPending = '';
  input.value = lastQueryName || defaultQueryName();
  // The placeholder is always the timestamp, because that is what an empty
  // field actually writes. Clearing the box should show its own result, not
  // repeat the name being cleared.
  input.placeholder = defaultQueryName();
  updateSaveHint();
  d.classList.add('open');
  input.focus();
  // Selected rather than merely focused: the suggestion is a fallback, not a
  // prefix to type after, so the common case is one keystroke replacing it.
  input.select();
}

function closeSaveDialog() {
  var d = saveDialogEl();
  if (d) d.classList.remove('open');
  var btn = saveDialogBtn;
  saveDialogBtn = null;
  // Focus goes back where it came from; leaving it on a hidden input strands
  // the keyboard user with no visible caret.
  if (btn && btn.focus) btn.focus();
}

/* Sanitising is silent everywhere else in the tool, which is fine when the name
   is typed inches from the file it names. Here the file is written and gone, so
   a name that changed on the way out is worth one line, and only then, since
   restating an unchanged name is noise. */
function updateSaveHint() {
  var input = saveNameInput(), hint = document.getElementById('saveHint');
  if (!input || !hint) return;
  var typed = stripQueryExt(input.value);
  var name = queryFileName(input.value);
  var changed = !!typed && name !== typed + QUERY_EXT;
  hint.textContent = changed ? 'Saves as ' + name : '';
  hint.classList.toggle('show', changed);
  // This line is shared with the library's errors, so taking it back means
  // dropping their colour too, not only their text.
  hint.classList.remove('bad');
}

function confirmSaveGraph() {
  var input = saveNameInput();
  var name = queryFileName(input ? input.value : '');
  var btn = saveDialogBtn;
  // Stored without the extension, which is how the field shows it.
  lastQueryName = name.replace(/\.json$/i, '');
  closeSaveDialog();
  writeQueryFile(name, btn);
}

/* THE SECOND DESTINATION
   ---------------------------------------------------------------------------
   The same dialog, the same name, somewhere else to put it. Two buttons rather
   than a mode to be chosen first: there is no state the user has to get right
   before typing, and neither destination is hidden behind the other.

   The library is reached from two places — here, and the grid's own footer —
   because "save this" and "put this in the library" are two different thoughts
   and a user arrives holding one or the other. Both end up in libAdd(), which
   is where the refusals live.                                                */

/* A clash is answered on the button, the way the grid answers one: press again
   to replace. Cleared whenever the name changes, because the question was
   about a particular name and the answer cannot outlive it. */
var saveLibPending = '';

/* The hint line doubles as the dialog's error line. Written directly rather
   than through updateSaveHint(), which has its own thing to say; typing in the
   field calls that one and takes the line back, which is the right moment for
   a message about the name that has just been changed to disappear. */
function saveHintSay(text) {
  var hint = document.getElementById('saveHint');
  if (!hint) return;
  hint.textContent = text || '';
  hint.classList.toggle('show', !!text);
  hint.classList.toggle('bad', !!text);
}

function confirmSaveToLibrary(btn) {
  /* The extension is stripped even though the library does not use one. The
     field is shared with the file path and shows ".json" beside it, so a user
     who types "grades.json" here has said the name is "grades" — carrying the
     suffix onto a card would be reading the chip back at them. Everything
     after that is libName's: a card's name is not a filename and keeps its
     punctuation. */
  var input = saveNameInput();
  var name = libName(stripQueryExt(input ? input.value : '')) || defaultQueryName();
  var again = saveLibPending === name.toLowerCase();

  var r = libAdd(name, { replace: again });
  saveLibPending = '';

  if (r.conflict) {
    saveLibPending = name.toLowerCase();
    saveHintSay('"' + r.conflict.name + '" is already in the library. ' +
                'Press Save to library again to replace it.');
    flashBtn(btn, 'Replace?');
    return;
  }
  if (!r.ok) { saveHintSay(r.error.message); flashBtn(btn, 'Save failed'); return; }

  var opener = saveDialogBtn;
  lastQueryName = name;
  closeSaveDialog();
  // On the toolbar button that opened the dialog, since the dialog has gone.
  flashBtn(opener, 'Saved ✓');
}

// The write itself, with the emptiness check repeated: the graph can be cleared
// between opening the dialog and confirming it.
function writeQueryFile(name, btn) {
  if (nodes.length === 0) { flashBtn(btn, 'Nothing to save'); return; }
  var json = JSON.stringify(serialiseGraph(), null, 2);
  flashBtn(btn, downloadFile(name, json) ? 'Saved ✓' : 'Save failed');
}

/* Validation is deliberately forgiving about detail and strict about structure.
   A file with an unknown node type or an edge to a node that no longer exists
   is repaired by dropping the offending part, because a query that loads with
   three of its four nodes is more useful than a refusal. A file that is not a
   query at all is rejected outright. */
function deserialiseGraph(raw) {
  var d;
  try { d = JSON.parse(raw); }
  catch (err) { return { error: 'That file isn\'t valid JSON.' }; }

  if (!d || d.kind !== FILE_KIND) {
    return { error: 'That doesn\'t look like a saved query from this tool.' };
  }
  if (typeof d.version !== 'number' || d.version > FILE_VERSION) {
    return { error: 'That query was saved by a newer version of this tool.' };
  }
  if (!Array.isArray(d.nodes) || !Array.isArray(d.connections)) {
    return { error: 'That query file is missing its nodes or connections.' };
  }

  var warnings = [];
  var seen = {};
  var loadedNodes = [];

  d.nodes.forEach(function(n) {
    if (!n || !CONNECT_RULES[n.type]) { warnings.push('unknown node type'); return; }
    var id = parseInt(n.id, 10);
    if (isNaN(id) || seen[id]) { warnings.push('duplicate node id'); return; }
    seen[id] = true;
    loadedNodes.push({
      id: id,
      type: n.type,
      x: Number(n.x) || 0,
      y: Number(n.y) || 0,
      color: n.color || EDGE_PALETTE[0],
      // Merge over the defaults so a file written before a config key existed
      // still loads, with the new key at its default rather than undefined.
      cfg: mergeCfg(defaultCfg(n.type), n.cfg)
    });
  });

  /* Ports are resolved rather than trusted. A version 1 file predates them and
     names none, so every wire lands on the target's primary port, which is
     what those files meant, since there was only one input to land on.

     The arity rule is applied here as well as at the point of wiring, because a
     version 1 file may contain the very thing ports were introduced to prevent:
     two wires into one ordinary node, relying on the implicit merge. Loading
     such a file keeps the first wire and drops the rest with a warning, rather
     than quietly evaluating only one of them or reviving a union that no longer
     exists. Dropping is the honest repair: the query said "merge these", the
     tool no longer does that implicitly, and the user is told so. */
  var loadedConns = [];
  var filled = {};   // nodeId:port -> true, for single-arity ports already taken

  d.connections.forEach(function(c) {
    if (!c) return;
    var from = parseInt(c.from, 10), to = parseInt(c.to, 10);
    var a = loadedNodes.filter(function(n){ return n.id === from; })[0];
    var b = loadedNodes.filter(function(n){ return n.id === to; })[0];
    if (!a || !b) { warnings.push('connection to a missing node'); return; }
    if (!canConnect(a.type, b.type)) { warnings.push('connection breaking the wiring rules'); return; }

    var port = normalisePort(b.type, c.port);
    var def = portDef(b.type, port);
    if (!def) { warnings.push('connection to a node that takes no input'); return; }

    if (loadedConns.some(function(x) {
      return x.from === from && x.to === to && x.port === port;
    })) return;

    var slot = to + ':' + port;
    if (!def.multi && filled[slot]) {
      warnings.push('a second wire into a single input, so wire a Combine if you meant to merge');
      return;
    }
    filled[slot] = true;

    loadedConns.push({ from:from, to:to, port:port, color: c.color || EDGE_PALETTE[0] });
  });

  return { nodes: loadedNodes, connections: loadedConns, warnings: warnings };
}

// Shallow merge is enough: cfg is one level deep apart from criteria and labels,
// and both of those are replaced wholesale when present.
function mergeCfg(base, saved) {
  if (!saved || typeof saved !== 'object') return base;
  var wantsCriteria = Object.prototype.hasOwnProperty.call(base, 'criteria');
  Object.keys(saved).forEach(function(k) { base[k] = saved[k]; });

  // Scalar settings are read straight into HTML attributes and comparisons, so
  // a file supplying an object or array where a string belongs is coerced
  // rather than trusted.
  ['pop','show','filename','sort','by','labelCol'].forEach(function(k) {
    if (base[k] !== undefined && typeof base[k] !== 'string') {
      base[k] = (base[k] === null || typeof base[k] === 'object') ? '' : String(base[k]);
    }
  });
  if (base.labels === null || typeof base.labels !== 'object' || Array.isArray(base.labels)) {
    if (Object.prototype.hasOwnProperty.call(base, 'labels')) base.labels = {};
  }
  if (Object.prototype.hasOwnProperty.call(base, 'measures') && !Array.isArray(base.measures)) {
    base.measures = DEFAULT_MEASURES.slice();
  }
  /* SelectFor's measures, which are objects rather than Compare's strings.
     The reason they are not both called `measures`. Every element is rebuilt
     from a fresh default rather than patched in place, so a file supplying a
     number, a string or a nested object where {op, col} belongs cannot put a
     value into the model that the panel would then read into an attribute.
     op and col are both resolved against the live table at render and at
     evaluation anyway, so an unrecognised one falls back rather than breaking.
     This guard only has to guarantee the SHAPE. */
  if (Object.prototype.hasOwnProperty.call(base, 'stats')) {
    var rawStats = Array.isArray(base.stats) ? base.stats : [];
    base.stats = rawStats.slice(0, 20).map(function(x) {
      var st = newStat();
      if (x && typeof x === 'object' && !Array.isArray(x)) {
        if (typeof x.op === 'string')  st.op  = x.op;
        if (typeof x.col === 'string') st.col = x.col;
      }
      return st;
    });
    if (!base.stats.length) base.stats = [newStat()];
  }
  /* The dataset descriptor is a name and a list of years and nothing else. It
     is read straight back into the panel's markup, so a file supplying an
     object where the name belongs, or 2000 fabricated years, is normalised here
     rather than trusted. Years are coerced to integers in the admitted range;
     the header name is length-capped and stripped of any path, exactly as
     dataFileName() would do to a real one. NOTHING in this key is ever used to
     find or read a file (the user picks those), so the worst a hostile value
     can do is misdescribe itself in one line of the panel. */
  if (Object.prototype.hasOwnProperty.call(base, 'dataset')) {
    var ds = base.dataset;
    if (!ds || typeof ds !== 'object' || Array.isArray(ds)) ds = {};
    var hname = typeof ds.headers === 'string' ? ds.headers.split(/[\\/]/).pop() : '';
    base.dataset = {
      headers: hname.slice(0, 120),
      years: (Array.isArray(ds.years) ? ds.years : [])
        .map(function(y){ return parseInt(y, 10); })
        .filter(function(y, i, a) {
          return !isNaN(y) && y >= DATA_YEAR_MIN && y <= DATA_YEAR_MAX && a.indexOf(y) === i;
        })
        .slice(0, 50)
        .sort(function(a, b){ return a - b; })
    };
  }

  /* null is the meaningful default ("keep everything"), so only a value that is
     neither null nor an array of keys is rejected. Non-string entries are
     dropped rather than coerced: a column key is compared against real header
     keys, and "[object Object]" can never match one. */
  if (Object.prototype.hasOwnProperty.call(base, 'cols')) {
    base.cols = Array.isArray(base.cols)
      ? base.cols.filter(function(k){ return typeof k === 'string'; })
      : null;
    if (base.cols && !base.cols.length) base.cols = null;
  }

  // Only filter nodes carry criteria: A file that attaches them to an Output
  // must not have them normalised into existence there.
  if (wantsCriteria) {
    base.criteria = (Array.isArray(base.criteria) ? base.criteria : []).map(function(c) {
      var n = newCriterion();
      if (c && typeof c === 'object') {
        if (c.field) n.field = c.field;
        if (c.course) n.course = c.course;
        if (c.values && typeof c.values === 'object') n.values = c.values;
        if (c.ops && typeof c.ops === 'object') n.ops = c.ops;
      }
      return n;
    });
    if (!base.criteria.length) base.criteria = [newCriterion()];
  }
  return base;
}

function applyGraph(g) {
  /* The data goes. Every Source in the new graph starts with nothing loaded,
     including one whose id happens to match a Source that was loaded a moment
     ago. Matching ids across two unrelated files is a coincidence, not a
     grant, and silently handing the new graph the old graph's student records
     would be the worst possible reading of it.

     This is the behaviour the feature was asked for: the query is restored, the
     files are asked for again. */
  clearAllSourceData();

  nodes = g.nodes;
  connections = g.connections;
  // Keep the counter clear of every id in the file, so a node added after a
  // load cannot collide with one that came from it.
  idCtr = nodes.reduce(function(m, n){ return Math.max(m, n.id); }, 0);
  edgeColorIndex = nodes.length;
  exportData = {};
  resultsFresh = false;
  selection = [];
  cancelPreviewTimer();
  hidePreview();
  render();
  /* Fit after loading rather than restoring a saved zoom. A file carries the
     graph, not the view (which is why the format did not have to change for
     any of this), and a query written on one screen should open framed for
     whatever screen opens it. render() has to run first: fitting measures node
     heights off the DOM, and those do not exist until the nodes do. */
  zoomToFit();
}

function loadGraphFromText(raw, btn) {
  var g = deserialiseGraph(raw);
  if (g.error) { showError(g.error); flashBtn(btn, 'Load failed'); return false; }
  applyGraph(g);

  var msg = 'Loaded ' + g.nodes.length + ' node' + (g.nodes.length === 1 ? '' : 's') +
    ' and ' + g.connections.length + ' connection' + (g.connections.length === 1 ? '' : 's') + '.';

  /* The data did not come with it, and saying so here is the difference between
     a user who knows what to do next and one who presses Run and reads an
     error. The files the query was built against are named where the file named
     them, because picking the right ones out of a folder is the task. */
  var srcs = g.nodes.filter(function(n){ return n.type === 'source'; });
  if (srcs.length) {
    var wanted = {};
    srcs.forEach(function(n) {
      var d = n.cfg && n.cfg.dataset;
      if (d && d.headers) wanted[d.headers] = true;
      if (d && d.years) d.years.forEach(function(y){ wanted['mcs-students-' + y] = true; });
    });
    var names = Object.keys(wanted);
    msg += ' The data is not saved with a query, so load the files again on ' +
      (srcs.length === 1 ? 'the Source' : 'each Source') + '.';
    if (names.length) msg += ' This one was built against ' + names.join(', ') + '.';
  }
  if (g.warnings.length) {
    msg += ' Skipped ' + g.warnings.length + ' item' + (g.warnings.length === 1 ? '' : 's') +
      ' that no longer fit the graph: ' + g.warnings.filter(function(w, i, a){ return a.indexOf(w) === i; }).join(', ') + '.';
  }
  setOutput('<div class="placeholder">' + esc(msg) + ' Press Run Query to evaluate it.</div>');
  flashBtn(btn, 'Loaded ✓');
  return true;
}

function openGraphFile(btn) {
  var input = document.getElementById('loadFile');
  if (!input) return;
  // Reset first, or choosing the same file twice in a row fires no change event
  input.value = '';
  input._btn = btn;
  input.click();
}

/* A saved query is a few kilobytes; a large one with a hundred nodes is still
   well under a megabyte. The cap is far above anything this tool writes and far
   below anything that would hang the tab, so it only ever catches a file that
   was never a query to begin with. */
var MAX_QUERY_FILE_BYTES = 8 * 1024 * 1024;

/* Two checks before a byte is read, both about failing early and specifically.
   Neither is the last line of defence (deserialiseGraph still rejects anything
   that is not a query file), but by the time that runs the tool has read an
   arbitrary file into memory and can only report that the contents were wrong,
   which is a poor description of choosing the wrong file. */
function graphFileProblem(file) {
  // `accept` on the input filters the picker; it does not bind. Every browser
  // offers "All files", and a file can be dragged in or renamed. So the rule
  // lives here, where the file is actually taken.
  if (!/\.json$/i.test(file.name)) {
    return 'Only .json query files can be opened, and "' + file.name + '" is not one.';
  }
  if (file.size > MAX_QUERY_FILE_BYTES) {
    return 'That file is far too large to be a saved query, so it has not been read.';
  }
  if (file.size === 0) {
    return 'That file is empty.';
  }
  return null;
}

function onGraphFileChosen(e) {
  var input = e.target;
  var file = input.files && input.files[0];
  if (!file) return;
  var btn = input._btn;

  var problem = graphFileProblem(file);
  if (problem) { showError(problem); flashBtn(btn, 'Load failed'); return; }

  var reader = new FileReader();
  reader.onload = function() {
    // Opening a query, changing it and saving it back should offer the name it
    // arrived under, rather than silently proposing a second file beside it.
    if (loadGraphFromText(String(reader.result), btn)) {
      lastQueryName = stripQueryExt(file.name);
    }
  };
  reader.onerror = function(){ showError('Could not read that file.'); flashBtn(btn, 'Load failed'); };
  reader.readAsText(file);
}

/* ============================================================================
   THE QUERY LIBRARY: THE STORE
   ============================================================================
   Save and Load above write and read a file. The library keeps the same queries
   in the browser instead, so a query built once is one click away next term
   rather than something to go and find in a folder.

   WHAT IS STORED IS THE FILE FORMAT, UNCHANGED.

   An entry's `graph` is exactly what serialiseGraph() writes and exactly what
   deserialiseGraph() reads, byte for byte. That is the whole design, and it is
   worth being explicit about why, because a store with its own shape would have
   been easy to write and wrong:

     - the guarantee that a saved query carries the NAMES of the data files and
       never their contents is a property of serialiseGraph(), asserted in
       07-saveload. A second way of writing a query down is a second place for
       student records to escape to, and the one that nobody would think to
       check is the one in browser storage that never appears as a file;
     - the version guard, the port resolution, the repair of a graph whose node
       types have since changed — all of it lives in deserialiseGraph(), and all
       of it applies just as much to an entry saved last year as to a file. Two
       implementations would drift, and the drift would show up as a query that
       opens from a file but not from the library.

   So loading an entry goes back out through the same door it came in:
   JSON.stringify the graph and hand it to loadGraphFromText(). Re-serialising
   something that was just parsed looks wasteful and is: a few kilobytes and a
   millisecond, in exchange for there being exactly one loader.

   WHAT THIS IS NOT. It is not a backup and must never be described as one.
   Clearing site data removes it, a private window never sees it, and it does
   not travel to another machine or another browser. That is what Export is for.
   It is also not private on a shared staff machine: storage belongs to the
   browser profile, not to the person sitting at it.                          */

var LIB_STORE       = 'sda.library.v1';
var LIB_KIND        = 'student-data-analyser-library';
var LIB_VERSION     = 1;
var LIB_NAME_MAX    = 80;
var LIB_MAX_ENTRIES = 200;

/* Failing to remember the panel width is a minor loss, and the guards around
   those reads say so by returning silently. Failing to save a query is not: the
   user has just spent twenty minutes building it and pressed a button that says
   Save. So every failure here comes back as a code and a sentence for the UI to
   show, rather than being swallowed.

     nostore     the browser refuses storage entirely. A private window, or
                 file:// with site data blocked. The property access throws
                 rather than returning null, which is why it is inside the try
     unreadable  something is in the slot but it is not JSON
     alien       it is JSON, but not this tool's library
     newer       written by a later version of this tool than this one
     full        the library is at its entry ceiling
     quota       the browser will not accept any more bytes
     empty       there is no graph on the canvas to save
     missing     the entry asked for is not there any more                    */
function libError(code, message) { return { code: code, message: message }; }

var LIB_MESSAGES = {
  nostore:    'This browser is not letting the page store anything, so the library is unavailable. ' +
              'A private window does this. Save the query as a file instead.',
  unreadable: 'The saved library could not be read, so it has not been opened. ' +
              'Nothing has been overwritten.',
  alien:      'Something other than this tool\'s library is stored under its name, ' +
              'so it has not been opened. Nothing has been overwritten.',
  newer:      'The saved library was written by a newer version of this tool.',
  full:       'The library already holds ' + LIB_MAX_ENTRIES + ' queries. ' +
              'Delete one, or export the library and start a fresh one.',
  quota:      'There is no room left in this browser to save another query. ' +
              'Export the library, then delete the queries you no longer need.',
  empty:      'There is nothing on the canvas to save.',
  missing:    'That query is no longer in the library.'
};

function libFail(code) { return { ok: false, error: libError(code, LIB_MESSAGES[code]) }; }

/* Quota is reported differently by every engine, and none of them do it the way
   the specification suggests. WebKit throws a plain QuotaExceededError, Firefox
   has historically used its own name, and the legacy numeric codes are still
   what some versions set. Checked in that order so a browser that gets it right
   costs nothing. */
function libIsQuota(e) {
  if (!e) return false;
  return e.name === 'QuotaExceededError' ||
         e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
         e.code === 22 || e.code === 1014;
}

/* Ids are generated rather than counted, because the counter would have to live
   in the store and a store that has just failed to be read cannot supply one.
   Time first so they sort roughly by age when read by a human; the random tail
   because two saves in the same millisecond are possible and a collision would
   silently overwrite a different query. */
function libNewId() {
  return 'q' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/* A library name is NOT a file name, and deliberately does not go through
   safeName(). "Semester 1: withdrawals" is a perfectly good thing to call a
   query and a poor thing to call a file, and there is no file here to protect:
   the name is shown on a card and nowhere else. safeName() applies at the one
   point where a name does become a file, which is Export.

   What is done is the part that is about the card rather than the filesystem:
   runs of whitespace collapse so two names cannot look identical and compare
   differently, and the length is capped so one query cannot push every other
   card off its row. Escaping happens at render, like everywhere else. */
function libName(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, LIB_NAME_MAX);
}

/* Read the whole store, every time, rather than keeping it in a variable.

   Two windows open on the same tool is an ordinary thing to do — one to build a
   query, one to check an old one — and they share the storage. A copy held in
   memory goes stale the moment the other window saves, and writing that stale
   copy back would delete whatever the other window had just added, with no
   error and nothing to notice. Re-reading costs a parse of a few kilobytes. */
function libRead() {
  var raw = null;
  try { raw = window.localStorage.getItem(LIB_STORE); }
  catch (e) { return { entries: [], error: libError('nostore', LIB_MESSAGES.nostore) }; }

  if (!raw) return { entries: [], error: null };

  var d;
  try { d = JSON.parse(raw); }
  catch (e) { return { entries: [], error: libError('unreadable', LIB_MESSAGES.unreadable) }; }

  if (!d || typeof d !== 'object' || d.kind !== LIB_KIND) {
    return { entries: [], error: libError('alien', LIB_MESSAGES.alien) };
  }
  if (typeof d.version !== 'number' || d.version > LIB_VERSION) {
    return { entries: [], error: libError('newer', LIB_MESSAGES.newer) };
  }

  /* Entries are validated on the way out, not trusted. Storage is editable by
     hand, survives versions of this tool that have not been written yet, and is
     the one input here that arrives with no file picker in front of it.

     An entry is dropped rather than repaired, which is the opposite of what
     deserialiseGraph() does to a graph, and for a reason: a graph with a broken
     edge is still recognisably the query somebody built, while an entry with no
     usable graph is not a saved query at all and there is nothing in it to
     keep. The graph itself is NOT validated here beyond its kind — that is
     deserialiseGraph()'s job and it happens when the entry is opened, so a
     query that can no longer be loaded still appears on its card and can still
     be exported, rather than vanishing from the library without explanation. */
  var seen = {};
  var entries = [];
  (Array.isArray(d.entries) ? d.entries : []).forEach(function(raw) {
    if (entries.length >= LIB_MAX_ENTRIES) return;
    var e = libCleanEntry(raw, null);
    if (!e || seen[e.id]) return;
    seen[e.id] = true;
    entries.push(e);
  });

  return { entries: entries, error: null };
}

function libWrite(entries) {
  var payload = JSON.stringify({
    kind: LIB_KIND, version: LIB_VERSION, entries: entries
  });
  try { window.localStorage.setItem(LIB_STORE, payload); }
  catch (e) { return libFail(libIsQuota(e) ? 'quota' : 'nostore'); }
  return { ok: true, error: null };
}

// What the library occupies, for the line under the grid. Measured off the
// stored text rather than summed from the entries, so it is the number that
// actually counts against the browser's ceiling.
function libBytes() {
  var raw = null;
  try { raw = window.localStorage.getItem(LIB_STORE); } catch (e) { return 0; }
  return raw ? raw.length * 2 : 0;
}

function libIndexOf(entries, id) {
  for (var i = 0; i < entries.length; i++) if (entries[i].id === id) return i;
  return -1;
}

function libGet(id) {
  var st = libRead();
  var i = libIndexOf(st.entries, id);
  return i === -1 ? null : st.entries[i];
}

/* Case-insensitive, because two cards reading "Grade histogram" and "grade
   histogram" are two cards the user will read as the same query. */
function libNameTaken(entries, name, exceptId) {
  var want = libName(name).toLowerCase();
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].id === exceptId) continue;
    if (entries[i].name.toLowerCase() === want) return entries[i];
  }
  return null;
}

// The current canvas as an entry. The graph comes from serialiseGraph() and is
// not touched on the way in.
function libEntryFor(name) {
  return {
    id: libNewId(),
    name: libName(name) || defaultQueryName(),
    savedAt: new Date().toISOString(),
    graph: serialiseGraph()
  };
}

/* Save the canvas into the library.

   Refuses rather than overwrites in two places, and both are about not
   destroying work that cannot be got back:

     - if the store could not be READ, nothing is written. A write here would
       replace a library that is merely unreadable by this code with one holding
       a single query, and whatever was in there — possibly a term's work,
       possibly recoverable by hand from the browser's storage inspector — would
       be gone. The caller is told which problem it was and can offer to start a
       new library deliberately, with `replaceStore`;
     - a name that is already taken comes back as a `conflict` rather than
       silently replacing that entry. Overwrite is the right default for a FILE,
       where the user picked a folder and the browser tells them the name is in
       use; here there is nothing between the button and the loss.            */
function libAdd(name, opts) {
  opts = opts || {};
  if (!nodes.length) return libFail('empty');

  var st = libRead();
  if (st.error && !(opts.replaceStore && st.error.code !== 'nostore')) {
    return { ok: false, error: st.error };
  }

  var entries = st.error ? [] : st.entries;
  var entry = libEntryFor(name);
  var idx = opts.replaceId ? libIndexOf(entries, opts.replaceId) : -1;

  if (idx === -1) {
    var clash = libNameTaken(entries, entry.name);
    if (clash && !opts.replace) return { ok: false, error: null, conflict: clash };
    if (clash) idx = libIndexOf(entries, clash.id);
  }

  if (idx === -1) {
    if (entries.length >= LIB_MAX_ENTRIES) return libFail('full');
    // Newest first: the query just saved is the one most likely to be wanted
    // back, and it should not be at the bottom of a grid of two hundred.
    entries.unshift(entry);
  } else {
    // Replacing keeps the entry's id and its place in the grid, so a card the
    // user has just re-saved does not jump to the front and change identity
    // underneath anything holding on to it.
    entry.id = entries[idx].id;
    entries[idx] = entry;
  }

  var w = libWrite(entries);
  return w.ok ? { ok: true, error: null, entry: entry } : w;
}

function libRename(id, name) {
  var st = libRead();
  if (st.error) return { ok: false, error: st.error };
  var i = libIndexOf(st.entries, id);
  if (i === -1) return libFail('missing');

  var wanted = libName(name);
  if (!wanted) return { ok: true, error: null, entry: st.entries[i] };   // no change
  var clash = libNameTaken(st.entries, wanted, id);
  if (clash) return { ok: false, error: null, conflict: clash };

  st.entries[i].name = wanted;
  var w = libWrite(st.entries);
  return w.ok ? { ok: true, error: null, entry: st.entries[i] } : w;
}

function libRemove(id) {
  var st = libRead();
  if (st.error) return { ok: false, error: st.error };
  var i = libIndexOf(st.entries, id);
  if (i === -1) return libFail('missing');
  var gone = st.entries.splice(i, 1)[0];
  var w = libWrite(st.entries);
  return w.ok ? { ok: true, error: null, entry: gone } : w;
}

/* ----------------------------------------------------------- EXPORT / IMPORT

   The library lives in one browser on one machine, which makes a file the only
   way a query gets to a colleague, to a laptop, or through a cleared cache.
   There is no separate exchange format for that: an exported library is the
   stored object, and a single exported card is the query file Save has always
   written. A format invented for sharing would be a third thing to keep in
   step with the other two.                                                   */

var MAX_LIB_FILE_BYTES = 8 * 1024 * 1024;

/* One entry, cleaned. Shared by the store's read and the importer, because the
   two are asking the same question — is this an entry — of inputs that are
   equally untrusted. Storage can be edited by hand; a file arrived from
   somewhere else entirely.

   `forceId` is how the importer mints a new id for every entry it takes, and
   it does two jobs at once: it cannot collide with an id already in the
   library, and it means an id out of the file is never used for anything. A
   card's buttons carry its id inline, so that closes the injection route for
   the import path completely rather than relying on the pattern test below. */
function libCleanEntry(e, forceId) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;

  var g = e.graph;
  if (!g || typeof g !== 'object' || Array.isArray(g) || g.kind !== FILE_KIND) return null;

  var id = forceId ||
    (typeof e.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(e.id) ? e.id : null);
  if (!id) return null;

  return {
    id: id,
    name: libName(e.name) || '(unnamed)',
    savedAt: typeof e.savedAt === 'string' ? e.savedAt : '',
    graph: g
  };
}

// The whole library as one object, which is exactly what is stored plus a note
// of when it left. Anything that reads it ignores the extra key.
function libExportPayload(entries) {
  return JSON.stringify({
    kind: LIB_KIND,
    version: LIB_VERSION,
    exportedAt: new Date().toISOString(),
    entries: entries
  }, null, 2);
}

/* Import MERGES, and never replaces.

   The alternative — a file overwriting the library — is one click between a
   colleague's set of standard queries and a term of somebody's own work. So an
   entry whose name is already in the library is left alone and counted, and the
   user is told exactly what happened rather than being asked to trust a
   silence. Somebody who wants the incoming version renames theirs and imports
   again, which is two deliberate steps instead of one irreversible one.

   Imported entries go on the END. Saving puts a new query at the front because
   that is the one wanted back; importing twenty should not bury the query that
   was saved this morning under somebody else's. */
function libImportText(raw, fallbackName) {
  var d;
  try { d = JSON.parse(raw); }
  catch (e) {
    return { ok: false, error: libError('badfile', 'That file isn\'t valid JSON.') };
  }

  var incoming;
  if (d && d.kind === LIB_KIND) {
    if (typeof d.version !== 'number' || d.version > LIB_VERSION) {
      return { ok: false, error: libError('newer',
        'That library was exported by a newer version of this tool.') };
    }
    incoming = Array.isArray(d.entries) ? d.entries : [];
  } else if (d && d.kind === FILE_KIND) {
    /* A single saved query, handed to Import rather than to Load. Generous on
       purpose: the two files look identical in a folder, both end in .json, and
       refusing on a technicality would be the tool being right about something
       nobody asked. It becomes a one-entry library named after the file. */
    incoming = [{ name: fallbackName, savedAt: d.savedAt, graph: d }];
  } else {
    return { ok: false, error: libError('badfile',
      'That doesn\'t look like a library or a saved query from this tool.') };
  }

  var st = libRead();
  // Same refusal as libAdd's, for the same reason: a merge into a library that
  // could not be read would write a new one over it.
  if (st.error) return { ok: false, error: st.error };

  var entries = st.entries;
  var added = 0, skipped = 0, dropped = 0, overflow = 0;

  incoming.forEach(function(rawEntry) {
    var e = libCleanEntry(rawEntry, libNewId());
    if (!e) { dropped++; return; }
    if (libNameTaken(entries, e.name)) { skipped++; return; }
    if (entries.length >= LIB_MAX_ENTRIES) { overflow++; return; }
    entries.push(e);
    added++;
  });

  var out = { ok: true, error: null, added: added, skipped: skipped,
              dropped: dropped, overflow: overflow };
  if (!added) return out;

  var w = libWrite(entries);
  // All or nothing: one setItem carries the whole library, so a write that does
  // not fit leaves the library exactly as it was rather than half-merged.
  if (!w.ok) return w;
  return out;
}

/* What happened, as a sentence. Built here rather than in the dialog because
   every number in it is a decision this function made, and a count reported
   without its reason ("2 skipped") is a count the user cannot act on. */
function libImportSummary(r) {
  if (!r.added && !r.skipped && !r.dropped && !r.overflow) {
    return 'That file held no saved queries.';
  }
  var bits = [];
  bits.push(r.added === 1 ? 'Added 1 query.' : 'Added ' + r.added + ' queries.');
  if (r.skipped) {
    bits.push(r.skipped + (r.skipped === 1 ? ' was' : ' were') +
      ' already in the library under the same name and ' +
      (r.skipped === 1 ? 'was' : 'were') + ' left alone.');
  }
  if (r.overflow) {
    bits.push(r.overflow + ' did not fit: the library holds ' + LIB_MAX_ENTRIES + '.');
  }
  if (r.dropped) {
    bits.push(r.dropped + (r.dropped === 1 ? ' was' : ' were') + ' not a saved query.');
  }
  return bits.join(' ');
}

/* The two checks a file gets before a byte of it is read, the same pair and in
   the same order as a picked query file gets. Neither is the last line of
   defence — libImportText refuses anything that is not a library — but by the
   time that runs an arbitrary file is in memory and all it can report is that
   the contents were wrong, which is a poor description of picking the wrong
   file out of a folder. */
function libFileProblem(file) {
  if (!/\.json$/i.test(file.name)) {
    return 'Only .json files can be imported, and "' + file.name + '" is not one.';
  }
  if (file.size > MAX_LIB_FILE_BYTES) {
    return 'That file is far too large to be a library, so it has not been read.';
  }
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/* An entry as the loader wants it. The round trip through text is the point
   rather than an oversight: see the note at the top of this section. Loading is
   wired up with the rest of the library UI, which needs a confirmation in front
   of it — a grid of one-click cards replaces the canvas far more easily than a
   two-step file picker does, and applyGraph() has no undo. */
function libGraphText(id) {
  var e = libGet(id);
  return e ? JSON.stringify(e.graph) : null;
}

/* ============================================================================
   THE QUERY LIBRARY: THE PICTURE ON THE CARD
   ============================================================================
   A name alone does not tell you which query you are looking at. "2024 grades"
   and "2024 grades by degree" are the same line of text and two different
   shapes, and the shape is what the user built and what they remember.

   DRAWN FROM THE GRAPH, NEVER CAPTURED FROM THE SCREEN.

   The obvious implementation is a screenshot of the canvas, and it is wrong
   here for four separate reasons, the first of which would be a defect:

     1. A screenshot can contain student records. The results panel holds rows,
        an edge-preview tooltip holds rows, and a Source panel names files. The
        whole point of the save format is that a stored query carries the
        QUESTION and never the ANSWER — 07-saveload asserts it, 31-library
        asserts it again — and a picture of the screen walks straight past that
        guarantee into the same browser storage, where nobody would think to
        look for it. A diagram drawn from `nodes` and `connections` cannot
        contain a record, because it never sees one.
     2. It does not work in Safari, which is what opens this file on a Mac.
        Rasterising DOM means <foreignObject> into a canvas, and WebKit taints
        the canvas when it does, so toDataURL() throws SecurityError.
     3. It cannot be tested here. jsdom has no 2D context, so a PNG path would
        need the `canvas` package — a native build, in a project that has no
        build step on purpose. An SVG is a string.
     4. It is fifty times the size. A saved query is 2-10KB and a 320x170 PNG
        is 30-80KB, against a storage ceiling of about 5MB. The difference is a
        library that holds hundreds and one that holds dozens.

   NOTHING IS STORED. The picture is a pure function of the graph, so it is
   drawn when the grid renders and thrown away with it. That removes the
   storage cost, and it removes an injection route with it: a library file from
   somewhere else can carry a name, but it cannot carry markup to be injected,
   because no markup of its is ever kept or read back.

   THE GEOMETRY IS THE CANVAS'S OWN. shapeExit() and shapeEntry() are pure
   functions of a node's type and position, so the card calls the same ones the
   canvas does and the arrows leave and land in the same places. A second copy
   of that arithmetic would drift, and the symptom would be a thumbnail that
   quietly stopped resembling the query.                                      */

var LIB_THUMB_W = 320;
var LIB_THUMB_H = 170;
var LIB_THUMB_PAD = 12;

/* Far more nodes than any real query, and low enough that a hand-edited store
   claiming ten thousand cannot spend a second building one card's markup. */
var LIB_THUMB_MAX_NODES = 60;

/* THE FIFTH WAY A NODE'S APPEARANCE CAN DISAGREE WITH ITSELF.

   A node is already described in four places that have to stay in step — SHAPE,
   the size rule, the family colour rule and the menu group — and 17-shape-
   styling exists because two of them drifted twice. This palette is a fifth,
   and it is the one with no screen to catch it: a node drawn in the wrong
   colour here appears only on a card in a dialog, next to other cards that look
   plausible. So it is held to the stylesheet by a test in that suite rather
   than by anyone remembering, and a new node that is not named here fails it.

   Border and fill, which is what a shape at this size is: the text colour is
   the border's lighter partner and is read off the same family. */
var LIB_INK = {
  source:           { line: '#2d6640', fill: '#071510', text: '#5ec87a' },
  filter:           { line: '#7a4a18', fill: '#110900', text: '#f0944a' },
  output:           { line: '#1e7fff', fill: '#051830', text: '#3db8ff' },
  sort:             { line: '#5a3a7a', fill: '#120a1a', text: '#b48ce0' },
  reverse:          { line: '#5a3a7a', fill: '#120a1a', text: '#b48ce0' },
  take:             { line: '#5a3a7a', fill: '#120a1a', text: '#b48ce0' },
  unique:           { line: '#5a3a7a', fill: '#120a1a', text: '#b48ce0' },
  select:           { line: '#5a3a7a', fill: '#120a1a', text: '#b48ce0' },
  project:          { line: '#4a6a1e', fill: '#0d1405', text: '#a8d050' },
  aggregate:        { line: '#1f6a6a', fill: '#041416', text: '#5ac8c8' },
  aggregateColumns: { line: '#1f6a6a', fill: '#041416', text: '#5ac8c8' },
  aggregateRows:    { line: '#1f6a6a', fill: '#041416', text: '#5ac8c8' },
  combine:          { line: '#7a2f52', fill: '#170a11', text: '#e089ae' },
  compare:          { line: '#7a2f52', fill: '#170a11', text: '#e089ae' },
  selectFor:        { line: '#3a4a8a', fill: '#090c18', text: '#8fa8f0' },
  histogram:        { line: '#3a4a8a', fill: '#090c18', text: '#8fa8f0' }
};

var LIB_INK_UNKNOWN = { line: '#3a3a3a', fill: '#101010', text: '#8a8a8a' };
function libInk(type) { return LIB_INK[type] || LIB_INK_UNKNOWN; }

/* The corner the stylesheet gives each shape: a circle for the Source, the
   Output's generous 10px, and 3px for everything else. Expressed as a radius in
   world units so it scales with the rest. */
function libRadius(type) { return type === 'output' ? 10 : 3; }

// Where the shape sits inside its NODE_W-wide slot, which is what shapeExit()
// and shapeEntry() measure from. SHAPE describes the head only, and the head is
// all a thumbnail draws: the config panel below it is not part of the picture.
function libShapeBox(n) {
  var s = SHAPE[n.type];
  return { x: n.x + (NODE_W - s.w) / 2, y: n.y, w: s.w, h: s.h };
}

/* The nodes worth drawing, with their positions coerced.

   A stored graph is not a trusted input: it survives versions of this tool that
   do not exist yet and it can be edited by hand. A node whose type this tool no
   longer has cannot be sized and is skipped; an `x` that arrives as a string or
   as null would otherwise put NaN into a coordinate, and one NaN in an SVG path
   is a blank card rather than a wrong one. */
function libThumbNodes(graph) {
  var out = [];
  var ns = (graph && Array.isArray(graph.nodes)) ? graph.nodes : [];
  for (var i = 0; i < ns.length && out.length < LIB_THUMB_MAX_NODES; i++) {
    var n = ns[i];
    if (!n || !SHAPE[n.type]) continue;
    out.push({ id: n.id, type: n.type, x: Number(n.x) || 0, y: Number(n.y) || 0 });
  }
  return out;
}

function libR1(v) { return Math.round(v * 10) / 10; }

/* A small filled triangle at the tip, pointing the way the wire runs. The
   canvas draws its own arrowheads the same way and for the same reason: a line
   between two boxes says they are connected, and an arrow says which way the
   rows travel, which is the half a reader actually needs. */
function libArrowHead(x0, y0, x1, y1) {
  var a = Math.atan2(y1 - y0, x1 - x0);
  var back = 5.5, wide = 2.8;
  var bx = x1 - Math.cos(a) * back, by = y1 - Math.sin(a) * back;
  var nx = -Math.sin(a) * wide, ny = Math.cos(a) * wide;
  return 'M' + libR1(x1) + ' ' + libR1(y1) +
         'L' + libR1(bx + nx) + ' ' + libR1(by + ny) +
         'L' + libR1(bx - nx) + ' ' + libR1(by - ny) + 'Z';
}

/* The card's picture, as SVG markup.

   Every string that reaches the output is either a number this function
   computed or a value out of NODE_LABELS, which is a table in this file. No
   part of a stored entry is written into the markup — not its name, not its
   config, not a filename. That is worth stating because it is what makes it
   safe to inject the result with innerHTML, and because it is also a privacy
   property: a Filter can legitimately hold a typed value that identifies a
   person, and a picture that renders config text would put it on a card in a
   dialog somebody is showing on a projector. The card shows what KIND of node
   it is and nothing else. */
function libThumb(graph) {
  var head = '<svg class="lib-thumb-svg" viewBox="0 0 ' + LIB_THUMB_W + ' ' + LIB_THUMB_H +
             '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" ' +
             'preserveAspectRatio="xMidYMid meet">';
  var ns = libThumbNodes(graph);

  if (!ns.length) {
    /* An entry with nothing drawable: a graph of node types this tool has
       dropped, or one saved by a version that names them differently. The card
       still exists, so it can be exported or deleted, and says why it is
       blank rather than showing an empty frame. */
    return head + '<text x="' + (LIB_THUMB_W / 2) + '" y="' + (LIB_THUMB_H / 2) +
           '" fill="#5a5a5a" font-size="11" text-anchor="middle" ' +
           'dominant-baseline="middle">nothing this version can draw</text></svg>';
  }

  var b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  ns.forEach(function(n) {
    var r = libShapeBox(n);
    b.x1 = Math.min(b.x1, r.x);          b.y1 = Math.min(b.y1, r.y);
    b.x2 = Math.max(b.x2, r.x + r.w);    b.y2 = Math.max(b.y2, r.y + r.h);
  });
  var bw = Math.max(1, b.x2 - b.x1), bh = Math.max(1, b.y2 - b.y1);

  /* Capped at 1, the way zoomToFit is, and for a reason that matters more on a
     grid than on a canvas: a node is then the same size on every card, so its
     size means "a node" rather than "a small query". Blown up to fill the
     frame, a two-node query and a twenty-node one would look equally busy. */
  var z = Math.min((LIB_THUMB_W - 2 * LIB_THUMB_PAD) / bw,
                   (LIB_THUMB_H - 2 * LIB_THUMB_PAD) / bh, 1);
  var ox = (LIB_THUMB_W - bw * z) / 2 - b.x1 * z;
  var oy = (LIB_THUMB_H - bh * z) / 2 - b.y1 * z;
  function px(v) { return libR1(v * z + ox); }
  function py(v) { return libR1(v * z + oy); }

  var byId = {};
  ns.forEach(function(n) { byId[n.id] = n; });

  /* Wires first, so a shape always sits on top of the line entering it. The
     port is resolved exactly as the loader resolves it, so a version 1 entry —
     which names no ports at all — draws its wires where opening it would put
     them, rather than defaulting to somewhere else. */
  var wires = '';
  var cs = (graph && Array.isArray(graph.connections)) ? graph.connections : [];
  cs.forEach(function(c) {
    if (!c) return;
    var a = byId[c.from], d = byId[c.to];
    if (!a || !d) return;
    var p0 = shapeExit(a);
    var p1 = shapeEntry(d, normalisePort(d.type, c.port));
    var x0 = px(p0.x), y0 = py(p0.y), x1 = px(p1.x), y1 = py(p1.y);
    wires += '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y1 +
             '" stroke="#4a4a4a" stroke-width="1.2"/>' +
             '<path d="' + libArrowHead(x0, y0, x1, y1) + '" fill="#4a4a4a"/>';
  });

  var shapes = '', labels = '';
  ns.forEach(function(n) {
    var r = libShapeBox(n), ink = libInk(n.type);
    var x = px(r.x), y = py(r.y), w = libR1(r.w * z), h = libR1(r.h * z);

    if (n.type === 'source') {
      shapes += '<ellipse cx="' + libR1(x + w / 2) + '" cy="' + libR1(y + h / 2) +
                '" rx="' + libR1(w / 2) + '" ry="' + libR1(h / 2) + '"';
    } else {
      shapes += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
                '" rx="' + libR1(libRadius(n.type) * z) + '"';
    }
    shapes += ' fill="' + ink.fill + '" stroke="' + ink.line + '" stroke-width="1.5"/>';

    /* The label, fitted rather than guessed at. `textLength` makes the browser
       condense the glyphs to exactly the width given, so "Agg. Columns" and
       "Take" both sit inside their shape at any zoom and neither spills over
       the edge of a neighbouring node. Sizing the font to fit instead would
       mean measuring text, which is the one thing this cannot do: the markup
       is built before it is in a document, and in the test harness there is no
       layout at all.

       Below about thirty pixels the letters stop being letters, so the label is
       dropped and the diagram reads by colour and arrangement, which at that
       size is all anyone is reading anyway. */
    if (w >= 30) {
      var fs = libR1(Math.max(5, Math.min(9, h * 0.22)));
      labels += '<text x="' + libR1(x + w / 2) + '" y="' + libR1(y + h / 2) +
                '" textLength="' + libR1(w * 0.76) + '" lengthAdjust="spacingAndGlyphs"' +
                ' fill="' + ink.text + '" font-size="' + fs + '"' +
                ' font-family="system-ui, sans-serif" font-weight="700"' +
                ' text-anchor="middle" dominant-baseline="central">' +
                esc(String(NODE_LABELS[n.type] || n.type).toUpperCase()) + '</text>';
    }
  });

  return head + wires + shapes + labels + '</svg>';
}

/* ============================================================================
   THE QUERY LIBRARY: THE DIALOG
   ============================================================================
   A grid of cards over the canvas, built the way Help and the save dialog are:
   static markup in the page, inline handlers, and one `open` class. A third
   mechanism for raising a card over the canvas would be a third thing to keep
   in step with the Escape handling and the shortcut suppression below.

   TWO-STEP CONFIRMATION RATHER THAN A SECOND DIALOG.

   Two actions here cannot be taken back: opening a query replaces the canvas,
   and deleting one removes the only copy. Both are a single click on a card in
   a grid, which is a far easier thing to hit by accident than the two-step file
   picker Load has always been — that is the cost of making the library
   convenient, and it has to be paid back somewhere.

   The usual answer is a confirmation dialog, and it is the wrong one here: it
   would be a modal over a modal, with its own focus to trap and return, over a
   grid that is itself scrollable. So the button asks instead. The first click
   turns Open into "Replace canvas?" and Delete into "Confirm deletion?", and the
   second does it. The question names what happens rather than asking whether
   the user is sure, and it is on the control they pressed, where they are
   already looking.

   Opening skips the question when the canvas is empty, because there is then
   nothing to replace and a question with only one sensible answer teaches
   people to click through questions.                                         */

var LIB_SEARCH_MIN = 6;     // cards, below which the search box is pointless

// Which control opened it, so focus goes back there. Same as helpOpener.
var libOpener = null;
// The card being renamed, and the one whose destructive button is half-pressed.
var libRenaming = null;
var libPending = null;      // { action: 'open' | 'delete' | 'replace', id }
var libQuery = '';          // the search box's text
var libNotice = null;       // { tone: 'ok' | 'bad', text } shown under the header

function libDialogEl() { return document.getElementById('libDialog'); }
function libraryOpen() {
  var d = libDialogEl();
  return !!(d && d.classList.contains('open'));
}

function openLibrary(btn) {
  var d = libDialogEl();
  if (!d) return;
  libOpener = btn || null;
  // Every half-pressed button and half-typed rename from last time is dropped.
  // A dialog that reopens mid-question is a dialog that answers it by accident.
  libPending = null;
  libRenaming = null;
  libNotice = null;
  libQuery = '';
  var s = document.getElementById('libSearch');
  if (s) s.value = '';

  /* The name field arrives filled, with the name this query already answers to
     — the one it was opened under, or the one it was last saved under — and a
     timestamp only when it has never had one. Same reasoning as the save
     dialog's: the ordinary loop is save, adjust, save again, and offering a
     fresh timestamp each time leaves a grid of near-identical cards told apart
     only by the minute they were written. */
  var nm = document.getElementById('libSaveName');
  if (nm) {
    nm.value = nodes.length ? libSuggestName() : '';
    nm.placeholder = defaultQueryName();
  }
  var save = document.getElementById('libSaveBtn');
  if (save) save.disabled = !nodes.length;

  d.classList.add('open');
  renderLibrary();
  var body = document.getElementById('libBody');
  if (body) { body.setAttribute('tabindex', '-1'); body.focus(); }
}

function closeLibrary() {
  var d = libDialogEl();
  if (d) d.classList.remove('open');
  libPending = null;
  libRenaming = null;
  // Focus leaves with the dialog. Left on a button inside a hidden card it
  // belongs to nothing on screen, and the keyboard user has no caret and no
  // working shortcuts.
  var btn = libOpener;
  libOpener = null;
  if (btn && btn.focus) btn.focus();
}

function libSay(tone, text) { libNotice = text ? { tone: tone, text: text } : null; }

/* Whatever a card's date means to the person reading it. Formatted in the
   browser's own locale rather than the tool's, because this is the one string
   here that is about their calendar rather than about the query. */
function libWhen(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    return ' · ' + d.toLocaleDateString(undefined,
      { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return ''; }
}

function libSizeText(bytes) {
  if (!bytes) return 'nothing stored yet';
  return bytes < 1024 ? bytes + ' bytes'
       : bytes < 1024 * 1024 ? Math.round(bytes / 1024) + ' KB'
       : (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function libMatches(e, q) {
  return !q || e.name.toLowerCase().indexOf(q) !== -1;
}

/* A card. Everything out of the entry is escaped; everything out of libThumb()
   is markup this file generated from a fixed table and is not. */
function libCardHTML(e) {
  var pendOpen = !!(libPending && libPending.action === 'open'   && libPending.id === e.id);
  var pendDel  = !!(libPending && libPending.action === 'delete' && libPending.id === e.id);
  var n = (e.graph && Array.isArray(e.graph.nodes)) ? e.graph.nodes.length : 0;
  var id = e.id;   // constrained to [A-Za-z0-9_-] by libRead, so attribute-safe

  return '<div class="lib-card' + (pendDel ? ' danger' : '') + '">' +
    '<div class="lib-thumb">' + libThumb(e.graph) + '</div>' +
    '<div class="lib-meta">' +
      (libRenaming === id
        ? '<input class="lib-rename" id="libRenameInput" type="text" value="' + esc(e.name) +
          '" spellcheck="false" autocomplete="off" aria-label="Query name" ' +
          'maxlength="' + LIB_NAME_MAX + '" ' +
          'onkeydown="libRenameKey(event, \'' + id + '\')" ' +
          'onblur="libCommitRename(\'' + id + '\')">'
        : '<div class="lib-name" title="' + esc(e.name) + '">' + esc(e.name) + '</div>') +
      '<div class="lib-sub">' + n + ' node' + (n === 1 ? '' : 's') + esc(libWhen(e.savedAt)) + '</div>' +
    '</div>' +
    '<div class="lib-actions">' +
      '<button class="lib-go" onclick="libOpenEntry(\'' + id + '\', this)" ' +
        'title="Put this query on the canvas">' +
        (pendOpen ? 'Replace canvas?' : 'Open') + '</button>' +
      '<button class="file-btn" onclick="libStartRename(\'' + id + '\')">Rename</button>' +
      '<button class="file-btn" onclick="libExportEntry(\'' + id + '\', this)" ' +
        'title="Write this query out as a .json file">Export</button>' +
      '<button class="lib-del" onclick="libDeleteEntry(\'' + id + '\', this)">' +
        (pendDel ? 'Confirm deletion?' : 'Delete') + '</button>' +
    '</div>' +
  '</div>';
}

/* A store that could not be read is a screen of its own rather than an empty
   grid, because "you have no saved queries" and "your saved queries could not
   be opened" are opposite things to be told and look identical as an empty
   grid. The offer to start again is deliberately a button and not automatic:
   see libAdd, which refuses the same write for the same reason. */
function libProblemHTML(err) {
  var canReplace = err.code === 'unreadable' || err.code === 'alien' || err.code === 'newer';
  return '<div class="lib-problem">' +
    '<div class="lib-problem-text">' + esc(err.message) + '</div>' +
    (canReplace
      ? '<button class="lib-del" onclick="libStartOver(this)">Start a new library</button>' +
        '<div class="lib-problem-warn">This throws away whatever is stored under ' +
        esc(LIB_STORE) + '. If those queries matter, copy that value out of the ' +
        'browser\'s storage inspector first.</div>'
      : '') +
  '</div>';
}

function renderLibrary() {
  var body = document.getElementById('libBody');
  if (!body) return;

  var st = libRead();
  var head = document.getElementById('libNotice');
  if (head) {
    head.className = 'lib-notice' + (libNotice ? ' show ' + libNotice.tone : '');
    head.textContent = libNotice ? libNotice.text : '';
  }

  var foot = document.getElementById('libUsage');
  if (foot) {
    foot.textContent = st.error ? ''
      : st.entries.length + ' of ' + LIB_MAX_ENTRIES + ' · ' + libSizeText(libBytes());
  }

  var search = document.getElementById('libSearchWrap');
  if (search) search.classList.toggle('show', !st.error && st.entries.length >= LIB_SEARCH_MIN);

  if (st.error) { body.innerHTML = libProblemHTML(st.error); return; }

  /* An empty library says nothing. The dialog's own heading paragraph already
     explains what the library is for, and the name field and Save button sit
     in plain sight at the foot, so a second block of prose in the middle was
     repeating the two things around it. */
  if (!st.entries.length) { body.innerHTML = ''; return; }

  var q = libQuery.trim().toLowerCase();
  var shown = st.entries.filter(function(e) { return libMatches(e, q); });
  if (!shown.length) {
    body.innerHTML = '<div class="lib-empty">No saved query is called anything like ' +
      '"' + esc(libQuery.trim()) + '".</div>';
    return;
  }
  body.innerHTML = '<div class="lib-grid">' +
    shown.map(libCardHTML).join('') + '</div>';

  // A rename renders as an input and is meant to be typed into immediately.
  var ren = document.getElementById('libRenameInput');
  if (ren) { ren.focus(); ren.select(); }
}

function libSearchInput(el) {
  libQuery = el ? el.value : '';
  // Any half-pressed button is dropped: the card it belonged to may not even
  // be on screen after the filter changes, and a question nobody can see is a
  // question that gets answered by the next click somewhere else.
  libPending = null;
  renderLibrary();
}

/* ------------------------------------------------------------------ opening */

function libOpenEntry(id, btn) {
  var text = libGraphText(id);
  if (text === null) { libSay('bad', LIB_MESSAGES.missing); renderLibrary(); return; }

  // The question, once, and only when there is something to lose.
  if (nodes.length && !(libPending && libPending.action === 'open' && libPending.id === id)) {
    libPending = { action: 'open', id: id };
    libSay(null, '');
    renderLibrary();
    return;
  }

  libPending = null;
  /* Through the same loader a picked file goes through, which is what makes the
     version guard, the port resolution and the repair apply here without being
     written twice. It reports into the results panel behind this dialog, so the
     dialog closes first and the user is left looking at what it said. */
  var entry = libGet(id);
  closeLibrary();
  if (loadGraphFromText(text, btn) && entry) lastQueryName = entry.name;
}

/* ----------------------------------------------------------------- renaming */

function libStartRename(id) {
  libPending = null;
  libRenaming = id;
  renderLibrary();
}

function libCancelRename() {
  if (libRenaming === null) return;
  libRenaming = null;
  renderLibrary();
}

/* Enter commits, Escape abandons. Escape is handled here rather than left to
   the document handler because that one closes the dialog, and abandoning a
   rename should not also shut the library: the key means "never mind about
   this", and the smallest thing it can mean that is what it should mean. */
function libRenameKey(e, id) {
  if (e.key === 'Enter')  { e.preventDefault(); e.target.blur(); }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    // Cleared first so the blur this causes does not commit what was typed.
    libRenaming = null;
    e.target.blur();
    renderLibrary();
  }
}

function libCommitRename(id) {
  if (libRenaming !== id) return;          // already abandoned by Escape
  var input = document.getElementById('libRenameInput');
  var wanted = input ? input.value : '';
  libRenaming = null;

  var r = libRename(id, wanted);
  if (r.conflict) libSay('bad', 'Another query is already called "' + r.conflict.name + '".');
  else if (!r.ok) libSay('bad', r.error.message);
  renderLibrary();
}

/* ----------------------------------------------------------------- deleting */

function libDeleteEntry(id, btn) {
  if (!(libPending && libPending.action === 'delete' && libPending.id === id)) {
    libPending = { action: 'delete', id: id };
    libSay(null, '');
    renderLibrary();
    return;
  }
  libPending = null;
  var r = libRemove(id);
  libSay(r.ok ? 'ok' : 'bad',
         r.ok ? 'Deleted "' + r.entry.name + '".' : r.error.message);
  renderLibrary();
}

/* Only reachable from the problem screen, and only after its warning. This is
   the one place the tool throws away a store it could not read, and it is a
   deliberate act each time rather than a preference that could be left on. */
function libStartOver(btn) {
  try { window.localStorage.removeItem(LIB_STORE); }
  catch (e) { libSay('bad', LIB_MESSAGES.nostore); renderLibrary(); return; }
  libSay('ok', 'Started a new library.');
  renderLibrary();
}

/* ---------------------------------------------------------------- exporting */

/* One card out as a .json file, in the format Load already reads. Sharing a
   query with a colleague is this button and an email: there is no separate
   exchange format, because the query file has been one all along.

   safeName() applies HERE and not to the library name itself. On a card the
   name is text and a colon is fine; the moment it becomes a filename it is the
   filesystem's problem, which is exactly the distinction queryFileName() draws
   for the save dialog. */
function libExportEntry(id, btn) {
  libPending = null;
  var e = libGet(id);
  if (!e) { libSay('bad', LIB_MESSAGES.missing); renderLibrary(); return; }
  var ok = downloadFile(queryFileName(e.name), JSON.stringify(e.graph, null, 2));
  flashBtn(btn, ok ? 'Saved ✓' : 'Save failed');
}

/* ------------------------------------------------- EXPORTING THE WHOLE THING

   The only thing here that survives a cleared browser, a new laptop or a
   reinstall, which is why it sits in the footer next to the usage line rather
   than behind anything. The library is not a backup; this is how it gets one. */
function libExportAll(btn) {
  libPending = null;
  var st = libRead();
  if (st.error) { libSay('bad', st.error.message); renderLibrary(); return; }
  if (!st.entries.length) {
    libSay('bad', 'There is nothing in the library to export yet.');
    renderLibrary();
    return;
  }
  var name = safeName('query-library-' + timeStamp(true), 'query-library') + QUERY_EXT;
  var ok = downloadFile(name, libExportPayload(st.entries));
  libSay(ok ? 'ok' : 'bad',
         ok ? 'Wrote ' + st.entries.length + ' quer' + (st.entries.length === 1 ? 'y' : 'ies') +
              ' to ' + name + '.'
            : 'The library could not be written.');
  renderLibrary();
  flashBtn(btn, ok ? 'Saved ✓' : 'Save failed');
}

/* ------------------------------------------------------------------ IMPORTING */

function libPickImport(btn) {
  var input = document.getElementById('libImportFile');
  if (!input) return;
  // Reset first, or choosing the same file twice in a row fires no change
  // event — the same reason openGraphFile() does it.
  input.value = '';
  input._btn = btn;
  input.click();
}

function onLibImportChosen(e) {
  var input = e.target;
  var file = input.files && input.files[0];
  if (!file) return;
  var btn = input._btn;

  var problem = libFileProblem(file);
  if (problem) { libSay('bad', problem); renderLibrary(); flashBtn(btn, 'Import failed'); return; }

  var reader = new FileReader();
  reader.onload = function() {
    // A lone query file arrives with no name of its own, so it borrows the
    // file's — which is what the user called it when they saved it.
    var r = libImportText(String(reader.result), libName(stripQueryExt(file.name)));
    if (!r.ok) {
      libSay('bad', r.error.message);
      renderLibrary();
      flashBtn(btn, 'Import failed');
      return;
    }
    /* The search box is cleared, because an import that lands entirely outside
       the current filter looks exactly like an import that did nothing. */
    libQuery = '';
    var s = document.getElementById('libSearch');
    if (s) s.value = '';
    libSay(r.added ? 'ok' : 'bad', libImportSummary(r));
    renderLibrary();
    flashBtn(btn, r.added ? 'Imported ✓' : 'Nothing added');
  };
  reader.onerror = function() {
    libSay('bad', 'Could not read that file.');
    renderLibrary();
    flashBtn(btn, 'Import failed');
  };
  reader.readAsText(file);
}

/* ------------------------------------------------------------------- saving */

/* The library's own way in. The Save dialog gets one too, so a user who thinks
   "save this" and a user who thinks "put this in the library" both arrive; this
   is the one that does not need the dialog, because the name field is already
   on screen with the grid it is about to appear in.

   A clash is a question rather than a refusal, asked on the button the same way
   the destructive ones are: press again to replace the query of that name. */
function libSaveCurrent(btn) {
  var input = document.getElementById('libSaveName');
  var name = input ? input.value : '';
  var again = !!(libPending && libPending.action === 'replace' &&
                 libPending.id === libName(name).toLowerCase());

  var r = libAdd(name, { replace: again });
  libPending = null;

  if (r.conflict) {
    libPending = { action: 'replace', id: libName(name).toLowerCase() };
    libSay('bad', '"' + r.conflict.name + '" is already in the library. ' +
                  'Press Save to library again to replace it.');
    renderLibrary();
    flashBtn(btn, 'Replace?');
    return;
  }
  if (!r.ok) {
    libSay('bad', r.error.message);
    renderLibrary();
    flashBtn(btn, 'Save failed');
    return;
  }

  if (input) input.value = '';
  libQuery = '';
  var s = document.getElementById('libSearch');
  if (s) s.value = '';
  libSay('ok', 'Saved "' + r.entry.name + '" to the library.');
  renderLibrary();
  flashBtn(btn, 'Saved ✓');
}

/* Opening the library with a graph on the canvas offers a name for it, the way
   the save dialog does: the one it was loaded or last saved under, or a
   timestamp. Read at open rather than held, so a query loaded from a file since
   the last time the dialog was up brings its name with it. */
function libSuggestName() {
  return lastQueryName || defaultQueryName();
}

/* THE NODE MENUS
   Processing nodes are a growing family, so they live behind dropdowns rather
   than adding a toolbar button each. There are two, split on colour: Reshape
   holds the violet nodes and is violet itself, Processing holds the other three
   families and stays neutral because it cannot honestly claim one of them.

   Written against every .proc-menu rather than a named one, so a third menu is
   markup and needs no change here. Opening one closes the others: two open
   dropdowns overlap, and the second would look like a submenu of the first. */
function procMenus() {
  return Array.prototype.slice.call(document.querySelectorAll('.proc-menu'));
}
function closeProcMenu() {
  procMenus().forEach(function(m){ m.classList.remove('open'); });
}
function toggleProcMenu(e, id) {
  // Without this the document listener below sees the same click and closes the
  // menu in the tick it was opened.
  if (e) e.stopPropagation();
  var wanted = document.getElementById(id);
  procMenus().forEach(function(m) {
    if (m === wanted) m.classList.toggle('open');
    else m.classList.remove('open');
  });
}
function addProcNode(type) {
  closeProcMenu();
  addNode(type);
}

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
  if (e.key === 'w' || e.key === 'W') { if (!mod) { e.preventDefault(); togglePanelWide(); } return; }
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

/* GLOBALS: Referenced by inline onclick handlers in the toolbar and panels */
window.addNode = addNode;
window.addProcNode = addProcNode;
window.toggleProcMenu = toggleProcMenu;
window.removeNode = removeNode;
window.addCriterion = addCriterion;
window.addSortKey = addSortKey;
window.removeSortKey = removeSortKey;
window.addStat = addStat;
window.removeStat = removeStat;
window.removeCriterion = removeCriterion;
window.clearCritList = clearCritList;
window.clearAll = clearAll;
window.requestClearAll = requestClearAll;
window.closeClearDialog = closeClearDialog;
window.confirmClearAll = confirmClearAll;
window.runQuery = runQuery;
window.copyOutput = copyOutput;
window.saveOutput = saveOutput;
window.saveGraph = saveGraph;
window.closeSaveDialog = closeSaveDialog;
window.openHelp = openHelp;
window.closeHelp = closeHelp;
window.confirmSaveGraph = confirmSaveGraph;
window.openGraphFile = openGraphFile;
window.pickHeadersFile = pickHeadersFile;
window.pickYearFiles = pickYearFiles;
window.clearSourceData = clearSourceData;
window.removeSourceYear = removeSourceYear;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.zoomReset = zoomReset;
window.zoomToFit = zoomToFit;
window.togglePanelWide = togglePanelWide;
window.deleteSelection = deleteSelection;
window.clearSelection = clearSelection;

/* TEST HOOK
   Set window.__QB_TEST__ = true *before* loading these scripts to expose internals to
   the test suite. In normal use the flag is undefined and nothing is exported,
   so this costs one branch at start-up and leaks nothing.

   The alternative (having the tests reach in by rewriting the source text) is
   silently broken by any edit near the end of this file, and a test suite that
   fails for reasons unrelated to the code under test is worse than none. */
if (typeof window !== 'undefined' && window.__QB_TEST__) {
  /* The suites run against the dataset the tool used to generate for itself.
     Installing it here, behind the same flag that publishes the internals,
     means a real page reaches neither: it opens with no data, and a Source
     without files refuses to run. See the loader section for why the generator
     was kept rather than the several hundred assertions written against it
     being rewritten to talk about the archive instead. */
  installSyntheticDataset();

  window.__qb = {
    // live state
    nodes: function(){ return nodes; },
    connections: function(){ return connections; },
    exportData: function(){ return exportData; },
    isFresh: function(){ return resultsFresh; },
    findNode: findNode,
    setCfg: setCfg,
    render: render,
    // test convenience: wire two nodes without simulating a drag. The port
    // defaults to the target's primary input, so existing tests that predate
    // ports keep working unchanged.
    connect: function(a, b, color, port) {
      var to = findNode(b);
      connections.push({
        from: a, to: b,
        port: port || (to ? primaryPort(to.type) : 'in'),
        color: color || '#ffffff'
      });
    },

    // ports
    NODE_PORTS: NODE_PORTS, portsOf: portsOf, primaryPort: primaryPort,
    portDef: portDef, normalisePort: normalisePort, wiresInto: wiresInto,
    portAccepts: portAccepts, freePortsOn: freePortsOn,
    portOffsetY: portOffsetY, shapeEntry: shapeEntry, shapeExit: shapeExit,
    nearestFreePort: nearestFreePort, resolveDirection: resolveDirection,
    inputsOf: inputsOf, connKey: connKey, removeConnection: removeConnection,

    // data layer
    STUDENTS: STUDENTS, COURSES: COURSES, SUBJECTS: SUBJECTS, SPECS: SPECS, YEARS: YEARS,
    COURSE_BY_CODE: COURSE_BY_CODE, CORE_COURSES: CORE_COURSES, COURSES_PER_YEAR: COURSES_PER_YEAR,
    SPEC_SUBJECTS: SPEC_SUBJECTS, SUBJECT_WEIGHTS: SUBJECT_WEIGHTS, subjectWeight: subjectWeight,
    rebuildRegistries: rebuildRegistries, defaultCourse: defaultCourse,
    defaultSubject: defaultSubject, defaultLevel: defaultLevel,
    DEGREES: DEGREES, LEVELS: LEVELS, courseLevel: courseLevel,

    // loading the archive: admission, parsing, and per-source state
    DATA_HEADERS_NAME: DATA_HEADERS_NAME, DATA_YEAR_RE: DATA_YEAR_RE,
    DATA_YEAR_MIN: DATA_YEAR_MIN, DATA_YEAR_MAX: DATA_YEAR_MAX,
    MAX_DATA_FILE_BYTES: MAX_DATA_FILE_BYTES, MAX_DATA_ROWS: MAX_DATA_ROWS,
    MAX_FIELD_CHARS: MAX_FIELD_CHARS, MAX_COURSE_POINTS: MAX_COURSE_POINTS,
    REQUIRED_HEADER_COLUMNS: REQUIRED_HEADER_COLUMNS,
    dataFileName: dataFileName, headersFileProblem: headersFileProblem,
    yearFileProblem: yearFileProblem, yearOfFile: yearOfFile,
    parseHeaderFile: parseHeaderFile, parseYearFile: parseYearFile,
    calendarYearOf: calendarYearOf, buildDataset: buildDataset,
    loadHeadersFor: loadHeadersFor, loadYearFilesFor: loadYearFilesFor,
    removeSourceYear: removeSourceYear, parsedYearsOf: parsedYearsOf,
    yearFileNameFor: yearFileNameFor, applyDatasetToNode: applyDatasetToNode,
    MAX_YEAR_FILES: MAX_YEAR_FILES,
    clearSourceData: clearSourceData, clearAllSourceData: clearAllSourceData,
    forgetSourceData: forgetSourceData,
    datasetFor: datasetFor, hasSourceData: hasSourceData, datasetCfg: datasetCfg,
    headerFor: headerFor, sourceDataError: sourceDataError, sourceTable: sourceTable,
    sourceFilesHTML: sourceFilesHTML,
    sourceData: function(){ return SOURCE_DATA; },
    pendingHeaders: function(){ return PENDING_HEADERS; },
    sourceNotice: function(id){ return SOURCE_NOTICE[id] || null; },
    syntheticDataset: function(){ return SYNTHETIC_DATASET; },
    setSyntheticDataset: setSyntheticDataset,
    installSyntheticDataset: installSyntheticDataset,

    // table primitives
    COLTYPE: COLTYPE, STUDENT_COLUMNS: STUDENT_COLUMNS,
    makeTable: makeTable, colIndex: colIndex, colByKey: colByKey,
    hasCol: hasCol, cellAt: cellAt, headerOnly: headerOnly, numericCols: numericCols,
    coursesColIndex: coursesColIndex, studentsTable: studentsTable,
    fmtCell: fmtCell, exportCell: exportCell, cellTitle: cellTitle,
    schemaKey: schemaKey, rowKey: rowKey,

    // engine
    topoSort: topoSort, evaluateGraph: evaluateGraph, computeSchemas: computeSchemas,
    NODE_SPEC: NODE_SPEC, specFor: specFor, SHAPE: SHAPE, passthroughSchema: passthroughSchema,
    inputSchema: inputSchema, unionTables: unionTables, filterFields: filterFields,
    fieldByKey: fieldByKey, applyFilter: applyFilter, applyCriterion: applyCriterion,
    opsFor: opsFor, defaultOpFor: defaultOpFor, OP_FNS: OP_FNS, OP_SYM: OP_SYM,
    NUM_OPS: NUM_OPS, ENUM_OPS: ENUM_OPS, ORDERED_OPS: ORDERED_OPS,
    MARK_OPS: MARK_OPS, CODE_OPS: CODE_OPS, opGroups: opGroups,
    isRangeable: isRangeable, numericValues: numericValues, rankerFor: rankerFor,
    critValue: critValue, critOp: critOp, critHigh: critHigh, critRange: critRange,
    rangeKey: rangeKey, isBlank: isBlank,
    critList: critList, listKey: listKey, orderList: orderList,
    listChoices: listChoices, listMatcher: listMatcher,
    newCriterion: newCriterion, defaultCfg: defaultCfg,
    normaliseShow: normaliseShow, outputTable: outputTable, defaultAvgCol: defaultAvgCol,
    // Output visibility in the results panel
    hiddenInPanel: hiddenInPanel, outputNodes: outputNodes,
    allHiddenNoteHTML: allHiddenNoteHTML, applyPanelVisibility: applyPanelVisibility,
    branchesFeedOutput: branchesFeedOutput, BRANCH_NODES: BRANCH_NODES,
    ROW_SHOWS: ROW_SHOWS, CMP_SHOWS: CMP_SHOWS, branchProducer: branchProducer,
    DISPLAY_ROW_LIMIT: DISPLAY_ROW_LIMIT, DISPLAY_CARD_LIMIT: DISPLAY_CARD_LIMIT,
    meanOf: meanOf, MEASURES: MEASURES,

    // sort
    applySort: applySort, sortableCols: sortableCols, comparatorFor: comparatorFor,
    sortRowComparator: sortRowComparator,
    resolveSortKeys: resolveSortKeys, newSortKey: newSortKey, dirLabel: dirLabel,
    ordinalsFor: ordinalsFor, GRADE_ORDER: GRADE_ORDER,
    GRADE_POINTS: GRADE_POINTS, gradePoint: gradePoint, gpaOf: gpaOf,
    gradeFromGpa: gradeFromGpa,

    // combine
    COMBINE_MODES: COMBINE_MODES, combineMode: combineMode, combineTables: combineTables,
    combineBaseId: combineBaseId, combineKeyCol: combineKeyCol, combineKeyCols: combineKeyCols,
    upstreamLabel: upstreamLabel,

    // aggregation
    AGG_OPS: AGG_OPS, aggOp: aggOp, reduceValues: reduceValues,
    measurableCols: measurableCols, isMeasurable: isMeasurable,
    aggregateCol: aggregateCol, aggregateColumn: aggregateColumn,
    aggregateSchema: aggregateSchema, applyAggregate: applyAggregate,
    aggregateColumnsSchema: aggregateColumnsSchema,
    applyAggregateColumns: applyAggregateColumns,
    aggregateRowsColumn: aggregateRowsColumn, aggregateRowsSchema: aggregateRowsSchema,
    aggregateRowsIdx: aggregateRowsIdx, applyAggregateRows: applyAggregateRows,
    outputCols: outputCols,
    columnValues: columnValues,

    // select for
    SELECTFOR_OPS: SELECTFOR_OPS, selectForOp: selectForOp,
    groupFields: groupFields, groupField: groupField, groupColumn: groupColumn,
    statsOf: statsOf, newStat: newStat, defaultStats: defaultStats, statCol: statCol,
    hasStats: hasStats,
    selectForColumns: selectForColumns, evaluateSelectFor: evaluateSelectFor,
    measureColumns: measureColumns, measureValues: measureValues,

    // histogram
    HIST_BINS_WANTED: HIST_BINS_WANTED, HIST_MAX_BINS: HIST_MAX_BINS,
    autoWidth: autoWidth,
    binnableCols: binnableCols, binField: binField, binWidth: binWidth,
    binsFor: binsFor, binLabel: binLabel, fmtEdge: fmtEdge,
    binColumn: binColumn, histogramColumns: histogramColumns,
    applyHistogram: applyHistogram,
    globToRegExp: globToRegExp,
    labelCols: labelCols, labelsFromTable: labelsFromTable,
    labelsFromData: labelsFromData, rowsForLabel: rowsForLabel,
    addStat: addStat, removeStat: removeStat,

    /* toolbar height. The drag itself is layout, and layout is the one thing
       jsdom does not do, so what is exposed here is the arithmetic around it:
       the ceiling, the clamp, the height-to-size lookup and the table they all
       read. A test supplies the heights by standing in for the bar's own
       measurement, which is what the browser does anyway. */
    BAR_S_MIN: BAR_S_MIN, BAR_S_MAX: BAR_S_MAX, BAR_S_STEP: BAR_S_STEP,
    CANVAS_MIN_H: CANVAS_MIN_H, BAR_HANDLE_H: BAR_HANDLE_H,
    buildBarSteps: buildBarSteps, barStepTable: barStepTable, barStepFor: barStepFor,
    barRowCount: barRowCount, barMaxScale: barMaxScale, barHeightBudget: barHeightBudget,
    clampBarScale: clampBarScale, barFitForHeight: barFitForHeight,
    applyBarScale: applyBarScale, saveBarPrefs: saveBarPrefs, loadBarPrefs: loadBarPrefs,
    barScaleNow: function(){ return barScale; },
    barFillNow:  function(){ return barFill; },
    barStepsDrop: function(){ barSteps = null; barStepsW = -1; },

    // canvas gestures
    isCanvasBackground: isCanvasBackground,

    // results panel width
    PANEL_MIN: PANEL_MIN, PANEL_DEFAULT: PANEL_DEFAULT, PANEL_WIDE: PANEL_WIDE,
    CANVAS_MIN: CANVAS_MIN, HANDLE_W: HANDLE_W,
    panelMaxWidth: panelMaxWidth, clampPanelWidth: clampPanelWidth,

    // unique
    uniqueCols: uniqueCols, uniqueCol: uniqueCol, uniqueCellKey: uniqueCellKey,
    uniqueSchema: uniqueSchema, applyUnique: applyUnique,
    selectedCols: selectedCols, selectSchema: selectSchema, applySelect: applySelect,
    canProject: canProject, projectCarried: projectCarried, projectColumns: projectColumns,
    projectSchema: projectSchema, applyProject: applyProject,
    enrolmentColumns: enrolmentColumns, enrolmentKeys: enrolmentKeys,
    combineOrder: combineOrder, joinColumns: joinColumns, joinTables: joinTables,

    // take
    applyTake: applyTake, takeCount: takeCount,
    TAKE_DEFAULT: TAKE_DEFAULT, TAKE_MIN: TAKE_MIN,
    canConnect: canConnect, CONNECT_RULES: CONNECT_RULES,

    // edge preview. The column cap is paired with a width in the stylesheet,
    // so it is exported to be asserted on rather than trusted to stay in step.
    PREVIEW_COLS: PREVIEW_COLS, PREVIEW_ROWS: PREVIEW_ROWS,
    previewColumns: previewColumns, previewTableHTML: previewTableHTML,
    edgeData: edgeData,

    // view: zoom, pan and world coordinates
    view: function(){ return view; },
    setZoom: setZoom, zoomToFit: zoomToFit, centreView: centreView, clampPan: clampPan, applyView: applyView,
    toWorld: toWorld, toScreen: toScreen, viewCentreWorld: viewCentreWorld,
    nodeBox: nodeBox, graphBounds: graphBounds, freeSpotNear: freeSpotNear,
    WORLD_W: WORLD_W, WORLD_H: WORLD_H, MIN_ZOOM: MIN_ZOOM, MAX_ZOOM: MAX_ZOOM,

    // selection
    selection: function(){ return selection; },
    setSelection: setSelection, selectOnly: selectOnly, clearSelection: clearSelection,
    selectAll: selectAll, toggleSelected: toggleSelected, isSelected: isSelected,
    deleteSelection: deleteSelection, selectBranch: selectBranch,
    connectedComponent: connectedComponent, nodesInWorldRect: nodesInWorldRect,

    // export + persistence
    serialiseTable: serialiseTable, exportTableFor: exportTableFor, safeName: safeName,
    exportNameOf: exportNameOf, defaultExportName: defaultExportName, markStale: markStale,
    timeStamp: timeStamp, dateStamp: dateStamp, resultHTML: resultHTML, scalarHTML: scalarHTML, tableHTML: tableHTML,
    courseLabel: courseLabel, courseTitle: courseTitle, courseSelect: courseSelect,
    serialiseGraph: serialiseGraph, deserialiseGraph: deserialiseGraph,
    applyGraph: applyGraph, loadGraphFromText: loadGraphFromText,
    FILE_KIND: FILE_KIND, FILE_VERSION: FILE_VERSION,

    // naming and file admission
    queryFileName: queryFileName, defaultQueryName: defaultQueryName,
    stripQueryExt: stripQueryExt,
    lastQueryName: function(){ return lastQueryName; },
    writeQueryFile: writeQueryFile, graphFileProblem: graphFileProblem,
    openSaveDialog: openSaveDialog, closeSaveDialog: closeSaveDialog,
    confirmSaveGraph: confirmSaveGraph, saveDialogOpen: saveDialogOpen,
    updateSaveHint: updateSaveHint,
    requestClearAll: requestClearAll, closeClearDialog: closeClearDialog,
    confirmClearAll: confirmClearAll, clearDialogOpen: clearDialogOpen,
    skipClearConfirm: function(){ return skipClearConfirm; },
    openHelp: openHelp, closeHelp: closeHelp, helpOpen: helpOpen,
    syncHelpNav: syncHelpNav, scrollHelpTo: scrollHelpTo,
    QUERY_EXT: QUERY_EXT, MAX_QUERY_FILE_BYTES: MAX_QUERY_FILE_BYTES,

    // query library
    LIB_STORE: LIB_STORE, LIB_KIND: LIB_KIND, LIB_VERSION: LIB_VERSION,
    LIB_NAME_MAX: LIB_NAME_MAX, LIB_MAX_ENTRIES: LIB_MAX_ENTRIES,
    LIB_MESSAGES: LIB_MESSAGES,
    libRead: libRead, libWrite: libWrite, libBytes: libBytes,
    libGet: libGet, libIndexOf: libIndexOf, libNameTaken: libNameTaken,
    libName: libName, libNewId: libNewId, libEntryFor: libEntryFor,
    libAdd: libAdd, libRename: libRename, libRemove: libRemove,
    libGraphText: libGraphText, libIsQuota: libIsQuota,

    // the card's picture. Drawn from the graph, never stored, never carrying
    // anything out of an entry but its node types: see libThumb.
    libThumb: libThumb, libInk: libInk, LIB_INK: LIB_INK,
    libThumbNodes: libThumbNodes, libShapeBox: libShapeBox,
    LIB_THUMB_W: LIB_THUMB_W, LIB_THUMB_H: LIB_THUMB_H,
    LIB_THUMB_MAX_NODES: LIB_THUMB_MAX_NODES,

    // the dialog
    openLibrary: openLibrary, closeLibrary: closeLibrary, libraryOpen: libraryOpen,
    renderLibrary: renderLibrary, libSearchInput: libSearchInput,
    libOpenEntry: libOpenEntry, libDeleteEntry: libDeleteEntry,
    libExportEntry: libExportEntry, libSaveCurrent: libSaveCurrent,
    libStartRename: libStartRename, libCommitRename: libCommitRename,
    libRenameKey: libRenameKey, libStartOver: libStartOver,
    libCardHTML: libCardHTML, libWhen: libWhen, libSizeText: libSizeText,
    LIB_SEARCH_MIN: LIB_SEARCH_MIN,
    libPendingNow: function(){ return libPending; },
    libNoticeNow:  function(){ return libNotice; },

    // export / import
    libCleanEntry: libCleanEntry, libExportPayload: libExportPayload,
    libImportText: libImportText, libImportSummary: libImportSummary,
    libFileProblem: libFileProblem, MAX_LIB_FILE_BYTES: MAX_LIB_FILE_BYTES,
    libExportAll: libExportAll, libPickImport: libPickImport,

    // the save dialog's second destination
    confirmSaveToLibrary: confirmSaveToLibrary, saveHintSay: saveHintSay,
    saveLibPendingNow: function(){ return saveLibPending; }
  };
}

// The world layer needs its size and transform before the first paint, or the
// first frame shows an unsized viewport and the nodes jump when it settles.
applyView();
centreView();
render();
