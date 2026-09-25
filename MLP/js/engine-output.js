/* engine-output.js: Output, and Project.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   OUTPUT
   ============================================================================
   Every Output emits a table, including Count. A scalar is a 1x1 table. That
   is what lets one renderer and one CSV writer serve every result shape instead
   of a branch per output type.

   An Output displays a table; it does not compute one. Averaging and per-course
   grouping used to live here as shortcuts, which made the same operation exist
   in two places and hid two of the three steps a breakdown actually performs.
   Both are reachable by wiring an Aggregate in front of the Output, where the
   step is visible on the canvas and appears in the query log like every other.
                                                                               */

var ROW_SHOWS = ['rows', 'count'];
var CMP_SHOWS = ['summary', 'lists'];

/* The nodes that hand an Output a table with per-group detail attached. Both
   emit meta.branches in the same shape, so both can offer the same two views:
   The summary alone, or the summary with each group's rows underneath.

   Asked as a list of TYPES rather than by looking for meta.branches on the
   arriving table, because this is called from the config panel, which runs on
   the schema walk, and headerOnly() drops meta by construction. The list is
   the honest way to ask the question at that point, and it is short.

   Direct inputs only, unchanged. A Compare or a SelectFor reaching an Output
   through a Sort still carries its metadata, and the Output then shows the
   ordinary two views. That is the behaviour that was here before SelectFor,
   and widening it is a separate change from adding a second node to the
   list. */
/* A map rather than a list, because the two nodes want different defaults and
   the difference is a fact about them rather than a special case.

   Compare's branches are hand-wired, so there are two or three of them and
   their rows are what the user built the graph to see: "show me the data"
   means the per-branch lists. A breakdown by course has seventy-eight groups
   and the breakdown table IS the answer. The per-group rows are a drill-down
   nobody opens by default. Defaulting a SelectFor to lists rendered a
   nine-hundred-kilobyte page in under two seconds of solid work, to show
   seventy-eight tables no one asked for. */
var BRANCH_NODES = {
  compare:   'lists',
  selectFor: 'summary'
};

function branchProducer(node) {
  var found = null;
  inputsOf(node.id).forEach(function(id) {
    var up = findNode(id);
    if (!found && up && BRANCH_NODES[up.type]) found = up.type;
  });
  return found;
}

function branchesFeedOutput(node) { return branchProducer(node) !== null; }

// The two sides no longer share a value, so rewiring an Output across a Compare
// always lands on that side's nearest equivalent: rows and per-branch lists both
// mean "show me the data", count and summary both mean "show me the figures".
function normaliseShow(node) {
  var v = node.cfg && node.cfg.show;
  var producer = branchProducer(node);
  if (producer) {
    if (CMP_SHOWS.indexOf(v) !== -1) return v;
    // "rows" means "show me the data", and which of the two views that is
    // depends on what made the branches. "count" means the figures, which is
    // the summary either way.
    return (v === 'rows') ? BRANCH_NODES[producer] : 'summary';
  }
  if (ROW_SHOWS.indexOf(v) !== -1) return v;
  return (v === 'lists') ? 'rows' : 'count';
}

/* COLUMN SELECTION ON AN OUTPUT
   ---------------------------------------------------------------------------
   A deliberate duplication of what Select does, and worth being explicit about
   why, because the Output's other shortcuts were removed for being exactly
   this. Average and the course breakdown were removed because they COMPUTED.
   They hid steps that changed the answer, and hid them somewhere the query log
   could not describe. Choosing which columns to look at changes no answer. It
   is a property of the view, which is what an Output is.

   The supervisor put it as a question: one could always wire a Select in front,
   but so many Outputs would need the pair that the duplication earns its place.
   Both routes stay open, and they compose. A Select upstream narrows what
   arrives, this narrows what is shown of it.

   Applied to the row view alone. A count is a count of rows however many
   columns are on them, and a Compare's summary already has the measure
   checkboxes on the Compare itself; offering a second way to hide those would
   be the duplication that is not worth it. */
function outputCols(node, t) {
  return selectedCols(node, t);
}

function outputTable(node, t) {
  var show = normaliseShow(node);

  if (show === 'count') {
    return makeTable([{ key:'count', label:'Count', type:COLTYPE.NUMBER }],
                     [[t.rows.length]]);
  }
  if (show !== 'rows') return t;   // 'summary' and 'lists' display as they arrive

  var keep = outputCols(node, t);
  if (keep.length === t.columns.length) return t;   // same table, so meta survives

  var idx = keep.map(function(c){ return colIndex(t, c.key); });
  /* meta is dropped for the reason Select drops it: branch tables carry the
     header that arrived, and keeping them past a narrowing would leave the
     summary and its branches disagreeing about what columns exist. */
  return makeTable(keep, t.rows.map(function(r) {
    return idx.map(function(i){ return r[i]; });
  }));
}

/* ============================================================================
   PROJECT: Unfold the nested enrolments into rows of their own
   ============================================================================
   The one node that makes a row mean something different on the way out than it
   meant on the way in. Everywhere else a row is a student; after a Project a row
   is a single enrolment, so one student becomes eight rows and a count counts
   course registrations rather than people.

   That used to be a setting on the Source ("one per student" or "one per
   enrolment"), and it was removed because a granularity switch hidden in a
   dropdown made "count students" wrong by a factor of eight with nothing on
   screen to say so. app.js:238 recorded what should replace it:

     Nothing unfolds nested enrolments into their own rows any more. If that is
     wanted later it should be a node on the canvas, where the change in row
     identity is visible, rather than a setting hidden on the Source.

   This is that node, and "where the change is visible" is its whole design
   brief rather than a nicety:
     - it is a node, so the step appears on the canvas and in the query log;
     - it has its own colour and its own group in the menu, because it is not
       the same kind of operation as the ones that narrow or reorder;
     - it renames `id` to `studentId`, because after the unfold that column no
       longer identifies a row. The same student now owns eight of them;
     - its panel states the multiplication, and says what it does to a count.

   Without it, nothing in the tool can reach a mark or a grade in a particular
   course as a VALUE. Filter can already ask "did this student take SWEN421",
   because it reads inside the nesting, but the mark itself can never become a
   column, so a distribution of grades in one course is unaskable. That is use
   case (f), and (g) on top of it.

   The header is a function of the incoming header alone (the enrolment columns
   are fixed, and which student columns come across is decided by their keys),
   so computeSchemas answers without seeing a single row, and the registry
   invariant holds with no special case.                                        */

/* The columns an enrolment contributes. Fixed, because an enrolment has the
   shape the data file gives it. */
/* Derived from enrolmentColumns() rather than written beside it, so the unfold
   and the header it claims to produce cannot disagree. */
function enrolmentKeys() {
  return enrolmentColumns().map(function(c){ return c.key; });
}

function enrolmentColumns() {
  return [
    { key:'code',        label:'Course',      type:COLTYPE.ENUM,   values:COURSES.map(function(c){ return c.code; }) },
    { key:'name',        label:'Course name', type:COLTYPE.TEXT },
    { key:'subject',     label:'Subject',     type:COLTYPE.ENUM,   values:SUBJECTS },
    /* A number rather than an enum, so it can be averaged, maximised and
       compared. "The highest level this student reached" is an Aggregate over
       this column, and it is the closest thing the archive has to a year of
       study, which is what use cases (h) and (i) have been waiting on. */
    { key:'level',       label:'Level',       type:COLTYPE.NUMBER, def:'4' },
    { key:'points',      label:'Points',      type:COLTYPE.NUMBER, def:'15' },
    { key:'gradePoints', label:'Grade points',type:COLTYPE.NUMBER, def:'5' },
    { key:'letterGrade', label:'Grade',       type:COLTYPE.TEXT,   order:GRADE_ORDER }
  ];
}

/* Whether this node has anything to do. A table with no nested column has
   nothing to unfold, and a Project wired behind an Aggregate is a mistake worth
   reporting rather than an error worth stopping for. The same treatment a
   Filter gives a criterion whose column has gone. */
function canProject(t) { return coursesColIndex(t) !== -1; }

/* Which of the incoming columns survive the unfold, and under what names.

   The nested column itself goes, having become rows. `id` is renamed, because
   after the unfold it identifies a student rather than a row and leaving it
   called "ID" invites exactly the miscount this node exists to make visible.

   A column whose key an enrolment also uses is dropped rather than carried: a
   student row's `letterGrade` is their average grade, an enrolment's is their
   grade in that course, and on a table of enrolments the second is the one the
   name should mean. The log names what was replaced, so nothing vanishes
   quietly. Derived by key rather than from a fixed list, so a column added to
   the Source schema tomorrow is carried without this function changing. */
/* The student columns that survive the unfold: everything that is not the
   nested column itself and does not collide with a column the enrolment is
   about to supply.

   ONE COLLISION EXISTS, and it is worth naming rather than leaving to be
   rediscovered. `letterGrade` is a key on both sides: the student's overall
   grade for the year, and the letter awarded for one course. The enrolment's
   wins, which is right, because after this step a row IS an enrolment and the
   grade that belongs to it is the course's.

   What made that a trap was the display name. Both were called "Grade", so the
   column appeared to continue across the step while quietly changing meaning.
   The student's is now called "Overall grade" and the enrolment's is still
   "Grade", so the substitution is visible in the header rather than implied.

   GPA does NOT collide and so rides along, which is the reason the two are not
   treated alike: after a Project a row carries the student's GPA and the
   course's Grade, and those really are facts about different things. */
function projectCarried(t) {
  var taken = {};
  enrolmentColumns().forEach(function(c){ taken[c.key] = true; });
  return t.columns.filter(function(c) {
    return c.type !== COLTYPE.COURSES && !taken[c.key];
  });
}

function projectColumns(t) {
  return projectCarried(t).map(function(c) {
    // Same column, new name where the name would now mislead.
    return c.key === 'id'
      ? { key:'studentId', label:'Student', type:c.type, def:c.def, values:c.values, filter:c.filter }
      : c;
  }).concat(enrolmentColumns());
}

function projectSchema(node, inSchema) {
  if (!canProject(inSchema)) return inSchema;
  return makeTable(projectColumns(inSchema), []);
}

/* `kw` is the word this step logs under, because the Source calls this too when
   it is set to emit enrolments. The transformation is identical and the label
   is not: a log line reading PROJECT beside a graph with no Project node in it
   would name a step the user cannot find. Defaulted rather than required, so
   the node that owns the operation reads as it always did. */
function applyProject(node, t, log, kw) {
  kw = kw || 'PROJECT';
  if (!canProject(t)) {
    log.push(logEntry(kw, [{s:'nothing to expand (no course data on this table)'}]));
    return t;
  }

  var ci = coursesColIndex(t);
  var carry = projectCarried(t);
  var carryIdx = carry.map(function(c){ return colIndex(t, c.key); });
  var cols = projectColumns(t);
  var eKeys = enrolmentKeys();   // hoisted: this is per unfold, not per row

  var rows = [];
  t.rows.forEach(function(r) {
    var prefix = carryIdx.map(function(i){ return r[i]; });
    var list = r[ci] || [];
    list.forEach(function(e) {
      /* Read out of the enrolment BY KEY, in the order enrolmentColumns()
         declares, rather than as a hand-written array in the same order. The
         two were positional and drifted the moment Level was added: every cell
         after Subject shifted, so Grade points held a letter and Grade held
         nothing. Same failure studentsTable() had, same fix. The column list
         is the single statement of what a row holds. */
      rows.push(prefix.concat(eKeys.map(function(k){ return e[k]; })));
    });
  });

  /* The row count is the message. Saying "80 rows -> 640 rows, one per course"
     in the log puts the multiplication in the same place every other step
     reports itself, so a count that looks eight times too large downstream has
     an explanation one line above it. */
  log.push(logEntry(kw, [
    {c:'val', s:t.rows.length}, {s:'rows'}, {c:'op', s:'->'},
    {c:'val', s:rows.length}, {s:'rows, one per course'}
  ]));

  var replaced = t.columns.filter(function(c) {
    return c.type !== COLTYPE.COURSES && carry.indexOf(c) === -1;
  });
  if (replaced.length) {
    log.push(logEntry(kw, [{s:'replaced by course values:'},
      {c:'val', s:replaced.map(function(c){ return c.label; }).join(', ')}]));
  }
  return makeTable(cols, rows);
}

