/* queries/saveload.js: A query as a file: the save dialog, writing, reading and applying.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
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
   given, never their contents. Version 1 and 2 files still load. A Source with
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
   beside the field but sits outside the input. The same treatment the CSV
   export name already uses, so the two read as the same kind of control.

   A name typed with ".json" already on the end is accepted and the duplicate
   dropped, because a user who types the extension is not making a mistake, and
   "query.json.json" would be a poor way of telling them so. */
var QUERY_EXT = '.json';

/* "untitled" rather than "query", because this name is only ever reached by
   someone who did not give one. Every file this tool writes is a query, so
   naming one of them "query" says nothing about it; "untitled" says the one
   thing that is actually true, which is that it still needs a name. Used for
   both destinations: the file on disk and the card in the library. */
function defaultQueryName() { return 'untitled-' + dateStamp(); }

/* Typed text to written filename. Two things happen on the way: the extension
   is stripped if present so it can be re-added exactly once, and the rest goes
   through the same sanitiser as every other file this tool writes. A name is
   a name whether it came from a config field or a dialog. */
/* Repeated, not once: someone correcting a name by hand can leave
   "report.json.json" behind, and the intent is plainly one extension. Its own
   function because the hint below has to strip identically. Two copies of this
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

/* The name last saved under, this session only. Never persisted. Save, adjust
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
  // If the markup is absent: An older page, or a headless harness that loaded
  // the script alone. Saving still works, it just uses the default name. A
  // missing dialog should not cost the user their query.
  if (!d || !input) { writeQueryFile(defaultQueryName() + QUERY_EXT, btn); return; }

  saveDialogBtn = btn || null;
  saveLibPending = '';
  input.value = lastQueryName || defaultQueryName();
  // The placeholder is always the timestamp, because that is what an empty
  // field actually writes. Clearing the box should show its own result, not
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
   a name that changed on the way out is worth one line, and only then, since
   restating an unchanged name is noise. */
function updateSaveHint() {
  var input = saveNameInput(), hint = document.getElementById('saveHint');
  if (!input || !hint) return;
  var typed = stripQueryExt(input.value);
  var name = queryFileName(input.value);
  var changed = !!typed && name !== typed + QUERY_EXT;
  hint.textContent = changed ? 'Saves as ' + name : '';
  hint.classList.toggle('show', changed);
  // This line is shared with the library's errors, so taking it back means
  // dropping their colour too, not only their text.
  hint.classList.remove('bad');
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

/* THE SECOND DESTINATION
   ---------------------------------------------------------------------------
   The same dialog, the same name, somewhere else to put it. Two buttons rather
   than a mode to be chosen first: there is no state the user has to get right
   before typing, and neither destination is hidden behind the other.

   The library is reached from two places — here, and the grid's own footer —
   because "save this" and "put this in the library" are two different thoughts
   and a user arrives holding one or the other. Both end up in libAdd(), which
   is where the refusals live.                                                */

/* A clash is answered on the button, the way the grid answers one: press again
   to replace. Cleared whenever the name changes, because the question was
   about a particular name and the answer cannot outlive it. */
var saveLibPending = '';

/* The hint line doubles as the dialog's error line. Written directly rather
   than through updateSaveHint(), which has its own thing to say; typing in the
   field calls that one and takes the line back, which is the right moment for
   a message about the name that has just been changed to disappear. */
function saveHintSay(text) {
  var hint = document.getElementById('saveHint');
  if (!hint) return;
  hint.textContent = text || '';
  hint.classList.toggle('show', !!text);
  hint.classList.toggle('bad', !!text);
}

function confirmSaveToLibrary(btn) {
  /* The extension is stripped even though the library does not use one. The
     field is shared with the file path and shows ".json" beside it, so a user
     who types "grades.json" here has said the name is "grades" — carrying the
     suffix onto a card would be reading the chip back at them. Everything
     after that is libName's: a card's name is not a filename and keeps its
     punctuation. */
  var input = saveNameInput();
  var name = libName(stripQueryExt(input ? input.value : '')) || defaultQueryName();
  var again = saveLibPending === name.toLowerCase();

  var r = libAdd(name, { replace: again });
  saveLibPending = '';

  if (r.conflict) {
    saveLibPending = name.toLowerCase();
    saveHintSay('"' + r.conflict.name + '" is already in the library. ' +
                'Press Save to library again to replace it.');
    flashBtn(btn, 'Replace?');
    return;
  }
  if (!r.ok) { saveHintSay(r.error.message); flashBtn(btn, 'Save failed'); return; }

  var opener = saveDialogBtn;
  lastQueryName = name;
  closeSaveDialog();
  // On the toolbar button that opened the dialog, since the dialog has gone.
  flashBtn(opener, 'Saved ✓');
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
     names none, so every wire lands on the target's primary port, which is
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
      warnings.push('a second wire into a single input, so wire a Combine if you meant to merge');
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
  ['pop','grain','show','filename','sort','by','labelCol','labelsAs'].forEach(function(k) {
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
  /* SelectFor's measures, which are objects rather than Compare's strings.
     The reason they are not both called `measures`. Every element is rebuilt
     from a fresh default rather than patched in place, so a file supplying a
     number, a string or a nested object where {op, col} belongs cannot put a
     value into the model that the panel would then read into an attribute.
     op and col are both resolved against the live table at render and at
     evaluation anyway, so an unrecognised one falls back rather than breaking.
     This guard only has to guarantee the SHAPE. */
  if (Object.prototype.hasOwnProperty.call(base, 'stats')) {
    var rawStats = Array.isArray(base.stats) ? base.stats : [];
    base.stats = rawStats.slice(0, 20).map(function(x) {
      var st = newStat();
      if (x && typeof x === 'object' && !Array.isArray(x)) {
        if (typeof x.op === 'string')  st.op  = x.op;
        if (typeof x.col === 'string') st.col = x.col;
      }
      return st;
    });
    if (!base.stats.length) base.stats = [newStat()];
  }
  /* The dataset descriptor is a name and a list of years and nothing else. It
     is read straight back into the panel's markup, so a file supplying an
     object where the name belongs, or 2000 fabricated years, is normalised here
     rather than trusted. Years are coerced to integers in the admitted range;
     the header name is length-capped and stripped of any path, exactly as
     dataFileName() would do to a real one. NOTHING in this key is ever used to
     find or read a file (the user picks those), so the worst a hostile value
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

  /* null is the meaningful default ("keep everything"), so only a value that is
     neither null nor an array of keys is rejected. Non-string entries are
     dropped rather than coerced: a column key is compared against real header
     keys, and "[object Object]" can never match one. */
  if (Object.prototype.hasOwnProperty.call(base, 'cols')) {
    base.cols = Array.isArray(base.cols)
      ? base.cols.filter(function(k){ return typeof k === 'string'; })
      : null;
    if (base.cols && !base.cols.length) base.cols = null;
  }

  // Only filter nodes carry criteria: A file that attaches them to an Output
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
     ago. Matching ids across two unrelated files is a coincidence, not a
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
  hideConnNote();
  render();
  /* Fit after loading rather than restoring a saved zoom. A file carries the
     graph, not the view (which is why the format did not have to change for
     any of this), and a query written on one screen should open framed for
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
   Neither is the last line of defence (deserialiseGraph still rejects anything
   that is not a query file), but by the time that runs the tool has read an
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

