/* engine-combine.js: Combine: two or more tables with matching headers into one.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   COMBINE
   ============================================================================
   Two or more tables with matching headers into one. Modes: merge, intersect,
   difference. The supervisor's suggestion that "set ops" is not a node but a
   setting on Combine.

   Combine reads its inputs separately rather than letting the graph merge them
   first, for the same reason Compare does: it has to know which table is which.
   That is also what keeps it clear of the implicit multi-wire union, which
   matters more than it sounds:

   MERGE CONCATENATES; IT DOES NOT DEDUPLICATE BY DEFAULT.
   The implicit union deduplicates by rowKey(), and for merging two student
   lists that is right. Student 1042 appearing in both branches is one
   student. For stacking two result tables it is wrong, and wrong in a way that
   produces a plausible number rather than an error. Take the supervisor's own
   worked example: run a Histogram once per year, stack the two rows, total the
   columns. rowKey() has no id column to work with there, so it falls back to
   joining the whole row, and if 2022 and 2023 happen to produce identical
   counts, the two rows are identical, one is discarded, and the sum silently
   halves. The failure is invisible precisely when the data is unremarkable.

   So row identity is a choice the user makes, not one the tool makes for them:
   merge concatenates, and dropping duplicates is a tick box. That also gives a
   true set union (merge + drop duplicates) alongside intersect and difference,
   which is what "set ops" meant in the first place.                          */

/* Merge adds vertically: more rows, same columns. Join adds horizontally: same
   rows or fewer, more columns. Intersect and difference are the set operations
   on rows. All four are one node because they all answer "these branches should
   become one table" and differ only in how. Putting the horizontal case in a
   node of its own would have meant two nodes with the same two input ports, the
   same base picker and the same key column, differing in one line. */
var COMBINE_MODES = [
  { key:'merge',      label:'Merge (stack rows)' },
  { key:'join',       label:'Join (add columns)' },
  { key:'intersect',  label:'Intersect (in all inputs)' },
  { key:'difference', label:'Difference (in the base only)' }
];

function combineMode(node) {
  var k = node && node.cfg ? node.cfg.mode : null;
  for (var i = 0; i < COMBINE_MODES.length; i++) if (COMBINE_MODES[i].key === k) return COMBINE_MODES[i];
  return COMBINE_MODES[0];
}

/* Which input is the base. Intersect is symmetric, but difference is not
   (A minus B is not B minus A), and connection order is an artefact of the
   order two nodes happened to be dragged together, which is invisible on the
   canvas. So the base is named explicitly, defaulting to the first input and
   falling back to it whenever the saved choice is no longer connected. */
function combineBaseId(node, inIds) {
  if (!inIds.length) return null;
  var saved = node && node.cfg ? node.cfg.base : null;
  for (var i = 0; i < inIds.length; i++) if (String(inIds[i]) === String(saved)) return inIds[i];
  return inIds[0];
}

/* The column that decides whether two rows are "the same row". Whole-row
   equality is a poor default for set operations: a float that differs in the
   last place makes two rows that mean the same thing compare unequal. An
   explicit key column says what identity means for this data. */
function combineKeyCols(t) {
  return t.columns.filter(function(c){ return c.type !== COLTYPE.COURSES; });
}

function combineKeyCol(node, t) {
  var saved = (node && node.cfg && node.cfg.key) || '';
  var col = saved ? colByKey(t, saved) : null;
  if (col && col.type !== COLTYPE.COURSES) return col;
  if (hasCol(t, 'id')) return colByKey(t, 'id');
  var avail = combineKeyCols(t);
  return avail.length ? avail[0] : null;
}

function keyValuesOf(t, colKey) {
  var set = {};
  var i = colIndex(t, colKey);
  if (i === -1) return set;
  t.rows.forEach(function(r){ set['k' + String(r[i])] = true; });
  return set;
}

/* The permutation that puts the chosen base first, as positions rather than as
   reordered tables. Reordering the tables directly was enough while the base
   was the only thing position meant; join has to reorder two parallel lists
   (the tables, and the upstream labels that name their columns), and deriving
   both from one permutation is what stops them drifting out of step.

   Done here rather than inside combineTables so the reduction itself has one
   rule, "the base is tables[0]", and the mapping from a node id to a position
   stays with the node ids. */
function combineOrder(node, inIds) {
  var baseId = combineBaseId(node, inIds);
  var at = -1;
  for (var i = 0; i < inIds.length; i++) if (inIds[i] === baseId) { at = i; break; }
  var idx = inIds.map(function(_, i){ return i; });
  if (at <= 0) return idx;
  return [at].concat(idx.filter(function(i){ return i !== at; }));
}

/* The name a joined column carries when it has to say where it came from. */
function combineInputLabel(id) {
  var up = findNode(id);
  return up ? upstreamLabel(up) : ('Input ' + id);
}

/* ---- Join: the horizontal combination ------------------------------------ */

/* The joined header. The base contributes every column it has. Each other input
   contributes everything except the key, which is shared rather than repeated.

   A clash is renamed rather than overwritten: two branches off one Source both
   carry Year, and silently dropping the second would lose data while silently
   overwriting the first would lose different data. The incoming key gets a
   suffix and the label says which node it came from, so the header stays unique,
   which matters beyond the screen, since these become CSV column names.

   Derived from headers alone so the schema pass and the evaluator can call the
   same function and cannot disagree about the result's shape. */
function joinColumns(node, heads, labels) {
  if (!heads.length) return [];
  var base = heads[0];
  var keyCol = combineKeyCol(node, base);
  var cols = base.columns.slice();
  var used = {};
  cols.forEach(function(c){ used[c.key] = true; });

  heads.slice(1).forEach(function(h, i) {
    h.columns.forEach(function(c) {
      if (keyCol && c.key === keyCol.key) return;
      var key = c.key, n = 2;
      while (used[key]) { key = c.key + '_' + n; n++; }
      used[key] = true;
      cols.push({
        key: key,
        label: (key === c.key) ? c.label : (c.label + ' \u00b7 ' + (labels[i + 1] || 'input ' + (i + 2))),
        type: c.type, values: c.values, order: c.order, def: c.def, filter: c.filter
      });
    });
  });
  return cols;
}

function joinTables(node, tables, labels, log) {
  var base = tables[0];
  var keyCol = combineKeyCol(node, base);
  if (!keyCol) {
    return { error: 'Join matches rows on a key column, and this table has none that can be used. ' +
      'Every column here is either nested or absent.' };
  }
  for (var i = 1; i < tables.length; i++) {
    if (!hasCol(tables[i], keyCol.key)) {
      return { error: 'Join is matching rows on ' + keyCol.label + ', but ' +
        (labels[i] || 'another input') + ' has no such column. ' +
        'Pick a key column that every input carries.' };
    }
  }

  var cols = joinColumns(node, tables, labels);
  var keepUnmatched = !!(node && node.cfg && node.cfg.keepUnmatched);

  /* Each other input is indexed by key, first row winning. The alternative
     (a row out per matching pair, which is what a relational join does) turns a
     key with repeats into a multiplication: joining two 400-row tables on Year
     would produce 160,000 rows from a single dropdown change. Looking up one
     match keeps the output the size of the base, which is the shape the user is
     looking at when they wire it. Repeats are reported rather than silently
     resolved, so a badly chosen key says so instead of just being wrong. */
  var dupeIn = [];
  var index = tables.slice(1).map(function(t, i) {
    var ki = colIndex(t, keyCol.key), map = {}, dup = 0;
    t.rows.forEach(function(r) {
      var k = 'k' + String(r[ki]);
      if (map[k] === undefined) map[k] = r; else dup++;
    });
    if (dup) dupeIn.push((labels[i + 1] || 'input ' + (i + 2)) + ' (' + dup + ')');
    return { t: t, map: map };
  });

  var bi = colIndex(base, keyCol.key);
  var rows = [], unmatched = 0;

  base.rows.forEach(function(r) {
    var k = 'k' + String(r[bi]);
    var extra = [], miss = false;
    index.forEach(function(ix) {
      var hit = ix.map[k];
      if (!hit) miss = true;
      ix.t.columns.forEach(function(c, ci) {
        if (c.key === keyCol.key) return;
        extra.push(hit ? hit[ci] : null);
      });
    });
    if (miss) {
      unmatched++;
      if (!keepUnmatched) return;
    }
    rows.push(r.concat(extra));
  });

  log.push(logEntry('COMBINE', [{s:'join on'}, {c:'val', s:keyCol.label}, {s:'\u2192'},
    {c:'val', s:rows.length}, {s:'rows,'}, {c:'val', s:cols.length}, {s:'columns'}]));
  if (unmatched) {
    log.push(logEntry('COMBINE', [{s:(keepUnmatched ? 'kept' : 'dropped')},
      {c:'val', s:unmatched}, {s:'base row(s) with no match' + (keepUnmatched ? ' (blank cells)' : '')}]));
  }
  if (dupeIn.length) {
    log.push(logEntry('COMBINE', [{s:'repeated keys in'}, {c:'val', s:dupeIn.join(', ')},
      {s:'(first match used)'}]));
  }

  // meta describes the base's rows against the base's header, which the join has
  // widened. Dropped for the same reason Select drops it.
  return { table: makeTable(cols, rows) };
}

function combineTables(node, tables, log, labels) {
  if (!tables.length) return { table: makeTable([], []) };
  labels = labels || [];
  var mode = combineMode(node);

  /* Matching headers are required by the three modes that work on rows, because
     a row from one input has to be a row of the other's table too. Join is the
     one mode where differing headers are the point, so the check is scoped to
     the modes it describes rather than applied to the node. */
  if (mode.key !== 'join') {
    var first = schemaKey(tables[0]);
    for (var i = 1; i < tables.length; i++) {
      if (schemaKey(tables[i]) !== first) {
        return { error: 'Combine needs inputs with the same columns for ' + mode.key + '. ' +
          'These inputs have different headers, so their rows cannot be stacked. ' +
          'Make the branches produce the same columns, or switch the mode to ' +
          'Join to put their columns side by side instead.' };
      }
    }
  }

  if (tables.length === 1) {
    log.push(logEntry('COMBINE', [{s:'one input (passed through)'}]));
    return { table: tables[0] };
  }

  if (mode.key === 'join') return joinTables(node, tables, labels, log);

  var base = tables[0];
  var others = tables.slice(1);

  if (mode.key === 'merge') {
    var rows = [];
    tables.forEach(function(t){ rows = rows.concat(t.rows); });
    var total = rows.length;

    if (node && node.cfg && node.cfg.dedupe) {
      var seen = {}, kept = [];
      rows.forEach(function(r) {
        var k = rowKey(base, r);
        if (seen[k]) return;
        seen[k] = true;
        kept.push(r);
      });
      rows = kept;
      log.push(logEntry('COMBINE', [{s:'merge'}, {c:'val', s:tables.length}, {s:'inputs →'},
        {c:'val', s:rows.length}, {s:'rows, ' + (total - rows.length) + ' duplicate(s) dropped'}]));
    } else {
      log.push(logEntry('COMBINE', [{s:'merge'}, {c:'val', s:tables.length}, {s:'inputs →'},
        {c:'val', s:total}, {s:'rows'}]));
    }
    return { table: makeTable(base.columns, rows, base.meta) };
  }

  // intersect / difference
  var keyCol = combineKeyCol(node, base);
  if (!keyCol) {
    return { error: 'Combine needs a column to match rows on for ' + mode.key +
      '. This table has no column that can be used as a key.' };
  }
  var sets = others.map(function(t){ return keyValuesOf(t, keyCol.key); });
  var ki = colIndex(base, keyCol.key);

  var out = base.rows.filter(function(r) {
    var k = 'k' + String(r[ki]);
    if (mode.key === 'intersect') {
      return sets.every(function(s){ return !!s[k]; });
    }
    return sets.every(function(s){ return !s[k]; });   // difference
  });

  log.push(logEntry('COMBINE', [{s:mode.key + ' on'}, {c:'val', s:keyCol.label},
    {s:'→'}, {c:'val', s:out.length}, {s:'of'}, {c:'val', s:base.rows.length}, {s:'base rows'}]));

  return { table: makeTable(base.columns, out, base.meta) };
}

