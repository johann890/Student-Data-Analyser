/* engine/combine.js: Combine. Two or more tables with matching headers into
   one. Modes: merge, intersect, difference. Set operations are a setting on
   this node rather than a node of their own.

   Combine reads its inputs separately rather than letting the graph merge them
   first, for the same reason Compare does: it has to know which table is which.
   That also keeps it clear of the implicit multi-wire union.

   MERGE CONCATENATES; IT DOES NOT DEDUPLICATE BY DEFAULT. The implicit union
   deduplicates by rowKey(), which is right for merging two student lists, where
   student 1042 in both branches is one student. It is wrong for stacking two
   result tables, and wrong in a way that produces a plausible number rather
   than an error: run a Histogram once per year and stack the rows, and rowKey()
   has no id column to work with, so it joins the whole row. If 2022 and 2023
   produce identical counts, one row is discarded and the total silently halves.

   So row identity is the user's choice: merge concatenates, and dropping
   duplicates is a tick box. That also gives a true set union (merge plus drop
   duplicates) alongside intersect and difference. */

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

/* WHAT AN INPUT IS CALLED
   A joined column has to say which input it came from, and the only name
   available used to be the node's own: "Select For #5". Three branches joined
   to compare 2022, 2023 and 2024 produced "Count", "Count · Select For #5" and
   "Count · Select For #7", so the one thing the columns would not tell you was
   which year each was, and the id changes if the query is rebuilt.

   So an input can be named, in the same shape Compare names a branch: a map on
   the node keyed by the INPUT'S node id, written through the same `label:<id>`
   control key, falling back to the automatic name when empty. Compare's
   precedent is followed rather than a second convention invented, down to the
   placeholder saying the automatic name is still there.

   Keyed by id and not by position, because a wire can be removed: naming the
   second input and then deleting the first would otherwise move the name onto a
   table it was never about. */
var COMBINE_LABEL_MAX = 40;

/* The name the user gave this input, or '' for none. Trimmed and capped HERE
   rather than only by the control's maxlength, because the same value can
   arrive from a saved file, and one rule is better than two. That is the
   arrangement setVarName() uses, for the same reason. The cap is 40 because
   this becomes a column header, on screen and in an exported CSV, and a header
   long enough to break the table is not a name. */
function combineLabelOf(node, id) {
  var m = node && node.cfg && node.cfg.labels;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return '';
  var v = m[id];
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, COMBINE_LABEL_MAX);
}

/* The name a joined column carries when it has to say where it came from: what
   the user called this input, or the node's own name when they have not said. */
function combineInputLabel(node, id) {
  return combineLabelOf(node, id) || (function() {
    var up = findNode(id);
    return up ? upstreamLabel(up) : ('Input ' + id);
  })();
}

/* Join: the horizontal combination */

/* The joined header. The base contributes every column it has; each other
   input contributes everything except the key, which is shared rather than
   repeated.

   A clash is renamed rather than overwritten, because two branches off one
   Source both carry Year and dropping or overwriting either loses data. The
   incoming key gets a suffix and the label says which node it came from, so the
   header stays unique. That matters beyond the screen: these become CSV column
   names.

   NAMING AN INPUT CHANGES WHAT ITS COLUMNS ARE CALLED, and nothing else. An
   input nobody has named behaves as it always did, so existing queries read the
   same: the automatic name appears only on a column renamed to avoid a clash.

   A named input differs in two ways. Its columns always carry the name, whether
   or not anything clashed. And when it contributes exactly one column, the name
   IS that column's label rather than a suffix: three branches named 2022, 2023
   and 2024 give "Took course, 2022, 2023, 2024". Two or more columns cannot
   share one header, so there the name is appended to each: "Count · 2023",
   "Average · 2023".

   The shared key column is never renamed, since it belongs to no one input.

   Labels are made unique as well as keys, or two inputs named the same thing
   would produce columns a reader cannot tell apart and a CSV with two identical
   headers.

   Derived from headers alone, so the schema pass and the evaluator call the
   same function and cannot disagree about the result's shape. */
function joinColumns(node, heads, labels, ids) {
  if (!heads.length) return [];
  var keyCol = combineKeyCol(node, heads[0]);
  var isKey = function(c){ return !!(keyCol && c.key === keyCol.key); };
  var cols = [], usedKeys = {}, usedLabels = {};

  /* Every column is rebuilt rather than carried by reference, including the
     base's, which used to come through untouched. A named base has to be
     relabelled like any other input, and relabelling a column object that the
     upstream header still owns would rename it upstream too. Copied whole
     rather than through a list of properties, so a property added to a column
     tomorrow survives the join without this function being edited. */
  var take = function(c, labelFor) {
    var key = uniqueAgainst(usedKeys, c.key, '_');
    var label = uniqueAgainst(usedLabels, labelFor(key), ' ');
    usedKeys[key] = true;
    usedLabels[label] = true;
    var out = {};
    Object.keys(c).forEach(function(p){ out[p] = c[p]; });
    out.key = key;
    out.label = label;
    cols.push(out);
  };

  heads.forEach(function(h, i) {
    var name = (ids && ids.length > i) ? combineLabelOf(node, ids[i]) : '';
    // What this input adds to the header, the shared key aside. Decides whether
    // a name can stand as a column label or has to be appended to one.
    var brings = h.columns.filter(function(c){ return !isKey(c); }).length;

    h.columns.forEach(function(c) {
      if (isKey(c)) {
        // The base carries the shared key; the others do not repeat it.
        if (i === 0) take(c, function(){ return c.label; });
        return;
      }
      if (name) {
        take(c, function(){
          return brings === 1 ? name : (c.label + ' \u00b7 ' + name);
        });
        return;
      }
      take(c, function(key) {
        return key === c.key
          ? c.label
          : (c.label + ' \u00b7 ' + (labels[i] || 'input ' + (i + 1)));
      });
    });
  });
  return cols;
}

function joinTables(node, tables, labels, log, ids) {
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

  var cols = joinColumns(node, tables, labels, ids);
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

  /* WHEN THE HEADER CANNOT SAY WHICH INPUT A COLUMN CAME FROM
     Three per-year branches joined on course give three columns that all began
     as Count. The header keeps them apart asymmetrically: the base's stays bare
     Count while the others pick up the automatic name of the node they came
     from, so "Count, Count · Select For #5, Count · Select For #7" says nothing
     about which year is which.

     Named rather than fixed, deliberately. Renaming the base's column would
     make the three symmetric, and would also change the header of every saved
     query that ever joined unnamed inputs. So the log says what the header
     cannot and points at the control that does fix it. An input the user HAS
     named needs none of this, which is why only unnamed ones are counted. */
  var sharedFrom = {};
  tables.forEach(function(t, i) {
    var named = !!(ids && ids.length > i && combineLabelOf(node, ids[i]));
    t.columns.forEach(function(c) {
      if (c.key === keyCol.key) return;
      var e = sharedFrom[c.label] || (sharedFrom[c.label] = { n: 0, bare: 0 });
      e.n++;
      if (!named) e.bare++;
    });
  });
  var ambiguous = Object.keys(sharedFrom).filter(function(l) {
    return sharedFrom[l].n > 1 && sharedFrom[l].bare > 0;
  });
  if (ambiguous.length) {
    /* The semicolon rides inside the part before it, because logHTML joins parts
       with a space and "came from Count ; name the inputs" is not a sentence. */
    log.push(logEntry('COMBINE', [{c:'val', s:ambiguous.map(function(l) {
      return sharedFrom[l].n + ' columns came from ' + l;
    }).join(', ') + ';'}, {s:'name the inputs to say which is which'}]));
  }

  // meta describes the base's rows against the base's header, which the join has
  // widened. Dropped for the same reason Select drops it.
  return { table: makeTable(cols, rows) };
}

function combineTables(node, tables, log, labels, ids) {
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

  if (mode.key === 'join') return joinTables(node, tables, labels, log, ids);

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

  /* HOW MANY THINGS, AS AGAINST HOW MANY ROWS
     The line above counts rows, which is what came out, and says nothing about
     how many distinct keys those rows cover. Where the base holds one row per
     key the two numbers are the same and this says nothing.

     Where it does not, the gap is the whole answer. A migration query asks which
     students were in one major before a date and another after it: the "before"
     branch spans several years, so it holds a row per student per year, and an
     intersect on ID returns six rows for three students. Six is a true count of
     rows and a false answer to the question that was asked, and nothing else on
     screen distinguishes them, since every one of those rows is a real row the
     reader can see.

     Counted over the rows that came out rather than the rows that went in,
     because the result is what gets read, exported and quoted.              */
  var distinct = {}, nDistinct = 0;
  out.forEach(function(r) {
    var k = 'k' + String(r[ki]);
    if (!distinct[k]) { distinct[k] = true; nDistinct++; }
  });
  if (nDistinct !== out.length) {
    log.push(logEntry('COMBINE', [{s:'those'}, {c:'val', s:out.length},
      {s:'rows cover'}, {c:'val', s:nDistinct}, {s:'distinct'},
      {c:'val', s:keyCol.label}]));
  }

  return { table: makeTable(base.columns, out, base.meta) };
}

