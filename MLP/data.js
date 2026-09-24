/* ============================================================================
   DATA: The archive, and the one type that travels on a wire
   ============================================================================
   The dataset registries, file admission, the parser, what a Source holds, and
   the Table type every node hands to the next. Nothing in here touches the DOM
   except failSource(), which asks for a repaint after it has said no.
   ============================================================================
   Part of the query builder. LOAD ORDER MATTERS: data.js, engine.js, ui.js.
   See querybuilder_MMP.html. These are deliberately NOT ES modules; the tool is
   opened from Finder at file://, where module scripts are fetched with CORS
   against an opaque origin and refused. Classic scripts sharing one global
   scope are what works there, which is why nothing here is wrapped in an IIFE
   and why a name declared in one file is visible in the next.                */

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

   They are the UNION across every Source. Rows stay per-Source (two Sources
   holding two different exports each answer about their own), but a dropdown
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
   unloaded. Cheap enough to do wholesale (a few thousand enrolments), and a
   great deal easier to reason about than incremental bookkeeping. */
function rebuildRegistries() {
  var seenSpec = {}, seenDeg = {}, seenYear = {}, seenSubj = {}, seenLvl = {}, seenCode = {};
  STUDENTS.length = 0; SPECS.length = 0; DEGREES.length = 0; YEARS.length = 0;
  SUBJECTS.length = 0; LEVELS.length = 0; COURSES.length = 0;
  Object.keys(COURSE_BY_CODE).forEach(function(k){ delete COURSE_BY_CODE[k]; });

  loadedDatasets().forEach(function(d) {
    /* A table Source contributes nothing here, and that is not a gap being
       tolerated: these registries are the archive's vocabulary, the specs, the
       degrees, the years and the course catalogue that a Filter's dropdowns are
       built from. A file of bands or labels has no students to have any of
       those. Skipped explicitly rather than guarded per property, because
       "a table has no students" is one fact and eight `|| []`s would be the
       same fact written badly. */
    if (isTableDataset(d)) return;
    (d.students || []).forEach(function(s) {
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
   already follows. Both are properties OF the code, and reading them out of it
   keeps them true for a course this catalogue has never seen.

   Worth having because the archive is not the honours-only year the built-in
   dataset pretended: 2022 alone carries 697 enrolments at 100-level and 454 at
   400-level. Averaging those together without being able to see the difference
   is the kind of answer that is wrong without looking wrong. */
function courseLevel(code) {
  var m = /\d/.exec(String(code == null ? '' : code));
  return m ? parseInt(m[0], 10) : null;
}

/* SYNTHETIC DATASET: Reachable only from the test harness
   ---------------------------------------------------------------------------
   This was the dataset the tool shipped with, and it is now what the suites run
   against: several hundred assertions are written in terms of its forty
   students a year, its six specialisation names and its seeded GPAs, and
   rewriting them against the archive would have changed what those tests say
   rather than what they check.

   installSyntheticDataset() is called from the __QB_TEST__ block at the foot of
   this file and from nowhere else, so a production page never reaches any of
   it. The Source falls back to it only when it holds no files of its own,
   which, with the flag unset, is a fallback to null and therefore an error. */
var SYN_SPECS = ["Software Engineering","Computer Science","Information Technology","Data Science","Cybersecurity","Artificial Intelligence"];
var G22 = [78,82,91,65,88,72,95,55,83,70,61,79,86,73,90,68,77,84,62,92,75,80,58,87,71,94,66,85,76,89,63,74,81,93,69,78,85,72,60,88];
var G23 = [82,85,78,70,91,76,88,60,86,74,65,83,89,77,92,71,80,87,66,95,78,84,62,90,75,97,70,88,80,93,67,78,84,96,73,82,88,76,63,91];

/* THE GRADE MODEL
   The archive records a letter Grade and the course's Pts. It does not record a
   percentage mark, so there is no numeric column to average. Every numeric
   question about attainment ("average grade", "better than", "in this range")
   therefore has to be answered in the grade points the university itself
   assigns, not in marks the data does not contain.

   Te Herenga Waka's scale is nine points, and its GPA is weighted by course
   points: sum(gradePoint x points) / sum(points). Every failing grade is worth
   zero, which is why D, E and K share a value: they are different reasons for
   the same outcome. The letter travels alongside the number so the reason is
   never lost. Sorting still distinguishes a D from an E even though averaging
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
   are left out of the GPA entirely, which is what the university does, and
   what the supervisor confirmed. */
function gradePoint(g) {
  var p = GRADE_POINTS[String(g === undefined || g === null ? '' : g).trim()];
  return p === undefined ? null : p;
}

/* Points-weighted, so a 30-point ENGR489 counts twice a 15-point course.
   Rounded to two places because a GPA is a summary and the third decimal is
   noise. A student with nothing graded has no GPA at all. Null for the same
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
   Indexed by grade point, so the array position IS the value. 7 is an A-, the
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
   replacing this array with the real catalogue (more courses, new prefixes)
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

// Taken by everyone regardless of specialisation: The project and the
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
   returns 23 today. Screenshots, notes and marking stay reproducible. */
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
   it exactly. The mark itself never reaches a table (it is the latent ability
   score the letter grade is drawn from, the same way a real generator would
   work), so keeping the mean intact is what makes the resulting GPA land near
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
   LOADING THE ARCHIVE: Admission, parsing, and what a Source holds
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
   Every cell that survives this module reaches the DOM: The results table, the
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
     4. CONTENT   NUL and other C0 control characters are refused outright. No
                  legitimate export contains them, and they are how a payload
                  hides from a reader. Fields are capped, rows are capped, the
                  ID must be digits, Pts must be a small non-negative number,
                  and the Year column must agree with the year in the FILE NAME.
                  That last one is the integrity check with teeth: a file called
                  mcs-students-2022 whose rows say 202301 is not the 2022 data
                  and is not treated as though it were.

   None of this replaces escaping. Esc() still runs on every value on its way
   into markup, because defence at the boundary and defence at the sink are
   different jobs. What it does is keep the boundary narrow enough to describe
   in a sentence: two file names, a fixed column count, and printable text.

   WHY PER SOURCE
   ---------------------------------------------------------------------------
   A Source owns its files. Two Sources can hold two different exports and each
   answers about its own rows, which is what makes "last year's archive against
   this year's" a graph rather than two sessions. The registries above are the
   union across all of them, for dropdowns only. See rebuildRegistries().

   WHY THE DATA IS NEVER SAVED
   ---------------------------------------------------------------------------
   A saved query records the NAMES of the files a Source was given and not one
   byte of their contents. Three reasons, and the first is sufficient on its
   own: the archive is student records, and a query file gets emailed around.
   The second is that a query is meant to be re-run against next year's data, so
   baking in a snapshot defeats the point. The third is that a .json file is
   trusted no further than any other input. Data pasted into it would arrive
   already parsed, past every check in this module.

   So loading a query re-creates the graph and clears the data, and the Source
   panel then names the files it wants. That is not an inconvenience to be
   engineered away; it is the file-picker grant being asked for again, by the
   user, for files this session has not been given.                           */

var DATA_HEADERS_NAME = 'headers.txt';

/* THE HEADER NAMING SCHEME
   ---------------------------------------------------------------------------
   The supervisor's, from his email of 2026-09-24:

     "it might be nice to use the format 'headers-<data file name>.txt' so that
      multiple data files and their headers could be in the same directory. If
      every header file is named 'header.txt' then one needs one directory per
      data format."

   So both are accepted: the plain name, which the archive already uses, and the
   qualified one, which lets a folder hold a band file, a label list and the
   archive side by side. Which of the two a Source was handed is remembered only
   so the panel can name it; nothing downstream cares.

   The qualified form is NOT enforced against the data file's name. The pairing
   is for the user's filesystem, not for this tool to police, and refusing a
   header for being called the wrong thing is the class of refusal he asked to
   be rid of. */
var HEADER_NAME_RE = /^headers(?:-(.+))?\.txt$/i;

function isHeaderFileName(name) { return HEADER_NAME_RE.test(String(name || '')); }

/* The header a data file would be paired with under the scheme. Used by the
   panel to say what to look for, never to refuse anything. */
function headerNameFor(dataName) { return 'headers-' + String(dataName || '') + '.txt'; }

/* The data file a qualified header names, or '' for the plain form. */
function headerTargetOf(headerName) {
  var m = HEADER_NAME_RE.exec(String(headerName || ''));
  return (m && m[1]) ? m[1] : '';
}

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
   this archive. The longest is an email address. Both exist so that a file
   which passed the name check cannot still arrive as a denial of service or as
   a single cell that unbalances every table it appears in. */
var MAX_DATA_ROWS   = 250000;
var MAX_FIELD_CHARS = 512;

/* A header wider than this is not a table anyone is going to read, and every
   column becomes a control in a panel and a cell in the DOM. The archive's own
   header is 27 columns, so this is an order of magnitude of room. It replaces
   nothing: there was no ceiling before, because the fixed column list was the
   ceiling. */
var MAX_HEADER_COLUMNS = 256;

/* One Source accumulates year files, so there has to be a ceiling on how many.
   Fifty is longer than the archive has existed and longer than any question
   anyone will ask of it, and it matches the cap the saved descriptor applies to
   the same list. Two limits on one thing that disagreed would mean a Source
   holding a year its own saved query could not name. */
var MAX_YEAR_FILES = 50;

/* A course is worth points; nothing in this catalogue is worth more than a
   double-weight honours project, and a number outside this range means the
   column has been misread rather than that the course is unusual. */
var MAX_COURSE_POINTS = 200;

/* The columns this tool reads. `deg1` joined them when the archive turned out
   to hold three degrees rather than the single honours programme the built-in
   dataset assumed, and it is a student-level fact: no student in either year
   carries two of them, or changes between years. Everything else in the file
   (the names, the usernames, the email addresses, the ethnicity) is parsed past
   and dropped on the floor. It is not needed to answer any of the supervisor's questions, and
   the least exposed way to hold personal data is not to hold it. */
var REQUIRED_HEADER_COLUMNS = ['ID', 'gender', 'deg1', 'maj1', 'Year', 'Crse', 'Grade', 'Pts'];

/* WHAT THIS LIST IS NOW FOR, WHICH IS NOT WHAT IT WAS FOR
   ---------------------------------------------------------------------------
   It used to be an admission gate: a header without these columns was refused
   as "too few to be the archive header", and that refusal is what stopped a
   one-column list of labels being loadable at all.

   The supervisor asked for it to go: "We do not need to cater for misshaped
   input. The input files all come from a certain source and will always have
   the right format", and "having just one source node that is capable of
   reading data from a file with various numbers of columns seems more
   parsimonious and simpler. Users would not have to wonder which node kind
   they'll need. A single Source node kind can automatically adapt to whatever
   the input format is."

   So the list stops deciding whether a file may be read and starts deciding HOW
   it is read. A header carrying all of these describes the archive, and its
   rows are folded into students with their courses nested. Any other header
   describes a table, and its rows come through as they are. One node, two
   shapes, chosen by looking rather than by asking.

   WHAT DID NOT GO WITH IT
   The size cap, the control-character refusal, the row and field caps and the
   path-segment stripping all stay. They do not reject a differently shaped
   file; they reject a hostile one, and his ruling is about shape. Every cell
   that survives this module still reaches the DOM. */
function headerIsArchive(header) {
  if (!header || !header.byName) return false;
  return REQUIRED_HEADER_COLUMNS.every(function(c){ return c in header.byName; });
}

/* C0 controls except tab, newline and carriage return, plus DEL. Tested against
   the whole file before it is split, because the cheapest place to refuse a
   file is before it has become anything more structured than a string. */
var CONTROL_CHAR_RE = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]');

/* PER-SOURCE STATE: Deliberately not part of the node model
   ---------------------------------------------------------------------------
   Keyed by node id and reset by applyGraph(), so it cannot travel through a
   saved file or survive a load. Keeping it out of `node.cfg` is what makes
   "the query is saved, the data is not" true by construction rather than by
   remembering to strip a field on the way out. */
var SOURCE_DATA = {};

/* A header accepted but not yet paired with any year file. Held apart from
   SOURCE_DATA because a header on its own is not a dataset (there is nothing
   to run a query against until a year file arrives), and the panel should say
   so rather than showing a Source that looks ready. */
var PENDING_HEADERS = {};

/* The last thing that happened on this Source, shown under its file list: an
   error to fix, or a confirmation of what went in. Transient, per node, and
   never serialised. */
var SOURCE_NOTICE = {};

/* The synthetic dataset, installed only under __QB_TEST__ and null otherwise.
   A Source with no files of its own falls back to it, which in a real page is a
   fallback to nothing, and therefore the error this feature exists to raise. */
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
    cfg.dataset = { headers:'', years:[], file:'' };
  }
  if (typeof cfg.dataset.headers !== 'string') cfg.dataset.headers = '';
  if (!Array.isArray(cfg.dataset.years)) cfg.dataset.years = [];
  /* The table path's counterpart to `years`: one name rather than a list, for
     the reason buildTableDataset() gives. Added rather than replacing `years`,
     so a query saved before this existed still names its year files and opens
     saying what it wants. */
  if (typeof cfg.dataset.file !== 'string') cfg.dataset.file = '';
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
  if (!isHeaderFileName(name)) {
    return 'A column file is named "' + DATA_HEADERS_NAME + '", or "headers-" ' +
      'then the name of the data file it describes and ".txt". "' + name +
      '" is neither, so nothing has been read from it.';
  }
  return sizeProblem(file, 'column file');
}

/* A DATA FILE IS ANY FILE THAT IS NOT A COLUMN FILE
   ---------------------------------------------------------------------------
   This replaces a check that required the name "mcs-students-" plus a year. The
   year is still read from the name where the name carries one, because the
   archive's files are named that way and the agreement check in parseYearFile()
   is worth keeping for them. It is no longer REQUIRED, which is the change: a
   file called course-labels.txt is now an ordinary thing to hand a Source.

   The one name still refused is a column file's, and only to catch the two
   pickers being used the wrong way round. That is a mis-click with a clear
   message, not a judgement about the file's shape. */
function dataFileProblem(file) {
  if (!file) return 'No file was chosen.';
  var name = dataFileName(file);
  if (isHeaderFileName(name)) {
    return '"' + name + '" is a column file, not a data file. Choose it with ' +
      'the column file button above.';
  }
  var y = yearOfFile(file);
  if (y !== null && (y < DATA_YEAR_MIN || y > DATA_YEAR_MAX)) {
    return '"' + name + '" claims the year ' + y + ', which is outside ' +
      DATA_YEAR_MIN + ' to ' + DATA_YEAR_MAX + '. Nothing has been read from it.';
  }
  return sizeProblem(file, 'data file "' + name + '"');
}

/* The year lives in the name, and the name is the only place the tool will take
   it from. Deriving it from the contents instead would mean trusting the file
   to say which year it is, and then the agreement check in parseYearFile()
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
  /* ANY number of columns, down to one. The refusal that used to live here
     ("too few to be the archive header") is the one the supervisor asked to be
     rid of, and it is what made a one-column list of labels unloadable. What
     the columns ARE now decides how the file is read, not whether it may be.
     See headerIsArchive(). */
  if (!names.length || names[0] === '') {
    return { error: 'The column file has no column names in it.' };
  }
  if (names.length > MAX_HEADER_COLUMNS) {
    return { error: 'The column file declares ' + names.length + ' columns, past the ' +
      MAX_HEADER_COLUMNS + ' this tool will read.' };
  }

  /* The index line is optional (a header trimmed to its names alone is still a
     usable header), but if it is there it has to be right. Present and wrong is
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
     degree. The one every other column on the row is about. */
  var byName = {};
  names.forEach(function(n, i) { if (!(n in byName)) byName[n] = i; });

  return { name: dataFileName({ name: name }), columns: names, byName: byName };
}

/* The Year column reads 202201: a calendar year and a trimester. Only the year
   half is used (the trimester is already in Sem), and it has to be the year
   the FILE NAME claims. */
function calendarYearOf(raw) {
  var v = String(raw == null ? '' : raw).trim();
  if (!/^\d{4}(\d{2})?$/.test(v)) return null;
  return parseInt(v.slice(0, 4), 10);
}

/* One year file to a list of students, enrolments nested. The same shape the
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
       answers null for anything off the scale (the same answer it gives a
       dropped course's blank), so the row is safe to keep and the GPA stays
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

/* ============================================================================
   READING A FILE THAT IS NOT THE ARCHIVE
   ============================================================================
   The other half of the supervisor's generalisation. A header that does not
   carry the archive's columns describes an ordinary table, and this reads one:
   whatever columns the header names, whatever rows the file holds, no folding,
   no student, no year.

   It is what makes a list of labels or a file of named bands loadable, and it
   is the route the bands on SelectFor's labels port were built for.

   THREE THINGS IT WORKS OUT RATHER THAN DEMANDS
   His instruction was that a mismatch should be a warning "if it can be
   rectified by ignoring data, or otherwise automatically fixing the mismatch",
   so each of these adapts and says so rather than refusing:

     THE SEPARATOR. Tab, comma, or runs of spaces, whichever splits the first
     row into as many fields as the header names. The archive is tabs; a band
     file somebody typed is likelier to be spaces, and the header file itself is
     space separated, so accepting both is the consistent answer.

     RAGGED ROWS. A row with too many fields is trimmed, one with too few is
     padded with blanks, and the count of both is reported. Refusing the file
     was the old behaviour and it is the behaviour he objected to.

     COLUMN TYPES. A header names columns; it does not say what is in them. A
     column whose every non-blank cell reads as a number becomes a number
     column, and the cells become numbers. Without this a band file's minimum
     and maximum would arrive as text, and SelectFor could not tell a band table
     from a list of labels: the detection there reads column types. */

/* Whichever separator splits the sample into the width the header declares.
   Tab first because the archive uses it and because a tab-separated file that
   also contains commas would otherwise be split wrongly by the comma rule. */
var DATA_SEPARATORS = [
  { key:'tab',   label:'tabs',   re:/\t/ },
  { key:'comma', label:'commas', re:/,/ },
  { key:'space', label:'spaces', re:/[ \t]+/ }
];

function detectSeparator(lines, width) {
  var sample = null;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i] !== '' && lines[i].trim() !== '') { sample = lines[i]; break; }
  }
  if (sample === null) return DATA_SEPARATORS[0];
  for (var j = 0; j < DATA_SEPARATORS.length; j++) {
    if (sample.split(DATA_SEPARATORS[j].re).length === width) return DATA_SEPARATORS[j];
  }
  /* Nothing splits it to the declared width. Tab is the archive's separator and
     the honest default: the rows will come out ragged and the count of that is
     reported, which is a better answer than picking whichever separator
     produced the most fields. */
  return DATA_SEPARATORS[0];
}

/* A single column's type, from the cells actually in it. TEXT for an empty
   column: claiming a column of nothing holds numbers is a guess about data that
   is not there, and TEXT is the type that constrains nothing downstream. */
function inferColumnType(rows, i) {
  var sawValue = false;
  for (var r = 0; r < rows.length; r++) {
    var v = rows[r][i];
    if (v === '' || v === null || v === undefined) continue;
    sawValue = true;
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(String(v).trim())) {
      return COLTYPE.TEXT;
    }
  }
  return sawValue ? COLTYPE.NUMBER : COLTYPE.TEXT;
}

function parseTableFile(text, header, name) {
  var problem = controlCharProblem(text, 'data file');
  if (problem) return { error: problem };

  var lines = String(text).split(/\r?\n/);
  var width = header.columns.length;
  var sep = detectSeparator(lines, width);

  /* Counted before anything is built. The row cap used to be enforced inside
     the loop, which meant a file of a million rows was a quarter of a million
     row arrays in memory before it was refused: the cap held, and the refusal
     cost as much as reading the file would have. Counting first allocates
     nothing, and a file past the cap is turned away before the first row
     exists. */
  var n = 0;
  for (var c = 0; c < lines.length; c++) {
    if (lines[c] !== '' && lines[c].trim() !== '') n++;
  }
  if (n > MAX_DATA_ROWS) {
    return { error: '"' + name + '" holds ' + n + ' rows, past the ' + MAX_DATA_ROWS +
      ' this tool will read.' };
  }

  var rows = [], ragged = 0, trimmed = 0;

  for (var ln = 0; ln < lines.length; ln++) {
    var line = lines[ln];
    if (line === '' || line.trim() === '') continue;

    var f = (sep.key === 'space' ? line.trim() : line).split(sep.re);
    if (f.length !== width) {
      ragged++;
      f = f.slice(0, width);
      while (f.length < width) f.push('');
    }
    for (var i = 0; i < width; i++) {
      var cell = String(f[i] === undefined ? '' : f[i]).trim();
      if (cell.length > MAX_FIELD_CHARS) { cell = cell.slice(0, MAX_FIELD_CHARS); trimmed++; }
      f[i] = cell;
    }
    rows.push(f);
  }

  if (!rows.length) return { error: '"' + name + '" has no rows in it.' };

  // Types first, then the cells converted, so a number column carries numbers
  // rather than strings that happen to look like them.
  var columns = uniqueColumnKeys(header.columns.map(function(label, i) {
    return { key: tableColumnKey(label, i), label: label, type: inferColumnType(rows, i) };
  }));
  columns.forEach(function(c, i) {
    if (c.type !== COLTYPE.NUMBER) return;
    rows.forEach(function(r) { if (r[i] !== '') r[i] = Number(r[i]); });
  });

  var warnings = [];
  if (ragged) {
    warnings.push(ragged + (ragged === 1 ? ' row did' : ' rows did') +
      ' not have ' + width + ' fields and ' +
      (ragged === 1 ? 'was' : 'were') + ' padded or trimmed to fit');
  }
  if (trimmed) {
    warnings.push(trimmed + (trimmed === 1 ? ' field was' : ' fields were') +
      ' longer than ' + MAX_FIELD_CHARS + ' characters and ' +
      (trimmed === 1 ? 'was' : 'were') + ' cut');
  }

  return { name: name, columns: columns, rows: rows,
           separator: sep.label, warnings: warnings };
}

/* A column KEY from a column NAME. Keys are what a saved query stores and what
   every node reaches a column by, so they have to be stable and safe to put in
   an attribute selector. The label keeps whatever the header said.

   The index is appended only when two columns would otherwise collide, which
   the archive's own header does: it carries maj1 and maj2 twice. First
   occurrence keeps the plain key, so the common case reads as itself. */
function tableColumnKey(label, i) {
  var base = String(label || '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return base === '' ? ('col' + (i + 1)) : base;
}

function uniqueColumnKeys(columns) {
  var seen = {};
  columns.forEach(function(c, i) {
    var key = c.key, n = 2;
    while (seen[key]) { key = c.key + '_' + n; n++; }
    seen[key] = true;
    c.key = key;
  });
  return columns;
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
    files.push({ name: p.name || yearFileNameFor(p.year), year: p.year,
                 rows: p.rows, students: p.students.length });
    p.students.forEach(function(s){ students.push(s); });
    (p.warnings || []).forEach(function(w){ warnings[w] = true; });
  });
  return {
    kind: 'archive',
    headers: header,
    parsed: parsed,
    files: files,
    years: years,
    students: students,
    warnings: Object.keys(warnings),
    loadedAt: new Date().toISOString()
  };
}

/* THE OTHER KIND OF DATASET
   ---------------------------------------------------------------------------
   Same slot, same node, different shape. An archive dataset holds students and
   the years they belong to; a table dataset holds columns and rows and has
   neither. `kind` is what everything downstream branches on, and it is a stored
   field rather than a guess at run time so the two walks cannot read it
   differently.

   Table files do NOT accumulate the way year files do. A year is a slice of one
   collection and adding another is ordinary; two arbitrary tables have no
   reason to share a header, and stacking them silently is what Combine exists
   to do visibly. So the last one chosen is the one held, and the panel says so.

   `files` keeps the archive's shape so the panel can list either without a
   second case. `students` is absent rather than empty: an empty list would read
   as "no students found", which is a claim about the data, and this table has
   nothing to say about students at all. */
function buildTableDataset(header, parsedTable) {
  return {
    kind: 'table',
    headers: header,
    files: [{ name: parsedTable.name, year: null,
              rows: parsedTable.rows.length, students: null }],
    years: [],
    columns: parsedTable.columns,
    rows: parsedTable.rows,
    separator: parsedTable.separator,
    warnings: (parsedTable.warnings || []).slice(),
    loadedAt: new Date().toISOString()
  };
}

/* Archive unless it says otherwise, so a dataset built before `kind` existed
   (the synthetic one, and anything a test hands in) still reads as one. */
function datasetKind(d) { return (d && d.kind === 'table') ? 'table' : 'archive'; }
function isTableDataset(d) { return datasetKind(d) === 'table'; }

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

/* Every Source forgets its files. Called by applyGraph() (see the note at the
   top of this section about why a loaded query starts with no data), and by
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
   Source whose rows and whose header came from different exports. The precise
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
      'Read ' + header.columns.length + ' column' +
      (header.columns.length === 1 ? '' : 's') + ' from ' + header.name + '. ' +
      (headerIsArchive(header)
        ? 'These are the archive\u2019s columns, so its rows will be read as students. ' +
          'Now choose the year files.'
        : 'Now choose the data file' + (headerTargetOf(header.name)
            ? ', which this header is named for: ' + headerTargetOf(header.name)
            : '') + '.') });
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
    failSource(nodeId, 'Choose the column file first: ' + DATA_HEADERS_NAME +
      ', or "headers-" then this file\u2019s name and ".txt". A data file cannot ' +
      'be read without the column list that says what its fields are.', done);
    return;
  }

  /* Which reader the file goes to is the header's business, not the file's.
     One node, two shapes, decided by looking at the columns rather than by
     asking the user which kind of Source they wanted. */
  if (!headerIsArchive(header)) { loadTableFileFor(nodeId, header, files, done); return; }

  var existing = parsedYearsOf(nodeId);
  var held = {};
  existing.forEach(function(p){ held[p.year] = true; });

  var problem = null;
  var seen = {};
  files.forEach(function(f) {
    if (problem) return;
    /* The ARCHIVE's own rule, unrelaxed. The supervisor's ruling was that the
       tool should stop refusing files for being shaped differently, not that
       the archive should stop being the archive: its exports really are named
       this way, and the year in the name is what parseYearFile() checks the
       rows against. A file that is not one of those is read by the table path
       instead, which is reached by handing this Source a header that does not
       declare the archive's columns. */
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

/* THE TABLE STEP.
   One file, replacing whatever was there. See buildTableDataset() for why these
   do not accumulate the way year files do. Choosing several at once is a
   mis-click worth naming rather than resolving by taking the first. */
function loadTableFileFor(nodeId, header, files, done) {
  if (files.length > 1) {
    failSource(nodeId, 'This column file does not describe the archive, so its rows ' +
      'are read as an ordinary table and a Source holds one of those at a time. ' +
      'Choose one file, or use a Combine node to bring several together.', done);
    return;
  }

  var file = files[0];
  var problem = dataFileProblem(file);
  if (problem) { failSource(nodeId, problem, done); return; }

  readFileText(file, function(err, text) {
    if (err) { failSource(nodeId, err, done); return; }

    var out = parseTableFile(text, header, dataFileName(file));
    if (out.error) { failSource(nodeId, out.error, done); return; }

    var dataset = buildTableDataset(header, out);
    setSourceData(nodeId, dataset);
    delete PENDING_HEADERS[nodeId];
    applyDatasetToNode(nodeId, dataset);

    /* The separator is worth naming only when there was a choice to get wrong.
       A one-column file has no separator, and saying it was "separated by tabs"
       reads as the tool having decided something it did not. */
    var text2 = 'Read ' + out.rows.length + ' row' + (out.rows.length === 1 ? '' : 's') +
      ' of ' + out.columns.length + ' column' + (out.columns.length === 1 ? '' : 's') +
      ' from ' + out.name +
      (out.columns.length > 1 ? ', separated by ' + out.separator : '') + '.';
    if (out.warnings.length) text2 += ' ' + out.warnings.join('. ') + '.';
    setSourceNotice(nodeId, { kind:'ok', text: text2 });
    render();
    done(null, dataset);
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
   Source outright. The header is still valid (it describes the shape of files
   that have not been chosen yet), and throwing it away would make "I picked the
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
  d.years = (dataset && !isTableDataset(dataset)) ? dataset.years.slice() : [];
  d.file  = (dataset && isTableDataset(dataset) && dataset.files[0])
    ? dataset.files[0].name : '';

  /* A population the Source can no longer answer would leave it silently empty.
     Falling back to "all students" is the only choice that is right whatever is
     held, and the panel shows the change. */
  var years = dataset ? dataset.years : [];
  if (node.cfg.pop !== 'all' && years.indexOf(parseInt(node.cfg.pop, 10)) === -1) {
    node.cfg.pop = 'all';
  }
}

/* One refusal path. The Source is left as it was (nothing half-applied), the
   reason is shown on the node rather than in the results panel, because that is
   where the button that caused it lives, and the caller is told. */
function failSource(nodeId, message, done) {
  setSourceNotice(nodeId, { kind:'error', text: message });
  render();
  (done || function(){})(message);
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
