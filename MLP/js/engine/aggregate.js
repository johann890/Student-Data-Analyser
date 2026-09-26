/* engine/aggregate.js: Aggregate, Aggregate Columns and Aggregate Rows: one implementation.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   AGGREGATION
   ============================================================================
   Two nodes, one implementation. Both reduce a set of values to one value; they
   differ only in which set.

     Aggregate         the whole table  ->  a 1x1 table
     AggregateColumns  each column      ->  one row, one value per column

   The names say what survives, not what is destroyed: AggregateColumns keeps
   the columns and collapses the rows beneath them.

   Three decisions apply to both, and are made here rather than per node so the
   two cannot drift apart:

   1. The empty case is blank, not zero. The count of nothing is 0. That is a
      true statement about an empty table. The average, minimum or maximum of
      nothing is not 0; it does not exist. meanOf() returns 0 for an empty
      table, which is why the existing Output card special-cases it and prints
      an em dash. Rather than repeat that trick, these nodes emit null, which
      fmtCell and exportCell already render as empty in both the panel and the
      CSV.

   2. Count means "values that are actually there". On the whole table that is
      the row count; per column it is the number of non-blank cells, which is
      the more useful reading and the one that differs between columns.

   3. A measure that cannot apply to a column yields blank rather than dropping
      the column. Dropping would make the output header depend on the data,
      and matching headers is precisely what Combine will require in order to
      stack two of these results. A header that quietly changes shape when a
      column happens to be non-numeric would break that at the worst moment. */

var AGG_OPS = [
  { key:'count',   label:'Count',   verb:'Count of',   needsCol:false },
  { key:'sum',     label:'Sum',     verb:'Sum of',     needsCol:true  },
  { key:'average', label:'Average', verb:'Average',    needsCol:true  },
  // Next to Average because it answers the same question about the same
  // column, and differs exactly where that matters: a handful of very low
  // marks drags an average down and leaves a median where it was.
  { key:'median',  label:'Median',  verb:'Median',     needsCol:true  },
  { key:'min',     label:'Minimum', verb:'Minimum',    needsCol:true  },
  { key:'max',     label:'Maximum', verb:'Maximum',    needsCol:true  }
];
var AGG_DEFAULT_OP = 'count';

function aggOp(node) {
  var k = node && node.cfg ? node.cfg.op : null;
  for (var i = 0; i < AGG_OPS.length; i++) if (AGG_OPS[i].key === k) return AGG_OPS[i];
  return AGG_OPS[0];   // anything unrecognised, including a hand-edited file
}

// Columns a numeric measure can be applied to. Identifiers are excluded: the
// sum of a set of student IDs is a number, but it is not a fact about anything.
function ID_KEYS() { return { id:1, studentId:1 }; }
function measurableCols(t) {
  var skip = ID_KEYS();
  return numericCols(t).filter(function(c){ return !skip[c.key]; });
}

function isMeasurable(t, col) {
  if (!col || col.type !== COLTYPE.NUMBER) return false;
  return !ID_KEYS()[col.key];
}

/* Reduce a list of raw cell values. Blanks are skipped rather than counted as
   zero. A missing mark is not a mark of nought, and treating it as one drags
   every average down by an amount that depends on how much data is missing. */
function reduceValues(opKey, values) {
  var nums = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (isBlank(v)) continue;
    if (opKey === 'count') { nums.push(1); continue; }
    var n = Number(v);
    if (isFinite(n)) nums.push(n);
  }
  if (opKey === 'count') return nums.length;
  if (!nums.length) return null;              // see decision 1 above
  if (opKey === 'sum')     return nums.reduce(function(a, b){ return a + b; }, 0);
  if (opKey === 'average') return nums.reduce(function(a, b){ return a + b; }, 0) / nums.length;
  if (opKey === 'median') {
    /* Sorted numerically. The default sort is lexical, which puts 100 before
       30 and would pick the wrong middle. An even count averages the two
       middle values rather than picking one, so the median of [1,2,3,4] is
       2.5: taking either alone would claim a value the data does not contain
       is more central than its neighbour. */
    var sorted = nums.slice().sort(function(a, b){ return a - b; });
    var mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  if (opKey === 'min')     return Math.min.apply(null, nums);
  if (opKey === 'max')     return Math.max.apply(null, nums);
  return null;
}

function columnValues(t, key) {
  var i = colIndex(t, key);
  if (i === -1) return [];
  return t.rows.map(function(r){ return r[i]; });
}

/* ---- Aggregate: whole table -> 1x1 ---------------------------------------- */

/* Which column the measure applies to, resolved against the table rather than
   trusted from config. A saved key can outlive its column (rewiring the node
   behind a different branch is enough), so this falls back rather than
   measuring nothing. */
function aggregateCol(node, t) {
  var op = aggOp(node);
  if (!op.needsCol) return null;
  var key = (node && node.cfg && node.cfg.col) || '';
  var col = key ? colByKey(t, key) : null;
  if (col && isMeasurable(t, col)) return col;
  var avail = measurableCols(t);
  return avail.length ? avail[0] : null;
}

// The single column both the schema walk and the engine must agree on. Derived
// in one place so they cannot disagree. The registry invariant depends on it.
function aggregateColumn(node, t) {
  var op = aggOp(node);
  if (!op.needsCol) {
    return { key:'count', label:'Count', type:COLTYPE.NUMBER };
  }
  var col = aggregateCol(node, t);
  return {
    key: op.key,
    label: col ? (op.verb + ' ' + col.label) : op.label,
    type: COLTYPE.NUMBER
  };
}

function aggregateSchema(node, inSchema) {
  return makeTable([aggregateColumn(node, inSchema)], []);
}

function applyAggregate(node, t, log) {
  var op = aggOp(node);
  var outCol = aggregateColumn(node, t);
  var value;

  if (!op.needsCol) {
    value = t.rows.length;
    log.push(logEntry('AGGREGATE', [{s:'count of'}, {c:'val', s:t.rows.length}, {s:'rows'}]));
  } else {
    var col = aggregateCol(node, t);
    if (!col) {
      // No column the measure could apply to. Blank and say so, rather than
      // returning a number that describes nothing.
      log.push(logEntry('AGGREGATE', [{s:op.label.toLowerCase()}, {s:'(no numeric column in this table)'}]));
      return makeTable([outCol], [[null]]);
    }
    value = reduceValues(op.key, columnValues(t, col.key));
    log.push(logEntry('AGGREGATE', [{s:op.label.toLowerCase() + ' of'}, {c:'val', s:col.label},
                                    {s:'over'}, {c:'val', s:t.rows.length}, {s:'rows'}]));
  }
  return makeTable([outCol], [[value]]);
}

/* ---- AggregateColumns: many rows -> one row ------------------------------- */

/* Keys and labels are preserved so the result still reads as the same table.
   That is what makes "run a histogram twice, stack them, total the columns"
   work. Types become NUMBER across the board because every cell is now a
   measure or blank, whatever the column held before. */
function aggregateColumnsSchema(node, inSchema) {
  return makeTable(inSchema.columns.map(function(c) {
    return { key:c.key, label:c.label, type:COLTYPE.NUMBER };
  }), []);
}

function applyAggregateColumns(node, t, log) {
  var op = aggOp(node);
  var out = aggregateColumnsSchema(node, t);

  var skipped = [];
  var row = t.columns.map(function(c) {
    // Count applies to any column: it asks how many values are present, which
    // is a question a text column can answer.
    if (op.key === 'count') {
      return reduceValues('count', columnValues(t, c.key));
    }
    if (!isMeasurable(t, c)) { skipped.push(c.label); return null; }
    return reduceValues(op.key, columnValues(t, c.key));
  });

  log.push(logEntry('AGGREGATE COLUMNS', [{s:op.label.toLowerCase() + ' down'},
                                          {c:'val', s:t.rows.length}, {s:'rows'}]));
  if (skipped.length) {
    log.push(logEntry('AGGREGATE COLUMNS', [{s:'left blank:'}, {c:'val', s:skipped.join(', ')}]));
  }
  return makeTable(out.columns, [row]);
}

/* ---- AggregateRows: one row -> one value, per row ------------------------- */

/* The third member of the family, and the one that runs the other way. Aggregate
   collapses a table to a cell; AggregateColumns collapses each column to a cell
   and emits one row; AggregateRows collapses each ROW to a cell and emits one
   column. Row count is preserved, which is what makes it the counterpart of
   AggregateColumns rather than a second spelling of it:

     AggregateColumns   N rows x M cols  ->  1 row  x M cols   (down each column)
     AggregateRows      N rows x M cols  ->  N rows x 1 col    (across each row)

   THE WHOLE ROW IS REPLACED, not appended to. The settled position is that row
   aggregation assumes a row of measures: totalling a row that still carries a
   student id is not a meaningful operation, so the question of whether the
   answer replaces the row or joins it never arises. Narrowing to the measures
   first is a Select, which is a node that exists, so the composition is
   Select then AggregateRows, and neither node grows a column picker for the
   other's benefit.

   The cost is that a label column goes with everything else: total a histogram
   of one row per year and the years are not in the result. That is the honest
   consequence of the rule above rather than an oversight, and the fix, if it is
   ever wanted, is the general "say which columns are aggregated" approach the
   supervisor described and explicitly deferred. */
function aggregateRowsColumn(node) {
  var op = aggOp(node);
  // No single input column to name, so the measure names itself. Keyed on the
  // op so two of these in series produce distinguishable headers.
  return { key: op.key, label: op.label, type: COLTYPE.NUMBER };
}

function aggregateRowsSchema(node, inSchema) {
  return makeTable([aggregateRowsColumn(node)], []);
}

/* Which cells of a row feed the measure. The same rule AggregateColumns uses,
   applied along the other axis: Count asks how many values are present and any
   column can answer that, while the arithmetic measures take only the columns
   that hold a number and are not an identifier. Resolved once for the table
   rather than per row, since the header does not change between rows. */
function aggregateRowsIdx(node, t) {
  var op = aggOp(node);
  var idx = [];
  t.columns.forEach(function(c, i) {
    if (op.key === 'count' || isMeasurable(t, c)) idx.push(i);
  });
  return idx;
}

function applyAggregateRows(node, t, log) {
  var op = aggOp(node);
  var out = aggregateRowsColumn(node);
  var idx = aggregateRowsIdx(node, t);

  var rows = t.rows.map(function(r) {
    return [reduceValues(op.key, idx.map(function(i){ return r[i]; }))];
  });

  var skipped = t.columns.length - idx.length;
  log.push(logEntry('AGGREGATE ROWS', [{s:op.label.toLowerCase() + ' across'},
                                       {c:'val', s:idx.length},
                                       {s:'column' + (idx.length === 1 ? '' : 's') + ', per row'}]));
  if (skipped > 0) {
    log.push(logEntry('AGGREGATE ROWS', [{s:'ignored'}, {c:'val', s:skipped},
      {s:'non-measure column' + (skipped === 1 ? '' : 's')}]));
  }
  return makeTable([out], rows);
}

