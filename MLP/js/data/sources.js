/* data/sources.js: Files that are not the archive, building a dataset out of what was
   parsed, and what each Source on the canvas holds.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
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

