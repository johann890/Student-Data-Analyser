/* engine/unique-select.js: Unique, and Select.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   UNIQUE
   ============================================================================
   Removes duplicates. A Reduction in the supervisor's categorisation, sitting
   beside Filter and Take: fewer rows out than in, nothing invented.

   Two modes, and the second is the one his example asks for. "It could be used
   to produce all available course labels from a multiplicity of course grade
   rows" cannot be done by deduplicating whole rows. Every enrolment row
   differs in its mark, so nothing would be removed. Getting course labels means
   reducing to the course column first and then deduplicating that. So:

     all columns:   A row survives if no identical row came before it. The
                    header is untouched.
     one column:    The table is reduced to that column, then deduplicated. The
                    header becomes that one column. This is the label-producing
                    mode, and what makes a list of labels an ordinary table on
                    an ordinary wire rather than a special kind of input.

   Duplicate means equal values, not the same entity. rowKey() deliberately says
   two rows are the same when they share a student id, which is right for
   merging branches and wrong here: Unique is asked what distinct values are
   present, and answering "these two rows are one student" would collapse a
   student's two enrolments into one course label. Comparison is therefore on
   the cells themselves.

   First-seen order is preserved rather than sorted. The node's job is to remove
   duplicates and nothing else; if an order is wanted, Sort is the node that
   provides it, and preserving arrival order means a label list keeps whatever
   order its source imposed, which a declared column order can then carry
   through.                                                                   */

/* Columns offered as the single-column selector. A nested enrolment cell is not
   a label ("all distinct values of Courses" would be a list of arrays), so the
   COURSES type is excluded, the same exclusion Sort makes for its own reason. */
function uniqueCols(t) {
  return t.columns.filter(function(c){ return c.type !== COLTYPE.COURSES; });
}

/* Resolved against the table rather than trusted from the config, so the schema
   pass and the row pass reach the same answer from the same columns. A saved
   query naming a column that a rewired Source no longer produces falls back to
   all-columns mode in both walks, and the row pass says so in the log. */
function uniqueCol(node, t) {
  var key = (node && node.cfg && node.cfg.col) || '';
  if (!key) return null;
  var col = colByKey(t, key);
  if (!col || col.type === COLTYPE.COURSES) return null;
  return col;
}

/* One cell to a comparable string. A nested enrolment list is flattened to its
   course/mark pairs in order, so two students with the same enrolments compare
   equal instead of being distinguished by array identity, which would make
   whole-row Unique silently do nothing on any table carrying a Courses
   column. */
function uniqueCellKey(col, v) {
  if (col && col.type === COLTYPE.COURSES) {
    return (v || []).map(function(e){ return e.code + ':' + e.letterGrade; }).join(',');
  }
  return String(v);
}

function uniqueSchema(node, inSchema) {
  var col = uniqueCol(node, inSchema);
  return col ? makeTable([col], []) : inSchema;
}

function applyUnique(node, t, log) {
  var col = uniqueCol(node, t);
  var wanted = (node && node.cfg && node.cfg.col) || '';
  var before = t.rows.length;

  // Named a column that is not here any more. Said rather than silently
  // widened, because "distinct course codes" quietly becoming "distinct whole
  // rows" returns a plausible table that answers a different question.
  if (wanted && !col) {
    log.push(logEntry('UNIQUE', [{s:'ignored'}, {c:'val', s:wanted},
                                 {s:'(not a column in this table)'}]));
  }

  var cols = col ? [col] : t.columns;
  var idxs = cols.map(function(c){ return colIndex(t, c.key); });

  var seen = {}, rows = [];
  t.rows.forEach(function(r) {
    var k = idxs.map(function(i, n) {
      return uniqueCellKey(cols[n], r[i]);
    }).join('\u0001');
    if (seen[k]) return;
    seen[k] = true;
    rows.push(col ? [r[idxs[0]]] : r);
  });

  log.push(logEntry('UNIQUE', col
    ? [{s:'distinct'}, {c:'val', s:col.label}, {s:'→'},
       {c:'val', s:rows.length}, {s:'of'}, {c:'val', s:before}, {s:'rows'}]
    : [{s:'distinct rows'}, {s:'→'}, {c:'val', s:rows.length},
       {s:'of'}, {c:'val', s:before}]));

  /* meta is carried through in all-columns mode, where the table is the same
     table with fewer rows, and dropped in one-column mode, where it is not:
     a Compare's branch metadata does not describe a single column of labels. */
  return makeTable(cols, rows, col ? {} : t.meta);
}

/* ============================================================================
   SELECT: Choose which columns travel on
   ============================================================================
   Aggregate used to do two things at once: measure a column, and leave that
   column as the only one in the result. Measuring is Aggregate's job. The
   narrowing is not, and bundling them meant there was no way to narrow a table
   without also collapsing it to a single row.

   Select is the narrowing on its own. Rows are untouched (same rows, same
   order, same count), and only the header changes. That makes the two
   composable: Select then Aggregate measures a column of a narrowed table, and
   Select alone answers "just show me these three columns" without summarising
   anything.

   Column order follows the incoming table, not the order the boxes were
   ticked. Choosing columns and ordering them are different questions, and
   ticking order is invisible once the panel is closed. A user who unticks a
   box and ticks it again would otherwise find that column had silently moved to
   the end. If column order is wanted later it should be its own control, where
   it can be seen and changed deliberately.                                    */

/* Resolved against the arriving table rather than trusted from config, the same
   way Aggregate resolves its measure column. A saved key outlives its column
   easily (rewiring the node behind a different branch is enough), and a config
   that names nothing still present falls back to the whole header, so a rewired
   Select passes its data through instead of emptying it. */
function selectedCols(node, t) {
  var saved = (node && node.cfg && Array.isArray(node.cfg.cols)) ? node.cfg.cols : null;
  if (!saved) return t.columns.slice();
  var keep = t.columns.filter(function(c){ return saved.indexOf(c.key) !== -1; });
  return keep.length ? keep : t.columns.slice();
}

function selectSchema(node, inSchema) {
  return makeTable(selectedCols(node, inSchema), []);
}

function applySelect(node, t, log) {
  var keep = selectedCols(node, t);

  if (keep.length === t.columns.length) {
    // Nothing dropped. Return the same table rather than a copy, so meta
    // survives: it describes the rows, and the rows have not changed.
    log.push(logEntry('SELECT', [{s:'all'}, {c:'val', s:keep.length},
                                 {s:'columns (nothing dropped)'}]));
    return t;
  }

  var idx = keep.map(function(c){ return colIndex(t, c.key); });
  var rows = t.rows.map(function(r) {
    return idx.map(function(i){ return r[i]; });
  });

  var dropped = t.columns.length - keep.length;
  log.push(logEntry('SELECT', [{s:'keep'},
    {c:'val', s:keep.map(function(c){ return c.label; }).join(', ')},
    {s:'(' + dropped + ' column' + (dropped === 1 ? '' : 's') + ' dropped)'}]));

  /* meta is dropped even though the rows are unchanged. A Compare's branch
     metadata holds whole branch tables with the old header, so carrying it past
     a narrowing would leave the summary and its branches disagreeing about what
     columns exist. Compare cannot currently feed a Select, so this costs
     nothing today and is correct if that ever changes. */
  return makeTable(keep, rows);
}
