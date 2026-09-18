(function() {

/* PALETTE OF EDGE COLOURS (one per source/path) */
var EDGE_PALETTE = ['#ffffff','#30d87a','#4aaff0','#e060b0','#a0d040','#9080e0'];
var edgeColorIndex = 0;

/* ============================================================================
   THE DATASET REGISTRIES
   ============================================================================
   Six arrays and one map, declared empty and filled from whatever files the
   Source nodes are given. Nothing is generated at start-up any more: the tool
   opens with no data at all, and a Source that has not been handed its files
   refuses to run rather than quietly answering about a fictional cohort.

   They are MUTATED IN PLACE, never reassigned, and that is load-bearing.
   STUDENT_COLUMNS captures `values:SPECS` and `values:YEARS` by reference, and
   enrolmentColumns() captures SUBJECTS and COURSES the same way, so a Filter
   dropdown offers whatever is currently loaded without a single one of those
   definitions knowing that data arrives from a file. Reassigning would leave
   every column pointing at the empty array it was built from.

   They are the UNION across every Source. Rows stay per-Source — two Sources
   holding two different exports each answer about their own — but a dropdown
   that offered only one Source's courses would be wrong for the graph as a
   whole, and the alternative (a per-node schema pass) buys nothing: offering a
   course no rows contain costs an empty result, which is the honest answer.  */
var STUDENTS       = [];   // every loaded student, all Sources
var SPECS          = [];   // maj1 codes, as the archive writes them
var DEGREES        = [];   // deg1 codes: BSC, BEHONS, BCA
var YEARS          = [];   // calendar years, ascending
var SUBJECTS       = [];   // four-letter course prefixes, first-seen order
var LEVELS         = [];   // course levels present, ascending: 1, 2, 3, 4
var COURSES        = [];   // { code, name, subject, level, points }
var COURSE_BY_CODE = {};

/* Rebuilt from scratch on every load or clear, because a registry that only
   ever grows would keep offering a course from a file that has since been
   unloaded. Cheap enough to do wholesale — a few thousand enrolments — and a
   great deal easier to reason about than incremental bookkeeping. */
function rebuildRegistries() {
  var seenSpec = {}, seenDeg = {}, seenYear = {}, seenSubj = {}, seenLvl = {}, seenCode = {};
  STUDENTS.length = 0; SPECS.length = 0; DEGREES.length = 0; YEARS.length = 0;
  SUBJECTS.length = 0; LEVELS.length = 0; COURSES.length = 0;
  Object.keys(COURSE_BY_CODE).forEach(function(k){ delete COURSE_BY_CODE[k]; });

  loadedDatasets().forEach(function(d) {
    d.students.forEach(function(s) {
      STUDENTS.push(s);
      if (s.specialisation && !seenSpec[s.specialisation]) {
        seenSpec[s.specialisation] = true; SPECS.push(s.specialisation);
      }
      if (s.degree && !seenDeg[s.degree]) {
        seenDeg[s.degree] = true; DEGREES.push(s.degree);
      }
      if (!seenYear[s.year]) { seenYear[s.year] = true; YEARS.push(s.year); }
      s.courses.forEach(function(e) {
        if (e.subject && !seenSubj[e.subject]) {
          seenSubj[e.subject] = true; SUBJECTS.push(e.subject);
        }
        if (e.level !== null && e.level !== undefined && !seenLvl[e.level]) {
          seenLvl[e.level] = true; LEVELS.push(e.level);
        }
        if (!seenCode[e.code]) {
          seenCode[e.code] = true;
          var c = { code:e.code, name:e.name, subject:e.subject,
                    level:e.level, points:e.points };
          COURSES.push(c);
          COURSE_BY_CODE[e.code] = c;
        }
      });
    });
  });

  SPECS.sort();
  DEGREES.sort();
  YEARS.sort(function(a, b){ return a - b; });
  SUBJECTS.sort();
  LEVELS.sort(function(a, b){ return a - b; });
  COURSES.sort(function(a, b){ return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; });
}

/* The catalogue's first course, for a fresh Filter criterion to point at. A
   constant before, because the catalogue was a constant; a function now,
   because at the moment a criterion is created there may be no catalogue at
   all. Empty string is a criterion that matches nothing, which is the right
   behaviour for "took course ___" with no courses known. */
function defaultCourse() { return COURSES.length ? COURSES[0].code : ''; }
function defaultSubject() { return SUBJECTS.length ? SUBJECTS[0] : ''; }
function defaultLevel()   { return LEVELS.length ? LEVELS[0] : ''; }

/* THE LEVEL A COURSE IS TAUGHT AT, read from its own code: SWEN421 is a
   400-level course, CGRA151 a 100-level one. The first digit is the level, and
   the rest of the number distinguishes courses within it.

   Derived rather than stored, because the archive has no level column and the
   code is the only place the fact lives. That is the same reasoning `subject`
   already follows — both are properties OF the code, and reading them out of it
   keeps them true for a course this catalogue has never seen.

   Worth having because the archive is not the honours-only year the built-in
   dataset pretended: 2022 alone carries 697 enrolments at 100-level and 454 at
   400-level. Averaging those together without being able to see the difference
   is the kind of answer that is wrong without looking wrong. */
function courseLevel(code) {
  var m = /\d/.exec(String(code == null ? '' : code));
  return m ? parseInt(m[0], 10) : null;
}

/* SYNTHETIC DATASET — reachable only from the test harness
   ---------------------------------------------------------------------------
   This was the dataset the tool shipped with, and it is now what the suites run
   against: several hundred assertions are written in terms of its forty
   students a year, its six specialisation names and its seeded GPAs, and
   rewriting them against the archive would have changed what those tests say
   rather than what they check.

   installSyntheticDataset() is called from the __QB_TEST__ block at the foot of
   this file and from nowhere else, so a production page never reaches any of
   it. The Source falls back to it only when it holds no files of its own —
   which, with the flag unset, is a fallback to null and therefore an error. */
var SYN_SPECS = ["Software Engineering","Computer Science","Information Technology","Data Science","Cybersecurity","Artificial Intelligence"];
var G22 = [78,82,91,65,88,72,95,55,83,70,61,79,86,73,90,68,77,84,62,92,75,80,58,87,71,94,66,85,76,89,63,74,81,93,69,78,85,72,60,88];
var G23 = [82,85,78,70,91,76,88,60,86,74,65,83,89,77,92,71,80,87,66,95,78,84,62,90,75,97,70,88,80,93,67,78,84,96,73,82,88,76,63,91];

/* THE GRADE MODEL
   The archive records a letter Grade and the course's Pts. It does not record a
   percentage mark, so there is no numeric column to average. Every numeric
   question about attainment — "average grade", "better than", "in this range" —
   therefore has to be answered in the grade points the university itself
   assigns, not in marks the data does not contain.

   Te Herenga Waka's scale is nine points, and its GPA is weighted by course
   points: sum(gradePoint x points) / sum(points). Every failing grade is worth
   zero, which is why D, E and K share a value: they are different reasons for
   the same outcome. The letter travels alongside the number so the reason is
   never lost — sorting still distinguishes a D from an E even though averaging
   cannot. */
var GRADE_POINTS = {
  'A+':9, 'A':8, 'A-':7,
  'B+':6, 'B':5, 'B-':4,
  'C+':3, 'C':2, 'C-':1,
  'D':0,  'E':0, 'K':0
};

/* Best to worst. Declared once and attached to every letterGrade column so a
   Sort can order grades the way a reader means them: as text, 'A+' falls
   between 'A' and 'A-' because '+' precedes '-' in ASCII. */
var GRADE_ORDER = ['A+','A','A-','B+','B','B-','C+','C','C-','D','E','K'];

/* null, never 0, for anything ungraded. A blank Grade in the archive is a
   course still in progress or withdrawn from, and scoring it zero would drag an
   average down to report a result that does not exist yet. Ungraded enrolments
   are left out of the GPA entirely — which is what the university does, and
   what the supervisor confirmed. */
function gradePoint(g) {
  var p = GRADE_POINTS[String(g === undefined || g === null ? '' : g).trim()];
  return p === undefined ? null : p;
}

/* Points-weighted, so a 30-point ENGR489 counts twice a 15-point course.
   Rounded to two places because a GPA is a summary and the third decimal is
   noise. A student with nothing graded has no GPA at all — null for the same
   reason a blank grade is not a zero. */
function gpaOf(enrolments) {
  var pts = 0, weighted = 0;
  (enrolments || []).forEach(function(e) {
    var gp = gradePoint(e.letterGrade);
    if (gp === null) return;
    var w = Number(e.points) || 0;
    pts += w;
    weighted += gp * w;
  });
  return pts === 0 ? null : Math.round((weighted / pts) * 100) / 100;
}

/* A GPA read back as a letter, for the overall standing shown on a student row.
   Indexed by grade point, so the array position IS the value — 7 is an A-, the
   way the university describes a 7.0 GPA. Every failing grade is worth zero, so
   zero can only come back as one of them; D is the least specific claim of the
   three and therefore the honest one to make from a number alone. */
var GRADE_BY_POINT = ['D','C-','C','C+','B-','B','B+','A-','A','A+'];
function gradeFromGpa(g) {
  if (g === null || g === undefined || isNaN(g)) return '';
  return GRADE_BY_POINT[Math.max(0, Math.min(9, Math.round(g)))];
}

/* Generator-private. The real data has no marks, so nothing outside the
   synthetic dataset may call this: it exists only to turn a latent ability
   score into a plausible letter, and it dies with the built-in dataset. */
function gradeFromMark(g) {
  if (g>=90) return 'A+'; if (g>=85) return 'A'; if (g>=80) return 'A-';
  if (g>=75) return 'B+'; if (g>=70) return 'B'; if (g>=65) return 'B-';
  if (g>=60) return 'C+'; if (g>=55) return 'C'; if (g>=50) return 'C-';
  if (g>=45) return 'D';  return 'E';
}

/* COURSE CATALOGUE
   400-level (Honours) offerings, grouped by subject prefix. A full Honours
   year is eight 15-point courses = 120 points, so every student record carries
   exactly eight enrolments for the year they are enrolled in.

   The subject list is derived from the codes rather than hardcoded, so
   replacing this array with the real catalogue — more courses, new prefixes —
   requires no other change: the filter dropdowns, the subject criterion and
   the breakdown tables all read from it. That replacement has now happened for
   real: COURSES is built from the Crse column of the loaded files, and this
   array is only the synthetic generator's private catalogue. */
var SYN_COURSES = [
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

SYN_COURSES.forEach(function(c) {
  c.subject = c.code.slice(0, 4);
  c.level = courseLevel(c.code);
  c.points = COURSE_POINTS;
});
var SYN_COURSE_BY_CODE = {};
SYN_COURSES.forEach(function(c){ SYN_COURSE_BY_CODE[c.code] = c; });
var SYN_SUBJECTS = [];
SYN_COURSES.forEach(function(c) {
  if (SYN_SUBJECTS.indexOf(c.subject) === -1) SYN_SUBJECTS.push(c.subject);
});

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
  var chosen = CORE_COURSES.filter(function(code){ return SYN_COURSE_BY_CODE[code]; });
  var pool = SYN_COURSES.filter(function(c){ return chosen.indexOf(c.code) === -1; });
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
   it exactly. The mark itself never reaches a table — it is the latent ability
   score the letter grade is drawn from, the same way a real generator would
   work — so keeping the mean intact is what makes the resulting GPA land near
   the student's intended standing. */
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
    var c = SYN_COURSE_BY_CODE[code];
    return {
      code: c.code,
      name: c.name,
      subject: c.subject,
      level: c.level,
      points: c.points,
      year: year,
      letterGrade: gradeFromMark(marks[i]),
      gradePoints: gradePoint(gradeFromMark(marks[i]))
    };
  });
}

/* The generator's output, in the same shape parseYearFile() produces: one
   object per student, enrolments nested. Both paths therefore hand the rest of
   the tool the identical thing, which is what lets the suites go on exercising
   every node against synthetic students while the Source itself only ever sees
   a dataset it was given. */
function buildSyntheticStudents() {
  var out = [];
  var baseId = 1001;
  [G22, G23].forEach(function(arr, yi) {
    arr.forEach(function(g, i) {
      var id = baseId++;
      var year = 2022 + yi;
      var spec = SYN_SPECS[i % SYN_SPECS.length];
      var enrolments = buildEnrolments(id, spec, year, g);
      // Derived from the enrolments, not stored alongside them, so the two can
      // never disagree.
      var avg = gpaOf(enrolments);
      out.push({
        id: id,
        gender: i % 2 === 0 ? 'M' : 'F',
        year: year,
        /* The generator's catalogue is a single honours year, so every
           synthetic student is on the one programme the built-in dataset was
           ever about. Stating it beats leaving the column undefined: the two
           paths have to hand the rest of the tool the same shape, and a suite
           asserts that they do. */
        degree: 'BEHONS',
        specialisation: spec,
        courses: enrolments,
        gpa: avg,
        letterGrade: gradeFromGpa(avg)
      });
    });
  });
  return out;
}

/* These student-object lookups (courseMark, takesCourse, courseStats, ...) were
   removed in the table refactor: course predicates now go through
   coursesColIndex() like every other table operation. They worked on arrays of
   student objects, which no longer travel anywhere. */



/* ============================================================================
   LOADING THE ARCHIVE — admission, parsing, and what a Source holds
   ============================================================================
   The tool ships with no data. A Source is handed two things, in this order:

     headers.txt          the column names, and the 1..N index line under them
     mcs-students-YYYY    one file per year, tab separated, one row per
                          enrolment, with no extension at all

   Both names are fixed by the archive, and BOTH ARE ENFORCED HERE rather than
   left to the file picker. `accept` on an <input type=file> filters what the
   dialog shows and binds nothing: every browser offers "All files", a file can
   be dragged in, and a file can be renamed. The same reasoning already governs
   graphFileProblem() for saved queries; this is that rule applied to the data.

   WHY ADMISSION IS A SECURITY CONCERN AND NOT MERELY TIDINESS
   ---------------------------------------------------------------------------
   Every cell that survives this module reaches the DOM — the results table, the
   edge preview, a filter dropdown, an exported CSV. A file read without
   question is arbitrary attacker-chosen content given a path to all four. The
   checks below are therefore layered, cheapest first, and each one refuses
   rather than repairs:

     1. NAME      exact for headers.txt, anchored for a year file, and the year
                  has to be a plausible calendar year. Any directory component
                  is stripped before matching, so a hand-built object claiming
                  "../../etc/passwd" is judged on its last segment and then
                  refused for not being one of the two names.
     2. SIZE      empty is refused, and so is anything past MAX_DATA_FILE_BYTES,
                  before a single byte is read. The archive's year files are
                  ~300 KB; the cap is a hundred times that and still far below
                  what would hang the tab.
     3. SHAPE     a year file's every row must carry exactly as many tab
                  separated fields as headers.txt declares. This is the check
                  that makes the pair a pair: a file with the right name but
                  another archive's columns is refused on line one rather than
                  silently read into the wrong fields.
     4. CONTENT   NUL and other C0 control characters are refused outright — no
                  legitimate export contains them, and they are how a payload
                  hides from a reader. Fields are capped, rows are capped, the
                  ID must be digits, Pts must be a small non-negative number,
                  and the Year column must agree with the year in the FILE NAME.
                  That last one is the integrity check with teeth: a file called
                  mcs-students-2022 whose rows say 202301 is not the 2022 data
                  and is not treated as though it were.

   None of this replaces escaping — esc() still runs on every value on its way
   into markup, because defence at the boundary and defence at the sink are
   different jobs. What it does is keep the boundary narrow enough to describe
   in a sentence: two file names, a fixed column count, and printable text.

   WHY PER SOURCE
   ---------------------------------------------------------------------------
   A Source owns its files. Two Sources can hold two different exports and each
   answers about its own rows, which is what makes "last year's archive against
   this year's" a graph rather than two sessions. The registries above are the
   union across all of them, for dropdowns only — see rebuildRegistries().

   WHY THE DATA IS NEVER SAVED
   ---------------------------------------------------------------------------
   A saved query records the NAMES of the files a Source was given and not one
   byte of their contents. Three reasons, and the first is sufficient on its
   own: the archive is student records, and a query file gets emailed around.
   The second is that a query is meant to be re-run against next year's data, so
   baking in a snapshot defeats the point. The third is that a .json file is
   trusted no further than any other input — data pasted into it would arrive
   already parsed, past every check in this module.

   So loading a query re-creates the graph and clears the data, and the Source
   panel then names the files it wants. That is not an inconvenience to be
   engineered away; it is the file-picker grant being asked for again, by the
   user, for files this session has not been given.                           */

var DATA_HEADERS_NAME = 'headers.txt';
var DATA_YEAR_RE      = /^mcs-students-(\d{4})$/;
var DATA_YEAR_MIN     = 1990;
var DATA_YEAR_MAX     = 2099;

/* 32 MB. The archive's year files are about 300 KB each, so this is two orders
   of magnitude of headroom for a bigger cohort or a longer field list, and
   still small enough that a refusal happens instantly rather than after the tab
   has swallowed the file. */
var MAX_DATA_FILE_BYTES = 32 * 1024 * 1024;

/* Row and field caps. A quarter of a million enrolments is far more than any
   single year of one school, and 512 characters is far more than any field in
   this archive — the longest is an email address. Both exist so that a file
   which passed the name check cannot still arrive as a denial of service or as
   a single cell that unbalances every table it appears in. */
var MAX_DATA_ROWS   = 250000;
var MAX_FIELD_CHARS = 512;

/* One Source accumulates year files, so there has to be a ceiling on how many.
   Fifty is longer than the archive has existed and longer than any question
   anyone will ask of it, and it matches the cap the saved descriptor applies to
   the same list — two limits on one thing that disagreed would mean a Source
   holding a year its own saved query could not name. */
var MAX_YEAR_FILES = 50;

/* A course is worth points; nothing in this catalogue is worth more than a
   double-weight honours project, and a number outside this range means the
   column has been misread rather than that the course is unusual. */
var MAX_COURSE_POINTS = 200;

/* The columns this tool reads. `deg1` joined them when the archive turned out
   to hold three degrees rather than the single honours programme the built-in
   dataset assumed, and it is a student-level fact: no student in either year
   carries two of them, or changes between years. Everything else in the file —
   the names, the usernames, the email addresses, the ethnicity — is parsed past
   and dropped on the floor. It is not needed to answer any of the supervisor's questions, and
   the least exposed way to hold personal data is not to hold it. */
var REQUIRED_HEADER_COLUMNS = ['ID', 'gender', 'deg1', 'maj1', 'Year', 'Crse', 'Grade', 'Pts'];

/* C0 controls except tab, newline and carriage return, plus DEL. Tested against
   the whole file before it is split, because the cheapest place to refuse a
   file is before it has become anything more structured than a string. */
var CONTROL_CHAR_RE = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]');

/* PER-SOURCE STATE — deliberately not part of the node model
   ---------------------------------------------------------------------------
   Keyed by node id and reset by applyGraph(), so it cannot travel through a
   saved file or survive a load. Keeping it out of `node.cfg` is what makes
   "the query is saved, the data is not" true by construction rather than by
   remembering to strip a field on the way out. */
var SOURCE_DATA = {};

/* A header accepted but not yet paired with any year file. Held apart from
   SOURCE_DATA because a header on its own is not a dataset — there is nothing
   to run a query against until a year file arrives — and the panel should say
   so rather than showing a Source that looks ready. */
var PENDING_HEADERS = {};

/* The last thing that happened on this Source, shown under its file list: an
   error to fix, or a confirmation of what went in. Transient, per node, and
   never serialised. */
var SOURCE_NOTICE = {};

/* The synthetic dataset, installed only under __QB_TEST__ and null otherwise.
   A Source with no files of its own falls back to it, which in a real page is a
   fallback to nothing — and therefore the error this feature exists to raise. */
var SYNTHETIC_DATASET = null;

function loadedDatasets() {
  var out = [];
  if (SYNTHETIC_DATASET) out.push(SYNTHETIC_DATASET);
  Object.keys(SOURCE_DATA).forEach(function(k) {
    if (SOURCE_DATA[k]) out.push(SOURCE_DATA[k]);
  });
  return out;
}

function datasetFor(node) {
  if (!node) return null;
  return SOURCE_DATA[node.id] || SYNTHETIC_DATASET || null;
}

function hasSourceData(node) { return !!datasetFor(node); }

/* The descriptor that DOES travel: names only. Read back out of cfg on load, so
   the panel can say which files this query was built against without having
   seen them. */
function datasetCfg(node) {
  var cfg = node.cfg = node.cfg || defaultCfg('source');
  if (!cfg.dataset || typeof cfg.dataset !== 'object' || Array.isArray(cfg.dataset)) {
    cfg.dataset = { headers:'', years:[] };
  }
  if (typeof cfg.dataset.headers !== 'string') cfg.dataset.headers = '';
  if (!Array.isArray(cfg.dataset.years)) cfg.dataset.years = [];
  return cfg.dataset;
}

/* ---------------------------------------------------------------- ADMISSION */

/* A File's name never carries a directory, but this function is also handed
   objects the tests build and, in principle, anything a future drag-and-drop
   path produces. Judging the last segment means a name that tries to be a path
   is answered by the ordinary "that is not one of the two names" refusal rather
   than by a special case for traversal. */
function dataFileName(file) {
  var n = (file && file.name) != null ? String(file.name) : '';
  return n.split(/[\\/]/).pop();
}

function sizeProblem(file, label) {
  var size = Number(file && file.size);
  if (!isFinite(size)) return null;   // a harness object that declares no size
  if (size === 0) return 'The ' + label + ' is empty.';
  if (size > MAX_DATA_FILE_BYTES) {
    return 'The ' + label + ' is ' + Math.round(size / 1048576) + ' MB, past the ' +
      Math.round(MAX_DATA_FILE_BYTES / 1048576) + ' MB limit, so it has not been read.';
  }
  return null;
}

function headersFileProblem(file) {
  if (!file) return 'No file was chosen.';
  var name = dataFileName(file);
  if (name.toLowerCase() !== DATA_HEADERS_NAME) {
    return 'The column file has to be named exactly "' + DATA_HEADERS_NAME +
      '", and "' + name + '" is not. Nothing has been read from it.';
  }
  return sizeProblem(file, 'column file');
}

/* The year lives in the name, and the name is the only place the tool will take
   it from. Deriving it from the contents instead would mean trusting the file
   to say which year it is — and then the agreement check in parseYearFile()
   would be comparing a value with itself. */
function yearFileProblem(file) {
  if (!file) return 'No file was chosen.';
  var name = dataFileName(file);
  var m = DATA_YEAR_RE.exec(name);
  if (!m) {
    return 'A year file has to be named "mcs-students-" followed by a four-digit ' +
      'year and nothing else, like "mcs-students-2022", with no extension. "' + name +
      '" is not, so nothing has been read from it.';
  }
  var year = parseInt(m[1], 10);
  if (year < DATA_YEAR_MIN || year > DATA_YEAR_MAX) {
    return '"' + name + '" claims the year ' + year + ', which is outside ' +
      DATA_YEAR_MIN + ' to ' + DATA_YEAR_MAX + '. Nothing has been read from it.';
  }
  return sizeProblem(file, 'year file "' + name + '"');
}

function yearOfFile(file) {
  var m = DATA_YEAR_RE.exec(dataFileName(file));
  return m ? parseInt(m[1], 10) : null;
}

/* ------------------------------------------------------------------ PARSING */

function controlCharProblem(text, label) {
  if (CONTROL_CHAR_RE.test(text)) {
    return 'The ' + label + ' contains control characters, which no export from ' +
      'the archive does. It has been refused rather than read.';
  }
  return null;
}

/* headers.txt is two lines: the names, space separated and space aligned, and
   under them the numbers 1..N naming each column's position. Both are used. The
   names say which column holds what; the index line is checked against them,
   because a file whose names and numbers disagree is a file that has been
   edited by hand and should not be guessed at. */
function parseHeaderFile(text, name) {
  var problem = controlCharProblem(text, 'column file');
  if (problem) return { error: problem };

  var lines = String(text).split(/\r?\n/).filter(function(l){ return l.trim() !== ''; });
  if (!lines.length) return { error: 'The column file has no column names in it.' };

  var names = lines[0].trim().split(/\s+/);
  if (names.length < REQUIRED_HEADER_COLUMNS.length) {
    return { error: 'The column file declares only ' + names.length +
      ' columns, which is too few to be the archive header.' };
  }

  /* The index line is optional — a header trimmed to its names alone is still a
     usable header — but if it is there it has to be right. Present and wrong is
     the case worth refusing: it means the two halves of the file describe
     different things, and picking one of them would be a guess. */
  if (lines.length > 1) {
    var idx = lines[1].trim().split(/\s+/);
    var numeric = idx.every(function(v){ return /^\d+$/.test(v); });
    if (numeric) {
      if (idx.length !== names.length) {
        return { error: 'The column file names ' + names.length + ' columns but numbers ' +
          idx.length + ' of them. It has been refused rather than guessed at.' };
      }
      for (var i = 0; i < idx.length; i++) {
        if (parseInt(idx[i], 10) !== i + 1) {
          return { error: 'The column file numbering is out of order at position ' +
            (i + 1) + ', where it reads ' + idx[i] + '. It has been refused rather ' +
            'than guessed at.' };
        }
      }
    }
  }

  /* Duplicate names are expected, not an error: the archive carries maj1 and
     maj2 twice, once for each degree. First occurrence wins, which is the first
     degree — the one every other column on the row is about. */
  var byName = {};
  names.forEach(function(n, i) { if (!(n in byName)) byName[n] = i; });

  var missing = REQUIRED_HEADER_COLUMNS.filter(function(c){ return !(c in byName); });
  if (missing.length) {
    return { error: 'The column file is missing ' + missing.join(', ') +
      ', which the tool needs in order to read a year file.' };
  }

  return { name: dataFileName({ name: name }), columns: names, byName: byName };
}

/* The Year column reads 202201: a calendar year and a trimester. Only the year
   half is used — the trimester is already in Sem — and it has to be the year
   the FILE NAME claims. */
function calendarYearOf(raw) {
  var v = String(raw == null ? '' : raw).trim();
  if (!/^\d{4}(\d{2})?$/.test(v)) return null;
  return parseInt(v.slice(0, 4), 10);
}

/* One year file to a list of students, enrolments nested — the same shape the
   synthetic generator produces, so nothing downstream can tell which it was
   handed.

   Errors name the line. A message that says only "the file is malformed" leaves
   the user to bisect a two thousand line export by hand, and the line number is
   free to carry. */
function parseYearFile(text, year, header) {
  var problem = controlCharProblem(text, 'year file');
  if (problem) return { error: problem };

  var lines = String(text).split(/\r?\n/);
  var width = header.columns.length;
  var at = header.byName;

  var byId = {}, order = [], rows = 0;
  var warnings = {};

  for (var ln = 0; ln < lines.length; ln++) {
    var line = lines[ln];
    if (line === '' || line.trim() === '') continue;

    if (++rows > MAX_DATA_ROWS) {
      return { error: 'The year file holds more than ' + MAX_DATA_ROWS +
        ' rows, which is past what this tool will read.' };
    }

    var f = line.split('\t');
    if (f.length !== width) {
      return { error: 'Line ' + (ln + 1) + ' has ' + f.length + ' tab-separated fields ' +
        'but the column file declares ' + width + '. The two files do not describe the ' +
        'same export, so neither has been loaded.' };
    }

    var i;
    for (i = 0; i < f.length; i++) {
      if (f[i].length > MAX_FIELD_CHARS) {
        return { error: 'Line ' + (ln + 1) + ' has a field longer than ' + MAX_FIELD_CHARS +
          ' characters, which no column in this archive is. It has been refused.' };
      }
    }

    var id = f[at.ID].trim();
    if (!/^\d{1,12}$/.test(id)) {
      return { error: 'Line ' + (ln + 1) + ' has "' + id + '" where a student ID belongs. ' +
        'An ID is digits only, so the file has been refused.' };
    }

    var rowYear = calendarYearOf(f[at.Year]);
    if (rowYear === null) {
      return { error: 'Line ' + (ln + 1) + ' has "' + String(f[at.Year]).trim() +
        '" in the Year column, which is not a year. The file has been refused.' };
    }
    if (rowYear !== year) {
      return { error: 'The file is named for ' + year + ' but line ' + (ln + 1) +
        ' is a ' + rowYear + ' enrolment. A file is only loaded as the year it is ' +
        'named for, so it has been refused.' };
    }

    var ptsRaw = f[at.Pts].trim();
    if (!/^\d+(\.\d+)?$/.test(ptsRaw)) {
      return { error: 'Line ' + (ln + 1) + ' has "' + ptsRaw + '" where a course’s ' +
        'points belong. The file has been refused.' };
    }
    var pts = parseFloat(ptsRaw);
    if (pts > MAX_COURSE_POINTS) {
      return { error: 'Line ' + (ln + 1) + ' says a course is worth ' + pts +
        ' points, which is past anything the catalogue holds. The file has been refused.' };
    }

    var code = f[at.Crse].trim();
    if (!/^[A-Za-z]{2,6}\d{1,4}[A-Za-z]?$/.test(code)) {
      return { error: 'Line ' + (ln + 1) + ' has "' + code + '" where a course code belongs. ' +
        'The file has been refused.' };
    }

    var grade = f[at.Grade].trim();
    /* An unrecognised grade is a warning, not a refusal. gradePoint() already
       answers null for anything off the scale — the same answer it gives a
       dropped course's blank — so the row is safe to keep and the GPA stays
       honest. Refusing the file would be refusing real data over a code this
       tool has not been told about yet, which is a worse failure than saying so
       and carrying on. */
    if (grade !== '' && gradePoint(grade) === null) warnings['grade "' + grade + '"'] = true;

    var s = byId[id];
    if (!s) {
      s = byId[id] = { id: parseInt(id, 10), gender: f[at.gender].trim(), year: year,
                       degree: f[at.deg1].trim(), specialisation: f[at.maj1].trim(),
                       courses: [] };
      order.push(id);
    }

    s.courses.push({
      code: code,
      /* The archive records a course by code and never by title, so the name IS
         the code. Saying so plainly beats inventing a title, and courseTitle()
         prints one of them rather than "AIML427 - AIML427". */
      name: code,
      subject: code.slice(0, 4).toUpperCase(),
      level: courseLevel(code),
      points: pts,
      year: year,
      letterGrade: grade,
      gradePoints: gradePoint(grade)
    });
  }

  if (!order.length) {
    return { error: 'The year file has no enrolment rows in it.' };
  }

  var students = order.map(function(k) {
    var s = byId[k];
    // Derived from the enrolments rather than stored beside them, exactly as
    // the generator does it, so the two can never disagree.
    s.courses.sort(function(a, b){ return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; });
    var avg = gpaOf(s.courses);
    s.gpa = avg;
    s.letterGrade = gradeFromGpa(avg);
    return s;
  });

  return { year: year, rows: rows, students: students, warnings: Object.keys(warnings) };
}

/* ------------------------------------------------------- BUILDING A DATASET */

/* One header plus any number of parsed year files. A student who appears in two
   years is two students here, because they are: a row is a student IN A YEAR,
   which is what makes "the 2022 cohort" and "the 2023 cohort" separately
   countable and is the granularity every existing node was written against.

   `parsed` is kept, not just the totals derived from it. That is what makes a
   Source's year files a COLLECTION rather than a single snapshot: adding a year
   or dropping one is this function called again over a different list, so the
   flattened students, the counts and the warnings can never drift from the
   files they came from. Deriving them once and then patching them in place is
   the version of this that goes wrong six months later. */
function buildDataset(header, parsedYears) {
  var students = [], years = [], files = [], warnings = {};
  var parsed = parsedYears.slice().sort(function(a, b){ return a.year - b.year; });
  parsed.forEach(function(p) {
    years.push(p.year);
    files.push({ name: yearFileNameFor(p.year), year: p.year,
                 rows: p.rows, students: p.students.length });
    p.students.forEach(function(s){ students.push(s); });
    (p.warnings || []).forEach(function(w){ warnings[w] = true; });
  });
  return {
    headers: header,
    parsed: parsed,
    files: files,
    years: years,
    students: students,
    warnings: Object.keys(warnings),
    loadedAt: new Date().toISOString()
  };
}

/* The one place a year becomes a file name. The admission rule reads names and
   this writes them, so a change to the convention is one edit rather than a
   hunt through the panel, the log and three error messages. */
function yearFileNameFor(year) { return 'mcs-students-' + year; }

/* The year files a Source is currently holding, as parsed results. Empty for a
   Source with only a header, and empty for the built-in dataset, which has no
   files behind it to add to or take away. */
function parsedYearsOf(nodeId) {
  var d = SOURCE_DATA[nodeId];
  return (d && d.parsed) ? d.parsed : [];
}

/* Install, or take away. Both go through here so that the registries are
   rebuilt exactly once per change and there is one place that knows a dataset
   change invalidates the results on screen. */
function setSourceData(nodeId, dataset) {
  if (dataset) SOURCE_DATA[nodeId] = dataset;
  else delete SOURCE_DATA[nodeId];
  rebuildRegistries();
  markStale();
}

function clearSourceData(nodeId) {
  var node = findNode(nodeId);
  setSourceData(nodeId, null);
  if (node) {
    var d = datasetCfg(node);
    d.headers = ''; d.years = [];
  }
  delete PENDING_HEADERS[nodeId];
  setSourceNotice(nodeId, null);
  render();
}

/* Every Source forgets its files. Called by applyGraph() — see the note at the
   top of this section about why a loaded query starts with no data — and by
   clearAll(), which is starting over in every other respect too. */
function clearAllSourceData() {
  Object.keys(SOURCE_DATA).forEach(function(k){ delete SOURCE_DATA[k]; });
  Object.keys(PENDING_HEADERS).forEach(function(k){ delete PENDING_HEADERS[k]; });
  Object.keys(SOURCE_NOTICE).forEach(function(k){ delete SOURCE_NOTICE[k]; });
  rebuildRegistries();
}

function setSourceNotice(nodeId, notice) {
  if (notice) SOURCE_NOTICE[nodeId] = notice;
  else delete SOURCE_NOTICE[nodeId];
}

function headerFor(nodeId) {
  var d = SOURCE_DATA[nodeId];
  return (d && d.headers) || PENDING_HEADERS[nodeId] || null;
}

/* ------------------------------------------------------------- READING FILES

   Callbacks rather than promises, to match the rest of the file, and because
   the failure path has to be as visible as the success one: a FileReader that
   errors must leave the Source exactly as it was, not half loaded.           */

function readFileText(file, cb) {
  var reader = new FileReader();
  reader.onload  = function(){ cb(null, String(reader.result)); };
  reader.onerror = function(){ cb('Could not read "' + dataFileName(file) + '".'); };
  try { reader.readAsText(file); }
  catch (e) { cb('Could not read "' + dataFileName(file) + '".'); }
}

/* THE HEADER STEP.
   Accepting a new header discards any year files already loaded on this Source.
   They were parsed against the old column list, and keeping them would leave a
   Source whose rows and whose header came from different exports — the precise
   thing the field-count check exists to prevent, arrived at by a different
   route. */
function loadHeadersFor(nodeId, file, done) {
  done = done || function(){};
  var problem = headersFileProblem(file);
  if (problem) { failSource(nodeId, problem, done); return; }

  readFileText(file, function(err, text) {
    if (err) { failSource(nodeId, err, done); return; }
    var header = parseHeaderFile(text, dataFileName(file));
    if (header.error) { failSource(nodeId, header.error, done); return; }

    PENDING_HEADERS[nodeId] = header;
    setSourceData(nodeId, null);
    var node = findNode(nodeId);
    if (node) {
      var d = datasetCfg(node);
      d.headers = header.name;
      d.years = [];
    }
    setSourceNotice(nodeId, { kind:'ok', text:
      'Read ' + header.columns.length + ' columns from ' + header.name +
      '. Now choose the year files.' });
    render();
    done(null, header);
  });
}

/* THE YEAR STEP.
   ---------------------------------------------------------------------------
   Year files ACCUMULATE. One header describes the shape of every year file, so
   a Source has exactly one of those; the years themselves are a collection, and
   choosing more adds to what is already there rather than replacing it. That is
   what makes "2022 and 2023, then 2024 when it arrives" an ordinary afternoon
   rather than a re-pick of all three.

   Two rules keep the accumulation honest:

     ALL OR NOTHING WITHIN A PICK. A user who chooses three files and gets two
     of them has a Source answering about a cohort they did not ask for, and no
     wording in a notice makes that safe. If any file in the selection is
     refused, none of them are added and whatever was already loaded is left
     exactly as it was.

     ONE FILE PER YEAR. Choosing a year already held REPLACES that year, because
     the only reason to do it is a corrected export, and holding both would mean
     counting the cohort twice. The notice says which years were added and which
     were replaced, so it is never a silent substitution. Two files for the SAME
     year inside ONE pick is still refused: there is no way to tell which of them
     was meant.                                                                */
function loadYearFilesFor(nodeId, fileList, done) {
  done = done || function(){};
  var files = Array.prototype.slice.call(fileList || []);
  if (!files.length) { done(null, null); return; }

  var header = headerFor(nodeId);
  if (!header) {
    failSource(nodeId, 'Load ' + DATA_HEADERS_NAME + ' first. A year file cannot be ' +
      'read without the column list that says what its fields are.', done);
    return;
  }

  var existing = parsedYearsOf(nodeId);
  var held = {};
  existing.forEach(function(p){ held[p.year] = true; });

  var problem = null;
  var seen = {};
  files.forEach(function(f) {
    if (problem) return;
    problem = yearFileProblem(f);
    if (problem) return;
    var y = yearOfFile(f);
    if (seen[y]) {
      problem = 'Two of the chosen files are for ' + y + ', and there is no way to ' +
        'tell which one was meant. Choose one of them.';
      return;
    }
    seen[y] = true;
  });
  if (problem) { failSource(nodeId, problem, done); return; }

  var totalAfter = existing.filter(function(p){ return !seen[p.year]; }).length + files.length;
  if (totalAfter > MAX_YEAR_FILES) {
    failSource(nodeId, 'That would give this Source ' + totalAfter + ' year files, past the ' +
      'limit of ' + MAX_YEAR_FILES + '. Remove some first, or use a second Source.', done);
    return;
  }

  var parsed = [], pending = files.length, failed = false;

  files.forEach(function(file, i) {
    readFileText(file, function(err, text) {
      if (failed) return;
      if (err) { failed = true; failSource(nodeId, err, done); return; }

      var out = parseYearFile(text, yearOfFile(file), header);
      if (out.error) {
        failed = true;
        failSource(nodeId, dataFileName(file) + ': ' + out.error, done);
        return;
      }
      parsed[i] = out;
      if (--pending === 0) finishYearLoad(nodeId, header, existing, parsed, held, done);
    });
  });
}

/* Merge the accepted pick into what the Source already held, and say what
   changed. Only reached once every file in the pick has parsed, which is what
   makes the all-or-nothing rule true rather than merely intended. */
function finishYearLoad(nodeId, header, existing, added, held, done) {
  var incoming = {};
  added.forEach(function(p){ incoming[p.year] = true; });

  var kept = existing.filter(function(p){ return !incoming[p.year]; });
  var dataset = buildDataset(header, kept.concat(added));

  setSourceData(nodeId, dataset);
  delete PENDING_HEADERS[nodeId];
  applyDatasetToNode(nodeId, dataset);

  var fresh = added.filter(function(p){ return !held[p.year]; })
                   .map(function(p){ return p.year; }).sort();
  var replaced = added.filter(function(p){ return held[p.year]; })
                      .map(function(p){ return p.year; }).sort();

  var parts = [];
  if (fresh.length)    parts.push('Added ' + fresh.join(', '));
  if (replaced.length) parts.push('Replaced ' + replaced.join(', '));
  var text = (parts.length ? parts.join('. ') + '. ' : '') +
    'Now holding ' + dataset.files.length + ' year file' +
    (dataset.files.length === 1 ? '' : 's') + ' and ' +
    dataset.students.length + ' student record' +
    (dataset.students.length === 1 ? '' : 's') + '.';
  if (dataset.warnings.length) {
    text += ' Kept as ungraded: ' + dataset.warnings.join(', ') + '.';
  }

  setSourceNotice(nodeId, { kind:'ok', text: text });
  render();
  done(null, dataset);
}

/* Take one year back off a Source. The counterpart of adding one: a collection
   you can only add to is a collection you have to tear down and rebuild to
   correct, which is how a user ends up re-picking four files to drop one.

   Removing the last year leaves the HEADER in place rather than clearing the
   Source outright. The header is still valid — it describes the shape of files
   that have not been chosen yet — and throwing it away would make "I picked the
   wrong year" cost two steps instead of one. */
function removeSourceYear(nodeId, year) {
  var header = headerFor(nodeId);
  var remaining = parsedYearsOf(nodeId).filter(function(p){ return p.year !== year; });

  if (!remaining.length) {
    setSourceData(nodeId, null);
    if (header) PENDING_HEADERS[nodeId] = header;
    applyDatasetToNode(nodeId, null);
    setSourceNotice(nodeId, { kind:'ok', text:
      'Removed ' + yearFileNameFor(year) + '. ' + DATA_HEADERS_NAME +
      ' is still loaded, so choose the year files you want.' });
  } else {
    var dataset = buildDataset(header, remaining);
    setSourceData(nodeId, dataset);
    applyDatasetToNode(nodeId, dataset);
    setSourceNotice(nodeId, { kind:'ok', text:
      'Removed ' + yearFileNameFor(year) + '. Now holding ' +
      dataset.files.map(function(f){ return f.year; }).join(', ') + '.' });
  }
  render();
}

/* Keep the saved descriptor and the population setting in step with whatever
   the Source is now holding. Shared by every path that changes the year files,
   because three copies of this is three chances for the panel to disagree with
   the data behind it. */
function applyDatasetToNode(nodeId, dataset) {
  var node = findNode(nodeId);
  if (!node) return;
  var d = datasetCfg(node);
  var header = headerFor(nodeId);
  d.headers = header ? header.name : '';
  d.years = dataset ? dataset.years.slice() : [];

  /* A population the Source can no longer answer would leave it silently empty.
     Falling back to "all students" is the only choice that is right whatever is
     held, and the panel shows the change. */
  var years = dataset ? dataset.years : [];
  if (node.cfg.pop !== 'all' && years.indexOf(parseInt(node.cfg.pop, 10)) === -1) {
    node.cfg.pop = 'all';
  }
}

/* One refusal path. The Source is left as it was — nothing half-applied — the
   reason is shown on the node rather than in the results panel, because that is
   where the button that caused it lives, and the caller is told. */
function failSource(nodeId, message, done) {
  setSourceNotice(nodeId, { kind:'error', text: message });
  render();
  (done || function(){})(message);
}

/* ---------------------------------------------------- THE PICKERS THEMSELVES

   Two inputs, not one, because the two steps are genuinely ordered: a year file
   cannot be parsed without the column list. `accept` is set on the header input
   as a courtesy to the dialog and trusted by neither check above — and on the
   year picker it is absent, since the archive's year files carry no extension
   for a filter to match on.                                                  */

function pickHeadersFile(nodeId) {
  var input = document.getElementById('headersFile');
  if (!input) return;
  input.value = '';          // or choosing the same file twice fires no change
  input._node = nodeId;
  input.click();
}

function pickYearFiles(nodeId) {
  var input = document.getElementById('yearFiles');
  if (!input) return;
  input.value = '';
  input._node = nodeId;
  input.click();
}

function onHeadersChosen(e) {
  var input = e.target;
  var nodeId = input._node;
  var file = input.files && input.files[0];
  if (!file || nodeId == null) return;
  loadHeadersFor(nodeId, file);
}

function onYearFilesChosen(e) {
  var input = e.target;
  var nodeId = input._node;
  if (nodeId == null || !input.files || !input.files.length) return;
  loadYearFilesFor(nodeId, input.files);
}

/* Installed by the test harness and by nothing else. Kept beside the loader
   rather than at the foot of the file so that the one call site and the thing
   it switches on are readable together. */
/* Stand the fallback down, so a Source is in exactly the position a Source on a
   real page is in: no files, no built-in dataset, nothing to answer with. Used
   by the suite that tests the refusal, because a refusal tested with a fallback
   still in place is not the refusal a user would meet. Test-only, alongside
   installSyntheticDataset() and exported from the same guarded block. */
function setSyntheticDataset(dataset) {
  SYNTHETIC_DATASET = dataset || null;
  rebuildRegistries();
}

function installSyntheticDataset() {
  var students = buildSyntheticStudents();
  SYNTHETIC_DATASET = {
    headers: { name:'(built in)', columns:[], byName:{} },
    files: [{ name:'(built in)', year:2022, rows:students.length, students:students.length }],
    years: [2022, 2023],
    students: students,
    warnings: [],
    loadedAt: null,
    synthetic: true
  };
  rebuildRegistries();
}

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
   rows at the Source — would make "count students" wrong by a factor of eight,
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

var STUDENT_COLUMNS = [
  { key:'id',             label:'ID',             type:COLTYPE.NUMBER, def:'1001' },
  { key:'gender',         label:'Gender',         type:COLTYPE.ENUM,   values:['M','F'] },
  { key:'year',           label:'Year',           type:COLTYPE.ENUM,   values:YEARS },
  /* Degree sits beside Specialisation because they are the same kind of fact at
     two widths — BSC and BEHONS are programmes, SWEN and CYBR are majors within
     them — and a question about one is nearly always a question about both. */
  { key:'degree',         label:'Degree',         type:COLTYPE.ENUM,   values:DEGREES },
  { key:'specialisation', label:'Specialisation', type:COLTYPE.ENUM,   values:SPECS },
  { key:'gpa',            label:'GPA',            type:COLTYPE.NUMBER, def:'5' },
  { key:'letterGrade',    label:'Grade',          type:COLTYPE.TEXT,   order:GRADE_ORDER },
  { key:'courses',        label:'Courses',        type:COLTYPE.COURSES }
];

/* The one table builder: every Source produces this shape, and a row is a
   student. The student's courses ride along nested in the last cell rather than
   being flattened into rows of their own. */
/* Built from the COLUMN LIST rather than from a hand-written array, because the
   two were positional and could disagree — and did, the moment Degree was added
   to STUDENT_COLUMNS and the row builder was not updated with it. Every cell
   shifted one place left, and a Filter on Specialisation started reading grades.

   Driving both from `key` means a column added tomorrow needs no second edit,
   and the invariant the suite asserts — one cell per column, in order — is true
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

/* Two decimal places, with trailing zeros dropped — not toFixed, which pads.
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
var connections = [];   // [{from, to, port, color}] — port names an input on the TO node
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
  reverse: { w:106, h:72 },
  take:    { w:106, h:72 },
  unique:  { w:106, h:72 },
  select:  { w:106, h:72 },
  project: { w:106, h:72 },
  aggregate:        { w:106, h:72 },
  aggregateColumns: { w:112, h:72 },
  aggregateRows:    { w:112, h:72 },
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
  doomed.forEach(forgetSourceData);
  rebuildRegistries();
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
var TABLE_NODES = ['filter', 'sort', 'reverse', 'take', 'unique', 'select', 'project',
                   'aggregate', 'aggregateColumns', 'aggregateRows', 'combine'];
var CONNECT_RULES = {
  source:           TABLE_NODES.concat(['compare', 'output']),
  filter:           TABLE_NODES.concat(['compare', 'output']),
  sort:             TABLE_NODES.concat(['compare', 'output']),
  reverse:          TABLE_NODES.concat(['compare', 'output']),
  take:             TABLE_NODES.concat(['compare', 'output']),
  unique:           TABLE_NODES.concat(['compare', 'output']),
  select:           TABLE_NODES.concat(['compare', 'output']),
  project:          TABLE_NODES.concat(['compare', 'output']),
  aggregate:        TABLE_NODES.concat(['compare', 'output']),
  aggregateColumns: TABLE_NODES.concat(['compare', 'output']),
  aggregateRows:    TABLE_NODES.concat(['compare', 'output']),
  combine:          TABLE_NODES.concat(['compare', 'output']),
  /* Compare was output-only, on the grounds that it is superseded by SelectFor
     and widening its reach would be work thrown away. That reasoning held while
     the cost was hypothetical. It is not: a Compare's result is the only
     labelled multi-row answer the tool can currently produce — "how many in
     each year", "the average for each branch" — and refusing to let it be
     aggregated made "count per year, then average those counts" unbuildable
     through it. That is the exact example app.js:212 cites as the thing the
     table refactor existed to fix.

     Nothing downstream needed changing. Every row node already decides for
     itself whether a Compare's branch metadata still describes its rows, and
     says so where it does it — Sort and Take carry meta, Select and the
     one-column mode of Unique drop it. Those comments were written against this
     day arriving. */
  compare:          TABLE_NODES.concat(['compare', 'output']),
  output:           []
};
function canConnect(fromType, toType) {
  return (CONNECT_RULES[fromType] || []).indexOf(toType) !== -1;
}

/* ============================================================================
   INPUT PORTS
   ============================================================================
   A connection now names the input it lands on, not just the node. Previously
   two wires into one node were silently unioned: the merge happened in
   evaluateGraph, was invisible on the canvas, and — as the histogram case
   showed — could discard rows without saying so. A node now declares its
   inputs, and each wire occupies one.

   Two arities:
     single — exactly one wire. A second is refused at the point of wiring.
     multi  — many wires, because taking several tables IS the node's job.
              Combine and Compare, and nothing else.

   The implicit union is gone with it: a node with one input has one table, so
   there is nothing to reconcile. Where several tables must become one, the user
   says so by wiring a Combine, which is the node whose settings decide how.

   Declaring ports as data rather than as branches is what lets the geometry,
   the wiring rules, the evaluator and the schema pass all agree about a node
   they have never heard of. SelectFor (data + labels) and any future two-input
   node are an entry in this table plus their implementation — nothing here
   changes.                                                                   */

var SINGLE_IN = [{ key:'in', label:'In' }];

var NODE_PORTS = {
  source:           [],
  filter:           SINGLE_IN,
  sort:             SINGLE_IN,
  reverse:          SINGLE_IN,
  take:             SINGLE_IN,
  unique:           SINGLE_IN,
  select:           SINGLE_IN,
  project:          SINGLE_IN,
  aggregate:        SINGLE_IN,
  aggregateColumns: SINGLE_IN,
  aggregateRows:    SINGLE_IN,
  combine:          [{ key:'in', label:'Tables',   multi:true }],
  compare:          [{ key:'in', label:'Branches', multi:true }],
  output:           SINGLE_IN
};

function portsOf(type) { return NODE_PORTS[type] || SINGLE_IN; }

// The port a wire lands on when the file or the caller does not say. Every
// node's first port is its data input, which keeps legacy graphs meaningful.
function primaryPort(type) {
  var p = portsOf(type);
  return p.length ? p[0].key : 'in';
}

function portDef(type, key) {
  var p = portsOf(type);
  for (var i = 0; i < p.length; i++) if (p[i].key === key) return p[i];
  return null;
}

// Unknown ports resolve to the primary one rather than vanishing: a hand-edited
// file naming a port that no longer exists still loads as a data connection.
function normalisePort(type, key) {
  return portDef(type, key) ? key : primaryPort(type);
}

function wiresInto(nodeId, portKey) {
  return connections.filter(function(c) {
    return c.to === nodeId && (portKey === undefined || c.port === portKey);
  });
}

/* A port accepts a wire when it is multi, or when it is single and empty.
   `ignore` skips one existing connection, so a check can ask "would this be
   free if that wire were not there" — which is what a re-wire needs. */
function portAccepts(node, portKey, ignore) {
  var def = portDef(node.type, portKey);
  if (!def) return false;
  if (def.multi) return true;
  return wiresInto(node.id, portKey).filter(function(c) {
    return c !== ignore;
  }).length === 0;
}

function freePortsOn(node) {
  return portsOf(node.type).filter(function(p) {
    return portAccepts(node, p.key);
  });
}

/* ============================================================================
   PORT GEOMETRY
   ============================================================================
   Ports are spaced down the left edge of the shape. One port sits at mid-height,
   which is exactly where the single entry point used to be — so a one-input node
   is pixel-identical to what it was before this change, and every existing
   arrow lands where it always did.

   n ports divide the edge into n+1 intervals and sit on the interior boundaries,
   so they are evenly spaced and symmetric about the centre whatever n is.     */
function shapeExit(node) {
  var s = SHAPE[node.type];
  return { x: node.x + (NODE_W - s.w) / 2 + s.w, y: node.y + s.h / 2 };
}

function portOffsetY(type, portKey) {
  var ps = portsOf(type);
  if (ps.length < 2) return SHAPE[type].h / 2;
  var i = 0;
  for (var k = 0; k < ps.length; k++) if (ps[k].key === portKey) { i = k; break; }
  return SHAPE[type].h * (i + 1) / (ps.length + 1);
}

function shapeEntry(node, portKey) {
  var s = SHAPE[node.type];
  return {
    x: node.x + (NODE_W - s.w) / 2,
    y: node.y + portOffsetY(node.type, portKey === undefined ? primaryPort(node.type) : portKey)
  };
}

/* Direction resolution was duplicated verbatim between the drop handler and the
   ghost-arrow preview; they had to agree or the preview would lie about what
   dropping would do. One function now serves both.

   It also chooses the port. A node dragged towards a two-input node aims at
   whichever free port is nearest, so the gesture that used to mean "connect"
   now means "connect to this input" without a second interaction. A node whose
   every port is taken offers no target at all: the ghost arrow does not appear,
   which is the refusal made visible before the drop rather than after it. */
function nearestFreePort(from, to) {
  var ex = shapeExit(from);
  var best = null, bestD = Infinity;
  freePortsOn(to).forEach(function(p) {
    var en = shapeEntry(to, p.key);
    var d = Math.pow(en.x - ex.x, 2) + Math.pow(en.y - ex.y, 2);
    if (d < bestD) { bestD = d; best = { port:p.key, p0:ex, tip:en, d:d }; }
  });
  return best;
}

function resolveDirection(a, b) {
  var fwd = canConnect(a.type, b.type) ? nearestFreePort(a, b) : null;
  var rev = canConnect(b.type, a.type) ? nearestFreePort(b, a) : null;
  if (!fwd && !rev) return null;
  if (fwd && (!rev || fwd.d <= rev.d)) {
    return { from:a, to:b, port:fwd.port, p0:fwd.p0, tip:fwd.tip };
  }
  return { from:b, to:a, port:rev.port, p0:rev.p0, tip:rev.tip };
}

/* DEFAULT CONFIG PER NODE TYPE
   Written out in full rather than filled in lazily, so a saved file always
   contains every key a node uses and loading never depends on defaults that
   may have changed since the file was written. */
function defaultCfg(type) {
  /* `dataset` records the NAMES of the files this Source was given, and never
     their contents — see the loader section. It is the one cfg key whose value
     is a description of state held outside the model, which is exactly what
     makes a saved query re-openable without carrying student records in it. */
  if (type === 'source')  return { pop:'all', dataset:{ headers:'', years:[] } };
  if (type === 'filter')  return { criteria:[newCriterion()] };
  if (type === 'compare') return { measures:DEFAULT_MEASURES.slice(), sort:'wired', labels:{} };
  if (type === 'sort')    return { keys: [newSortKey()] };
  if (type === 'take')    return { n: String(TAKE_DEFAULT) };
  // Reverse has nothing to configure: it takes no column, no direction and no
  // count. An empty cfg is the honest answer, not a placeholder key.
  if (type === 'reverse') return {};
  // col:'' means all columns — whole-row deduplication. Naming a column
  // switches to the label-producing mode and rewrites the header.
  if (type === 'unique')  return { col: '' };
  // Both aggregation nodes share one config shape: which measure, and (for the
  // measures that need one) which column. col:'' means "resolve against
  // whatever arrives", which is what keeps a saved query working after the
  // Source granularity is changed underneath it.
  if (type === 'aggregate')        return { op: AGG_DEFAULT_OP, col: '' };
  if (type === 'aggregateColumns') return { op: 'sum' };
  // Same shape, and sum for the same reason: totalling is the measure a row of
  // measures is usually wanted for, and it is the one that is obviously wrong
  // if the input is not a row of measures.
  if (type === 'aggregateRows')    return { op: 'sum' };
  // dedupe defaults off: merge stacks rows, and discarding identical rows is a
  // decision the user makes rather than one the node makes quietly.
  if (type === 'combine') return { mode: 'merge', dedupe: false, base: '', key: '' };
  // cols:null means "every column", so a fresh Select is a pass-through and
  // only becomes a narrowing once the user unticks something. An explicit list
  // of every key would go stale the moment the node was rewired.
  if (type === 'select')  return { cols: null };
  // Nothing to configure: what it unfolds is decided by the data, not by a
  // setting. A node with no options is the honest shape for an operation with
  // no choices in it.
  if (type === 'project') return {};
  // cols:null means "every column", the same convention Select uses, so the
  // validator mergeCfg already applies to that key covers this one too.
  if (type === 'output')  return { show:'rows', filename:'', cols:null };
  return {};
}

/* A criterion keeps a value and an operator per field, not one of each. Switching
   the field selector from Avg to Gender and back therefore restores the original
   threshold instead of a default, and the same criterion object works against
   any table schema — including ones with columns that did not exist when it was
   created. */
function newCriterion() {
  return { field:'gpa', values:{}, ops:{}, course:defaultCourse() };
}

function critValue(c, field, col) {
  if (c.values && c.values[field] !== undefined) return c.values[field];
  if (col && col.def !== undefined) return col.def;
  if (col && col.values && col.values.length) return String(col.values[0]);
  /* A column can declare an order without declaring a value set — letterGrade
     carries GRADE_ORDER and nothing else — and that order is just as good a
     source of a default. Without this the control renders with nothing
     selected, the browser shows option one, and the model still says "", which
     is precisely the disagreement between panel and model that the sort keys
     go out of their way to avoid. */
  if (col && col.order && col.order.length) return String(col.order[0]);
  return '';
}
function critOp(c, field, fallback) {
  if (c.ops && c.ops[field] !== undefined) return c.ops[field];
  return fallback;
}

/* THE SECOND BOUND
   A range needs two values where every other comparison needs one. It is stored
   under a derived key in the same per-field map — "gpa" holds the low bound
   and "gpa:max" the high one — which means no change to the criterion
   shape, no change to the save format, and no change to setCfg: a control named
   `crit.0.value:gpa:max` already routes to values['gpa:max'] through
   the parser that was there.

   Keeping the low bound under the plain key is what makes switching operators
   feel continuous. "At least 70" then "between" carries the 70 in as the floor,
   rather than resetting to a default the user has to retype. */
function rangeKey(field) { return field + ':max'; }

/* The high bound defaults to the top of a declared order, and to the low bound
   where there is no top to reach for. Both are shown in the panel and stated in
   the hint, so neither default is a surprise the user discovers from an empty
   result. */
function critHigh(c, field, col) {
  if (c.values && c.values[rangeKey(field)] !== undefined) return c.values[rangeKey(field)];
  if (col && col.order && col.order.length) return String(col.order[col.order.length - 1]);
  if (col && col.values && col.values.length) return String(col.values[col.values.length - 1]);
  return critValue(c, field, col);
}

/* The pair, ranked and put the right way round. A user who types the bounds in
   the other order means the band between them: refusing, or returning nothing,
   would be a technicality rather than an answer. The log prints what was
   actually applied, so the swap is visible rather than silent. */
function critRange(c, field, col) {
  var rankOf = rankerFor(col);
  var loRaw = critValue(c, field, col);
  var hiRaw = critHigh(c, field, col);
  var lo = rankOf(loRaw), hi = rankOf(hiRaw);
  var swapped = lo !== null && hi !== null && lo > hi;
  return swapped
    ? { lo: hi, hi: lo, loRaw: hiRaw, hiRaw: loRaw, swapped: true }
    : { lo: lo, hi: hi, loRaw: loRaw, hiRaw: hiRaw, swapped: false };
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
  if (key.indexOf('column:') === 0) {
    /* Stored as the list of keys to KEEP, resolved against the header that is
       actually arriving. That is why the schema is recomputed here rather than
       read from a cached list: the first untick has to turn "everything" into
       an explicit set, and only the live header knows what everything is. */
    var ck = key.slice(7);
    var head = inputSchema(n, computeSchemas());
    var all = head.columns.map(function(c){ return c.key; });
    var cur = Array.isArray(n.cfg.cols)
      ? all.filter(function(k){ return n.cfg.cols.indexOf(k) !== -1; })
      : all.slice();
    var cAt = cur.indexOf(ck);
    if (value && cAt === -1) cur.push(ck);
    if (!value && cAt !== -1) cur.splice(cAt, 1);
    if (!cur.length) return;   // the panel disables the last box; this is the backstop
    // Stored in header order, not tick order, so unticking and re-ticking a box
    // puts the column back where it was rather than at the end.
    n.cfg.cols = all.filter(function(k){ return cur.indexOf(k) !== -1; });
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
/* Ids wired into a node, optionally restricted to one port. Called without a
   port it answers "everything upstream of this node", which is what the config
   panels and the colour picker want; called with one it answers "what is on
   this input", which is what the evaluator and the schema pass want. */
function inputsOf(nodeId, portKey) {
  return wiresInto(nodeId, portKey).map(function(c){ return c.from; });
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

/* Deleting a Source deletes what it was holding. Node ids are handed out by a
   counter that resets on load, so leaving the data behind would let a later
   node inherit a cohort it was never given — and in the meantime its rows would
   still be feeding the registries from nowhere. */
function forgetSourceData(id) {
  delete SOURCE_DATA[id];
  delete PENDING_HEADERS[id];
  delete SOURCE_NOTICE[id];
}

function removeNode(id) {
  nodes = nodes.filter(function(n){ return n.id !== id; });
  connections = connections.filter(function(c){ return c.from !== id && c.to !== id; });
  selection = selection.filter(function(x){ return x !== id; });
  forgetSourceData(id);
  rebuildRegistries();
  markStale();
  render();
}

function clearAll() {
  // Clearing the canvas clears the data with it: the Sources that held it are
  // about to stop existing, and leaving it behind would leak a cohort into the
  // registries with no node on screen accounting for it.
  clearAllSourceData();
  nodes = []; connections = []; edgeColorIndex = 0;
  exportData = {}; resultsFresh = false;
  // Clear starts a new query, so the name of the old one should not follow it
  // into the next Save dialog.
  lastQueryName = '';
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
/* `between` takes three operands where every other comparison takes two. Rather
   than give it a different calling convention, every call site passes three and
   the binary functions ignore the one they do not want — JavaScript drops extra
   arguments, so `OP_FNS.gt(a, lo, hi)` is still `a > lo`. One call shape for
   every operator is what keeps applyCriterion free of a special case.

   The bounds are inclusive at both ends. "Between 70 and 80" asks a question
   about a band of marks, and a band that silently excluded 80 would be wrong in
   the way that is hardest to notice — the count is nearly right. */
OP_FNS.between = function(a, lo, hi) { return a >= lo && a <= hi; };

var OP_SYM = { gt:'>', gte:'>=', lt:'<', lte:'<=', eq:'=', ne:'!=', between:'in' };

/* What the operator dropdown says, where that differs from what the log says.
   A log line wants the terse form — "gpa in [5 .. 7]" reads well — but a
   control has to be findable, and "in" sitting last among six comparator
   symbols was not: it looks like a seventh comparator, and gives no hint that
   it is the one operator needing two values. The dropdown says so in words. */
var OP_LABEL = { between: 'in range' };
function opLabel(o) { return OP_LABEL[o] || OP_SYM[o] || o; }

/* The comparators are one idea and the range is another, so the dropdown says
   that too. A group heading is the cheapest way to make an option findable by
   someone who does not already know it is there — and the field selector above
   already groups its own options the same way, so the pattern is not new. */
function opGroups(ops) {
  var cmp = ops.filter(function(o){ return o !== 'between'; });
  var rng = ops.filter(function(o){ return o === 'between'; });
  return [{ label:'Compare', ops:cmp }, { label:'Range', ops:rng }]
    .filter(function(g){ return g.ops.length; });
}
var NUM_OPS  = ['gt','gte','lt','lte','eq','ne','between'];
var ENUM_OPS = ['eq','ne'];
/* An ordered category — a year, a letter grade — compares the same way a number
   does once its values are ranked, so it gets the range operator too. It does
   not get < and >, which would read as arithmetic on something that is not a
   number. */
var ORDERED_OPS = ['eq','ne','between'];

/* WHICH COLUMNS CAN CARRY A RANGE
   A range needs a meaningful order, and "has a declared list of values" is not
   the same thing as "is ordered". Sort treats any ENUM's declared values as an
   order, which is defensible there — some order beats lexical order, and the
   user can see the result. A range is a claim: "between Cybersecurity and Data
   Science" would look like a question and mean nothing, because the order it
   ranges over is the order somebody happened to type the list in.

   So a range is offered where the order is real:
     - a number, which is ordered by being a number;
     - a column with an explicit `order`, which is a deliberate statement about
       ranking (letterGrade declares GRADE_ORDER, best to worst);
     - an ENUM whose values are all numeric, which is how Year arrives — the
       supervisor's use cases group by year ranges, and Year is an ENUM because
       its values are a small fixed set, not because they are unordered.

   Gender and Specialisation therefore have no range, and gain one the day
   somebody declares what their order means. */
function numericValues(vals) {
  return !!(vals && vals.length) && vals.every(function(v) {
    return v !== '' && v !== null && isFinite(Number(v));
  });
}

function isRangeable(col) {
  if (!col) return false;
  if (col.type === COLTYPE.NUMBER) return true;
  if (col.order && col.order.length) return true;
  return col.type === COLTYPE.ENUM && numericValues(col.values);
}

/* A cell to a position on that order, so one comparison serves all three cases.
   Numbers rank as themselves; a declared order ranks by index. A value absent
   from a declared order has no position, so it cannot be inside any band — the
   same reading comparatorFor() takes, where an undeclared value sorts last. */
function rankerFor(col) {
  if (col && col.order && col.order.length) {
    var rank = {};
    col.order.forEach(function(v, i){ rank[String(v)] = i; });
    return function(v) {
      var r = rank[String(v)];
      return r === undefined ? null : r;
    };
  }
  return function(v) {
    /* Blank first, because Number('') is 0. Without this an upper bound the
       user had cleared ranked as zero rather than as missing, the bounds were
       then put "the right way round", and "between 70 and (nothing)" quietly
       became "between 0 and 70" — a different question, answered confidently,
       with a log line reading "[ .. 70]" as the only clue. */
    if (isBlank(v)) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  };
}

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

/* SOURCE
   Reads THIS node's dataset, not a global one. A Source with no files is not an
   empty result but an error: an empty table would travel down the graph and
   come out as "0 students", which is a claim about the cohort rather than about
   the tool, and the two are not the same answer.

   The log names the files as well as the population, because a query that was
   run against last year's export and one run against this year's are different
   queries with the same graph, and the log is the record of what was run. */
function sourceTable(node, log) {
  var cfg = node.cfg || defaultCfg('source');
  var data = datasetFor(node);
  if (!data) return { error: sourceDataError(node) };

  var pop = cfg.pop || 'all';
  var list = data.students;
  if (pop !== 'all') {
    var yr = parseInt(pop, 10);
    list = list.filter(function(s){ return s.year === yr; });
    log.push(logEntry('SOURCE', [{s:'year'}, {c:'op', s:'='}, {c:'val', s:yr}]));
  } else {
    log.push(logEntry('SOURCE', [{s:'all_students'}]));
  }
  if (data.files && data.files.length) {
    log.push(logEntry('FROM', data.files.map(function(f, i) {
      return { c:'val', s: f.name + (i === data.files.length - 1 ? '' : ',') };
    })));
  }
  return { table: studentsTable(list) };
}

/* Why this Source cannot run, in the terms the user is in a position to act on.
   A query loaded from a file knows which files it wants and says so; one built
   from scratch does not, and asking for "the data files" is as specific as it
   can honestly be. */
function sourceDataError(node) {
  var want = node.cfg && node.cfg.dataset;
  var named = want && want.headers && want.years && want.years.length
    ? ' This query was built against ' + want.headers + ' and ' +
      want.years.map(function(y){ return 'mcs-students-' + y; }).join(', ') + '.'
    : '';
  return 'Source #' + node.id + ' has no data. Open its panel and load ' +
    DATA_HEADERS_NAME + ', then the year files.' + named;
}

/* ROW IDENTITY AND UNION
   schemaKey and rowKey say when two tables have the same shape and when two
   rows are the same thing. Identity is per-granularity: two branches that both
   contain student 1042 hold one student, not two.

   unionTables is no longer on the evaluation path. It was the implicit merge —
   several wires into one node, silently deduplicated — and input ports removed
   the situation that called it: an ordinary node takes one table, and a node
   that takes several is a Combine, which decides its own semantics. It is kept
   because the two key functions are shared with Combine's dedupe option and
   because the deduplicating union is still a meaningful operation to have
   available; nothing calls it today. */
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
      // Sources are all one shape now, so a mismatch here means the branches
      // were reshaped on the way down — by an Aggregate, or a Unique in
      // single-column mode. Name that rather than the Source.
      return { error: 'Merged inputs have different columns. The branches were ' +
        'reshaped differently on their way here — make them match before merging, ' +
        'or give them separate Outputs.' };
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
    /* Named the same way, and a NUMBER rather than a set, so the operators come
       with it: "took a course at level 400" is the equality case, and "at 300
       or above" — the progression question — is the one that needed the
       ordering. Without this, asking it at student granularity means a Project
       first, which changes what a row is and therefore what a count counts. */
    { key:'courses.level',   label:'Took level',     kind:'courseLevel' },
    { key:'courses.gradePoints', label:'Grade in course', kind:'courseGrade' }
  ];
}

/* A column can opt out of being filterable with `filter: false`. Year used to:
   the Source already scopes the population by year, and offering it twice
   invited a graph that says 2022 in one place and 2023 in another.

   That reasoning no longer holds. Grouping by a column means filtering on it
   once per label — "how many in 2022, how many in 2023" is a filter for each
   year — so a column that cannot be filtered cannot be grouped on either. Year
   is the column four of the supervisor's use cases group by: enrolment trend
   for a course, average enrolment over several years, historical enrolment for
   a major, and grade trend for a student. Withholding it from Filter withheld
   it from all of them.

   The double-specification worry is answered by precedence rather than by
   removal: the Source's year setting scopes the population and a Filter narrows
   what the Source produced, so a graph saying 2022 at the Source and 2023 at a
   Filter yields nothing — which is the honest answer to a contradictory query,
   and visible in the log, where both entries appear in order.

   The opt-out itself stays. It is a property of a column rather than a rule
   about years, and the next column that has no sensible filter — a nested or
   derived one — declares it without any code changing. Nothing declares it
   today. */
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

function opsFor(kind, col) {
  if (kind === COLTYPE.NUMBER || kind === 'courseGrade' || kind === 'courseLevel') return NUM_OPS;
  // Passed the column where there is one, because whether a category can carry
  // a range is a property of that column rather than of its type.
  if (isRangeable(col)) return ORDERED_OPS;
  return ENUM_OPS;
}
function defaultOpFor(kind) {
  if (kind === COLTYPE.NUMBER || kind === 'courseGrade') return 'gt';
  // Levels are a handful of small integers, so the common question is "did they
  // take one at THIS level" rather than "above it" — the ordering is there when
  // it is wanted, but equality is the honest default.
  if (kind === 'courseLevel') return 'eq';
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
               (f.kind === 'courseSubject' ? defaultSubject() : defaultCourse());
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

  /* Keeps a STUDENT who took at least one course matching the test, with all
     their enrolments intact — the same row semantics "Took subject" has, and
     the reason these are named for what they do to a row. A student who took a
     100-level and a 400-level course satisfies both "level = 1" and
     "level = 4", because they genuinely did both. */
  if (f.kind === 'courseLevel') {
    if (coursesIdx === -1) return { table: t };
    var lvlCol = { def: String(defaultLevel() || 4) };
    var lop = critOp(c, f.key, 'eq');
    var lrange = critRange(c, f.key, lvlCol);
    var lfn = OP_FNS[lop] || OP_FNS.eq;

    if (lop === 'between' && (lrange.lo === null || lrange.hi === null)) {
      return { error: 'A level range needs a number at both ends.' };
    }
    if (lop !== 'between' && isNaN(parseFloat(critValue(c, f.key, lvlCol)))) {
      return { error: 'Course level must be a number.' };
    }
    var lwant = parseFloat(critValue(c, f.key, lvlCol));

    var lrows = t.rows.filter(function(r) {
      return (r[coursesIdx] || []).some(function(e) {
        if (e.level === null || e.level === undefined) return false;
        return lop === 'between'
          ? (e.level >= lrange.lo && e.level <= lrange.hi)
          : lfn(e.level, lwant);
      });
    });

    log.push(logEntry('FILTER', lop === 'between'
      ? [{s:'student'}, {c:'op', s:'took'}, {s:'level'},
         {c:'op', s:'between'}, {c:'val', s:lrange.loRaw}, {s:'and'}, {c:'val', s:lrange.hiRaw}]
      : [{s:'student'}, {c:'op', s:'took'}, {s:'level'},
         {c:'op', s:OP_SYM[lop] || lop}, {c:'val', s:lwant}]));
    return { table: makeTable(t.columns, lrows) };
  }

  if (f.kind === 'courseGrade') {
    // Two conditions in one: enrolled in the course AND the mark passes. A
    // student who never took it is excluded rather than treated as zero, which
    // would silently satisfy every "less than" test.
    if (coursesIdx === -1) return { table: t };
    var code = c.course || defaultCourse();
    var num = parseFloat(critValue(c, f.key, { def:'5' }));
    if (isNaN(num)) return { error: 'Course mark must be a number.' };
    var op = critOp(c, f.key, 'gte');
    var fn = OP_FNS[op] || OP_FNS.gte;
    /* The mark field offers the numeric operators, and `between` is now one of
       them, so the upper bound has to be read here too. Without it the range
       would compare against an undefined ceiling and quietly match nobody —
       the worst way for an unsupported combination to fail, because it looks
       like an answer. */
    var hi = num;
    if (op === 'between') {
      hi = parseFloat(critHigh(c, f.key, { def:'5' }));
      if (isNaN(hi)) return { error: 'Course grade range needs two grade points.' };
      if (hi < num) { var tmp = num; num = hi; hi = tmp; }
    }
    var mrows = t.rows.filter(function(r) {
      var list = r[coursesIdx] || [];
      for (var i = 0; i < list.length; i++) {
        // An ungraded enrolment answers no comparison — not "below", which is
        // what a null coerced to 0 would silently claim.
        if (list[i].code === code) {
          var gp = gradePoint(list[i].letterGrade);
          return gp === null ? false : fn(gp, num, hi);
        }
      }
      return false;
    });
    log.push(logEntry('FILTER', [
      {s:'student'}, {c:'op', s:'took'}, {s: code + '.gradePoints'},
      {c:'op', s:(OP_SYM[op] || '>=')},
      {c:'val', s:(op === 'between' ? '[' + num + ' .. ' + hi + ']' : num)}
    ]));
    return { table: makeTable(t.columns, mrows) };
  }

  var idx = colIndex(t, f.key);
  var col = f.column;
  var opk = critOp(c, f.key, defaultOpFor(f.kind));
  var fnc = OP_FNS[opk] || OP_FNS.eq;
  var raw = critValue(c, f.key, col);

  /* One branch for both kinds of range. rankerFor() turns a cell into a
     position — itself for a number, its index for a declared order — so
     "between 70 and 80" and "between A+ and B" are the same comparison on
     different rankings, rather than two implementations that could disagree
     about whether the ends are included. */
  if (opk === 'between') {
    var rng = critRange(c, f.key, col);
    if (rng.lo === null || rng.hi === null) {
      return { error: col.type === COLTYPE.NUMBER
        ? col.label + ' range needs two numbers.'
        : col.label + ' range needs two values from the column.' };
    }
    var rankOf = rankerFor(col);
    var brows = t.rows.filter(function(r) {
      // A value with no position cannot be inside any band. For a declared
      // order that means a value nobody declared, which is the same reading
      // comparatorFor() takes when it sorts such a value last.
      var v = rankOf(r[idx]);
      return v !== null && fnc(v, rng.lo, rng.hi);
    });
    log.push(logEntry('FILTER', [
      {s:col.key}, {c:'op', s:'in'},
      {c:'val', s:'[' + rng.loRaw + ' .. ' + rng.hiRaw + ']'}
    ]));
    return { table: makeTable(t.columns, brows) };
  }

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
   no longer there — rewire a Source from students to enrolments and 'gpa'
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

/* REVERSE
   Flips row order. Its reason for existing is Take: Take deliberately keeps the
   FIRST N rows and does not rank, so "the last N" and "the bottom 10" had no
   expression at all. Sort, Reverse, Take says it in three nodes that each do
   one thing, rather than growing Take a direction setting that would duplicate
   what Sort already decides.

   Sort with the direction flipped covers most of the same ground, but not all
   of it: reversing needs no column, so it works on a table whose order came
   from somewhere other than a sort — the order rows arrived from a Combine, or
   the order a Compare's branches were wired in. Those have no key to sort on.

   Like Take it is a pure row operation: no column is added, removed, renamed or
   retyped, so the outgoing header is the incoming header and the schema pass
   needs nothing but passthroughSchema.

   meta is carried through for the same reason Sort and Take carry it — the rows
   are the same rows in a different order, so whatever a producer upstream
   recorded about them is still true.                                          */
function applyReverse(node, t, log) {
  var n = t.rows.length;
  log.push(logEntry('REVERSE', n
    ? [{s:'row order of'}, {c:'val', s:n}, {s:'rows'}]
    : [{s:'no rows to reverse'}]));
  /* slice() first: reverse() is in place, and one node's result object is read
     by every node wired downstream of it, so reversing t.rows directly would
     reorder a sibling branch's data as a side effect. Sort guards the same way
     and for the same reason — the bug would only show up on graphs that fork. */
  return makeTable(t.columns, t.rows.slice().reverse(), t.meta);
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

/* ============================================================================
   UNIQUE
   ============================================================================
   Removes duplicates. A Reduction in the supervisor's categorisation, sitting
   beside Filter and Take: fewer rows out than in, nothing invented.

   Two modes, and the second is the one his example asks for. "It could be used
   to produce all available course labels from a multiplicity of course grade
   rows" cannot be done by deduplicating whole rows — every enrolment row
   differs in its mark, so nothing would be removed. Getting course labels means
   reducing to the course column first and then deduplicating that. So:

     all columns  — a row survives if no identical row came before it. The
                    header is untouched.
     one column   — the table is reduced to that column, then deduplicated. The
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
   provides it — and preserving arrival order means a label list keeps whatever
   order its source imposed, which a declared column order can then carry
   through.                                                                   */

/* Columns offered as the single-column selector. A nested enrolment cell is not
   a label — "all distinct values of Courses" would be a list of arrays — so the
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
   equal instead of being distinguished by array identity — which would make
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
                                 {s:'— not a column in this table'}]));
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
   SELECT — choose which columns travel on
   ============================================================================
   Aggregate used to do two things at once: measure a column, and leave that
   column as the only one in the result. Measuring is Aggregate's job. The
   narrowing is not, and bundling them meant there was no way to narrow a table
   without also collapsing it to a single row.

   Select is the narrowing on its own. Rows are untouched — same rows, same
   order, same count — and only the header changes. That makes the two
   composable: Select then Aggregate measures a column of a narrowed table, and
   Select alone answers "just show me these three columns" without summarising
   anything.

   Column order follows the incoming table, not the order the boxes were
   ticked. Choosing columns and ordering them are different questions, and
   ticking order is invisible once the panel is closed — a user who unticks a
   box and ticks it again would otherwise find that column had silently moved to
   the end. If column order is wanted later it should be its own control, where
   it can be seen and changed deliberately.                                    */

/* Resolved against the arriving table rather than trusted from config, the same
   way Aggregate resolves its measure column. A saved key outlives its column
   easily — rewiring the node behind a different branch is enough — and a config
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
    // Nothing dropped. Return the same table rather than a copy, so meta —
    // which describes the rows, and the rows have not changed — survives.
    log.push(logEntry('SELECT', [{s:'all'}, {c:'val', s:keep.length},
                                 {s:'columns — nothing dropped'}]));
    return t;
  }

  var idx = keep.map(function(c){ return colIndex(t, c.key); });
  var rows = t.rows.map(function(r) {
    return idx.map(function(i){ return r[i]; });
  });

  var dropped = t.columns.length - keep.length;
  log.push(logEntry('SELECT', [{s:'keep'},
    {c:'val', s:keep.map(function(c){ return c.label; }).join(', ')},
    {s:'— ' + dropped + ' column' + (dropped === 1 ? '' : 's') + ' dropped'}]));

  /* meta is dropped even though the rows are unchanged. A Compare's branch
     metadata holds whole branch tables with the old header, so carrying it past
     a narrowing would leave the summary and its branches disagreeing about what
     columns exist. Compare cannot currently feed a Select, so this costs
     nothing today and is correct if that ever changes. */
  return makeTable(keep, rows);
}

var MEASURES = [
  { key:'count',   label:'Students',       head:'Students'  },
  { key:'average', label:'Avg grade',      head:'Avg grade' },
  { key:'share',   label:'Share of total', head:'Share'     }
];
var DEFAULT_MEASURES = ['count', 'average'];

function measuresOf(node) {
  var m = node.cfg && node.cfg.measures;
  // Array.isArray, not a truthy length check: a string has .length, and a
  // loaded file with measures:"count" would silently yield zero columns.
  return Array.isArray(m) ? m : DEFAULT_MEASURES;
}

/* Which column "average" refers to, chosen from the table rather than assumed.
   gpa on a student table, gradePoints on an enrolment table, otherwise the
   first numeric column that is not an identifier. */
function defaultAvgCol(t) {
  if (hasCol(t, 'gpa')) return 'gpa';
  if (hasCol(t, 'gradePoints')) return 'gradePoints';
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
      share:   total ? (b.table.rows.length / total) * 100 : 0
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
   Every Output emits a table, including Count — a scalar is a 1x1 table. That
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

function compareFeedsOutput(node) {
  return inputsOf(node.id).some(function(id) {
    var up = findNode(id);
    return up && up.type === 'compare';
  });
}

// The two sides no longer share a value, so rewiring an Output across a Compare
// always lands on that side's nearest equivalent: rows and per-branch lists both
// mean "show me the data", count and summary both mean "show me the figures".
function normaliseShow(node) {
  var v = node.cfg && node.cfg.show;
  if (compareFeedsOutput(node)) {
    if (CMP_SHOWS.indexOf(v) !== -1) return v;
    return (v === 'rows') ? 'lists' : 'summary';
  }
  if (ROW_SHOWS.indexOf(v) !== -1) return v;
  return (v === 'lists') ? 'rows' : 'count';
}

/* COLUMN SELECTION ON AN OUTPUT
   ---------------------------------------------------------------------------
   A deliberate duplication of what Select does, and worth being explicit about
   why, because the Output's other shortcuts were removed for being exactly
   this. Average and the course breakdown were removed because they COMPUTED —
   they hid steps that changed the answer, and hid them somewhere the query log
   could not describe. Choosing which columns to look at changes no answer. It
   is a property of the view, which is what an Output is.

   The supervisor put it as a question: one could always wire a Select in front,
   but so many Outputs would need the pair that the duplication earns its place.
   Both routes stay open, and they compose — a Select upstream narrows what
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
   PROJECT — unfold the nested enrolments into rows of their own
   ============================================================================
   The one node that makes a row mean something different on the way out than it
   meant on the way in. Everywhere else a row is a student; after a Project a row
   is a single enrolment, so one student becomes eight rows and a count counts
   course registrations rather than people.

   That used to be a setting on the Source — "one per student" or "one per
   enrolment" — and it was removed because a granularity switch hidden in a
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
       longer identifies a row — the same student now owns eight of them;
     - its panel states the multiplication, and says what it does to a count.

   Without it, nothing in the tool can reach a mark or a grade in a particular
   course as a VALUE. Filter can already ask "did this student take SWEN421",
   because it reads inside the nesting, but the mark itself can never become a
   column, so a distribution of grades in one course is unaskable. That is use
   case (f), and (g) on top of it.

   The header is a function of the incoming header alone — the enrolment columns
   are fixed, and which student columns come across is decided by their keys —
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
       study — which is what use cases (h) and (i) have been waiting on. */
    { key:'level',       label:'Level',       type:COLTYPE.NUMBER, def:'4' },
    { key:'points',      label:'Points',      type:COLTYPE.NUMBER, def:'15' },
    { key:'gradePoints', label:'Grade points',type:COLTYPE.NUMBER, def:'5' },
    { key:'letterGrade', label:'Grade',       type:COLTYPE.TEXT,   order:GRADE_ORDER }
  ];
}

/* Whether this node has anything to do. A table with no nested column has
   nothing to unfold, and a Project wired behind an Aggregate is a mistake worth
   reporting rather than an error worth stopping for — the same treatment a
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

function applyProject(node, t, log) {
  if (!canProject(t)) {
    log.push(logEntry('PROJECT', [{s:'nothing to expand — no course data on this table'}]));
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
         nothing. Same failure studentsTable() had, same fix — the column list
         is the single statement of what a row holds. */
      rows.push(prefix.concat(eKeys.map(function(k){ return e[k]; })));
    });
  });

  /* The row count is the message. Saying "80 rows -> 640 rows, one per course"
     in the log puts the multiplication in the same place every other step
     reports itself, so a count that looks eight times too large downstream has
     an explanation one line above it. */
  log.push(logEntry('PROJECT', [
    {c:'val', s:t.rows.length}, {s:'rows'}, {c:'op', s:'->'},
    {c:'val', s:rows.length}, {s:'rows, one per course'}
  ]));

  var replaced = t.columns.filter(function(c) {
    return c.type !== COLTYPE.COURSES && carry.indexOf(c) === -1;
  });
  if (replaced.length) {
    log.push(logEntry('PROJECT', [{s:'replaced by course values:'},
      {c:'val', s:replaced.map(function(c){ return c.label; }).join(', ')}]));
  }
  return makeTable(cols, rows);
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
  if (opKey === 'median') {
    /* Sorted numerically — the default sort is lexical, which puts 100 before
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
   trusted from config. A saved key can outlive its column — rewiring the node
   behind a different branch is enough — so this falls back rather than
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
   first is a Select, which is a node that exists — so the composition is
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

/* Merge adds vertically: more rows, same columns. Join adds horizontally: same
   rows or fewer, more columns. Intersect and difference are the set operations
   on rows. All four are one node because they all answer "these branches should
   become one table" and differ only in how — putting the horizontal case in a
   node of its own would have meant two nodes with the same two input ports, the
   same base picker and the same key column, differing in one line. */
var COMBINE_MODES = [
  { key:'merge',      label:'Merge (stack rows)' },
  { key:'join',       label:'Join (add columns)' },
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

/* The permutation that puts the chosen base first, as positions rather than as
   reordered tables. Reordering the tables directly was enough while the base
   was the only thing position meant; join has to reorder two parallel lists —
   the tables, and the upstream labels that name their columns — and deriving
   both from one permutation is what stops them drifting out of step.

   Done here rather than inside combineTables so the reduction itself has one
   rule, "the base is tables[0]", and the mapping from a node id to a position
   stays with the node ids. */
function combineOrder(node, inIds) {
  var baseId = combineBaseId(node, inIds);
  var at = -1;
  for (var i = 0; i < inIds.length; i++) if (inIds[i] === baseId) { at = i; break; }
  var idx = inIds.map(function(_, i){ return i; });
  if (at <= 0) return idx;
  return [at].concat(idx.filter(function(i){ return i !== at; }));
}

/* The name a joined column carries when it has to say where it came from. */
function combineInputLabel(id) {
  var up = findNode(id);
  return up ? upstreamLabel(up) : ('Input ' + id);
}

/* ---- Join: the horizontal combination ------------------------------------ */

/* The joined header. The base contributes every column it has. Each other input
   contributes everything except the key, which is shared rather than repeated.

   A clash is renamed rather than overwritten: two branches off one Source both
   carry Year, and silently dropping the second would lose data while silently
   overwriting the first would lose different data. The incoming key gets a
   suffix and the label says which node it came from, so the header stays unique
   — which matters beyond the screen, since these become CSV column names.

   Derived from headers alone so the schema pass and the evaluator can call the
   same function and cannot disagree about the result's shape. */
function joinColumns(node, heads, labels) {
  if (!heads.length) return [];
  var base = heads[0];
  var keyCol = combineKeyCol(node, base);
  var cols = base.columns.slice();
  var used = {};
  cols.forEach(function(c){ used[c.key] = true; });

  heads.slice(1).forEach(function(h, i) {
    h.columns.forEach(function(c) {
      if (keyCol && c.key === keyCol.key) return;
      var key = c.key, n = 2;
      while (used[key]) { key = c.key + '_' + n; n++; }
      used[key] = true;
      cols.push({
        key: key,
        label: (key === c.key) ? c.label : (c.label + ' \u00b7 ' + (labels[i + 1] || 'input ' + (i + 2))),
        type: c.type, values: c.values, order: c.order, def: c.def, filter: c.filter
      });
    });
  });
  return cols;
}

function joinTables(node, tables, labels, log) {
  var base = tables[0];
  var keyCol = combineKeyCol(node, base);
  if (!keyCol) {
    return { error: 'Join matches rows on a key column, and this table has none that can be used. ' +
      'Every column here is either nested or absent.' };
  }
  for (var i = 1; i < tables.length; i++) {
    if (!hasCol(tables[i], keyCol.key)) {
      return { error: 'Join is matching rows on ' + keyCol.label + ', but ' +
        (labels[i] || 'another input') + ' has no such column. ' +
        'Pick a key column that every input carries.' };
    }
  }

  var cols = joinColumns(node, tables, labels);
  var keepUnmatched = !!(node && node.cfg && node.cfg.keepUnmatched);

  /* Each other input is indexed by key, first row winning. The alternative —
     a row out per matching pair, which is what a relational join does — turns a
     key with repeats into a multiplication: joining two 400-row tables on Year
     would produce 160,000 rows from a single dropdown change. Looking up one
     match keeps the output the size of the base, which is the shape the user is
     looking at when they wire it. Repeats are reported rather than silently
     resolved, so a badly chosen key says so instead of just being wrong. */
  var dupeIn = [];
  var index = tables.slice(1).map(function(t, i) {
    var ki = colIndex(t, keyCol.key), map = {}, dup = 0;
    t.rows.forEach(function(r) {
      var k = 'k' + String(r[ki]);
      if (map[k] === undefined) map[k] = r; else dup++;
    });
    if (dup) dupeIn.push((labels[i + 1] || 'input ' + (i + 2)) + ' (' + dup + ')');
    return { t: t, map: map };
  });

  var bi = colIndex(base, keyCol.key);
  var rows = [], unmatched = 0;

  base.rows.forEach(function(r) {
    var k = 'k' + String(r[bi]);
    var extra = [], miss = false;
    index.forEach(function(ix) {
      var hit = ix.map[k];
      if (!hit) miss = true;
      ix.t.columns.forEach(function(c, ci) {
        if (c.key === keyCol.key) return;
        extra.push(hit ? hit[ci] : null);
      });
    });
    if (miss) {
      unmatched++;
      if (!keepUnmatched) return;
    }
    rows.push(r.concat(extra));
  });

  log.push(logEntry('COMBINE', [{s:'join on'}, {c:'val', s:keyCol.label}, {s:'\u2192'},
    {c:'val', s:rows.length}, {s:'rows,'}, {c:'val', s:cols.length}, {s:'columns'}]));
  if (unmatched) {
    log.push(logEntry('COMBINE', [{s:(keepUnmatched ? 'kept' : 'dropped')},
      {c:'val', s:unmatched}, {s:'base row(s) with no match' + (keepUnmatched ? ' — blank cells' : '')}]));
  }
  if (dupeIn.length) {
    log.push(logEntry('COMBINE', [{s:'repeated keys in'}, {c:'val', s:dupeIn.join(', ')},
      {s:'\u2014 first match used'}]));
  }

  // meta describes the base's rows against the base's header, which the join has
  // widened. Dropped for the same reason Select drops it.
  return { table: makeTable(cols, rows) };
}

function combineTables(node, tables, log, labels) {
  if (!tables.length) return { table: makeTable([], []) };
  labels = labels || [];
  var mode = combineMode(node);

  /* Matching headers are required by the three modes that work on rows, because
     a row from one input has to be a row of the other's table too. Join is the
     one mode where differing headers are the point, so the check is scoped to
     the modes it describes rather than applied to the node. */
  if (mode.key !== 'join') {
    var first = schemaKey(tables[0]);
    for (var i = 1; i < tables.length; i++) {
      if (schemaKey(tables[i]) !== first) {
        return { error: 'Combine needs inputs with the same columns for ' + mode.key + '. ' +
          'These inputs have different headers, so their rows cannot be stacked — ' +
          'make the branches produce the same columns, or switch the mode to ' +
          'Join to put their columns side by side instead.' };
      }
    }
  }

  if (tables.length === 1) {
    log.push(logEntry('COMBINE', [{s:'one input — passed through'}]));
    return { table: tables[0] };
  }

  if (mode.key === 'join') return joinTables(node, tables, labels, log);

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

     schema   — (node, inSchema, ctx) -> table of columns, no rows. The header
                this node produces, derived from the header it is given.
                inSchema is the header on the node's primary port; ctx.port(key)
                reaches the others, which is what a two-input node needs.
     rows     — (node, table, log) -> table | {error}. The ordinary path: one
                table in, one table out. Omitted by nodes that pass their rows
                through untouched.
     evaluate — (node, ctx) -> {table, error, hasSource}. For nodes that read
                their inputs separately rather than taking one table: Source
                (no inputs), Combine and Compare (many).

   `merges` is gone. It meant "union this node's inputs before running it", and
   that union is what a wire into an occupied port now prevents: a single-input
   node has one table, so there is nothing to reconcile and no way for rows to
   disappear into a silent deduplication. Nodes that genuinely take several
   tables declare a multi port and read them through ctx.

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
    // Every Source now emits the same shape — the rows in the file — so the
    // header is fixed rather than derived from anything.
    schema: function(node) {
      return headerOnly(makeTable(STUDENT_COLUMNS, []));
    },
    evaluate: function(node, ctx) {
      var out = sourceTable(node, ctx.log);
      if (out.error) return { error: out.error };
      return { table: out.table, hasSource: true };
    }
  },

  filter: {
    schema: passthroughSchema,
    rows: function(node, t, log) { return applyFilter(node, t, log); }
  },

  sort: {
    schema: passthroughSchema,
    rows: function(node, t, log) { return { table: applySort(node, t, log) }; }
  },

  reverse: {
    // Nothing to declare: same header out as in, and no config to read.
    schema: passthroughSchema,
    rows: function(node, t, log) { return { table: applyReverse(node, t, log) }; }
  },

  take: {
    schema: passthroughSchema,
    rows: function(node, t, log) { return { table: applyTake(node, t, log) }; }
  },

  unique: {
    // The first built node whose output header depends on its own config
    // rather than only on its input: naming a column narrows the header to
    // that column. Both walks call uniqueCol() on the columns they hold, so
    // they cannot disagree about which mode the node is in.
    schema: uniqueSchema,
    rows: function(node, t, log) { return { table: applyUnique(node, t, log) }; }
  },

  select: {
    // The only node that narrows the header without touching the rows, so both
    // halves of the registry contract come from selectedCols(): the schema pass
    // and the evaluator resolve the same keys against the same header and
    // cannot disagree about what comes out.
    schema: selectSchema,
    rows: function(node, t, log) { return { table: applySelect(node, t, log) }; }
  },

  project: {
    // The only node that changes what a ROW means. Its header still follows
    // from the incoming header alone — the enrolment columns are fixed and the
    // carried ones are chosen by key — so it needs no more of the registry than
    // any other node, however different its effect.
    schema: projectSchema,
    rows: function(node, t, log) { return { table: applyProject(node, t, log) }; }
  },

  aggregate: {
    schema: aggregateSchema,
    rows: function(node, t, log) { return { table: applyAggregate(node, t, log) }; }
  },

  aggregateColumns: {
    schema: aggregateColumnsSchema,
    rows: function(node, t, log) { return { table: applyAggregateColumns(node, t, log) }; }
  },

  aggregateRows: {
    // Header depends only on the chosen measure, never on the incoming columns,
    // so the schema walk knows it without looking at anything upstream.
    schema: aggregateRowsSchema,
    rows: function(node, t, log) { return { table: applyAggregateRows(node, t, log) }; }
  },

  combine: {
    /* One multi port. Where an ordinary node now refuses a second wire, this is
       the node that exists to accept it: stacking several tables is its job,
       and how they stack — merge, intersect, difference, dedupe or not — is its
       settings rather than a rule applied behind the user's back. Its header is
       whatever arrives, so the schema is the ordinary pass-through. */
    /* Pass-through for the three row modes: the header that arrives is the
       header that leaves. Join is the exception — the one mode that produces a
       header neither input had — so it builds one from every input on the port,
       through the same function the evaluator uses. */
    schema: function(node, inSchema, ctx) {
      if (combineMode(node).key !== 'join') return inSchema;
      var ids = inputsOf(node.id, 'in');
      var heads = ctx.at('in');
      if (heads.length < 2) return inSchema;
      var sperm = combineOrder(node, ids);
      return makeTable(joinColumns(node,
        sperm.map(function(i){ return heads[i]; }),
        sperm.map(function(i){ return combineInputLabel(ids[i]); })), []);
    },
    evaluate: function(node, ctx) {
      // The base is a node the user named, not the wire that happened to be
      // drawn first, so the tables are ordered before the reduction sees them —
      // and the labels ride the same permutation, so a renamed joined column
      // names the node it actually came from.
      var perm = combineOrder(node, ctx.inIds);
      var ctabs = perm.map(function(i){ return ctx.ins[i].table; });
      var clabels = perm.map(function(i){ return combineInputLabel(ctx.inIds[i]); });
      var out = combineTables(node, ctabs, ctx.log, clabels);
      return {
        table: out.table,
        error: out.error,
        hasSource: ctx.ins.some(function(r){ return r.hasSource; })
      };
    }
  },

  compare: {
    // The other multi port. Each branch becomes a row, so it reads the branch
    // results directly rather than receiving one table.
    schema: function(node) { return makeTable(compareColumns(measuresOf(node)), []); },
    evaluate: function(node, ctx) {
      return {
        table: buildCompare(node, ctx.inIds, ctx.res, ctx.log),
        hasSource: ctx.ins.some(function(r){ return r.hasSource; })
      };
    }
  },

  output: {
    /* An Output's result IS its input: outputTable() applies the chosen view at
       render time, not here, so neither the count reshaping nor the column
       narrowing is part of the graph. Nothing reads downstream of an Output —
       CONNECT_RULES gives it no outgoing edges — so the distinction costs
       nothing today, and passthroughSchema stays honest because no node ever
       asks what an Output produces.

       If an Output ever becomes chainable this is the entry that has to grow a
       real schema, and it is now a real piece of work rather than a formality:
       the header depends on the view AND on the column selection, so the answer
       is makeTable(outputTable(node, inSchema).columns, []). */
    schema: passthroughSchema
  }
};

function specFor(type) { return NODE_SPEC[type] || null; }

/* The context handed to spec.evaluate and spec.schema. One object serves both
   walks: `at(portKey)` returns what is on that port, whether "what" is a result
   or a header, so a node's two functions ask the same question in the same
   words. Nodes that only ever have one input never call it. */
function portContext(node, valueOf) {
  return function(portKey) {
    return inputsOf(node.id, portKey).map(valueOf).filter(Boolean);
  };
}

/* GRAPH EVALUATION
   Walks the DAG in topological order. Each node computes from its own inputs,
   so parallel branches stay independent.
   Returns {res: {nodeId: {table, log, hasSource}}} or {error}.

   The default path is now genuinely single-input: whatever is on the primary
   port is the table, with no union step to lose rows in. An empty port yields
   an empty table rather than an error, so a half-built graph still renders and
   still runs — the node simply has nothing to work on yet. */
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

    var ctx = {
      inIds: inIds,
      ins: ins,
      res: res,
      log: log,
      at: portContext(node, function(id){ return res[id]; })
    };

    if (spec.evaluate) {
      var ev = spec.evaluate(node, ctx);
      // A node that reads its inputs itself can fail the same way a row
      // transform can — Combine rejects mismatched headers — so the error has
      // to surface here too, rather than only on the spec.rows path.
      if (ev.error) return { error: ev.error };
      table = ev.table;
      hasSource = ev.hasSource;
    } else {
      var head = ctx.at(primaryPort(node.type))[0];
      table = head ? head.table : makeTable([], []);
      hasSource = !!(head && head.hasSource);

      if (spec.rows) {
        var out = spec.rows(node, table, log);
        if (out.error) return { error: out.error };
        table = out.table;
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
   every render because no row is ever touched.

   Both walks read the same registry and the same ports, so a node cannot
   describe one header here and produce another there, and cannot read a
   different input in the two passes either. */
function computeSchemas() {
  var order = topoSort();
  var out = {};
  order.forEach(function(node) {
    var spec = specFor(node.type);
    if (!spec) { out[node.id] = makeTable([], []); return; }
    var at = portContext(node, function(id){ return out[id]; });
    var head = at(primaryPort(node.type))[0];
    out[node.id] = headerOnly(spec.schema(node, head || makeTable([], []), { at: at }));
  });
  return out;
}

// The header a node's config panel should describe: what arrives, not what
// leaves. Reads the primary port, so a two-input node's panel describes its
// data rather than whichever wire happened to be drawn first. An unconnected
// node falls back to the student schema so its panel is still meaningful
// before anything is wired up.
function inputSchema(node, schemas, portKey) {
  var key = portKey === undefined ? primaryPort(node.type) : portKey;
  var ins = inputsOf(node.id, key).map(function(id){ return schemas[id]; }).filter(Boolean);
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
/* The archive names a course by code and never by title, so a loaded catalogue
   has name === code and there is nothing to append. Saying "AIML427" beats
   saying "AIML427 — AIML427", and the synthetic catalogue, which does carry
   titles, still gets both. One function, because the course dropdown and its
   tooltip must not disagree about how a course is written. */
function courseLabel(c) {
  if (!c) return '';
  return (c.name && c.name !== c.code) ? c.code + ' — ' + c.name : c.code;
}
function courseTitle(code) {
  var c = COURSE_BY_CODE[code];
  return c ? courseLabel(c) : String(code);
}

// Grouped by subject so a 31-course catalogue stays navigable and a longer real
// one degrades gracefully instead of becoming a single flat list.
function courseSelect(nodeId, key, cur) {
  var sel = cur || defaultCourse();
  var html = '<select class="course-sel" title="' + esc(courseTitle(sel)) + '"' + ctl(nodeId, key) + '>';
  SUBJECTS.forEach(function(subj) {
    var inSubj = COURSES.filter(function(c){ return c.subject === subj; });
    if (!inSubj.length) return;
    html += '<optgroup label="' + esc(subj) + '">';
    inSubj.forEach(function(c) {
      html += '<option value="' + c.code + '"' + (sel === c.code ? ' selected' : '') + '>' +
        esc(courseLabel(c)) + '</option>';
    });
    html += '</optgroup>';
  });
  return html + '</select>';
}

function opSelect(nodeId, key, ops, cur) {
  var groups = opGroups(ops);
  // Only worth grouping when there is something to separate. A field with no
  // range on offer gets a plain list, as before.
  var body = groups.length < 2
    ? ops.map(function(o){ return opt(o, cur, opLabel(o)); }).join('')
    : groups.map(function(g) {
        return '<optgroup label="' + esc(g.label) + '">' +
          g.ops.map(function(o){ return opt(o, cur, opLabel(o)); }).join('') +
        '</optgroup>';
      }).join('');
  /* Marked when the range is chosen so the row can give the control room for
     its longer label. "in range" will not fit the 38px column the comparator
     symbols live in, and the value box it would have shared that row with has
     moved into the band below anyway. */
  var wide = cur === 'between' ? ' class="op-wide"' : '';
  return '<select' + wide + ctl(nodeId, key) + '>' + body + '</select>';
}

/* One criterion row. Its shape follows the field's type, and the field list
   follows the incoming table — so this function knows nothing about students. */
/* THE RANGE BAND
   A range is the one criterion that needs a second value, and squeezing it into
   the same row as the first would leave three controls and two numbers fighting
   over 220px. It gets its own strip below the row instead, banded down the left
   the way a criterion is banded, so it reads as part of that criterion rather
   than as a new one — and coloured, so a filter carrying a band is visibly
   doing something different from one that is not.

   It exists only while `between` is the operator. Choosing it adds the band and
   choosing anything else takes it away, which is the whole of the "add it or
   not": there is no separate switch to get out of step with the operator.

   The colour is the one this interface already uses for a state worth noticing
   — the amber of the stale-results notice — rather than a new hue invented for
   one control. */
function rangeBandHTML(nid, ci, cur, c, renderBound) {
  var rng = critRange(c, cur.key, cur.column);
  var hiKey = 'crit.' + ci + '.value:' + rangeKey(cur.key);
  return '<div class="crit-range">' +
    '<span class="crit-range-tag">range</span>' +
    '<div class="crit-range-pair">' +
      renderBound('crit.' + ci + '.value:' + cur.key, rng.loRaw) +
      '<span class="crit-range-to">to</span>' +
      renderBound(hiKey, rng.hiRaw) +
    '</div>' +
    '<div class="crit-range-note">' +
      (rng.lo === null || rng.hi === null
        ? (cur.column && cur.column.type === COLTYPE.NUMBER
            ? 'Both ends have to be numbers. The query will not run until they are.'
            : 'Both ends have to be values this column holds.')
        : rng.lo === rng.hi
        /* The two bounds start equal on a plain number column, which has no
           declared span to open the band across. Saying so, and saying what to
           do, beats leaving the user to work out why a range behaves like an
           equals. */
        ? 'Both ends are ' + esc(String(rng.loRaw)) + ', so this keeps only ' +
          'rows equal to it. Change one end to widen the band.'
        : 'Keeps rows from ' + esc(String(rng.loRaw)) + ' to ' + esc(String(rng.hiRaw)) +
          ', both included.' + (rng.swapped ? ' (Bounds read the other way round.)' : '')) +
    '</div>' +
  '</div>';
}

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
        SUBJECTS.map(function(s){ return opt(s, critValue(c, cur.key, null) || defaultSubject()); }).join('') +
      '</select></div>';

  } else if (cur.kind === 'courseCode') {
    body = '<div class="criterion-controls stack">' + fieldSel +
      courseSelect(nid, vKey, critValue(c, cur.key, null) || defaultCourse()) + '</div>';

  } else if (cur.kind === 'courseLevel') {
    /* A select rather than a number box: the levels are the handful the loaded
       files actually contain, and offering a free number invites "level 7",
       which every file answers with nothing. */
    var lOp = critOp(c, cur.key, 'eq');
    var lvlDef = { def: String(defaultLevel() || 4) };
    var lvlBox = function(key, val) {
      return '<select' + ctl(nid, key) + '>' +
        (LEVELS.length ? LEVELS : [1, 2, 3, 4]).map(function(v) {
          return opt(String(v), String(val), v + '00-level');
        }).join('') + '</select>';
    };
    body = (lOp === 'between'
      ? '<div class="criterion-controls two-col">' + fieldSel +
          opSelect(nid, oKey, NUM_OPS, lOp) + '</div>' +
        rangeBandHTML(nid, ci, { key: cur.key, column: lvlDef }, c, lvlBox)
      : '<div class="criterion-controls">' + fieldSel +
          opSelect(nid, oKey, NUM_OPS, lOp) +
          lvlBox(vKey, critValue(c, cur.key, lvlDef)) +
        '</div>');

  } else if (cur.kind === 'courseGrade') {
    var mOp = critOp(c, cur.key, 'gte');
    var markBox = function(key, val) {
      return '<input type="number" min="0" max="9" value="' + esc(val) + '"' + ctl(nid, key) + '>';
    };
    body = '<div class="criterion-controls stack">' + fieldSel +
      courseSelect(nid, 'crit.' + ci + '.course', c.course) +
      (mOp === 'between'
        ? opSelect(nid, oKey, NUM_OPS, mOp)
        : '<div class="cc-pair">' + opSelect(nid, oKey, NUM_OPS, mOp) +
            markBox(vKey, critValue(c, cur.key, { def:'5' })) + '</div>') +
      '</div>' +
      (mOp === 'between'
        ? rangeBandHTML(nid, ci, { key: cur.key, column: { def:'5' } }, c, markBox)
        : '');

  } else if (cur.kind === COLTYPE.NUMBER) {
    var nOp = critOp(c, cur.key, 'gt');
    var numBox = function(key, val) {
      return '<input type="number" value="' + esc(val) + '"' + ctl(nid, key) + '>';
    };
    // The single box gives way to the band rather than sitting beside it — two
    // places to type a lower bound would be one too many — so with the range on
    // the row has only two cells and the operator can have the spare width.
    body = (nOp === 'between'
      ? '<div class="criterion-controls two-col">' + fieldSel +
          opSelect(nid, oKey, NUM_OPS, nOp) + '</div>' +
        rangeBandHTML(nid, ci, cur, c, numBox)
      : '<div class="criterion-controls">' + fieldSel +
          opSelect(nid, oKey, NUM_OPS, nOp) +
          numBox(vKey, critValue(c, cur.key, cur.column)) +
        '</div>');

  } else if (cur.kind === COLTYPE.ENUM || isRangeable(cur.column)) {
    var vals = (cur.column && cur.column.values) || (cur.column && cur.column.order) || [];
    // Enum criteria carry an operator too. Without one, "specialisation is NOT
    // Data Science" is unaskable — the engine has always supported it, but
    // there was no control to reach it with.
    var eOps = opsFor(cur.kind, cur.column);
    var eOp = critOp(c, cur.key, 'eq');
    if (eOps.indexOf(eOp) === -1) eOp = eOps[0];
    var enumOp = opSelect(nid, oKey, eOps, eOp);
    var pick = function(key, val) {
      return '<select' + ctl(nid, key) + '>' +
        vals.map(function(v){ return opt(v, String(val)); }).join('') + '</select>';
    };
    var valSel = pick(vKey, critValue(c, cur.key, cur.column));
    // Long option text (specialisations, course names) will not survive the
    // 80px field column, so those wrap onto their own row.
    var wide = vals.some(function(v){ return String(v).length > 8; });
    body = (eOp === 'between'
      // Both bounds live in the band, so the row is field and operator only —
      // and the operator gets the width its label needs, wide values or not.
      ? '<div class="criterion-controls two-col">' + fieldSel + enumOp + '</div>' +
        rangeBandHTML(nid, ci, cur, c, pick)
      : wide
      ? '<div class="criterion-controls stack">' + fieldSel +
          '<div class="cc-pair">' + enumOp + valSel + '</div></div>'
      : '<div class="criterion-controls">' + fieldSel + enumOp + valSel + '</div>');

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
  source:'Source', filter:'Filter', sort:'Sort', reverse:'Reverse', take:'Take',
  unique:'Unique', select:'Select', project:'Project',
  aggregate:'Aggregate', aggregateColumns:'Agg. Columns', aggregateRows:'Agg. Rows',
  combine:'Combine', compare:'Compare', output:'Output'
};
function upstreamLabel(node) {
  return (NODE_LABELS[node.type] || node.type) + ' #' + node.id;
}

/* THE FILE SECTION ON A SOURCE PANEL
   ---------------------------------------------------------------------------
   Two rows, in the order the two steps have to happen in, each showing what is
   currently held rather than only offering a button. A Source that says
   "headers.txt, 27 columns" and "mcs-students-2022, 2170 rows" is a Source
   whose answer can be checked against the files on disk, which is the whole
   reason the names are shown at all.

   The year button is disabled until a header is in hand. The ordering is a real
   constraint rather than a stylistic one — a year file is a list of fields with
   no names on it — so the control says so by being unavailable, and the hint
   underneath says why. */
function sourceFilesHTML(node) {
  var id = node.id;
  var data = datasetFor(node);
  var header = headerFor(id);
  var want = datasetCfg(node);
  var notice = SOURCE_NOTICE[id];

  var html = '<div class="cfg-label">Data files</div><div class="src-files">';

  // 1 — the column file
  html += '<div class="src-file' + (header ? ' done' : '') + '">' +
    '<span class="src-step">1</span>' +
    '<span class="src-what">' +
      (header
        ? '<b>' + esc(header.name) + '</b><small>' +
            (header.columns.length ? header.columns.length + ' columns' : 'built in') + '</small>'
        : '<b>' + esc(DATA_HEADERS_NAME) + '</b><small>not loaded</small>') +
    '</span>' +
    '<button class="src-btn" onclick="pickHeadersFile(' + id + ')">' +
      (header ? 'Replace' : 'Choose') + '</button>' +
  '</div>';

  /* 2 — the year files.
     A list rather than one line of comma-separated names, because they are a
     collection the user adds to and takes from: each one has to be countable on
     its own and removable on its own. Naming them all in a single label made
     four files look like one thing that had to be re-picked whole. */
  var files = (data && !data.synthetic) ? data.files : [];
  var full = files.length >= MAX_YEAR_FILES;
  html += '<div class="src-file' + (files.length ? ' done' : '') + '">' +
    '<span class="src-step">2</span>' +
    '<span class="src-what">' +
      (files.length
        ? '<b>' + files.length + ' year file' + (files.length === 1 ? '' : 's') + '</b>' +
          '<small>' + files.reduce(function(a, f){ return a + f.rows; }, 0) + ' rows, ' +
          files.reduce(function(a, f){ return a + f.students; }, 0) + ' students</small>'
        : '<b>' + yearFileNameFor(want.years.length ? want.years[0] : 'YYYY') + '</b>' +
          '<small>' + (want.years.length
            ? (want.years.length === 1 ? 'wanted by this query'
               : want.years.length + ' wanted by this query')
            : 'not loaded') + '</small>') +
    '</span>' +
    '<button class="src-btn"' + (header && !full ? '' : ' disabled') +
      ' title="' + (full ? esc('This Source is holding the most year files it can.')
                         : 'Choose one or more mcs-students-YYYY files') + '"' +
      ' onclick="pickYearFiles(' + id + ')">' +
      (files.length ? 'Add' : 'Choose') + '</button>' +
  '</div>';

  /* Each loaded year, with the control that drops it. Indented under step 2
     rather than being three more numbered steps: they are the contents of one
     step, and numbering them would say the order they were chosen in matters. */
  if (files.length) {
    html += '<div class="src-years">' + files.map(function(f) {
      return '<div class="src-year">' +
        '<span class="src-year-name">' + esc(f.name) + '</span>' +
        '<span class="src-year-count">' + f.students + ' students</span>' +
        '<button class="src-year-drop" title="' +
          esc('Remove ' + f.name + ' from this Source') + '"' +
          ' onclick="removeSourceYear(' + id + ',' + f.year + ')">x</button>' +
      '</div>';
    }).join('') + '</div>';
  } else if (want.years.length > 1) {
    // Nothing loaded, but the saved query knows what it wants. Naming all of
    // them is the difference between re-picking the right files and guessing.
    html += '<div class="src-years">' + want.years.map(function(y) {
      return '<div class="src-year wanted">' +
        '<span class="src-year-name">' + esc(yearFileNameFor(y)) + '</span>' +
        '<span class="src-year-count">not loaded</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  html += '</div>';

  if (!header) {
    html += '<div class="src-hint">A year file has no column names in it, so ' +
      esc(DATA_HEADERS_NAME) + ' has to come first.</div>';
  }
  if (data && !data.synthetic) {
    html += '<button class="src-clear" onclick="clearSourceData(' + id + ')">' +
      'Unload everything, including ' + esc(DATA_HEADERS_NAME) + '</button>';
  }
  if (notice) {
    html += '<div class="src-notice ' + (notice.kind === 'error' ? 'bad' : 'ok') + '">' +
      esc(notice.text) + '</div>';
  }
  return html;
}

function configHTML(node, schemas) {
  var id = node.id;
  var cfg = node.cfg = node.cfg || defaultCfg(node.type);
  var schema = inputSchema(node, schemas);
  var html = '<div class="node-config">';

  if (node.type === 'source') {
    html += sourceFilesHTML(node);

    /* The population offers THIS Source's years, not every year loaded anywhere
       on the canvas. Offering a year this Source cannot answer would be
       offering an empty result dressed as a choice. */
    var data = datasetFor(node);
    var years = data ? data.years : [];
    html += '<div class="cfg-label">Population</div>' +
      '<select' + ctl(id, 'pop') + (years.length ? '' : ' disabled') + '>' +
        opt('all', cfg.pop, 'All students') +
        years.map(function(y){ return opt(String(y), cfg.pop, y + ' only'); }).join('') +
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

  if (node.type === 'reverse') {
    /* No controls. The panel still earns its place by saying what the node is
       for: on its own Reverse looks like a node that does nothing useful, and
       the pairing with Take is the whole point of it. */
    var rn = inputsOf(id).length
      ? 'Last row first, first row last. Columns and row count are unchanged.'
      : 'Wire a table in. This flips the order its rows arrive in.';
    html += '<div class="cmp-hint">' + rn + ' Put it before a <b>Take</b> to keep ' +
      'the last few rows instead of the first.</div>';
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

  if (node.type === 'unique') {
    /* One selector, defaulting to whole rows. The two modes are genuinely
       different operations — one keeps the table's shape, the other reduces it
       to a list — so the control says which is which in words rather than
       leaving the user to infer it from the result. */
    var ucols = uniqueCols(schema);
    var ucur  = uniqueCol(node, schema);
    html += '<div class="cfg-label">Distinct</div>' +
      '<select' + ctl(id, 'col') + '>' +
        opt('', ucur ? 'x' : '', 'Whole rows') +
        ucols.map(function(c) {
          return opt(c.key, ucur ? ucur.key : '', 'Values of ' + c.label);
        }).join('') +
      '</select>';
    html += '<div class="cmp-hint">' + (ucur
      ? 'Reduces the table to one column of distinct ' + esc(ucur.label) +
        ' values, in the order they first appear.'
      : 'Removes rows identical to one already seen. Columns are unchanged.') +
      '</div>';
  }

  if (node.type === 'aggregate' || node.type === 'aggregateColumns' ||
      node.type === 'aggregateRows') {
    var isCols = node.type === 'aggregateColumns';
    var isRows = node.type === 'aggregateRows';
    var op = aggOp(node);

    html += '<div class="cfg-label">Measure</div>' +
      '<select' + ctl(id, 'op') + '>' +
        AGG_OPS.map(function(o){ return opt(o.key, op.key, o.label); }).join('') +
      '</select>';

    if (!isCols && !isRows && op.needsCol) {
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
    if (isRows) {
      /* Naming the count of contributing columns is the whole warning: if it
         says 1, the measure is reducing a single column to itself, and if it
         counts a column the user thinks of as a label, the label is being
         added into the total. */
      var rIdx = aggregateRowsIdx(node, schema);
      var rTotal = schema.columns.length;
      var rSkip = rTotal - rIdx.length;
      html += '<div class="cmp-hint">' +
        'One column out, one row per row in &mdash; ' + esc(op.label.toLowerCase()) +
        ' across ' + (rTotal
          ? rIdx.length + ' of ' + rTotal + ' column' + (rTotal === 1 ? '' : 's')
          : 'each row') + '.' +
        (rSkip > 0
          ? ' ' + rSkip + ' non-measure column' + (rSkip === 1 ? ' is' : 's are') + ' ignored.'
          : '') +
        ' The rest of the row is replaced, so put a <b>Select</b> in front if the ' +
        'row still carries anything that is not a measure.</div>';
    } else if (isCols) {
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

  if (node.type === 'select') {
    var availCols = schema.columns;
    if (!availCols.length) {
      html += '<div class="cmp-hint">Nothing upstream yet — wire a Source in to choose columns.</div>';
    } else {
      var kept = selectedCols(node, schema).map(function(c){ return c.key; });
      html += '<div class="cfg-label">Keep</div><div class="cmp-measures sel-cols">' +
        availCols.map(function(c) {
          // The last ticked box is disabled rather than hidden. A Select with no
          // columns is a table with nothing in it, and the panel it leaves behind
          // offers no way back — every box would be unticked and identical.
          var on = kept.indexOf(c.key) !== -1;
          var locked = on && kept.length === 1;
          return '<label class="cmp-measure' + (locked ? ' locked' : '') + '"' +
              (locked ? ' title="At least one column has to be kept"' : '') + '>' +
            '<input type="checkbox"' + (on ? ' checked' : '') + (locked ? ' disabled' : '') +
              ctl(id, 'column:' + c.key) + '>' +
            '<span>' + esc(c.label) + '</span></label>';
        }).join('') +
      '</div>';
      html += '<div class="cmp-hint">' +
        (kept.length === availCols.length
          ? 'Every column is kept — untick to narrow. Rows are never touched.'
          : kept.length + ' of ' + availCols.length + ' columns kept, in the order they arrive.') +
        '</div>';
    }
  }

  if (node.type === 'project') {
    /* No controls, so the panel exists entirely to say what the node does to
       the meaning of a row. That is the thing this node was asked to make
       visible, and a panel that said nothing would put it back where it was
       when it lived hidden on the Source. */
    if (!canProject(schema)) {
      html += '<div class="cmp-hint">No course data on this table, so there is ' +
        'nothing to expand &mdash; the rows pass through unchanged. Wire this ' +
        'straight after a Source or a Filter.</div>';
    } else {
      var pCols = projectColumns(schema);
      var pGained = enrolmentColumns().map(function(c){ return c.label; }).join(', ');
      html += '<div class="cfg-label">One row per course</div>' +
        '<div class="cmp-hint proj-warn">Every row becomes one row per course ' +
        'taken, so a row is an enrolment from here on, not a student. ' +
        '<b>A count after this counts enrolments.</b></div>' +
        '<div class="cmp-hint">Adds ' + esc(pGained) + '. ' +
        'ID becomes Student, because it no longer names a row on its own. ' +
        pCols.length + ' columns out.</div>';
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
      /* The key column comes from the BASE, not from whichever wire happened to
         be drawn first. They are usually the same table, and were always assumed
         to be — but join makes the difference visible: pick the second input as
         the base and the picker would otherwise offer columns the base does not
         have, then refuse the key it just offered. */
      var baseSchema = (schemas && schemas[combineBaseId(node, cinIds)]) || schema;
      var kcols = combineKeyCols(baseSchema);
      var kcur = combineKeyCol(node, baseSchema);
      html += '<div class="cfg-label">Match rows on</div>' +
        (kcols.length
          ? '<select' + ctl(id, 'key') + '>' +
              kcols.map(function(c){ return opt(c.key, kcur ? kcur.key : '', c.label); }).join('') +
            '</select>'
          : '<div class="cmp-hint">No column upstream to match on.</div>');
      if (cmode.key === 'join') {
        html += '<label class="cmb-check"><input type="checkbox"' +
            (cfg.keepUnmatched ? ' checked' : '') + ctl(id, 'keepUnmatched') + '>' +
          '<span>Keep base rows with no match</span></label>';
      }
      html += '<div class="cmp-hint">' +
        (cmode.key === 'intersect'
          ? 'Keeps base rows whose value also appears in every other input.'
          : cmode.key === 'difference'
          ? 'Keeps base rows whose value appears in none of the other inputs.'
          : 'Adds the other inputs\u2019 columns onto each base row, matched on this ' +
            'column. The result has the base\u2019s rows, not more: where an input ' +
            'repeats a key, its first matching row is used.') +
        '</div>';
    }
  }

  if (node.type === 'output') {
    var show = normaliseShow(node);
    cfg.show = show;

    html += '<div class="cfg-label">Show</div><select' + ctl(id, 'show') + '>';
    if (compareFeedsOutput(node)) {
      html += opt('summary', show, 'Summary table') +
              opt('lists',   show, 'Summary + row lists');
    } else {
      html += opt('rows',    show, 'Rows (raw data)') +
              opt('count',   show, 'Count');
    }
    html += '</select>';

    /* The column picker appears only on the row view. It is the same control as
       Select's, deliberately — two panels that do the same thing should look
       the same — and it reads the header that is actually arriving, so an
       Output rewired behind a different branch offers that branch's columns. */
    if (show === 'rows') {
      var oCols = schema.columns;
      if (!oCols.length) {
        html += '<div class="cmp-hint">Nothing wired in yet &mdash; connect a Source to ' +
          'choose which columns to show.</div>';
      } else {
        var oKept = outputCols(node, schema).map(function(c){ return c.key; });
        html += '<div class="cfg-label">Show columns</div><div class="cmp-measures sel-cols">' +
          oCols.map(function(c) {
            // Last box locked for Select's reason: an Output showing no columns
            // has nothing to show, and the panel it leaves behind offers no way
            // back, since every box would be unticked and identical.
            var on = oKept.indexOf(c.key) !== -1;
            var locked = on && oKept.length === 1;
            return '<label class="cmp-measure' + (locked ? ' locked' : '') + '"' +
                (locked ? ' title="At least one column has to be shown"' : '') + '>' +
              '<input type="checkbox"' + (on ? ' checked' : '') + (locked ? ' disabled' : '') +
                ctl(id, 'column:' + c.key) + '>' +
              '<span>' + esc(c.label) + '</span></label>';
          }).join('') +
        '</div>';
        html += '<div class="cmp-hint">' +
          (oKept.length === oCols.length
            ? 'Every column is shown. Untick to narrow the view &mdash; no rows are lost, ' +
              'and Copy and Save follow what is shown.'
            : oKept.length + ' of ' + oCols.length + ' columns shown. Copy and Save ' +
              'write these columns, every row.') +
          '</div>';
      }
    }

    // The file name deliberately lives with the Copy/Save buttons in the results
    // panel rather than here. It describes the exported file, not the query, and
    // putting it on the node implied it was part of what gets computed.
  }

  return html + '</div>';
}

/* Port stubs are drawn only where they carry information — on a node with more
   than one input, where the user has to know which is which. A single-input
   node shows nothing: it has one entry point, in the place arrows have always
   landed, and decorating it would be noise on every node on the canvas.

   Each stub is positioned by the same fraction as portOffsetY, so the marker on
   the shape and the arrowhead in the SVG are placed by one rule rather than two
   that have to be kept in step. An occupied port is styled differently, which
   is how a user sees that a single input is full before trying to drop on it. */
function portsHTML(node) {
  var ps = portsOf(node.type);
  if (ps.length < 2) return '';
  return '<span class="node-ports">' + ps.map(function(p, i) {
    var taken = wiresInto(node.id, p.key).length > 0;
    var top = 100 * (i + 1) / (ps.length + 1);
    return '<span class="node-port' + (taken ? ' filled' : '') + '"' +
           ' style="top:' + top + '%"' +
           ' title="' + esc(p.label) + (p.multi ? ' (accepts several)' : '') + '">' +
           '<i></i><em>' + esc(p.label) + '</em></span>';
  }).join('') + '</span>';
}

function shapeHTML(node) {
  var removeBtn = '<button class="node-remove" onclick="removeNode(' + node.id + ')">x</button>' +
                  portsHTML(node);
  if (node.type === 'source') {
    /* A Source with no files looks exactly like a Source with files until you
       open its panel, and on a graph of a dozen nodes that is the difference
       between "why is this empty" and "load that one". The dashed ring says
       which, and it says it around the whole shape.

       A badge in the corner did the same job and was a worse way to do it: the
       delete button lives at top-right, so the two occupied the same spot and
       the badge read as something to click. The border carries the state
       without competing for that corner. */
    return '<div class="node-shape shape-source' +
      (hasSourceData(node) ? '' : ' no-data') + '">' +
      removeBtn + 'Source</div>';
  }
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
  if (node.type === 'reverse') {
    /* Sort's ascending bars, upside down, with a turn arrow beside them. Read
       against Sort the inversion is the message: same bars, opposite order. The
       arrow is what stops it being mistaken for "sort descending", which is a
       different node reached a different way. */
    var rv = '<span class="rev-glyph">' +
      '<span class="rev-bars"><i style="width:23px"></i>' +
      '<i style="width:16px"></i><i style="width:9px"></i></span>' +
      '<b class="rev-turn"></b></span>';
    return '<div class="node-shape shape-reverse">' + removeBtn + rv + 'Reverse</div>';
  }
  if (node.type === 'take') {
    // Three kept bars above the cut, one dropped below it — the glyph says
    // "first few, rest discarded" without repeating the word on the label.
    var bars = '<span class="take-glyph">' +
      '<i></i><i></i><i></i><b></b><i class="cut"></i></span>';
    return '<div class="node-shape shape-take">' + removeBtn + bars + 'Take</div>';
  }
  if (node.type === 'unique') {
    /* Two pairs, each a value and its repeat. The first of each pair is solid —
       kept — and the second is an empty outline of the same width — the same
       value again, dropped. Matching widths are what say "the same value";
       the outline is what says "not kept".

       The previous glyph struck a line through the repeat, which read as Take's
       cut rule and so said "everything below here is discarded" rather than
       "this one is a duplicate". Two pairs rather than one also matter: a
       single repeat looks like a rule separating a top group from a bottom one,
       which is exactly the wrong reading. */
    var uq = '<span class="uniq-glyph">' +
      '<i class="wide"></i><i class="wide dupe"></i>' +
      '<i class="narrow"></i><i class="narrow dupe"></i></span>';
    return '<div class="node-shape shape-unique">' + removeBtn + uq + 'Unique</div>';
  }
  if (node.type === 'select') {
    /* Three columns with the middle one hollow. Every other glyph on the canvas
       is read top to bottom because it says something about rows; this one is
       read left to right, which is the distinction the node exists to make. The
       dropped column is outlined rather than absent, so the glyph shows a
       choice being made rather than a table that happens to be narrow. */
    var sg = '<span class="sel-glyph"><i></i><i class="off"></i><i></i></span>';
    return '<div class="node-shape shape-select">' + removeBtn + sg + 'Select</div>';
  }
  if (node.type === 'project') {
    /* One bar fanning out into three. Every other glyph on the canvas shows
       rows being kept, dropped, reordered or reduced; this is the only one that
       shows them multiplying, which is the single fact about this node worth
       recognising from across the canvas. Drawn left to right, like Select's,
       because both change the header — but opening out rather than narrowing. */
    var pj = '<span class="proj-glyph">' +
      '<i class="proj-one"></i><b class="proj-fan"></b>' +
      '<span class="proj-many"><i></i><i></i><i></i></span></span>';
    return '<div class="node-shape shape-project">' + removeBtn + pj + 'Project</div>';
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
  if (node.type === 'aggregateRows') {
    /* AggregateColumns' glyph turned through ninety degrees: three ROWS, each
       collapsing rightwards to its own value. Read beside its sibling the axis
       is the whole message — one reduces down the page, the other across it. */
    var aggr = '<span class="aggr-glyph">' +
      '<span class="aggr-row"><i></i><i></i><b></b></span>' +
      '<span class="aggr-row"><i></i><i></i><b></b></span>' +
      '<span class="aggr-row"><i></i><i></i><b></b></span></span>';
    return '<div class="node-shape shape-aggrows">' + removeBtn + aggr + 'Agg. Rows</div>';
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
      // Same pair, same port is the duplicate to refuse. The same pair on two
      // different ports is legitimate — one table can be both the data and the
      // labels — so the port is part of the identity of a connection.
      var exists = connections.some(function(c) {
        return c.from === dir.from.id && c.to === dir.to.id && c.port === dir.port;
      });
      if (!exists) {
        connections.push({ from: dir.from.id, to: dir.to.id, port: dir.port,
                           color: pickEdgeColor(dir.from) });
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
// The port is part of a connection's identity: two wires from one node into two
// different ports of the same target are distinct edges, and hovering or
// deleting one must not pick up the other.
function connKey(c) { return c.from + '->' + c.to + ':' + c.port; }

function removeConnection(from, to, port) {
  connections = connections.filter(function(c) {
    return !(c.from === from && c.to === to && c.port === port);
  });
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
    removeConnection(conn.from, conn.to, conn.port);
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

// Preview columns are capped, not chosen: a join result carries both inputs'
// headers and runs to a dozen columns, which no floating panel can hold.
// Paired with the .edge-preview width in the stylesheet — six columns at the
// density four had. Raising this without widening that crowds the cells until
// every one of them ellipsises away to nothing.
var PREVIEW_COLS = 6;
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
    var p0 = shapeExit(a), tip = shapeEntry(b, conn.port);

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
   Previously there was a card per output type, plus a separate Compare path.
   They rendered the same kinds of thing in slightly different ways and had to
   be kept in step by hand. Every result is now a table, so there is one
   function.                                                                   */

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
  /* The mean of nothing is undefined, not zero. Printing "0" asserts something
     false about the data; an em dash says there was nothing to average.

     reduceValues() returns null for exactly that case, and now that any 1x1
     table reaches this renderer an aggregate over no rows arrives here rather
     than as a blank table cell. An empty headline is as uninformative as a
     wrong one, so the same em dash covers it. */
  var blank = r[0] === null || r[0] === undefined ||
              (c.key === 'average' && t.columns.length > 1 && Number(r[1]) === 0);
  var extra = t.columns.length > 1
    ? '<span class="big-sub">' + esc(t.columns[1].label + ': ' + fmtCell(t.columns[1], r[1])) + '</span>'
    : '';
  return '<div class="result-card">' +
    '<div class="result-head">' + esc(c.label) + '</div>' +
    '<div class="result-big"><span class="big-num">' + (blank ? '&mdash;' : esc(fmtCell(c, r[0]))) + '</span>' + extra + '</div>' +
  '</div>';
}

function resultHTML(node, r) {
  var show = normaliseShow(node);
  var t = outputTable(node, r.table);

  if (show === 'count') return scalarHTML(t);

  if (show === 'summary' || show === 'lists') {
    var branches = (r.table.meta && r.table.meta.branches) || null;
    if (branches) {
      // Compare-fed: the summary first, then per-branch detail if asked for
      var html = tableHTML(t, 'Comparison', branches.length + ' branches');
      if (show === 'lists') {
        html += branches.map(function(b) {
          return '<div class="cmp-branch-card">' +
            tableHTML(b.table, b.label, String(b.table.rows.length)) + '</div>';
        }).join('');
      }
      return html;
    }
  }

  /* A single value is a single value however it was produced. Until now only
     the Output's own Count setting reached the headline display, so moving the
     same calculation onto the canvas — an Aggregate wired in front, which is
     exactly what removing the Output shortcuts told people to do — demoted the
     answer to a one-cell table. The rule is the shape of the result, not which
     control happened to produce it.

     Placed after the Compare branch above so a one-branch, one-measure summary
     still renders as the comparison it is. */
  if (t.columns.length === 1 && t.rows.length === 1) return scalarHTML(t);

  return tableHTML(t, 'Rows', String(t.rows.length));
}

function runQuery() {
  var srcNodes = nodes.filter(function(n){ return n.type === 'source'; });
  var outNodes = nodes.filter(function(n){ return n.type === 'output'; });

  if (srcNodes.length === 0) { showError('Add a Source node.'); return; }
  if (outNodes.length === 0) { showError('Add an Output node.'); return; }

  /* Checked before the topological sort rather than inside it, so that a graph
     whose Sources are all empty says so plainly instead of reporting whichever
     one the ordering happened to reach first. Every unloaded Source is named,
     because fixing one and re-running to be told about the next is a poor way
     to find out there were three. */
  var starved = srcNodes.filter(function(n){ return !hasSourceData(n); });
  if (starved.length) {
    showError(starved.length === 1
      ? sourceDataError(starved[0])
      : starved.length + ' Source nodes have no data: ' +
        starved.map(function(n){ return '#' + n.id; }).join(', ') +
        '. Open each one and load ' + DATA_HEADERS_NAME + ', then its year files.');
    return;
  }
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

      var log = r.log.slice();
      log.push(logEntry('OUTPUT', [{ c:'val', s:show }]));

      exportData[onode.id] = {
        index: oi + 1,
        show: show,
        name: exportNameOf(onode, oi + 1),
        table: t,
        source: r.table,          // pre-Output table, for the per-branch export
        log: log.map(logText)
      };

      body = '<div class="query-log">' + log.map(logHTML).join('\n') + '</div>' + resultHTML(onode, r);

      actions = '<div class="result-actions">' +
        exportNameHTML(onode, oi + 1) +
        '<button class="rbtn" onclick="copyOutput(' + onode.id + ',this)">Copy</button>' +
        '<button class="rbtn" onclick="saveOutput(' + onode.id + ',this)">Save</button>' +
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
  /* Only the "Summary + row lists" view exports long. The test used to be
     "branches exist and the view is not the summary", which was the same thing
     while branch metadata could only reach an Output across a direct wire from
     a Compare — the two views available there are exactly summary and lists.

     It stopped being the same thing when Compare was allowed to feed the row
     nodes. Sort and Take carry meta through, quite correctly, so a
     Compare -> Take(1) -> Output showed one row on screen and exported every
     row of every branch: the export silently ignored the Take. Naming the one
     view that means "long" keeps the two in step whatever arrives. */
  if (!branches || e.show !== 'lists') return e.table;

  var per = branches.map(function(b) {
    return { label: b.label, t: b.table };
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
/* The fallback is a parameter because the two things this names have different
   right answers: a results export is an "output", a saved graph is a "query".
   Existing callers pass one argument and keep the original default. */
function safeName(s, fallback) {
  var out = String(s).trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || fallback || 'output';
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

/* WRITING A FILE FROM A PAGE THAT IS NOT BEING SERVED.

   This tool is opened from a file:// URL with no build step, and that makes
   saving harder than it looks. Three separate things went wrong here, and the
   first two fixes each traded one failure for another:

   1. The anchor was removed and the object URL revoked 1s after .click().
      WebKit starts a download asynchronously and reads the blob AFTER the
      handler returns, so a revoke on a timer is a race against the browser.
      Losing it produces exactly "WebKitBlobResource error 1" on a blob:null
      URL — the blob is not missing because the origin is opaque, it is missing
      because we threw it away while WebKit was still fetching it.

   2. Swapping the blob for a data: URI avoided the race but introduced a size
      ceiling. A saved query is 2-10KB and rode under it; a CSV export of a year
      file is ~320KB, and ~460KB once percent-encoded into a URL. That is why
      Save Query worked and Save CSV did not — the same code, told to carry
      fifty times as much.

   3. A CSV announced as text/csv is something Safari knows how to display, so
      it displays it: the tab fills with rows and no file is written. WebKit
      weighs its own idea of the type against the download attribute and wins.

   So: a blob, which has no size ceiling and does not inflate; typed as
   application/octet-stream, which leaves nothing to render, so a download is
   the only thing left to do with the bytes; and torn down long after the click
   rather than in a race with it. The 40 second delay is what FileSaver.js
   settled on for the same reason.

   Nothing downstream reads that type. The extension on the download attribute
   decides the file on disk and what opens it, and that is still .csv. */
var FORCE_DOWNLOAD_TYPE = 'application/octet-stream';
var DOWNLOAD_TEARDOWN_MS = 40000;

function downloadFile(name, content) {
  try {
    var url = URL.createObjectURL(new Blob([content], { type: FORCE_DOWNLOAD_TYPE }));
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    /* Both the anchor and the URL outlive the click, because the download that
       reads them has not necessarily started yet. */
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, DOWNLOAD_TEARDOWN_MS);
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

/* The name written is the name typed, with nothing appended. A timestamp used
   to be added for uniqueness, which meant the field never actually decided the
   filename — two saves of "grades" produced two differently-named files, and
   the user who had just named the file could not predict what they would get.
   Re-saving now overwrites, or is de-duplicated by the browser, which is what
   every other download on the machine does.

   This also makes the two export paths agree: queryFileName() already writes a
   typed name verbatim and reserves the timestamp for the *default* name, where
   it is a convenience rather than an override. defaultExportName() plays that
   role here — different Outputs still get distinct names without one. */
function saveOutput(id, btn) {
  var e = exportEntry(id, btn);
  if (!e) return;
  var name = safeName(e.name) + '.csv';
  flashBtn(btn, downloadFile(name, serialiseTable(exportTableFor(e), ',', true))
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

/* Version 2 adds the `port` field to each connection. Version 1 files still
   load: the loader resolves a missing port to the target's primary input, which
   is what a version 1 wire meant when every node had exactly one. The guard
   below only refuses files from a *newer* tool, so the format widened without
   breaking anything already written. */
/* Version 3 adds `dataset` to a Source's config: the NAMES of the files it was
   given, never their contents. Version 1 and 2 files still load — a Source with
   no dataset key gets the empty one from defaultCfg() and simply asks for its
   files without being able to name them. The guard below still only refuses
   files from a newer tool. */
var FILE_VERSION = 3;
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
      return { from:c.from, to:c.to, port:c.port, color:c.color };
    })
  };
}

/* NAMING A SAVED QUERY
   ---------------------------------------------------------------------------
   A saved query is kept and re-opened, so the name is how it is found again
   months later. A timestamp alone does not say whether the file is the grade
   histogram or the migration analysis, and renaming afterwards in the file
   manager is a step nobody takes.

   The extension is not the user's to choose. It is decided by the format, and
   the loader below refuses anything else, so offering it as editable text would
   let someone type a name the tool then declines to open. It is therefore shown
   beside the field but sits outside the input — the same treatment the CSV
   export name already uses, so the two read as the same kind of control.

   A name typed with ".json" already on the end is accepted and the duplicate
   dropped, because a user who types the extension is not making a mistake, and
   "query.json.json" would be a poor way of telling them so. */
var QUERY_EXT = '.json';

function defaultQueryName() { return 'query-' + timeStamp(true); }

/* Typed text to written filename. Two things happen on the way: the extension
   is stripped if present so it can be re-added exactly once, and the rest goes
   through the same sanitiser as every other file this tool writes — a name is
   a name whether it came from a config field or a dialog. */
/* Repeated, not once: someone correcting a name by hand can leave
   "report.json.json" behind, and the intent is plainly one extension. Its own
   function because the hint below has to strip identically — two copies of this
   rule would drift, and the symptom would be a hint that fires on names it
   should not. */
function stripQueryExt(s) {
  return String(s == null ? '' : s).trim().replace(/(\.json)+$/i, '');
}

function queryFileName(raw) {
  return safeName(stripQueryExt(raw), defaultQueryName()) + QUERY_EXT;
}

// Which toolbar button opened the dialog, so its confirmation flashes on the
// control the user actually pressed rather than somewhere in the dialog that is
// about to disappear.
var saveDialogBtn = null;

/* The name last saved under, this session only — never persisted. Save, adjust
   the graph, save again is the ordinary loop, and it almost always wants the
   same name; offering a fresh timestamp each time would leave a folder of
   near-identical files distinguishable only by the minute they were written.
   Cancelling does not set it, so a name is only remembered once it named
   something. */
var lastQueryName = '';

function saveDialogEl()  { return document.getElementById('saveDialog'); }
function saveNameInput() { return document.getElementById('saveName'); }
function saveDialogOpen() {
  var d = saveDialogEl();
  return !!(d && d.classList.contains('open'));
}

function saveGraph(btn) {
  if (nodes.length === 0) { flashBtn(btn, 'Nothing to save'); return; }
  openSaveDialog(btn);
}

function openSaveDialog(btn) {
  var d = saveDialogEl(), input = saveNameInput();
  // If the markup is absent — an older page, or a headless harness that loaded
  // the script alone — saving still works, it just uses the default name. A
  // missing dialog should not cost the user their query.
  if (!d || !input) { writeQueryFile(defaultQueryName() + QUERY_EXT, btn); return; }

  saveDialogBtn = btn || null;
  input.value = lastQueryName || defaultQueryName();
  // The placeholder is always the timestamp, because that is what an empty
  // field actually writes — clearing the box should show its own result, not
  // repeat the name being cleared.
  input.placeholder = defaultQueryName();
  updateSaveHint();
  d.classList.add('open');
  input.focus();
  // Selected rather than merely focused: the suggestion is a fallback, not a
  // prefix to type after, so the common case is one keystroke replacing it.
  input.select();
}

function closeSaveDialog() {
  var d = saveDialogEl();
  if (d) d.classList.remove('open');
  var btn = saveDialogBtn;
  saveDialogBtn = null;
  // Focus goes back where it came from; leaving it on a hidden input strands
  // the keyboard user with no visible caret.
  if (btn && btn.focus) btn.focus();
}

/* Sanitising is silent everywhere else in the tool, which is fine when the name
   is typed inches from the file it names. Here the file is written and gone, so
   a name that changed on the way out is worth one line — and only then, since
   restating an unchanged name is noise. */
function updateSaveHint() {
  var input = saveNameInput(), hint = document.getElementById('saveHint');
  if (!input || !hint) return;
  var typed = stripQueryExt(input.value);
  var name = queryFileName(input.value);
  var changed = !!typed && name !== typed + QUERY_EXT;
  hint.textContent = changed ? 'Saves as ' + name : '';
  hint.classList.toggle('show', changed);
}

function confirmSaveGraph() {
  var input = saveNameInput();
  var name = queryFileName(input ? input.value : '');
  var btn = saveDialogBtn;
  // Stored without the extension, which is how the field shows it.
  lastQueryName = name.replace(/\.json$/i, '');
  closeSaveDialog();
  writeQueryFile(name, btn);
}

// The write itself, with the emptiness check repeated: the graph can be cleared
// between opening the dialog and confirming it.
function writeQueryFile(name, btn) {
  if (nodes.length === 0) { flashBtn(btn, 'Nothing to save'); return; }
  var json = JSON.stringify(serialiseGraph(), null, 2);
  flashBtn(btn, downloadFile(name, json) ? 'Saved ✓' : 'Save failed');
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

  /* Ports are resolved rather than trusted. A version 1 file predates them and
     names none, so every wire lands on the target's primary port — which is
     what those files meant, since there was only one input to land on.

     The arity rule is applied here as well as at the point of wiring, because a
     version 1 file may contain the very thing ports were introduced to prevent:
     two wires into one ordinary node, relying on the implicit merge. Loading
     such a file keeps the first wire and drops the rest with a warning, rather
     than quietly evaluating only one of them or reviving a union that no longer
     exists. Dropping is the honest repair: the query said "merge these", the
     tool no longer does that implicitly, and the user is told so. */
  var loadedConns = [];
  var filled = {};   // nodeId:port -> true, for single-arity ports already taken

  d.connections.forEach(function(c) {
    if (!c) return;
    var from = parseInt(c.from, 10), to = parseInt(c.to, 10);
    var a = loadedNodes.filter(function(n){ return n.id === from; })[0];
    var b = loadedNodes.filter(function(n){ return n.id === to; })[0];
    if (!a || !b) { warnings.push('connection to a missing node'); return; }
    if (!canConnect(a.type, b.type)) { warnings.push('connection breaking the wiring rules'); return; }

    var port = normalisePort(b.type, c.port);
    var def = portDef(b.type, port);
    if (!def) { warnings.push('connection to a node that takes no input'); return; }

    if (loadedConns.some(function(x) {
      return x.from === from && x.to === to && x.port === port;
    })) return;

    var slot = to + ':' + port;
    if (!def.multi && filled[slot]) {
      warnings.push('a second wire into a single input — wire a Combine if you meant to merge');
      return;
    }
    filled[slot] = true;

    loadedConns.push({ from:from, to:to, port:port, color: c.color || EDGE_PALETTE[0] });
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
  ['pop','show','filename','sort'].forEach(function(k) {
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
  /* The dataset descriptor is a name and a list of years and nothing else. It
     is read straight back into the panel's markup, so a file supplying an
     object where the name belongs, or 2000 fabricated years, is normalised here
     rather than trusted. Years are coerced to integers in the admitted range;
     the header name is length-capped and stripped of any path, exactly as
     dataFileName() would do to a real one. NOTHING in this key is ever used to
     find or read a file — the user picks those — so the worst a hostile value
     can do is misdescribe itself in one line of the panel. */
  if (Object.prototype.hasOwnProperty.call(base, 'dataset')) {
    var ds = base.dataset;
    if (!ds || typeof ds !== 'object' || Array.isArray(ds)) ds = {};
    var hname = typeof ds.headers === 'string' ? ds.headers.split(/[\\/]/).pop() : '';
    base.dataset = {
      headers: hname.slice(0, 120),
      years: (Array.isArray(ds.years) ? ds.years : [])
        .map(function(y){ return parseInt(y, 10); })
        .filter(function(y, i, a) {
          return !isNaN(y) && y >= DATA_YEAR_MIN && y <= DATA_YEAR_MAX && a.indexOf(y) === i;
        })
        .slice(0, 50)
        .sort(function(a, b){ return a - b; })
    };
  }

  /* null is the meaningful default — "keep everything" — so only a value that is
     neither null nor an array of keys is rejected. Non-string entries are
     dropped rather than coerced: a column key is compared against real header
     keys, and "[object Object]" can never match one. */
  if (Object.prototype.hasOwnProperty.call(base, 'cols')) {
    base.cols = Array.isArray(base.cols)
      ? base.cols.filter(function(k){ return typeof k === 'string'; })
      : null;
    if (base.cols && !base.cols.length) base.cols = null;
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
  /* The data goes. Every Source in the new graph starts with nothing loaded,
     including one whose id happens to match a Source that was loaded a moment
     ago — matching ids across two unrelated files is a coincidence, not a
     grant, and silently handing the new graph the old graph's student records
     would be the worst possible reading of it.

     This is the behaviour the feature was asked for: the query is restored, the
     files are asked for again. */
  clearAllSourceData();

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
  if (g.error) { showError(g.error); flashBtn(btn, 'Load failed'); return false; }
  applyGraph(g);

  var msg = 'Loaded ' + g.nodes.length + ' node' + (g.nodes.length === 1 ? '' : 's') +
    ' and ' + g.connections.length + ' connection' + (g.connections.length === 1 ? '' : 's') + '.';

  /* The data did not come with it, and saying so here is the difference between
     a user who knows what to do next and one who presses Run and reads an
     error. The files the query was built against are named where the file named
     them, because picking the right ones out of a folder is the task. */
  var srcs = g.nodes.filter(function(n){ return n.type === 'source'; });
  if (srcs.length) {
    var wanted = {};
    srcs.forEach(function(n) {
      var d = n.cfg && n.cfg.dataset;
      if (d && d.headers) wanted[d.headers] = true;
      if (d && d.years) d.years.forEach(function(y){ wanted['mcs-students-' + y] = true; });
    });
    var names = Object.keys(wanted);
    msg += ' The data is not saved with a query, so load the files again on ' +
      (srcs.length === 1 ? 'the Source' : 'each Source') + '.';
    if (names.length) msg += ' This one was built against ' + names.join(', ') + '.';
  }
  if (g.warnings.length) {
    msg += ' Skipped ' + g.warnings.length + ' item' + (g.warnings.length === 1 ? '' : 's') +
      ' that no longer fit the graph: ' + g.warnings.filter(function(w, i, a){ return a.indexOf(w) === i; }).join(', ') + '.';
  }
  setOutput('<div class="placeholder">' + esc(msg) + ' Press Run Query to evaluate it.</div>');
  flashBtn(btn, 'Loaded ✓');
  return true;
}

function openGraphFile(btn) {
  var input = document.getElementById('loadFile');
  if (!input) return;
  // Reset first, or choosing the same file twice in a row fires no change event
  input.value = '';
  input._btn = btn;
  input.click();
}

/* A saved query is a few kilobytes; a large one with a hundred nodes is still
   well under a megabyte. The cap is far above anything this tool writes and far
   below anything that would hang the tab, so it only ever catches a file that
   was never a query to begin with. */
var MAX_QUERY_FILE_BYTES = 8 * 1024 * 1024;

/* Two checks before a byte is read, both about failing early and specifically.
   Neither is the last line of defence — deserialiseGraph still rejects anything
   that is not a query file — but by the time that runs the tool has read an
   arbitrary file into memory and can only report that the contents were wrong,
   which is a poor description of choosing the wrong file. */
function graphFileProblem(file) {
  // `accept` on the input filters the picker; it does not bind. Every browser
  // offers "All files", and a file can be dragged in or renamed. So the rule
  // lives here, where the file is actually taken.
  if (!/\.json$/i.test(file.name)) {
    return 'Only .json query files can be opened, and "' + file.name + '" is not one.';
  }
  if (file.size > MAX_QUERY_FILE_BYTES) {
    return 'That file is far too large to be a saved query, so it has not been read.';
  }
  if (file.size === 0) {
    return 'That file is empty.';
  }
  return null;
}

function onGraphFileChosen(e) {
  var input = e.target;
  var file = input.files && input.files[0];
  if (!file) return;
  var btn = input._btn;

  var problem = graphFileProblem(file);
  if (problem) { showError(problem); flashBtn(btn, 'Load failed'); return; }

  var reader = new FileReader();
  reader.onload = function() {
    // Opening a query, changing it and saving it back should offer the name it
    // arrived under, rather than silently proposing a second file beside it.
    if (loadGraphFromText(String(reader.result), btn)) {
      lastQueryName = stripQueryExt(file.name);
    }
  };
  reader.onerror = function(){ showError('Could not read that file.'); flashBtn(btn, 'Load failed'); };
  reader.readAsText(file);
}

/* THE NODE MENUS
   Processing nodes are a growing family, so they live behind dropdowns rather
   than adding a toolbar button each. There are two, split on colour: Reshape
   holds the violet nodes and is violet itself, Processing holds the other three
   families and stays neutral because it cannot honestly claim one of them.

   Written against every .proc-menu rather than a named one, so a third menu is
   markup and needs no change here. Opening one closes the others: two open
   dropdowns overlap, and the second would look like a submenu of the first. */
function procMenus() {
  return Array.prototype.slice.call(document.querySelectorAll('.proc-menu'));
}
function closeProcMenu() {
  procMenus().forEach(function(m){ m.classList.remove('open'); });
}
function toggleProcMenu(e, id) {
  // Without this the document listener below sees the same click and closes the
  // menu in the tick it was opened.
  if (e) e.stopPropagation();
  var wanted = document.getElementById(id);
  procMenus().forEach(function(m) {
    if (m === wanted) m.classList.toggle('open');
    else m.classList.remove('open');
  });
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

/* ============================================================================
   RESULTS PANEL WIDTH
   ============================================================================
   A results table with eighteen columns cannot be read in 300px, but a panel
   permanently wide enough for eighteen columns leaves too little canvas to lay
   a graph out in. So the width is neither fixed nor automatic: it is the user's
   to set, with a sensible narrow default to come back to.

   Two controls, because there are two different intentions behind widening:

     the handle  — settle on a width that suits this machine and this dataset,
                   and leave it there
     Wide        — this one table has too many columns; show me all of them,
                   then give me my canvas back

   Wide remembers the width it left, so using it does not cost the user the
   width they had chosen with the handle.

   Widening narrows the canvas rather than floating over it. The alternative —
   an overlay — would hide whatever node happened to be under it, and the pan
   clamp would still be working from the old, larger canvas box. Shrinking keeps
   one source of truth for how much canvas there is.

   None of this is written into a saved query. A .json file records the
   question; how wide someone likes their panel is a property of the person and
   the screen, not of the query, and a graph emailed to a supervisor should not
   rearrange his interface when he opens it. */

var PANEL_MIN     = 240;   // narrower than this and the table headers wrap
var PANEL_DEFAULT = 300;   // matches the CSS default, which is the real one
var PANEL_WIDE    = 720;   // enough for the full enrolment row at 11px
var CANVAS_MIN    = 320;   // canvas is never squeezed past this, however wide the panel goes
var HANDLE_W      = 5;

var panelWidth   = PANEL_DEFAULT;  // what the panel is now
var panelRestore = PANEL_DEFAULT;  // what Wide goes back to
var panelWide    = false;

function panelResizeEl() { return document.getElementById('panelResize'); }
function panelWideBtnEl() { return document.getElementById('panelWideBtn'); }

function panelMaxWidth() {
  return Math.max(PANEL_MIN, window.innerWidth - CANVAS_MIN - HANDLE_W);
}
function clampPanelWidth(w) {
  if (typeof w !== 'number' || !isFinite(w)) return PANEL_DEFAULT;
  return Math.round(Math.max(PANEL_MIN, Math.min(panelMaxWidth(), w)));
}

/* One write, to the custom property the stylesheet reads. Everything else here
   only decides what number to pass in. */
function applyPanelWidth(w, persist) {
  panelWidth = clampPanelWidth(w);
  document.documentElement.style.setProperty('--panel-w', panelWidth + 'px');
  // The canvas has just changed size without a window resize event firing, so
  // the two things that measure it have to be told by hand.
  clampPan();
  applyView();
  if (persist !== false) savePanelPrefs();
}

function syncPanelWideBtn() {
  var b = panelWideBtnEl();
  if (!b) return;
  b.setAttribute('aria-pressed', panelWide ? 'true' : 'false');
  b.title = panelWide
    ? 'Back to the narrower panel  ( W )'
    : 'Widen the panel to see every column  ( W )';
}

function togglePanelWide() {
  if (panelWide) {
    panelWide = false;
    applyPanelWidth(panelRestore);
  } else {
    panelRestore = panelWidth;
    panelWide = true;
    // Never narrower than it already is: someone who has dragged past the wide
    // preset asked for that width, and Wide should not take it away.
    applyPanelWidth(Math.max(PANEL_WIDE, panelWidth));
  }
  syncPanelWideBtn();
  // Focus would otherwise sit on a button whose meaning just inverted, and the
  // W shortcut is suppressed while a control has focus. Hand it back to the page.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

/* Persisted outside the document, so it survives a reload — a preference the
   user should only have to express once. localStorage throws rather than
   returns null in some file:// and private-window configurations, so every
   access is guarded: failing to remember is a minor loss, and never a reason
   for the panel not to work. */
var PANEL_STORE = 'sda.resultsPanel.v1';

function savePanelPrefs() {
  try {
    window.localStorage.setItem(PANEL_STORE, JSON.stringify({
      w: panelWidth, base: panelRestore, wide: panelWide
    }));
  } catch (e) { /* width still holds for this session */ }
}

function loadPanelPrefs() {
  var raw = null;
  try { raw = window.localStorage.getItem(PANEL_STORE); } catch (e) { return; }
  if (!raw) return;
  var p;
  try { p = JSON.parse(raw); } catch (e) { return; }
  if (!p || typeof p.w !== 'number') return;
  panelRestore = clampPanelWidth(typeof p.base === 'number' ? p.base : PANEL_DEFAULT);
  panelWide = !!p.wide;
  applyPanelWidth(p.w, false);
  syncPanelWideBtn();
}

/* DRAG */
var panelDrag = null;

function onPanelResizeDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();   // stop the drag turning into a text selection
  panelDrag = { startX: e.clientX, startW: panelWidth, moved: false };
  document.body.classList.add('panel-resizing');
  var h = panelResizeEl();
  if (h) h.classList.add('dragging');
}

function onPanelResizeMove(e) {
  if (!panelDrag) return;
  var dx = panelDrag.startX - e.clientX;   // the panel is on the right, so leftwards widens
  if (Math.abs(dx) > 2) panelDrag.moved = true;
  applyPanelWidth(panelDrag.startW + dx, false);   // one write at the end, not one per frame
}

function onPanelResizeUp() {
  if (!panelDrag) return;
  var moved = panelDrag.moved;
  panelDrag = null;
  document.body.classList.remove('panel-resizing');
  var h = panelResizeEl();
  if (h) h.classList.remove('dragging');
  if (moved) {
    // A deliberate drag is the user choosing a width. It becomes the width Wide
    // returns to, and Wide stops claiming to be the reason the panel is wide.
    panelWide = false;
    panelRestore = panelWidth;
    syncPanelWideBtn();
  }
  savePanelPrefs();
}

function onPanelResizeDouble() {
  panelWide = false;
  panelRestore = PANEL_DEFAULT;
  applyPanelWidth(PANEL_DEFAULT);
  syncPanelWideBtn();
}

/* The handle is a focusable separator, so it answers the arrow keys too. This
   is the only way to reach the width without a mouse. */
function onPanelResizeKey(e) {
  var step = e.shiftKey ? 40 : 10;
  if (e.key === 'ArrowLeft')       { e.preventDefault(); nudgePanel(step); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); nudgePanel(-step); }
  else if (e.key === 'Home')       { e.preventDefault(); onPanelResizeDouble(); }
}
function nudgePanel(by) {
  panelWide = false;
  applyPanelWidth(panelWidth + by);
  panelRestore = panelWidth;
  syncPanelWideBtn();
}

(function wirePanelResize() {
  var h = panelResizeEl();
  if (!h) return;
  h.addEventListener('mousedown', onPanelResizeDown);
  h.addEventListener('dblclick', onPanelResizeDouble);
  h.addEventListener('keydown', onPanelResizeKey);
  document.addEventListener('mousemove', onPanelResizeMove);
  document.addEventListener('mouseup', onPanelResizeUp);
  loadPanelPrefs();
})();

// Panning and marquee use screen-space maths against the canvas box, and zoomed
// out far enough the world is centred rather than pinned — both need revisiting
// when the canvas changes size. A narrower window also lowers the ceiling on
// the panel, so the stored width is re-clamped rather than left overhanging.
window.addEventListener('resize', function() {
  applyPanelWidth(panelWidth, false);
  clampPan();
  applyView();
});

var panelEl = document.getElementById('panelBody');
if (panelEl) panelEl.addEventListener('input', onExportNameInput);

var loadInput = document.getElementById('loadFile');
if (loadInput) loadInput.addEventListener('change', onGraphFileChosen);

/* The two data pickers. Shared by every Source rather than one pair per node:
   which node asked is carried on the input itself by pickHeadersFile(), and a
   dozen Sources would otherwise mean two dozen hidden inputs in the document
   for one dialog at a time. */
var headersInput = document.getElementById('headersFile');
if (headersInput) headersInput.addEventListener('change', onHeadersChosen);

var yearsInput = document.getElementById('yearFiles');
if (yearsInput) yearsInput.addEventListener('change', onYearFilesChosen);

/* The dialog's buttons are wired in the markup like the rest of the toolbar,
   but the field's keys are not something an attribute expresses well. Enter is
   handled here rather than by a <form>: there is no form on this page, and
   adding one would bring a submit-and-navigate default that has to be
   suppressed anyway. */
/* HELP
   ---------------------------------------------------------------------------
   The content is markup in the page, not a string built here, so this is only
   opening, closing and moving around it. */
function helpDialogEl() { return document.getElementById('helpDialog'); }
function helpOpen() {
  var d = helpDialogEl();
  return !!(d && d.classList.contains('open'));
}

// The control that opened it, so focus can go back where it came from.
var helpOpener = null;

function openHelp(btn) {
  var d = helpDialogEl();
  if (!d) return;
  helpOpener = btn || document.querySelector('.help-btn');
  d.classList.add('open');
  syncHelpNav();
  // Focus the scrolling region rather than the first link, so Page Down and the
  // arrow keys work the moment it opens — the common case is reading, not
  // tabbing to a section.
  var body = document.getElementById('helpBody');
  if (body) { body.setAttribute('tabindex', '-1'); body.focus(); }
}

function closeHelp() {
  var d = helpDialogEl();
  if (d) d.classList.remove('open');
  // Focus must leave the panel, not merely be hidden with it. Left inside a
  // closed dialog it belongs to nothing on screen, and the keyboard user is
  // stranded with no visible caret and no working shortcuts.
  var btn = helpOpener;
  helpOpener = null;
  if (btn && btn.focus) btn.focus();
}

function scrollHelpTo(id) {
  var el = document.getElementById(id);
  if (el) el.scrollIntoView({ block: 'start' });
}

/* Marks the section currently under the top of the reading area. Driven by
   scroll rather than by which link was last clicked, so it stays honest when
   the user scrolls by hand instead of navigating. */
function syncHelpNav() {
  var body = document.getElementById('helpBody');
  var nav = document.getElementById('helpNav');
  if (!body || !nav) return;
  var secs = body.querySelectorAll('section');
  var current = secs.length ? secs[0].id : '';
  for (var i = 0; i < secs.length; i++) {
    // 24px of slack, so a section counts as current just before its heading
    // reaches the edge rather than just after.
    if (secs[i].offsetTop - body.scrollTop <= 24) current = secs[i].id;
  }
  var items = nav.querySelectorAll('.help-navitem');
  for (var j = 0; j < items.length; j++) {
    items[j].classList.toggle('current', items[j].getAttribute('data-goto') === current);
  }
}

var helpNavEl = document.getElementById('helpNav');
if (helpNavEl) {
  helpNavEl.addEventListener('click', function(e) {
    var btn = e.target.closest ? e.target.closest('.help-navitem') : null;
    if (btn) scrollHelpTo(btn.getAttribute('data-goto'));
  });
}
var helpBodyEl = document.getElementById('helpBody');
if (helpBodyEl) helpBodyEl.addEventListener('scroll', syncHelpNav);

/* Same backdrop rule as the save dialog: a press that starts and ends on the
   backdrop dismisses, a drag that began on the card does not. */
var helpDlgEl = helpDialogEl();
if (helpDlgEl) {
  var helpBackdropPress = false;
  helpDlgEl.addEventListener('mousedown', function(e) {
    helpBackdropPress = (e.target === helpDlgEl);
  });
  helpDlgEl.addEventListener('mouseup', function(e) {
    if (helpBackdropPress && e.target === helpDlgEl) closeHelp();
    helpBackdropPress = false;
  });
}

/* Clicking away cancels, but only a press that both starts and ends on the
   backdrop counts. Checking the target on mousedown alone is not enough: a
   drag that begins inside the card — selecting the name by dragging across it,
   and overshooting — releases on the backdrop, and treating that as clicking
   away would discard the name mid-edit. */
var saveDialogEl_ = document.getElementById('saveDialog');
if (saveDialogEl_) {
  var backdropPress = false;
  saveDialogEl_.addEventListener('mousedown', function(e) {
    backdropPress = (e.target === saveDialogEl_);
  });
  saveDialogEl_.addEventListener('mouseup', function(e) {
    if (backdropPress && e.target === saveDialogEl_) closeSaveDialog();
    backdropPress = false;
  });
}

var saveNameEl = document.getElementById('saveName');
if (saveNameEl) {
  saveNameEl.addEventListener('input', updateSaveHint);
  saveNameEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter')  { e.preventDefault(); confirmSaveGraph(); }
    // Escape is left to the document handler above, so cancelling behaves the
    // same whether or not the field happens to hold focus.
  });
}

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
  // Anything inside a panel or the save dialog counts, control or not: those
  // are the only places on screen where a keystroke could plausibly have been
  // meant as text. The dialog is listed even though its only focusable field is
  // an INPUT already caught above, because the guard is also asked about
  // document.activeElement, and a click on the dialog's own chrome moves focus
  // off the input while the dialog is still open.
  return !!(t.closest && t.closest('.node-config, .output-panel, .save-dialog'));
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
    // The dialog is modal, so it consumes the key. Without this, cancelling a
    // save would also clear the selection underneath it — a second, unasked-for
    // change from a keystroke that meant "never mind".
    if (saveDialogOpen()) { e.preventDefault(); closeSaveDialog(); return; }
    if (helpOpen())       { e.preventDefault(); closeHelp(); return; }
    closeProcMenu();
    clearSelection();
    return;
  }

  /* Help is modal, so nothing below here applies while it is open. Without
     this, reading the shortcut table with the canvas behind you would let a
     stray F or Delete rearrange or destroy the graph you came here to learn
     about. Escape above is the deliberate exception: it closes it. */
  if (helpOpen()) return;
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
  if (e.key === 'w' || e.key === 'W') { if (!mod) { e.preventDefault(); togglePanelWide(); } return; }
  // Shift-slash on most layouts, so no modifier check: '?' is already shifted.
  if (e.key === '?') { e.preventDefault(); openHelp(); return; }
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
window.saveGraph = saveGraph;
window.closeSaveDialog = closeSaveDialog;
window.openHelp = openHelp;
window.closeHelp = closeHelp;
window.confirmSaveGraph = confirmSaveGraph;
window.openGraphFile = openGraphFile;
window.pickHeadersFile = pickHeadersFile;
window.pickYearFiles = pickYearFiles;
window.clearSourceData = clearSourceData;
window.removeSourceYear = removeSourceYear;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.zoomReset = zoomReset;
window.zoomToFit = zoomToFit;
window.togglePanelWide = togglePanelWide;
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
  /* The suites run against the dataset the tool used to generate for itself.
     Installing it here, behind the same flag that publishes the internals,
     means a real page reaches neither: it opens with no data, and a Source
     without files refuses to run. See the loader section for why the generator
     was kept rather than the several hundred assertions written against it
     being rewritten to talk about the archive instead. */
  installSyntheticDataset();

  window.__qb = {
    // live state
    nodes: function(){ return nodes; },
    connections: function(){ return connections; },
    exportData: function(){ return exportData; },
    isFresh: function(){ return resultsFresh; },
    findNode: findNode,
    setCfg: setCfg,
    render: render,
    // test convenience: wire two nodes without simulating a drag. The port
    // defaults to the target's primary input, so existing tests that predate
    // ports keep working unchanged.
    connect: function(a, b, color, port) {
      var to = findNode(b);
      connections.push({
        from: a, to: b,
        port: port || (to ? primaryPort(to.type) : 'in'),
        color: color || '#ffffff'
      });
    },

    // ports
    NODE_PORTS: NODE_PORTS, portsOf: portsOf, primaryPort: primaryPort,
    portDef: portDef, normalisePort: normalisePort, wiresInto: wiresInto,
    portAccepts: portAccepts, freePortsOn: freePortsOn,
    portOffsetY: portOffsetY, shapeEntry: shapeEntry, shapeExit: shapeExit,
    nearestFreePort: nearestFreePort, resolveDirection: resolveDirection,
    inputsOf: inputsOf, connKey: connKey, removeConnection: removeConnection,

    // data layer
    STUDENTS: STUDENTS, COURSES: COURSES, SUBJECTS: SUBJECTS, SPECS: SPECS, YEARS: YEARS,
    COURSE_BY_CODE: COURSE_BY_CODE, CORE_COURSES: CORE_COURSES, COURSES_PER_YEAR: COURSES_PER_YEAR,
    SPEC_SUBJECTS: SPEC_SUBJECTS, SUBJECT_WEIGHTS: SUBJECT_WEIGHTS, subjectWeight: subjectWeight,
    rebuildRegistries: rebuildRegistries, defaultCourse: defaultCourse,
    defaultSubject: defaultSubject, defaultLevel: defaultLevel,
    DEGREES: DEGREES, LEVELS: LEVELS, courseLevel: courseLevel,

    // loading the archive: admission, parsing, and per-source state
    DATA_HEADERS_NAME: DATA_HEADERS_NAME, DATA_YEAR_RE: DATA_YEAR_RE,
    DATA_YEAR_MIN: DATA_YEAR_MIN, DATA_YEAR_MAX: DATA_YEAR_MAX,
    MAX_DATA_FILE_BYTES: MAX_DATA_FILE_BYTES, MAX_DATA_ROWS: MAX_DATA_ROWS,
    MAX_FIELD_CHARS: MAX_FIELD_CHARS, MAX_COURSE_POINTS: MAX_COURSE_POINTS,
    REQUIRED_HEADER_COLUMNS: REQUIRED_HEADER_COLUMNS,
    dataFileName: dataFileName, headersFileProblem: headersFileProblem,
    yearFileProblem: yearFileProblem, yearOfFile: yearOfFile,
    parseHeaderFile: parseHeaderFile, parseYearFile: parseYearFile,
    calendarYearOf: calendarYearOf, buildDataset: buildDataset,
    loadHeadersFor: loadHeadersFor, loadYearFilesFor: loadYearFilesFor,
    removeSourceYear: removeSourceYear, parsedYearsOf: parsedYearsOf,
    yearFileNameFor: yearFileNameFor, applyDatasetToNode: applyDatasetToNode,
    MAX_YEAR_FILES: MAX_YEAR_FILES,
    clearSourceData: clearSourceData, clearAllSourceData: clearAllSourceData,
    forgetSourceData: forgetSourceData,
    datasetFor: datasetFor, hasSourceData: hasSourceData, datasetCfg: datasetCfg,
    headerFor: headerFor, sourceDataError: sourceDataError, sourceTable: sourceTable,
    sourceFilesHTML: sourceFilesHTML,
    sourceData: function(){ return SOURCE_DATA; },
    pendingHeaders: function(){ return PENDING_HEADERS; },
    sourceNotice: function(id){ return SOURCE_NOTICE[id] || null; },
    syntheticDataset: function(){ return SYNTHETIC_DATASET; },
    setSyntheticDataset: setSyntheticDataset,
    installSyntheticDataset: installSyntheticDataset,

    // table primitives
    COLTYPE: COLTYPE, STUDENT_COLUMNS: STUDENT_COLUMNS,
    makeTable: makeTable, colIndex: colIndex, colByKey: colByKey,
    hasCol: hasCol, cellAt: cellAt, headerOnly: headerOnly, numericCols: numericCols,
    coursesColIndex: coursesColIndex, studentsTable: studentsTable,
    fmtCell: fmtCell, exportCell: exportCell, cellTitle: cellTitle,
    schemaKey: schemaKey, rowKey: rowKey,

    // engine
    topoSort: topoSort, evaluateGraph: evaluateGraph, computeSchemas: computeSchemas,
    NODE_SPEC: NODE_SPEC, specFor: specFor, SHAPE: SHAPE, passthroughSchema: passthroughSchema,
    inputSchema: inputSchema, unionTables: unionTables, filterFields: filterFields,
    fieldByKey: fieldByKey, applyFilter: applyFilter, applyCriterion: applyCriterion,
    opsFor: opsFor, defaultOpFor: defaultOpFor, OP_FNS: OP_FNS, OP_SYM: OP_SYM,
    NUM_OPS: NUM_OPS, ENUM_OPS: ENUM_OPS, ORDERED_OPS: ORDERED_OPS,
    isRangeable: isRangeable, numericValues: numericValues, rankerFor: rankerFor,
    critValue: critValue, critOp: critOp, critHigh: critHigh, critRange: critRange,
    rangeKey: rangeKey, isBlank: isBlank,
    newCriterion: newCriterion, defaultCfg: defaultCfg,
    normaliseShow: normaliseShow, outputTable: outputTable, defaultAvgCol: defaultAvgCol,
    meanOf: meanOf, MEASURES: MEASURES,

    // sort
    applySort: applySort, sortableCols: sortableCols, comparatorFor: comparatorFor,
    sortRowComparator: sortRowComparator,
    resolveSortKeys: resolveSortKeys, newSortKey: newSortKey, dirLabel: dirLabel,
    ordinalsFor: ordinalsFor, GRADE_ORDER: GRADE_ORDER,
    GRADE_POINTS: GRADE_POINTS, gradePoint: gradePoint, gpaOf: gpaOf,
    gradeFromGpa: gradeFromGpa,

    // combine
    COMBINE_MODES: COMBINE_MODES, combineMode: combineMode, combineTables: combineTables,
    combineBaseId: combineBaseId, combineKeyCol: combineKeyCol, combineKeyCols: combineKeyCols,
    upstreamLabel: upstreamLabel,

    // aggregation
    AGG_OPS: AGG_OPS, aggOp: aggOp, reduceValues: reduceValues,
    measurableCols: measurableCols, isMeasurable: isMeasurable,
    aggregateCol: aggregateCol, aggregateColumn: aggregateColumn,
    aggregateSchema: aggregateSchema, applyAggregate: applyAggregate,
    aggregateColumnsSchema: aggregateColumnsSchema,
    applyAggregateColumns: applyAggregateColumns,
    aggregateRowsColumn: aggregateRowsColumn, aggregateRowsSchema: aggregateRowsSchema,
    aggregateRowsIdx: aggregateRowsIdx, applyAggregateRows: applyAggregateRows,
    outputCols: outputCols,
    columnValues: columnValues,

    // unique
    uniqueCols: uniqueCols, uniqueCol: uniqueCol, uniqueCellKey: uniqueCellKey,
    uniqueSchema: uniqueSchema, applyUnique: applyUnique,
    selectedCols: selectedCols, selectSchema: selectSchema, applySelect: applySelect,
    canProject: canProject, projectCarried: projectCarried, projectColumns: projectColumns,
    projectSchema: projectSchema, applyProject: applyProject,
    enrolmentColumns: enrolmentColumns, enrolmentKeys: enrolmentKeys,
    combineOrder: combineOrder, joinColumns: joinColumns, joinTables: joinTables,

    // take
    applyTake: applyTake, takeCount: takeCount,
    TAKE_DEFAULT: TAKE_DEFAULT, TAKE_MIN: TAKE_MIN,
    canConnect: canConnect, CONNECT_RULES: CONNECT_RULES,

    // edge preview. The column cap is paired with a width in the stylesheet,
    // so it is exported to be asserted on rather than trusted to stay in step.
    PREVIEW_COLS: PREVIEW_COLS, PREVIEW_ROWS: PREVIEW_ROWS,
    previewColumns: previewColumns, previewTableHTML: previewTableHTML,
    edgeData: edgeData,

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
    exportNameOf: exportNameOf, defaultExportName: defaultExportName, markStale: markStale,
    timeStamp: timeStamp, resultHTML: resultHTML, scalarHTML: scalarHTML, tableHTML: tableHTML,
    courseLabel: courseLabel, courseTitle: courseTitle, courseSelect: courseSelect,
    serialiseGraph: serialiseGraph, deserialiseGraph: deserialiseGraph,
    applyGraph: applyGraph, loadGraphFromText: loadGraphFromText,
    FILE_KIND: FILE_KIND, FILE_VERSION: FILE_VERSION,

    // naming and file admission
    queryFileName: queryFileName, defaultQueryName: defaultQueryName,
    stripQueryExt: stripQueryExt,
    lastQueryName: function(){ return lastQueryName; },
    writeQueryFile: writeQueryFile, graphFileProblem: graphFileProblem,
    openSaveDialog: openSaveDialog, closeSaveDialog: closeSaveDialog,
    confirmSaveGraph: confirmSaveGraph, saveDialogOpen: saveDialogOpen,
    updateSaveHint: updateSaveHint,
    openHelp: openHelp, closeHelp: closeHelp, helpOpen: helpOpen,
    syncHelpNav: syncHelpNav, scrollHelpTo: scrollHelpTo,
    QUERY_EXT: QUERY_EXT, MAX_QUERY_FILE_BYTES: MAX_QUERY_FILE_BYTES
  };
}

// The world layer needs its size and transform before the first paint, or the
// first frame shows an unsized viewport and the nodes jump when it settles.
applyView();
centreView();
render();
})();
