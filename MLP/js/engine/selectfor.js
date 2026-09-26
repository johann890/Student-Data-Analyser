/* engine/selectfor.js: Select For: a group-by whose groups are named rather than wired.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   SELECT FOR: A group-by whose groups are named rather than wired
   ============================================================================
   The node Compare was always standing in for. Compare makes the user build one
   Filter chain per group and wire each of them in by hand; this names the
   column to split on and does it once per value.

   Placed here, after the aggregation section, because that is where the parts
   it is assembled from are: AGG_OPS, reduceValues and measurableCols all come
   from Aggregate, and a `var` list built by concatenating one of them has to
   run after it. Reading order agrees with that. A group-by is an aggregation
   with a label, and it is next to the two Branches nodes it shares a menu and
   a colour with.

   The definition it is built from is one already written down, at the top of
   filterFields():

     "Grouping by a column means filtering on it once per label. How many in
      2022, how many in 2023 is a filter for each year."

   Taken literally, that is the whole implementation. A group is the rows a
   Filter would keep for one value, so the matching is applyCriterion's, with
   the value coming from a label instead of from a text box. Nothing here
   reimplements what it means to match: not string versus number comparison,
   not the nested "took this course" test, not the COURSES column at all. That
   is why a node covering four of the supervisor's use cases is this short, and
   why it groups by things that are not columns. "Took course" is a predicate
   Filter already owns, and a predicate is all a group needs.

   TWO PORTS, AND WHY THE SECOND IS OPTIONAL
   `data` is the table being summarised. `labels` is one row per group to
   report on, and leaving it empty means "use the values that are in the data".

   Three things the labels port buys that a column alone cannot:

     1. Zero-count groups survive. Grouping the data by its own values cannot
        produce a row for a course nobody took. The interesting zero is the
        one value that is missing. Wire the 2022 course list into `labels` and
        it comes out as 0.
     2. The groups can come from a different query than the rows. "For each
        course that ran in 2022, how many took it in 2024" is two branches, and
        no single table holds both halves.
     3. The label set can be narrowed, widened or ordered by ordinary nodes.
        A Sort and a Take in front of the labels port is "the ten biggest",
        built out of the same nodes as everything else.

   WHAT COMES OUT
   One row per group: a label column, then one column per measure. That is
   Compare's shape, deliberately. A node meant to replace Compare that emitted
   something else would leave every downstream node with two cases to handle.
   The per-group tables ride in meta.branches in Compare's format too, which is
   what gives the Output its per-group detail cards and the long-form CSV
   export without either of them learning this node exists.

   WHAT IS DELIBERATELY NOT HERE
   No ordering control, though Compare has one. Groups come out in the label
   set's own order (the labels table's row order, or the grouping column's own
   comparator when the values come from the data), and anything else is a Sort.
   Compare's Order setting predates Compare being allowed to feed Sort; an
   in-node copy of a node that is one wire away is the shortcut this tool keeps
   deleting, most recently the Output's Average.                              */

/* The fields it can group by are the fields a Filter can test, minus the one
   that needs a second value to mean anything: "grade in course" is a course
   AND a mark, so a bare label cannot supply it. Everything else follows the
   incoming table, so this node knows nothing about students either. */
function groupFields(t) {
  return filterFields(t).filter(function(f){ return f.kind !== 'courseGrade'; });
}

/* Resolved against the table rather than trusted from the config, the way
   every other node resolves a saved column: rewiring this node behind a
   different branch can outlive the field it was set to, and falling back to a
   real field beats grouping by nothing. Both walks call this, so they cannot
   disagree about what is being grouped. */
function groupField(node, t) {
  var fs = groupFields(t);
  if (!fs.length) return null;
  var key = (node && node.cfg && node.cfg.by) || '';
  for (var i = 0; i < fs.length; i++) if (fs[i].key === key) return fs[i];
  return fs[0];
}

/* The label column. Its key is fixed at 'group' (Compare fixes 'branch' for
   the same reason), so that what a downstream node reaches for does not change
   when the grouping does, and so that it can never collide with a measure key.

   Its TYPE is copied from the column being grouped on, along with any declared
   value set or order. That is what keeps a breakdown by Year sorting 2022,
   2023, 2024 rather than lexically, and what lets a downstream Filter offer
   the same dropdown it would have offered upstream. */
function groupColumn(node, t) {
  var f = groupField(node, t);
  if (!f) return { key:'group', label:'Group', type:COLTYPE.TEXT };
  var src = f.column;
  var col = {
    key:   'group',
    label: f.label,
    type:  src ? src.type : (f.kind === 'courseLevel' ? COLTYPE.NUMBER : COLTYPE.TEXT)
  };
  if (src && src.values) col.values = src.values;
  if (src && src.order)  col.order  = src.order;
  return col;
}

/* The measures, and why they are not Compare's.

   Compare offers a fixed three and guesses which column "average" refers to.
   The guess is the part worth removing: defaultAvgCol() picks gpa, then
   gradePoints, then the first numeric column that is not an identifier, and on
   a table it did not anticipate that is a silent choice presented as a number.
   Here a measure is an operation AND a column, resolved the way Aggregate
   resolves its own, so the header says which column it measured.

   The operation set is AGG_OPS plus one. It is built by concatenation rather
   than by adding an entry to AGG_OPS, because AGG_OPS is what the three
   Aggregate nodes offer and "share of total" is meaningless on a single table.
   A share needs the other groups to be a share OF. */
var SELECTFOR_OPS = AGG_OPS.concat([
  { key:'share', label:'Share of total', verb:'Share of', needsCol:false, head:'Share %' }
]);

function selectForOp(key) {
  for (var i = 0; i < SELECTFOR_OPS.length; i++) {
    if (SELECTFOR_OPS[i].key === key) return SELECTFOR_OPS[i];
  }
  return SELECTFOR_OPS[0];   // count: Anything unrecognised, including a hand-edited file
}

function newStat() { return { op:'count', col:'' }; }

/* A fresh array of fresh objects every time, which measuresOf() does not have
   to do because its default holds strings. These hold objects, and handing the
   same two out to every unconfigured node on the canvas would make one node's
   edit everyone's. */
function defaultStats() { return [newStat()]; }

/* Array.isArray rather than a truthy length check, for the reason measuresOf()
   gives: a string has .length, and a loaded file with stats:"count" would
   otherwise yield one garbage measure per character. */
function statsOf(node) {
  var s = node && node.cfg && node.cfg.stats;
  return (Array.isArray(s) && s.length) ? s : defaultStats();
}

/* Which column one measure applies to. Resolved against the table exactly as
   aggregateCol() does, and against the WHOLE data table rather than a group's
   rows. A per-group resolve could reach different columns in different groups
   and the one header would then be true of neither. */
function statCol(stat, t) {
  var op = selectForOp(stat && stat.op);
  if (!op.needsCol) return null;
  var key = (stat && stat.col) || '';
  var col = key ? colByKey(t, key) : null;
  if (col && isMeasurable(t, col)) return col;
  var avail = measurableCols(t);
  return avail.length ? avail[0] : null;
}

/* The output header, built once and called by both walks. The registry
   invariant for this node is exactly "these two agree", and one function is
   the only way to be sure of it. Reads t.columns and never t.rows, so passing
   a header-only table gives the same answer as passing the real one.

   Duplicate keys are suffixed rather than allowed. Two measures can legitimately
   be the same operation on the same column ("count, count" is a mistake, but
   "average gpa" twice while the second is being retargeted is not), and
   colIndex() answers with the first match, so an unsuffixed duplicate would be
   a column nothing downstream could ever reach. */
function measureColumns(node, t) {
  var seen = { group:true };
  var cols = [];

  statsOf(node).forEach(function(s) {
    var op = selectForOp(s && s.op);
    var col = op.needsCol ? statCol(s, t) : null;
    var base = op.key + (col ? '_' + col.key : '');
    var key = base, n = 2;
    while (seen[key]) { key = base + '_' + n; n++; }
    seen[key] = true;
    cols.push({
      key:   key,
      label: op.needsCol ? (col ? op.verb + ' ' + col.label : op.label) : (op.head || op.label),
      type:  COLTYPE.NUMBER
    });
  });
  return cols;
}

/* In bands mode the group column is the BINNED column's name over text cells,
   exactly as Histogram's is: "Fail" is not a GPA, so carrying GPA's numeric
   type and value set across would describe cells that cannot appear. The
   band names become the column's order in the evaluator, where they are known.

   The column that gets banded is resolved by binField(), the same resolver
   Histogram uses and against the same set of measurable columns, because it is
   the same question: which number are we putting in ranges. */
function selectForGroupColumn(node, t, lt) {
  if (!selectForUsesBands(node, lt)) return groupColumn(node, t);
  var col = binField(node, t);
  return { key:'group', label: col ? col.label : 'Band', type: COLTYPE.TEXT };
}

function selectForColumns(node, t, lt) {
  return [selectForGroupColumn(node, t, lt)].concat(measureColumns(node, t));
}

/* One group's measures, in the order the header declares them. Shared with
   Histogram, whose groups are ranges rather than values but whose measures are
   the same question asked of the same rows. `total` is the denominator a share
   divides by, decided by the caller for the reason the SELECT FOR block gives
   at length: it is the rows that came in, not the sum of the groups. */
function measureValues(groupTable, stats, statCols, total) {
  return stats.map(function(s, si) {
    var op = selectForOp(s && s.op);
    if (op.key === 'share') return total ? (groupTable.rows.length / total) * 100 : 0;
    if (!op.needsCol)       return groupTable.rows.length;      // count
    var col = statCols[si];
    if (!col) return null;   // no column the measure could apply to. Blank, as Aggregate does
    return reduceValues(op.key, columnValues(groupTable, col.key));
  });
}

/* THE GROUPS THEMSELVES

   From a wired labels table: its own row order, deduplicated, blanks dropped.
   The order is not re-derived here because the user has already chosen it
   (possibly with a Sort on that very branch), and re-sorting would make that
   Sort invisible, which is the failure mode this tool spends most of its
   comments avoiding.

   From the data: the distinct values present, put in the grouping column's own
   order. Appearance order would be deterministic too, but "2023, 2022, 2024"
   because that is how the rows happened to arrive is a table that looks wrong
   and is not, which costs more to explain than the sort costs to run. */
/* A nested enrolment list is not a label: there is no one value in it to name
   a group with. Same exclusion sortableCols() and uniqueCols() make, for the
   same reason. */
function labelCols(t) {
  return t.columns.filter(function(c){ return c.type !== COLTYPE.COURSES; });
}

function labelsFromTable(node, lt) {
  if (!lt || !lt.columns.length) return [];
  var key = (node && node.cfg && node.cfg.labelCol) || '';
  var col = key ? colByKey(lt, key) : null;
  if (!col || col.type === COLTYPE.COURSES) col = labelCols(lt)[0] || null;
  if (!col) return [];

  var i = colIndex(lt, col.key), seen = {}, out = [];
  lt.rows.forEach(function(r) {
    var v = r[i];
    if (isBlank(v)) return;
    if (seen[String(v)]) return;
    seen[String(v)] = true;
    out.push(v);
  });
  return out;
}

/* NAMED BANDS ON THE LABELS PORT
   ---------------------------------------------------------------------------
   The supervisor's generalisation, in his words and his format:

       binName    binMinValue    binMaxValue

   The labels port already answers "which groups exist". This lets a group be a
   RANGE with a name of its own rather than a value, which is the one thing the
   port could not express. A file of four rows is a grading scheme; the same
   four rows next year are the same scheme, which is the property Histogram's
   auto-derived widths cannot have and the reason he asked for this instead.

   WHY A SHAPE AND NOT A SETTING, AND WHY A SETTING AS WELL
   A table whose second and third columns are numbers is read as bands without
   being told to. That is his own principle about the Source applied one node
   further along: the node adapts to the format it is handed.

   Shape alone is not quite enough to be silent about, though. A Histogram with
   two measures emits [group, count, average] and matches that test exactly, so
   auto-detection can be wrong, and wrong in the way this tool keeps warning
   about: a plausible number rather than an error. So the reading is always
   STATED in the panel and in the query log, and `labelsAs` can pin it. Auto is
   the default and covers every case anyone will type by hand.

   THE BOUNDARY RULE, WHICH IS THE PART THAT GOES WRONG
   Histogram's note applies here word for word: the `between` operator includes
   both ends, which is right for a filter and fatal for a distribution, where a
   value on a shared edge lands in two bands and the bands stop summing to the
   rows. So bands are matched half-open, [lo, hi), and a value is tried against
   the closed form only when no half-open band took it.

   That second pass is not a fudge, it is what someone writing

       Fail 0 4 / Pass 4 6 / Merit 6 8 / Excellent 8 9

   means by the last row. Contiguous bands never double-count, because the
   half-open pass always claims the value first; the closed pass only ever
   catches a value sitting on the outer edge of the range the bands cover. */
var SELECTFOR_BAND_ARITY = 3;

/* Read off the header alone, so the schema walk can ask it too. Which reading
   is in force changes the TYPE of the group column (a band is named text,
   a value keeps its own column's type), so the two walks have to agree about
   it before a single row exists. */
function labelsAreBands(lt) {
  if (!lt || lt.columns.length < SELECTFOR_BAND_ARITY) return false;
  return lt.columns[1].type === COLTYPE.NUMBER && lt.columns[2].type === COLTYPE.NUMBER;
}

function selectForLabelMode(node) {
  var m = node && node.cfg ? node.cfg.labelsAs : null;
  return (m === 'values' || m === 'bands') ? m : 'auto';
}

/* Bands need something on the labels port to come from. `labelsAs:'bands'` with
   nothing wired is a setting waiting for a wire, not an empty set of bands. */
function selectForUsesBands(node, lt) {
  if (!lt) return false;
  var m = selectForLabelMode(node);
  if (m === 'bands')  return true;
  if (m === 'values') return false;
  return labelsAreBands(lt);
}

/* Positional, because the format the supervisor specified is positional: first
   column the name, second the minimum, third the maximum. `labelCol` is not
   consulted here for that reason, and the panel says so.

   A row that cannot be a band is dropped and counted rather than guessed at. A
   blank name would produce a group nothing could refer to; a non-numeric edge
   has no comparison to make; hi below lo is a band that can never match, which
   is a typo rather than an empty band. Duplicate names go the same way: the
   group column declares its own order from these names, and two rows sharing
   one would make that order ambiguous and a downstream Filter's dropdown wrong. */
function bandsFromLabels(lt) {
  var bands = [], malformed = 0, duplicates = 0, seen = {};
  if (!lt || !lt.rows) return { bands: bands, malformed: 0, duplicates: 0 };
  lt.rows.forEach(function(r) {
    var name = r[0], lo = Number(r[1]), hi = Number(r[2]);
    if (isBlank(name) || !isFinite(lo) || !isFinite(hi) || hi < lo) { malformed++; return; }
    var key = String(name);
    if (seen[key]) { duplicates++; return; }
    seen[key] = true;
    bands.push({ name: key, lo: lo, hi: hi });
  });
  return { bands: bands, malformed: malformed, duplicates: duplicates };
}

/* Which band a value falls in, or -1. Half-open first so that contiguous bands
   cannot both claim an edge; closed second so the top of the range covered is
   not thrown away. First match wins where bands overlap, and the caller counts
   nothing for that: an overlap is the user's arrangement, and the rows it takes
   are reported by the band that got them. */
function bandIndexOf(bands, v) {
  var i;
  for (i = 0; i < bands.length; i++) if (v >= bands[i].lo && v < bands[i].hi) return i;
  for (i = 0; i < bands.length; i++) if (v >= bands[i].lo && v <= bands[i].hi) return i;
  return -1;
}

function labelsFromData(node, t) {
  var f = groupField(node, t);
  if (!f) return [];
  var seen = {}, out = [];
  function push(v) {
    if (isBlank(v)) return;
    if (seen[String(v)]) return;
    seen[String(v)] = true;
    out.push(v);
  }

  if (f.column) {
    var i = colIndex(t, f.key);
    if (i === -1) return [];
    t.rows.forEach(function(r){ push(r[i]); });
  } else {
    // A course predicate. The values live inside the nested column, one per
    // enrolment, so the distinct set is gathered from there rather than from
    // any cell, which is precisely the set no other node can reach.
    var ci = coursesColIndex(t);
    if (ci === -1) return [];
    var prop = f.kind === 'courseSubject' ? 'subject'
             : f.kind === 'courseLevel'   ? 'level'
             : 'code';
    t.rows.forEach(function(r) {
      (r[ci] || []).forEach(function(e){ push(e[prop]); });
    });
  }

  out.sort(comparatorFor(f.column ||
    (f.kind === 'courseLevel' ? { type:COLTYPE.NUMBER } : null)));
  return out;
}

/* ONE LABEL, ONE SUBSET.

   The criterion is synthesised, not typed. Everything that makes matching
   correct ('2022' from a label equalling 2022 in a cell, "took" reaching
   inside the nested column, a level compared as a number) is applyCriterion's
   and is not repeated here.

   applyCriterion logs every call, and here it is called once per group, so the
   entries go to a sink that is thrown away: SELECT FOR writes one line of its
   own and the per-group detail is in meta.branches. Building a few dozen log
   entries and dropping them costs nothing at these sizes, and it is cheaper
   than a second matching path that could drift from the first. */
function rowsForLabel(t, f, value) {
  var crit = { field: f.key, values: {}, ops: {}, course: '' };
  crit.values[f.key] = value;
  crit.ops[f.key] = 'eq';
  return applyCriterion(t, crit, f, []);
}

/* The banded half of SelectFor. Kept beside the value half rather than woven
   through it: the two share their measures, their share denominator, their
   meta and their output shape, and differ entirely in what a group IS. Braiding
   them would put a conditional inside every one of those. */
function evaluateSelectForBands(node, ctx, t, lt, hasSource) {
  var cols = selectForColumns(node, t, lt);
  var col = binField(node, t);

  if (!col) {
    /* Said, not returned as an empty breakdown. Bands compare numbers, and a
       table with no number to compare is a wiring mistake the user can fix,
       not a distribution that happens to be empty. */
    ctx.log.push(logEntry('SELECT FOR', [
      {s:'no number in this table to put in bands'}]));
    return { table: makeTable(cols, []), hasSource: hasSource };
  }

  var parsed = bandsFromLabels(lt);
  var bands = parsed.bands;
  var idx = colIndex(t, col.key);

  /* Every band becomes a group whether or not anything lands in it. That is
     the whole point of supplying them: a band with no rows is a zero the data
     cannot produce on its own, and the one the supervisor asked for when he
     said one sometimes wants labels that receive no hits. */
  var groups = bands.map(function(b) {
    return { label: b.name, value: b.name, lo: b.lo, hi: b.hi,
             table: makeTable(t.columns, []) };
  });

  var blanks = 0, outside = 0;
  t.rows.forEach(function(r) {
    var raw = r[idx];
    var v = Number(raw);
    // A blank is not a zero, for the reason reduceValues() skips it too.
    if (raw === '' || raw === null || raw === undefined || !isFinite(v)) { blanks++; return; }
    var i = bandIndexOf(bands, v);
    if (i === -1) { outside++; return; }
    groups[i].table.rows.push(r);
  });

  var stats = statsOf(node);
  var statCols = stats.map(function(s){ return statCol(s, t); });
  var total = t.rows.length;

  var rows = groups.map(function(g) {
    return [g.value].concat(measureValues(g.table, stats, statCols, total));
  });

  /* The bands' own order IS their order, declared on the column so a downstream
     Sort does not read them alphabetically and a downstream Filter can offer
     them as a dropdown. Same treatment, and same reason, as Histogram's. */
  cols[0] = {
    key: cols[0].key, label: cols[0].label, type: cols[0].type,
    values: groups.map(function(g){ return g.label; }),
    order:  groups.map(function(g){ return g.label; })
  };

  ctx.log.push(logEntry('SELECT FOR', [
    {c:'val', s:col.label}, {s:'in named bands from the labels branch'},
    {c:'op', s:'->'},
    {c:'val', s:groups.length}, {s:(groups.length === 1 ? 'band' : 'bands')},
    {s:'over'}, {c:'val', s:total}, {s:'rows'}
  ]));
  /* Three different ways rows and bands go missing, said separately because
     they have three different fixes: widen the bands, check the data, or fix
     the band file. One combined count would need all three explanations. */
  if (outside) {
    ctx.log.push(logEntry('SKIP', [
      {c:'val', s:outside}, {s:(outside === 1 ? 'row falls' : 'rows fall')},
      {s:'in no band'}
    ]));
  }
  if (blanks) {
    ctx.log.push(logEntry('SKIP', [
      {c:'val', s:blanks}, {s:(blanks === 1 ? 'row has' : 'rows have')},
      {s:'no'}, {c:'val', s:col.label}, {s:'and are in no band'}
    ]));
  }
  /* Counted apart because they are fixed apart. A malformed row is a typo in
     the band file; a repeat is a table that was never a list of bands, which is
     what a branch of ordinary data rows looks like when it reaches this port.
     One combined count would need both explanations every time. */
  if (parsed.malformed) {
    ctx.log.push(logEntry('SKIP', [
      {c:'val', s:parsed.malformed},
      {s:(parsed.malformed === 1 ? 'band row needs' : 'band rows need')},
      {s:'a name, a lowest value and a highest'}
    ]));
  }
  if (parsed.duplicates) {
    ctx.log.push(logEntry('SKIP', [
      {c:'val', s:parsed.duplicates},
      {s:(parsed.duplicates === 1 ? 'band row repeats a name' : 'band rows repeat a name')},
      {s:'already used'}
    ]));
  }

  return {
    table: makeTable(cols, rows, {
      branches: groups,
      measures: stats.map(function(s){ return selectForOp(s && s.op).key; }),
      title:   'Breakdown',
      unit:    (groups.length === 1 ? 'band' : 'bands')
    }),
    hasSource: hasSource
  };
}

function evaluateSelectFor(node, ctx) {
  var dataRes  = ctx.at('data')[0];
  var labelRes = ctx.at('labels')[0];
  var t = dataRes ? dataRes.table : makeTable([], []);
  var hasSource = !!(dataRes && dataRes.hasSource);
  var lt = labelRes ? labelRes.table : null;

  if (selectForUsesBands(node, lt)) {
    return evaluateSelectForBands(node, ctx, t, lt, hasSource);
  }

  var cols = selectForColumns(node, t, lt);
  var f = groupField(node, t);

  if (!f) {
    // Nothing to group by: an unwired data port, or a table whose every column
    // has opted out of being filtered. Said rather than returned as an empty
    // breakdown, which reads as "no groups found": A claim about the data.
    ctx.log.push(logEntry('SELECT FOR', [{s:'nothing to group by in this table'}]));
    return { table: makeTable(cols, []), hasSource: hasSource };
  }

  var values = labelRes ? labelsFromTable(node, labelRes.table) : labelsFromData(node, t);

  /* A label the criterion cannot use (a word in a column of numbers, say,
     which a wired labels table can easily contain) takes that one group out
     rather than failing the query. The count is logged: a breakdown quietly
     missing a third of its rows is the failure this is guarding against, and
     the guard is only worth having if it says so. */
  var groups = [], skipped = 0;
  values.forEach(function(v) {
    var r = rowsForLabel(t, f, v);
    if (r.error) { skipped++; return; }
    groups.push({ label: String(v), value: v, table: r.table });
  });

  /* The denominator is the rows that came in, not the sum of the groups, and
     the two differ whenever groups overlap. They overlap on every course
     predicate: a student with eight enrolments is in eight of the groups.
     Dividing by the sum would turn "42% of students took COMP103" into 5%.
     A number that is wrong, in range, and impossible to spot. Dividing by the
     input says what it means, and shares that total more than 100% are the
     honest signal that the groups are not a partition.

     This is a deliberate difference from Compare, which divides by the sum of
     its branches. Compare's branches are arbitrary filter chains with no table
     they are all subsets of; a group always has one. */
  var total = t.rows.length;
  var stats = statsOf(node);

  // Resolved once, outside the loop, for the reason statCol() gives.
  var statCols = stats.map(function(s){ return statCol(s, t); });

  var rows = groups.map(function(g) {
    return [g.value].concat(measureValues(g.table, stats, statCols, total));
  });

  ctx.log.push(logEntry('SELECT FOR', [
    {s:'for each'}, {c:'val', s:f.label},
    {s:'from'}, {c:'val', s:(labelRes ? 'the labels branch' : 'the data')},
    {c:'op', s:'->'},
    {c:'val', s:groups.length}, {s:(groups.length === 1 ? 'group' : 'groups')},
    {s:'over'}, {c:'val', s:total}, {s:'rows'}
  ]));
  if (skipped) {
    ctx.log.push(logEntry('SKIP', [
      {c:'val', s:skipped}, {s:(skipped === 1 ? 'label' : 'labels')},
      {s:'this column cannot be matched against'}
    ]));
  }

  /* meta.branches in Compare's shape and under Compare's name, so the Output's
     per-group cards and the long-form export work here without knowing this
     node exists. meta.title is what those cards are headed with; Compare emits
     none and keeps the wording it always had. */
  return {
    table: makeTable(cols, rows, {
      branches: groups,
      measures: stats.map(function(s){ return selectForOp(s && s.op).key; }),
      title:   'Breakdown',
      unit:    (groups.length === 1 ? 'group' : 'groups')
    }),
    hasSource: hasSource
  };
}

