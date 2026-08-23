(function() {

/* PALETTE OF EDGE COLOURS (one per source/path) */
var EDGE_PALETTE = ['#ffffff','#30d87a','#4aaff0','#e060b0','#a0d040','#9080e0'];
var edgeColorIndex = 0;

/* TEST DATASET */
var SPECS = ["Software Engineering","Computer Science","Information Technology","Data Science","Cybersecurity","Artificial Intelligence"];
var G22 = [78,82,91,65,88,72,95,55,83,70,61,79,86,73,90,68,77,84,62,92,75,80,58,87,71,94,66,85,76,89,63,74,81,93,69,78,85,72,60,88];
var G23 = [82,85,78,70,91,76,88,60,86,74,65,83,89,77,92,71,80,87,66,95,78,84,62,90,75,97,70,88,80,93,67,78,84,96,73,82,88,76,63,91];

/* Best to worst. Declared once and attached to every letterGrade column so a
   Sort can order grades the way a reader means them: as text, 'A+' falls
   between 'A' and 'A-' because '+' precedes '-' in ASCII. */
var GRADE_ORDER = ['A+','A','A-','B+','B','B-','C+','C','D'];

function letterGrade(g) {
  if (g>=90) return 'A+'; if (g>=85) return 'A'; if (g>=80) return 'A-';
  if (g>=75) return 'B+'; if (g>=70) return 'B'; if (g>=65) return 'B-';
  if (g>=60) return 'C+'; if (g>=55) return 'C'; return 'D';
}

/* COURSE CATALOGUE
   400-level (Honours) offerings, grouped by subject prefix. A full Honours
   year is eight 15-point courses = 120 points, so every student record carries
   exactly eight enrolments for the year they are enrolled in.

   The subject list is derived from the codes rather than hardcoded, so
   replacing this array with the real catalogue — more courses, new prefixes —
   requires no other change: the filter dropdowns, the subject criterion and
   the breakdown tables all read from it. */
var COURSES = [
  { code:'SWEN421', name:'Formal Foundations of Software Engineering' },
  { code:'SWEN422', name:'Human Computer Interaction' },
  { code:'SWEN423', name:'Software Design and Architecture' },
  { code:'SWEN430', name:'Compiler Engineering' },
  { code:'SWEN431', name:'Advanced Programming Languages' },
  { code:'SWEN432', name:'Advanced Database Design and Implementation' },
  { code:'SWEN438', name:'Software Evolution' },
  { code:'SWEN439', name:'Special Topic: Software Engineering' },

  { code:'ENGR401', name:'Professional Practice' },
  { code:'ENGR440', name:'Advanced Systems Engineering' },
  { code:'ENGR489', name:'Engineering Project' },

  { code:'AIML420', name:'Foundations of Artificial Intelligence' },
  { code:'AIML421', name:'Machine Learning Tools and Techniques' },
  { code:'AIML425', name:'Neural Networks and Deep Learning' },
  { code:'AIML426', name:'Evolutionary Computation and Learning' },
  { code:'AIML427', name:'Big Data' },
  { code:'AIML428', name:'Text Mining' },

  { code:'CYBR471', name:'Cybersecurity Risk Management' },
  { code:'CYBR472', name:'Applied Cryptography' },
  { code:'CYBR473', name:'Malware and Reverse Engineering' }
];

var COURSE_POINTS = 15;   // every 400-level course in the catalogue
var COURSES_PER_YEAR = 8; // 8 x 15 = 120 points, a full Honours year

var SUBJECTS = [];        // derived from the codes, in first-seen order
var COURSE_BY_CODE = {};
COURSES.forEach(function(c) {
  c.subject = c.code.slice(0, 4);
  c.points = COURSE_POINTS;
  COURSE_BY_CODE[c.code] = c;
  if (SUBJECTS.indexOf(c.subject) === -1) SUBJECTS.push(c.subject);
});
var DEFAULT_COURSE = COURSES[0].code;

// Taken by everyone regardless of specialisation — the project and the
// professional-practice course are core to the Honours year.
var CORE_COURSES = ['ENGR489', 'ENGR401'];

// Which subjects a specialisation leans on, most-preferred first. Anything not
// listed still has a small chance of being picked, so cohorts overlap rather
// than splitting into six disjoint groups.
var SPEC_SUBJECTS = {
  'Software Engineering':    ['SWEN', 'ENGR', 'AIML'],
  'Computer Science':        ['SWEN', 'AIML', 'ENGR'],
  'Information Technology':  ['SWEN', 'CYBR', 'ENGR'],
  'Data Science':            ['AIML', 'SWEN', 'ENGR'],
  'Cybersecurity':           ['CYBR', 'SWEN', 'ENGR'],
  'Artificial Intelligence': ['AIML', 'SWEN', 'CYBR']
};
var SUBJECT_WEIGHTS = [7, 3, 2]; // by rank in the list above; 1 for everything else

function subjectWeight(spec, subject) {
  var prefs = SPEC_SUBJECTS[spec] || [];
  var rank = prefs.indexOf(subject);
  return rank === -1 ? 1 : SUBJECT_WEIGHTS[rank];
}

/* Deterministic generation. A fixed seed means the dataset is identical on
   every page load, so a query that returned 23 students yesterday still
   returns 23 today — screenshots, notes and marking stay reproducible. */
function makeRng(seed) {
  var t = seed >>> 0;
  return function() {
    t += 0x6D2B79F5;
    var r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Weighted sampling without replacement, seeded from the student's own id.
function pickCourses(rand, spec) {
  var chosen = CORE_COURSES.filter(function(code){ return COURSE_BY_CODE[code]; });
  var pool = COURSES.filter(function(c){ return chosen.indexOf(c.code) === -1; });
  var weights = pool.map(function(c){ return subjectWeight(spec, c.subject); });

  while (chosen.length < COURSES_PER_YEAR && pool.length) {
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var r = rand() * total, pickIdx = pool.length - 1;
    for (i = 0; i < weights.length; i++) {
      if (r < weights[i]) { pickIdx = i; break; }
      r -= weights[i];
    }
    chosen.push(pool[pickIdx].code);
    pool.splice(pickIdx, 1);
    weights.splice(pickIdx, 1);
  }
  // Catalogue order keeps a student's transcript readable
  return chosen.sort();
}

var MARK_MIN = 30, MARK_MAX = 100, MARK_SPREAD = 11;

function clampMark(m) { return Math.max(MARK_MIN, Math.min(MARK_MAX, m)); }
function sumOf(a) { return a.reduce(function(x, y){ return x + y; }, 0); }

/* Marks that scatter around the student's overall average and then sum back to
   it exactly. Keeping the mean intact means gradeAvg stays the number it was
   before courses existed, so every previously-recorded query result still
   holds — the course detail is added underneath it, not instead of it. */
function marksAround(rand, target, n) {
  var m = [], i;
  for (i = 0; i < n; i++) {
    m.push(clampMark(target + Math.round((rand() * 2 - 1) * MARK_SPREAD)));
  }
  var want = target * n, guard = 0;
  while (sumOf(m) !== want && guard++ < 500) {
    var step = want > sumOf(m) ? 1 : -1;
    var idx = Math.floor(rand() * n);
    var v = m[idx] + step;
    if (v >= MARK_MIN && v <= MARK_MAX) m[idx] = v;
  }
  return m;
}

function buildEnrolments(id, spec, year, target) {
  var rand = makeRng(id * 2654435761);
  var codes = pickCourses(rand, spec);
  var marks = marksAround(rand, target, codes.length);
  return codes.map(function(code, i) {
    var c = COURSE_BY_CODE[code];
    return {
      code: c.code,
      name: c.name,
      subject: c.subject,
      points: c.points,
      year: year,
      mark: marks[i],
      letterGrade: letterGrade(marks[i])
    };
  });
}

var STUDENTS = [];
var baseId = 1001;
[G22, G23].forEach(function(arr, yi) {
  arr.forEach(function(g, i) {
    var id = baseId++;
    var year = 2022 + yi;
    var spec = SPECS[i % SPECS.length];
    var enrolments = buildEnrolments(id, spec, year, g);
    // Derived from the enrolments, not stored alongside them, so the two can
    // never disagree.
    var avg = Math.round(sumOf(enrolments.map(function(e){ return e.mark; })) / enrolments.length);
    STUDENTS.push({
      id: id,
      gender: i % 2 === 0 ? 'M' : 'F',
      year: year,
      specialisation: spec,
      courses: enrolments,
      gradeAvg: avg,
      letterGrade: letterGrade(avg)
    });
  });
});

/* These student-object lookups (courseMark, takesCourse, courseStats, ...) were
   removed in the table refactor. Every one of them is now a table operation:
   course predicates go through coursesColIndex(), per-course aggregation through
   breakdownTable(), and the long enrolment format through toEnrolments(). They
   worked on arrays of student objects, which no longer travel anywhere. */


/* ============================================================================
   TABLE — the single data type carried on every wire
   ============================================================================
   Before this refactor a wire carried one of two incompatible things: an array
   of student objects, or a bespoke Compare table. Every node that wanted to
   handle both had to fork on `if (r.table)`, and a Compare result could not be
   processed any further — which is why "count per year, then average those
   counts" was unbuildable.

   Now there is one shape:
     columns : [{ key, label, type, ... }]   — the header
     rows    : [[v, v, ...]]                 — aligned to columns by position
     meta    : {}                            — optional extras (e.g. Compare branches)

   A student list is a table. A histogram is a table. A count is a 1x1 table.
   Nodes are written once and work on all of them.

   Rows are arrays rather than objects deliberately: it is the same shape as a
   CSV, so export is a direct write, and column order is data rather than
   insertion-order luck. Access goes through cellAt()/colIndex() so nothing
   depends on a hardcoded position.                                           */

var COLTYPE = {
  NUMBER:  'number',  // right-aligned, averageable, comparable with < > =
  TEXT:    'text',    // free text
  ENUM:    'enum',    // small fixed set — rendered as a dropdown in Filter
  COURSES: 'courses'  // cell holds an array of enrolment objects (see below)
};

/* The COURSES column type is the one place a cell holds a structured value
   rather than a scalar. The alternative — flattening every student into eight
   rows at the Source — would make "count students" wrong by a factor of eight.
   Instead the nesting is kept, declared in the column type, and unfolded on
   demand by toEnrolments(). That unfolding is what a separate "Explode" node
   would have done; making it a property of the type means no extra node and no
   way to forget it. */

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

// Same header, no rows — used for schema propagation and empty results
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
   two views of one — "how many students" and "how many enrolments" are
   different questions — so the Source says which it emits and every downstream
   node adapts through the schema rather than through special cases. */

var YEARS = STUDENTS.map(function(s){ return s.year; })
  .filter(function(v, i, a){ return a.indexOf(v) === i; })
  .sort();

var STUDENT_COLUMNS = [
  { key:'id',             label:'ID',             type:COLTYPE.NUMBER, def:'1001' },
  { key:'gender',         label:'Gender',         type:COLTYPE.ENUM,   values:['M','F'] },
  { key:'year',           label:'Year',           type:COLTYPE.ENUM,   values:YEARS, filter:false },
  { key:'specialisation', label:'Specialisation', type:COLTYPE.ENUM,   values:SPECS },
  { key:'gradeAvg',       label:'Avg',            type:COLTYPE.NUMBER, def:'70' },
  { key:'letterGrade',    label:'Grade',          type:COLTYPE.TEXT,   order:GRADE_ORDER },
  { key:'courses',        label:'Courses',        type:COLTYPE.COURSES }
];

var ENROLMENT_COLUMNS = [
  { key:'studentId',      label:'Student',        type:COLTYPE.NUMBER, def:'1001' },
  { key:'gender',         label:'Gender',         type:COLTYPE.ENUM,   values:['M','F'] },
  { key:'year',           label:'Year',           type:COLTYPE.ENUM,   values:YEARS, filter:false },
  { key:'specialisation', label:'Specialisation', type:COLTYPE.ENUM,   values:SPECS },
  { key:'code',           label:'Course',         type:COLTYPE.ENUM,   values:COURSES.map(function(c){ return c.code; }) },
  { key:'name',           label:'Course name',    type:COLTYPE.TEXT },
  { key:'subject',        label:'Subject',        type:COLTYPE.ENUM,   values:SUBJECTS },
  { key:'points',         label:'Points',         type:COLTYPE.NUMBER, def:'15' },
  { key:'mark',           label:'Mark',           type:COLTYPE.NUMBER, def:'70' },
  { key:'letterGrade',    label:'Grade',          type:COLTYPE.TEXT,   order:GRADE_ORDER }
];

function studentsTable(list) {
  return makeTable(STUDENT_COLUMNS, list.map(function(s) {
    return [s.id, s.gender, s.year, s.specialisation, s.gradeAvg, s.letterGrade, s.courses];
  }));
}

function enrolmentsTable(list) {
  var rows = [];
  list.forEach(function(s) {
    s.courses.forEach(function(c) {
      rows.push([s.id, s.gender, s.year, s.specialisation,
                 c.code, c.name, c.subject, c.points, c.mark, c.letterGrade]);
    });
  });
  return makeTable(ENROLMENT_COLUMNS, rows);
}

/* Unfold a student table into one row per student-course pair. Returns null if
   the table has no course information at all, so callers can degrade rather
   than guess. Already-enrolment tables pass straight through. */
// Can this table be unfolded at all? Checked before building anything, since
// runQuery only needs the answer to decide whether to offer the export button.
// True when a breakdown would have to unfold nested enrolments — i.e. the rows
// arriving are students, not enrolments. False when the table is already at
// enrolment granularity and grouping changes nothing about row identity.
function explodesHere(t) {
  return coursesColIndex(t) !== -1 && !(hasCol(t, 'code') && hasCol(t, 'mark'));
}

function canExplode(t) {
  return (hasCol(t, 'code') && hasCol(t, 'mark')) || coursesColIndex(t) !== -1;
}

function toEnrolments(t) {
  if (hasCol(t, 'code') && hasCol(t, 'mark')) return t;
  var ci = coursesColIndex(t);
  if (ci === -1) return null;

  // Carry across whatever student-level context this table still has
  var carry = ['id', 'studentId', 'gender', 'year', 'specialisation']
    .filter(function(k){ return hasCol(t, k) && colByKey(t, k).type !== COLTYPE.COURSES; });
  var cols = carry.map(function(k) {
    var c = colByKey(t, k);
    return { key: k === 'id' ? 'studentId' : k, label: c.label, type: c.type,
             values: c.values, filter: c.filter };
  }).concat([
    { key:'code',        label:'Course',      type:COLTYPE.ENUM, values:COURSES.map(function(c){ return c.code; }) },
    { key:'name',        label:'Course name', type:COLTYPE.TEXT },
    { key:'subject',     label:'Subject',     type:COLTYPE.ENUM, values:SUBJECTS },
    { key:'points',      label:'Points',      type:COLTYPE.NUMBER, def:'15' },
    { key:'mark',        label:'Mark',        type:COLTYPE.NUMBER, def:'70' },
    { key:'letterGrade', label:'Grade',       type:COLTYPE.TEXT }
  ]);

  var rows = [];
  t.rows.forEach(function(r) {
    var prefix = carry.map(function(k){ return cellAt(t, r, k); });
    var list = r[ci] || [];
    list.forEach(function(c) {
      rows.push(prefix.concat([c.code, c.name, c.subject, c.points, c.mark, c.letterGrade]));
    });
  });
  return makeTable(cols, rows);
}

/* Course breakdown as a table: one row per course over whatever students or
   enrolments reached this point. Works from either granularity via
   toEnrolments(), so it needs no knowledge of which one it was handed. */
var BREAKDOWN_COLUMNS = [
  { key:'code',    label:'Course',    type:COLTYPE.TEXT },
  { key:'name',    label:'Name',      type:COLTYPE.TEXT },
  { key:'subject', label:'Subject',   type:COLTYPE.TEXT },
  { key:'count',   label:'Students',  type:COLTYPE.NUMBER },
  { key:'avg',     label:'Avg mark',  type:COLTYPE.NUMBER }
];

function breakdownTable(t) {
  var en = toEnrolments(t);
  if (!en) return makeTable(BREAKDOWN_COLUMNS, []);
  var acc = {};
  en.rows.forEach(function(r) {
    var code = cellAt(en, r, 'code');
    var a = acc[code] || (acc[code] = {
      code: code,
      name: cellAt(en, r, 'name'),
      subject: cellAt(en, r, 'subject'),
      count: 0, total: 0
    });
    a.count++;
    a.total += Number(cellAt(en, r, 'mark')) || 0;
  });
  var rows = Object.keys(acc).map(function(k) {
    var a = acc[k];
    return [a.code, a.name, a.subject, a.count, a.count ? a.total / a.count : 0];
  }).sort(function(x, y) { return y[3] - x[3] || String(x[0]).localeCompare(String(y[0])); });
  return makeTable(BREAKDOWN_COLUMNS, rows);
}

/* Cell formatting is driven by column type, so one renderer and one serialiser
   cover every table the tool can produce. The COURSES type is the only one that
   differs between screen (a count, with the transcript in a tooltip) and file
   (semicolon-joined codes, so the row stays one row). */
function fmtCell(col, v) {
  if (v === undefined || v === null) return '';
  if (col.type === COLTYPE.COURSES) return String((v || []).length);
  if (col.type === COLTYPE.NUMBER && typeof v === 'number' && !isNumInt(v)) return v.toFixed(1);
  return String(v);
}
function isNumInt(v) { return Math.abs(v - Math.round(v)) < 1e-9; }

function exportCell(col, v) {
  if (v === undefined || v === null) return '';
  if (col.type === COLTYPE.COURSES) {
    return (v || []).map(function(c){ return c.code; }).join(';');
  }
  if (col.type === COLTYPE.NUMBER && typeof v === 'number' && !isNumInt(v)) return v.toFixed(1);
  return String(v);
}

function cellTitle(col, v) {
  if (col.type === COLTYPE.COURSES) {
    return (v || []).map(function(c){ return c.code; }).join(', ');
  }
  return '';
}

/* ============================================================================
   STATE
   ============================================================================
   Every node owns its own configuration in node.cfg. Previously the config
   lived in the DOM and was scraped back by a saveState() pass before each
   re-render, which meant an unrendered panel read as "nothing set" (hence the
   defensive guard the Compare node needed) and made the graph impossible to
   serialise. The model is now authoritative: controls write into cfg on change,
   render() only reads. That is also what makes save/load possible at all.    */

var nodes = [];
var connections = [];   // [{from, to, color}]
var idCtr = 0;
var drag = null;
var SNAP_DIST = 160;    // px proximity threshold, measured between shape edges
var hoverConn = null;
var exportData = {};    // outputNodeId -> {index, name, table, log}
var resultsFresh = false;
var nodeEls = {};       // nodeId -> DOM element, for the drag fast path

function uid() { return ++idCtr; }

var NODE_W = 220;
var SHAPE = {
  source:  { w:100, h:100 },
  filter:  { w:106, h:84 },
  compare: { w:112, h:78 },
  sort:    { w:106, h:72 },
  take:    { w:106, h:72 },
  aggregate:        { w:106, h:72 },
  aggregateColumns: { w:112, h:72 },
  combine:          { w:106, h:72 },
  output:  { w:106, h:66 }
};

/* ============================================================================
   VIEW — WORLD COORDINATES, ZOOM AND PAN
   ============================================================================
   Node x/y were previously viewport pixels: a node's position meant "this many
   pixels from the top-left of the visible canvas", so the reachable area was
   whatever the window happened to be, and a node dragged to the edge of a small
   window was at a different logical place than the same drag in a large one.

   They are now world coordinates in a fixed logical area, and the view is a
   separate concern: a scale plus a translation applied to one wrapper element.
   The model never knows what is on screen. That is what makes zoom possible
   without touching the graph, and it means a saved query means the same thing
   on any display — so the file format is untouched by this change.

       screen = world * z + pan            (pan is in screen px)
       world  = (screen - pan) / z

   Every conversion goes through toWorld/toScreen. Reading node positions
   straight off clientX again is the one way to reintroduce the bug this
   replaces, because it silently works at 100% and only skews at other zooms. */

var WORLD_W = 5000, WORLD_H = 3500;
var MIN_ZOOM = 0.3, MAX_ZOOM = 2;
var ZOOM_STEP = 1.2;

var view = { z: 1, x: 0, y: 0 };

function canvasBox() { return document.getElementById('canvas').getBoundingClientRect(); }

function toWorld(clientX, clientY) {
  var r = canvasBox();
  return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
}
function toScreen(wx, wy) {
  return { x: wx * view.z + view.x, y: wy * view.z + view.y };
}
function viewCentreWorld() {
  var r = canvasBox();
  return toWorld(r.left + r.width / 2, r.top + r.height / 2);
}

/* Pan is clamped so the world can never be dragged off screen entirely. When
   the world is smaller than the viewport — which is what zooming out far enough
   produces — there is no valid pan, so it is centred instead. Without this,
   zooming out leaves the graph pinned to a corner against dead space. */
function clampPan() {
  var r = canvasBox();
  var sw = WORLD_W * view.z, sh = WORLD_H * view.z;
  view.x = sw <= r.width  ? (r.width  - sw) / 2 : Math.min(0, Math.max(r.width  - sw, view.x));
  view.y = sh <= r.height ? (r.height - sh) / 2 : Math.min(0, Math.max(r.height - sh, view.y));
}

function applyView() {
  var vp = document.getElementById('viewport');
  if (vp) {
    vp.style.width  = WORLD_W + 'px';
    vp.style.height = WORLD_H + 'px';
    vp.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.z + ')';
  }
  var lbl = document.getElementById('zoomLevel');
  if (lbl) lbl.textContent = Math.round(view.z * 100) + '%';
}

/* Zoom about a fixed point: the world position under the cursor stays under the
   cursor. Anchoring to the canvas centre instead — the naive version — walks
   the graph away from wherever the user was looking, which is why wheel zoom
   passes the pointer through. */
function setZoom(z, clientX, clientY) {
  var r = canvasBox();
  if (clientX === undefined) { clientX = r.left + r.width / 2; clientY = r.top + r.height / 2; }
  var anchor = toWorld(clientX, clientY);
  view.z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  view.x = (clientX - r.left) - anchor.x * view.z;
  view.y = (clientY - r.top)  - anchor.y * view.z;
  clampPan();
  applyView();
  repositionPreview();
}

function zoomIn()    { setZoom(view.z * ZOOM_STEP); }
function zoomOut()   { setZoom(view.z / ZOOM_STEP); }
function zoomReset() { setZoom(1); }

/* Open on the middle of the world rather than its top-left corner. Not
   cosmetic: pan is clamped so the world can never show dead space around it, and
   at a corner two of those clamps are always active — so zooming out drags the
   graph diagonally into the corner instead of pulling away from the pointer,
   which reads as the canvas fighting back. From the middle there is world on
   every side and zoom is symmetric until an edge is genuinely approached. */
function centreView() {
  var r = canvasBox();
  view.x = r.width  / 2 - (WORLD_W / 2) * view.z;
  view.y = r.height / 2 - (WORLD_H / 2) * view.z;
  clampPan();
  applyView();
}

/* Measured, not assumed: a node's height depends on its config panel, which
   depends on the schema reaching it. SHAPE only describes the head. */
function nodeBox(node) {
  var el = nodeEls[node.id];
  // offsetHeight is a layout value and ignores ancestor transforms, so this is
  // a world-space height at any zoom.
  var h = el ? el.offsetHeight : SHAPE[node.type].h;
  return { x: node.x, y: node.y, w: NODE_W, h: h };
}

function graphBounds() {
  if (!nodes.length) return null;
  var b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  nodes.forEach(function(n) {
    var r = nodeBox(n);
    b.x1 = Math.min(b.x1, r.x);       b.y1 = Math.min(b.y1, r.y);
    b.x2 = Math.max(b.x2, r.x + r.w); b.y2 = Math.max(b.y2, r.y + r.h);
  });
  return b;
}

/* Fit caps at 100%: scaling a two-node graph up to fill the window would make
   the config text enormous and tell the user nothing. Fit is for seeing
   everything, not for filling space. */
function zoomToFit() {
  var b = graphBounds();
  if (!b) { setZoom(1); return; }
  var r = canvasBox(), pad = 70;
  var bw = Math.max(1, b.x2 - b.x1), bh = Math.max(1, b.y2 - b.y1);
  var z = Math.min((r.width - pad * 2) / bw, (r.height - pad * 2) / bh, 1);
  view.z = Math.max(MIN_ZOOM, z);
  view.x = (r.width  - bw * view.z) / 2 - b.x1 * view.z;
  view.y = (r.height - bh * view.z) / 2 - b.y1 * view.z;
  clampPan();
  applyView();
}

/* ============================================================================
   SELECTION
   ============================================================================
   Selection is transient view state keyed by node id, deliberately outside the
   graph model: it is not serialised, and it survives a render() because ids
   survive a render(). Changing it must not rebuild the canvas — a rebuild
   destroys any config control the user is mid-edit in — so every selection
   change goes through syncSelectionUI(), which only toggles classes. */

var selection = [];

function isSelected(id) { return selection.indexOf(id) !== -1; }

function setSelection(ids) {
  // Filter against live nodes so a deleted id can never linger and resurrect a
  // selection ring on a recycled element.
  selection = ids.filter(function(id, i) {
    return ids.indexOf(id) === i && findNode(id);
  });
  syncSelectionUI();
}
function selectOnly(id)     { setSelection([id]); }
function clearSelection()   { setSelection([]); }
function selectAll()        { setSelection(nodes.map(function(n){ return n.id; })); }
function addToSelection(id) { if (!isSelected(id)) setSelection(selection.concat([id])); }
function toggleSelected(id) {
  setSelection(isSelected(id)
    ? selection.filter(function(x){ return x !== id; })
    : selection.concat([id]));
}

function syncSelectionUI() {
  nodes.forEach(function(n) {
    var el = nodeEls[n.id];
    if (!el) return;
    if (isSelected(n.id)) el.classList.add('selected');
    else el.classList.remove('selected');
  });

  var bar = document.getElementById('selBar');
  var cnt = document.getElementById('selCount');
  if (!bar || !cnt) return;
  if (selection.length) {
    cnt.textContent = selection.length + ' node' + (selection.length === 1 ? '' : 's') + ' selected';
    bar.classList.add('show');
  } else {
    bar.classList.remove('show');
  }
}

/* Every node reachable from a start node, following edges in either direction —
   the connected component, which is what "this branch" means to someone looking
   at the canvas. Direction is ignored on purpose: a Compare node's two input
   chains are one visual branch even though no edge runs between them. */
function connectedComponent(startId) {
  var seen = [startId], queue = [startId];
  while (queue.length) {
    var id = queue.shift();
    connections.forEach(function(c) {
      var other = c.from === id ? c.to : (c.to === id ? c.from : null);
      if (other !== null && seen.indexOf(other) === -1) { seen.push(other); queue.push(other); }
    });
  }
  return seen;
}

function selectBranch(id) { setSelection(connectedComponent(id)); }

/* Bulk delete. Connections are dropped when either end goes, which is the same
   rule removeNode() has always used — applied once over the whole set rather
   than once per node, so a graph is never briefly inconsistent mid-delete. */
function deleteSelection() {
  if (!selection.length) return;
  var doomed = selection.slice();
  nodes = nodes.filter(function(n){ return doomed.indexOf(n.id) === -1; });
  connections = connections.filter(function(c) {
    return doomed.indexOf(c.from) === -1 && doomed.indexOf(c.to) === -1;
  });
  selection = [];
  cancelPreviewTimer(); hidePreview();
  markStale();
  render();
}

/* Take sits anywhere a row stream does: it neither reads nor writes column
   structure, so anything that could feed a Filter can feed a Take and vice
   versa. Compare stays output-only — it is superseded, and widening its
   downstream reach now would be work thrown away when it retires. */
/* Every row-stream node accepts and produces a table, so they compose freely.
   The aggregation nodes are no exception: an Aggregate result is a one-row
   table like any other, and being able to feed it onward is the whole reason
   they exist as nodes rather than as Output settings.

   Compare stays output-only. It is superseded, and widening its reach now
   would be work thrown away when it retires. */
var TABLE_NODES = ['filter', 'sort', 'take', 'aggregate', 'aggregateColumns', 'combine'];
var CONNECT_RULES = {
  source:           TABLE_NODES.concat(['compare', 'output']),
  filter:           TABLE_NODES.concat(['compare', 'output']),
  sort:             TABLE_NODES.concat(['compare', 'output']),
  take:             TABLE_NODES.concat(['compare', 'output']),
  aggregate:        TABLE_NODES.concat(['compare', 'output']),
  aggregateColumns: TABLE_NODES.concat(['compare', 'output']),
  combine:          TABLE_NODES.concat(['compare', 'output']),
  compare:          ['output'],
  output:           []
};
function canConnect(fromType, toType) {
  return (CONNECT_RULES[fromType] || []).indexOf(toType) !== -1;
}

function shapeExit(node) {
  var s = SHAPE[node.type];
  return { x: node.x + (NODE_W - s.w) / 2 + s.w, y: node.y + s.h / 2 };
}
function shapeEntry(node) {
  var s = SHAPE[node.type];
  return { x: node.x + (NODE_W - s.w) / 2, y: node.y + s.h / 2 };
}

/* Direction resolution was duplicated verbatim between the drop handler and the
   ghost-arrow preview; they had to agree or the preview would lie about what
   dropping would do. One function now serves both. */
function resolveDirection(a, b) {
  var aFrom = canConnect(a.type, b.type);
  var bFrom = canConnect(b.type, a.type);
  if (!aFrom && !bFrom) return null;
  var ex = shapeExit(a),  en = shapeEntry(b);
  var rx = shapeExit(b),  rn = shapeEntry(a);
  var fwd = Math.pow(en.x - ex.x, 2) + Math.pow(en.y - ex.y, 2);
  var rev = Math.pow(rn.x - rx.x, 2) + Math.pow(rn.y - rx.y, 2);
  if (aFrom && (!bFrom || fwd <= rev)) return { from:a, to:b, p0:ex, tip:en };
  return { from:b, to:a, p0:rx, tip:rn };
}

/* DEFAULT CONFIG PER NODE TYPE
   Written out in full rather than filled in lazily, so a saved file always
   contains every key a node uses and loading never depends on defaults that
   may have changed since the file was written. */
function defaultCfg(type) {
  if (type === 'source')  return { pop:'all', rows:'students' };
  if (type === 'filter')  return { criteria:[newCriterion()] };
  if (type === 'compare') return { measures:DEFAULT_MEASURES.slice(), sort:'wired', labels:{} };
  if (type === 'sort')    return { keys: [newSortKey()] };
  if (type === 'take')    return { n: String(TAKE_DEFAULT) };
  // Both aggregation nodes share one config shape: which measure, and (for the
  // measures that need one) which column. col:'' means "resolve against
  // whatever arrives", which is what keeps a saved query working after the
  // Source granularity is changed underneath it.
  if (type === 'aggregate')        return { op: AGG_DEFAULT_OP, col: '' };
  if (type === 'aggregateColumns') return { op: 'sum' };
  // dedupe defaults off: merge stacks rows, and discarding identical rows is a
  // decision the user makes rather than one the node makes quietly.
  if (type === 'combine') return { mode: 'merge', dedupe: false, base: '', key: '' };
  if (type === 'output')  return { show:'rows', avgCol:'', filename:'' };
  return {};
}

/* A criterion keeps a value and an operator per field, not one of each. Switching
   the field selector from Avg to Gender and back therefore restores the original
   threshold instead of a default, and the same criterion object works against
   any table schema — including ones with columns that did not exist when it was
   created. */
function newCriterion() {
  return { field:'gradeAvg', values:{}, ops:{}, course:DEFAULT_COURSE };
}

function critValue(c, field, col) {
  if (c.values && c.values[field] !== undefined) return c.values[field];
  if (col && col.def !== undefined) return col.def;
  if (col && col.values && col.values.length) return String(col.values[0]);
  return '';
}
function critOp(c, field, fallback) {
  if (c.ops && c.ops[field] !== undefined) return c.ops[field];
  return fallback;
}

/* CONFIG WRITES
   One entry point. Every control carries data-node / data-key attributes and a
   single delegated listener routes through here, so there is exactly one place
   where user input becomes model state. */
function setCfg(nodeId, key, value) {
  var n = findNode(nodeId);
  if (!n) return;
  n.cfg = n.cfg || defaultCfg(n.type);

  var m = key.match(/^crit\.(\d+)\.(.+)$/);
  if (m) {
    var c = n.cfg.criteria && n.cfg.criteria[parseInt(m[1], 10)];
    if (!c) return;
    var sub = m[2];
    if (sub === 'field')       c.field = value;
    else if (sub === 'course') c.course = value;
    else if (sub.indexOf('value:') === 0) { c.values = c.values || {}; c.values[sub.slice(6)] = value; }
    else if (sub.indexOf('op:') === 0)    { c.ops = c.ops || {};       c.ops[sub.slice(3)] = value; }
    return;
  }
  var sk = key.match(/^sort\.(\d+)\.(col|dir)$/);
  if (sk) {
    var list = n.cfg.keys || (n.cfg.keys = []);
    var k = list[parseInt(sk[1], 10)];
    if (!k) return;
    k[sk[2]] = value;
    return;
  }
  if (key.indexOf('label:') === 0) {
    n.cfg.labels = n.cfg.labels || {};
    n.cfg.labels[key.slice(6)] = value;
    return;
  }
  if (key.indexOf('measure:') === 0) {
    var mk = key.slice(8);
    var list = (n.cfg.measures || []).slice();
    var at = list.indexOf(mk);
    if (value && at === -1) list.push(mk);
    if (!value && at !== -1) list.splice(at, 1);
    // Preserve the declared order so ticking boxes out of order still yields a
    // stable column order — sorting uses the first ticked column.
    n.cfg.measures = MEASURES.filter(function(x){ return list.indexOf(x.key) !== -1; })
                             .map(function(x){ return x.key; });
    return;
  }
  n.cfg[key] = value;
}

function findNode(id) {
  for (var i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i];
  return null;
}
function inputsOf(nodeId) {
  return connections.filter(function(c){ return c.to === nodeId; })
                    .map(function(c){ return c.from; });
}

/* ADD / REMOVE */
/* Placement is relative to what the user is looking at, not to the world. Random
   scatter across a 5000px world would drop most new nodes off screen; scatter
   across the viewport would put them wherever the window edge happens to be.
   The middle of the current view is the only spot that is always visible and
   always means the same thing.

   The step-out loop keeps a run of clicks from stacking nodes on one pixel: each
   new node takes the first free slot on a widening diagonal. Cheap because it
   only ever inspects nodes already placed, and n is small by construction. */
var PLACE_STEP = 46;
var PLACE_CLEAR = 34;

function freeSpotNear(cx, cy) {
  for (var ring = 0; ring < 40; ring++) {
    var x = cx + ring * PLACE_STEP, y = cy + ring * PLACE_STEP;
    x = Math.max(10, Math.min(WORLD_W - NODE_W - 10, x));
    y = Math.max(10, Math.min(WORLD_H - 160, y));
    var clash = nodes.some(function(n) {
      return Math.abs(n.x - x) < PLACE_CLEAR && Math.abs(n.y - y) < PLACE_CLEAR;
    });
    if (!clash) return { x: Math.round(x), y: Math.round(y) };
  }
  return { x: Math.round(cx), y: Math.round(cy) };
}

function addNode(type) {
  var c = viewCentreWorld();
  var spot = freeSpotNear(c.x - NODE_W / 2, c.y - SHAPE[type].h / 2);
  var color = EDGE_PALETTE[edgeColorIndex++ % EDGE_PALETTE.length];
  var id = uid();
  nodes.push({
    id: id, type: type,
    x: spot.x, y: spot.y,
    color: color,
    cfg: defaultCfg(type)
  });
  /* The new node is deliberately NOT selected. Selection means "the thing I am
     about to act on", and arriving from the toolbar is not that — the user
     picked a node type, not a target. Selecting happens by clicking or dragging
     a node, which is the point at which they have actually pointed at one.

     The existing selection is cleared, though. Leaving it would mean that after
     selecting a few nodes and then adding one, Backspace deletes the old
     selection rather than the node just added — the opposite of what the last
     action suggests, and unrecoverable without undo. */
  selection = [];
  markStale();
  render();
}

function removeNode(id) {
  nodes = nodes.filter(function(n){ return n.id !== id; });
  connections = connections.filter(function(c){ return c.from !== id && c.to !== id; });
  selection = selection.filter(function(x){ return x !== id; });
  markStale();
  render();
}

function clearAll() {
  nodes = []; connections = []; edgeColorIndex = 0;
  exportData = {}; resultsFresh = false;
  selection = [];
  cancelPreviewTimer(); hidePreview();
  view.z = 1; centreView();
  render();
  setOutput('<div class="placeholder">Run a query to see results</div>');
}

/* Every one of these buttons calls render(), which destroys the button that was
   just clicked along with the rest of the panel. Focus then falls to <body>,
   leaving the user looking at a panel the keyboard no longer considers active —
   the state that made a stray Backspace destructive. Putting focus back on the
   rebuilt panel keeps the two in agreement, and gives keyboard users somewhere
   sensible to tab on from rather than the top of the document. */
function focusCfg(nodeId, keyPrefix) {
  var el = nodeEls[nodeId];
  if (!el) return;
  var ctl = keyPrefix ? el.querySelector('[data-key^="' + keyPrefix + '"]') : null;
  if (!ctl) ctl = el.querySelector('[data-node]');
  if (ctl && ctl.focus) ctl.focus();
}

function addCriterion(nodeId) {
  var n = findNode(nodeId);
  if (!n || n.type !== 'filter') return;
  n.cfg.criteria.push(newCriterion());
  markStale();
  render();
  focusCfg(nodeId, 'crit.' + (n.cfg.criteria.length - 1) + '.');
}
function removeCriterion(nodeId, idx) {
  var n = findNode(nodeId);
  if (!n || n.type !== 'filter') return;
  n.cfg.criteria.splice(idx, 1);
  markStale();
  render();
  focusCfg(nodeId);
}

/* Sort keys use the same add/remove shape as filter criteria — one list, the
   first row not removable — so the two panels behave identically. Priority is
   list position: the first key decides, later ones break ties. */
function addSortKey(nodeId) {
  var n = findNode(nodeId);
  if (!n || n.type !== 'sort') return;
  n.cfg.keys = n.cfg.keys || [];
  n.cfg.keys.push(newSortKey());
  markStale();
  render();
  focusCfg(nodeId, 'sort.' + (n.cfg.keys.length - 1) + '.');
}
function removeSortKey(nodeId, idx) {
  var n = findNode(nodeId);
  if (!n || n.type !== 'sort') return;
  n.cfg.keys.splice(idx, 1);
  if (!n.cfg.keys.length) n.cfg.keys.push(newSortKey());
  markStale();
  render();
  focusCfg(nodeId);
}

/* ============================================================================
   QUERY ENGINE
   ============================================================================ */

var OP_FNS = {
  gt:  function(a,b){ return a >  b; },
  gte: function(a,b){ return a >= b; },
  lt:  function(a,b){ return a <  b; },
  lte: function(a,b){ return a <= b; },
  eq:  function(a,b){ return a == b; },   // deliberate ==: '2022' from a <select> must match 2022
  ne:  function(a,b){ return a != b; }
};
var OP_SYM = { gt:'>', gte:'>=', lt:'<', lte:'<=', eq:'=', ne:'!=' };
var NUM_OPS  = ['gt','gte','lt','lte','eq','ne'];
var ENUM_OPS = ['eq','ne'];

function topoSort() {
  var inDeg = {}, adj = {};
  nodes.forEach(function(n){ inDeg[n.id] = 0; adj[n.id] = []; });
  connections.forEach(function(c) {
    if (!adj[c.from] || inDeg[c.to] === undefined) return;
    adj[c.from].push(c.to);
    inDeg[c.to]++;
  });
  var queue = nodes.filter(function(n){ return inDeg[n.id] === 0; }).map(function(n){ return n.id; });
  var order = [];
  while (queue.length) {
    var id = queue.shift();
    order.push(id);
    adj[id].forEach(function(nid){ if (--inDeg[nid] === 0) queue.push(nid); });
  }
  return order.map(findNode).filter(Boolean);
}

/* QUERY LOG — structured, not pre-baked HTML, so one entry renders as markup
   for the panel and as plain text for a file. Building HTML first and stripping
   tags later loses operators like "<": once concatenated they are
   indistinguishable from markup. */
function logEntry(kw, parts) { return { kw:kw, parts:parts }; }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function logHTML(e) {
  return '<span class="kw">' + esc(e.kw) + '</span>  ' + e.parts.map(function(p) {
    return p.c ? '<span class="' + p.c + '">' + esc(p.s) + '</span>' : esc(p.s);
  }).join(' ');
}
function logText(e) {
  return e.kw + '  ' + e.parts.map(function(p){ return p.s; }).join(' ');
}

/* SOURCE */
function sourceTable(node, log) {
  var cfg = node.cfg || defaultCfg('source');
  var pop = cfg.pop || 'all';
  var list = STUDENTS;
  if (pop !== 'all') {
    var yr = parseInt(pop, 10);
    list = STUDENTS.filter(function(s){ return s.year === yr; });
    log.push(logEntry('SOURCE', [{s:'year'}, {c:'op', s:'='}, {c:'val', s:yr}]));
  } else {
    log.push(logEntry('SOURCE', [{s:'all_students'}]));
  }
  if (cfg.rows === 'enrolments') {
    log.push(logEntry('ROWS', [{s:'one row per enrolment'}]));
    return enrolmentsTable(list);
  }
  return studentsTable(list);
}

/* MERGE
   Multiple wires into one node combine their rows. Identity is per-granularity:
   two branches that both contain student 1042 contribute one row, not two.
   Headers must match — merging a student table with an enrolment table is a
   wiring mistake, and saying so is more useful than silently producing a
   ragged table. */
function schemaKey(t) { return t.columns.map(function(c){ return c.key; }).join('|'); }

function rowKey(t, row) {
  if (hasCol(t, 'id')) return 'i' + cellAt(t, row, 'id');
  if (hasCol(t, 'studentId') && hasCol(t, 'code')) {
    return 'e' + cellAt(t, row, 'studentId') + ':' + cellAt(t, row, 'code');
  }
  return 'r' + row.join('\u0001');
}

function unionTables(tables) {
  if (tables.length === 0) return makeTable(STUDENT_COLUMNS, []);
  if (tables.length === 1) return tables[0];
  var first = schemaKey(tables[0]);
  for (var i = 1; i < tables.length; i++) {
    if (schemaKey(tables[i]) !== first) {
      // Quote the option labels verbatim, so the message points at the control
      // to change rather than at an abstraction the user has to translate.
      return { error: 'Merged inputs have different columns. A Source set to ' +
        '"One per student" and one set to "One per enrolment" cannot feed the same node — ' +
        'set both to the same Rows option, or give them separate Outputs.' };
    }
  }
  var seen = {}, rows = [];
  tables.forEach(function(t) {
    t.rows.forEach(function(r) {
      var k = rowKey(t, r);
      if (!seen[k]) { seen[k] = true; rows.push(r); }
    });
  });
  return makeTable(tables[0].columns, rows);
}

/* FILTER
   The available fields come from the incoming table's own columns, so a Filter
   wired behind an enrolment Source offers Mark and Course while the same node
   behind a student Source offers Avg and Specialisation. Nothing about student
   records is hardcoded here. */
function courseFields() {
  return [
    // Named for what they do to a ROW, not for the field they inspect. On a
    // student table these keep whole students — a student who took one SWEN
    // course is kept with all eight of their enrolments intact. Calling this
    // "Course subject" invited it to be read as "keep only SWEN enrolments",
    // which is what the same filter does at enrolment granularity.
    { key:'courses.subject', label:'Took subject',   kind:'courseSubject' },
    { key:'courses.code',    label:'Took course',    kind:'courseCode' },
    { key:'courses.mark',    label:'Mark in course', kind:'courseMark' }
  ];
}

/* A column can opt out of being filterable with `filter: false`. Year does:
   the Source already scopes the population by year, and offering it twice
   invited a graph that says 2022 in one place and 2023 in another. The column
   still exists — it is displayed, exported and grouped on like any other. */
function filterFields(schema) {
  var out = [];
  schema.columns.forEach(function(c) {
    if (c.filter === false) {
      return;
    }
    if (c.type === COLTYPE.COURSES) {
      out.push.apply(out, courseFields());
    } else {
      out.push({ key:c.key, label:c.label, kind:c.type, column:c });
    }
  });
  return out;
}

function fieldByKey(schema, key) {
  var fs = filterFields(schema);
  for (var i = 0; i < fs.length; i++) if (fs[i].key === key) return fs[i];
  return null;
}

function opsFor(kind) {
  if (kind === COLTYPE.NUMBER || kind === 'courseMark') return NUM_OPS;
  if (kind === COLTYPE.TEXT) return ENUM_OPS;
  return ENUM_OPS;
}
function defaultOpFor(kind) {
  if (kind === COLTYPE.NUMBER || kind === 'courseMark') return 'gt';
  return 'eq';
}

function applyFilter(node, t, log) {
  var crits = (node.cfg && node.cfg.criteria) || [];

  for (var ci = 0; ci < crits.length; ci++) {
    var c = crits[ci];
    var f = fieldByKey(t, c.field);

    // A criterion can outlive the column it referred to — rewiring a Filter from
    // a student Source to an enrolment one is enough. Skipping with a note is
    // better than erroring: the rest of the query still runs and the log says
    // exactly what was ignored.
    if (!f) {
      log.push(logEntry('SKIP', [{s:'no column'}, {c:'val', s:'"'+(c.field||'?')+'"'}]));
      continue;
    }

    var res = applyCriterion(t, c, f, log);
    if (res.error) return res;
    t = res.table;
  }
  return { table: t };
}

function applyCriterion(t, c, f, log) {
  var coursesIdx = coursesColIndex(t);

  if (f.kind === 'courseSubject' || f.kind === 'courseCode') {
    if (coursesIdx === -1) return { table: t };
    var want = critValue(c, f.key, null) ||
               (f.kind === 'courseSubject' ? SUBJECTS[0] : DEFAULT_COURSE);
    var prop = f.kind === 'courseSubject' ? 'subject' : 'code';
    var rows = t.rows.filter(function(r) {
      var list = r[coursesIdx] || [];
      return list.some(function(e){ return e[prop] === want; });
    });
    log.push(logEntry('FILTER', [
      {s:'student'}, {c:'op', s:'took'},
      {s: prop === 'subject' ? 'subject' : 'course'}, {c:'val', s:'"'+want+'"'}
    ]));
    return { table: makeTable(t.columns, rows) };
  }

  if (f.kind === 'courseMark') {
    // Two conditions in one: enrolled in the course AND the mark passes. A
    // student who never took it is excluded rather than treated as zero, which
    // would silently satisfy every "less than" test.
    if (coursesIdx === -1) return { table: t };
    var code = c.course || DEFAULT_COURSE;
    var num = parseFloat(critValue(c, f.key, { def:'70' }));
    if (isNaN(num)) return { error: 'Course mark must be a number.' };
    var op = critOp(c, f.key, 'gte');
    var fn = OP_FNS[op] || OP_FNS.gte;
    var mrows = t.rows.filter(function(r) {
      var list = r[coursesIdx] || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].code === code) return fn(list[i].mark, num);
      }
      return false;
    });
    log.push(logEntry('FILTER', [
      {s:'student'}, {c:'op', s:'took'}, {s: code + '.mark'},
      {c:'op', s:(OP_SYM[op] || '>=')}, {c:'val', s:num}
    ]));
    return { table: makeTable(t.columns, mrows) };
  }

  var idx = colIndex(t, f.key);
  var col = f.column;
  var opk = critOp(c, f.key, defaultOpFor(f.kind));
  var fnc = OP_FNS[opk] || OP_FNS.eq;
  var raw = critValue(c, f.key, col);

  if (col.type === COLTYPE.NUMBER) {
    var n = parseFloat(raw);
    if (isNaN(n)) return { error: col.label + ' value must be a number.' };
    var nrows = t.rows.filter(function(r){ return fnc(Number(r[idx]), n); });
    log.push(logEntry('FILTER', [
      {s:col.key}, {c:'op', s:(OP_SYM[opk]||'>')}, {c:'val', s:n}
    ]));
    return { table: makeTable(t.columns, nrows) };
  }

  var out = t.rows.filter(function(r){ return fnc(String(r[idx]), String(raw)); });
  log.push(logEntry('FILTER', [
    {s:col.key}, {c:'op', s:(OP_SYM[opk]||'=')}, {c:'val', s:'"'+raw+'"'}
  ]));
  return { table: makeTable(t.columns, out) };
}

/* ============================================================================
   COMPARE
   ============================================================================
   NOTE: superseded by the planned SelectFor / Histogram node. Compare is a
   group-by whose groups are wired by hand — the user builds each branch as a
   separate Filter chain instead of naming a column to split on. It is kept
   working here so the table refactor changes no behaviour, but new work should
   go into SelectFor rather than into extending this.                          */

/* SORT
   Reorders rows by one or more columns with a priority, the way Excel's sort
   dialog does: the first key decides, the second breaks its ties, and so on.
   Like Take it is a pure row operation — same columns out as in — so
   computeSchemas() needs no case for it either.

   This is the first node that visibly earns the uniform table model. It sorts
   a student list, an enrolment list and (once Histogram lands) a histogram
   with no knowledge of any of them: it asks the incoming table for its columns
   and their types, and everything else follows from that. */

// COURSES cells hold an array of enrolment objects. There is no defensible
// ordering on "eight courses" — by count? by first code? — so the column is
// offered nowhere rather than sorted arbitrarily.
function sortableCols(t) {
  return t.columns.filter(function(c){ return c.type !== COLTYPE.COURSES; });
}

/* Declared order beats lexical order. Specialisation and Year are ENUMs whose
   `values` array is already the order a reader expects, and letterGrade now
   carries an explicit `order` for the same reason: sorted as text, an A+ lands
   between A and A- because '+' precedes '-' in ASCII. Any column may opt in by
   declaring `order`; columns that declare neither fall back to comparison by
   value. */
function ordinalsFor(col) {
  if (col && col.order) return col.order;
  if (col && col.type === COLTYPE.ENUM && col.values) return col.values;
  return null;
}

function isBlank(v) {
  return v === undefined || v === null || v === '' ||
         (typeof v === 'number' && !isFinite(v));
}

/* One comparator per column, built once per sort rather than per comparison. */
function comparatorFor(col) {
  var ord = ordinalsFor(col);
  if (ord) {
    var rank = {};
    ord.forEach(function(v, i){ rank[String(v)] = i; });
    return function(a, b) {
      // A value absent from the declared order sorts after every declared one,
      // then alphabetically among its peers — so a course prefix added to the
      // catalogue without being added to the order still lands somewhere
      // predictable instead of at the front.
      var ra = rank[String(a)], rb = rank[String(b)];
      if (ra === undefined && rb === undefined) return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0);
      if (ra === undefined) return 1;
      if (rb === undefined) return -1;
      return ra - rb;
    };
  }
  if (col && col.type === COLTYPE.NUMBER) {
    return function(a, b){ return Number(a) - Number(b); };
  }
  // numeric:true so SWEN430 precedes SWEN4300, sensitivity:'base' so case does
  // not split otherwise-equal values into two groups.
  return function(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric:true, sensitivity:'base' });
  };
}

var SORT_DIRS = ['asc', 'desc'];

// Direction labels follow the column type: "A → Z" is meaningless on a mark and
// "high → low" is meaningless on a name.
function dirLabel(col, dir) {
  if (col && col.type === COLTYPE.NUMBER) return dir === 'desc' ? 'high → low' : 'low → high';
  if (ordinalsFor(col))                   return dir === 'desc' ? 'last → first' : 'first → last';
  return dir === 'desc' ? 'Z → A' : 'A → Z';
}

function newSortKey() { return { col:'', dir:'asc' }; }

/* Resolve the configured keys against a table. A key naming a column that is
   no longer there — rewire a Source from students to enrolments and 'gradeAvg'
   simply stops existing — is reported rather than silently dropped, because a
   sort that quietly stopped happening looks identical to one that ran. */
function resolveSortKeys(node, t) {
  var cfg = (node && node.cfg) || defaultCfg('sort');
  var avail = sortableCols(t);
  var out = [];
  (cfg.keys || []).forEach(function(k) {
    var key = k && k.col;
    if (!key) { if (avail.length) out.push({ col:avail[0], dir:(k && k.dir) || 'asc' }); return; }
    var col = colByKey(t, key);
    if (!col || col.type === COLTYPE.COURSES) { out.push({ missing:key }); return; }
    out.push({ col:col, dir:(k.dir === 'desc' ? 'desc' : 'asc') });
  });
  return out;
}

/* Compares two decorated rows {row, i} against a plan of resolved keys. Pulled
   out of applySort so the tie rule is a testable function rather than a
   property of whichever engine runs Array.sort. */
function sortRowComparator(plan) {
  return function(A, B) {
    for (var p = 0; p < plan.length; p++) {
      var a = A.row[plan[p].idx], b = B.row[plan[p].idx];
      // Blanks sink to the bottom under both directions. Reversing a sort
      // should not drag empty cells to the top of the report.
      var ba = isBlank(a), bb = isBlank(b);
      if (ba || bb) { if (ba && bb) continue; return ba ? 1 : -1; }
      var c = plan[p].cmp(a, b);
      if (c) return c * plan[p].sign;
    }
    return A.i - B.i;   // fully tied: arrival order decides
  };
}

function applySort(node, t, log) {
  var keys = resolveSortKeys(node, t);
  var missing = keys.filter(function(k){ return k.missing; });
  var live    = keys.filter(function(k){ return k.col; });

  missing.forEach(function(k) {
    log.push(logEntry('SORT', [{s:'skipped'}, {c:'val', s:k.missing},
                               {s:'— not a column in this table'}]));
  });
  if (!live.length) return t;

  log.push(logEntry('SORT', live.reduce(function(parts, k, i) {
    if (i) parts.push({s:'then'});
    parts.push({c:'val', s:k.col.label}, {s:dirLabel(k.col, k.dir)});
    return parts;
  }, [])));

  var plan = live.map(function(k) {
    return { idx: colIndex(t, k.col.key), cmp: comparatorFor(k.col), sign: k.dir === 'desc' ? -1 : 1 };
  });

  /* Decorated with the arrival position and compared on it last. Array.sort is
     specified stable since ES2019, but relying on that would make the tie
     behaviour a property of the engine rather than of this node — and ties are
     the normal case here, not the edge case (sorting 80 students by Year gives
     two groups of forty). The comparator is extracted so a test can assert the
     tiebreak directly: an engine that is already stable hides the difference,
     so exercising it through sort() alone would prove nothing. */
  var cmpRows = sortRowComparator(plan);
  var decorated = t.rows.map(function(row, i){ return { row:row, i:i }; });
  decorated.sort(cmpRows);

  /* A new rows array, never an in-place sort. One node's result object is read
     by every node wired downstream of it, so sorting t.rows in place would
     reorder a sibling branch's data as a side effect — and the bug would only
     appear on graphs that fork. */
  return makeTable(t.columns, decorated.map(function(d){ return d.row; }), t.meta);
}

/* TAKE
   Keeps the first N rows and discards the rest. It is the whole node: no
   column is added, removed, renamed or retyped, so the outgoing header is the
   incoming header and computeSchemas() needs no case for it.

   Deliberately not a sort. "Top 10 by mark" is Sort then Take, two nodes doing
   one thing each, which is why the supervisor asked for Take as its own node
   rather than a Top-N that quietly sorts on your behalf. Behind an unsorted
   input this returns the first ten rows in whatever order they arrived — which
   is a legitimate thing to want (a sample to eyeball) and is stated in the
   panel so it cannot be mistaken for a ranking.

   N is stored as typed, never parsed on write. A number input yields '' while
   the field is mid-edit and '1e3' if pasted; coercing on write would have to
   pick a number for text the user has not finished typing, and would then feed
   that guess back into the control. Coercion happens once, on read. */
var TAKE_DEFAULT = 10;
var TAKE_MIN = 1;

function takeCount(node) {
  var raw = node && node.cfg ? node.cfg.n : undefined;
  var n = parseInt(raw, 10);
  // Blank, non-numeric or out of range all fall back rather than throwing: a
  // half-typed field must not break a Run, and a saved file written by hand
  // must not be able to produce a negative slice.
  if (!isFinite(n) || n < TAKE_MIN) return TAKE_DEFAULT;
  return Math.floor(n);
}

function applyTake(node, t, log) {
  var n = takeCount(node);
  var before = t.rows.length;

  // Log what actually happened, not what was asked for. "first 10" above a
  // seven-row table reads as a bug in the tool; saying all 7 were kept shows
  // the node ran and the input was simply short.
  log.push(logEntry('TAKE', before <= n
    ? [{s:'first'}, {c:'val', s:n}, {s:'rows — kept all'}, {c:'val', s:before}]
    : [{s:'first'}, {c:'val', s:n}, {s:'rows of'}, {c:'val', s:before}]));

  if (before <= n) return t;
  // meta is carried through: Take is a row operation and has no opinion about
  // whatever a producer upstream recorded there.
  return makeTable(t.columns, t.rows.slice(0, n), t.meta);
}

var MEASURES = [
  { key:'count',   label:'Students',         head:'Students'  },
  { key:'average', label:'Avg grade',        head:'Avg grade' },
  { key:'share',   label:'Share of total',   head:'Share'     },
  { key:'courses', label:'Distinct courses', head:'Courses'   }
];
var DEFAULT_MEASURES = ['count', 'average'];

function measuresOf(node) {
  var m = node.cfg && node.cfg.measures;
  // Array.isArray, not a truthy length check: a string has .length, and a
  // loaded file with measures:"count" would silently yield zero columns.
  return Array.isArray(m) ? m : DEFAULT_MEASURES;
}

/* Which column "average" refers to, chosen from the table rather than assumed.
   gradeAvg on a student table, mark on an enrolment table, otherwise the first
   numeric column that is not an identifier. */
function defaultAvgCol(t) {
  if (hasCol(t, 'gradeAvg')) return 'gradeAvg';
  if (hasCol(t, 'mark')) return 'mark';
  var nums = numericCols(t).filter(function(c) {
    return c.key !== 'id' && c.key !== 'studentId' && c.key !== 'points';
  });
  return nums.length ? nums[0].key : '';
}

function meanOf(t, key) {
  if (!key || !hasCol(t, key) || t.rows.length === 0) return 0;
  var i = colIndex(t, key), sum = 0;
  t.rows.forEach(function(r){ sum += Number(r[i]) || 0; });
  return sum / t.rows.length;
}

function stripQuotes(s) { return String(s).replace(/^"|"$/g, ''); }

// A branch's label derived from the query that produced it, so a user who never
// typed one still gets something readable. Filters describe a branch far better
// than its source does, so they win.
function autoLabel(r, idx) {
  var filters = r.log.filter(function(e){ return e.kw === 'FILTER'; });
  if (filters.length) {
    return filters.map(function(e) {
      return e.parts.map(function(p){ return stripQuotes(p.s); }).join(' ');
    }).join(', ');
  }
  var src = r.log.filter(function(e){ return e.kw === 'SOURCE'; })[0];
  if (src) {
    var txt = src.parts.map(function(p){ return stripQuotes(p.s); }).join(' ');
    return txt === 'all_students' ? 'All students' : txt;
  }
  return 'Branch ' + (idx + 1);
}

function compareColumns(keys) {
  return [{ key:'branch', label:'Branch', type:COLTYPE.TEXT }].concat(
    keys.map(function(k) {
      var m = MEASURES.filter(function(x){ return x.key === k; })[0];
      return { key:k, label:(m ? m.head : k), type:COLTYPE.NUMBER };
    })
  );
}

function buildCompare(node, inIds, res, log) {
  var labels = (node.cfg && node.cfg.labels) || {};
  var keys = measuresOf(node).filter(function(k) {
    return MEASURES.some(function(m){ return m.key === k; });
  });

  var branches = [];
  inIds.forEach(function(inId, i) {
    var r = res[inId];
    if (!r) return;
    var manual = labels[inId];
    branches.push({
      id: inId,
      label: (manual && String(manual).trim()) ? String(manual).trim() : autoLabel(r, i),
      table: r.table
    });
  });

  var total = branches.reduce(function(a, b){ return a + b.table.rows.length; }, 0);

  branches.forEach(function(b) {
    var avgKey = defaultAvgCol(b.table);
    b.values = {
      count:   b.table.rows.length,
      average: meanOf(b.table, avgKey),
      share:   total ? (b.table.rows.length / total) * 100 : 0,
      courses: breakdownTable(b.table).rows.length
    };
  });

  var sortBy = (node.cfg && node.cfg.sort) || 'wired';
  if (sortBy === 'label') {
    branches.sort(function(a, b){ return a.label.localeCompare(b.label); });
  } else if (keys.length && (sortBy === 'desc' || sortBy === 'asc')) {
    var dir = sortBy === 'desc' ? -1 : 1;
    branches.sort(function(a, b){ return dir * (a.values[keys[0]] - b.values[keys[0]]); });
  }

  log.push(logEntry('COMPARE', [
    {s: branches.length + (branches.length === 1 ? ' branch' : ' branches')}
  ]));

  // The branch tables ride along in meta so an Output can still show per-branch
  // detail. The table itself is the primary value — everything downstream can
  // read it without knowing Compare exists.
  return makeTable(
    compareColumns(keys),
    branches.map(function(b) {
      return [b.label].concat(keys.map(function(k) {
        return k === 'share' ? b.values[k] : b.values[k];
      }));
    }),
    { branches: branches, measures: keys }
  );
}

/* ============================================================================
   OUTPUT
   ============================================================================
   Every Output emits a table, including Count and Average — a scalar is a 1x1
   table. That is what lets one renderer and one CSV writer serve every result
   shape instead of a branch per output type.                                  */

var ROW_SHOWS = ['rows', 'count', 'average', 'courses'];
var CMP_SHOWS = ['summary', 'lists', 'courses'];

function compareFeedsOutput(node) {
  return inputsOf(node.id).some(function(id) {
    var up = findNode(id);
    return up && up.type === 'compare';
  });
}

// 'courses' is valid on both sides, so rewiring an Output across a Compare
// keeps the selection instead of resetting it.
function normaliseShow(node) {
  var v = node.cfg && node.cfg.show;
  if (compareFeedsOutput(node)) {
    if (CMP_SHOWS.indexOf(v) !== -1) return v;
    return (v === 'rows') ? 'lists' : 'summary';
  }
  if (ROW_SHOWS.indexOf(v) !== -1) return v;
  return (v === 'lists' || v === 'summary') ? 'rows' : 'count';
}

function outputTable(node, t) {
  var show = normaliseShow(node);

  if (show === 'count') {
    return makeTable([{ key:'count', label:'Count', type:COLTYPE.NUMBER }],
                     [[t.rows.length]]);
  }
  if (show === 'average') {
    // A saved avgCol can outlive its column — rewiring from a student Source to
    // an enrolment one is enough. Fall back rather than averaging nothing.
    var key = (node.cfg && node.cfg.avgCol) || '';
    if (!key || !hasCol(t, key)) key = defaultAvgCol(t);
    var col = colByKey(t, key);
    return makeTable(
      [{ key:'average', label: col ? ('Average ' + col.label) : 'Average', type:COLTYPE.NUMBER },
       { key:'n',       label:'Rows',                              type:COLTYPE.NUMBER }],
      [[meanOf(t, key), t.rows.length]]
    );
  }
  if (show === 'courses') return breakdownTable(t);
  return t; // 'rows', 'summary' and 'lists' all display the incoming table
}

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

   1. The empty case is blank, not zero. The count of nothing is 0 — that is a
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
      the column. Dropping would make the output header depend on the data —
      and matching headers is precisely what Combine will require in order to
      stack two of these results. A header that quietly changes shape when a
      column happens to be non-numeric would break that at the worst moment. */

var AGG_OPS = [
  { key:'count',   label:'Count',   verb:'Count of',   needsCol:false },
  { key:'sum',     label:'Sum',     verb:'Sum of',     needsCol:true  },
  { key:'average', label:'Average', verb:'Average',    needsCol:true  },
  { key:'min',     label:'Minimum', verb:'Minimum',    needsCol:true  },
  { key:'max',     label:'Maximum', verb:'Maximum',    needsCol:true  }
];
var AGG_DEFAULT_OP = 'count';

function aggOp(node) {
  var k = node && node.cfg ? node.cfg.op : null;
  for (var i = 0; i < AGG_OPS.length; i++) if (AGG_OPS[i].key === k) return AGG_OPS[i];
  return AGG_OPS[0];   // anything unrecognised, including a hand-edited file
}

// Columns a numeric measure can be applied to. Identifiers are excluded for the
// same reason Output's Average excludes them: the sum of a set of student IDs
// is a number, but it is not a fact about anything.
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
   zero — a missing mark is not a mark of nought, and treating it as one drags
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
   trusted from config. A saved key can outlive its column — rewiring a Source
   from students to enrolments is enough — so this falls back the same way
   Output's Average does. */
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
// in one place so they cannot disagree — the registry invariant depends on it.
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
      log.push(logEntry('AGGREGATE', [{s:op.label.toLowerCase()}, {s:'— no numeric column in this table'}]));
      return makeTable([outCol], [[null]]);
    }
    value = reduceValues(op.key, columnValues(t, col.key));
    log.push(logEntry('AGGREGATE', [{s:op.label.toLowerCase() + ' of'}, {c:'val', s:col.label},
                                    {s:'over'}, {c:'val', s:t.rows.length}, {s:'rows'}]));
  }
  return makeTable([outCol], [[value]]);
}

/* ---- AggregateColumns: many rows -> one row ------------------------------- */

/* Keys and labels are preserved so the result still reads as the same table —
   that is what makes "run a histogram twice, stack them, total the columns"
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

/* ============================================================================
   COMBINE
   ============================================================================
   Two or more tables with matching headers into one. Modes: merge, intersect,
   difference — the supervisor's suggestion that "set ops" is not a node but a
   setting on Combine.

   Combine reads its inputs separately rather than letting the graph merge them
   first, for the same reason Compare does: it has to know which table is which.
   That is also what keeps it clear of the implicit multi-wire union, which
   matters more than it sounds:

   MERGE CONCATENATES; IT DOES NOT DEDUPLICATE BY DEFAULT.
   The implicit union deduplicates by rowKey(), and for merging two student
   lists that is right — student 1042 appearing in both branches is one
   student. For stacking two result tables it is wrong, and wrong in a way that
   produces a plausible number rather than an error. Take the supervisor's own
   worked example: run a Histogram once per year, stack the two rows, total the
   columns. rowKey() has no id column to work with there, so it falls back to
   joining the whole row — and if 2022 and 2023 happen to produce identical
   counts, the two rows are identical, one is discarded, and the sum silently
   halves. The failure is invisible precisely when the data is unremarkable.

   So row identity is a choice the user makes, not one the tool makes for them:
   merge concatenates, and dropping duplicates is a tick box. That also gives a
   true set union (merge + drop duplicates) alongside intersect and difference,
   which is what "set ops" meant in the first place.                          */

var COMBINE_MODES = [
  { key:'merge',      label:'Merge (stack rows)' },
  { key:'intersect',  label:'Intersect (in all inputs)' },
  { key:'difference', label:'Difference (in the base only)' }
];

function combineMode(node) {
  var k = node && node.cfg ? node.cfg.mode : null;
  for (var i = 0; i < COMBINE_MODES.length; i++) if (COMBINE_MODES[i].key === k) return COMBINE_MODES[i];
  return COMBINE_MODES[0];
}

/* Which input is the base. Intersect is symmetric, but difference is not —
   A minus B is not B minus A — and connection order is an artefact of the
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

/* Order the input tables so the chosen base is first. Done here rather than in
   combineTables so the reduction itself has one rule — "the base is tables[0]"
   — and the mapping from a node id to a position lives with the node ids. */
function combineOrdered(node, inIds, tables) {
  var baseId = combineBaseId(node, inIds);
  var at = -1;
  for (var i = 0; i < inIds.length; i++) if (inIds[i] === baseId) { at = i; break; }
  if (at <= 0) return tables;
  return [tables[at]].concat(tables.filter(function(_, i){ return i !== at; }));
}

function combineTables(node, tables, log) {
  if (!tables.length) return { table: makeTable([], []) };

  // Headers must match. The same rule the implicit union enforces, restated
  // here because Combine bypasses it — and worth its own message, since the
  // likely mistake is different: stacking two tables that came from different
  // shapes of query rather than mixing granularities.
  var first = schemaKey(tables[0]);
  for (var i = 1; i < tables.length; i++) {
    if (schemaKey(tables[i]) !== first) {
      return { error: 'Combine needs inputs with the same columns. ' +
        'These inputs have different headers, so their rows cannot be stacked — ' +
        'make the branches produce the same columns, or give them separate Outputs.' };
    }
  }

  if (tables.length === 1) {
    log.push(logEntry('COMBINE', [{s:'one input — passed through'}]));
    return { table: tables[0] };
  }

  var mode = combineMode(node);
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

  return { table: makeTable(base.columns, out, base.meta) };
}

/* ============================================================================
   NODE SPECIFICATIONS
   ============================================================================
   One entry per node type, declaring the two things the graph walks need to
   know: what shape comes out, and how the rows are computed.

     merges   — inputs are unioned into one table before the node runs. False
                for nodes that read their inputs separately (Compare) or have
                none (Source).
     schema   — (node, inSchema) -> table of columns, no rows. The header this
                node produces, derived from the header it is given.
     rows     — (node, table, log) -> table | {error}. Omitted by nodes that
                pass their rows through untouched.

   Why a registry rather than branches in two functions: schema propagation and
   evaluation must agree about every node, and until now they agreed by
   coincidence. Filter, Sort and Take leave the header alone, so schema
   propagation could get away with `out[node.id] = ins[0]` — a pass-through
   that is simply wrong for every node still to be built. Histogram, Aggregate
   and Project all rewrite the header, and each would have needed a branch in
   computeSchemas() and another in evaluateGraph(), in two places that no
   mechanism keeps in step.

   Declaring both against one type means a new node is one entry here plus its
   implementation, and the invariant that ties the pair together —
   headerOnly(rows(node, t)) equals schema(node, headerOnly(t)) — is a property
   of the registry that can be tested across every type at once, rather than
   remembered.                                                                */

function passthroughSchema(node, inSchema) { return inSchema; }

var NODE_SPEC = {
  source: {
    merges: false,
    // No input to derive from: granularity is a Source setting, so the header
    // is a function of the node's own config alone.
    schema: function(node) {
      var cfg = node.cfg || defaultCfg('source');
      return headerOnly(cfg.rows === 'enrolments'
        ? makeTable(ENROLMENT_COLUMNS, [])
        : makeTable(STUDENT_COLUMNS, []));
    },
    evaluate: function(node, ctx) {
      return { table: sourceTable(node, ctx.log), hasSource: true };
    }
  },

  filter: {
    merges: true,
    schema: passthroughSchema,
    rows: function(node, t, log) { return applyFilter(node, t, log); }
  },

  sort: {
    merges: true,
    schema: passthroughSchema,
    rows: function(node, t, log) { return { table: applySort(node, t, log) }; }
  },

  take: {
    merges: true,
    schema: passthroughSchema,
    rows: function(node, t, log) { return { table: applyTake(node, t, log) }; }
  },

  aggregate: {
    merges: true,
    schema: aggregateSchema,
    rows: function(node, t, log) { return { table: applyAggregate(node, t, log) }; }
  },

  aggregateColumns: {
    merges: true,
    schema: aggregateColumnsSchema,
    rows: function(node, t, log) { return { table: applyAggregateColumns(node, t, log) }; }
  },

  combine: {
    /* Reads its inputs separately. Not because it treats them differently the
       way Compare does — the header is the same for all of them — but because
       the implicit union it would otherwise pass through deduplicates rows,
       which is exactly the behaviour Combine exists to put under the user's
       control. Its header is still whatever arrives, so the schema is the
       ordinary pass-through. */
    merges: false,
    schema: passthroughSchema,
    evaluate: function(node, ctx) {
      // The base is a node the user named, not the wire that happened to be
      // drawn first, so the tables are ordered before the reduction sees them.
      var ctabs = combineOrdered(node, ctx.inIds,
        ctx.ins.map(function(r){ return r.table; }));
      var out = combineTables(node, ctabs, ctx.log);
      return {
        table: out.table,
        error: out.error,
        hasSource: ctx.ins.some(function(r){ return r.hasSource; })
      };
    }
  },

  compare: {
    // The one node that keeps its inputs apart rather than merging them: each
    // branch becomes a row, so it reads the branch results directly.
    merges: false,
    schema: function(node) { return makeTable(compareColumns(measuresOf(node)), []); },
    evaluate: function(node, ctx) {
      return {
        table: buildCompare(node, ctx.inIds, ctx.res, ctx.log),
        hasSource: ctx.ins.some(function(r){ return r.hasSource; })
      };
    }
  },

  output: {
    merges: true,
    /* An Output's result IS its input: outputTable() applies the chosen view at
       render time, not here, so the count/average/breakdown reshaping is not
       part of the graph. Nothing reads downstream of an Output — CONNECT_RULES
       gives it no outgoing edges — so the distinction costs nothing today. If
       an Output ever becomes chainable, this is the entry that has to grow a
       real schema, and outputTable() is already the function to call. */
    schema: passthroughSchema
  }
};

function specFor(type) { return NODE_SPEC[type] || null; }

/* GRAPH EVALUATION
   Walks the DAG in topological order. Each node computes from its own inputs,
   so parallel branches stay independent.
   Returns {res: {nodeId: {table, log, hasSource}}} or {error}. */
function evaluateGraph() {
  var order = topoSort();
  if (order.length < nodes.length) {
    return { error: 'Circular connection detected — remove an arrow that loops back on itself.' };
  }

  var res = {};
  for (var i = 0; i < order.length; i++) {
    var node = order[i];
    var spec = specFor(node.type);
    if (!spec) continue;   // a type no longer supported: skip rather than throw
    var log = [], table, hasSource;

    var inIds = inputsOf(node.id);
    var ins = inIds.map(function(id){ return res[id]; }).filter(Boolean);
    if (node.type !== 'source') {
      ins.forEach(function(r){ log.push.apply(log, r.log); });
    }

    if (spec.merges) {
      if (ins.length > 1) log.push(logEntry('MERGE', [{s: ins.length + ' inputs'}]));
      var merged = unionTables(ins.map(function(r){ return r.table; }));
      if (merged.error) return { error: merged.error };
      table = merged;
      hasSource = ins.some(function(r){ return r.hasSource; });

      if (spec.rows) {
        var out = spec.rows(node, table, log);
        if (out.error) return { error: out.error };
        table = out.table;
      }
    } else {
      var ev = spec.evaluate(node, { inIds: inIds, ins: ins, res: res, log: log });
      // A non-merging node can fail the same way a row transform can — Combine
      // rejects mismatched headers — so the error has to surface here too,
      // rather than only on the spec.rows path.
      if (ev.error) return { error: ev.error };
      table = ev.table;
      hasSource = ev.hasSource;
    }

    res[node.id] = { table: table, log: log, hasSource: hasSource };
  }
  return { res: res };
}

/* SCHEMA PROPAGATION
   The same walk as evaluateGraph but carrying only column headers, no rows. It
   is what lets a Filter's field list and an Output's average-column list be
   built from whatever is actually flowing into them. Cheap enough to run on
   every render because no row is ever touched.

   Both walks now read the same registry, so a node cannot describe one header
   here and produce another there. */
function computeSchemas() {
  var order = topoSort();
  var out = {};
  order.forEach(function(node) {
    var spec = specFor(node.type);
    if (!spec) { out[node.id] = makeTable([], []); return; }
    var ins = inputsOf(node.id).map(function(id){ return out[id]; }).filter(Boolean);
    // Multiple inputs merge, and a merge requires matching headers — so the
    // first input's header is the merged header wherever the graph is valid,
    // and where it is not, evaluateGraph() is what reports it.
    var inSchema = ins.length ? ins[0] : makeTable([], []);
    out[node.id] = headerOnly(spec.schema(node, inSchema));
  });
  return out;
}

// The header a node's config panel should describe: what arrives, not what
// leaves. An unconnected node falls back to the student schema so its panel is
// still meaningful before anything is wired up.
function inputSchema(node, schemas) {
  var ins = inputsOf(node.id).map(function(id){ return schemas[id]; }).filter(Boolean);
  if (ins.length) return ins[0];
  return makeTable(STUDENT_COLUMNS, []);
}

/* ============================================================================
   RENDER — CONFIG PANELS
   ============================================================================
   Controls carry data-node / data-key and are read by one delegated listener.
   Nothing here reads the DOM back: render() is a pure function of the model,
   which is what makes the drag fast path and save/load safe.                  */

function ctl(nodeId, key, extra) {
  return ' data-node="' + nodeId + '" data-key="' + esc(key) + '"' + (extra || '');
}
function opt(val, cur, label) {
  return '<option value="' + esc(val) + '"' + (String(cur) === String(val) ? ' selected' : '') + '>' +
    esc(label === undefined ? val : label) + '</option>';
}
function courseTitle(code) {
  var c = COURSE_BY_CODE[code];
  return c ? c.code + ' — ' + c.name : String(code);
}

// Grouped by subject so a 31-course catalogue stays navigable and a longer real
// one degrades gracefully instead of becoming a single flat list.
function courseSelect(nodeId, key, cur) {
  var sel = cur || DEFAULT_COURSE;
  var html = '<select class="course-sel" title="' + esc(courseTitle(sel)) + '"' + ctl(nodeId, key) + '>';
  SUBJECTS.forEach(function(subj) {
    var inSubj = COURSES.filter(function(c){ return c.subject === subj; });
    if (!inSubj.length) return;
    html += '<optgroup label="' + esc(subj) + '">';
    inSubj.forEach(function(c) {
      html += '<option value="' + c.code + '"' + (sel === c.code ? ' selected' : '') + '>' +
        esc(c.code + ' — ' + c.name) + '</option>';
    });
    html += '</optgroup>';
  });
  return html + '</select>';
}

function opSelect(nodeId, key, ops, cur) {
  return '<select' + ctl(nodeId, key) + '>' +
    ops.map(function(o){ return opt(o, cur, OP_SYM[o]); }).join('') +
  '</select>';
}

/* One criterion row. Its shape follows the field's type, and the field list
   follows the incoming table — so this function knows nothing about students. */
function criterionHTML(node, ci, c, schema) {
  var fields = filterFields(schema);
  if (!fields.length) {
    return '<div class="criterion-row"><div class="cmp-hint">No columns upstream — connect a Source.</div></div>';
  }
  var cur = fieldByKey(schema, c.field) || fields[0];
  var nid = node.id;
  var remove = ci > 0
    ? '<button class="remove-criterion-btn" onclick="removeCriterion(' + nid + ',' + ci + ')">x</button>'
    : '';

  var plain = fields.filter(function(f){ return f.key.indexOf('courses.') !== 0; });
  var crs   = fields.filter(function(f){ return f.key.indexOf('courses.') === 0; });
  var fieldSel = '<select class="ft-sel"' + ctl(nid, 'crit.' + ci + '.field') + '>' +
    (plain.length ? '<optgroup label="Row">' + plain.map(function(f){ return opt(f.key, cur.key, f.label); }).join('') + '</optgroup>' : '') +
    (crs.length   ? '<optgroup label="Courses">' + crs.map(function(f){ return opt(f.key, cur.key, f.label); }).join('') + '</optgroup>' : '') +
  '</select>';

  var vKey = 'crit.' + ci + '.value:' + cur.key;
  var oKey = 'crit.' + ci + '.op:' + cur.key;
  var body;

  if (cur.kind === 'courseSubject') {
    body = '<div class="criterion-controls two-col">' + fieldSel +
      '<select' + ctl(nid, vKey) + '>' +
        SUBJECTS.map(function(s){ return opt(s, critValue(c, cur.key, null) || SUBJECTS[0]); }).join('') +
      '</select></div>';

  } else if (cur.kind === 'courseCode') {
    body = '<div class="criterion-controls stack">' + fieldSel +
      courseSelect(nid, vKey, critValue(c, cur.key, null) || DEFAULT_COURSE) + '</div>';

  } else if (cur.kind === 'courseMark') {
    body = '<div class="criterion-controls stack">' + fieldSel +
      courseSelect(nid, 'crit.' + ci + '.course', c.course) +
      '<div class="cc-pair">' +
        opSelect(nid, oKey, NUM_OPS, critOp(c, cur.key, 'gte')) +
        '<input type="number" min="0" max="100" value="' + esc(critValue(c, cur.key, { def:'70' })) + '"' +
          ctl(nid, vKey) + '></div></div>';

  } else if (cur.kind === COLTYPE.NUMBER) {
    body = '<div class="criterion-controls">' + fieldSel +
      opSelect(nid, oKey, NUM_OPS, critOp(c, cur.key, 'gt')) +
      '<input type="number" value="' + esc(critValue(c, cur.key, cur.column)) + '"' + ctl(nid, vKey) + '>' +
    '</div>';

  } else if (cur.kind === COLTYPE.ENUM) {
    var vals = (cur.column && cur.column.values) || [];
    // Enum criteria carry an operator too. Without one, "specialisation is NOT
    // Data Science" is unaskable — the engine has always supported it, but
    // there was no control to reach it with.
    var enumOp = opSelect(nid, oKey, ENUM_OPS, critOp(c, cur.key, 'eq'));
    var valSel = '<select' + ctl(nid, vKey) + '>' +
      vals.map(function(v){ return opt(v, critValue(c, cur.key, cur.column)); }).join('') + '</select>';
    // Long option text (specialisations, course names) will not survive the
    // 80px field column, so those wrap onto their own row.
    var wide = vals.some(function(v){ return String(v).length > 8; });
    body = wide
      ? '<div class="criterion-controls stack">' + fieldSel +
          '<div class="cc-pair">' + enumOp + valSel + '</div></div>'
      : '<div class="criterion-controls">' + fieldSel + enumOp + valSel + '</div>';

  } else {
    body = '<div class="criterion-controls">' + fieldSel +
      opSelect(nid, oKey, ENUM_OPS, critOp(c, cur.key, 'eq')) +
      '<input type="text" value="' + esc(critValue(c, cur.key, cur.column)) + '"' + ctl(nid, vKey) + '>' +
    '</div>';
  }

  return '<div class="criterion-row">' + body + remove + '</div>';
}

/* A short name for an upstream node, for panels that must let the user point at
   one input rather than another. Compare labels its branches from the query
   that produced them, which needs results; this is needed at render time,
   before anything has run, so it names the node instead. */
var NODE_LABELS = {
  source:'Source', filter:'Filter', sort:'Sort', take:'Take',
  aggregate:'Aggregate', aggregateColumns:'Agg. Columns',
  combine:'Combine', compare:'Compare', output:'Output'
};
function upstreamLabel(node) {
  return (NODE_LABELS[node.type] || node.type) + ' #' + node.id;
}

function configHTML(node, schemas) {
  var id = node.id;
  var cfg = node.cfg = node.cfg || defaultCfg(node.type);
  var schema = inputSchema(node, schemas);
  var html = '<div class="node-config">';

  if (node.type === 'source') {
    html += '<div class="cfg-label">Population</div>' +
      '<select' + ctl(id, 'pop') + '>' +
        opt('all', cfg.pop, 'All students') +
        YEARS.map(function(y){ return opt(String(y), cfg.pop, y + ' only'); }).join('') +
      '</select>' +
      // Granularity is a Source setting rather than a separate node: "how many
      // students" and "how many enrolments" are different questions, and every
      // downstream panel adapts through the schema.
      '<div class="cfg-label">Rows</div>' +
      '<select' + ctl(id, 'rows') + '>' +
        opt('students', cfg.rows, 'One per student') +
        opt('enrolments', cfg.rows, 'One per enrolment') +
      '</select>';
  }

  if (node.type === 'filter') {
    html += '<div class="criteria-list">' +
      cfg.criteria.map(function(c, ci){ return criterionHTML(node, ci, c, schema); }).join('') +
    '</div>' +
    '<button class="add-criterion-btn" onclick="addCriterion(' + id + ')">+ add condition</button>';
  }

  if (node.type === 'compare') {
    var inIds = inputsOf(id);
    var labels = cfg.labels || {};
    html += '<div class="cfg-label">Branches (' + inIds.length + ')</div>';
    if (inIds.length === 0) {
      html += '<div class="cmp-hint">Drag a Source or Filter next to this node to add a branch.</div>';
    } else {
      if (inIds.length === 1) {
        html += '<div class="cmp-hint">One branch connected — add another to compare against.</div>';
      }
      html += '<div class="cmp-branches">';
      inIds.forEach(function(inId, i) {
        var up = findNode(inId);
        html += '<div class="cmp-branch">' +
          '<span class="cmp-swatch" style="background:' + (up ? getNodeEdgeColor(up) : '#555') + '"></span>' +
          '<input type="text" class="cmp-label-input" placeholder="Branch ' + (i + 1) + ' (auto)" ' +
            'value="' + esc(labels[inId] || '') + '"' + ctl(id, 'label:' + inId) + '>' +
        '</div>';
      });
      html += '</div>';
    }

    var picked = measuresOf(node);
    html += '<div class="cfg-label">Columns</div><div class="cmp-measures">' +
      MEASURES.map(function(m) {
        return '<label class="cmp-measure">' +
          '<input type="checkbox"' + (picked.indexOf(m.key) !== -1 ? ' checked' : '') +
            ctl(id, 'measure:' + m.key) + '>' +
          '<span>' + esc(m.label) + '</span></label>';
      }).join('') +
    '</div>' +
    '<div class="cfg-label">Order</div>' +
    '<select' + ctl(id, 'sort') + '>' +
      opt('wired', cfg.sort, 'As connected') +
      opt('desc',  cfg.sort, 'Highest first') +
      opt('asc',   cfg.sort, 'Lowest first') +
      opt('label', cfg.sort, 'Label A–Z') +
    '</select>' +
    '<div class="cmp-hint">Highest and lowest use the first ticked column.</div>';
  }

  if (node.type === 'sort') {
    var scols = sortableCols(schema);
    if (!scols.length) {
      html += '<div class="cmp-hint">No sortable columns upstream — connect a Source.</div>';
    } else {
      var skeys = cfg.keys && cfg.keys.length ? cfg.keys : [newSortKey()];
      html += '<div class="cfg-label">Sort by</div><div class="sort-list">' +
        skeys.map(function(k, si) {
          // A saved key can outlive its column — rewiring a Source from students
          // to enrolments is enough. Show the fallback the engine will actually
          // use, rather than a select silently displaying option one while the
          // model still says something else.
          var kc = k.col ? colByKey(schema, k.col) : null;
          var chosen = (kc && kc.type !== COLTYPE.COURSES) ? k.col : scols[0].key;
          var scol = colByKey(schema, chosen);
          var sdir = k.dir === 'desc' ? 'desc' : 'asc';
          return '<div class="sort-row">' +
            '<span class="sort-rank">' + (si + 1) + '</span>' +
            '<select class="sort-col"' + ctl(id, 'sort.' + si + '.col') + '>' +
              scols.map(function(c){ return opt(c.key, chosen, c.label); }).join('') +
            '</select>' +
            '<select class="sort-dir"' + ctl(id, 'sort.' + si + '.dir') + '>' +
              SORT_DIRS.map(function(d){ return opt(d, sdir, dirLabel(scol, d)); }).join('') +
            '</select>' +
            (si > 0
              ? '<button class="remove-criterion-btn" onclick="removeSortKey(' + id + ',' + si + ')">x</button>'
              : '<span class="sort-nodel"></span>') +
          '</div>';
        }).join('') +
      '</div>';
      // Offering more keys than there are columns invites a sort key that can
      // never break a tie the earlier ones did not already settle.
      if (skeys.length < scols.length) {
        html += '<button class="add-criterion-btn sort-add" onclick="addSortKey(' + id + ')">+ add tie-breaker</button>';
      }
      if (skeys.length > 1) {
        html += '<div class="cmp-hint">Row 1 decides; the rest break its ties.</div>';
      }
    }
  }

  if (node.type === 'take') {
    // Bound to cfg.n verbatim, so a partially typed value is preserved between
    // renders. The engine's fallback is what protects the Run, not the control.
    html += '<div class="cfg-label">Keep first</div>' +
      '<input type="number" min="' + TAKE_MIN + '" step="1" ' +
        'value="' + esc(cfg.n === undefined ? '' : cfg.n) + '"' + ctl(id, 'n') + '>' +
      '<div class="cmp-hint">Rows are kept in the order they arrive. ' +
        'This node does not rank — put the ordering upstream if you want a top ' +
        takeCount(node) + '.</div>';
  }

  if (node.type === 'aggregate' || node.type === 'aggregateColumns') {
    var isCols = node.type === 'aggregateColumns';
    var op = aggOp(node);

    html += '<div class="cfg-label">Measure</div>' +
      '<select' + ctl(id, 'op') + '>' +
        AGG_OPS.map(function(o){ return opt(o.key, op.key, o.label); }).join('') +
      '</select>';

    if (!isCols && op.needsCol) {
      // Only the whole-table Aggregate picks a column: AggregateColumns applies
      // the measure to every column at once, which is the point of it.
      var mcols = measurableCols(schema);
      var chosen = aggregateCol(node, schema);
      html += '<div class="cfg-label">Of column</div>' +
        (mcols.length
          ? '<select' + ctl(id, 'col') + '>' +
              mcols.map(function(c){ return opt(c.key, chosen ? chosen.key : '', c.label); }).join('') +
            '</select>'
          : '<div class="cmp-hint">No numeric column upstream — the result will be blank.</div>');
    }

    // Say what will come out, in the same words the result will use. The shape
    // of an aggregation is the thing people get wrong about it, and stating it
    // before the query runs is cheaper than explaining it afterwards.
    if (isCols) {
      var ncols = schema.columns.length;
      html += '<div class="cmp-hint">One row out, ' +
        (ncols ? ncols + ' column' + (ncols === 1 ? '' : 's') : 'one column per column in') +
        ' — same headers, ' + esc(op.label.toLowerCase()) + ' down each.' +
        (op.key === 'count' ? '' : ' Non-numeric columns come out blank.') +
        '</div>';
    } else {
      html += '<div class="cmp-hint">One row, one column: ' +
        esc(aggregateColumn(node, schema).label) + '.</div>';
    }
  }

  if (node.type === 'combine') {
    var cinIds = inputsOf(id);
    var cmode = combineMode(node);

    html += '<div class="cfg-label">Inputs (' + cinIds.length + ')</div>';
    if (cinIds.length === 0) {
      html += '<div class="cmp-hint">Wire two branches into this node to stack them.</div>';
    } else if (cinIds.length === 1) {
      html += '<div class="cmp-hint">One input — passed straight through. Add another to combine.</div>';
    }

    html += '<div class="cfg-label">Mode</div>' +
      '<select' + ctl(id, 'mode') + '>' +
        COMBINE_MODES.map(function(m){ return opt(m.key, cmode.key, m.label); }).join('') +
      '</select>';

    if (cmode.key === 'merge') {
      html += '<label class="cmb-check"><input type="checkbox"' +
          (cfg.dedupe ? ' checked' : '') + ctl(id, 'dedupe') + '>' +
        '<span>Drop duplicate rows</span></label>' +
        '<div class="cmp-hint">Off: every row from every input is kept, so two ' +
        'identical result rows stay two rows. On: this is a set union.</div>';
    } else {
      // Difference is not symmetric, so the base has to be named rather than
      // inferred from the order the wires happened to be drawn.
      var baseId = combineBaseId(node, cinIds);
      if (cinIds.length > 1) {
        html += '<div class="cfg-label">Base</div>' +
          '<select' + ctl(id, 'base') + '>' +
            cinIds.map(function(inId) {
              var up = findNode(inId);
              return opt(String(inId), String(baseId), up ? (upstreamLabel(up)) : ('Input ' + inId));
            }).join('') +
          '</select>';
      }
      var kcols = combineKeyCols(schema);
      var kcur = combineKeyCol(node, schema);
      html += '<div class="cfg-label">Match rows on</div>' +
        (kcols.length
          ? '<select' + ctl(id, 'key') + '>' +
              kcols.map(function(c){ return opt(c.key, kcur ? kcur.key : '', c.label); }).join('') +
            '</select>'
          : '<div class="cmp-hint">No column upstream to match on.</div>');
      html += '<div class="cmp-hint">' +
        (cmode.key === 'intersect'
          ? 'Keeps base rows whose value also appears in every other input.'
          : 'Keeps base rows whose value appears in none of the other inputs.') +
        '</div>';
    }
  }

  if (node.type === 'output') {
    var show = normaliseShow(node);
    cfg.show = show;

    html += '<div class="cfg-label">Show</div><select' + ctl(id, 'show') + '>';
    if (compareFeedsOutput(node)) {
      html += opt('summary', show, 'Summary table') +
              opt('lists',   show, 'Summary + row lists') +
              opt('courses', show, 'Summary + course breakdown');
    } else {
      html += opt('rows',    show, 'All rows') +
              opt('count',   show, 'Count') +
              opt('average', show, 'Average') +
              opt('courses', show, 'Course breakdown');
    }
    html += '</select>';

    if (show === 'courses' && explodesHere(schema)) {
      html += '<div class="cmp-hint">Counts every enrolment of the students that arrive, ' +
        'including courses outside a row filter. Set Rows to “One per enrolment” on the ' +
        'Source to narrow it.</div>';
    }

    // Average is no longer hardwired to gradeAvg — the column list comes from
    // whatever is arriving, so it works on an enrolment stream too.
    if (show === 'average') {
      var nums = numericCols(schema).filter(function(c) {
        return c.key !== 'id' && c.key !== 'studentId';
      });
      var cur = cfg.avgCol || defaultAvgCol(schema);
      html += '<div class="cfg-label">Average of</div>' +
        (nums.length
          ? '<select' + ctl(id, 'avgCol') + '>' +
              nums.map(function(c){ return opt(c.key, cur, c.label); }).join('') + '</select>'
          : '<div class="cmp-hint">No numeric column upstream.</div>');
    }

    // The file name deliberately lives with the Copy/Save buttons in the results
    // panel rather than here. It describes the exported file, not the query, and
    // putting it on the node implied it was part of what gets computed.
  }

  return html + '</div>';
}

function shapeHTML(node) {
  var removeBtn = '<button class="node-remove" onclick="removeNode(' + node.id + ')">x</button>';
  if (node.type === 'source') return '<div class="node-shape shape-source">' + removeBtn + 'Source</div>';
  if (node.type === 'filter') return '<div class="node-shape shape-filter">' + removeBtn + 'Filter</div>';
  if (node.type === 'compare') {
    var glyph = '<span class="cmp-glyph"><i style="width:26px"></i><i style="width:16px"></i><i style="width:21px"></i></span>';
    return '<div class="node-shape shape-compare">' + removeBtn + glyph + 'Compare</div>';
  }
  if (node.type === 'sort') {
    // Bars of increasing length: the glyph says "ordered", and reads as
    // distinct from Take's equal-length bars with a cut through them.
    var sbars = '<span class="sort-glyph"><i style="width:9px"></i>' +
      '<i style="width:16px"></i><i style="width:23px"></i></span>';
    return '<div class="node-shape shape-sort">' + removeBtn + sbars + 'Sort</div>';
  }
  if (node.type === 'take') {
    // Three kept bars above the cut, one dropped below it — the glyph says
    // "first few, rest discarded" without repeating the word on the label.
    var bars = '<span class="take-glyph">' +
      '<i></i><i></i><i></i><b></b><i class="cut"></i></span>';
    return '<div class="node-shape shape-take">' + removeBtn + bars + 'Take</div>';
  }
  if (node.type === 'aggregate') {
    // Rows funnelling into a single dot: many values, one value out.
    var ag = '<span class="agg-glyph"><i></i><i></i><i></i><b></b></span>';
    return '<div class="node-shape shape-aggregate">' + removeBtn + ag + 'Aggregate</div>';
  }
  if (node.type === 'aggregateColumns') {
    // The same funnel turned ninety degrees: three columns, each collapsing to
    // its own value, so the pair read as variants of one idea rather than two
    // unrelated nodes.
    var agc = '<span class="aggc-glyph">' +
      '<span class="aggc-col"><i></i><i></i><b></b></span>' +
      '<span class="aggc-col"><i></i><i></i><b></b></span>' +
      '<span class="aggc-col"><i></i><i></i><b></b></span></span>';
    return '<div class="node-shape shape-aggcols">' + removeBtn + agc + 'Agg. Columns</div>';
  }
  if (node.type === 'combine') {
    // Two streams converging into one: the mirror image of Compare's glyph,
    // which holds branches apart rather than joining them.
    var cg = '<span class="cmb-glyph">' +
      '<span class="cmb-in"><i></i><i></i></span>' +
      '<b></b>' +
      '<span class="cmb-out"><i></i></span></span>';
    return '<div class="node-shape shape-combine">' + removeBtn + cg + 'Combine</div>';
  }
  if (node.type === 'output') return '<div class="node-shape shape-output">' + removeBtn + 'Output</div>';
  return '';
}

function render() {
  var vp = document.getElementById('viewport');
  var old = vp.querySelectorAll('.node');
  for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
  nodeEls = {};
  document.getElementById('hint').style.display = nodes.length === 0 ? 'block' : 'none';

  // A node deleted while selected must not leave its id behind, or the count in
  // the selection bar drifts away from what is actually ringed on screen.
  selection = selection.filter(function(id){ return findNode(id); });

  var schemas = computeSchemas();

  nodes.forEach(function(node) {
    var el = document.createElement('div');
    el.className = 'node' + (isSelected(node.id) ? ' selected' : '');
    el.style.left = node.x + 'px';
    el.style.top  = node.y + 'px';
    el.innerHTML = shapeHTML(node) + configHTML(node, schemas);
    vp.appendChild(el);
    nodeEls[node.id] = el;

    var shape = el.querySelector('.node-shape');
    if (shape) {
      shape.addEventListener('mousedown', function(e){ startDrag(e, node.id); });
      // Double-click selects the whole connected branch. The cheapest route to
      // "delete this entire arm of the query" without dragging a box around it,
      // which is awkward when branches interleave on screen.
      shape.addEventListener('dblclick', function(e) {
        e.preventDefault(); e.stopPropagation();
        selectBranch(node.id);
      });
    }
  });

  syncSelectionUI();
  drawArrows();
}

/* Delegated config listener — one handler for every control on the canvas.
   Registered once at start-up rather than per element per render, so a rebuild
   cannot leave stale listeners behind.

   Selects and checkboxes re-render (the panel's shape may depend on them);
   text and number inputs do not, because rebuilding the DOM mid-keystroke
   destroys the element being typed into. */
function onConfigInput(e) {
  var el = e.target;
  if (!el || !el.getAttribute) return;
  var nid = el.getAttribute('data-node');
  var key = el.getAttribute('data-key');
  if (!nid || !key) return;

  var value = el.type === 'checkbox' ? el.checked : el.value;
  setCfg(parseInt(nid, 10), key, value);
  markStale();

  var reshapes = el.tagName === 'SELECT' || el.type === 'checkbox';
  if (reshapes && e.type === 'change') {
    render();
    // render() replaces the element that was just used, so the control loses
    // focus mid-interaction. Put it back on its replacement.
    var again = document.querySelector('[data-node="' + nid + '"][data-key="' + key.replace(/"/g, '\\"') + '"]');
    // A control can also disappear rather than be replaced — one select's value
    // decides which others the panel offers. Falling back to the same node's
    // panel keeps focus with the user's work instead of dropping it on <body>,
    // where the next Backspace would be read as a canvas shortcut.
    if (!again) again = document.querySelector('[data-node="' + nid + '"]');
    if (again && again.focus) again.focus();
  }
}

/* ARROWS */
function getNodeEdgeColor(node) {
  var incoming = connections.filter(function(c){ return c.to === node.id; });
  if (incoming.length) return incoming[0].color;
  return node.color || EDGE_PALETTE[0];
}

function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

function drawArrow(parent, p0, tip, color, opacity, isGhost) {
  var ah = 14;
  var pathEndX = tip.x - ah, pathEndY = tip.y;
  var dx = Math.max(40, Math.abs(tip.x - p0.x) * 0.45);
  var p1x = p0.x + dx, p1y = p0.y;
  var p2x = pathEndX - Math.max(10, dx * 0.2), p2y = pathEndY;

  var pathEl = svgEl('path');
  pathEl.setAttribute('d', 'M ' + p0.x + ' ' + p0.y + ' C ' + p1x + ' ' + p1y + ' ' + p2x + ' ' + p2y + ' ' + pathEndX + ' ' + pathEndY);
  pathEl.setAttribute('stroke', color);
  pathEl.setAttribute('stroke-width', isGhost ? '1.5' : '2');
  pathEl.setAttribute('fill', 'none');
  pathEl.setAttribute('opacity', opacity);
  if (isGhost) pathEl.setAttribute('stroke-dasharray', '6 4');

  var ang = Math.atan2(tip.y - pathEndY, tip.x - pathEndX), spread = 0.42;
  var arrowEl = svgEl('polygon');
  arrowEl.setAttribute('points',
    tip.x + ',' + tip.y + ' ' +
    (tip.x - ah * Math.cos(ang - spread)) + ',' + (tip.y - ah * Math.sin(ang - spread)) + ' ' +
    (tip.x - ah * Math.cos(ang + spread)) + ',' + (tip.y - ah * Math.sin(ang + spread)));
  arrowEl.setAttribute('fill', color);
  arrowEl.setAttribute('opacity', isGhost ? opacity : Math.min(1, parseFloat(opacity) + 0.2));

  // Cubic bezier at t=0.5 -> (P0 + 3P1 + 3P2 + P3) / 8, used as a midpoint
  // fallback where getPointAtLength is unavailable.
  pathEl._mid = {
    x: (p0.x + 3 * p1x + 3 * p2x + pathEndX) / 8,
    y: (p0.y + 3 * p1y + 3 * p2y + pathEndY) / 8
  };

  parent.appendChild(pathEl);
  parent.appendChild(arrowEl);
  return pathEl;
}

/* DRAG
   onMove used to call render(), tearing down and rebuilding every node's DOM at
   pointer rate. Now it moves the existing elements and redraws only the arrows;
   panel contents cannot change during a drag, so there is nothing to rebuild.
   This was previously masked by the fact that config lived in the DOM — a full
   rebuild was needed to avoid losing it. With the model authoritative, it is
   not. */
var ghostTarget = null;

// Below this many screen pixels a press-and-release is a click, not a drag. It
// is measured in screen space on purpose: the gesture is about the user's hand,
// not about how much world the hand covered, and a world-space threshold would
// demand pixel-perfect stillness when zoomed out.
var CLICK_SLOP = 4;

function startDrag(e, nodeId) {
  var tag = e.target.tagName;
  if (tag === 'SELECT' || tag === 'INPUT' || tag === 'BUTTON' || tag === 'OPTION') return;
  if (e.button !== 0) return;          // middle-drag over a node is a pan, handled upstream
  if (spaceDown) return;               // ditto space-drag
  e.preventDefault();
  var node = findNode(nodeId);
  if (!node) return;

  /* Selection is resolved on mousedown rather than on click, because the answer
     decides what the drag about to happen will move. Three cases:
       additive click  — toggle this node, and if that deselected it, no drag
       unselected node — becomes the whole selection
       selected node   — selection is left alone, so a group can be dragged
                         without the press collapsing it to one node first    */
  if (e.shiftKey || e.metaKey || e.ctrlKey) {
    toggleSelected(nodeId);
    if (!isSelected(nodeId)) return;
  } else if (!isSelected(nodeId)) {
    selectOnly(nodeId);
  }

  var w = toWorld(e.clientX, e.clientY);
  var moving = isSelected(nodeId) && selection.length > 1
    ? selection.map(findNode).filter(Boolean)
    : [node];

  drag = {
    node: node,
    // Offsets captured once, in world space, so the grab point stays under the
    // cursor even if the zoom changes mid-drag.
    group: moving.map(function(n){ return { node:n, dx: w.x - n.x, dy: w.y - n.y }; }),
    startX: e.clientX, startY: e.clientY,
    moved: false
  };
  ghostTarget = null;
  cancelPreviewTimer(); hidePreview();
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function onMove(e) {
  if (!drag) return;
  if (!drag.moved &&
      (Math.abs(e.clientX - drag.startX) > CLICK_SLOP ||
       Math.abs(e.clientY - drag.startY) > CLICK_SLOP)) {
    drag.moved = true;
  }
  if (!drag.moved) return;

  var w = toWorld(e.clientX, e.clientY);
  drag.group.forEach(function(g) {
    var s = SHAPE[g.node.type];
    // Clamped to the world, not the viewport: the reachable area is a property
    // of the document, not of the window it happens to be shown in.
    g.node.x = Math.max(0, Math.min(WORLD_W - NODE_W, w.x - g.dx));
    g.node.y = Math.max(0, Math.min(WORLD_H - s.h,    w.y - g.dy));
    var el = nodeEls[g.node.id];
    if (el) { el.style.left = g.node.x + 'px'; el.style.top = g.node.y + 'px'; }
  });

  /* Snap-to-connect stays a single-node gesture. With several nodes moving there
     is no defensible answer to which one the ghost edge should come from, and
     guessing would wire up a connection the user never aimed at — the one kind
     of mistake that is tedious to undo, since it has to be found first. */
  ghostTarget = null;
  if (drag.group.length === 1) {
    var dn = drag.node, best = null, bestDist = SNAP_DIST;
    nodes.forEach(function(n) {
      if (n.id === dn.id) return;
      var dir = resolveDirection(dn, n);
      if (!dir) return;
      var dx = dir.tip.x - dir.p0.x, dy = dir.tip.y - dir.p0.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) { bestDist = dist; best = n; }
    });
    ghostTarget = best ? best.id : null;
  }

  drawArrows();
}

function onUp() {
  var wired = false;
  if (drag && drag.moved && ghostTarget !== null) {
    var gt = findNode(ghostTarget);
    var dir = gt ? resolveDirection(drag.node, gt) : null;
    if (dir) {
      var exists = connections.some(function(c) {
        return c.from === dir.from.id && c.to === dir.to.id;
      });
      if (!exists) {
        connections.push({ from: dir.from.id, to: dir.to.id, color: pickEdgeColor(dir.from) });
        markStale();
        wired = true;
      }
    }
  }
  var moved = drag && drag.moved;
  drag = null;
  ghostTarget = null;
  document.removeEventListener('mousemove', onMove);
  document.removeEventListener('mouseup', onUp);

  /* Only a wiring change can alter what a config panel offers, so only a wiring
     change earns a full rebuild. A plain move — and a plain click, which is now
     most mousedowns since clicking selects — redraws the arrows and stops there.
     Rebuilding on every click would drop focus from whatever control the user
     had open and re-run schema propagation for nothing. */
  if (wired) render();
  else if (moved) drawArrows();
}

// First outgoing edge inherits the upstream colour; later ones take a distinct
// palette colour so branches stay visually separable.
function pickEdgeColor(fromNode) {
  var outgoing = connections.filter(function(c){ return c.from === fromNode.id; });
  if (outgoing.length === 0) return getNodeEdgeColor(fromNode);
  var used = outgoing.map(function(c){ return c.color; });
  for (var i = 0; i < EDGE_PALETTE.length; i++) {
    if (used.indexOf(EDGE_PALETTE[i]) === -1) return EDGE_PALETTE[i];
  }
  return getNodeEdgeColor(fromNode);
}

/* CONNECTION REMOVAL */
function connKey(c) { return c.from + '->' + c.to; }

function removeConnection(from, to) {
  connections = connections.filter(function(c){ return !(c.from === from && c.to === to); });
  hoverConn = null;
  markStale();
  render();
}

function buildDeleteBadge(conn, pathEl) {
  var mid;
  try { mid = pathEl.getPointAtLength(pathEl.getTotalLength() / 2); }
  catch (err) { mid = pathEl._mid; }
  if (!mid) return null;

  var g = svgEl('g');
  g.setAttribute('class', 'conn-delete');
  /* Counter-scaled so the badge stays the same size on screen at any zoom. It
     lives in the scaled layer because it has to sit on the line, but a target
     that shrinks with the view would be at its least clickable exactly when
     there are most connections to tidy up. */
  g.setAttribute('transform',
    'translate(' + mid.x + ',' + mid.y + ') scale(' + (1 / view.z) + ')');

  var circle = svgEl('circle');
  circle.setAttribute('r', '9');
  g.appendChild(circle);

  var r = 3.6;
  [[-r,-r,r,r], [-r,r,r,-r]].forEach(function(p) {
    var line = svgEl('line');
    line.setAttribute('x1', p[0]); line.setAttribute('y1', p[1]);
    line.setAttribute('x2', p[2]); line.setAttribute('y2', p[3]);
    g.appendChild(line);
  });

  var title = svgEl('title');
  title.textContent = 'Remove this connection';
  g.appendChild(title);

  g.addEventListener('mousedown', function(e){ e.stopPropagation(); });
  g.addEventListener('click', function(e) {
    e.stopPropagation();
    removeConnection(conn.from, conn.to);
  });
  return g;
}

/* EDGE DATA PREVIEW
   After a deliberate dwell, show the first few rows travelling along a
   connection — the upstream node's emitted table, recomputed live so it is
   current even mid-edit. A plausibility aid: the "of N" total is the real
   signal, the rows are dataset-ordered texture rather than a sample. */
var PREVIEW_DELAY = 450;
var previewTimer = null;
var previewEl = null;

function cancelPreviewTimer() {
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
}
function armPreviewTimer(conn, pathEl) {
  cancelPreviewTimer();
  previewTimer = setTimeout(function() {
    previewTimer = null;
    showPreview(conn, pathEl);
  }, PREVIEW_DELAY);
}
function ensurePreviewEl() {
  if (previewEl) return previewEl;
  previewEl = document.createElement('div');
  previewEl.className = 'edge-preview';
  previewEl.style.display = 'none';
  document.getElementById('canvas').appendChild(previewEl);
  return previewEl;
}
function hidePreview() {
  if (previewEl) previewEl.style.display = 'none';
  previewAnchor = null;
}

// No saveState() call is needed any more: the model is already current, because
// every keystroke wrote straight into it.
function edgeData(conn) {
  var ev = evaluateGraph();
  if (ev.error) return { error: ev.error };
  var r = ev.res[conn.from];
  if (!r) return { error: 'unresolved' };
  if (!r.hasSource) return { incomplete: true };
  return { table: r.table };
}

// Preview columns are capped, not chosen: an enrolment table is ten columns
// wide and would overflow the floating panel.
var PREVIEW_COLS = 4;
var PREVIEW_ROWS = 5;

/* Which columns to show is a choice, not just a slice. Long free-text columns —
   a course title, a specialisation — consume the whole panel and tell you least
   about whether the right rows are flowing, so they yield to shorter ones. The
   count above the table is the real signal; these rows are texture. */
function previewColumns(t) {
  var wide = [], narrow = [];
  t.columns.forEach(function(c) {
    (c.type === COLTYPE.TEXT || c.key === 'specialisation' ? wide : narrow).push(c);
  });
  var picked = narrow.slice(0, PREVIEW_COLS);
  for (var i = 0; picked.length < PREVIEW_COLS && i < wide.length; i++) picked.push(wide[i]);
  // Keep the table's own left-to-right order rather than the order picked in
  return t.columns.filter(function(c){ return picked.indexOf(c) !== -1; });
}

function previewTableHTML(t) {
  var cols = previewColumns(t);
  var hidden = t.columns.length - cols.length;
  var moreHead = hidden > 0 ? '<th class="ep-more-col" title="' + hidden + ' more columns">…</th>' : '';
  var moreCell = hidden > 0 ? '<td class="ep-more-col">…</td>' : '';

  var head = cols.map(function(c) {
    return '<th title="' + esc(c.label) + '">' + esc(c.label) + '</th>';
  }).join('') + moreHead;

  var body = t.rows.slice(0, PREVIEW_ROWS).map(function(r) {
    return '<tr>' + cols.map(function(c) {
      var v = r[colIndex(t, c.key)];
      var shown = fmtCell(c, v);
      // Truncation is visual only, so the full value goes in the tooltip
      var ttl = cellTitle(c, v) || shown;
      return '<td title="' + esc(ttl) + '">' + esc(shown) + '</td>';
    }).join('') + moreCell + '</tr>';
  }).join('');

  return '<table class="ep-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
}

function showPreview(conn, pathEl) {
  var res = edgeData(conn);
  var el = ensurePreviewEl();
  var body;

  if (res.error) {
    body = '<div class="ep-note">Can\'t preview — ' +
      (res.error.indexOf('Circular') === 0 ? 'circular connection.' : 'graph unresolved.') + '</div>';
  } else if (res.incomplete) {
    body = '<div class="ep-note">No data on this edge yet — upstream isn\'t connected to a Source.</div>';
  } else {
    var t = res.table, n = t.rows.length;
    var count = '<div class="ep-count"><span class="ep-num">' + n + '</span> row' + (n === 1 ? '' : 's') + ' on this edge</div>';
    body = n === 0
      ? count + '<div class="ep-note">Empty table — nothing passes this point.</div>'
      : count + previewTableHTML(t) +
        '<div class="ep-foot">showing ' + Math.min(PREVIEW_ROWS, n) + ' of ' + n + ', in table order</div>';
  }
  el.innerHTML = body;
  previewAnchor = pathEl._mid || { x:0, y:0 };
  el.style.display = 'block';
  placePreview();
}

/* The preview is a sibling of the scaled layer, not a child of it, so its text
   stays at a readable size when the canvas is zoomed out — which is exactly when
   a row count is most useful and the nodes themselves are least readable. The
   cost is that its anchor arrives in world coordinates and has to be projected
   here. Kept as its own function so a zoom mid-hover can re-place the panel
   rather than leaving it stranded where the edge used to be. */
var previewAnchor = null;

function placePreview() {
  if (!previewEl || !previewAnchor || previewEl.style.display === 'none') return;
  var mid = toScreen(previewAnchor.x, previewAnchor.y);
  var cv = document.getElementById('canvas');
  var cw = cv.clientWidth, ch = cv.clientHeight;
  var pw = previewEl.offsetWidth, ph = previewEl.offsetHeight;
  var GAP = 26; // clears the ~9px badge radius plus breathing room

  var left = Math.max(6, Math.min(mid.x - pw / 2, cw - pw - 6));
  var top = mid.y - ph - GAP;
  previewEl.classList.remove('ep-below');
  if (top < 6) { top = mid.y + GAP; previewEl.classList.add('ep-below'); }
  // Flipping below can push it off the bottom on a short canvas; clamp last.
  top = Math.min(top, ch - ph - 6);
  previewEl.style.left = Math.round(left) + 'px';
  previewEl.style.top = Math.round(top) + 'px';
}

function repositionPreview() { placePreview(); }

/* True while any canvas gesture is in flight — dragging a node, sweeping a
   marquee, or panning.

   Connections carry two hover affordances: a delete badge and the data-preview
   panel. Both are helpful when the pointer is resting on a line and actively
   unhelpful while it is travelling across one. Sweeping a marquee used to light
   up every arrow it crossed and pop a preview over the box being drawn, which
   read as the selection picking up the arrows themselves. It never did — only
   node ids ever enter the selection — but the feedback said otherwise, and
   feedback is what the user has to go on. */
function gestureActive() { return !!(drag || marquee || panning); }

function drawArrows() {
  var svg = document.getElementById('svg');
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  cancelPreviewTimer(); // a rebuild invalidates the path a pending preview was armed on

  connections.forEach(function(conn) {
    var a = findNode(conn.from), b = findNode(conn.to);
    if (!a || !b) return;
    var p0 = shapeExit(a), tip = shapeEntry(b);

    var g = svgEl('g');
    svg.appendChild(g);
    var pathEl = drawArrow(g, p0, tip, conn.color, '0.9', false);

    if (gestureActive()) return; // no hover affordances mid-gesture

    // Invisible fat stroke so the 2px line is comfortably hoverable, extended to
    // the true tip so the arrowhead counts as part of the line.
    var hit = svgEl('path');
    hit.setAttribute('d', pathEl.getAttribute('d') + ' L ' + tip.x + ' ' + tip.y);
    hit.setAttribute('class', 'conn-hit');
    // Widened as the view shrinks, so the grab band stays ~20 screen px. The CSS
    // value is the 100% case; this overrides it per zoom level.
    hit.setAttribute('stroke-width', 20 / view.z);
    g.appendChild(hit);

    var badge = null, hovered = false;
    function setHover(on) {
      if (on === hovered) return;
      hovered = on;
      if (on) {
        badge = buildDeleteBadge(conn, pathEl);
        if (badge) g.appendChild(badge);
      } else if (badge && badge.parentNode) {
        badge.parentNode.removeChild(badge);
        badge = null;
      }
      hoverConn = on ? connKey(conn) : null;
    }

    // mousemove rather than mouseenter, so hover still engages when the SVG is
    // rebuilt beneath a stationary cursor
    hit.addEventListener('mousemove', function() {
      // Second line of defence. The hit strokes are not built at all while a
      // gesture is running, but one begun *before* the gesture started is still
      // in the DOM and would otherwise light up as the marquee swept past it.
      if (gestureActive()) return;
      setHover(true);
      armPreviewTimer(conn, pathEl);
    });
    g.addEventListener('mouseleave', function() {
      setHover(false);
      cancelPreviewTimer();
      hidePreview();
    });

    if (hoverConn === connKey(conn)) setHover(true);
  });

  if (drag && ghostTarget !== null) {
    var gt = findNode(ghostTarget);
    var dir = gt ? resolveDirection(drag.node, gt) : null;
    if (dir) drawArrow(svg, dir.p0, dir.tip, '#aaaaaa', '0.55', true);
  }
}

/* ============================================================================
   RESULTS PANEL — one renderer for every table
   ============================================================================
   Previously there were four: a count card, an average card, a student list, a
   course breakdown, plus a separate Compare path. They rendered the same kinds
   of thing in slightly different ways and had to be kept in step by hand. Every
   result is now a table, so there is one function.                            */

var DISPLAY_ROW_LIMIT = 50;

function tableHTML(t, title, badge) {
  if (t.columns.length === 0) {
    return card(title, '<div class="cmp-empty">Nothing to show — this Output has no columns.</div>', badge);
  }

  var head = t.columns.map(function(c) {
    return '<th' + (c.type === COLTYPE.NUMBER ? ' class="cmp-num"' : '') + '>' + esc(c.label) + '</th>';
  }).join('');

  var body = t.rows.slice(0, DISPLAY_ROW_LIMIT).map(function(r) {
    return '<tr>' + t.columns.map(function(c, i) {
      var ttl = cellTitle(c, r[i]);
      var cls = c.type === COLTYPE.NUMBER ? 'cmp-num'
              : c.type === COLTYPE.COURSES ? 'cmp-num crs-cell' : '';
      return '<td' + (cls ? ' class="' + cls + '"' : '') +
        (ttl ? ' title="' + esc(ttl) + '"' : '') + '>' + esc(fmtCell(c, r[i])) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  var more = t.rows.length > DISPLAY_ROW_LIMIT
    ? '<tr><td colspan="' + t.columns.length + '" class="cmp-more">... ' +
      (t.rows.length - DISPLAY_ROW_LIMIT) + ' more — Copy and Save include every row</td></tr>'
    : '';

  var empty = t.rows.length === 0
    ? '<div class="cmp-empty">No rows match this query.</div>' : '';

  return card(title,
    '<div style="overflow-x:auto"><table class="rtable">' +
      '<thead><tr>' + head + '</tr></thead><tbody>' + body + more + '</tbody></table></div>' + empty,
    badge);
}

function card(title, body, badge) {
  return '<div class="result-card">' +
    '<div class="result-head">' + esc(title) +
      (badge ? ' <span class="result-badge">' + esc(badge) + '</span>' : '') + '</div>' +
    body +
  '</div>';
}

// A 1x1 result still reads better as a headline number than as a one-cell
// table, so scalars keep the large display. It is the same table underneath —
// only the presentation differs, and the export path never sees this.
function scalarHTML(t) {
  var c = t.columns[0], r = t.rows[0] || [];
  // The mean of nothing is undefined, not zero. Printing "0" asserts something
  // false about the data; an em dash says there was nothing to average.
  var blank = c.key === 'average' && t.columns.length > 1 && Number(r[1]) === 0;
  var extra = t.columns.length > 1
    ? '<span class="big-sub">' + esc(t.columns[1].label + ': ' + fmtCell(t.columns[1], r[1])) + '</span>'
    : '';
  return '<div class="result-card">' +
    '<div class="result-head">' + esc(c.label) + '</div>' +
    '<div class="result-big"><span class="big-num">' + (blank ? '&mdash;' : esc(fmtCell(c, r[0]))) + '</span>' + extra + '</div>' +
  '</div>';
}

/* The note under a breakdown states what was aggregated and, when the rows were
   students, warns that the unfold widens the result past any row-level filter —
   with the concrete fix rather than just a caution. */
function breakdownNote(inTable, outTable) {
  var enrolments = outTable.rows.reduce(function(a, r){ return a + (Number(r[3]) || 0); }, 0);
  var n = inTable.rows.length;

  if (explodesHere(inTable)) {
    return '<div class="cmp-empty">' +
      'Every course taken by these ' + n + ' student' + (n === 1 ? '' : 's') +
      ' — ' + enrolments + ' enrolments across ' + outTable.rows.length + ' courses. ' +
      'A student-level filter keeps whole students, so courses outside it still appear here. ' +
      'To count only certain courses, set the Source to <b>One per enrolment</b> and filter there.' +
      '</div>';
  }
  return '<div class="cmp-empty">' + n + ' enrolment' + (n === 1 ? '' : 's') +
    ' across ' + outTable.rows.length + ' course' + (outTable.rows.length === 1 ? '' : 's') +
    '. Ordered by popularity.</div>';
}

function resultHTML(node, r) {
  var show = normaliseShow(node);
  var t = outputTable(node, r.table);
  var html;

  if (show === 'count' || show === 'average') {
    html = scalarHTML(t);
  } else if (show === 'summary' || show === 'lists' || show === 'courses') {
    var branches = (r.table.meta && r.table.meta.branches) || null;
    if (branches) {
      // Compare-fed: the summary first, then per-branch detail if asked for
      html = tableHTML(t, 'Comparison', branches.length + ' branches');
      if (show === 'lists') {
        html += branches.map(function(b) {
          return '<div class="cmp-branch-card">' +
            tableHTML(b.table, b.label, String(b.table.rows.length)) + '</div>';
        }).join('');
      } else if (show === 'courses') {
        html += branches.map(function(b) {
          var bt = breakdownTable(b.table);
          return '<div class="cmp-branch-card">' +
            tableHTML(bt, b.label, bt.rows.length + ' courses') +
            breakdownNote(b.table, bt) + '</div>';
        }).join('');
      }
    } else if (show === 'courses') {
      html = tableHTML(t, 'Course breakdown', t.rows.length + ' courses') +
             breakdownNote(r.table, t);
    } else {
      html = tableHTML(t, 'Rows', String(t.rows.length));
    }
  } else {
    html = tableHTML(t, 'Rows', String(t.rows.length));
  }
  return html;
}

function runQuery() {
  var srcNodes = nodes.filter(function(n){ return n.type === 'source'; });
  var outNodes = nodes.filter(function(n){ return n.type === 'output'; });

  if (srcNodes.length === 0) { showError('Add a Source node.'); return; }
  if (outNodes.length === 0) { showError('Add an Output node.'); return; }
  if (connections.length === 0) {
    showError('Drag nodes close together to connect them, then drop to confirm the connection.');
    return;
  }

  var ev = evaluateGraph();
  if (ev.error) { showError(ev.error); return; }

  exportData = {};
  var html = '';

  outNodes.forEach(function(onode, oi) {
    var r = ev.res[onode.id] || { table: makeTable([], []), log: [], hasSource: false };
    var body, actions = '';

    if (!r.hasSource) {
      body = '<div class="error-box">Not connected to a Source — this Output has no data path.</div>';
    } else {
      var show = normaliseShow(onode);
      var t = outputTable(onode, r.table);

      /* A course breakdown is not one operation. It unfolds each row into its
         enrolments, groups those by course and counts them — three steps the
         Output used to perform silently. Logging them is what makes the
         surprising case legible: filtering "Took subject = SWEN" keeps whole
         students, so the unfold brings their non-SWEN enrolments along too, and
         the breakdown lists every course rather than only SWEN ones. The log
         now shows exactly where that widening happened.
         (When SelectFor lands these become real nodes and this goes away.) */
      var log = r.log.slice();
      if (show === 'courses') {
        if (explodesHere(r.table)) log.push(logEntry('EXPLODE', [{s:'one row per enrolment'}]));
        log.push(logEntry('GROUP BY', [{s:'course'}]));
      }
      log.push(logEntry('OUTPUT', [{ c:'val', s:show }]));

      exportData[onode.id] = {
        index: oi + 1,
        show: show,
        name: exportNameOf(onode, oi + 1),
        table: t,
        source: r.table,          // pre-Output table, for the enrolments export
        log: log.map(logText)
      };

      body = '<div class="query-log">' + log.map(logHTML).join('\n') + '</div>' + resultHTML(onode, r);

      // Individual course marks survive only in the long enrolment format — a
      // student row carries codes and a breakdown carries averages. Offered
      // only where that raw detail exists to be exported.
      var canEnrol = canExplode(r.table);
      actions = '<div class="result-actions">' +
        exportNameHTML(onode, oi + 1) +
        '<button class="rbtn" onclick="copyOutput(' + onode.id + ',this)">Copy</button>' +
        '<button class="rbtn" onclick="saveOutput(' + onode.id + ',this)">Save</button>' +
        (canEnrol
          ? '<button class="rbtn" title="One row per student-course pair, with individual marks" ' +
            'onclick="saveEnrolments(' + onode.id + ',this)">Enrolments</button>'
          : '') +
      '</div>';
    }

    var showLabel = outNodes.length > 1;
    var head = (showLabel || actions)
      ? '<div class="result-block-head">' +
          (showLabel ? '<div class="result-block-label">Output ' + (oi + 1) + '</div>' : '<div></div>') +
          actions +
        '</div>'
      : '';
    html += '<div class="result-block">' + head + body + '</div>';
  });

  setOutput(html);
  resultsFresh = true;
}

/* EXPORT FILE NAME
   Sits next to Copy and Save because that is where it is used. The value is
   still stored on the node, so it travels with a saved query — the model owns
   it, only the control moved.

   Editing it must NOT mark the results stale. The name has no bearing on what
   was computed, and invalidating the run would leave the user unable to press
   the very Save button they were naming the file for. */
function defaultExportName(index) { return 'output' + index; }

function exportNameOf(node, index) {
  var v = node.cfg && node.cfg.filename;
  return (v && String(v).trim()) ? String(v).trim() : defaultExportName(index);
}

function exportNameHTML(node, index) {
  return '<label class="export-name" ' +
    'title="File name for Save. Leave blank to use the default.">' +
    '<input type="text" spellcheck="false" ' +
      'placeholder="' + esc(defaultExportName(index)) + '" ' +
      'value="' + esc((node.cfg && node.cfg.filename) || '') + '" ' +
      'data-export-name="' + node.id + '">' +
    '<span class="export-ext">.csv</span>' +
  '</label>';
}

/* Delegated on the results panel, which is rebuilt on every run — per-element
   listeners would be re-attached each time and leak. */
function onExportNameInput(e) {
  var el = e.target;
  if (!el || !el.getAttribute) return;
  var id = el.getAttribute('data-export-name');
  if (!id) return;
  var node = findNode(parseInt(id, 10));
  if (!node) return;
  node.cfg = node.cfg || defaultCfg(node.type);
  node.cfg.filename = el.value;
  var entry = exportData[node.id];
  if (entry) entry.name = exportNameOf(node, entry.index);
  // No markStale() here, by design — see the note above.
}

/* ============================================================================
   EXPORT — one serialiser, because there is one data shape
   ============================================================================ */

function markStale() {
  if (!resultsFresh) return;
  resultsFresh = false;
  var pb = document.getElementById('panelBody');
  if (!pb || !pb.querySelector('.result-block')) return;
  pb.classList.add('stale');
  if (!pb.querySelector('.stale-note')) {
    var note = document.createElement('div');
    note.className = 'stale-note';
    note.textContent = 'Graph changed since this run — re-run the query to export.';
    pb.insertBefore(note, pb.firstChild);
  }
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function timeStamp(fileSafe) {
  var d = new Date();
  var date = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  var time = pad2(d.getHours()) + (fileSafe ? '' : ':') + pad2(d.getMinutes());
  return date + (fileSafe ? '-' : ' ') + time;
}

function csvCell(v) {
  var s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// The whole export layer, for every result shape the tool can produce.
function serialiseTable(t, sep, quote) {
  var cell = quote ? csvCell : function(v){ return String(v); };
  return [t.columns.map(function(c){ return cell(c.label); }).join(sep)]
    .concat(t.rows.map(function(r) {
      return t.columns.map(function(c, i){ return cell(exportCell(c, r[i])); }).join(sep);
    }))
    .join('\n');
}

// Compare with per-branch detail exports long: one row per branch row, branch
// name prepended. That is the shape a pivot table wants.
function exportTableFor(e) {
  var branches = e.source && e.source.meta && e.source.meta.branches;
  if (!branches || e.show === 'summary') return e.table;

  var per = branches.map(function(b) {
    return { label: b.label, t: e.show === 'courses' ? breakdownTable(b.table) : b.table };
  }).filter(function(x){ return x.t.columns.length; });
  if (!per.length) return e.table;

  // Branches reach a Compare independently, so two of them can carry different
  // headers (one student stream, one enrolment stream). Stacking those would
  // emit rows whose cells do not line up with the header. Only branches
  // matching the first are included; the summary still counts all of them.
  var want = schemaKey(per[0].t);
  per = per.filter(function(x){ return schemaKey(x.t) === want; });

  var cols = [{ key:'branch', label:'Branch', type:COLTYPE.TEXT }].concat(per[0].t.columns);
  var rows = [];
  per.forEach(function(x) {
    x.t.rows.forEach(function(r){ rows.push([x.label].concat(r)); });
  });
  return makeTable(cols, rows);
}

/* Strip path separators and characters Windows rejects, collapse whitespace,
   then trim the separators back off the ends — otherwise a name made entirely
   of slashes sanitises to a lone "-" rather than falling back. */
function safeName(s) {
  var out = String(s).trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || 'output';
}

function flashBtn(btn, msg) {
  if (!btn) return;
  if (btn._orig === undefined) btn._orig = btn.textContent;
  btn.textContent = msg;
  btn.classList.add('rbtn-done');
  clearTimeout(btn._t);
  btn._t = setTimeout(function() {
    btn.textContent = btn._orig;
    btn.classList.remove('rbtn-done');
  }, 1500);
}

// execCommand fallback — navigator.clipboard needs a secure context, which is
// not guaranteed when the page is opened straight off the filesystem.
function legacyCopy(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (err) { return false; }
}

function writeClipboard(text, btn) {
  function done(ok) { flashBtn(btn, ok ? 'Copied ✓' : 'Copy failed'); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function(){ done(true); },
                                            function(){ done(legacyCopy(text)); });
  } else {
    done(legacyCopy(text));
  }
}

function downloadFile(name, content, mime) {
  try {
    var blob = new Blob([content], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    return true;
  } catch (err) { return false; }
}

// Shared guard: the payload must exist and still match the graph that made it
function exportEntry(id, btn) {
  var e = exportData[id];
  if (!e || !resultsFresh) { flashBtn(btn, 'Re-run first'); return null; }
  return e;
}

function copyOutput(id, btn) {
  var e = exportEntry(id, btn);
  if (e) writeClipboard(serialiseTable(exportTableFor(e), '\t', false), btn);
}

function saveOutput(id, btn) {
  var e = exportEntry(id, btn);
  if (!e) return;
  var name = safeName(e.name) + '-' + timeStamp(true) + '.csv';
  flashBtn(btn, downloadFile(name, serialiseTable(exportTableFor(e), ',', true), 'text/csv')
    ? 'Saved ✓' : 'Save failed');
}

function saveEnrolments(id, btn) {
  var e = exportEntry(id, btn);
  if (!e) return;
  var en = toEnrolments(e.source);
  if (!en) { flashBtn(btn, 'No courses'); return; }
  var name = safeName(e.name) + '-enrolments-' + timeStamp(true) + '.csv';
  flashBtn(btn, downloadFile(name, serialiseTable(en, ',', true), 'text/csv')
    ? 'Saved ✓' : 'Save failed');
}

function showError(msg) {
  exportData = {};
  resultsFresh = false;
  setOutput('<div class="error-box">' + esc(msg) + '</div>');
}
function setOutput(html) {
  var pb = document.getElementById('panelBody');
  pb.classList.remove('stale');
  pb.innerHTML = html;
}

/* ============================================================================
   SAVE / LOAD
   ============================================================================
   A query is an artefact you keep and re-run against next year's data, not
   something you rebuild each session. That is why this matters: the saved file
   describes the query, never the results, so loading it and pressing Run
   re-evaluates against whatever the dataset now contains.

   This was impossible before the config moved into the model. Scraping values
   out of the DOM meant an unrendered panel was indistinguishable from an unset
   one, so there was no complete picture of the graph to write down.           */

var FILE_VERSION = 1;
var FILE_KIND = 'student-data-analyser-query';

function serialiseGraph() {
  return {
    kind: FILE_KIND,
    version: FILE_VERSION,
    savedAt: new Date().toISOString(),
    // Positions are part of the query: a saved graph should open looking like
    // the one that was saved, not re-scattered at random.
    nodes: nodes.map(function(n) {
      return { id:n.id, type:n.type, x:n.x, y:n.y, color:n.color, cfg:n.cfg };
    }),
    connections: connections.map(function(c) {
      return { from:c.from, to:c.to, color:c.color };
    })
  };
}

function saveGraph(btn) {
  if (nodes.length === 0) { flashBtn(btn, 'Nothing to save'); return; }
  var json = JSON.stringify(serialiseGraph(), null, 2);
  var name = 'query-' + timeStamp(true) + '.json';
  flashBtn(btn, downloadFile(name, json, 'application/json') ? 'Saved ✓' : 'Save failed');
}

/* Validation is deliberately forgiving about detail and strict about structure.
   A file with an unknown node type or an edge to a node that no longer exists
   is repaired by dropping the offending part, because a query that loads with
   three of its four nodes is more useful than a refusal. A file that is not a
   query at all is rejected outright. */
function deserialiseGraph(raw) {
  var d;
  try { d = JSON.parse(raw); }
  catch (err) { return { error: 'That file isn\'t valid JSON.' }; }

  if (!d || d.kind !== FILE_KIND) {
    return { error: 'That doesn\'t look like a saved query from this tool.' };
  }
  if (typeof d.version !== 'number' || d.version > FILE_VERSION) {
    return { error: 'That query was saved by a newer version of this tool.' };
  }
  if (!Array.isArray(d.nodes) || !Array.isArray(d.connections)) {
    return { error: 'That query file is missing its nodes or connections.' };
  }

  var warnings = [];
  var seen = {};
  var loadedNodes = [];

  d.nodes.forEach(function(n) {
    if (!n || !CONNECT_RULES[n.type]) { warnings.push('unknown node type'); return; }
    var id = parseInt(n.id, 10);
    if (isNaN(id) || seen[id]) { warnings.push('duplicate node id'); return; }
    seen[id] = true;
    loadedNodes.push({
      id: id,
      type: n.type,
      x: Number(n.x) || 0,
      y: Number(n.y) || 0,
      color: n.color || EDGE_PALETTE[0],
      // Merge over the defaults so a file written before a config key existed
      // still loads, with the new key at its default rather than undefined.
      cfg: mergeCfg(defaultCfg(n.type), n.cfg)
    });
  });

  var loadedConns = [];
  d.connections.forEach(function(c) {
    if (!c) return;
    var from = parseInt(c.from, 10), to = parseInt(c.to, 10);
    var a = loadedNodes.filter(function(n){ return n.id === from; })[0];
    var b = loadedNodes.filter(function(n){ return n.id === to; })[0];
    if (!a || !b) { warnings.push('connection to a missing node'); return; }
    if (!canConnect(a.type, b.type)) { warnings.push('connection breaking the wiring rules'); return; }
    if (loadedConns.some(function(x){ return x.from === from && x.to === to; })) return;
    loadedConns.push({ from:from, to:to, color: c.color || EDGE_PALETTE[0] });
  });

  return { nodes: loadedNodes, connections: loadedConns, warnings: warnings };
}

// Shallow merge is enough: cfg is one level deep apart from criteria and labels,
// and both of those are replaced wholesale when present.
function mergeCfg(base, saved) {
  if (!saved || typeof saved !== 'object') return base;
  var wantsCriteria = Object.prototype.hasOwnProperty.call(base, 'criteria');
  Object.keys(saved).forEach(function(k) { base[k] = saved[k]; });

  // Scalar settings are read straight into HTML attributes and comparisons, so
  // a file supplying an object or array where a string belongs is coerced
  // rather than trusted.
  ['pop','rows','show','avgCol','filename','sort'].forEach(function(k) {
    if (base[k] !== undefined && typeof base[k] !== 'string') {
      base[k] = (base[k] === null || typeof base[k] === 'object') ? '' : String(base[k]);
    }
  });
  if (base.labels === null || typeof base.labels !== 'object' || Array.isArray(base.labels)) {
    if (Object.prototype.hasOwnProperty.call(base, 'labels')) base.labels = {};
  }
  if (Object.prototype.hasOwnProperty.call(base, 'measures') && !Array.isArray(base.measures)) {
    base.measures = DEFAULT_MEASURES.slice();
  }

  // Only filter nodes carry criteria — a file that attaches them to an Output
  // must not have them normalised into existence there.
  if (wantsCriteria) {
    base.criteria = (Array.isArray(base.criteria) ? base.criteria : []).map(function(c) {
      var n = newCriterion();
      if (c && typeof c === 'object') {
        if (c.field) n.field = c.field;
        if (c.course) n.course = c.course;
        if (c.values && typeof c.values === 'object') n.values = c.values;
        if (c.ops && typeof c.ops === 'object') n.ops = c.ops;
      }
      return n;
    });
    if (!base.criteria.length) base.criteria = [newCriterion()];
  }
  return base;
}

function applyGraph(g) {
  nodes = g.nodes;
  connections = g.connections;
  // Keep the counter clear of every id in the file, so a node added after a
  // load cannot collide with one that came from it.
  idCtr = nodes.reduce(function(m, n){ return Math.max(m, n.id); }, 0);
  edgeColorIndex = nodes.length;
  exportData = {};
  resultsFresh = false;
  selection = [];
  cancelPreviewTimer();
  hidePreview();
  render();
  /* Fit after loading rather than restoring a saved zoom. A file carries the
     graph, not the view — which is why the format did not have to change for
     any of this — and a query written on one screen should open framed for
     whatever screen opens it. render() has to run first: fitting measures node
     heights off the DOM, and those do not exist until the nodes do. */
  zoomToFit();
}

function loadGraphFromText(raw, btn) {
  var g = deserialiseGraph(raw);
  if (g.error) { showError(g.error); flashBtn(btn, 'Load failed'); return; }
  applyGraph(g);

  var msg = 'Loaded ' + g.nodes.length + ' node' + (g.nodes.length === 1 ? '' : 's') +
    ' and ' + g.connections.length + ' connection' + (g.connections.length === 1 ? '' : 's') + '.';
  if (g.warnings.length) {
    msg += ' Skipped ' + g.warnings.length + ' item' + (g.warnings.length === 1 ? '' : 's') +
      ' that no longer fit the graph: ' + g.warnings.filter(function(w, i, a){ return a.indexOf(w) === i; }).join(', ') + '.';
  }
  setOutput('<div class="placeholder">' + esc(msg) + ' Press Run Query to evaluate it.</div>');
  flashBtn(btn, 'Loaded ✓');
}

function openGraphFile(btn) {
  var input = document.getElementById('loadFile');
  if (!input) return;
  // Reset first, or choosing the same file twice in a row fires no change event
  input.value = '';
  input._btn = btn;
  input.click();
}

function onGraphFileChosen(e) {
  var input = e.target;
  var file = input.files && input.files[0];
  if (!file) return;
  var btn = input._btn;
  var reader = new FileReader();
  reader.onload = function(){ loadGraphFromText(String(reader.result), btn); };
  reader.onerror = function(){ showError('Could not read that file.'); flashBtn(btn, 'Load failed'); };
  reader.readAsText(file);
}

/* PROCESSING MENU
   One toolbar button per pipeline stage. Processing nodes are a growing family,
   so they live behind a single dropdown rather than adding a button each. */
function procMenuEl() { return document.getElementById('procMenu'); }
function closeProcMenu() {
  var m = procMenuEl();
  if (m) m.classList.remove('open');
}
function toggleProcMenu(e) {
  // Without this the document listener below sees the same click and closes the
  // menu in the tick it was opened.
  if (e) e.stopPropagation();
  var m = procMenuEl();
  if (m) m.classList.toggle('open');
}
function addProcNode(type) {
  closeProcMenu();
  addNode(type);
}

/* ============================================================================
   CANVAS GESTURES — MARQUEE SELECT AND PAN
   ============================================================================
   Both start with a press on empty canvas, so they are told apart by modifier
   rather than by target: plain drag selects, space or middle-button drags the
   view. That ordering is deliberate — selection is the frequent action and gets
   the unmodified gesture; panning is occasional and is mostly unnecessary at
   all once the graph has been zoomed to fit. */

var spaceDown = false;
var marquee = null;   // { x0,y0 world | sx0,sy0 screen | additive | base }
var panning = null;   // { sx, sy, x0, y0 }

/* A press only starts a canvas gesture if it landed on canvas and nothing else.
   Connection hit-strokes are SVG children with their own handlers, and node
   elements re-enable pointer events on their painted parts, so anything that is
   not one of these three elements belongs to something that wants the event. */
function isCanvasBackground(target) {
  if (!target) return false;
  return target.id === 'canvas' || target.id === 'viewport' ||
         target.id === 'svg'    || target.id === 'hint';
}

function marqueeEl() { return document.getElementById('marquee'); }

function startPan(e) {
  panning = { sx: e.clientX, sy: e.clientY, x0: view.x, y0: view.y };
  document.getElementById('canvas').classList.add('panning');
  cancelPreviewTimer(); hidePreview();
  endConnHover();
}

/* Drop any connection hover and rebuild the arrows without their hit strokes.
   Called as a gesture begins, so a badge left under the cursor from a moment ago
   does not stay lit for the duration of the drag. drawArrows() sees
   gestureActive() and skips the interactive parts entirely. */
function endConnHover() {
  hoverConn = null;
  cancelPreviewTimer();
  hidePreview();
  drawArrows();
}

function startMarquee(e) {
  var r = canvasBox();
  var w = toWorld(e.clientX, e.clientY);
  marquee = {
    x0: w.x, y0: w.y,
    sx0: e.clientX - r.left, sy0: e.clientY - r.top,
    // Additive drags extend what is already selected, so several scattered
    // clusters can be gathered up with repeated boxes instead of one huge box
    // that inevitably catches something in between.
    additive: e.shiftKey || e.metaKey || e.ctrlKey,
    base: selection.slice(),
    moved: false,
    /* Node geometry is measured once, here, rather than per mousemove. Heights
       come from offsetHeight, and reading that forces the browser to flush
       layout; doing it for every node on every pointer event is the kind of
       cost that only shows up on the large graphs this feature exists to
       manage. Nothing can move during a marquee, so one snapshot is sound. */
    boxes: nodes.map(function(n) {
      var r2 = nodeBox(n);
      return { id:n.id, x:r2.x, y:r2.y, w:r2.w, h:r2.h };
    })
  };
  document.getElementById('canvas').classList.add('selecting');
  cancelPreviewTimer(); hidePreview();
  endConnHover();
}

function onCanvasMouseDown(e) {
  /* Pan is a view gesture, not a graph one, so it is allowed to start anywhere —
     including on top of a node. startDrag() bows out for these same two cases,
     and the event then bubbles here. */
  if (e.button === 1 || (e.button === 0 && spaceDown)) { e.preventDefault(); startPan(e); return; }
  if (!isCanvasBackground(e.target)) return;
  if (e.button !== 0) return;
  e.preventDefault();
  startMarquee(e);
}

function onCanvasMouseMove(e) {
  if (panning) {
    view.x = panning.x0 + (e.clientX - panning.sx);
    view.y = panning.y0 + (e.clientY - panning.sy);
    clampPan();
    applyView();
    return;
  }
  if (!marquee) return;

  var r = canvasBox();
  var sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (!marquee.moved &&
      (Math.abs(sx - marquee.sx0) > CLICK_SLOP || Math.abs(sy - marquee.sy0) > CLICK_SLOP)) {
    marquee.moved = true;
  }
  if (!marquee.moved) return;

  var box = marqueeEl();
  if (box) {
    box.style.display = 'block';
    box.style.left   = Math.min(marquee.sx0, sx) + 'px';
    box.style.top    = Math.min(marquee.sy0, sy) + 'px';
    box.style.width  = Math.abs(sx - marquee.sx0) + 'px';
    box.style.height = Math.abs(sy - marquee.sy0) + 'px';
  }

  // Live selection while dragging: the ring appears as the box sweeps over a
  // node, so the user can correct the box before releasing rather than
  // discovering afterwards that it caught one node too many.
  var w = toWorld(e.clientX, e.clientY);
  var hit = nodesInWorldRect(marquee.x0, marquee.y0, w.x, w.y, marquee.boxes);
  setSelection(marquee.additive ? marquee.base.concat(hit) : hit);
}

/* Overlap, not containment: a box has to fully enclose a node to select it under
   containment rules, which is unusable here because node heights vary with their
   config panels and the tall ones are the hard ones to enclose. Touching is
   enough — the same rule the marquee in most node editors uses.

   `boxes` is the snapshot taken when the drag began. Omitting it measures live,
   which is what a caller outside a drag wants. */
function nodesInWorldRect(ax, ay, bx, by, boxes) {
  var x1 = Math.min(ax, bx), x2 = Math.max(ax, bx);
  var y1 = Math.min(ay, by), y2 = Math.max(ay, by);
  var src = boxes || nodes.map(function(n) {
    var r = nodeBox(n);
    return { id:n.id, x:r.x, y:r.y, w:r.w, h:r.h };
  });
  return src.filter(function(r) {
    return r.x < x2 && r.x + r.w > x1 && r.y < y2 && r.y + r.h > y1;
  }).map(function(r){ return r.id; });
}

function onCanvasMouseUp() {
  if (panning) {
    panning = null;
    document.getElementById('canvas').classList.remove('panning');
    drawArrows();   // gesture over: the hit strokes and badges come back
    return;
  }
  if (!marquee) return;
  var box = marqueeEl();
  if (box) box.style.display = 'none';
  document.getElementById('canvas').classList.remove('selecting');
  // A press on empty canvas that never became a drag is a click-away, and the
  // ordinary meaning of that is "deselect".
  if (!marquee.moved && !marquee.additive) clearSelection();
  marquee = null;
  drawArrows();
}

/* Wheel zooms about the pointer. There is nothing scrollable on the canvas, so
   the wheel has no competing meaning here, and claiming it makes zoom reachable
   without first finding the toolbar. deltaY is normalised across deltaMode —
   Firefox reports lines, not pixels — and then clamped, so one notch of a coarse
   mouse wheel and one flick of a trackpad land in the same range instead of the
   former jumping several steps at once. */
function onCanvasWheel(e) {
  e.preventDefault();
  var dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;        // lines -> px
  else if (e.deltaMode === 2) dy *= 400;  // pages -> px
  var factor = Math.exp(-dy * 0.0016);
  factor = Math.max(0.78, Math.min(1.28, factor));
  setZoom(view.z * factor, e.clientX, e.clientY);
}

/* A canvas gesture must survive the pointer leaving the canvas — releasing over
   the results panel mid-marquee should still complete the selection — so move
   and up are bound to the document, not to the canvas. */

/* WIRING */
var canvasEl = document.getElementById('canvas');
canvasEl.addEventListener('change', onConfigInput);
canvasEl.addEventListener('input', onConfigInput);
canvasEl.addEventListener('mousedown', onCanvasMouseDown);
canvasEl.addEventListener('wheel', onCanvasWheel, { passive: false });
document.addEventListener('mousemove', onCanvasMouseMove);
document.addEventListener('mouseup', onCanvasMouseUp);

// Panning and marquee use screen-space maths against the canvas box, and zoomed
// out far enough the world is centred rather than pinned — both need revisiting
// when the canvas changes size.
window.addEventListener('resize', function() { clampPan(); applyView(); });

var panelEl = document.getElementById('panelBody');
if (panelEl) panelEl.addEventListener('input', onExportNameInput);

var loadInput = document.getElementById('loadFile');
if (loadInput) loadInput.addEventListener('change', onGraphFileChosen);

document.addEventListener('click', closeProcMenu);

/* DESTRUCTIVE SHORTCUTS — THREE GUARDS
   ---------------------------------------------------------------------------
   Backspace deletes the selection, and there is no undo, so being wrong here
   costs the user work they cannot get back. It also cannot simply be dropped in
   favour of Delete: on a Mac keyboard the key labelled "delete" reports as
   Backspace, so removing it would leave those users with no shortcut at all.

   One guard is not enough, because the dangerous case is not "the user is typing
   in a field" — that is the easy case — but "the user believes they are typing
   in a field while the browser disagrees". render() rebuilds the whole canvas,
   and any control that triggered it is destroyed in the process; focus then
   falls back to <body>. The panel still looks active. The next Backspace is read
   as a canvas shortcut and deletes the node being configured.

     1. isTypingTarget  — the event landed on a control, or anywhere inside a
                          config or results panel.
     2. activeElement   — the same test against whatever actually holds focus,
                          which is not always the event target.
     3. keyboardContext — where the user last chose to work. Survives focus
                          being lost to <body>, which is the case the first two
                          cannot see.                                          */

function isTypingTarget(t) {
  if (!t || !t.tagName) return false;
  var tag = t.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable) return true;
  // Anything inside a panel counts, control or not: those are the only places
  // on screen where a keystroke could plausibly have been meant as text.
  return !!(t.closest && t.closest('.node-config, .output-panel'));
}

/* 'canvas' while the user is working on the graph, 'panel' while they are
   editing a node's configuration or the results panel. Recorded on mousedown in
   the capture phase, so it is still set for handlers that stop propagation —
   the connection delete badge does exactly that. */
var keyboardContext = 'canvas';

document.addEventListener('mousedown', function(e) {
  var t = e.target;
  if (!t || !t.closest) return;
  // The toolbar is deliberately not a panel: adding a node selects it, and
  // Backspace immediately afterwards to undo a mis-click is a reasonable thing
  // to want.
  keyboardContext = t.closest('.node-config, .output-panel') ? 'panel' : 'canvas';
}, true);

function safeToDelete(e) {
  return keyboardContext === 'canvas' &&
         !isTypingTarget(e.target) &&
         !isTypingTarget(document.activeElement);
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeProcMenu();
    clearSelection();
    return;
  }
  if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;

  var mod = e.ctrlKey || e.metaKey;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    // The selection bar's Delete button stays available either way, so a user
    // whose keystroke is suppressed here is never stuck.
    if (selection.length && safeToDelete(e)) { e.preventDefault(); deleteSelection(); }
    return;
  }
  if (mod && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAll(); return; }

  if (e.key === ' ' && !spaceDown) {
    spaceDown = true;
    document.getElementById('canvas').classList.add('pan-ready');
    e.preventDefault();  // stop the page treating space as "scroll" or "click the focused button"
    return;
  }

  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); return; }
  if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); return; }
  if (e.key === '0' && mod)           { e.preventDefault(); zoomReset(); return; }
  if (e.key === 'f' || e.key === 'F') { if (!mod) { e.preventDefault(); zoomToFit(); } return; }
});

document.addEventListener('keyup', function(e) {
  if (e.key === ' ') {
    spaceDown = false;
    document.getElementById('canvas').classList.remove('pan-ready');
  }
});

// Held space plus a window switch would otherwise leave the canvas stuck in
// pan-ready with no keyup ever arriving to clear it.
window.addEventListener('blur', function() {
  spaceDown = false;
  var cv = document.getElementById('canvas');
  if (cv) { cv.classList.remove('pan-ready'); cv.classList.remove('panning'); }
  panning = null;
  // A marquee abandoned by an alt-tab would otherwise leave its rectangle
  // painted on the canvas with no drag left to clear it.
  if (marquee) {
    var box = marqueeEl();
    if (box) box.style.display = 'none';
    marquee = null;
  }
  if (cv) cv.classList.remove('selecting');
  drawArrows();
});

/* GLOBALS — referenced by inline onclick handlers in the toolbar and panels */
window.addNode = addNode;
window.addProcNode = addProcNode;
window.toggleProcMenu = toggleProcMenu;
window.removeNode = removeNode;
window.addCriterion = addCriterion;
window.addSortKey = addSortKey;
window.removeSortKey = removeSortKey;
window.removeCriterion = removeCriterion;
window.clearAll = clearAll;
window.runQuery = runQuery;
window.copyOutput = copyOutput;
window.saveOutput = saveOutput;
window.saveEnrolments = saveEnrolments;
window.saveGraph = saveGraph;
window.openGraphFile = openGraphFile;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.zoomReset = zoomReset;
window.zoomToFit = zoomToFit;
window.deleteSelection = deleteSelection;
window.clearSelection = clearSelection;

/* TEST HOOK
   Set window.__QB_TEST__ = true *before* loading app.js to expose internals to
   the test suite. In normal use the flag is undefined and nothing is exported,
   so this costs one branch at start-up and leaks nothing.

   The alternative — having the tests reach in by rewriting the source text — is
   silently broken by any edit near the end of this file, and a test suite that
   fails for reasons unrelated to the code under test is worse than none. */
if (typeof window !== 'undefined' && window.__QB_TEST__) {
  window.__qb = {
    // live state
    nodes: function(){ return nodes; },
    connections: function(){ return connections; },
    exportData: function(){ return exportData; },
    isFresh: function(){ return resultsFresh; },
    findNode: findNode,
    setCfg: setCfg,
    render: render,
    // test convenience: wire two nodes without simulating a drag
    connect: function(a, b, color) { connections.push({ from:a, to:b, color: color || '#ffffff' }); },

    // data layer
    STUDENTS: STUDENTS, COURSES: COURSES, SUBJECTS: SUBJECTS, SPECS: SPECS, YEARS: YEARS,
    COURSE_BY_CODE: COURSE_BY_CODE, CORE_COURSES: CORE_COURSES, COURSES_PER_YEAR: COURSES_PER_YEAR,

    // table primitives
    COLTYPE: COLTYPE, makeTable: makeTable, colIndex: colIndex, colByKey: colByKey,
    hasCol: hasCol, cellAt: cellAt, headerOnly: headerOnly, numericCols: numericCols,
    coursesColIndex: coursesColIndex, studentsTable: studentsTable, enrolmentsTable: enrolmentsTable,
    toEnrolments: toEnrolments, canExplode: canExplode, explodesHere: explodesHere,
    breakdownTable: breakdownTable, fmtCell: fmtCell, exportCell: exportCell, schemaKey: schemaKey,

    // engine
    topoSort: topoSort, evaluateGraph: evaluateGraph, computeSchemas: computeSchemas,
    NODE_SPEC: NODE_SPEC, specFor: specFor, SHAPE: SHAPE, passthroughSchema: passthroughSchema,
    inputSchema: inputSchema, unionTables: unionTables, filterFields: filterFields,
    fieldByKey: fieldByKey, newCriterion: newCriterion, defaultCfg: defaultCfg,
    normaliseShow: normaliseShow, outputTable: outputTable, defaultAvgCol: defaultAvgCol,
    meanOf: meanOf, MEASURES: MEASURES,

    // sort
    applySort: applySort, sortableCols: sortableCols, comparatorFor: comparatorFor,
    sortRowComparator: sortRowComparator,
    resolveSortKeys: resolveSortKeys, newSortKey: newSortKey, dirLabel: dirLabel,
    ordinalsFor: ordinalsFor, GRADE_ORDER: GRADE_ORDER,

    // combine
    COMBINE_MODES: COMBINE_MODES, combineMode: combineMode, combineTables: combineTables,
    combineBaseId: combineBaseId, combineOrdered: combineOrdered, combineKeyCol: combineKeyCol, combineKeyCols: combineKeyCols,
    upstreamLabel: upstreamLabel,

    // aggregation
    AGG_OPS: AGG_OPS, aggOp: aggOp, reduceValues: reduceValues,
    measurableCols: measurableCols, isMeasurable: isMeasurable,
    aggregateCol: aggregateCol, aggregateColumn: aggregateColumn,
    aggregateSchema: aggregateSchema, applyAggregate: applyAggregate,
    aggregateColumnsSchema: aggregateColumnsSchema,
    applyAggregateColumns: applyAggregateColumns,
    columnValues: columnValues,

    // take
    applyTake: applyTake, takeCount: takeCount,
    TAKE_DEFAULT: TAKE_DEFAULT, TAKE_MIN: TAKE_MIN,
    canConnect: canConnect, CONNECT_RULES: CONNECT_RULES,

    // view: zoom, pan and world coordinates
    view: function(){ return view; },
    setZoom: setZoom, zoomToFit: zoomToFit, centreView: centreView, clampPan: clampPan, applyView: applyView,
    toWorld: toWorld, toScreen: toScreen, viewCentreWorld: viewCentreWorld,
    nodeBox: nodeBox, graphBounds: graphBounds, freeSpotNear: freeSpotNear,
    WORLD_W: WORLD_W, WORLD_H: WORLD_H, MIN_ZOOM: MIN_ZOOM, MAX_ZOOM: MAX_ZOOM,

    // selection
    selection: function(){ return selection; },
    setSelection: setSelection, selectOnly: selectOnly, clearSelection: clearSelection,
    selectAll: selectAll, toggleSelected: toggleSelected, isSelected: isSelected,
    deleteSelection: deleteSelection, selectBranch: selectBranch,
    connectedComponent: connectedComponent, nodesInWorldRect: nodesInWorldRect,

    // export + persistence
    serialiseTable: serialiseTable, exportTableFor: exportTableFor, safeName: safeName,
    serialiseGraph: serialiseGraph, deserialiseGraph: deserialiseGraph,
    applyGraph: applyGraph, loadGraphFromText: loadGraphFromText,
    FILE_KIND: FILE_KIND, FILE_VERSION: FILE_VERSION
  };
}

// The world layer needs its size and transform before the first paint, or the
// first frame shows an unsized viewport and the nodes jump when it settles.
applyView();
centreView();
render();
})();
