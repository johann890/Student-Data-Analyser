/* data/loading.js: which files a Source will admit, and the parsers for the
   header file and for a year file.

   A Source is handed two things, in this order:

     headers.txt          the column names, and the 1..N index line under them
     mcs-students-YYYY    one file per year, tab separated, one row per
                          enrolment, with no extension

   Both names are checked here rather than left to the file picker. `accept` on
   an <input type=file> only filters what the dialog shows: every browser offers
   "All files", and a file can be dragged in or renamed.

   Every cell that gets past this module reaches the DOM, so the checks run
   cheapest first and each refuses rather than repairs:

     1. NAME     exact for headers.txt, anchored for a year file, and the year
                 must be plausible. Directory components are stripped first, so
                 "../../etc/passwd" is judged on its last segment.
     2. SIZE     empty is refused, and so is anything over MAX_DATA_FILE_BYTES,
                 before a byte is read.
     3. SHAPE    every row of a year file must carry exactly as many tab
                 separated fields as headers.txt declares, so a file with the
                 right name but another archive's columns fails on line one.
     4. CONTENT  NUL and other C0 controls are refused. Fields and rows are
                 capped, the ID must be digits, Pts a small non-negative number,
                 and the Year column must agree with the year in the file name.

   None of this replaces escaping; esc() still runs on every value going into
   markup.

   A Source owns its files, so two Sources can hold different exports and each
   answers about its own rows. The registries in data/registries.js are the
   union across all of them, for dropdowns only.

   A saved query records the file names and none of their contents, so loading
   one clears the data and the Source panel asks for the files again. */

var DATA_HEADERS_NAME = 'headers.txt';

/* THE HEADER NAMING SCHEME
   Two names are accepted: the plain `headers.txt` the archive uses, and the
   qualified `headers-<data file name>.txt`, so one directory can hold a band
   file, a label list and the archive side by side rather than needing a
   directory per data format.

   Which of the two a Source was handed is remembered only so the panel can name
   it; nothing downstream cares.

   The qualified form is NOT enforced against the data file's name. The pairing
   is for the user's filesystem, not for this tool to police. */
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
   It used to be an admission gate: a header without these columns was refused
   as "too few to be the archive header", which is what stopped a one-column
   list of labels being loadable at all.

   The supervisor asked for that to go, on the grounds that the input files all
   come from one source and a single Source node should adapt to whatever format
   it is handed rather than make the user choose a node kind.

   So the list stops deciding whether a file may be read and starts deciding HOW
   it is read. A header carrying all of these describes the archive, and its
   rows are folded into students with their courses nested. Any other header
   describes a table, and its rows come through as they are.

   The size cap, the control-character refusal, the row and field caps and the
   path-segment stripping all stay. They do not reject a differently shaped
   file, they reject a hostile one, and every cell that survives this module
   still reaches the DOM. */
function headerIsArchive(header) {
  if (!header || !header.byName) return false;
  return REQUIRED_HEADER_COLUMNS.every(function(c){ return c in header.byName; });
}

/* C0 controls except tab, newline and carriage return, plus DEL. Tested against
   the whole file before it is split, because the cheapest place to refuse a
   file is before it has become anything more structured than a string. */
var CONTROL_CHAR_RE = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]');

/* PER-SOURCE STATE: Deliberately not part of the node model
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

/* ADMISSION */

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

/* PARSING */

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

