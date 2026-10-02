/* engine/unique-select.js: Unique, and Select. */
/* UNIQUE
   Removes duplicates. A Reduction beside Filter and Take: fewer rows out than
   in, nothing invented.

   Two modes. Deduplicating whole rows cannot produce "all available course
   labels from a multiplicity of course grade rows", because every enrolment row
   differs in its mark and nothing would be removed. That needs the table
   reduced to the course column first:

     all columns:   a row survives if no identical row came before it. The
                    header is untouched.
     one column:    the table is reduced to that column, then deduplicated. The
                    header becomes that column. This is the label-producing
                    mode, and what makes a list of labels an ordinary table on
                    an ordinary wire.

   Duplicate means equal values, not the same entity. rowKey() says two rows are
   the same when they share a student id, which is right for merging branches
   and wrong here: it would collapse a student's two enrolments into one course
   label. Comparison is on the cells themselves.

   First-seen order is preserved rather than sorted. Sort is the node for an
   order, and preserving arrival order lets a label list keep whatever order its
   source imposed. */

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

  /* The 'v' prefix is what keeps a data value from colliding with a property
     every object already has. `{}` inherits from Object.prototype, so a bare
     seen['constructor'] reads back a function and is truthy before anything has
     been stored: a column holding "constructor", "toString", "valueOf" or
     "__proto__" had those rows dropped as duplicates of each other on the first
     sighting. Measured on a table of eight distinct values, two came out.

     It never showed on the student archive, where keys are IDs, grades and
     course codes, and it became reachable when Source was generalised to read
     any table: a tag or category column is ordinary English and these are
     ordinary English words. combine.js prefixes for the same reason, and
     rowKey() in core.js does too. */
  var seen = {}, rows = [];
  t.rows.forEach(function(r) {
    var k = 'v' + idxs.map(function(i, n) {
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

/* SELECT: choose which columns travel on.
   Aggregate used to do two things at once: measure a column, and leave that
   column as the only one in the result. Measuring is Aggregate's job; the
   narrowing is not, and bundling them meant there was no way to narrow a table
   without also collapsing it to a single row.

   Select is the narrowing on its own. Rows are untouched, same rows, same
   order, same count, and only the header changes. That makes the two
   composable: Select then Aggregate measures a column of a narrowed table, and
   Select alone answers "just show me these three columns".

   Column order follows the incoming table, not the order the boxes were ticked.
   Choosing columns and ordering them are different questions, and ticking order
   is invisible once the panel is closed: a user who unticks a box and ticks it
   again would otherwise find that column had moved to the end. */

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
