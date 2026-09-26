/* engine/sort-take.js: Sort, Reverse and Take: the three pure row operations.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   SORT, REVERSE, TAKE
   ============================================================================
   Three nodes that reorder or shorten the rows and hand on the columns they
   were given. Because none of them changes the header, computeSchemas() needs
   no case for any of them.                                                    */
/* SORT
   Reorders rows by one or more columns with a priority, the way Excel's sort
   dialog does: the first key decides, the second breaks its ties, and so on.
   Like Take it is a pure row operation (same columns out as in), so
   computeSchemas() needs no case for it either.

   This is the first node that visibly earns the uniform table model. It sorts
   a student list, an enrolment list and (once Histogram lands) a histogram
   with no knowledge of any of them: it asks the incoming table for its columns
   and their types, and everything else follows from that. */

// COURSES cells hold an array of enrolment objects. There is no defensible
// ordering on "eight courses". By count? by first code?, so the column is
// offered nowhere rather than sorted arbitrarily.
function sortableCols(t) {
  return t.columns.filter(function(c){ return c.type !== COLTYPE.COURSES; });
}

/* Declared order beats lexical order. Specialisation and Year are ENUMs whose
   `values` array is already the order a reader expects, and letterGrade now
   carries an explicit `order` for the same reason: sorted as text, an A+ lands
   between A and A- because '+' precedes '-' in ASCII. Any column may opt in by
   declaring `order`; columns that declare neither fall back to comparison by
   value. */
function ordinalsFor(col) {
  if (col && col.order) return col.order;
  if (col && col.type === COLTYPE.ENUM && col.values) return col.values;
  return null;
}

function isBlank(v) {
  return v === undefined || v === null || v === '' ||
         (typeof v === 'number' && !isFinite(v));
}

/* One comparator per column, built once per sort rather than per comparison. */
function comparatorFor(col) {
  var ord = ordinalsFor(col);
  if (ord) {
    var rank = {};
    ord.forEach(function(v, i){ rank[String(v)] = i; });
    return function(a, b) {
      // A value absent from the declared order sorts after every declared one,
      // then alphabetically among its peers, so a course prefix added to the
      // catalogue without being added to the order still lands somewhere
      // predictable instead of at the front.
      var ra = rank[String(a)], rb = rank[String(b)];
      if (ra === undefined && rb === undefined) return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0);
      if (ra === undefined) return 1;
      if (rb === undefined) return -1;
      return ra - rb;
    };
  }
  if (col && col.type === COLTYPE.NUMBER) {
    return function(a, b){ return Number(a) - Number(b); };
  }
  // numeric:true so SWEN430 precedes SWEN4300, sensitivity:'base' so case does
  // not split otherwise-equal values into two groups.
  return function(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric:true, sensitivity:'base' });
  };
}

var SORT_DIRS = ['asc', 'desc'];

// Direction labels follow the column type: "A → Z" is meaningless on a mark and
// "high → low" is meaningless on a name.
function dirLabel(col, dir) {
  if (col && col.type === COLTYPE.NUMBER) return dir === 'desc' ? 'high → low' : 'low → high';
  if (ordinalsFor(col))                   return dir === 'desc' ? 'last → first' : 'first → last';
  return dir === 'desc' ? 'Z → A' : 'A → Z';
}

function newSortKey() { return { col:'', dir:'asc' }; }

/* Resolve the configured keys against a table. A key naming a column that is
   no longer there (rewire a Source from students to enrolments and 'gpa'
   simply stops existing) is reported rather than silently dropped, because a
   sort that quietly stopped happening looks identical to one that ran. */
function resolveSortKeys(node, t) {
  var cfg = (node && node.cfg) || defaultCfg('sort');
  var avail = sortableCols(t);
  var out = [];
  (cfg.keys || []).forEach(function(k) {
    var key = k && k.col;
    if (!key) { if (avail.length) out.push({ col:avail[0], dir:(k && k.dir) || 'asc' }); return; }
    var col = colByKey(t, key);
    if (!col || col.type === COLTYPE.COURSES) { out.push({ missing:key }); return; }
    out.push({ col:col, dir:(k.dir === 'desc' ? 'desc' : 'asc') });
  });
  return out;
}

/* Compares two decorated rows {row, i} against a plan of resolved keys. Pulled
   out of applySort so the tie rule is a testable function rather than a
   property of whichever engine runs Array.sort. */
function sortRowComparator(plan) {
  return function(A, B) {
    for (var p = 0; p < plan.length; p++) {
      var a = A.row[plan[p].idx], b = B.row[plan[p].idx];
      // Blanks sink to the bottom under both directions. Reversing a sort
      // should not drag empty cells to the top of the report.
      var ba = isBlank(a), bb = isBlank(b);
      if (ba || bb) { if (ba && bb) continue; return ba ? 1 : -1; }
      var c = plan[p].cmp(a, b);
      if (c) return c * plan[p].sign;
    }
    return A.i - B.i;   // fully tied: arrival order decides
  };
}

function applySort(node, t, log) {
  var keys = resolveSortKeys(node, t);
  var missing = keys.filter(function(k){ return k.missing; });
  var live    = keys.filter(function(k){ return k.col; });

  missing.forEach(function(k) {
    log.push(logEntry('SORT', [{s:'skipped'}, {c:'val', s:k.missing},
                               {s:'(not a column in this table)'}]));
  });
  if (!live.length) return t;

  log.push(logEntry('SORT', live.reduce(function(parts, k, i) {
    if (i) parts.push({s:'then'});
    parts.push({c:'val', s:k.col.label}, {s:dirLabel(k.col, k.dir)});
    return parts;
  }, [])));

  var plan = live.map(function(k) {
    return { idx: colIndex(t, k.col.key), cmp: comparatorFor(k.col), sign: k.dir === 'desc' ? -1 : 1 };
  });

  /* Decorated with the arrival position and compared on it last. Array.sort is
     specified stable since ES2019, but relying on that would make the tie
     behaviour a property of the engine rather than of this node, and ties are
     the normal case here, not the edge case (sorting 80 students by Year gives
     two groups of forty). The comparator is extracted so a test can assert the
     tiebreak directly: an engine that is already stable hides the difference,
     so exercising it through sort() alone would prove nothing. */
  var cmpRows = sortRowComparator(plan);
  var decorated = t.rows.map(function(row, i){ return { row:row, i:i }; });
  decorated.sort(cmpRows);

  /* A new rows array, never an in-place sort. One node's result object is read
     by every node wired downstream of it, so sorting t.rows in place would
     reorder a sibling branch's data as a side effect, and the bug would only
     appear on graphs that fork. */
  return makeTable(t.columns, decorated.map(function(d){ return d.row; }), t.meta);
}

/* REVERSE
   Flips row order. Its reason for existing is Take: Take deliberately keeps the
   FIRST N rows and does not rank, so "the last N" and "the bottom 10" had no
   expression at all. Sort, Reverse, Take says it in three nodes that each do
   one thing, rather than growing Take a direction setting that would duplicate
   what Sort already decides.

   Sort with the direction flipped covers most of the same ground, but not all
   of it: reversing needs no column, so it works on a table whose order came
   from somewhere other than a sort. The order rows arrived from a Combine, or
   the order a Compare's branches were wired in. Those have no key to sort on.

   Like Take it is a pure row operation: no column is added, removed, renamed or
   retyped, so the outgoing header is the incoming header and the schema pass
   needs nothing but passthroughSchema.

   meta is carried through for the same reason Sort and Take carry it. The rows
   are the same rows in a different order, so whatever a producer upstream
   recorded about them is still true.                                          */
function applyReverse(node, t, log) {
  var n = t.rows.length;
  log.push(logEntry('REVERSE', n
    ? [{s:'row order of'}, {c:'val', s:n}, {s:'rows'}]
    : [{s:'no rows to reverse'}]));
  /* slice() first: reverse() is in place, and one node's result object is read
     by every node wired downstream of it, so reversing t.rows directly would
     reorder a sibling branch's data as a side effect. Sort guards the same way
     and for the same reason. The bug would only show up on graphs that fork. */
  return makeTable(t.columns, t.rows.slice().reverse(), t.meta);
}

/* TAKE
   Keeps the first N rows and discards the rest. It is the whole node: no
   column is added, removed, renamed or retyped, so the outgoing header is the
   incoming header and computeSchemas() needs no case for it.

   Deliberately not a sort. "Top 10 by mark" is Sort then Take, two nodes doing
   one thing each, which is why the supervisor asked for Take as its own node
   rather than a Top-N that quietly sorts on your behalf. Behind an unsorted
   input this returns the first ten rows in whatever order they arrived, which
   is a legitimate thing to want (a sample to eyeball) and is stated in the
   panel so it cannot be mistaken for a ranking.

   N is stored as typed, never parsed on write. A number input yields '' while
   the field is mid-edit and '1e3' if pasted; coercing on write would have to
   pick a number for text the user has not finished typing, and would then feed
   that guess back into the control. Coercion happens once, on read. */
var TAKE_DEFAULT = 10;
var TAKE_MIN = 1;

function takeCount(node) {
  var raw = node && node.cfg ? node.cfg.n : undefined;
  var n = parseInt(raw, 10);
  // Blank, non-numeric or out of range all fall back rather than throwing: a
  // half-typed field must not break a Run, and a saved file written by hand
  // must not be able to produce a negative slice.
  if (!isFinite(n) || n < TAKE_MIN) return TAKE_DEFAULT;
  return Math.floor(n);
}

function applyTake(node, t, log) {
  var n = takeCount(node);
  var before = t.rows.length;

  // Log what actually happened, not what was asked for. "first 10" above a
  // seven-row table reads as a bug in the tool; saying all 7 were kept shows
  // the node ran and the input was simply short.
  log.push(logEntry('TAKE', before <= n
    ? [{s:'first'}, {c:'val', s:n}, {s:'rows (kept all)'}, {c:'val', s:before}]
    : [{s:'first'}, {c:'val', s:n}, {s:'rows of'}, {c:'val', s:before}]));

  if (before <= n) return t;
  // meta is carried through: Take is a row operation and has no opinion about
  // whatever a producer upstream recorded there.
  return makeTable(t.columns, t.rows.slice(0, n), t.meta);
}

