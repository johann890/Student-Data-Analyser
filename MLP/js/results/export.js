/* results/export.js: Copy, download and the one serialiser behind both.
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

/* QUOTING IS DECIDED AGAINST THE SEPARATOR, NOT AGAINST A COMMA
   ---------------------------------------------------------------------------
   This used to test for a comma whatever it was separating with, which was
   right for the file and wrong for the clipboard. Copy writes tab separated
   text, so a cell containing a TAB split into two cells and a cell containing a
   newline split into two rows, and the paste landed in Excel or Word one column
   out from there on with nothing to show why.

   It is reachable without any odd data: an input name is typed into a text box
   and becomes a column header, and a name pasted in from somewhere else can
   carry a tab. A three-column table came out with rows of four, one and three
   fields.

   So the rule is RFC 4180's, asked about whatever is actually dividing the
   cells: quote when the cell holds the separator, a quote mark or a line break,
   and double the quote marks inside. A cell with none of those is untouched,
   which is nearly all of them, so an ordinary copy is byte for byte what it was.
   Excel, Word and Numbers all honour quotes in pasted text, so the quoting
   survives the one trip it has to. */
function quotedCell(v, sep) {
  var s = String(v);
  var needs = s.indexOf(sep) !== -1 || s.indexOf('"') !== -1 ||
              s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1;
  return needs ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Kept as the comma case of the above, which is what every existing caller and
// the exported test surface mean by it.
function csvCell(v) { return quotedCell(v, ','); }

/* THE BYTE ORDER MARK, AND WHY ONLY THE CSV GETS ONE
   ---------------------------------------------------------------------------
   Excel on Windows reads a .csv as the machine's own code page unless the file
   says otherwise, and the only thing it accepts as saying otherwise is a UTF-8
   BOM. Without one, a name carrying a macron or an accent arrives mojibaked,
   and the archive being ASCII today is not a reason to ship a file that cannot
   carry a student's name correctly tomorrow.

   It goes on the CSV and nothing else. A saved query is JSON, and JSON.parse
   refuses a leading BOM, so putting this in downloadFile() would have broken
   every saved query in the library to fix an encoding nothing had complained
   about yet. One format, one marker, decided where the format is decided. */
var UTF8_BOM = '﻿';

// The whole export layer, for every result shape the tool can produce.
function serialiseTable(t, sep, quote) {
  var cell = quote ? function(v){ return quotedCell(v, sep); }
                   : function(v){ return String(v); };
  return [t.columns.map(function(c){ return cell(c.label); }).join(sep)]
    .concat(t.rows.map(function(r) {
      return t.columns.map(function(c, i){ return cell(exportCell(c, r[i])); }).join(sep);
    }))
    .join('\n');
}

/* ============================================================================
   THE FORMATS A RESULT CAN LEAVE IN
   ============================================================================
   One table, four rows, because the four differ only in how a table becomes
   text. Everything else about exporting (which table, what it is called, the
   staleness guard, the clipboard's two attempts) is already written once and
   does not want a copy per format.

   WHY MORE THAN CSV
   CSV reaches Excel, and Excel was the whole requirement. The other two are the
   tools a result actually ends up in afterwards, each of which CSV reaches badly:

     PowerPoint has no "convert text to table", so pasted tab separated text
     lands as a text box and the table has to be rebuilt by hand, or routed
     through Excel first. An HTML table pastes AS a table, because that is the
     flavour PowerPoint and Word look for first.

     LaTeX cannot read a CSV without a package, and worse, the characters this
     tool puts in its own headers are active there. Escaping at the point of
     export is the only place that can be got right: a CSV cannot be escaped for
     LaTeX without breaking it for Excel, which is why this is a format rather
     than a change to the existing one.

   `flavour` is the clipboard type the text should be offered as. Only the HTML
   format has one worth naming; the rest are plain text, and a receiving
   application that wanted something cleverer would have asked for it.

   `filePrefix` exists for exactly one member. See UTF8_BOM: the marker belongs
   on a file and not on a clipboard, and this is the field that says so rather
   than a branch at the call site.                                            */
var EXPORT_FORMATS = [
  { key:'tsv',   label:'Text (tabs)',  ext:'.tsv',
    text: function(t){ return serialiseTable(t, '\t', true); } },
  { key:'csv',   label:'CSV (Excel)',  ext:'.csv', filePrefix: UTF8_BOM,
    text: function(t){ return serialiseTable(t, ',', true); } },
  { key:'html',  label:'HTML table',   ext:'.html', flavour:'text/html',
    text: function(t){ return htmlTable(t); } },
  { key:'latex', label:'LaTeX table',  ext:'.tex',
    text: function(t){ return latexTable(t); } }
];

var COPY_FORMAT_DEFAULT = 'tsv';   // what Copy has always written
var SAVE_FORMAT_DEFAULT = 'csv';   // what Save has always written

function exportFormat(key, fallback) {
  for (var i = 0; i < EXPORT_FORMATS.length; i++) {
    if (EXPORT_FORMATS[i].key === key) return EXPORT_FORMATS[i];
  }
  return exportFormat(fallback || COPY_FORMAT_DEFAULT, COPY_FORMAT_DEFAULT);
}

// The format a given Output is set to, which is the default until it is changed.
// Read through here rather than off cfg, so an unrecognised key in a
// hand-edited file falls back the way every other setting in this tool does.
function copyFormatOf(node) {
  return exportFormat(node && node.cfg ? node.cfg.copyAs : null, COPY_FORMAT_DEFAULT);
}
function saveFormatOf(node) {
  return exportFormat(node && node.cfg ? node.cfg.saveAs : null, SAVE_FORMAT_DEFAULT);
}

/* AN HTML TABLE, FOR PASTING INTO A SLIDE
   Borders as attributes rather than a stylesheet, because the receiving
   application keeps the ones it understands and a class pointing at CSS that
   did not travel is no border at all. Numbers are aligned right the way the
   panel aligns them, so the pasted table reads as the one on screen did.    */
function htmlTable(t) {
  // A heading is aligned the way its column is, which is the rule the panel
  // follows on screen; a right-aligned column of numbers under a left-aligned
  // heading is the one thing that makes a pasted table look unlike the result
  // it was copied from.
  var alignOf = function(c) {
    return (c.type === COLTYPE.NUMBER) ? ' align="right"' : ' align="left"';
  };
  var head = t.columns.map(function(c) {
    return '<th' + alignOf(c) + '>' + esc(c.label) + '</th>';
  }).join('');
  var body = t.rows.map(function(r) {
    return '<tr>' + t.columns.map(function(c, i) {
      return '<td' + alignOf(c) + '>' + esc(exportCell(c, r[i])) + '</td>';
    }).join('') + '</tr>';
  }).join('\n');
  return '<table border="1" cellspacing="0" cellpadding="4">\n' +
         '<thead><tr>' + head + '</tr></thead>\n' +
         '<tbody>\n' + body + '\n</tbody>\n</table>';
}

/* LATEX, WHERE EVERY CHARACTER THIS TOOL WRITES HAS TO BE ACCOUNTED FOR
   ---------------------------------------------------------------------------
   Ten characters are active in LaTeX, and this tool generates three of them in
   its own column headers without anybody typing one: `#` from a node's name, `%`
   from a measure (spelled out now, for the version of this problem that could
   not be escaped at all) and `_` from a column key. Student data supplies more:
   an ampersand in a course title would end a cell early.

   The backslash is taken out first and put back last, through a placeholder,
   which is the only ordering that works. Replacing it in place with
   `\textbackslash{}` straight away looks right and is not: the brace pass that
   follows then escapes the braces that replacement just introduced, and the
   output reads `\textbackslash\{\}`, which typesets as a stray "{}" instead of a
   backslash. Any NUL already in the text is dropped first so it cannot be
   mistaken for the placeholder; the loader refuses control characters anyway, so
   this is a guard rather than a case.

   Two characters are not active but are not ASCII either, and both come from
   this tool: the middot in a joined column's name and the division sign in the
   ratio measure's. They are mapped to the maths this document can typeset
   whatever its input encoding, which is what makes the output here plain ASCII
   and so compilable in a setup that predates utf8 being the default.

   A newline inside a cell becomes a space. A plain `tabular` cell cannot hold a
   line break without a p-column, and a file that will not compile is worse than
   one that reads a little flatter.                                           */
var LATEX_BACKSLASH = '\u0000';

function latexEscape(v) {
  return String(v)
    .replace(/\u0000/g, '')
    .replace(/\\/g, LATEX_BACKSLASH)
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\u00b7/g, '$\\cdot$')
    .replace(/\u00f7/g, '$\\div$')
    .replace(/[\r\n]+/g, ' ')
    .split(LATEX_BACKSLASH).join('\\textbackslash{}');
}

/* `\hline` rather than booktabs' nicer rules, so this compiles in a document
   that loads no packages at all. A reader who has booktabs can swap three
   lines; a reader who does not would otherwise get an error instead of a table.

   The leading comment says what the fragment is and what it needs, because this
   is the one format whose file is not openable on its own: it is meant to be
   pasted into a document that already exists. */
function latexTable(t) {
  var spec = t.columns.map(function(c) {
    return c.type === COLTYPE.NUMBER ? 'r' : 'l';
  }).join('');
  var head = t.columns.map(function(c) {
    return '\\textbf{' + latexEscape(c.label) + '}';
  }).join(' & ');
  var body = t.rows.map(function(r) {
    return t.columns.map(function(c, i) {
      return latexEscape(exportCell(c, r[i]));
    }).join(' & ') + ' \\\\';
  }).join('\n');
  return '% Student Data Analyser export. Paste into a LaTeX document; ' +
           'it needs no extra packages.\n' +
         '\\begin{tabular}{' + spec + '}\n' +
         '\\hline\n' +
         head + ' \\\\\n' +
         '\\hline\n' +
         (body ? body + '\n' : '') +
         '\\hline\n' +
         '\\end{tabular}';
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

/* COPYING AS SOMETHING OTHER THAN PLAIN TEXT
   ---------------------------------------------------------------------------
   An application decides what a paste becomes by asking the clipboard which
   flavours it holds. PowerPoint and Word ask for text/html first, which is the
   whole reason the HTML format exists: the same table pasted as text/plain
   arrives as a text box.

   Two routes, because the modern one is not always available. ClipboardItem
   needs a secure context, and this tool is opened off the filesystem, which is
   exactly the case legacyCopy() was already written for. The fallback sets both
   flavours on the copy event instead, which works wherever execCommand does.

   The plain text is always offered alongside, never instead: an application with
   no use for the markup still gets something it can paste, and that is the one
   thing neither route is allowed to lose. */
function richCopy(text, html) {
  var handler = function(e) {
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('text/html', html);
    e.preventDefault();
  };
  document.addEventListener('copy', handler);
  try { return legacyCopy(text); }
  finally { document.removeEventListener('copy', handler); }
}

function writeClipboard(text, btn, html) {
  function done(ok) { flashBtn(btn, ok ? 'Copied ✓' : 'Copy failed'); }

  if (html && typeof ClipboardItem !== 'undefined' &&
      navigator.clipboard && navigator.clipboard.write) {
    try {
      navigator.clipboard.write([new ClipboardItem({
        'text/html':  new Blob([html],  { type:'text/html'  }),
        'text/plain': new Blob([text], { type:'text/plain' })
      })]).then(function(){ done(true); }, function(){ done(richCopy(text, html)); });
      return;
    } catch (err) { done(richCopy(text, html)); return; }
  }
  if (html) { done(richCopy(text, html)); return; }

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

/* Quoted now, where it used to be raw. No BOM whatever the format: this is text
   on a clipboard rather than bytes on disk, and the receiving application
   already knows the encoding it was handed.

   The format comes off the Output, so an unset one is tab separated text and
   every query written before the dropdown existed copies what it always did. */
function copyOutput(id, btn) {
  var e = exportEntry(id, btn);
  if (!e) return;
  var fmt = copyFormatOf(findNode(id));
  var text = fmt.text(exportTableFor(e));
  writeClipboard(text, btn, fmt.flavour === 'text/html' ? text : null);
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
  /* The extension follows the format rather than being fixed at .csv, because
     the extension is what decides which application opens the file, and a LaTeX
     fragment named .csv opens in Excel. `filePrefix` carries the BOM for the one
     format that wants one. */
  var fmt = saveFormatOf(findNode(id));
  var name = safeName(e.name) + fmt.ext;
  flashBtn(btn, downloadFile(name, (fmt.filePrefix || '') + fmt.text(exportTableFor(e)))
    ? 'Saved ✓' : 'Save failed');
}

/* Opens the panel, because an error is the one thing here that is written
   without having been asked for: a file that would not load reports itself
   through this, and the panel may well be shut. setOutput() deliberately does
   not do the same. Clear and a canvas emptied of its Outputs both write their
   placeholder through it, and neither is news worth opening a panel for. */
function showError(msg) {
  exportData = {};
  resultsFresh = false;
  setOutput('<div class="error-box">' + esc(msg) + '</div>');
  showResultsPanel();
}
function setOutput(html) {
  var pb = document.getElementById('panelBody');
  pb.classList.remove('stale');
  pb.innerHTML = html;
}

