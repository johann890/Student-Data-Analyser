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

/* HOW MANY OF THE ROWS A MEASURE COULD ACTUALLY USE
   ---------------------------------------------------------------------------
   reduceValues() skips a blank, which is right: a missing mark is not a mark of
   nought. What was missing is any way to tell that it happened. "average of GPA
   over 80 rows" is what the log said when thirty of those GPAs were absent and
   the mean was taken over fifty, and a single number has no blank cell in it to
   notice, no column to add up and nothing else on screen that disagrees.

   That is the same failure SelectFor's blankGroupRows() exists for, in the node
   where it hides best, so it is answered the same way: the count is taken and
   the log says so whenever it differs from the rows that came in.

   The test has to match reduceValues()' own, or the two would disagree about a
   value and the log would be wrong in the one case it exists to report. Blank
   is skipped there and here; a non-numeric string is skipped there for every
   measure but count, and skipped here for the same ones, because this is only
   ever asked about a measure that needs a column.                            */
function usableValueCount(t, col) {
  if (!col) return 0;
  var i = colIndex(t, col.key);
  if (i === -1) return 0;
  var n = 0;
  t.rows.forEach(function(r) {
    var v = r[i];
    if (isBlank(v)) return;
    if (isFinite(Number(v))) n++;
  });
  return n;
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

  /* One line per measure that saw fewer rows than the line above claims, named
     rather than totalled: two measures over two columns can be short by
     different amounts, and "28 rows were blank" would not say which average to
     distrust. A measure that saw every row says nothing, so a complete table
     logs exactly what it always did. */
  stats.forEach(function(s, i) {
    var op = selectForOp(s && s.op);
    if (!op.needsCol || !scols[i]) return;
    var used = usableValueCount(t, scols[i]);
    if (used === t.rows.length) return;
    log.push(logEntry('SKIP', [
      {s:op.label.toLowerCase() + ' of'}, {c:'val', s:scols[i].label},
      {s:'used'}, {c:'val', s:used}, {s:'of'}, {c:'val', s:t.rows.length},
      {s:'rows;'}, {c:'val', s:t.rows.length - used}, {s:'had no value'}
    ]));
  });

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
  /* The columns that WERE measured, but over fewer rows than the line above
     says. Listed in one line the way the skipped columns are, with the count
     beside each name, because the question a reader has is which column to
     distrust and by how much. Count is exempt: "how many values are present" is
     a true answer whatever is missing, and is the one measure for which a blank
     is the subject rather than an obstacle. */
  if (op.key !== 'count') {
    var short = [];
    t.columns.forEach(function(c) {
      if (!isMeasurable(t, c)) return;
      var used = usableValueCount(t, c);
      if (used !== t.rows.length) short.push(c.label + ' (' + used + ')');
    });
    if (short.length) {
      log.push(logEntry('SKIP', [
        {s:'measured fewer than'}, {c:'val', s:t.rows.length}, {s:'rows for'},
        {c:'val', s:short.join(', ')}
      ]));
    }
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

/* ---- The two-column measures ---------------------------------------------
   Every measure above answers "given these values, produce one number", and
   that is one shape: many in, one out. Difference, Ratio and Percent of are
   the other shape, two in and one out, and it is the shape the tool had no
   way to express. Counting the students on a course and counting the ones who
   passed were both easy; saying what fraction passed was not reachable at all,
   because nothing could relate two numbers the tool had already worked out.

   They live here rather than in a node of their own because Agg. Rows already
   means "one value per row, worked out from that row's values", and a ratio of
   two of that row's values is exactly that. What it needed was not a new place
   to live but a way to say WHICH two columns, since unlike a sum these are
   ordered: Passed over Enrolled is a pass rate and Enrolled over Passed is not
   a number anybody wants.

   So they are picked explicitly, in two selects, rather than taken from the
   order the columns happen to arrive in. Header order would have been fewer
   lines and would have left the operand order invisible, controllable only
   through Combine's Base dropdown, and silently meaningless as soon as a third
   column appeared.

   `pick` names the second select for each, so the panel reads as the operation
   does: "Of Passed, Divided by Enrolled". `sym` is what the result column
   calls itself, so the header says "Passed / Enrolled" and the query is
   readable from its output alone.                                            */
var ROW_PAIR_OPS = [
  { key:'difference', label:'Difference', pair:true, pick:'Minus',     sym:'-',
    hint:'The first column minus the second, on every row. Use it for a change ' +
         'between two joined branches, such as this year against last year.' },
  { key:'ratio',      label:'Ratio',      pair:true, pick:'Divided by', sym:'÷',
    hint:'The first column divided by the second, on every row. 80 out of 82 ' +
         'gives 0.98.' },
  /* `sym` spells the word out where the other two use a symbol, and the reason
     is the file the header ends up in rather than the header itself. A per cent
     sign starts a comment in LaTeX, so a table pasted into a report silently
     lost the rest of its header line, with no error anywhere to say so. The
     panel's own `pick` keeps the symbol: it is read on screen and never
     exported. See serialiseTable() for the other half of this. */
  { key:'percent',    label:'Percent of', pair:true, pick:'As % of',
    sym:'as a percentage of',
    hint:'The first column as a percentage of the second, on every row. 80 out ' +
         'of 82 gives 97.56. This is the one a pass rate wants.' }
];

// What Agg. Rows offers: the reductions, then the pair measures. Its two
// siblings are handed AGG_OPS alone, because "difference down a column of 780
// rows" is not a question.
var ROW_OPS = AGG_OPS.concat(ROW_PAIR_OPS);

function rowOp(node) {
  var k = node && node.cfg ? node.cfg.op : null;
  for (var i = 0; i < ROW_OPS.length; i++) if (ROW_OPS[i].key === k) return ROW_OPS[i];
  return ROW_OPS[0];   // anything unrecognised, including a hand-edited file
}

function isPairOp(node) { return !!rowOp(node).pair; }

/* The two columns a pair measure reads, resolved against the table rather than
   trusted from the config, the way every other saved column key in this tool is
   resolved: rewiring the node behind a different branch can outlive the names
   it was set to, and falling back to real columns beats measuring nothing.

   Defaults are the first two measurable columns in header order, so a node
   dropped onto a join does something meaningful before either select is
   touched. With only one measurable column both sides resolve to it, which is
   a ratio of 1 rather than an error: honest, visibly useless, and fixed by
   wiring something with two numbers in it. */
function aggregateRowsPair(node, t) {
  var avail = measurableCols(t);
  if (!avail.length) return { left: null, right: null };
  var cfg = (node && node.cfg) || {};
  var pick = function(key, fallback) {
    var c = key ? colByKey(t, key) : null;
    return (c && isMeasurable(t, c)) ? c : fallback;
  };
  return {
    left:  pick(cfg.left,  avail[0]),
    right: pick(cfg.right, avail.length > 1 ? avail[1] : avail[0])
  };
}

/* One row's answer. Deliberately NOT reduceValues, and that is the whole of
   what makes these correct.

   reduceValues SKIPS a blank, which is right for a sum (a missing mark is not
   a mark of nought, and counting it as one drags the average down) and wrong
   here. Skipping one side of a division does not leave the division short a
   value, it leaves it a different expression: 80 divided by nothing would come
   back as 80, a number that looks like an answer and is not one. A pair
   measure with a blank on either side has no answer, so it says so.

   Dividing by zero is the same case. Infinity is not a rate, and a course with
   no enrolments has no pass rate rather than an infinite one. Blank, and the
   log says how many rows it happened to, because a column of blanks with no
   explanation is the kind of result people work around instead of asking
   about. */
function pairValue(opKey, a, b) {
  if (isBlank(a) || isBlank(b)) return null;
  var x = Number(a), y = Number(b);
  if (!isFinite(x) || !isFinite(y)) return null;
  if (opKey === 'difference') return x - y;
  if (y === 0) return null;
  return opKey === 'percent' ? (x / y) * 100 : x / y;
}

/* The columns that identify a row rather than contributing to it, as indices
   into the incoming header. Indices rather than columns, because the row
   builder needs to read the cells and the header builder needs to name them,
   and deriving both from one list is what stops the two disagreeing about
   which column went where.

   A pair measure carries MORE than a reduction does, and by the same rule. The
   rule is "the columns the measure consumes are replaced, the rest come
   through"; a reduction consumes every measurable column, while a pair measure
   consumes exactly two. So a third numeric column that is neither operand is
   carried rather than quietly dropped, which is what a reader expects of a
   step that was only asked about two of them. */
function aggregateRowsKeepIdx(node, t) {
  if (isPairOp(node)) {
    var pair = aggregateRowsPair(node, t);
    var used = {};
    if (pair.left)  used[pair.left.key]  = true;
    if (pair.right) used[pair.right.key] = true;
    return t.columns.map(function(_, i){ return i; })
      .filter(function(i){ return !used[t.columns[i].key]; });
  }
  var idx = [];
  t.columns.forEach(function(c, i) {
    if (!isMeasurable(t, c)) idx.push(i);
  });
  return idx;
}

function aggregateRowsCarried(node, t) {
  return aggregateRowsKeepIdx(node, t).map(function(i){ return t.columns[i]; });
}

/* What the measure calls itself. A reduction names the operation, because it
   applied to whatever was there; a pair measure names the EXPRESSION, because
   which two columns and in which order is the whole of what it did. A header
   reading "Passed / Enrolled" describes the query it came out of without
   anybody having to open the node. */
function aggregateRowsColumn(node, t) {
  var op = rowOp(node);
  if (!op.pair) {
    // Keyed on the op so two of these in series produce distinguishable headers.
    return { key: op.key, label: op.label, type: COLTYPE.NUMBER };
  }
  var pair = aggregateRowsPair(node, t || makeTable([], []));
  var label = (pair.left && pair.right)
    ? (pair.left.label + ' ' + op.sym + ' ' + pair.right.label)
    : op.label;
  return { key: op.key, label: label, type: COLTYPE.NUMBER };
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
  var carried = aggregateRowsCarried(node, t);
  var out = aggregateRowsColumn(node, t);
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

/* Which cells of a row feed a REDUCTION. The same rule AggregateColumns uses,
   applied along the other axis: Count asks how many values are present and any
   column can answer that, while the arithmetic measures take only the columns
   that hold a number and are not an identifier. Resolved once for the table
   rather than per row, since the header does not change between rows.

   A pair measure does not come through here at all; its two columns are named
   rather than gathered, which is what aggregateRowsPair() is for. */
function aggregateRowsIdx(node, t) {
  var op = rowOp(node);
  var idx = [];
  t.columns.forEach(function(c, i) {
    if (op.key === 'count' || isMeasurable(t, c)) idx.push(i);
  });
  return idx;
}

function applyAggregateRows(node, t, log) {
  var op   = rowOp(node);
  var cols = aggregateRowsColumns(node, t);
  var keep = aggregateRowsKeepIdx(node, t);
  var pair = op.pair ? aggregateRowsPair(node, t) : null;
  var li = pair && pair.left  ? colIndex(t, pair.left.key)  : -1;
  var ri = pair && pair.right ? colIndex(t, pair.right.key) : -1;
  var idx = op.pair ? [] : aggregateRowsIdx(node, t);
  var blanks = 0;

  var rows = t.rows.map(function(r) {
    var value;
    if (op.pair) {
      value = (li === -1 || ri === -1) ? null : pairValue(op.key, r[li], r[ri]);
      if (value === null) blanks++;
    } else {
      value = reduceValues(op.key, idx.map(function(i){ return r[i]; }));
    }
    return keep.map(function(i){ return r[i]; }).concat([value]);
  });

  if (op.pair) {
    /* Punctuation rides inside a part, because logHTML joins them with a space
       and "Passed / Enrolled , per row" is not a sentence. The expression is
       the value here, so it is the part that gets highlighted. */
    log.push(logEntry('AGGREGATE ROWS',
      [{s:'per row:'}, {c:'val', s:aggregateRowsColumn(node, t).label}]));
    /* Named rather than left to be noticed. A column of blanks with nothing
       said about it reads as the tool having failed, when what happened is
       that those rows had a gap or a zero to divide by. */
    if (blanks > 0) {
      log.push(logEntry('AGGREGATE ROWS', [{s:'no answer for'}, {c:'val', s:blanks},
        {s:'row' + (blanks === 1 ? '' : 's') + ' (a blank value, or zero to divide by)'}]));
    }
  } else {
    log.push(logEntry('AGGREGATE ROWS', [{s:op.label.toLowerCase() + ' across'},
                                         {c:'val', s:idx.length},
                                         {s:'column' + (idx.length === 1 ? '' : 's') + ', per row'}]));
  }
  if (keep.length > 0) {
    log.push(logEntry('AGGREGATE ROWS', [{s:'carried'}, {c:'val', s:keep.length},
      {s:'label column' + (keep.length === 1 ? '' : 's')}]));
  }
  return makeTable(cols, rows);
}
