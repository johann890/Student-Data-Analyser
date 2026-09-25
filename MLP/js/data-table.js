/* data-table.js: The Table type every wire carries, and how one of its cells is
   read and formatted.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   TABLE: The single data type carried on every wire
   ============================================================================
   Before this refactor a wire carried one of two incompatible things: an array
   of student objects, or a bespoke Compare table. Every node that wanted to
   handle both had to fork on `if (r.table)`, and a Compare result could not be
   processed any further, which is why "count per year, then average those
   counts" was unbuildable.

   Now there is one shape:
     columns : [{ key, label, type, ... }]   the header
     rows    : [[v, v, ...]]                 aligned to columns by position
     meta    : {}                            optional extras (Compare branches)

   A student list is a table. A histogram is a table. A count is a 1x1 table.
   Nodes are written once and work on all of them.

   Rows are arrays rather than objects deliberately: it is the same shape as a
   CSV, so export is a direct write, and column order is data rather than
   insertion-order luck. Access goes through cellAt()/colIndex() so nothing
   depends on a hardcoded position.                                           */

var COLTYPE = {
  NUMBER:  'number',  // right-aligned, averageable, comparable with < > =
  TEXT:    'text',    // free text
  ENUM:    'enum',    // small fixed set: Rendered as a dropdown in Filter
  COURSES: 'courses'  // cell holds an array of enrolment objects (see below)
};

/* The COURSES column type is the one place a cell holds a structured value
   rather than a scalar. The alternative (flattening every student into eight
   rows at the Source) would make "count students" wrong by a factor of eight,
   which is the trap the old "One per enrolment" Source mode set. Keeping the
   nesting means a row is always a student, so a count is always a count of
   students. Filter reads inside the nesting through coursesColIndex() to ask
   "took this course" without changing what a row is.

   Nothing unfolds nested enrolments into their own rows any more. If that is
   wanted later it should be a node on the canvas, where the change in row
   identity is visible, rather than a setting hidden on the Source. */

function makeTable(columns, rows, meta) {
  return { columns: columns || [], rows: rows || [], meta: meta || {} };
}

function colIndex(t, key) {
  for (var i = 0; i < t.columns.length; i++) if (t.columns[i].key === key) return i;
  return -1;
}
function colByKey(t, key) { var i = colIndex(t, key); return i === -1 ? null : t.columns[i]; }
function hasCol(t, key) { return colIndex(t, key) !== -1; }
function cellAt(t, row, key) { var i = colIndex(t, key); return i === -1 ? undefined : row[i]; }

// Same header, no rows. Used for schema propagation and empty results
function headerOnly(t) { return makeTable(t.columns, [], {}); }

function numericCols(t) {
  return t.columns.filter(function(c){ return c.type === COLTYPE.NUMBER; });
}

/* Find the nested-enrolment column by TYPE, never by name. Column keys are
   free-form labels and do collide: a Compare emits a numeric measure column
   also called "courses" (how many distinct ones a branch touched). Matching on
   the name treated that integer as an array of enrolments. The type is the
   actual contract, so it is what gets checked. */
function coursesColIndex(t) {
  for (var i = 0; i < t.columns.length; i++) {
    if (t.columns[i].type === COLTYPE.COURSES) return i;
  }
  return -1;
}

/* SOURCE SCHEMAS
   Two row granularities are available. They are genuinely different tables, not
   two views of one ("how many students" and "how many enrolments" are
   different questions), so the Source says which it emits and every downstream
   node adapts through the schema rather than through special cases. */

var STUDENT_COLUMNS = [
  { key:'id',             label:'ID',             type:COLTYPE.NUMBER, def:'1001' },
  { key:'gender',         label:'Gender',         type:COLTYPE.ENUM,   values:['M','F'] },
  { key:'year',           label:'Year',           type:COLTYPE.ENUM,   values:YEARS },
  /* Degree sits beside Specialisation because they are the same kind of fact at
     two widths (BSC and BEHONS are programmes, SWEN and CYBR are majors within
     them), and a question about one is nearly always a question about both. */
  { key:'degree',         label:'Degree',         type:COLTYPE.ENUM,   values:DEGREES },
  { key:'specialisation', label:'Specialisation', type:COLTYPE.ENUM,   values:SPECS },
  { key:'gpa',            label:'GPA',            type:COLTYPE.NUMBER, def:'5' },
  /* "Overall grade", not "Grade", and the rename is the whole of it.
     ---------------------------------------------------------------------
     This column and the one a Project puts on an enrolment were both called
     Grade, and they are not the same fact. This is the student's standing for
     the year: their GPA, rounded to the nearest letter by gradeFromGpa(). The
     other is the letter actually awarded for one course. A student whose GPA
     is 6.4 shows B+ here without ever having been given a B+.

     Worse than ambiguous, the two shared a name across a step that swaps one
     for the other. They also share a KEY, so projectCarried() drops this one
     and the enrolment's takes its place: before a Project the column called
     Grade meant the year, after it the column called Grade meant the course,
     and nothing on screen marked the change. Two names is what makes that
     visible. The keys are deliberately left alone, so every saved query, every
     filter and every export keeps working; only what is displayed changes.

     The supervisor asked for this the other way round, thinking GPA was a
     numeric grade and this the letter form of it. GPA is a real average, so
     its name was right; the collision was here. */
  { key:'letterGrade',    label:'Overall grade',  type:COLTYPE.TEXT,   order:GRADE_ORDER },
  { key:'courses',        label:'Courses',        type:COLTYPE.COURSES }
];

/* The one table builder: every Source produces this shape, and a row is a
   student. The student's courses ride along nested in the last cell rather than
   being flattened into rows of their own. */
/* Built from the COLUMN LIST rather than from a hand-written array, because the
   two were positional and could disagree, and did, the moment Degree was added
   to STUDENT_COLUMNS and the row builder was not updated with it. Every cell
   shifted one place left, and a Filter on Specialisation started reading grades.

   Driving both from `key` means a column added tomorrow needs no second edit,
   and the invariant the suite asserts (one cell per column, in order) is true
   by construction instead of by vigilance. */
function studentsTable(list) {
  return makeTable(STUDENT_COLUMNS, list.map(function(s) {
    return STUDENT_COLUMNS.map(function(c){ return s[c.key]; });
  }));
}

/* Cell formatting is driven by column type, so one renderer and one serialiser
   cover every table the tool can produce. The COURSES type is the only one that
   differs between screen (a count, with the transcript in a tooltip) and file
   (semicolon-joined codes, so the row stays one row). */
function fmtCell(col, v) {
  if (v === undefined || v === null) return '';
  if (col.type === COLTYPE.COURSES) return String((v || []).length);
  if (col.type === COLTYPE.NUMBER && typeof v === 'number' && !isNumInt(v)) return fmtNum(v);
  return String(v);
}
function isNumInt(v) { return Math.abs(v - Math.round(v)) < 1e-9; }

/* Two decimal places, with trailing zeros dropped, not toFixed, which pads.
   Two because a GPA is quoted to two ("a 6.25 average") and one place would
   round it to a different grade band; dropping the padding because a count of
   6.5 courses should not read as 6.50. Rounding at all is the point: averaging
   grade points produces 6.233749999999999, and showing that says the tool
   cannot do arithmetic. */
function fmtNum(v) { return String(Math.round(v * 100) / 100); }

function exportCell(col, v) {
  if (v === undefined || v === null) return '';
  if (col.type === COLTYPE.COURSES) {
    return (v || []).map(function(c){ return c.code; }).join(';');
  }
  if (col.type === COLTYPE.NUMBER && typeof v === 'number' && !isNumInt(v)) return fmtNum(v);
  return String(v);
}

function cellTitle(col, v) {
  if (col.type === COLTYPE.COURSES) {
    return (v || []).map(function(c){ return c.code; }).join(', ');
  }
  return '';
}
