(function() {

/* PALETTE OF EDGE COLOURS (one per source/path) */
var EDGE_PALETTE = ['#ffffff','#30d87a','#4aaff0','#e060b0','#a0d040','#9080e0'];
var edgeColorIndex = 0;

/* TEST DATASET */
var SPECS = ["Software Engineering","Computer Science","Information Technology","Data Science","Cybersecurity","Artificial Intelligence"];
var G22 = [78,82,91,65,88,72,95,55,83,70,61,79,86,73,90,68,77,84,62,92,75,80,58,87,71,94,66,85,76,89,63,74,81,93,69,78,85,72,60,88];
var G23 = [82,85,78,70,91,76,88,60,86,74,65,83,89,77,92,71,80,87,66,95,78,84,62,90,75,97,70,88,80,93,67,78,84,96,73,82,88,76,63,91];

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
  { key:'letterGrade',    label:'Grade',          type:COLTYPE.TEXT },
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
  { key:'letterGrade',    label:'Grade',          type:COLTYPE.TEXT }
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
  output:  { w:106, h:66 }
};

var CONNECT_RULES = {
  source:  ['filter', 'compare', 'output'],
  filter:  ['filter', 'compare', 'output'],
  compare: ['output'],
  output:  []
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
function addNode(type) {
  var cv = document.getElementById('canvas');
  var x = 60 + Math.random() * Math.max(80, cv.clientWidth - 260);
  var y = 60 + Math.random() * Math.max(80, cv.clientHeight - 220);
  var color = EDGE_PALETTE[edgeColorIndex++ % EDGE_PALETTE.length];
  nodes.push({
    id: uid(), type: type,
    x: Math.round(x), y: Math.round(y),
    color: color,
    cfg: defaultCfg(type)
  });
  markStale();
  render();
}

function removeNode(id) {
  nodes = nodes.filter(function(n){ return n.id !== id; });
  connections = connections.filter(function(c){ return c.from !== id && c.to !== id; });
  markStale();
  render();
}

function clearAll() {
  nodes = []; connections = []; edgeColorIndex = 0;
  exportData = {}; resultsFresh = false;
  cancelPreviewTimer(); hidePreview();
  render();
  setOutput('<div class="placeholder">Run a query to see results</div>');
}

function addCriterion(nodeId) {
  var n = findNode(nodeId);
  if (!n || n.type !== 'filter') return;
  n.cfg.criteria.push(newCriterion());
  markStale();
  render();
}
function removeCriterion(nodeId, idx) {
  var n = findNode(nodeId);
  if (!n || n.type !== 'filter') return;
  n.cfg.criteria.splice(idx, 1);
  markStale();
  render();
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
    var log = [], table, hasSource;

    if (node.type === 'source') {
      table = sourceTable(node, log);
      hasSource = true;
    } else {
      var inIds = inputsOf(node.id);
      var ins = inIds.map(function(id){ return res[id]; }).filter(Boolean);
      ins.forEach(function(r){ log.push.apply(log, r.log); });

      if (node.type === 'compare') {
        // Compare is the one node that keeps its inputs apart rather than
        // merging them, so it reads the branch results directly.
        table = buildCompare(node, inIds, res, log);
        hasSource = ins.some(function(r){ return r.hasSource; });
      } else {
        if (ins.length > 1) log.push(logEntry('MERGE', [{s: ins.length + ' inputs'}]));
        var merged = unionTables(ins.map(function(r){ return r.table; }));
        if (merged.error) return { error: merged.error };
        table = merged;
        hasSource = ins.some(function(r){ return r.hasSource; });

        if (node.type === 'filter') {
          var out = applyFilter(node, table, log);
          if (out.error) return { error: out.error };
          table = out.table;
        }
      }
    }
    res[node.id] = { table: table, log: log, hasSource: hasSource };
  }
  return { res: res };
}

/* SCHEMA PROPAGATION
   The same walk as evaluateGraph but carrying only column headers, no rows. It
   is what lets a Filter's field list and an Output's average-column list be
   built from whatever is actually flowing into them. Cheap enough to run on
   every render because no row is ever touched. */
function computeSchemas() {
  var order = topoSort();
  var out = {};
  order.forEach(function(node) {
    var ins = inputsOf(node.id).map(function(id){ return out[id]; }).filter(Boolean);
    if (node.type === 'source') {
      var cfg = node.cfg || defaultCfg('source');
      out[node.id] = headerOnly(cfg.rows === 'enrolments'
        ? makeTable(ENROLMENT_COLUMNS, [])
        : makeTable(STUDENT_COLUMNS, []));
    } else if (node.type === 'compare') {
      out[node.id] = makeTable(compareColumns(measuresOf(node)), []);
    } else if (ins.length) {
      out[node.id] = ins[0];
    } else {
      out[node.id] = makeTable([], []);
    }
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
  if (node.type === 'source') return '<div class="shape-source">' + removeBtn + 'Source</div>';
  if (node.type === 'filter') return '<div class="shape-filter">' + removeBtn + 'Filter</div>';
  if (node.type === 'compare') {
    var glyph = '<span class="cmp-glyph"><i style="width:26px"></i><i style="width:16px"></i><i style="width:21px"></i></span>';
    return '<div class="shape-compare">' + removeBtn + glyph + 'Compare</div>';
  }
  if (node.type === 'output') return '<div class="shape-output">' + removeBtn + 'Output</div>';
  return '';
}

function render() {
  var cv = document.getElementById('canvas');
  var old = cv.querySelectorAll('.node');
  for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
  nodeEls = {};
  document.getElementById('hint').style.display = nodes.length === 0 ? 'block' : 'none';

  var schemas = computeSchemas();

  nodes.forEach(function(node) {
    var el = document.createElement('div');
    el.className = 'node';
    el.style.left = node.x + 'px';
    el.style.top  = node.y + 'px';
    el.innerHTML = shapeHTML(node) + configHTML(node, schemas);
    cv.appendChild(el);
    nodeEls[node.id] = el;

    var shape = el.querySelector('.shape-source, .shape-filter, .shape-compare, .shape-output');
    if (shape) {
      shape.addEventListener('mousedown', function(e){ startDrag(e, node.id); });
    }
  });

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

function startDrag(e, nodeId) {
  var tag = e.target.tagName;
  if (tag === 'SELECT' || tag === 'INPUT' || tag === 'BUTTON') return;
  e.preventDefault();
  var node = findNode(nodeId);
  if (!node) return;
  var rect = document.getElementById('canvas').getBoundingClientRect();
  drag = { node:node, ox: e.clientX - rect.left - node.x, oy: e.clientY - rect.top - node.y };
  ghostTarget = null;
  cancelPreviewTimer(); hidePreview();
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function onMove(e) {
  if (!drag) return;
  var rect = document.getElementById('canvas').getBoundingClientRect();
  var s = SHAPE[drag.node.type];
  drag.node.x = Math.max(0, Math.min(rect.width - NODE_W, e.clientX - rect.left - drag.ox));
  drag.node.y = Math.max(0, Math.min(rect.height - s.h, e.clientY - rect.top - drag.oy));

  // Closest node that could form a valid connection, measured port to port
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

  var el = nodeEls[dn.id];
  if (el) { el.style.left = dn.x + 'px'; el.style.top = dn.y + 'px'; }
  drawArrows();
}

function onUp() {
  if (drag && ghostTarget !== null) {
    var gt = findNode(ghostTarget);
    var dir = gt ? resolveDirection(drag.node, gt) : null;
    if (dir) {
      var exists = connections.some(function(c) {
        return c.from === dir.from.id && c.to === dir.to.id;
      });
      if (!exists) {
        connections.push({ from: dir.from.id, to: dir.to.id, color: pickEdgeColor(dir.from) });
        markStale();
      }
    }
  }
  drag = null;
  ghostTarget = null;
  document.removeEventListener('mousemove', onMove);
  document.removeEventListener('mouseup', onUp);
  render(); // panels can change once wiring changes — full rebuild is correct here
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
  g.setAttribute('transform', 'translate(' + mid.x + ',' + mid.y + ')');

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
function hidePreview() { if (previewEl) previewEl.style.display = 'none'; }

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

  var mid = pathEl._mid || { x:0, y:0 };
  el.style.display = 'block';

  var cw = document.getElementById('canvas').clientWidth;
  var pw = el.offsetWidth, ph = el.offsetHeight;
  var GAP = 26; // clears the ~9px badge radius plus breathing room

  var left = Math.max(6, Math.min(mid.x - pw / 2, cw - pw - 6));
  var top = mid.y - ph - GAP;
  el.classList.remove('ep-below');
  if (top < 6) { top = mid.y + GAP; el.classList.add('ep-below'); }
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(top) + 'px';
}

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

    if (drag) return; // no hover affordances mid-drag

    // Invisible fat stroke so the 2px line is comfortably hoverable, extended to
    // the true tip so the arrowhead counts as part of the line.
    var hit = svgEl('path');
    hit.setAttribute('d', pathEl.getAttribute('d') + ' L ' + tip.x + ' ' + tip.y);
    hit.setAttribute('class', 'conn-hit');
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
  cancelPreviewTimer();
  hidePreview();
  render();
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

/* WIRING */
var canvasEl = document.getElementById('canvas');
canvasEl.addEventListener('change', onConfigInput);
canvasEl.addEventListener('input', onConfigInput);

var panelEl = document.getElementById('panelBody');
if (panelEl) panelEl.addEventListener('input', onExportNameInput);

var loadInput = document.getElementById('loadFile');
if (loadInput) loadInput.addEventListener('change', onGraphFileChosen);

document.addEventListener('click', closeProcMenu);
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeProcMenu();
});

/* GLOBALS — referenced by inline onclick handlers in the toolbar and panels */
window.addNode = addNode;
window.addProcNode = addProcNode;
window.toggleProcMenu = toggleProcMenu;
window.removeNode = removeNode;
window.addCriterion = addCriterion;
window.removeCriterion = removeCriterion;
window.clearAll = clearAll;
window.runQuery = runQuery;
window.copyOutput = copyOutput;
window.saveOutput = saveOutput;
window.saveEnrolments = saveEnrolments;
window.saveGraph = saveGraph;
window.openGraphFile = openGraphFile;

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
    inputSchema: inputSchema, unionTables: unionTables, filterFields: filterFields,
    fieldByKey: fieldByKey, newCriterion: newCriterion, defaultCfg: defaultCfg,
    normaliseShow: normaliseShow, outputTable: outputTable, defaultAvgCol: defaultAvgCol,
    meanOf: meanOf, MEASURES: MEASURES,

    // export + persistence
    serialiseTable: serialiseTable, exportTableFor: exportTableFor, safeName: safeName,
    serialiseGraph: serialiseGraph, deserialiseGraph: deserialiseGraph,
    applyGraph: applyGraph, loadGraphFromText: loadGraphFromText,
    FILE_KIND: FILE_KIND, FILE_VERSION: FILE_VERSION
  };
}

render();
})();
