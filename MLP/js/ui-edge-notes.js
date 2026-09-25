/* ui-edge-notes.js: The note that says why a drop did not wire, the edge preview, and
   drawing the wires.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* THE REFUSAL NOTE
   ---------------------------------------------------------------------------
   Shown at the drop, not during the drag. A node being moved around a wired
   graph passes close to its own neighbours constantly, and a note that appeared
   on approach would spend most of its life explaining something the user was
   not asking about. The moment the expectation breaks is the release: that is
   when a wire was supposed to be there and is not.

   A sibling of the scaled layer rather than a child of it, for the same reason
   the edge preview is one: it has to stay readable when the canvas is zoomed
   out, which is exactly when nodes are dropped near each other by accident.
   role="status" so it is announced rather than only drawn.

   Five seconds, because the longest of these sentences is about twenty five
   words and a note that leaves before it has been read is the same as no note.
   It goes early anyway on the next gesture, which is the reading that matters:
   a user who has moved on does not have to wait for it.                      */
var CONN_NOTE_MS = 5200;
var connNoteEl = null, connNoteAnchor = null, connNoteTimer = null;

function ensureConnNoteEl() {
  if (connNoteEl) return connNoteEl;
  connNoteEl = document.createElement('div');
  connNoteEl.className = 'conn-note';
  connNoteEl.setAttribute('role', 'status');
  connNoteEl.style.display = 'none';
  var cv = document.getElementById('canvas');
  if (cv) cv.appendChild(connNoteEl);
  return connNoteEl;
}

function hideConnNote() {
  if (connNoteTimer) { clearTimeout(connNoteTimer); connNoteTimer = null; }
  if (connNoteEl) connNoteEl.style.display = 'none';
  connNoteAnchor = null;
}

function showConnNote(text, at) {
  if (!text) return;
  var el = ensureConnNoteEl();
  if (connNoteTimer) { clearTimeout(connNoteTimer); connNoteTimer = null; }
  el.textContent = text;
  connNoteAnchor = at || null;
  el.style.display = 'block';
  placeConnNote();
  connNoteTimer = setTimeout(hideConnNote, CONN_NOTE_MS);
}

// What is on screen, for a test and for nothing else in the application.
function connNoteText() {
  return (connNoteEl && connNoteEl.style.display !== 'none') ? connNoteEl.textContent : null;
}

/* Projected from world coordinates on every view change, like the edge preview,
   so a zoom or a pan while the note is up moves it with the nodes it is about
   rather than leaving it stranded. */
function placeConnNote() {
  if (!connNoteEl || !connNoteAnchor || connNoteEl.style.display === 'none') return;
  var cv = document.getElementById('canvas');
  if (!cv) return;
  var mid = toScreen(connNoteAnchor.x, connNoteAnchor.y);
  var w = connNoteEl.offsetWidth, h = connNoteEl.offsetHeight;
  var left = Math.max(6, Math.min(mid.x - w / 2, Math.max(6, cv.clientWidth - w - 6)));
  var top = mid.y + 26;
  top = Math.max(6, Math.min(top, Math.max(6, cv.clientHeight - h - 6)));
  connNoteEl.style.left = Math.round(left) + 'px';
  connNoteEl.style.top = Math.round(top) + 'px';
}

/* EDGE DATA PREVIEW
   After a deliberate dwell, show the first few rows travelling along a
   connection. The upstream node's emitted table, recomputed live so it is
   current even mid-edit. A plausibility aid: the "of N" total is the real
   signal, the rows are dataset-ordered texture rather than a sample. */
var PREVIEW_DELAY = 450;
var previewTimer = null;
var previewEl = null;

function cancelPreviewTimer() {
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
}
function armPreviewTimer(conn, pathEl) {
  cancelPreviewTimer();
  previewTimer = setTimeout(function() {
    previewTimer = null;
    showPreview(conn, pathEl);
  }, PREVIEW_DELAY);
}
function ensurePreviewEl() {
  if (previewEl) return previewEl;
  previewEl = document.createElement('div');
  previewEl.className = 'edge-preview';
  previewEl.style.display = 'none';
  document.getElementById('canvas').appendChild(previewEl);
  return previewEl;
}
function hidePreview() {
  if (previewEl) previewEl.style.display = 'none';
  previewAnchor = null;
}

// No saveState() call is needed any more: the model is already current, because
// every keystroke wrote straight into it.
function edgeData(conn) {
  var ev = evaluateGraph();
  if (ev.error) return { error: ev.error };
  var r = ev.res[conn.from];
  if (!r) return { error: 'unresolved' };
  if (!r.hasSource) return { incomplete: true };
  return { table: r.table };
}

// Preview columns are capped, not chosen: a join result carries both inputs'
// headers and runs to a dozen columns, which no floating panel can hold.
// Paired with the .edge-preview width in the stylesheet: Six columns at the
// density four had. Raising this without widening that crowds the cells until
// every one of them ellipsises away to nothing.
var PREVIEW_COLS = 6;
var PREVIEW_ROWS = 5;

/* Which columns to show is a choice, not just a slice. Long free-text columns
   (a course title, a specialisation) consume the whole panel and tell you least
   about whether the right rows are flowing, so they yield to shorter ones. The
   count above the table is the real signal; these rows are texture. */
function previewColumns(t) {
  var wide = [], narrow = [];
  t.columns.forEach(function(c) {
    (c.type === COLTYPE.TEXT || c.key === 'specialisation' ? wide : narrow).push(c);
  });
  var picked = narrow.slice(0, PREVIEW_COLS);
  for (var i = 0; picked.length < PREVIEW_COLS && i < wide.length; i++) picked.push(wide[i]);
  // Keep the table's own left-to-right order rather than the order picked in
  return t.columns.filter(function(c){ return picked.indexOf(c) !== -1; });
}

function previewTableHTML(t) {
  var cols = previewColumns(t);
  var hidden = t.columns.length - cols.length;
  var moreHead = hidden > 0 ? '<th class="ep-more-col" title="' + hidden + ' more columns">…</th>' : '';
  var moreCell = hidden > 0 ? '<td class="ep-more-col">…</td>' : '';

  var head = cols.map(function(c) {
    return '<th title="' + esc(c.label) + '">' + esc(c.label) + '</th>';
  }).join('') + moreHead;

  var body = t.rows.slice(0, PREVIEW_ROWS).map(function(r) {
    return '<tr>' + cols.map(function(c) {
      var v = r[colIndex(t, c.key)];
      var shown = fmtCell(c, v);
      // Truncation is visual only, so the full value goes in the tooltip
      var ttl = cellTitle(c, v) || shown;
      return '<td title="' + esc(ttl) + '">' + esc(shown) + '</td>';
    }).join('') + moreCell + '</tr>';
  }).join('');

  return '<table class="ep-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
}

function showPreview(conn, pathEl) {
  var res = edgeData(conn);
  var el = ensurePreviewEl();
  var body;

  if (res.error) {
    body = '<div class="ep-note">Can\'t preview: ' +
      (res.error.indexOf('Circular') === 0 ? 'circular connection.' : 'graph unresolved.') + '</div>';
  } else if (res.incomplete) {
    body = '<div class="ep-note">No data on this edge yet. Upstream isn\'t connected to a Source.</div>';
  } else {
    var t = res.table, n = t.rows.length;
    var count = '<div class="ep-count"><span class="ep-num">' + n + '</span> row' + (n === 1 ? '' : 's') + ' on this edge</div>';
    body = n === 0
      ? count + '<div class="ep-note">Empty table. Nothing passes this point.</div>'
      : count + previewTableHTML(t) +
        '<div class="ep-foot">showing ' + Math.min(PREVIEW_ROWS, n) + ' of ' + n + ', in table order</div>';
  }
  el.innerHTML = body;
  previewAnchor = pathEl._mid || { x:0, y:0 };
  el.style.display = 'block';
  placePreview();
}

/* The preview is a sibling of the scaled layer, not a child of it, so its text
   stays at a readable size when the canvas is zoomed out, which is exactly when
   a row count is most useful and the nodes themselves are least readable. The
   cost is that its anchor arrives in world coordinates and has to be projected
   here. Kept as its own function so a zoom mid-hover can re-place the panel
   rather than leaving it stranded where the edge used to be. */
var previewAnchor = null;

function placePreview() {
  if (!previewEl || !previewAnchor || previewEl.style.display === 'none') return;
  var mid = toScreen(previewAnchor.x, previewAnchor.y);
  var cv = document.getElementById('canvas');
  var cw = cv.clientWidth, ch = cv.clientHeight;
  var pw = previewEl.offsetWidth, ph = previewEl.offsetHeight;
  var GAP = 26; // clears the ~9px badge radius plus breathing room

  var left = Math.max(6, Math.min(mid.x - pw / 2, cw - pw - 6));
  var top = mid.y - ph - GAP;
  previewEl.classList.remove('ep-below');
  if (top < 6) { top = mid.y + GAP; previewEl.classList.add('ep-below'); }
  // Flipping below can push it off the bottom on a short canvas; clamp last.
  top = Math.min(top, ch - ph - 6);
  previewEl.style.left = Math.round(left) + 'px';
  previewEl.style.top = Math.round(top) + 'px';
}

function repositionPreview() { placePreview(); }

/* True while any canvas gesture is in flight: Dragging a node, sweeping a
   marquee, or panning.

   Connections carry two hover affordances: a delete badge and the data-preview
   panel. Both are helpful when the pointer is resting on a line and actively
   unhelpful while it is travelling across one. Sweeping a marquee used to light
   up every arrow it crossed and pop a preview over the box being drawn, which
   read as the selection picking up the arrows themselves. It never did (only
   node ids ever enter the selection), but the feedback said otherwise, and
   feedback is what the user has to go on. */
function gestureActive() { return !!(drag || marquee || panning); }

function drawArrows() {
  var svg = document.getElementById('svg');
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  cancelPreviewTimer(); // a rebuild invalidates the path a pending preview was armed on

  connections.forEach(function(conn) {
    var a = findNode(conn.from), b = findNode(conn.to);
    if (!a || !b) return;
    var p0 = shapeExit(a), tip = shapeEntry(b, conn.port);

    var g = svgEl('g');
    svg.appendChild(g);
    var pathEl = drawArrow(g, p0, tip, conn.color, '0.9', false);

    if (gestureActive()) return; // no hover affordances mid-gesture

    // Invisible fat stroke so the 2px line is comfortably hoverable, extended to
    // the true tip so the arrowhead counts as part of the line.
    var hit = svgEl('path');
    hit.setAttribute('d', pathEl.getAttribute('d') + ' L ' + tip.x + ' ' + tip.y);
    hit.setAttribute('class', 'conn-hit');
    // Widened as the view shrinks, so the grab band stays ~20 screen px. The CSS
    // value is the 100% case; this overrides it per zoom level.
    hit.setAttribute('stroke-width', 20 / view.z);
    g.appendChild(hit);

    var badge = null, hovered = false;
    function setHover(on) {
      if (on === hovered) return;
      hovered = on;
      if (on) {
        badge = buildDeleteBadge(conn, pathEl);
        if (badge) g.appendChild(badge);
      } else if (badge && badge.parentNode) {
        badge.parentNode.removeChild(badge);
        badge = null;
      }
      hoverConn = on ? connKey(conn) : null;
    }

    // mousemove rather than mouseenter, so hover still engages when the SVG is
    // rebuilt beneath a stationary cursor
    hit.addEventListener('mousemove', function() {
      // Second line of defence. The hit strokes are not built at all while a
      // gesture is running, but one begun *before* the gesture started is still
      // in the DOM and would otherwise light up as the marquee swept past it.
      if (gestureActive()) return;
      setHover(true);
      armPreviewTimer(conn, pathEl);
    });
    g.addEventListener('mouseleave', function() {
      setHover(false);
      cancelPreviewTimer();
      hidePreview();
    });

    if (hoverConn === connKey(conn)) setHover(true);
  });

  if (drag && ghostTarget !== null) {
    var gt = findNode(ghostTarget);
    var dir = gt ? resolveDirection(drag.node, gt) : null;
    if (dir) drawArrow(svg, dir.p0, dir.tip, '#aaaaaa', '0.55', true);
  }
}

