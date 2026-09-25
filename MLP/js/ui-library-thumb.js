/* ui-library-thumb.js: The picture drawn on a library card from the query itself.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   THE QUERY LIBRARY: THE PICTURE ON THE CARD
   ============================================================================
   A name alone does not tell you which query you are looking at. "2024 grades"
   and "2024 grades by degree" are the same line of text and two different
   shapes, and the shape is what the user built and what they remember.

   DRAWN FROM THE GRAPH, NEVER CAPTURED FROM THE SCREEN.

   The obvious implementation is a screenshot of the canvas, and it is wrong
   here for four separate reasons, the first of which would be a defect:

     1. A screenshot can contain student records. The results panel holds rows,
        an edge-preview tooltip holds rows, and a Source panel names files. The
        whole point of the save format is that a stored query carries the
        QUESTION and never the ANSWER — 07-saveload asserts it, 31-library
        asserts it again — and a picture of the screen walks straight past that
        guarantee into the same browser storage, where nobody would think to
        look for it. A diagram drawn from `nodes` and `connections` cannot
        contain a record, because it never sees one.
     2. It does not work in Safari, which is what opens this file on a Mac.
        Rasterising DOM means <foreignObject> into a canvas, and WebKit taints
        the canvas when it does, so toDataURL() throws SecurityError.
     3. It cannot be tested here. jsdom has no 2D context, so a PNG path would
        need the `canvas` package — a native build, in a project that has no
        build step on purpose. An SVG is a string.
     4. It is fifty times the size. A saved query is 2-10KB and a 320x170 PNG
        is 30-80KB, against a storage ceiling of about 5MB. The difference is a
        library that holds hundreds and one that holds dozens.

   NOTHING IS STORED. The picture is a pure function of the graph, so it is
   drawn when the grid renders and thrown away with it. That removes the
   storage cost, and it removes an injection route with it: a library file from
   somewhere else can carry a name, but it cannot carry markup to be injected,
   because no markup of its is ever kept or read back.

   THE GEOMETRY IS THE CANVAS'S OWN. shapeExit() and shapeEntry() are pure
   functions of a node's type and position, so the card calls the same ones the
   canvas does and the arrows leave and land in the same places. A second copy
   of that arithmetic would drift, and the symptom would be a thumbnail that
   quietly stopped resembling the query.                                      */

var LIB_THUMB_W = 320;
var LIB_THUMB_H = 170;
var LIB_THUMB_PAD = 12;

/* Far more nodes than any real query, and low enough that a hand-edited store
   claiming ten thousand cannot spend a second building one card's markup. */
var LIB_THUMB_MAX_NODES = 60;

/* THE FIFTH WAY A NODE'S APPEARANCE CAN DISAGREE WITH ITSELF.

   A node is already described in four places that have to stay in step — SHAPE,
   the size rule, the family colour rule and the menu group — and 17-shape-
   styling exists because two of them drifted twice. This palette is a fifth,
   and it is the one with no screen to catch it: a node drawn in the wrong
   colour here appears only on a card in a dialog, next to other cards that look
   plausible. So it is held to the stylesheet by a test in that suite rather
   than by anyone remembering, and a new node that is not named here fails it.

   Border and fill, which is what a shape at this size is: the text colour is
   the border's lighter partner and is read off the same family. */
var LIB_INK = {
  source:           { line: '#2d6640', fill: '#071510', text: '#5ec87a' },
  filter:           { line: '#7a4a18', fill: '#110900', text: '#f0944a' },
  output:           { line: '#1e7fff', fill: '#051830', text: '#3db8ff' },
  sort:             { line: '#5a3a7a', fill: '#120a1a', text: '#b48ce0' },
  reverse:          { line: '#5a3a7a', fill: '#120a1a', text: '#b48ce0' },
  take:             { line: '#5a3a7a', fill: '#120a1a', text: '#b48ce0' },
  unique:           { line: '#5a3a7a', fill: '#120a1a', text: '#b48ce0' },
  select:           { line: '#5a3a7a', fill: '#120a1a', text: '#b48ce0' },
  project:          { line: '#4a6a1e', fill: '#0d1405', text: '#a8d050' },
  aggregate:        { line: '#1f6a6a', fill: '#041416', text: '#5ac8c8' },
  aggregateColumns: { line: '#1f6a6a', fill: '#041416', text: '#5ac8c8' },
  aggregateRows:    { line: '#1f6a6a', fill: '#041416', text: '#5ac8c8' },
  combine:          { line: '#7a2f52', fill: '#170a11', text: '#e089ae' },
  compare:          { line: '#7a2f52', fill: '#170a11', text: '#e089ae' },
  selectFor:        { line: '#3a4a8a', fill: '#090c18', text: '#8fa8f0' },
  histogram:        { line: '#3a4a8a', fill: '#090c18', text: '#8fa8f0' }
};

var LIB_INK_UNKNOWN = { line: '#3a3a3a', fill: '#101010', text: '#8a8a8a' };
function libInk(type) { return LIB_INK[type] || LIB_INK_UNKNOWN; }

/* The corner the stylesheet gives each shape: a circle for the Source, the
   Output's generous 10px, and 3px for everything else. Expressed as a radius in
   world units so it scales with the rest. */
function libRadius(type) { return type === 'output' ? 10 : 3; }

// Where the shape sits inside its NODE_W-wide slot, which is what shapeExit()
// and shapeEntry() measure from. SHAPE describes the head only, and the head is
// all a thumbnail draws: the config panel below it is not part of the picture.
function libShapeBox(n) {
  var s = SHAPE[n.type];
  return { x: n.x + (NODE_W - s.w) / 2, y: n.y, w: s.w, h: s.h };
}

/* The nodes worth drawing, with their positions coerced.

   A stored graph is not a trusted input: it survives versions of this tool that
   do not exist yet and it can be edited by hand. A node whose type this tool no
   longer has cannot be sized and is skipped; an `x` that arrives as a string or
   as null would otherwise put NaN into a coordinate, and one NaN in an SVG path
   is a blank card rather than a wrong one. */
function libThumbNodes(graph) {
  var out = [];
  var ns = (graph && Array.isArray(graph.nodes)) ? graph.nodes : [];
  for (var i = 0; i < ns.length && out.length < LIB_THUMB_MAX_NODES; i++) {
    var n = ns[i];
    if (!n || !SHAPE[n.type]) continue;
    out.push({ id: n.id, type: n.type, x: Number(n.x) || 0, y: Number(n.y) || 0 });
  }
  return out;
}

function libR1(v) { return Math.round(v * 10) / 10; }

/* A small filled triangle at the tip, pointing the way the wire runs. The
   canvas draws its own arrowheads the same way and for the same reason: a line
   between two boxes says they are connected, and an arrow says which way the
   rows travel, which is the half a reader actually needs. */
function libArrowHead(x0, y0, x1, y1) {
  var a = Math.atan2(y1 - y0, x1 - x0);
  var back = 5.5, wide = 2.8;
  var bx = x1 - Math.cos(a) * back, by = y1 - Math.sin(a) * back;
  var nx = -Math.sin(a) * wide, ny = Math.cos(a) * wide;
  return 'M' + libR1(x1) + ' ' + libR1(y1) +
         'L' + libR1(bx + nx) + ' ' + libR1(by + ny) +
         'L' + libR1(bx - nx) + ' ' + libR1(by - ny) + 'Z';
}

/* The card's picture, as SVG markup.

   Every string that reaches the output is either a number this function
   computed or a value out of NODE_LABELS, which is a table in this file. No
   part of a stored entry is written into the markup — not its name, not its
   config, not a filename. That is worth stating because it is what makes it
   safe to inject the result with innerHTML, and because it is also a privacy
   property: a Filter can legitimately hold a typed value that identifies a
   person, and a picture that renders config text would put it on a card in a
   dialog somebody is showing on a projector. The card shows what KIND of node
   it is and nothing else. */
function libThumb(graph) {
  var head = '<svg class="lib-thumb-svg" viewBox="0 0 ' + LIB_THUMB_W + ' ' + LIB_THUMB_H +
             '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" ' +
             'preserveAspectRatio="xMidYMid meet">';
  var ns = libThumbNodes(graph);

  if (!ns.length) {
    /* An entry with nothing drawable: a graph of node types this tool has
       dropped, or one saved by a version that names them differently. The card
       still exists, so it can be exported or deleted, and says why it is
       blank rather than showing an empty frame. */
    return head + '<text x="' + (LIB_THUMB_W / 2) + '" y="' + (LIB_THUMB_H / 2) +
           '" fill="#5a5a5a" font-size="11" text-anchor="middle" ' +
           'dominant-baseline="middle">nothing this version can draw</text></svg>';
  }

  var b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  ns.forEach(function(n) {
    var r = libShapeBox(n);
    b.x1 = Math.min(b.x1, r.x);          b.y1 = Math.min(b.y1, r.y);
    b.x2 = Math.max(b.x2, r.x + r.w);    b.y2 = Math.max(b.y2, r.y + r.h);
  });
  var bw = Math.max(1, b.x2 - b.x1), bh = Math.max(1, b.y2 - b.y1);

  /* Capped at 1, the way zoomToFit is, and for a reason that matters more on a
     grid than on a canvas: a node is then the same size on every card, so its
     size means "a node" rather than "a small query". Blown up to fill the
     frame, a two-node query and a twenty-node one would look equally busy. */
  var z = Math.min((LIB_THUMB_W - 2 * LIB_THUMB_PAD) / bw,
                   (LIB_THUMB_H - 2 * LIB_THUMB_PAD) / bh, 1);
  var ox = (LIB_THUMB_W - bw * z) / 2 - b.x1 * z;
  var oy = (LIB_THUMB_H - bh * z) / 2 - b.y1 * z;
  function px(v) { return libR1(v * z + ox); }
  function py(v) { return libR1(v * z + oy); }

  var byId = {};
  ns.forEach(function(n) { byId[n.id] = n; });

  /* Wires first, so a shape always sits on top of the line entering it. The
     port is resolved exactly as the loader resolves it, so a version 1 entry —
     which names no ports at all — draws its wires where opening it would put
     them, rather than defaulting to somewhere else. */
  var wires = '';
  var cs = (graph && Array.isArray(graph.connections)) ? graph.connections : [];
  cs.forEach(function(c) {
    if (!c) return;
    var a = byId[c.from], d = byId[c.to];
    if (!a || !d) return;
    var p0 = shapeExit(a);
    var p1 = shapeEntry(d, normalisePort(d.type, c.port));
    var x0 = px(p0.x), y0 = py(p0.y), x1 = px(p1.x), y1 = py(p1.y);
    wires += '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y1 +
             '" stroke="#4a4a4a" stroke-width="1.2"/>' +
             '<path d="' + libArrowHead(x0, y0, x1, y1) + '" fill="#4a4a4a"/>';
  });

  var shapes = '', labels = '';
  ns.forEach(function(n) {
    var r = libShapeBox(n), ink = libInk(n.type);
    var x = px(r.x), y = py(r.y), w = libR1(r.w * z), h = libR1(r.h * z);

    if (n.type === 'source') {
      shapes += '<ellipse cx="' + libR1(x + w / 2) + '" cy="' + libR1(y + h / 2) +
                '" rx="' + libR1(w / 2) + '" ry="' + libR1(h / 2) + '"';
    } else {
      shapes += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
                '" rx="' + libR1(libRadius(n.type) * z) + '"';
    }
    shapes += ' fill="' + ink.fill + '" stroke="' + ink.line + '" stroke-width="1.5"/>';

    /* The label, fitted rather than guessed at. `textLength` makes the browser
       condense the glyphs to exactly the width given, so "Agg. Columns" and
       "Take" both sit inside their shape at any zoom and neither spills over
       the edge of a neighbouring node. Sizing the font to fit instead would
       mean measuring text, which is the one thing this cannot do: the markup
       is built before it is in a document, and in the test harness there is no
       layout at all.

       Below about thirty pixels the letters stop being letters, so the label is
       dropped and the diagram reads by colour and arrangement, which at that
       size is all anyone is reading anyway. */
    if (w >= 30) {
      var fs = libR1(Math.max(5, Math.min(9, h * 0.22)));
      labels += '<text x="' + libR1(x + w / 2) + '" y="' + libR1(y + h / 2) +
                '" textLength="' + libR1(w * 0.76) + '" lengthAdjust="spacingAndGlyphs"' +
                ' fill="' + ink.text + '" font-size="' + fs + '"' +
                ' font-family="system-ui, sans-serif" font-weight="700"' +
                ' text-anchor="middle" dominant-baseline="central">' +
                esc(String(NODE_LABELS[n.type] || n.type).toUpperCase()) + '</text>';
    }
  });

  return head + wires + shapes + labels + '</svg>';
}

