/* engine/histogram.js: Histogram: a group-by whose groups are ranges.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   HISTOGRAM: a group-by whose groups are ranges
   ============================================================================
   SelectFor is built on one sentence, taken from filterFields(): "grouping by a
   column means filtering on it once per label". This node is the same sentence
   with one word changed. A bin is the rows a Filter would keep for one RANGE,
   and ranges are a thing the tool already has: the `between` operator, added
   for "a mark between 70 and 80".

   WHY IT IS NOT JUST SELECTFOR
   SelectFor groups by value, which is a histogram already for any column with
   few enough values: group by Grade and the distribution comes out, in the
   declared A+ to D order, with no node needed here. It falls apart the moment
   the column is continuous. The 2024 archive has 248 students and 83 distinct
   GPAs, so grouping by GPA is 83 rows of mostly one, which is a list of
   students wearing a summary's shape. What is missing is not a way to group. It
   is a way to decide which values count as the same.

   THE EDGES, AND WHY THEY ARE NOT THE DATA'S
   The first edge is a multiple of the width, not the smallest value present.
   Anchoring to the data means two runs over two years produce bins that do not
   line up, and a comparison between them is then quietly meaningless: 2023's
   "4.3 to 5.3" against 2024's "4.1 to 5.1". Multiples of the width are the same
   bins for everyone, which is what makes two histograms comparable at all.

   THE BOUNDARY RULE, WHICH IS THE PART THAT GOES WRONG
   `between` includes both ends: applyCriterion's band keeps 70 for "70 to 80"
   AND for "60 to 70", which is right for a filter and fatal for a histogram,
   where it counts one row twice and the bins no longer sum to the rows. So the
   bins are not built out of `between`. Each row is placed by arithmetic instead,
   floor((v - first) / width), which puts every value in exactly one bin by
   construction rather than by a comparison that has to be got right twice. Bins
   are therefore half-open, [lo, hi), and the last one closed so the maximum has
   somewhere to go. A test sums the bins and compares against the rows that went
   in, because that is the property this decision exists to protect.

   EMPTY BINS SURVIVE
   A gap in the middle of a distribution is the finding. Bins are generated from
   the edges rather than discovered from the data, so a range nothing falls in
   comes out as a zero. This is the same thing SelectFor's Labels port buys, for
   the same reason, and is why neither node groups by "what happened to be
   there" when it can avoid it.

   WHAT COMES OUT
   SelectFor's shape exactly: a label column, then one column per measure, with
   the per-bin tables in meta.branches in Compare's format. Downstream, a
   histogram IS a breakdown, so Sort, Take, the Output's per-group cards and the
   long-form CSV all work without any of them learning this node exists.

   Measures are the full set rather than Count alone. "Average mark per GPA
   band" is the second question anyone asks of a distribution, and the machinery
   for it is already here.                                                     */

var HIST_BINS_WANTED = 10;   // roughly, when nobody has said how wide a band is
var HIST_MAX_BINS = 200;     // past this it is not a distribution, it is the data

/* Floating point: a value sitting exactly on an edge must not fall through to
   the bin below because (4.8 - 0) / 0.8 came to 5.999999999999999. The nudge is
   far smaller than any width a person would type and far larger than the error
   it is covering. */
var HIST_EPS = 1e-9;

// The columns worth binning are the ones worth measuring: numbers, minus the
// identifiers, for the reason measurableCols() gives about summing student IDs.
function binnableCols(t) { return measurableCols(t); }

/* Resolved against the arriving table rather than trusted from the config, the
   way every other node resolves a saved column. Both walks call this, so they
   cannot disagree about what is being binned. */
function binField(node, t) {
  var cols = binnableCols(t);
  if (!cols.length) return null;
  var key = (node && node.cfg && node.cfg.by) || '';
  for (var i = 0; i < cols.length; i++) if (cols[i].key === key) return cols[i];
  return cols[0];
}

/* Stored as typed and coerced on read, the same way Take stores N. A number
   input yields '' mid-edit and would otherwise have to be given a value the
   user has not finished choosing. Zero and negative widths are not a narrower
   histogram, they are no histogram. All of those mean "decide for me", which is
   null here and a width chosen from the data at evaluation time. */
function binWidth(node) {
  var n = Number(node && node.cfg ? node.cfg.width : undefined);
  return (isFinite(n) && n > 0) ? n : null;
}

/* A width nobody typed. A fixed default cannot work across these columns: ten
   is sensible for a mark out of a hundred and absurd for a GPA out of nine,
   where it puts the whole cohort in one band and calls it a distribution.

   So the width comes from the data, rounded to a number a person would have
   chosen. Aiming for about ten bands and then snapping to 1, 2, 2.5 or 5 times
   a power of ten is the same rule an axis uses to pick its tick marks, and for
   the same reason: bands of 2.5 can be read at a glance, bands of 2.7183
   cannot. */
function autoWidth(min, max) {
  var span = max - min;
  if (!(span > 0)) return 1;                 // one value, or all the same
  var raw = span / HIST_BINS_WANTED;
  var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  var steps = [1, 2, 2.5, 5, 10];
  for (var i = 0; i < steps.length; i++) {
    if (raw <= steps[i] * mag + 1e-12) return steps[i] * mag;
  }
  return 10 * mag;
}

/* An edge as a person would write it. Widths are typed by hand and can be
   fractional, so the printed precision follows the width rather than being
   fixed: bins of 0.25 need two places, bins of 10 need none, and neither wants
   the other's trailing zeros. */
function fmtEdge(n, w) {
  var dp = 0, step = w;
  while (dp < 4 && Math.abs(step - Math.round(step)) > 1e-9) { step *= 10; dp++; }
  var out = n.toFixed(dp);
  return out === '-0' ? '0' : out;
}

/* "70 to 80", not "70-80". A hyphen between two numbers is what Excel reads as
   a date, and these results are exported to be opened in Excel. */
function binLabel(lo, hi, w) { return fmtEdge(lo, w) + ' to ' + fmtEdge(hi, w); }

/* The edges, from the values present and the chosen width. Returns null when
   there is nothing to bin, and an error when the answer would be thousands of
   rows: a width of 0.01 over grade points is not a question anyone asked, and
   silently building 900 bins helps nobody. */
function binsFor(values, w) {
  if (!values.length) return null;
  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  var first = Math.floor(min / w) * w;
  var last  = Math.floor((max - first) / w + HIST_EPS);
  if (last + 1 > HIST_MAX_BINS) {
    return { error: (last + 1) + ' bins of ' + fmtEdge(w, w) + ' would be needed to cover ' +
      fmtEdge(min, w) + ' to ' + fmtEdge(max, w) + '. Widen the bins: at most ' +
      HIST_MAX_BINS + ' fit in a readable table.' };
  }
  var out = [];
  for (var i = 0; i <= last; i++) {
    var lo = first + i * w;
    out.push({ lo: lo, hi: lo + w, label: binLabel(lo, lo + w, w) });
  }
  return { first: first, last: last, bins: out };
}

/* The label column. Fixed key 'group', exactly as SelectFor fixes it, so a
   downstream node reaches for the same thing whichever of the two produced the
   table. TEXT, because "70 to 80" is what the cell says, with the bin labels
   declared as its value set and its order: that is what makes a downstream Sort
   put 100 to 110 after 90 to 100 rather than after 10 to 20, and what lets a
   downstream Filter offer the bins as a dropdown. Computable from the header
   alone it is not, so the ordering is attached by the evaluator, where the bins
   are known, and the schema walk declares the column without it. */
function binColumn(node, t) {
  var col = binField(node, t);
  return {
    key:   'group',
    label: col ? col.label : 'Bin',
    type:  COLTYPE.TEXT
  };
}

function histogramColumns(node, t) {
  return [binColumn(node, t)].concat(measureColumns(node, t));
}

function applyHistogram(node, t, log) {
  var cols = histogramColumns(node, t);
  var col = binField(node, t);

  if (!col) {
    // No numeric column to bin: an unwired node, or a table of text. Said
    // rather than returned as an empty distribution, which reads as a claim
    // about the data instead of about the graph.
    log.push(logEntry('HISTOGRAM', [{s:'no numeric column in this table to bin'}]));
    return { table: makeTable(cols, []) };
  }

  var idx = colIndex(t, col.key);

  // The values, and the rows that have none. A blank mark is not a mark of
  // zero, so it belongs in no bin, for the same reason reduceValues() skips it.
  var values = [], blanks = 0;
  t.rows.forEach(function(r) {
    var v = Number(r[idx]);
    if (r[idx] === '' || r[idx] === null || r[idx] === undefined || !isFinite(v)) blanks++;
    else values.push(v);
  });

  if (!values.length) {
    log.push(logEntry('HISTOGRAM', [{c:'val', s:col.label}, {s:'has no values to bin'}]));
    return { table: makeTable(cols, []) };
  }

  // Chosen from the values when nobody has typed one, which needs the values,
  // which is why this happens here and not in the panel.
  var w = binWidth(node);
  if (w === null) w = autoWidth(Math.min.apply(null, values), Math.max.apply(null, values));

  var spec = binsFor(values, w);
  if (spec.error) return { error: spec.error };

  // Every row into exactly one bin, by arithmetic rather than by comparison.
  var groups = spec.bins.map(function(b) {
    return { label: b.label, value: b.label, lo: b.lo, hi: b.hi, table: makeTable(t.columns, []) };
  });
  t.rows.forEach(function(r) {
    var v = Number(r[idx]);
    if (r[idx] === '' || r[idx] === null || r[idx] === undefined || !isFinite(v)) return;
    var i = Math.floor((v - spec.first) / w + HIST_EPS);
    if (i < 0) i = 0;
    if (i > spec.last) i = spec.last;   // the last bin is closed, so the maximum lands in it
    groups[i].table.rows.push(r);
  });

  var stats = statsOf(node);
  var statCols = stats.map(function(s){ return statCol(s, t); });
  var total = t.rows.length;

  var rows = groups.map(function(g) {
    return [g.value].concat(measureValues(g.table, stats, statCols, total));
  });

  // The order the bins are in IS their order, and saying so on the column is
  // what keeps a downstream Sort from reading these labels alphabetically.
  cols[0] = {
    key: cols[0].key, label: cols[0].label, type: cols[0].type,
    values: groups.map(function(g){ return g.label; }),
    order:  groups.map(function(g){ return g.label; })
  };

  log.push(logEntry('HISTOGRAM', [
    {c:'val', s:col.label},
    {s:'in bands of'}, {c:'val', s:fmtEdge(w, w)},
    {c:'op', s:'->'},
    {c:'val', s:groups.length}, {s:(groups.length === 1 ? 'bin' : 'bins')},
    {s:'over'}, {c:'val', s:values.length}, {s:'rows'}
  ]));
  if (blanks) {
    log.push(logEntry('SKIP', [
      {c:'val', s:blanks}, {s:(blanks === 1 ? 'row has' : 'rows have')},
      {s:'no'}, {c:'val', s:col.label}, {s:'and are in no bin'}
    ]));
  }

  return { table: makeTable(cols, rows, {
    branches: groups,
    measures: stats.map(function(s){ return selectForOp(s && s.op).key; }),
    title:   'Distribution',
    unit:    (groups.length === 1 ? 'bin' : 'bins')
  }) };
}

