/* ui-results.js: The results panel: one renderer for every table.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   RESULTS PANEL: One renderer for every table
   ============================================================================
   Previously there was a card per output type, plus a separate Compare path.
   They rendered the same kinds of thing in slightly different ways and had to
   be kept in step by hand. Every result is now a table, so there is one
   function.                                                                   */

var DISPLAY_ROW_LIMIT = 50;
/* How many per-group tables the "summary + row lists" view will draw. Ten is
   more than a Compare has ever had and few enough that a breakdown by course
   stays a page rather than a download. */
var DISPLAY_CARD_LIMIT = 10;

function tableHTML(t, title, badge) {
  if (t.columns.length === 0) {
    return card(title, '<div class="cmp-empty">Nothing to show. This Output has no columns.</div>', badge);
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
      (t.rows.length - DISPLAY_ROW_LIMIT) + ' more. Copy and Save include every row</td></tr>'
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
// table, so scalars keep the large display. It is the same table underneath;
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
  /* Already the view. The Output applied it during evaluation so that the table
     drawn here and the table a node wired after this Output receives are one
     table rather than two computations that have to be kept in agreement. */
  var t = r.table;

  if (show === 'count') return scalarHTML(t);

  if (show === 'summary' || show === 'lists') {
    /* Read off the view rather than off what arrived, which is the same object
       in these two views: outputTable() returns its input untouched for summary
       and lists, and they are the only views a branch table reaches. */
    var branches = (t.meta && t.meta.branches) || null;
    if (branches) {
      /* Compare-fed or SelectFor-fed: the summary first, then per-branch
         detail if asked for. The heading comes from the meta rather than
         being hardcoded, because "Comparison / 12 branches" over a breakdown
         by course names the node that did not produce it. Compare emits no
         title and keeps the wording it always had. */
      var bTitle = (r.table.meta && r.table.meta.title) || 'Comparison';
      var bUnit  = (r.table.meta && r.table.meta.unit)  ||
                   (branches.length === 1 ? 'branch' : 'branches');
      var html = tableHTML(t, bTitle, branches.length + ' ' + bUnit);
      if (show === 'lists') {
        /* Capped for the reason the rows inside each card are capped, one
           level up. A Compare has two or three branches and this never binds;
           a breakdown by course has seventy-eight groups, and rendering a
           table for each produced most of a megabyte of markup to show
           something nobody scrolls to. Copy and Save are unaffected. They
           write every group, which is where an answer that long belongs. */
        html += branches.slice(0, DISPLAY_CARD_LIMIT).map(function(b) {
          return '<div class="cmp-branch-card">' +
            tableHTML(b.table, b.label, String(b.table.rows.length)) + '</div>';
        }).join('');
        if (branches.length > DISPLAY_CARD_LIMIT) {
          html += '<div class="cmp-more-cards">... ' +
            (branches.length - DISPLAY_CARD_LIMIT) + ' more ' + bUnit +
            ' not shown. Copy and Save include every one</div>';
        }
      }
      return html;
    }
  }

  /* A single value is a single value however it was produced. Until now only
     the Output's own Count setting reached the headline display, so moving the
     same calculation onto the canvas (an Aggregate wired in front, which is
     exactly what removing the Output shortcuts told people to do) demoted the
     answer to a one-cell table. The rule is the shape of the result, not which
     control happened to produce it.

     Placed after the Compare branch above so a one-branch, one-measure summary
     still renders as the comparison it is. */
  if (t.columns.length === 1 && t.rows.length === 1) return scalarHTML(t);

  return tableHTML(t, 'Rows', String(t.rows.length));
}

/* SHOWING AN OUTPUT IN THE PANEL
   ---------------------------------------------------------------------------
   Now that a node can be wired after an Output, an Output is often a step
   rather than an answer: someone wanting the 2024 rows of a result wants that
   result narrowed, not the whole result and the narrowed one stacked above each
   other in the panel. The tick box lets an Output be a step without its block
   taking up the room an answer deserves.

   It is a property of the view and of nothing else. It changes no table, so it
   does not mark the run stale, and the blocks are drawn either way and then
   dressed out of sight, so turning one back on is a class on an element that is
   already there rather than another walk of the graph. */
function hiddenInPanel(node) {
  return !!(node.cfg && node.cfg.panel === false);
}

function outputNodes() {
  return nodes.filter(function(n){ return n.type === 'output'; });
}

/* Drawn always, shown only when nothing else is. A panel that sits empty after
   a run that succeeded reads as a tool that has failed, so it names the switch
   that emptied it rather than leaving the user to find the tick box again. */
function allHiddenNoteHTML(outs) {
  var allHidden = outs.length > 0 && outs.every(hiddenInPanel);
  return '<div class="all-hidden-note' + (allHidden ? '' : ' result-hidden') + '">' +
    'Every Output is hidden from this panel. Tick "Show in results panel" on an ' +
    'Output node to see its answer here.</div>';
}

function applyPanelVisibility() {
  var pb = document.getElementById('panelBody');
  if (!pb) return;
  outputNodes().forEach(function(n) {
    var el = pb.querySelector('[data-output="' + n.id + '"]');
    if (el) el.classList.toggle('result-hidden', hiddenInPanel(n));
  });
  var note = pb.querySelector('.all-hidden-note');
  if (note) {
    var outs = outputNodes();
    note.classList.toggle('result-hidden', !(outs.length > 0 && outs.every(hiddenInPanel)));
  }
}

/* The result view on its own, wrapped so that ticking a column box can replace
   it without redrawing the query log above it or the Copy and Save buttons
   beside it. The wrapper carries the block's own flex column and gap, so a view
   made of several elements (a summary with its branch cards under it) sits
   exactly where it sat when those elements were children of the block itself.
   See .result-view in css/results-panel.css. */
function outputViewHTML(node, r) {
  return '<div class="result-view" data-output-view="' + node.id + '">' +
    resultHTML(node, r) + '</div>';
}

/* Whether anything is wired after this Output. Its column boxes are a pure view
   for this block and a real narrowing for that wire, which is the whole reason
   refreshOutputView() re-dresses and marks stale rather than choosing. */
function outputFeedsAnother(node) {
  return connections.some(function(c){ return c.from === node.id; });
}

/* TICKING A COLUMN ON AN OUTPUT
   ---------------------------------------------------------------------------
   The one group of tick boxes in the tool that changes what is on screen and
   computes nothing, and therefore the one group that must not ask for a run.
   Which columns are looked at is a property of the view: engine-output.js says so
   where outputTable() narrows, and the panel hint beside the boxes promises
   that Copy and Save follow them. A box that answers only after Run Query
   breaks both promises, and it is what the supervisor hit. His words were that
   the ticks changed and the output did not, and he was right to read that as
   the boxes not being for anything.

   So the block is re-dressed from the table the run already kept. No walk of
   the graph, no re-evaluation, and the export entry is updated in the same
   breath so that Copy and Save stay true to what is drawn rather than to what
   was drawn when Run was last pressed.

   Returns whether it managed it. False means there is nothing on screen to
   re-dress (never run, or the block belongs to an older run), and the caller
   falls back to the stale note, which is the honest thing to say then. */
function refreshOutputView(node) {
  var entry = exportData[node.id];
  if (!entry || !entry.arrived) return false;

  var host = document.querySelector('[data-output-view="' + node.id + '"]');
  if (!host) return false;

  var t = outputTable(node, entry.arrived);
  entry.table = t;
  host.innerHTML = resultHTML(node, { table: t });
  return true;
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
      body = '<div class="error-box">Not connected to a Source. This Output has no data path.</div>';
    } else {
      var show = normaliseShow(onode);
      /* Both of these are the evaluator's work now. The view was applied when
         the Output was evaluated, and the OUTPUT line was logged there too, so
         re-applying either here would count the rows of a count and print the
         step twice. */
      var t = r.table;
      var log = r.log;

      /* What ARRIVED at the Output, for the per-branch export. In the two views
         that carry branches it is the same table as the view, but asking the
         graph is honest where assuming they are equal is a fact that has to
         stay true. */
      var upIds = inputsOf(onode.id, primaryPort('output'));
      var upstream = upIds.length ? ev.res[upIds[0]] : null;

      exportData[onode.id] = {
        index: oi + 1,
        show: show,
        name: exportNameOf(onode, oi + 1),
        table: t,
        source: upstream ? upstream.table : t,
        /* The table as it ARRIVED, before this Output's own view narrowed it,
           and null when there was no upstream to take it from. refreshOutputView()
           re-derives the view from this without another walk of the graph.

           Not folded into `source` above, though the two agree whenever there
           IS an upstream: `source` falls back to the already-narrowed table so
           that the per-branch export always has something to read, and
           narrowing an already-narrowed table cannot put a column back. A
           fallback that is right for an export and wrong for a re-derivation
           is two fields, not one. */
        arrived: upstream ? upstream.table : null,
        log: log.map(logText)
      };

      body = '<div class="query-log">' + log.map(logHTML).join('\n') + '</div>' +
        outputViewHTML(onode, r);

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
    html += '<div class="result-block' + (hiddenInPanel(onode) ? ' result-hidden' : '') +
      '" data-output="' + onode.id + '">' + head + body + '</div>';
  });

  html += allHiddenNoteHTML(outNodes);

  setOutput(html);
  resultsFresh = true;
}

/* EXPORT FILE NAME
   Sits next to Copy and Save because that is where it is used. The value is
   still stored on the node, so it travels with a saved query: The model owns
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

/* Delegated on the results panel, which is rebuilt on every run. Per-element
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
  // No markStale() here, by design. See the note above.
}

