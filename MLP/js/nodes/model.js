/* nodes/model.js: Input ports and their geometry, node defaults, and adding,
   removing and clearing nodes.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
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

/* WHY A DROP DID NOT WIRE
   ---------------------------------------------------------------------------
   Refusing in silence was the complaint. Two nodes are dragged together, nothing
   happens, and the tool gives no account of itself, so the user cannot tell
   whether they missed, whether the pair is illegal, or whether the thing is
   broken. The ghost arrow already answers the case that WILL wire, before the
   drop. The case with no feedback at all was the one that needed it.

   The reasons are ordered by what the user can act on rather than by how the
   check happens to be written:

     1. Already wired. The wire is on screen saying so, which is a better answer
        than any sentence, so this one is left unsaid. The exception is Combine
        and Compare, whose ports accept more wires: there a ghost arrow appears
        and the drop is still refused as a duplicate, so the preview made a
        promise that has to be explained. onUp() says that one.
     2. Every input is taken. The types are compatible, so what the user needs
        is which input is occupied and how to free it.
     3. Nothing wires into a Source. The only type rule anyone meets in practice,
        phrased as what a Source is rather than as a quotation of the rule.
     4. Anything else, named plainly. A guard for a node type added later.

   Written as a function returning a sentence rather than as branches inside the
   drop handler, so a test can ask for the reason without simulating a pointer,
   and so the wording sits beside the rules it is explaining.                 */

/* How far apart the two shapes' wiring points are, ignoring which ports are
   free. nearestFreePort() cannot answer for a pair that has no free port, and a
   refusal still has to be aimed at the node the user was reaching for. Both
   directions are measured because either one could have been the intent. */
function portGap(from, to) {
  var ex = shapeExit(from), en = shapeEntry(to, primaryPort(to.type));
  return Math.sqrt(Math.pow(en.x - ex.x, 2) + Math.pow(en.y - ex.y, 2));
}

function snapDistance(a, b) { return Math.min(portGap(a, b), portGap(b, a)); }

// Either direction, any port: "are these two already joined at all".
function wireBetween(a, b) {
  var found = null;
  connections.forEach(function(c) {
    if (found) return;
    if ((c.from === a.id && c.to === b.id) || (c.from === b.id && c.to === a.id)) found = c;
  });
  return found;
}

/* Naming the way out of it, once, because every refusal about a full input has
   the same remedy and a note that states a rule without one is half an answer.
   Dragging the nodes apart does NOT break a wire, whatever the gesture suggests,
   so the badge is what this points at. */
var CONN_FREE_FIX = 'To free an input, hover its wire and click the x on it.';

function listWords(xs) {
  if (xs.length < 2) return xs.join('');
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}

function portsTakenText(node) {
  var labels = portsOf(node.type).map(function(p){ return p.label; });
  if (labels.length === 1) {
    return upstreamLabel(node) + ' already has an input wire, and every node but ' +
      'Combine and Compare takes exactly one.';
  }
  return upstreamLabel(node) + ' has a wire on ' + listWords(labels) + ' already.';
}

/* Null means there is nothing worth saying: the drop wired them, or the pair is
   connected and can see that for itself. */
function connectRefusal(a, b) {
  if (!a || !b || a.id === b.id) return null;
  if (resolveDirection(a, b)) return null;
  if (wireBetween(a, b)) return null;

  var fwd = canConnect(a.type, b.type);
  var rev = canConnect(b.type, a.type);
  /* One of the two directions is allowed by type, so the block is arithmetic
     about ports rather than about kinds. The forward reading is preferred when
     both are open, because `a` is the node in the user's hand and the thing
     being dropped ONTO is the thing they aimed at. */
  if (fwd || rev) return portsTakenText(fwd ? b : a) + ' ' + CONN_FREE_FIX;

  if (!portsOf(a.type).length && !portsOf(b.type).length) {
    return 'Nothing wires into a Source: it reads its rows from a file. Drag a ' +
      'Filter or an Output here instead and the Source will feed that.';
  }
  return upstreamLabel(a) + ' and ' + upstreamLabel(b) +
    ' cannot be wired together in either direction.';
}

/* Where to put the note: between the two nodes, which is where the user was
   looking and where the wire would have been. */
function midWorld(a, b) {
  return {
    x: (a.x + b.x) / 2 + NODE_W / 2,
    y: (a.y + SHAPE[a.type].h / 2 + b.y + SHAPE[b.type].h / 2) / 2
  };
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
  /* `grain` is what a row means on the way out: one student, or one enrolment.
     'student' is the default because it is what every Source emitted before the
     setting existed, so a saved query written without the key keeps its
     meaning. See SOURCE_GRAINS in engine/core.js for why it is visible in four
     places rather than one. */
  if (type === 'source')  return { pop:'all', grain:'student', dataset:{ headers:'', years:[] } };
  if (type === 'filter')  return { criteria:[newCriterion()] };
  if (type === 'compare') return { measures:DEFAULT_MEASURES.slice(), sort:'wired', labels:{} };
  if (type === 'sort')    return { keys: [newSortKey()] };
  if (type === 'take')    return { n: String(TAKE_DEFAULT), vars:{} };
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
  /* `labelsAs` pins how the labels branch is read: 'auto' works it out from
     the shape, which is right for anything typed by hand. See the bands note
     in engine/core.js for why it can be pinned at all. */
  if (type === 'selectFor') return { by:'', stats:[newStat()], labelCol:'', labelsAs:'auto' };
  /* `by` empty means "the first column that can be binned", resolved against
     the arriving table the way SelectFor resolves its own. `width` is stored as
     typed and coerced on read, exactly as Take stores N. `stats` is the same
     key and the same shape SelectFor uses, because it is the same machinery. */
  /* `vars` holds a binding for `width` when the band width is taken from a
     variable instead of typed. Empty on a fresh node, and the only key on any
     node's cfg whose value names something outside the node. */
  if (type === 'histogram') return { by:'', width:'', stats:[newStat()], vars:{} };
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
/* `vars` is where a variable binding lives when one of this criterion's
   operands is taking its value from the top of the screen rather than from the
   box beside it. Keyed by the same key the literal is under, so the two sit
   side by side and the literal survives being shadowed. Declared here rather
   than filled in lazily, for the reason defaultCfg gives: a saved file then
   always carries every key a criterion uses. */
function newCriterion() {
  return { field:'gpa', values:{}, ops:{}, course:defaultCourse(), vars:{} };
}

function critValue(c, field, col) {
  /* A bound variable shadows everything below, including the column's own
     default: the user has said where this value comes from. Resolved here
     rather than at each of the dozen call sites in the evaluator, which is the
     whole reason this function existed before variables did. */
  var bound = boundVar(c, field);
  if (bound) return bound.value;
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
  // The high bound binds under its own key, so the two ends of a range can take
  // their values from different variables, or one from a variable and one typed.
  var bound = boundVar(c, rangeKey(field));
  if (bound) return bound.value;
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
    /* Which variable one of this criterion's operands is taking its value
       from, or none. The key after the prefix is the key the literal is stored
       under, so `var:gpa` shadows `values.gpa` and `var:gpa:max` shadows the
       high bound, with no second spelling to keep in step. */
    else if (sub.indexOf('var:') === 0)   { setBinding(c, sub.slice(4), value); }
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
  /* A binding on the node's own settings rather than on a criterion: Take's
     row count, Histogram's band width. Same prefix, same meaning, one level up,
     and ahead of the generic write below so a binding can never be stored as
     though it were a setting called "var:n". */
  if (key.indexOf('var:') === 0) {
    setBinding(n.cfg, key.slice(4), value);
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
  hideConnNote();
  markStale();
  render();
}

function clearAll() {
  // Clearing the canvas clears the data with it: the Sources that held it are
  // about to stop existing, and leaving it behind would leak a cohort into the
  // registries with no node on screen accounting for it.
  clearAllSourceData();
  nodes = []; connections = []; edgeColorIndex = 0;
  /* The variables go with the graph. They are part of the query, not of the
     session: a fresh canvas that kept the last query's parameters would offer
     values nothing on screen accounts for. The fold state is left alone, being
     a view preference rather than part of the query. */
  clearVariables();
  renderVariables();
  exportData = {}; resultsFresh = false;
  // Clear starts a new query, so the name of the old one should not follow it
  // into the next Save dialog.
  lastQueryName = '';
  selection = [];
  cancelPreviewTimer(); hidePreview(); hideConnNote();
  view.z = 1; centreView();
  render();
  setOutput(panelStartHTML());
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
