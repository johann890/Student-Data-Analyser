/* data/registries.js: The dataset registries, the grade scale, and the deterministic
   cohort the test hook installs in place of real files.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   DATA: The archive, and the one type that travels on a wire
   ============================================================================
   The dataset registries, file admission, the parser, what a Source holds, and
   the Table type every node hands to the next. Nothing in here touches the DOM
   except failSource(), which asks for a repaint after it has said no.
   ============================================================================
   Part of the query builder. LOAD ORDER MATTERS, and the order is the script
   list at the foot of index.html. These are deliberately NOT ES modules; the tool is
   opened from Finder at file://, where module scripts are fetched with CORS
   against an opaque origin and refused. Classic scripts sharing one global
   scope are what works there, which is why nothing here is wrapped in an IIFE
   and why a name declared in one file is visible in the next.                */

/* PALETTE OF EDGE COLOURS (one per source/path) */
var EDGE_PALETTE = ['#ffffff','#30d87a','#4aaff0','#e060b0','#a0d040','#9080e0'];
/* The one colour no wire is ever assigned, so "switched off" cannot be mistaken
   for a wire that happens to be that colour. Every entry above is a saturated
   hue; this is the only grey, which is what makes it read as an absence rather
   than as another choice from the same set. */
var EDGE_OFF_COLOR = '#6a6a72';
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



