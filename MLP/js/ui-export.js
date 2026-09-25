/* ui-export.js: Copy, download and the one serialiser behind both.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   EXPORT: One serialiser, because there is one data shape
   ============================================================================ */

/* THE PANEL NEVER OUTLIVES THE GRAPH IT DESCRIBES
   ---------------------------------------------------------------------------
   Deleting nodes used to leave whatever was in the results panel exactly where
   it was. A tester loaded a saved query, deleted every node, and was left with
   "Loaded 4 nodes and 3 connections. ... Press Run Query to evaluate it."
   beside a canvas reading "Add nodes using the toolbar above": the two halves
   of the screen disagreeing about whether there was a query at all, and the
   half that was wrong being the one holding the instruction.

   markStale() could not catch it. It returns early once the results are already
   stale, which is the right shortcut for the note it adds and the wrong one for
   everything else in the panel. A load message was never fresh to begin with,
   so nothing was watching it.

   Two rules, both about ownership rather than about staleness:

     A block belongs to an Output. When that Output is gone the block is an
     answer attributed to a node that does not exist, so it goes, and its export
     entry goes with it: Copy and Save must not write out a table whose node was
     deleted.

     An empty canvas has no query to be stale about. There is nothing left to
     re-run, so the panel goes back to the line it opens with rather than asking
     for a run that cannot happen.

   A graph that still has nodes in it keeps its message. "Loaded 4 nodes" is a
   statement about something that happened, and deleting one of them afterwards
   does not make it untrue.                                                   */
var PANEL_START = 'Run a query to see results';

function panelStartHTML() { return '<div class="placeholder">' + PANEL_START + '</div>'; }

/* Returns whether it emptied the panel, so markStale() knows there is nothing
   left to mark. Cheap on every other call: a graph whose Outputs are all still
   on the canvas matches the first block and stops. */
function panelFollowsGraph() {
  var pb = document.getElementById('panelBody');
  if (!pb) return false;

  if (!nodes.length) {
    exportData = {};
    resultsFresh = false;
    setOutput(panelStartHTML());
    return true;
  }

  var blocks = pb.querySelectorAll('.result-block');
  if (!blocks.length) return false;

  var live = 0;
  [].slice.call(blocks).forEach(function(el) {
    var id = parseInt(el.getAttribute('data-output'), 10);
    if (findNode(id)) { live++; return; }
    delete exportData[id];
    if (el.parentNode) el.parentNode.removeChild(el);
  });

  if (!live) {
    exportData = {};
    resultsFresh = false;
    setOutput(panelStartHTML());
    return true;
  }

  /* The note about every Output being hidden counts the Outputs still on the
     canvas, so it has to be re-read whenever one of them is taken away. */
  applyPanelVisibility();
  return false;
}

function markStale() {
  if (panelFollowsGraph()) return;
  if (!resultsFresh) return;
  resultsFresh = false;
  var pb = document.getElementById('panelBody');
  if (!pb || !pb.querySelector('.result-block')) return;
  pb.classList.add('stale');
  if (!pb.querySelector('.stale-note')) {
    var note = document.createElement('div');
    note.className = 'stale-note';
    note.textContent = 'These results are from an earlier version of the graph. Re-run the query.';
    pb.insertBefore(note, pb.firstChild);
  }
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/* Today, as the one date format this tool writes. Its own function because two
   things want it and only one of them wants the time with it: a suggested name
   is read by a person, and the minute it was suggested is noise to them. */
function dateStamp() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function timeStamp(fileSafe) {
  var d = new Date();
  var time = pad2(d.getHours()) + (fileSafe ? '' : ':') + pad2(d.getMinutes());
  return dateStamp() + (fileSafe ? '-' : ' ') + time;
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
     a Compare. The two views available there are exactly summary and lists.

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
   then trim the separators back off the ends. Otherwise a name made entirely
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

// execCommand fallback. Navigator.clipboard needs a secure context, which is
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
      URL:  The blob is not missing because the origin is opaque, it is missing
      because we threw it away while WebKit was still fetching it.

   2. Swapping the blob for a data: URI avoided the race but introduced a size
      ceiling. A saved query is 2-10KB and rode under it; a CSV export of a year
      file is ~320KB, and ~460KB once percent-encoded into a URL. That is why
      Save Query worked and Save CSV did not. The same code, told to carry
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
   filename. Two saves of "grades" produced two differently-named files, and
   the user who had just named the file could not predict what they would get.
   Re-saving now overwrites, or is de-duplicated by the browser, which is what
   every other download on the machine does.

   This also makes the two export paths agree: queryFileName() already writes a
   typed name verbatim and reserves the timestamp for the *default* name, where
   it is a convenience rather than an override. defaultExportName() plays that
   role here. Different Outputs still get distinct names without one. */
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

