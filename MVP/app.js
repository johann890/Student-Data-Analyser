(function() {

/* PALETTE OF EDGE COLOURS (one per source/path) */
var EDGE_PALETTE = ['#ffffff','#30d87a','#4aaff0','#e060b0','#a0d040','#9080e0'];
var edgeColorIndex = 0;

/* TEST DATASET */
var SPECS = ["Software Engineering","Computer Science","Information Technology","Data Science","Cybersecurity","Artificial Intelligence"];
var G22 = [78,82,91,65,88,72,95,55,83,70,61,79,86,73,90,68,77,84,62,92,75,80,58,87,71,94,66,85,76,89,63,74,81,93,69,78,85,72,60,88];
var G23 = [82,85,78,70,91,76,88,60,86,74,65,83,89,77,92,71,80,87,66,95,78,84,62,90,75,97,70,88,80,93,67,78,84,96,73,82,88,76,63,91];

function letterGrade(g) {
  if (g>=90) return 'A+'; if (g>=85) return 'A'; if (g>=80) return 'A-';
  if (g>=75) return 'B+'; if (g>=70) return 'B'; if (g>=65) return 'B-';
  if (g>=60) return 'C+'; if (g>=55) return 'C'; return 'D';
}
var STUDENTS = [];
var baseId = 1001;
[G22,G23].forEach(function(arr,yi) {
  arr.forEach(function(g,i) {
    STUDENTS.push({ id:baseId++, gender:i%2===0?'M':'F', gradeAvg:g, year:2022+yi, specialisation:SPECS[i%SPECS.length], letterGrade:letterGrade(g) });
  });
});

/* STATE */
var nodes = [];
var connections = []; // [{from: nodeId, to: nodeId, color: '#...'}]
var idCtr = 0;
var drag = null;
var lastResults = {}; // nodeId -> {count, avg, etc} for inline display
var SNAP_DIST = 160; // px proximity threshold — measured between shape edges
var hoverConn = null; // connKey() of the connection currently hovered, or null

function uid() { return ++idCtr; }

/* NODE SHAPE DIMENSIONS  */
// Shape sizes (must match CSS). Node div is always 220px wide; shapes are centered inside it.
var NODE_W = 220;
var SHAPE = {
  source: { w:100, h:100 },
  filter: { w:106, h:84 },
  output: { w:106, h:66 }
};

// Right edge of the shape (horizontally centered in the 196px node div)
function shapeExit(node) {
  var s = SHAPE[node.type];
  var shapeLeft = node.x + (NODE_W - s.w) / 2;
  return { x: shapeLeft + s.w, y: node.y + s.h / 2 };
}

// Left edge of the shape
function shapeEntry(node) {
  var s = SHAPE[node.type];
  var shapeLeft = node.x + (NODE_W - s.w) / 2;
  return { x: shapeLeft, y: node.y + s.h / 2 };
}

/* ADD / REMOVE */
function addNode(type) {
  var cv = document.getElementById('canvas');
  var x = 60 + Math.random() * Math.max(80, cv.clientWidth - 260);
  var y = 60 + Math.random() * Math.max(80, cv.clientHeight - 220);
  // Each source gets a unique edge colour; others start with first palette colour, override when connected
  var color = EDGE_PALETTE[edgeColorIndex++ % EDGE_PALETTE.length];
  nodes.push({ id:uid(), type:type, x:Math.round(x), y:Math.round(y), color:color, criteria:type==='filter'?[{ft:'gradeAvg',op:'gt',val:'70',spec:'Software Engineering',gender:'M',year:'2022'}]:[] });
  render();
}

function removeNode(id) {
  nodes = nodes.filter(function(n){ return n.id!==id; });
  connections = connections.filter(function(c){ return c.from!==id && c.to!==id; });
  delete lastResults[id];
  render();
}

function clearAll() {
  nodes = []; connections = []; lastResults = {}; edgeColorIndex = 0;
  render();
  setOutput('<div class="placeholder">Run a query to see results</div>');
}

/* CRITERION MANAGEMENT */
function addCriterion(nodeId) {
  var n = findNode(nodeId);
  if (!n) return;
  n.criteria.push({ft:'gradeAvg',op:'gt',val:'70',spec:'Software Engineering',gender:'M',year:'2022'});
  render();
}
function removeCriterion(nodeId, idx) {
  var n = findNode(nodeId);
  if (!n) return;
  n.criteria.splice(idx,1);
  render();
}

/* DRAG */
var ghostTarget = null; // node id of the closest candidate during drag

function startDrag(e, nodeId) {
  if (e.target.tagName==='SELECT'||e.target.tagName==='INPUT'||e.target.tagName==='BUTTON') return;
  e.preventDefault();
  var node = findNode(nodeId);
  if (!node) return;
  var cv = document.getElementById('canvas');
  var rect = cv.getBoundingClientRect();
  drag = { node:node, ox:e.clientX-rect.left-node.x, oy:e.clientY-rect.top-node.y };
  ghostTarget = null;
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function nodeCenterX(n) { return n.x + NODE_W/2; }
function nodeCenterY(n) { return n.y + SHAPE[n.type].h/2; }

function onMove(e) {
  if (!drag) return;
  var cv = document.getElementById('canvas');
  var rect = cv.getBoundingClientRect();
  drag.node.x = Math.max(0, Math.min(rect.width-100, e.clientX-rect.left-drag.ox));
  drag.node.y = Math.max(0, Math.min(rect.height-100, e.clientY-rect.top-drag.oy));

  // Find closest node that could form a valid connection — measure port-to-port distance
  var dn = drag.node;
  var best = null, bestDist = SNAP_DIST;
  nodes.forEach(function(n) {
    if (n.id === dn.id) return;
    // Valid pairs: source→filter, source→output, filter→filter, filter→output
    var validFrom = (dn.type==='source' && (n.type==='filter'||n.type==='output')) ||
                    (dn.type==='filter' && (n.type==='filter'||n.type==='output'));
    var validTo   = (n.type==='source'  && (dn.type==='filter'||dn.type==='output')) ||
                    (n.type==='filter'  && (dn.type==='filter'||dn.type==='output'));
    if (!validFrom && !validTo) return;

    // Measure distance between the two relevant ports:
    // if dn would be the "from" node, measure dn's exit → n's entry
    // if dn would be the "to" node, measure n's exit → dn's entry
    var dist = Infinity;
    if (validFrom) {
      var ex = shapeExit(dn), en = shapeEntry(n);
      var dx = en.x - ex.x, dy = en.y - ex.y;
      dist = Math.min(dist, Math.sqrt(dx*dx+dy*dy));
    }
    if (validTo) {
      var ex2 = shapeExit(n), en2 = shapeEntry(dn);
      var dx2 = en2.x - ex2.x, dy2 = en2.y - ex2.y;
      dist = Math.min(dist, Math.sqrt(dx2*dx2+dy2*dy2));
    }
    if (dist < bestDist) { bestDist = dist; best = n; }
  });
  ghostTarget = best ? best.id : null;
  render();
}

function onUp() {
  if (drag && ghostTarget !== null) {
    var dn = drag.node;
    var gt = findNode(ghostTarget);
    var fromNode, toNode;
    // Determine direction: prefer exit(dn)→entry(gt) if dn is to the left, else swap
    var ex = shapeExit(dn), en = shapeEntry(gt);
    var ex2 = shapeExit(gt), en2 = shapeEntry(dn);
    var distFwd = Math.pow(en.x-ex.x,2)+Math.pow(en.y-ex.y,2);
    var distRev = Math.pow(en2.x-ex2.x,2)+Math.pow(en2.y-ex2.y,2);
    // Also respect type validity: source/filter can only be "from"
    var dnCanBeFrom = (dn.type==='source'&&(gt.type==='filter'||gt.type==='output'))||(dn.type==='filter'&&(gt.type==='filter'||gt.type==='output'));
    var gtCanBeFrom = (gt.type==='source'&&(dn.type==='filter'||dn.type==='output'))||(gt.type==='filter'&&(dn.type==='filter'||dn.type==='output'));
    if (dnCanBeFrom && (!gtCanBeFrom || distFwd <= distRev)) { fromNode = dn; toNode = gt; }
    else { fromNode = gt; toNode = dn; }

    // Avoid duplicate connections
    var exists = connections.some(function(c){ return c.from===fromNode.id && c.to===toNode.id; });
    if (!exists) {
      // Pick a color: inherit from fromNode's incoming edge color, but if fromNode already
      // has outgoing edges, give each new output a distinct palette color
      var outgoing = connections.filter(function(c){ return c.from===fromNode.id; });
      var edgeColor;
      if (outgoing.length === 0) {
        // First outgoing: inherit upstream color or use node's own color
        edgeColor = getNodeEdgeColor(fromNode);
      } else {
        // Additional outgoing: pick next palette color not already used from this node
        var usedColors = outgoing.map(function(c){ return c.color; });
        edgeColor = getNodeEdgeColor(fromNode); // start with inherited
        // Find a palette color not yet used
        for (var pi=0; pi<EDGE_PALETTE.length; pi++) {
          if (usedColors.indexOf(EDGE_PALETTE[pi]) === -1) {
            edgeColor = EDGE_PALETTE[pi];
            break;
          }
        }
      }
      connections.push({ from: fromNode.id, to: toNode.id, color: edgeColor });
    }
    ghostTarget = null;
  }
  drag = null;
  ghostTarget = null;
  document.removeEventListener('mousemove', onMove);
  document.removeEventListener('mouseup', onUp);
  render();
}

// Get the color a node's outgoing edges should use
function getNodeEdgeColor(node) {
  // If this node has an incoming connection, inherit that color
  var incoming = connections.filter(function(c){ return c.to === node.id; });
  if (incoming.length > 0) return incoming[0].color;
  return node.color || EDGE_PALETTE[0];
}

function findNode(id) {
  for (var i=0;i<nodes.length;i++) if (nodes[i].id===id) return nodes[i];
  return null;
}

/* READ FORM VALUES */
function gv(id,key) { var el=document.getElementById('f_'+id+'_'+key); return el?el.value:''; }
function gvC(nid,ci,key) { var el=document.getElementById('fc_'+nid+'_'+ci+'_'+key); return el?el.value:''; }

/* SAVE STATE BEFORE RERENDER */
function saveState() {
  nodes.forEach(function(node) {
    if (node.type==='source') {
      var v = gv(node.id,'pop'); if (v) node._pop = v;
    }
    if (node.type==='output') {
      var v = gv(node.id,'outputType'); if (v) node._outputType = v;
    }
    if (node.type==='filter') {
      node.criteria.forEach(function(c,ci) {
        var ft = gvC(node.id,ci,'ft'); if (ft) c.ft = ft;
        var op = gvC(node.id,ci,'op'); if (op) c.op = op;
        var val = gvC(node.id,ci,'val'); if (val!=='') c.val = val;
        var sp = gvC(node.id,ci,'spec'); if (sp) c.spec = sp;
        var gn = gvC(node.id,ci,'gender'); if (gn) c.gender = gn;
        var yr = gvC(node.id,ci,'year'); if (yr) c.year = yr;
      });
    }
  });
}

/* RENDER */
function render() {
  saveState();
  var cv = document.getElementById('canvas');
  var old = cv.querySelectorAll('.node');
  for (var i=0;i<old.length;i++) old[i].parentNode.removeChild(old[i]);
  document.getElementById('hint').style.display = nodes.length===0?'block':'none';

  nodes.forEach(function(node) {
    var el = document.createElement('div');
    el.className = 'node';
    el.style.left = node.x+'px';
    el.style.top  = node.y+'px';

    // Inline result only shown on output nodes for count/avg — but per feedback, suppress entirely
    var inline = '';
    el.innerHTML = shapeHTML(node, inline) + configHTML(node);
    cv.appendChild(el);

    var shape = el.querySelector('.shape-source') || el.querySelector('.shape-filter') || el.querySelector('.shape-output');
    (function(nid){
      shape.addEventListener('mousedown', function(e){ startDrag(e,nid); });
    })(node.id);

    // Criterion ft change → re-render (save first)
    var ftSels = el.querySelectorAll('.ft-sel');
    ftSels.forEach(function(sel) {
      sel.addEventListener('change', function() { render(); });
    });
  });

  drawArrows();
}

function shapeHTML(node, inline) {
  var removeBtn = '<button class="node-remove" onclick="(function(){removeNode('+node.id+')})()">x</button>';
  var inlineHTML = inline ? '<span class="node-inline-result">'+inline+'</span>' : '';

  if (node.type==='source') {
    return '<div class="shape-source">'+removeBtn+'Source'+inlineHTML+'</div>';
  }
  if (node.type==='filter') {
    return '<div class="shape-filter">'+removeBtn+'Filter'+inlineHTML+'</div>';
  }
  if (node.type==='output') {
    return '<div class="shape-output">'+removeBtn+'Output'+inlineHTML+'</div>';
  }
  return '';
}

function configHTML(node) {
  var id = node.id;
  var html = '<div class="node-config">';

  if (node.type==='source') {
    var popVal = node._pop || 'all';
    html += '<div class="cfg-label">Population</div>'+
      '<select id="f_'+id+'_pop">'+
        '<option value="all"'+(popVal==='all'?' selected':'')+'>All students</option>'+
        '<option value="2022"'+(popVal==='2022'?' selected':'')+'>2022 only</option>'+
        '<option value="2023"'+(popVal==='2023'?' selected':'')+'>2023 only</option>'+
      '</select>';
  }

  if (node.type==='filter') {
    html += '<div class="criteria-list">';
    node.criteria.forEach(function(c,ci) {
      html += criterionHTML(id, ci, c);
    });
    html += '</div>'+
      '<button class="add-criterion-btn" onclick="(function(){addCriterion('+id+')})()">+ add condition</button>';
  }

  if (node.type==='output') {
    var ot = node._outputType || 'count';
    html += '<div class="cfg-label">Type</div>'+
      '<select id="f_'+id+'_outputType">'+
        '<option value="count"'+(ot==='count'?' selected':'')+'>Count</option>'+
        '<option value="list"'+(ot==='list'?' selected':'')+'>List</option>'+
        '<option value="average"'+(ot==='average'?' selected':'')+'>Average</option>'+
      '</select>';
  }

  html += '</div>';
  return html;
}

function criterionHTML(nid, ci, c) {
  var ft = c.ft || 'gradeAvg';
  var op = c.op || 'gt';
  var removeBtn = ci > 0
    ? '<button class="remove-criterion-btn" onclick="(function(){removeCriterion('+nid+','+ci+')})()">x</button>'
    : '';

  var fieldSel = '<select id="fc_'+nid+'_'+ci+'_ft" class="ft-sel">'+
    '<option value="gradeAvg"'+(ft==='gradeAvg'?' selected':'')+'>Grade Avg</option>'+
    '<option value="year"'+(ft==='year'?' selected':'')+'>Year</option>'+
    '<option value="specialisation"'+(ft==='specialisation'?' selected':'')+'>Spec</option>'+
    '<option value="gender"'+(ft==='gender'?' selected':'')+'>Gender</option>'+
  '</select>';

  var valueControls = '';
  if (ft==='gradeAvg') {
    // three-col grid: field | op | number
    valueControls = '<div class="criterion-controls">'+
      fieldSel+
      '<select id="fc_'+nid+'_'+ci+'_op">'+
        '<option value="gt"'+(op==='gt'?' selected':'')+'>&gt;</option>'+
        '<option value="gte"'+(op==='gte'?' selected':'')+'>&gt;=</option>'+
        '<option value="lt"'+(op==='lt'?' selected':'')+'>&lt;</option>'+
        '<option value="lte"'+(op==='lte'?' selected':'')+'>&lt;=</option>'+
        '<option value="eq"'+(op==='eq'?' selected':'')+'>  =</option>'+
      '</select>'+
      '<input type="number" id="fc_'+nid+'_'+ci+'_val" value="'+(c.val||'70')+'" min="0" max="100">'+
    '</div>';
  } else if (ft==='year') {
    // two-col grid: field | year
    valueControls = '<div class="criterion-controls two-col">'+
      fieldSel+
      '<select id="fc_'+nid+'_'+ci+'_year">'+
        '<option value="2022"'+(c.year==='2022'?' selected':'')+'>2022</option>'+
        '<option value="2023"'+(c.year==='2023'?' selected':'')+'>2023</option>'+
      '</select>'+
    '</div>';
  } else if (ft==='specialisation') {
    // two-col grid: field | spec (spec is wide so put it on second row)
    valueControls = '<div class="criterion-controls two-col">'+
      fieldSel+
      '<select id="fc_'+nid+'_'+ci+'_spec">'+
        opt('Software Engineering',c.spec)+opt('Computer Science',c.spec)+
        opt('Information Technology',c.spec)+opt('Data Science',c.spec)+
        opt('Cybersecurity',c.spec)+opt('Artificial Intelligence',c.spec)+
      '</select>'+
    '</div>';
  } else if (ft==='gender') {
    // two-col grid: field | gender
    valueControls = '<div class="criterion-controls two-col">'+
      fieldSel+
      '<select id="fc_'+nid+'_'+ci+'_gender">'+
        '<option value="M"'+(c.gender==='M'?' selected':'')+'>M</option>'+
        '<option value="F"'+(c.gender==='F'?' selected':'')+'>F</option>'+
      '</select>'+
    '</div>';
  }

  return '<div class="criterion-row">'+valueControls+removeBtn+'</div>';
}

function opt(val, cur) {
  return '<option value="'+val+'"'+(cur===val?' selected':'')+'>'+val+'</option>';
}

/* ARROWS */
function resolveColor(node, chain) {
  // Find first source upstream (or self if source)
  if (node.type==='source') return node.color || EDGE_PALETTE[0];
  var idx = chain.indexOf(node);
  for (var i=idx-1; i>=0; i--) {
    if (chain[i].type==='source') return chain[i].color || EDGE_PALETTE[0];
  }
  return EDGE_PALETTE[0];
}

function svgEl(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function drawArrow(parent, p0, tip, color, opacity, isGhost) {
  var ah = 14; // bigger arrowhead
  var pathEndX = tip.x - ah;
  var pathEndY = tip.y;

  var dx = Math.max(40, Math.abs(tip.x - p0.x) * 0.45);
  var p1x = p0.x + dx, p1y = p0.y;
  var p2x = pathEndX - Math.max(10, dx * 0.2), p2y = pathEndY;

  var pathEl = document.createElementNS('http://www.w3.org/2000/svg','path');
  pathEl.setAttribute('d','M '+p0.x+' '+p0.y+' C '+p1x+' '+p1y+' '+p2x+' '+p2y+' '+pathEndX+' '+pathEndY);
  pathEl.setAttribute('stroke', color);
  pathEl.setAttribute('stroke-width', isGhost ? '1.5' : '2');
  pathEl.setAttribute('fill','none');
  pathEl.setAttribute('opacity', opacity);
  if (isGhost) pathEl.setAttribute('stroke-dasharray','6 4');

  var ang = Math.atan2(tip.y - pathEndY, tip.x - pathEndX);
  var spread = 0.42;
  var ax1 = tip.x - ah*Math.cos(ang-spread);
  var ay1 = tip.y - ah*Math.sin(ang-spread);
  var ax2 = tip.x - ah*Math.cos(ang+spread);
  var ay2 = tip.y - ah*Math.sin(ang+spread);
  var arrowEl = document.createElementNS('http://www.w3.org/2000/svg','polygon');
  arrowEl.setAttribute('points', tip.x+','+tip.y+' '+ax1+','+ay1+' '+ax2+','+ay2);
  arrowEl.setAttribute('fill', color);
  arrowEl.setAttribute('opacity', isGhost ? opacity : Math.min(1, parseFloat(opacity)+0.2));

  // Cubic bezier at t=0.5 → (P0 + 3P1 + 3P2 + P3) / 8. Used as a fallback
  // midpoint if getPointAtLength is unavailable.
  pathEl._mid = {
    x: (p0.x + 3 * p1x + 3 * p2x + pathEndX) / 8,
    y: (p0.y + 3 * p1y + 3 * p2y + pathEndY) / 8
  };

  parent.appendChild(pathEl);
  parent.appendChild(arrowEl);
  return pathEl;
}

/* CONNECTION REMOVAL */
function connKey(c) { return c.from + '->' + c.to; }

function removeConnection(from, to) {
  connections = connections.filter(function(c) {
    return !(c.from === from && c.to === to);
  });
  hoverConn = null;
  render();
}

// Builds the little red "x" badge that sits at the midpoint of a hovered connection
function buildDeleteBadge(conn, pathEl) {
  var mid;
  try {
    mid = pathEl.getPointAtLength(pathEl.getTotalLength() / 2);
  } catch (err) {
    mid = pathEl._mid; // geometric fallback
  }
  if (!mid) return null;

  var g = svgEl('g');
  g.setAttribute('class', 'conn-delete');
  g.setAttribute('transform', 'translate(' + mid.x + ',' + mid.y + ')');

  var circle = svgEl('circle');
  circle.setAttribute('r', '9');
  g.appendChild(circle);

  var r = 3.6;
  [[-r, -r, r, r], [-r, r, r, -r]].forEach(function(pts) {
    var line = svgEl('line');
    line.setAttribute('x1', pts[0]); line.setAttribute('y1', pts[1]);
    line.setAttribute('x2', pts[2]); line.setAttribute('y2', pts[3]);
    g.appendChild(line);
  });

  var title = svgEl('title');
  title.textContent = 'Remove this connection';
  g.appendChild(title);

  g.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  g.addEventListener('click', function(e) {
    e.stopPropagation();
    removeConnection(conn.from, conn.to);
  });

  return g;
}

function drawArrows() {
  var svg = document.getElementById('svg');
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // Draw real connections
  connections.forEach(function(conn) {
    var a = findNode(conn.from), b = findNode(conn.to);
    if (!a || !b) return;
    var p0 = shapeExit(a);
    var tip = shapeEntry(b);

    var g = svgEl('g');
    svg.appendChild(g);
    var pathEl = drawArrow(g, p0, tip, conn.color, '0.9', false);

    // No hover affordances mid-drag — the pointer is busy moving a node
    if (drag) return;

    // Invisible fat stroke so the thin 2px line is comfortably hoverable.
    // Extended to the true tip so the arrowhead counts as part of the line —
    // the drawn path stops short of it to make room for the polygon.
    var hit = svgEl('path');
    hit.setAttribute('d', pathEl.getAttribute('d') + ' L ' + tip.x + ' ' + tip.y);
    hit.setAttribute('class', 'conn-hit');
    g.appendChild(hit);

    var badge = null, hovered = false;
    function setHover(on) {
      if (on === hovered) return;
      hovered = on;
      if (on) {
        badge = buildDeleteBadge(conn, pathEl);
        if (badge) g.appendChild(badge);
      } else {
        if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
        badge = null;
      }
      hoverConn = on ? connKey(conn) : null;
    }

    // mousemove (not just mouseenter) so hover still engages if the SVG was
    // rebuilt underneath a stationary cursor — mouseenter would never fire there
    hit.addEventListener('mousemove', function() { setHover(true); });
    g.addEventListener('mouseleave', function() { setHover(false); });

    // Restore the badge after a re-render that happened while hovering
    if (hoverConn === connKey(conn)) setHover(true);
  });

  // Draw ghost connection preview while dragging
  if (drag && ghostTarget !== null) {
    var dn = drag.node;
    var gt = findNode(ghostTarget);
    if (gt) {
      var ex = shapeExit(dn), en = shapeEntry(gt);
      var ex2 = shapeExit(gt), en2 = shapeEntry(dn);
      var distFwd = Math.pow(en.x-ex.x,2)+Math.pow(en.y-ex.y,2);
      var distRev = Math.pow(en2.x-ex2.x,2)+Math.pow(en2.y-ex2.y,2);
      var dnCanBeFrom = (dn.type==='source'&&(gt.type==='filter'||gt.type==='output'))||(dn.type==='filter'&&(gt.type==='filter'||gt.type==='output'));
      var gtCanBeFrom = (gt.type==='source'&&(dn.type==='filter'||dn.type==='output'))||(gt.type==='filter'&&(dn.type==='filter'||dn.type==='output'));
      var p0g, tipg;
      if (dnCanBeFrom && (!gtCanBeFrom || distFwd <= distRev)) { p0g = ex; tipg = en; }
      else { p0g = ex2; tipg = en2; }
      drawArrow(svg, p0g, tipg, '#aaaaaa', '0.55', true);
    }
  }
}

/* QUERY ENGINE */
var OP_FNS = { gt:function(a,b){return a>b;}, gte:function(a,b){return a>=b;}, lt:function(a,b){return a<b;}, lte:function(a,b){return a<=b;}, eq:function(a,b){return a==b;} };
var OP_SYM = { gt:'>',gte:'>=',lt:'<',lte:'<=',eq:'=' };

// Topological sort of connected nodes
function topoSort() {
  // Build adjacency
  var inDeg = {}, adj = {};
  nodes.forEach(function(n){ inDeg[n.id]=0; adj[n.id]=[]; });
  connections.forEach(function(c){ adj[c.from].push(c.to); inDeg[c.to]=(inDeg[c.to]||0)+1; });
  var queue = nodes.filter(function(n){ return inDeg[n.id]===0; }).map(function(n){return n.id;});
  var order = [];
  while (queue.length) {
    var id = queue.shift(); order.push(id);
    (adj[id]||[]).forEach(function(nid){ if(--inDeg[nid]===0) queue.push(nid); });
  }
  return order.map(function(id){ return findNode(id); }).filter(Boolean);
}

/* GRAPH EVALUATION
   Every node computes its own dataset from its own inputs, so parallel
   branches stay independent. A node fed by several inputs merges them
   (union, deduplicated by student id).
   Previously every filter in the graph was applied to one shared dataset,
   so sibling branches contradicted each other and both collapsed to zero. */

function inputsOf(nodeId) {
  return connections
    .filter(function(c){ return c.to === nodeId; })
    .map(function(c){ return c.from; });
}

function unionOf(lists) {
  var seen = {}, out = [];
  lists.forEach(function(list) {
    list.forEach(function(s) {
      if (!seen[s.id]) { seen[s.id] = true; out.push(s); }
    });
  });
  return out;
}

function sourceData(node, log) {
  var pop = node._pop || 'all';
  if (pop === '2022' || pop === '2023') {
    var yr = parseInt(pop, 10);
    log.push('<span class="kw">SOURCE</span>  year <span class="op">=</span> <span class="val">'+yr+'</span>');
    return STUDENTS.filter(function(s){ return s.year === yr; });
  }
  log.push('<span class="kw">SOURCE</span>  all_students');
  return STUDENTS.slice();
}

// Applies one filter node's criteria. Returns {data:[...]} or {error:'msg'}.
function applyFilter(node, data, log) {
  for (var ci = 0; ci < node.criteria.length; ci++) {
    var c = node.criteria[ci];
    var ft = c.ft || 'gradeAvg';

    if (ft === 'gradeAvg') {
      var num = parseFloat(c.val);
      if (isNaN(num)) return { error: 'Grade value must be a number.' };
      var fn = OP_FNS[c.op] || OP_FNS.gt;
      data = data.filter(function(s){ return fn(s.gradeAvg, num); });
      log.push('<span class="kw">FILTER</span>  gradeAvg <span class="op">'+(OP_SYM[c.op]||'>')+'</span> <span class="val">'+num+'</span>');

    } else if (ft === 'year') {
      var yr = parseInt(c.year, 10);
      data = data.filter(function(s){ return s.year === yr; });
      log.push('<span class="kw">FILTER</span>  year <span class="op">=</span> <span class="val">'+yr+'</span>');

    } else if (ft === 'specialisation') {
      var sp = c.spec;
      data = data.filter(function(s){ return s.specialisation === sp; });
      log.push('<span class="kw">FILTER</span>  spec <span class="op">=</span> <span class="val">"'+sp+'"</span>');

    } else if (ft === 'gender') {
      var gnd = c.gender;
      data = data.filter(function(s){ return s.gender === gnd; });
      log.push('<span class="kw">FILTER</span>  gender <span class="op">=</span> <span class="val">"'+gnd+'"</span>');
    }
  }
  return { data: data };
}

// Walks the DAG in topological order. Returns {res:{nodeId:{data,log,hasSource}}}
// or {error:'msg'}.
function evaluateGraph() {
  var order = topoSort();
  if (order.length < nodes.length) {
    return { error: 'Circular connection detected — remove an arrow that loops back on itself.' };
  }

  var res = {};
  for (var i = 0; i < order.length; i++) {
    var node = order[i];
    var log = [], data, hasSource;

    if (node.type === 'source') {
      data = sourceData(node, log);
      hasSource = true;
    } else {
      var ins = inputsOf(node.id)
        .map(function(id){ return res[id]; })
        .filter(Boolean);

      ins.forEach(function(r){ log.push.apply(log, r.log); });
      if (ins.length > 1) log.push('<span class="kw">MERGE</span>  '+ins.length+' inputs');

      data = unionOf(ins.map(function(r){ return r.data; }));
      hasSource = ins.some(function(r){ return r.hasSource; });

      if (node.type === 'filter') {
        var out = applyFilter(node, data, log);
        if (out.error) return { error: out.error };
        data = out.data;
      }
    }
    res[node.id] = { data: data, log: log, hasSource: hasSource };
  }
  return { res: res };
}

function outputCardHTML(ot, data) {
  if (ot === 'count') {
    return '<div class="result-card">'+
      '<div class="result-head">Count</div>'+
      '<div class="result-big"><span class="big-num">'+data.length+'</span></div>'+
    '</div>';
  }
  if (ot === 'average') {
    var avg = data.length===0 ? 0 : (data.reduce(function(s,r){return s+r.gradeAvg;},0)/data.length);
    return '<div class="result-card">'+
      '<div class="result-head">Average</div>'+
      '<div class="result-big"><span class="big-num">'+avg.toFixed(1)+'</span><span class="big-sub">/ 100 &nbsp;('+data.length+' records)</span></div>'+
    '</div>';
  }
  var shown = data.slice(0,50);
  var rows = shown.map(function(s){
    return '<tr><td>'+s.id+'</td><td>'+s.gender+'</td><td>'+s.year+'</td><td>'+s.gradeAvg+'</td><td>'+s.letterGrade+'</td><td>'+s.specialisation+'</td></tr>';
  }).join('');
  var more = data.length>50?'<tr><td colspan="6" style="color:#282828;padding:5px 9px;font-size:10px">... '+(data.length-50)+' more</td></tr>':'';
  return '<div class="result-card">'+
    '<div class="result-head">List <span style="color:#444;font-size:9px">('+data.length+')</span></div>'+
    '<div style="overflow-x:auto"><table class="rtable">'+
    '<thead><tr><th>ID</th><th>Gen</th><th>Year</th><th>Avg</th><th>Grade</th><th>Specialisation</th></tr></thead>'+
    '<tbody>'+rows+more+'</tbody></table></div>'+
  '</div>';
}

function outputValue(ot, data) {
  if (ot === 'average') {
    var avg = data.length===0 ? 0 : (data.reduce(function(s,r){return s+r.gradeAvg;},0)/data.length);
    return avg.toFixed(1);
  }
  return data.length;
}

function runQuery() {
  saveState();
  var srcNodes = nodes.filter(function(n){return n.type==='source';});
  var outNodes = nodes.filter(function(n){return n.type==='output';});

  if (srcNodes.length===0) { showError('Add a Source node.'); return; }
  if (outNodes.length===0) { showError('Add an Output node.'); return; }
  if (connections.length===0) {
    showError('Drag nodes close together to connect them, then drop to confirm the connection.');
    return;
  }

  var ev = evaluateGraph();
  if (ev.error) { showError(ev.error); return; }
  var res = ev.res;

  lastResults = {};
  var html = '';

  outNodes.forEach(function(onode, oi) {
    var r = res[onode.id] || { data: [], log: [], hasSource: false };
    var body;

    if (!r.hasSource) {
      body = '<div class="error-box">Not connected to a Source — this Output has no data path.</div>';
    } else {
      var ot = onode._outputType || 'count';
      lastResults[onode.id] = outputValue(ot, r.data);
      var log = r.log.concat('<span class="kw">OUTPUT</span>  <span class="val">'+ot+'</span>');
      body = '<div class="query-log">'+log.join('\n')+'</div>' + outputCardHTML(ot, r.data);
    }

    html += '<div class="result-block">'+
      (outNodes.length>1 ? '<div class="result-block-label">Output '+(oi+1)+'</div>' : '')+
      body+
    '</div>';
  });

  setOutput(html);
  render();
}

function showError(msg) {
  setOutput('<div class="error-box">'+msg+'</div>');
}
function setOutput(html) {
  document.getElementById('panelBody').innerHTML = html;
}

/* GLOBALS */
window.addNode = addNode;
window.removeNode = removeNode;
window.addCriterion = addCriterion;
window.removeCriterion = removeCriterion;
window.clearAll = clearAll;
window.runQuery = runQuery;

render();
})();
