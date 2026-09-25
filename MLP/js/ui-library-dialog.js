/* ui-library-dialog.js: The library dialog: the grid of cards and everything it can do.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   THE QUERY LIBRARY: THE DIALOG
   ============================================================================
   A grid of cards over the canvas, built the way Help and the save dialog are:
   static markup in the page, inline handlers, and one `open` class. A third
   mechanism for raising a card over the canvas would be a third thing to keep
   in step with the Escape handling and the shortcut suppression below.

   TWO-STEP CONFIRMATION RATHER THAN A SECOND DIALOG.

   Two actions here cannot be taken back: opening a query replaces the canvas,
   and deleting one removes the only copy. Both are a single click on a card in
   a grid, which is a far easier thing to hit by accident than the two-step file
   picker Load has always been — that is the cost of making the library
   convenient, and it has to be paid back somewhere.

   The usual answer is a confirmation dialog, and it is the wrong one here: it
   would be a modal over a modal, with its own focus to trap and return, over a
   grid that is itself scrollable. So the button asks instead. The first click
   turns Open into "Replace canvas?" and Delete into "Confirm deletion?", and the
   second does it. The question names what happens rather than asking whether
   the user is sure, and it is on the control they pressed, where they are
   already looking.

   Opening skips the question when the canvas is empty, because there is then
   nothing to replace and a question with only one sensible answer teaches
   people to click through questions.                                         */

var LIB_SEARCH_MIN = 6;     // cards, below which the search box is pointless

// Which control opened it, so focus goes back there. Same as helpOpener.
var libOpener = null;
// The card being renamed, and the one whose destructive button is half-pressed.
var libRenaming = null;
var libPending = null;      // { action: 'open' | 'delete' | 'replace', id }
var libQuery = '';          // the search box's text
var libNotice = null;       // { tone: 'ok' | 'bad', text } shown under the header

function libDialogEl() { return document.getElementById('libDialog'); }
function libraryOpen() {
  var d = libDialogEl();
  return !!(d && d.classList.contains('open'));
}

function openLibrary(btn) {
  var d = libDialogEl();
  if (!d) return;
  libOpener = btn || null;
  // Every half-pressed button and half-typed rename from last time is dropped.
  // A dialog that reopens mid-question is a dialog that answers it by accident.
  libPending = null;
  libRenaming = null;
  libNotice = null;
  libQuery = '';
  var s = document.getElementById('libSearch');
  if (s) s.value = '';

  /* The name field arrives filled, with the name this query already answers to
     — the one it was opened under, or the one it was last saved under — and a
     timestamp only when it has never had one. Same reasoning as the save
     dialog's: the ordinary loop is save, adjust, save again, and offering a
     fresh timestamp each time leaves a grid of near-identical cards told apart
     only by the minute they were written. */
  var nm = document.getElementById('libSaveName');
  if (nm) {
    nm.value = nodes.length ? libSuggestName() : '';
    nm.placeholder = defaultQueryName();
  }
  var save = document.getElementById('libSaveBtn');
  if (save) save.disabled = !nodes.length;

  d.classList.add('open');
  renderLibrary();
  var body = document.getElementById('libBody');
  if (body) { body.setAttribute('tabindex', '-1'); body.focus(); }
}

function closeLibrary() {
  var d = libDialogEl();
  if (d) d.classList.remove('open');
  libPending = null;
  libRenaming = null;
  // Focus leaves with the dialog. Left on a button inside a hidden card it
  // belongs to nothing on screen, and the keyboard user has no caret and no
  // working shortcuts.
  var btn = libOpener;
  libOpener = null;
  if (btn && btn.focus) btn.focus();
}

function libSay(tone, text) { libNotice = text ? { tone: tone, text: text } : null; }

/* Whatever a card's date means to the person reading it. Formatted in the
   browser's own locale rather than the tool's, because this is the one string
   here that is about their calendar rather than about the query. */
function libWhen(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    return ' · ' + d.toLocaleDateString(undefined,
      { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return ''; }
}

function libSizeText(bytes) {
  if (!bytes) return 'nothing stored yet';
  return bytes < 1024 ? bytes + ' bytes'
       : bytes < 1024 * 1024 ? Math.round(bytes / 1024) + ' KB'
       : (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function libMatches(e, q) {
  return !q || e.name.toLowerCase().indexOf(q) !== -1;
}

/* A card. Everything out of the entry is escaped; everything out of libThumb()
   is markup this file generated from a fixed table and is not. */
function libCardHTML(e) {
  var pendOpen = !!(libPending && libPending.action === 'open'   && libPending.id === e.id);
  var pendDel  = !!(libPending && libPending.action === 'delete' && libPending.id === e.id);
  var n = (e.graph && Array.isArray(e.graph.nodes)) ? e.graph.nodes.length : 0;
  var id = e.id;   // constrained to [A-Za-z0-9_-] by libRead, so attribute-safe

  return '<div class="lib-card' + (pendDel ? ' danger' : '') + '">' +
    '<div class="lib-thumb">' + libThumb(e.graph) + '</div>' +
    '<div class="lib-meta">' +
      (libRenaming === id
        ? '<input class="lib-rename" id="libRenameInput" type="text" value="' + esc(e.name) +
          '" spellcheck="false" autocomplete="off" aria-label="Query name" ' +
          'maxlength="' + LIB_NAME_MAX + '" ' +
          'onkeydown="libRenameKey(event, \'' + id + '\')" ' +
          'onblur="libCommitRename(\'' + id + '\')">'
        : '<div class="lib-name" title="' + esc(e.name) + '">' + esc(e.name) + '</div>') +
      '<div class="lib-sub">' + n + ' node' + (n === 1 ? '' : 's') + esc(libWhen(e.savedAt)) + '</div>' +
    '</div>' +
    '<div class="lib-actions">' +
      '<button class="lib-go" onclick="libOpenEntry(\'' + id + '\', this)" ' +
        'title="Put this query on the canvas">' +
        (pendOpen ? 'Replace canvas?' : 'Open') + '</button>' +
      '<button class="file-btn" onclick="libStartRename(\'' + id + '\')">Rename</button>' +
      '<button class="file-btn" onclick="libExportEntry(\'' + id + '\', this)" ' +
        'title="Write this query out as a .json file">Export</button>' +
      '<button class="lib-del" onclick="libDeleteEntry(\'' + id + '\', this)">' +
        (pendDel ? 'Confirm deletion?' : 'Delete') + '</button>' +
    '</div>' +
  '</div>';
}

/* A store that could not be read is a screen of its own rather than an empty
   grid, because "you have no saved queries" and "your saved queries could not
   be opened" are opposite things to be told and look identical as an empty
   grid. The offer to start again is deliberately a button and not automatic:
   see libAdd, which refuses the same write for the same reason. */
function libProblemHTML(err) {
  var canReplace = err.code === 'unreadable' || err.code === 'alien' || err.code === 'newer';
  return '<div class="lib-problem">' +
    '<div class="lib-problem-text">' + esc(err.message) + '</div>' +
    (canReplace
      ? '<button class="lib-del" onclick="libStartOver(this)">Start a new library</button>' +
        '<div class="lib-problem-warn">This throws away whatever is stored under ' +
        esc(LIB_STORE) + '. If those queries matter, copy that value out of the ' +
        'browser\'s storage inspector first.</div>'
      : '') +
  '</div>';
}

function renderLibrary() {
  var body = document.getElementById('libBody');
  if (!body) return;

  var st = libRead();
  var head = document.getElementById('libNotice');
  if (head) {
    head.className = 'lib-notice' + (libNotice ? ' show ' + libNotice.tone : '');
    head.textContent = libNotice ? libNotice.text : '';
  }

  var foot = document.getElementById('libUsage');
  if (foot) {
    foot.textContent = st.error ? ''
      : st.entries.length + ' of ' + LIB_MAX_ENTRIES + ' · ' + libSizeText(libBytes());
  }

  var search = document.getElementById('libSearchWrap');
  if (search) search.classList.toggle('show', !st.error && st.entries.length >= LIB_SEARCH_MIN);

  if (st.error) { body.innerHTML = libProblemHTML(st.error); return; }

  /* An empty library says nothing. The dialog's own heading paragraph already
     explains what the library is for, and the name field and Save button sit
     in plain sight at the foot, so a second block of prose in the middle was
     repeating the two things around it. */
  if (!st.entries.length) { body.innerHTML = ''; return; }

  var q = libQuery.trim().toLowerCase();
  var shown = st.entries.filter(function(e) { return libMatches(e, q); });
  if (!shown.length) {
    body.innerHTML = '<div class="lib-empty">No saved query is called anything like ' +
      '"' + esc(libQuery.trim()) + '".</div>';
    return;
  }
  body.innerHTML = '<div class="lib-grid">' +
    shown.map(libCardHTML).join('') + '</div>';

  // A rename renders as an input and is meant to be typed into immediately.
  var ren = document.getElementById('libRenameInput');
  if (ren) { ren.focus(); ren.select(); }
}

function libSearchInput(el) {
  libQuery = el ? el.value : '';
  // Any half-pressed button is dropped: the card it belonged to may not even
  // be on screen after the filter changes, and a question nobody can see is a
  // question that gets answered by the next click somewhere else.
  libPending = null;
  renderLibrary();
}

/* ------------------------------------------------------------------ opening */

function libOpenEntry(id, btn) {
  var text = libGraphText(id);
  if (text === null) { libSay('bad', LIB_MESSAGES.missing); renderLibrary(); return; }

  // The question, once, and only when there is something to lose.
  if (nodes.length && !(libPending && libPending.action === 'open' && libPending.id === id)) {
    libPending = { action: 'open', id: id };
    libSay(null, '');
    renderLibrary();
    return;
  }

  libPending = null;
  /* Through the same loader a picked file goes through, which is what makes the
     version guard, the port resolution and the repair apply here without being
     written twice. It reports into the results panel behind this dialog, so the
     dialog closes first and the user is left looking at what it said. */
  var entry = libGet(id);
  closeLibrary();
  if (loadGraphFromText(text, btn) && entry) lastQueryName = entry.name;
}

/* ----------------------------------------------------------------- renaming */

function libStartRename(id) {
  libPending = null;
  libRenaming = id;
  renderLibrary();
}

function libCancelRename() {
  if (libRenaming === null) return;
  libRenaming = null;
  renderLibrary();
}

/* Enter commits, Escape abandons. Escape is handled here rather than left to
   the document handler because that one closes the dialog, and abandoning a
   rename should not also shut the library: the key means "never mind about
   this", and the smallest thing it can mean that is what it should mean. */
function libRenameKey(e, id) {
  if (e.key === 'Enter')  { e.preventDefault(); e.target.blur(); }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    // Cleared first so the blur this causes does not commit what was typed.
    libRenaming = null;
    e.target.blur();
    renderLibrary();
  }
}

function libCommitRename(id) {
  if (libRenaming !== id) return;          // already abandoned by Escape
  var input = document.getElementById('libRenameInput');
  var wanted = input ? input.value : '';
  libRenaming = null;

  var r = libRename(id, wanted);
  if (r.conflict) libSay('bad', 'Another query is already called "' + r.conflict.name + '".');
  else if (!r.ok) libSay('bad', r.error.message);
  renderLibrary();
}

/* ----------------------------------------------------------------- deleting */

function libDeleteEntry(id, btn) {
  if (!(libPending && libPending.action === 'delete' && libPending.id === id)) {
    libPending = { action: 'delete', id: id };
    libSay(null, '');
    renderLibrary();
    return;
  }
  libPending = null;
  var r = libRemove(id);
  libSay(r.ok ? 'ok' : 'bad',
         r.ok ? 'Deleted "' + r.entry.name + '".' : r.error.message);
  renderLibrary();
}

/* Only reachable from the problem screen, and only after its warning. This is
   the one place the tool throws away a store it could not read, and it is a
   deliberate act each time rather than a preference that could be left on. */
function libStartOver(btn) {
  try { window.localStorage.removeItem(LIB_STORE); }
  catch (e) { libSay('bad', LIB_MESSAGES.nostore); renderLibrary(); return; }
  libSay('ok', 'Started a new library.');
  renderLibrary();
}

/* ---------------------------------------------------------------- exporting */

/* One card out as a .json file, in the format Load already reads. Sharing a
   query with a colleague is this button and an email: there is no separate
   exchange format, because the query file has been one all along.

   safeName() applies HERE and not to the library name itself. On a card the
   name is text and a colon is fine; the moment it becomes a filename it is the
   filesystem's problem, which is exactly the distinction queryFileName() draws
   for the save dialog. */
function libExportEntry(id, btn) {
  libPending = null;
  var e = libGet(id);
  if (!e) { libSay('bad', LIB_MESSAGES.missing); renderLibrary(); return; }
  var ok = downloadFile(queryFileName(e.name), JSON.stringify(e.graph, null, 2));
  flashBtn(btn, ok ? 'Saved ✓' : 'Save failed');
}

/* ------------------------------------------------- EXPORTING THE WHOLE THING

   The only thing here that survives a cleared browser, a new laptop or a
   reinstall, which is why it sits in the footer next to the usage line rather
   than behind anything. The library is not a backup; this is how it gets one. */
function libExportAll(btn) {
  libPending = null;
  var st = libRead();
  if (st.error) { libSay('bad', st.error.message); renderLibrary(); return; }
  if (!st.entries.length) {
    libSay('bad', 'There is nothing in the library to export yet.');
    renderLibrary();
    return;
  }
  var name = safeName('query-library-' + timeStamp(true), 'query-library') + QUERY_EXT;
  var ok = downloadFile(name, libExportPayload(st.entries));
  libSay(ok ? 'ok' : 'bad',
         ok ? 'Wrote ' + st.entries.length + ' quer' + (st.entries.length === 1 ? 'y' : 'ies') +
              ' to ' + name + '.'
            : 'The library could not be written.');
  renderLibrary();
  flashBtn(btn, ok ? 'Saved ✓' : 'Save failed');
}

/* ------------------------------------------------------------------ IMPORTING */

function libPickImport(btn) {
  var input = document.getElementById('libImportFile');
  if (!input) return;
  // Reset first, or choosing the same file twice in a row fires no change
  // event — the same reason openGraphFile() does it.
  input.value = '';
  input._btn = btn;
  input.click();
}

function onLibImportChosen(e) {
  var input = e.target;
  var file = input.files && input.files[0];
  if (!file) return;
  var btn = input._btn;

  var problem = libFileProblem(file);
  if (problem) { libSay('bad', problem); renderLibrary(); flashBtn(btn, 'Import failed'); return; }

  var reader = new FileReader();
  reader.onload = function() {
    // A lone query file arrives with no name of its own, so it borrows the
    // file's — which is what the user called it when they saved it.
    var r = libImportText(String(reader.result), libName(stripQueryExt(file.name)));
    if (!r.ok) {
      libSay('bad', r.error.message);
      renderLibrary();
      flashBtn(btn, 'Import failed');
      return;
    }
    /* The search box is cleared, because an import that lands entirely outside
       the current filter looks exactly like an import that did nothing. */
    libQuery = '';
    var s = document.getElementById('libSearch');
    if (s) s.value = '';
    libSay(r.added ? 'ok' : 'bad', libImportSummary(r));
    renderLibrary();
    flashBtn(btn, r.added ? 'Imported ✓' : 'Nothing added');
  };
  reader.onerror = function() {
    libSay('bad', 'Could not read that file.');
    renderLibrary();
    flashBtn(btn, 'Import failed');
  };
  reader.readAsText(file);
}

/* ------------------------------------------------------------------- saving */

/* The library's own way in. The Save dialog gets one too, so a user who thinks
   "save this" and a user who thinks "put this in the library" both arrive; this
   is the one that does not need the dialog, because the name field is already
   on screen with the grid it is about to appear in.

   A clash is a question rather than a refusal, asked on the button the same way
   the destructive ones are: press again to replace the query of that name. */
function libSaveCurrent(btn) {
  var input = document.getElementById('libSaveName');
  var name = input ? input.value : '';
  var again = !!(libPending && libPending.action === 'replace' &&
                 libPending.id === libName(name).toLowerCase());

  var r = libAdd(name, { replace: again });
  libPending = null;

  if (r.conflict) {
    libPending = { action: 'replace', id: libName(name).toLowerCase() };
    libSay('bad', '"' + r.conflict.name + '" is already in the library. ' +
                  'Press Save to library again to replace it.');
    renderLibrary();
    flashBtn(btn, 'Replace?');
    return;
  }
  if (!r.ok) {
    libSay('bad', r.error.message);
    renderLibrary();
    flashBtn(btn, 'Save failed');
    return;
  }

  if (input) input.value = '';
  libQuery = '';
  var s = document.getElementById('libSearch');
  if (s) s.value = '';
  libSay('ok', 'Saved "' + r.entry.name + '" to the library.');
  renderLibrary();
  flashBtn(btn, 'Saved ✓');
}

/* Opening the library with a graph on the canvas offers a name for it, the way
   the save dialog does: the one it was loaded or last saved under, or a
   timestamp. Read at open rather than held, so a query loaded from a file since
   the last time the dialog was up brings its name with it. */
function libSuggestName() {
  return lastQueryName || defaultQueryName();
}
