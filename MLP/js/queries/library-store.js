/* queries/library-store.js: The query library in browser storage: the store and its rules.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   THE QUERY LIBRARY: THE STORE
   ============================================================================
   Save and Load above write and read a file. The library keeps the same queries
   in the browser instead, so a query built once is one click away next term
   rather than something to go and find in a folder.

   WHAT IS STORED IS THE FILE FORMAT, UNCHANGED.

   An entry's `graph` is exactly what serialiseGraph() writes and exactly what
   deserialiseGraph() reads, byte for byte. That is the whole design, and it is
   worth being explicit about why, because a store with its own shape would have
   been easy to write and wrong:

     - the guarantee that a saved query carries the NAMES of the data files and
       never their contents is a property of serialiseGraph(), asserted in
       07-saveload. A second way of writing a query down is a second place for
       student records to escape to, and the one that nobody would think to
       check is the one in browser storage that never appears as a file;
     - the version guard, the port resolution, the repair of a graph whose node
       types have since changed — all of it lives in deserialiseGraph(), and all
       of it applies just as much to an entry saved last year as to a file. Two
       implementations would drift, and the drift would show up as a query that
       opens from a file but not from the library.

   So loading an entry goes back out through the same door it came in:
   JSON.stringify the graph and hand it to loadGraphFromText(). Re-serialising
   something that was just parsed looks wasteful and is: a few kilobytes and a
   millisecond, in exchange for there being exactly one loader.

   WHAT THIS IS NOT. It is not a backup and must never be described as one.
   Clearing site data removes it, a private window never sees it, and it does
   not travel to another machine or another browser. That is what Export is for.
   It is also not private on a shared staff machine: storage belongs to the
   browser profile, not to the person sitting at it.                          */

var LIB_STORE       = 'sda.library.v1';
var LIB_KIND        = 'student-data-analyser-library';
var LIB_VERSION     = 1;
var LIB_NAME_MAX    = 80;
var LIB_MAX_ENTRIES = 200;

/* Failing to remember the panel width is a minor loss, and the guards around
   those reads say so by returning silently. Failing to save a query is not: the
   user has just spent twenty minutes building it and pressed a button that says
   Save. So every failure here comes back as a code and a sentence for the UI to
   show, rather than being swallowed.

     nostore     the browser refuses storage entirely. A private window, or
                 file:// with site data blocked. The property access throws
                 rather than returning null, which is why it is inside the try
     unreadable  something is in the slot but it is not JSON
     alien       it is JSON, but not this tool's library
     newer       written by a later version of this tool than this one
     full        the library is at its entry ceiling
     quota       the browser will not accept any more bytes
     empty       there is no graph on the canvas to save
     missing     the entry asked for is not there any more                    */
function libError(code, message) { return { code: code, message: message }; }

var LIB_MESSAGES = {
  nostore:    'This browser is not letting the page store anything, so the library is unavailable. ' +
              'A private window does this. Save the query as a file instead.',
  unreadable: 'The saved library could not be read, so it has not been opened. ' +
              'Nothing has been overwritten.',
  alien:      'Something other than this tool\'s library is stored under its name, ' +
              'so it has not been opened. Nothing has been overwritten.',
  newer:      'The saved library was written by a newer version of this tool.',
  full:       'The library already holds ' + LIB_MAX_ENTRIES + ' queries. ' +
              'Delete one, or export the library and start a fresh one.',
  quota:      'There is no room left in this browser to save another query. ' +
              'Export the library, then delete the queries you no longer need.',
  empty:      'There is nothing on the canvas to save.',
  missing:    'That query is no longer in the library.'
};

function libFail(code) { return { ok: false, error: libError(code, LIB_MESSAGES[code]) }; }

/* Quota is reported differently by every engine, and none of them do it the way
   the specification suggests. WebKit throws a plain QuotaExceededError, Firefox
   has historically used its own name, and the legacy numeric codes are still
   what some versions set. Checked in that order so a browser that gets it right
   costs nothing. */
function libIsQuota(e) {
  if (!e) return false;
  return e.name === 'QuotaExceededError' ||
         e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
         e.code === 22 || e.code === 1014;
}

/* Ids are generated rather than counted, because the counter would have to live
   in the store and a store that has just failed to be read cannot supply one.
   Time first so they sort roughly by age when read by a human; the random tail
   because two saves in the same millisecond are possible and a collision would
   silently overwrite a different query. */
function libNewId() {
  return 'q' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/* A library name is NOT a file name, and deliberately does not go through
   safeName(). "Semester 1: withdrawals" is a perfectly good thing to call a
   query and a poor thing to call a file, and there is no file here to protect:
   the name is shown on a card and nowhere else. safeName() applies at the one
   point where a name does become a file, which is Export.

   What is done is the part that is about the card rather than the filesystem:
   runs of whitespace collapse so two names cannot look identical and compare
   differently, and the length is capped so one query cannot push every other
   card off its row. Escaping happens at render, like everywhere else. */
function libName(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, LIB_NAME_MAX);
}

/* Read the whole store, every time, rather than keeping it in a variable.

   Two windows open on the same tool is an ordinary thing to do — one to build a
   query, one to check an old one — and they share the storage. A copy held in
   memory goes stale the moment the other window saves, and writing that stale
   copy back would delete whatever the other window had just added, with no
   error and nothing to notice. Re-reading costs a parse of a few kilobytes. */
function libRead() {
  var raw = null;
  try { raw = window.localStorage.getItem(LIB_STORE); }
  catch (e) { return { entries: [], error: libError('nostore', LIB_MESSAGES.nostore) }; }

  if (!raw) return { entries: [], error: null };

  var d;
  try { d = JSON.parse(raw); }
  catch (e) { return { entries: [], error: libError('unreadable', LIB_MESSAGES.unreadable) }; }

  if (!d || typeof d !== 'object' || d.kind !== LIB_KIND) {
    return { entries: [], error: libError('alien', LIB_MESSAGES.alien) };
  }
  if (typeof d.version !== 'number' || d.version > LIB_VERSION) {
    return { entries: [], error: libError('newer', LIB_MESSAGES.newer) };
  }

  /* Entries are validated on the way out, not trusted. Storage is editable by
     hand, survives versions of this tool that have not been written yet, and is
     the one input here that arrives with no file picker in front of it.

     An entry is dropped rather than repaired, which is the opposite of what
     deserialiseGraph() does to a graph, and for a reason: a graph with a broken
     edge is still recognisably the query somebody built, while an entry with no
     usable graph is not a saved query at all and there is nothing in it to
     keep. The graph itself is NOT validated here beyond its kind — that is
     deserialiseGraph()'s job and it happens when the entry is opened, so a
     query that can no longer be loaded still appears on its card and can still
     be exported, rather than vanishing from the library without explanation. */
  var seen = {};
  var entries = [];
  (Array.isArray(d.entries) ? d.entries : []).forEach(function(raw) {
    if (entries.length >= LIB_MAX_ENTRIES) return;
    var e = libCleanEntry(raw, null);
    if (!e || seen[e.id]) return;
    seen[e.id] = true;
    entries.push(e);
  });

  return { entries: entries, error: null };
}

function libWrite(entries) {
  var payload = JSON.stringify({
    kind: LIB_KIND, version: LIB_VERSION, entries: entries
  });
  try { window.localStorage.setItem(LIB_STORE, payload); }
  catch (e) { return libFail(libIsQuota(e) ? 'quota' : 'nostore'); }
  return { ok: true, error: null };
}

// What the library occupies, for the line under the grid. Measured off the
// stored text rather than summed from the entries, so it is the number that
// actually counts against the browser's ceiling.
function libBytes() {
  var raw = null;
  try { raw = window.localStorage.getItem(LIB_STORE); } catch (e) { return 0; }
  return raw ? raw.length * 2 : 0;
}

function libIndexOf(entries, id) {
  for (var i = 0; i < entries.length; i++) if (entries[i].id === id) return i;
  return -1;
}

function libGet(id) {
  var st = libRead();
  var i = libIndexOf(st.entries, id);
  return i === -1 ? null : st.entries[i];
}

/* Case-insensitive, because two cards reading "Grade histogram" and "grade
   histogram" are two cards the user will read as the same query. */
function libNameTaken(entries, name, exceptId) {
  var want = libName(name).toLowerCase();
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].id === exceptId) continue;
    if (entries[i].name.toLowerCase() === want) return entries[i];
  }
  return null;
}

// The current canvas as an entry. The graph comes from serialiseGraph() and is
// not touched on the way in.
function libEntryFor(name) {
  return {
    id: libNewId(),
    name: libName(name) || defaultQueryName(),
    savedAt: new Date().toISOString(),
    graph: serialiseGraph()
  };
}

/* Save the canvas into the library.

   Refuses rather than overwrites in two places, and both are about not
   destroying work that cannot be got back:

     - if the store could not be READ, nothing is written. A write here would
       replace a library that is merely unreadable by this code with one holding
       a single query, and whatever was in there — possibly a term's work,
       possibly recoverable by hand from the browser's storage inspector — would
       be gone. The caller is told which problem it was and can offer to start a
       new library deliberately, with `replaceStore`;
     - a name that is already taken comes back as a `conflict` rather than
       silently replacing that entry. Overwrite is the right default for a FILE,
       where the user picked a folder and the browser tells them the name is in
       use; here there is nothing between the button and the loss.            */
function libAdd(name, opts) {
  opts = opts || {};
  if (!nodes.length) return libFail('empty');

  var st = libRead();
  if (st.error && !(opts.replaceStore && st.error.code !== 'nostore')) {
    return { ok: false, error: st.error };
  }

  var entries = st.error ? [] : st.entries;
  var entry = libEntryFor(name);
  var idx = opts.replaceId ? libIndexOf(entries, opts.replaceId) : -1;

  if (idx === -1) {
    var clash = libNameTaken(entries, entry.name);
    if (clash && !opts.replace) return { ok: false, error: null, conflict: clash };
    if (clash) idx = libIndexOf(entries, clash.id);
  }

  if (idx === -1) {
    if (entries.length >= LIB_MAX_ENTRIES) return libFail('full');
    // Newest first: the query just saved is the one most likely to be wanted
    // back, and it should not be at the bottom of a grid of two hundred.
    entries.unshift(entry);
  } else {
    // Replacing keeps the entry's id and its place in the grid, so a card the
    // user has just re-saved does not jump to the front and change identity
    // underneath anything holding on to it.
    entry.id = entries[idx].id;
    entries[idx] = entry;
  }

  var w = libWrite(entries);
  return w.ok ? { ok: true, error: null, entry: entry } : w;
}

function libRename(id, name) {
  var st = libRead();
  if (st.error) return { ok: false, error: st.error };
  var i = libIndexOf(st.entries, id);
  if (i === -1) return libFail('missing');

  var wanted = libName(name);
  if (!wanted) return { ok: true, error: null, entry: st.entries[i] };   // no change
  var clash = libNameTaken(st.entries, wanted, id);
  if (clash) return { ok: false, error: null, conflict: clash };

  st.entries[i].name = wanted;
  var w = libWrite(st.entries);
  return w.ok ? { ok: true, error: null, entry: st.entries[i] } : w;
}

function libRemove(id) {
  var st = libRead();
  if (st.error) return { ok: false, error: st.error };
  var i = libIndexOf(st.entries, id);
  if (i === -1) return libFail('missing');
  var gone = st.entries.splice(i, 1)[0];
  var w = libWrite(st.entries);
  return w.ok ? { ok: true, error: null, entry: gone } : w;
}

/* ----------------------------------------------------------- EXPORT / IMPORT

   The library lives in one browser on one machine, which makes a file the only
   way a query gets to a colleague, to a laptop, or through a cleared cache.
   There is no separate exchange format for that: an exported library is the
   stored object, and a single exported card is the query file Save has always
   written. A format invented for sharing would be a third thing to keep in
   step with the other two.                                                   */

var MAX_LIB_FILE_BYTES = 8 * 1024 * 1024;

/* One entry, cleaned. Shared by the store's read and the importer, because the
   two are asking the same question — is this an entry — of inputs that are
   equally untrusted. Storage can be edited by hand; a file arrived from
   somewhere else entirely.

   `forceId` is how the importer mints a new id for every entry it takes, and
   it does two jobs at once: it cannot collide with an id already in the
   library, and it means an id out of the file is never used for anything. A
   card's buttons carry its id inline, so that closes the injection route for
   the import path completely rather than relying on the pattern test below. */
function libCleanEntry(e, forceId) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;

  var g = e.graph;
  if (!g || typeof g !== 'object' || Array.isArray(g) || g.kind !== FILE_KIND) return null;

  var id = forceId ||
    (typeof e.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(e.id) ? e.id : null);
  if (!id) return null;

  return {
    id: id,
    name: libName(e.name) || '(unnamed)',
    savedAt: typeof e.savedAt === 'string' ? e.savedAt : '',
    graph: g
  };
}

// The whole library as one object, which is exactly what is stored plus a note
// of when it left. Anything that reads it ignores the extra key.
function libExportPayload(entries) {
  return JSON.stringify({
    kind: LIB_KIND,
    version: LIB_VERSION,
    exportedAt: new Date().toISOString(),
    entries: entries
  }, null, 2);
}

/* Import MERGES, and never replaces.

   The alternative — a file overwriting the library — is one click between a
   colleague's set of standard queries and a term of somebody's own work. So an
   entry whose name is already in the library is left alone and counted, and the
   user is told exactly what happened rather than being asked to trust a
   silence. Somebody who wants the incoming version renames theirs and imports
   again, which is two deliberate steps instead of one irreversible one.

   Imported entries go on the END. Saving puts a new query at the front because
   that is the one wanted back; importing twenty should not bury the query that
   was saved this morning under somebody else's. */
function libImportText(raw, fallbackName) {
  var d;
  try { d = JSON.parse(raw); }
  catch (e) {
    return { ok: false, error: libError('badfile', 'That file isn\'t valid JSON.') };
  }

  var incoming;
  if (d && d.kind === LIB_KIND) {
    if (typeof d.version !== 'number' || d.version > LIB_VERSION) {
      return { ok: false, error: libError('newer',
        'That library was exported by a newer version of this tool.') };
    }
    incoming = Array.isArray(d.entries) ? d.entries : [];
  } else if (d && d.kind === FILE_KIND) {
    /* A single saved query, handed to Import rather than to Load. Generous on
       purpose: the two files look identical in a folder, both end in .json, and
       refusing on a technicality would be the tool being right about something
       nobody asked. It becomes a one-entry library named after the file. */
    incoming = [{ name: fallbackName, savedAt: d.savedAt, graph: d }];
  } else {
    return { ok: false, error: libError('badfile',
      'That doesn\'t look like a library or a saved query from this tool.') };
  }

  var st = libRead();
  // Same refusal as libAdd's, for the same reason: a merge into a library that
  // could not be read would write a new one over it.
  if (st.error) return { ok: false, error: st.error };

  var entries = st.entries;
  var added = 0, skipped = 0, dropped = 0, overflow = 0;

  incoming.forEach(function(rawEntry) {
    var e = libCleanEntry(rawEntry, libNewId());
    if (!e) { dropped++; return; }
    if (libNameTaken(entries, e.name)) { skipped++; return; }
    if (entries.length >= LIB_MAX_ENTRIES) { overflow++; return; }
    entries.push(e);
    added++;
  });

  var out = { ok: true, error: null, added: added, skipped: skipped,
              dropped: dropped, overflow: overflow };
  if (!added) return out;

  var w = libWrite(entries);
  // All or nothing: one setItem carries the whole library, so a write that does
  // not fit leaves the library exactly as it was rather than half-merged.
  if (!w.ok) return w;
  return out;
}

/* What happened, as a sentence. Built here rather than in the dialog because
   every number in it is a decision this function made, and a count reported
   without its reason ("2 skipped") is a count the user cannot act on. */
function libImportSummary(r) {
  if (!r.added && !r.skipped && !r.dropped && !r.overflow) {
    return 'That file held no saved queries.';
  }
  var bits = [];
  bits.push(r.added === 1 ? 'Added 1 query.' : 'Added ' + r.added + ' queries.');
  if (r.skipped) {
    bits.push(r.skipped + (r.skipped === 1 ? ' was' : ' were') +
      ' already in the library under the same name and ' +
      (r.skipped === 1 ? 'was' : 'were') + ' left alone.');
  }
  if (r.overflow) {
    bits.push(r.overflow + ' did not fit: the library holds ' + LIB_MAX_ENTRIES + '.');
  }
  if (r.dropped) {
    bits.push(r.dropped + (r.dropped === 1 ? ' was' : ' were') + ' not a saved query.');
  }
  return bits.join(' ');
}

/* The two checks a file gets before a byte of it is read, the same pair and in
   the same order as a picked query file gets. Neither is the last line of
   defence — libImportText refuses anything that is not a library — but by the
   time that runs an arbitrary file is in memory and all it can report is that
   the contents were wrong, which is a poor description of picking the wrong
   file out of a folder. */
function libFileProblem(file) {
  if (!/\.json$/i.test(file.name)) {
    return 'Only .json files can be imported, and "' + file.name + '" is not one.';
  }
  if (file.size > MAX_LIB_FILE_BYTES) {
    return 'That file is far too large to be a library, so it has not been read.';
  }
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/* An entry as the loader wants it. The round trip through text is the point
   rather than an oversight: see the note at the top of this section. Loading is
   wired up with the rest of the library UI, which needs a confirmation in front
   of it — a grid of one-click cards replaces the canvas far more easily than a
   two-step file picker does, and applyGraph() has no undo. */
function libGraphText(id) {
  var e = libGet(id);
  return e ? JSON.stringify(e.graph) : null;
}

