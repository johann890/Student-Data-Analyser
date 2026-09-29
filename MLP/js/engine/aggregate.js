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

/* ---- Aggregate: whole table -> one row ------------------------------------ */

/* IT TAKES A LIST OF MEASURES, not one.

   It used to take exactly one, a measure and the column it applied to, and a
   1x1 table came out. That made the commonest shape of question awkward in a
   way that was easy to miss: "what is the range of GPAs" is a minimum and a
   maximum, and with one measure per node it took two Aggregates on two
   branches and a Combine to put them back beside each other, which then failed
   because neither branch had a column the join could match on. Two nodes, a
   third to reconcile them, and a refusal, for one row of two numbers.

   The list is not a new idea here, it is Select For's, unchanged. Its measures
   are already {op, col} objects under `stats`, already validated on load,
   already added and removed by addStat and removeStat, and already rendered by
   one markup function. So this node reuses measureColumns() and
   measureValues() outright rather than growing its own pair, and the two nodes
   cannot drift apart about what "average of GPA" means or what the column it
   produces is called.

   The reading is the same one Select For has, with the grouping taken away:
   Select For asks the measures of each group, this asks them of the whole
   table, and a Select For with no groups would be this node. That is why the
   column keys match too, `average_gpa` rather than the bare `average` this
   node produced before. The LABEL is unchanged ("Average GPA"), so nothing on
   screen or in an exported file reads differently; only a downstream node that
   had been pointed at the old key has to be pointed again, and every one of
   them resolves a missing key by falling back rather than failing.

   Share of total is deliberately not offered. It divides by the rows that came
   in, which here are the rows being measured, so it could only ever answer
   100%. See statListHTML(), which is handed AGG_OPS for this node alone.     */

function aggregateSchema(node, inSchema) {
  return makeTable(measureColumns(node, inSchema), []);
}

function applyAggregate(node, t, log) {
  var stats = statsOf(node);
  var cols  = measureColumns(node, t);
  var scols = stats.map(function(s){ return statCol(s, t); });

  /* One line, however many measures, because they were all taken over the same
     rows and a line each would say "over 780 rows" three times. A measure with
     no column to apply to says so in place rather than being left out, since a
     blank cell in the result is otherwise unexplained. */
  var said = stats.map(function(s, i) {
    var op = selectForOp(s && s.op);
    if (!op.needsCol) return op.label.toLowerCase();
    return scols[i]
      ? op.label.toLowerCase() + ' of ' + scols[i].label
      : op.label.toLowerCase() + ' (no numeric column)';
  });
  log.push(logEntry('AGGREGATE', [{s: said.join(', ')}, {s:'over'},
                                  {c:'val', s:t.rows.length}, {s:'rows'}]));

  return makeTable(cols, [measureValues(t, stats, scols, t.rows.length)]);
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
   and emits one row; AggregateRows collapses each ROW to a cell, keeping one
   row out for every row in:

     AggregateColumns   N rows x M cols  ->  1 row  x M cols   (down each column)
     AggregateRows      N rows x M cols  ->  N rows x L+1 cols (across each row)

   THE MEASURE COLUMNS ARE REPLACED. THE LABEL COLUMNS ARE CARRIED.

   This used to replace the whole row, on the position that row aggregation
   assumes a row of measures, so a label had no business being there and
   narrowing to the measures first was a Select. The rule was consistent and it
   made the node useless for the thing it is most often reached for. Averaging a
   breakdown, one row per course, produced a column of averages with no courses
   beside them: figures that cannot be read, exported or wired onward, because
   nothing in the table says which row each one belongs to. Select could not
   help, since the label has to survive the step to be in the result at all, and
   dropping it beforehand is the very thing that loses it.

   So the split is made here instead, and it is made by the same test that
   already decides what the arithmetic may touch. A column that isMeasurable()
   accepts is a measure and feeds the answer. Everything else, text, enums,
   identifiers and the nested course column, is a label: it identifies the row
   rather than contributing to it, and it comes out unchanged. That is why
   nothing had to be added to say which columns are which, and why the promise
   the old comment made about ids is still kept. An id is excluded from the sum
   exactly as before. It is now shown next to it rather than thrown away.

   Count is the one measure this does not tidy up. It still asks how many values
   a row holds and still accepts any column, so on a row with a label the label
   is counted AND carried. That is the documented meaning of count here and
   changing it is a separate decision, so the panel goes on naming how many
   columns contribute, which is where a label being added into a total shows up
   before the query is run.                                                    */

/* The columns that identify a row rather than contributing to it, as indices
   into the incoming header. Indices rather than columns, because the row
   builder needs to read the cells and the header builder needs to name them,
   and deriving both from one list is what stops the two disagreeing about
   which column went where. */
function aggregateRowsKeepIdx(t) {
  var idx = [];
  t.columns.forEach(function(c, i) {
    if (!isMeasurable(t, c)) idx.push(i);
  });
  return idx;
}

function aggregateRowsCarried(t) {
  return aggregateRowsKeepIdx(t).map(function(i){ return t.columns[i]; });
}

function aggregateRowsColumn(node) {
  var op = aggOp(node);
  // No single input column to name, so the measure names itself. Keyed on the
  // op so two of these in series produce distinguishable headers.
  return { key: op.key, label: op.label, type: COLTYPE.NUMBER };
}

/* The whole output header: the labels, in the order they arrived, then the
   measure. The measure goes last because that is the order the result reads in,
   label first and answer after, and because appending keeps every carried
   column at the index it already had.

   A clash is renamed rather than allowed, the way joinColumns() renames one.
   A table whose label column is already keyed `count` would otherwise produce
   two columns under one key, and colIndex() hands every later node the first
   it finds, so the wrong column would feed the next step. Rare, and silent,
   which is the combination worth spending a few lines on.

   Key and label are made unique SEPARATELY because they are read by different
   things and can clash independently. colIndex() reads the key, so a duplicate
   key is a wiring bug. serialiseTable() writes the LABEL as the CSV header, so
   a duplicate label is a file with two columns of the same name and no way to
   tell them apart. A column keyed `sum` and labelled `Total` collides on one
   and not the other, and renaming what did not clash would be noise on screen
   for no gain.

   uniqueAgainst() lives in data/table.js, because Combine's join needs the same
   rule for the same reason and one spelling of it is better than two. */
function aggregateRowsColumns(node, t) {
  var carried = aggregateRowsCarried(t);
  var out = aggregateRowsColumn(node);
  var keys = {}, labels = {};
  carried.forEach(function(c){ keys[c.key] = true; labels[c.label] = true; });
  return carried.concat([{
    key:   uniqueAgainst(keys, out.key, '_'),
    label: uniqueAgainst(labels, out.label, ' '),
    type:  out.type
  }]);
}

function aggregateRowsSchema(node, inSchema) {
  return makeTable(aggregateRowsColumns(node, inSchema), []);
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
  var cols = aggregateRowsColumns(node, t);
  var idx = aggregateRowsIdx(node, t);
  var keep = aggregateRowsKeepIdx(t);

  var rows = t.rows.map(function(r) {
    return keep.map(function(i){ return r[i]; })
      .concat([reduceValues(op.key, idx.map(function(i){ return r[i]; }))]);
  });

  log.push(logEntry('AGGREGATE ROWS', [{s:op.label.toLowerCase() + ' across'},
                                       {c:'val', s:idx.length},
                                       {s:'column' + (idx.length === 1 ? '' : 's') + ', per row'}]));
  if (keep.length > 0) {
    log.push(logEntry('AGGREGATE ROWS', [{s:'carried'}, {c:'val', s:keep.length},
      {s:'label column' + (keep.length === 1 ? '' : 's')}]));
  }
  return makeTable(cols, rows);
}
