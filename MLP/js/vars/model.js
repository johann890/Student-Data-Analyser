/* vars/model.js: Named values declared once and referenced by the nodes that
   need them: the list itself, and the bindings that point at it.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   VARIABLES
   ============================================================================
   The problem this solves. A query that asks about one student asks about them
   in several places: their ID goes into a Filter, and the same ID goes into
   whatever else narrows to them. Changing the question then means finding every
   node that carries the answer, and missing one produces a query that is
   internally inconsistent while still running perfectly happily. A variable is
   that value, named, declared in one place, and referenced by the nodes that
   use it. Editing it once edits every use of it, and a value used twice cannot
   drift apart.

   WHY THEY ARE NOT NODES
   ---------------------------------------------------------------------------
   A variable could have been a node with an edge running to each place it is
   used, and that is the first thing anyone proposes, because everything else
   here is a node. It was rejected for a reason that is about the picture rather
   than about the model: a variable is used by whichever nodes happen to need
   it, wherever they sit, so its edges run across the graph rather than along
   it, and they cross the dataflow arrows the canvas exists to make readable.
   The value a variable carries is also an operand and not a table, so an edge
   into a node would mean something different from every other edge on screen.

   So they live off the canvas entirely, in a menu in the toolbar, and a node
   names the one it wants instead of being wired to it. The supervisor's reading
   of the same arrangement is worth keeping: the query is a method and the
   variables are its formal parameters, declared above it and referred to by
   name in the body.

   THE REFERENCE IS THE ID, NEVER THE NAME
   ---------------------------------------------------------------------------
   A name is a label the user rewrites freely, and renaming one must not
   silently unbind the three filters that were using it. So a binding stores the
   id and the panel prints the name, which makes renaming free and costs nothing
   anywhere else. Two variables with the same name are legal in the model for
   the same reason (the ids stay distinct), and the menu says so on the chip
   rather than refusing the keystroke that produced it.

   A BINDING IS ALWAYS RESOLVABLE
   ---------------------------------------------------------------------------
   Deleting a variable clears every binding that named it, and loading a file
   drops any binding naming a variable the file does not declare. That is worth
   the small amount of bookkeeping: nothing downstream ever has to decide what a
   dangling reference means, so no panel, log line or evaluator carries a branch
   for a case that cannot arise.                                              */

/* One list for the whole query, in declaration order, which is the order the
   menu shows and the order a saved file keeps. */
var variables = [];
var varIdCtr = 0;

/* Twelve is not a technical limit. It is the point past which a list of chips
   stops being a signature you can read at a glance and becomes a list you have
   to search, which is the thing variables were meant to spare the user. */
var VAR_MAX = 12;
/* Long enough for a descriptive name, short enough to fit the chip and the
   operand select that has to print it inside a narrow config panel. */
var VAR_NAME_MAX = 24;
/* A variable holds one scalar: a student ID, a threshold, a course code, a row
   count. The cap is far above any of those and far below anything that could
   have been pasted in by accident. */
var VAR_VALUE_MAX = 64;

function newVarId() { return ++varIdCtr; }

function varById(id) {
  var n = parseInt(id, 10);
  if (isNaN(n)) return null;
  for (var i = 0; i < variables.length; i++) if (variables[i].id === n) return variables[i];
  return null;
}

/* The name as anything on screen should print it. A blank name is a real state
   (a chip is created before it is named, and the name can be cleared), so it
   resolves to something readable rather than to an empty gap in a sentence. */
function varName(v) {
  if (!v) return '';
  var s = String(v.name == null ? '' : v.name).trim();
  return s || 'unnamed';
}

/* Name and value together, for a select option and for a title attribute. The
   value is what the user is actually choosing between when two variables are
   offered, so it belongs in the label rather than only in the menu. */
function varLabel(v) {
  if (!v) return '';
  var val = String(v.value == null ? '' : v.value).trim();
  return varName(v) + ' = ' + (val || '(empty)');
}

/* Names are not forced to be unique, so this is how the menu finds the ones
   that are not. Compared case-insensitively and trimmed, because two chips
   reading "Year" and "year " are two chips the user reads as one variable. */
function varNameClashes(v) {
  if (!v) return false;
  var mine = varName(v).toLowerCase();
  return variables.some(function(o) {
    return o.id !== v.id && varName(o).toLowerCase() === mine;
  });
}

/* A name nobody has used yet. v1, v2, v3: short, obviously a placeholder, and
   unique on arrival, so a chip is usable the moment it appears and a user who
   never renames one still gets a query that reads sensibly. */
function nextVarName() {
  for (var i = 1; i <= VAR_MAX + 1; i++) {
    var want = 'v' + i;
    var taken = variables.some(function(v){ return varName(v).toLowerCase() === want; });
    if (!taken) return want;
  }
  return 'v' + (variables.length + 1);
}

/* ============================================================================
   BINDINGS
   ============================================================================
   A binding says "this operand takes its value from that variable". It is
   stored as a `vars` map beside the literal value it overrides, keyed by
   exactly the key the literal is under:

     a node's own settings   node.cfg.vars      { n: 3 }          Take's count
     one filter criterion    criterion.vars     { gpa: 3 }        the operand
                                                { 'gpa:max': 4 }  the high bound

   Two levels, one shape, one pair of functions, because the level a binding
   belongs at is decided by where the value it replaces lives. A criterion's
   bindings sit inside the criterion and not in a map on the node, so removing
   a criterion takes its bindings with it: keys holding a criterion index would
   go stale the moment a middle criterion was deleted, and would then describe
   the wrong row.

   THE LITERAL IS KEPT, NOT REPLACED
   ---------------------------------------------------------------------------
   Binding a variable leaves the typed value where it was and shadows it. Going
   back to a typed value therefore finds the one that was there rather than a
   default, which is the same continuity the range band's low bound keeps when
   the operator changes under it.                                             */

/* The variable an operand is taking its value from, or null when it is typed.
   `holder` is whatever owns the value: a node's cfg, or one criterion. */
function boundVar(holder, key) {
  if (!holder || !holder.vars) return null;
  return varById(holder.vars[key]);
}

function isBoundTo(holder, key, id) {
  var v = boundVar(holder, key);
  return !!v && v.id === id;
}

/* Setting a binding to anything that does not name a live variable clears it,
   which is what makes the empty option in the operand select mean "type a
   value" without a second code path. */
function setBinding(holder, key, id) {
  if (!holder) return;
  var v = varById(id);
  if (!v) {
    if (holder.vars) delete holder.vars[key];
    return;
  }
  holder.vars = holder.vars || {};
  holder.vars[key] = v.id;
}

/* Every operand on the canvas that names this variable, as the node it sits on
   and the human name of the setting. Used by the menu to say what a variable is
   holding together, and by the delete guard to say what it would break.

   The criteria are walked by field rather than by index, so the description is
   the column the user sees ("GPA") and not a position in a list. */
function varUsage(v) {
  var out = [];
  if (!v) return out;
  nodes.forEach(function(n) {
    var cfg = n.cfg;
    if (!cfg) return;
    VAR_OPERANDS.forEach(function(o) {
      if (n.type === o.type && isBoundTo(cfg, o.key, v.id)) {
        out.push({ node: n, where: o.label });
      }
    });
    (cfg.criteria || []).forEach(function(c) {
      Object.keys((c && c.vars) || {}).forEach(function(k) {
        if (!isBoundTo(c, k, v.id)) return;
        /* The high bound of a range is stored under a derived key, so the
           description says which end it is rather than printing the key. */
        var isHigh = k.slice(-4) === ':max';
        out.push({ node: n, where: (isHigh ? k.slice(0, -4) : k) + (isHigh ? ' (to)' : '') });
      });
    });
  });
  return out;
}

function varUsedCount(v) { return varUsage(v).length; }

/* The places a variable may be used, other than a filter's operands. One entry
   per settable scalar, which is what makes adding the next one an entry here
   plus the slot in its panel: the menu's usage list, the delete guard and the
   loader's pruning all read this table and none of them names a node type.

   Which controls qualify is a judgement and this is where it is written down. A
   variable holds ONE value, so it stands wherever the user would otherwise type
   or pick one value: a filter operand, either end of a range, the number of
   rows a Take keeps, the width of a Histogram's bands. It does not stand for a
   list (that is several values), for an operator or a column (those are the
   query's structure, not its numbers), or for a file (a Source reads those from
   disk). */
var VAR_OPERANDS = [
  { type:'take',      key:'n',     label:'rows kept' },
  { type:'histogram', key:'width', label:'band width' }
];

/* Whether a node has any operand a variable could stand in for. Asked of the
   node rather than of a list of types, so a panel does not have to know the
   table above. */
function nodeTakesVars(node) {
  if (!node) return false;
  if (node.type === 'filter') return true;
  return VAR_OPERANDS.some(function(o){ return o.type === node.type; });
}

/* ============================================================================
   EDITING THE LIST
   ============================================================================
   Each of these ends by repainting: the chips, because the list changed, and
   the canvas, because an operand slot shows the name and the value of whatever
   it is bound to, and because the chips that offer a binding only exist while
   there is something to bind.                                                */

function addVariable() {
  if (variables.length >= VAR_MAX) {
    varDockSay('That is ' + VAR_MAX + ' variables, which is as many as one query holds.');
    return null;
  }
  var v = { id: newVarId(), name: nextVarName(), value: '' };
  variables.push(v);
  varPending = null;
  /* Nothing is marked stale. A variable nothing is bound to yet cannot change
     an answer, and asking for a re-run because a chip appeared would be the
     tool inventing work for itself. */
  renderVariables();
  render();
  varFocus(v.id, 'name');
  return v;
}

/* Removing one clears every binding that named it, so the literal each operand
   was holding comes back and no reference is left pointing at nothing. */
function removeVariable(id) {
  var v = varById(id);
  if (!v) return;
  var used = varUsedCount(v) > 0;
  nodes.forEach(function(n) {
    var cfg = n.cfg;
    if (!cfg) return;
    if (cfg.vars) dropBindingsTo(cfg.vars, v.id);
    (cfg.criteria || []).forEach(function(c) {
      if (c && c.vars) dropBindingsTo(c.vars, v.id);
    });
  });
  variables = variables.filter(function(x){ return x.id !== v.id; });
  varPending = null;
  // Only a variable something was using can change an answer by leaving.
  if (used) markStale();
  renderVariables();
  render();
}

function dropBindingsTo(map, id) {
  Object.keys(map).forEach(function(k) { if (map[k] === id) delete map[k]; });
}

function setVarName(id, text) {
  var v = varById(id);
  if (!v) return;
  // Capped here rather than by a maxlength attribute alone, because a value can
  // also arrive from a saved file, and one rule is better than two.
  v.name = String(text == null ? '' : text).slice(0, VAR_NAME_MAX);
  /* A rename changes no answer: bindings name the id. So nothing is marked
     stale, and the results on screen stay valid. */
}

function setVarValue(id, text) {
  var v = varById(id);
  if (!v) return;
  /* Stored as typed and coerced by whoever reads it, which is the arrangement
     Take's N and Histogram's width already use for the same reason: a value
     half way through being typed has to survive in the model, and the operand
     that consumes it is the only thing that knows what a number, a course code
     or a grade letter should fall back to. */
  v.value = String(text == null ? '' : text).slice(0, VAR_VALUE_MAX);
  if (varUsedCount(v) > 0) markStale();
}

function clearVariables() {
  variables = [];
  varIdCtr = 0;
  varPending = null;
}
