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
var exportData = {};  // outputNodeId -> {index, ot, log:[plain lines], data:[...]}
var resultsFresh = false; // false once the graph changes after a run — blocks export

function uid() { return ++idCtr; }

/* NODE SHAPE DIMENSIONS  */
// Shape sizes (must match CSS). Node div is always 220px wide; shapes are centered inside it.
var NODE_W = 220;
var SHAPE = {
  source:  { w:100, h:100 },
  filter:  { w:106, h:84 },
  compare: { w:112, h:78 },
  output:  { w:106, h:66 }
};

/* CONNECTION RULES
   Single source of truth for which node types may feed which. Previously these
   pairs were spelled out inline in three places (drag hover, drop, ghost
   arrow); they drifted apart easily and every new node type meant editing all
   three. The entries for source/filter/output reproduce the original rules
   exactly. Compare accepts row streams and emits a table, so it may feed an
   Output but nothing else — a table can't be filtered or compared again. */
var CONNECT_RULES = {
  source:  ['filter', 'compare', 'output'],
  filter:  ['filter', 'compare', 'output'],
  compare: ['output'],
  output:  []
};

function canConnect(fromType, toType) {
  return (CONNECT_RULES[fromType] || []).indexOf(toType) !== -1;
}

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
  markStale();
  render();
}

function removeNode(id) {
  nodes = nodes.filter(function(n){ return n.id!==id; });
  connections = connections.filter(function(c){ return c.from!==id && c.to!==id; });
  delete lastResults[id];
  markStale();
  render();
}

function clearAll() {
  nodes = []; connections = []; lastResults = {}; edgeColorIndex = 0;
  exportData = {}; resultsFresh = false;
  cancelPreviewTimer(); hidePreview();
  render();
  setOutput('<div class="placeholder">Run a query to see results</div>');
}

/* CRITERION MANAGEMENT */
function addCriterion(nodeId) {
  var n = findNode(nodeId);
  if (!n) return;
  n.criteria.push({ft:'gradeAvg',op:'gt',val:'70',spec:'Software Engineering',gender:'M',year:'2022'});
  markStale();
  render();
}
function removeCriterion(nodeId, idx) {
  var n = findNode(nodeId);
  if (!n) return;
  n.criteria.splice(idx,1);
  markStale();
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
    // Valid pairs come from CONNECT_RULES
    var validFrom = canConnect(dn.type, n.type);
    var validTo   = canConnect(n.type, dn.type);
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
    var dnCanBeFrom = canConnect(dn.type, gt.type);
    var gtCanBeFrom = canConnect(gt.type, dn.type);
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
      markStale();
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
    if (node.type==='compare') {
      var m = gv(node.id,'metric'); if (m) node._metric = m;
      var so = gv(node.id,'sort'); if (so) node._sort = so;
      // Labels are keyed by upstream node id, so they survive re-ordering and
      // stay attached to the right branch when another one is disconnected.
      node._labels = node._labels || {};
      var lbls = node._labels;
      inputsOf(node.id).forEach(function(inId) {
        var el = document.getElementById('f_'+node.id+'_lbl_'+inId);
        if (el) lbls[inId] = el.value;
      });
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

    var shape = el.querySelector('.shape-source') || el.querySelector('.shape-filter') || el.querySelector('.shape-compare') || el.querySelector('.shape-output');
    (function(nid){
      shape.addEventListener('mousedown', function(e){ startDrag(e,nid); });
    })(node.id);

    // Criterion ft change → re-render (save first)
    var ftSels = el.querySelectorAll('.ft-sel');
    ftSels.forEach(function(sel) {
      sel.addEventListener('change', function() { render(); });
    });

    // Any config edit invalidates the displayed results
    el.querySelectorAll('.node-config select, .node-config input').forEach(function(ctrl) {
      ctrl.addEventListener('change', markStale);
      ctrl.addEventListener('input', markStale);
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
  if (node.type==='compare') {
    // Stacked bars of unequal length read as "several series side by side" at a
    // glance, which is what distinguishes this from the Filter rectangle.
    var glyph = '<span class="cmp-glyph">'+
      '<i style="width:26px"></i><i style="width:16px"></i><i style="width:21px"></i>'+
    '</span>';
    return '<div class="shape-compare">'+removeBtn+glyph+'Compare'+inlineHTML+'</div>';
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

  if (node.type==='compare') {
    var inIds = inputsOf(node.id);
    var metric = node._metric || 'count';
    var sortBy = node._sort || 'wired';
    var labels = node._labels || {};

    html += '<div class="cfg-label">Branches ('+inIds.length+')</div>';
    if (inIds.length === 0) {
      html += '<div class="cmp-hint">Drag a Source or Filter next to this node to add a branch.</div>';
    } else {
      if (inIds.length === 1) {
        html += '<div class="cmp-hint">One branch connected — add another to compare against.</div>';
      }
      html += '<div class="cmp-branches">';
      inIds.forEach(function(inId, i) {
        var up = findNode(inId);
        var swatch = up ? getNodeEdgeColor(up) : '#555';
        html += '<div class="cmp-branch">'+
          '<span class="cmp-swatch" style="background:'+swatch+'"></span>'+
          '<input type="text" class="cmp-label-input" id="f_'+id+'_lbl_'+inId+'" '+
            'value="'+esc(labels[inId] || '')+'" placeholder="Branch '+(i+1)+' (auto)">'+
        '</div>';
      });
      html += '</div>';
    }

    html += '<div class="cfg-label">Measure</div>'+
      '<select id="f_'+id+'_metric">'+
        '<option value="count"'+(metric==='count'?' selected':'')+'>Student count</option>'+
        '<option value="average"'+(metric==='average'?' selected':'')+'>Average grade</option>'+
        '<option value="share"'+(metric==='share'?' selected':'')+'>Share of total (%)</option>'+
      '</select>'+
      '<div class="cfg-label">Order</div>'+
      '<select id="f_'+id+'_sort">'+
        '<option value="wired"'+(sortBy==='wired'?' selected':'')+'>As connected</option>'+
        '<option value="desc"'+(sortBy==='desc'?' selected':'')+'>Highest first</option>'+
        '<option value="asc"'+(sortBy==='asc'?' selected':'')+'>Lowest first</option>'+
        '<option value="label"'+(sortBy==='label'?' selected':'')+'>Label A–Z</option>'+
      '</select>';
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
  markStale();
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

/* EDGE DATA PREVIEW
   After a deliberate dwell over a connection, show up to 5 rows of the dataset
   flowing along it — the output of the edge's upstream (from) node, recomputed
   live so it's always current, even mid-edit before any run. A plausibility
   aid: the "of N" total is the real signal; the rows are dataset-ordered
   texture, not a representative sample. */

var PREVIEW_DELAY = 450; // ms of stillness before the preview appears
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
}

// The dataset on the wire = the from-node's emitted output. evaluateGraph()
// computes this for every node; we just read the right one back.
// saveState() first so an unsaved config edit (e.g. a criterion value typed but
// not yet run) is reflected — only render()/runQuery persist otherwise, so
// without this the preview would show pre-edit data until the next run.
function edgeData(conn) {
  saveState();
  var ev = evaluateGraph();
  if (ev.error) return { error: ev.error };
  var r = ev.res[conn.from];
  if (!r) return { error: 'unresolved' };
  if (!r.hasSource) return { incomplete: true };
  if (r.table) return { table: r.table };
  return { data: r.data };
}

function previewTableHTML(data) {
  var rows = data.slice(0, 5).map(function(s) {
    return '<tr><td>'+s.id+'</td><td>'+s.gender+'</td><td>'+s.year+'</td><td>'+s.gradeAvg+'</td></tr>';
  }).join('');
  return '<table class="ep-table">'+
    '<thead><tr><th>ID</th><th>Gen</th><th>Yr</th><th>Avg</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table>';
}

function showPreview(conn, pathEl) {
  var res = edgeData(conn);
  var el = ensurePreviewEl();
  var body;

  if (res.error) {
    body = '<div class="ep-note">Can\'t preview — '+
      (res.error.indexOf('Circular') === 0 ? 'circular connection.' : 'graph unresolved.')+'</div>';
  } else if (res.incomplete) {
    body = '<div class="ep-note">No data on this edge yet — upstream isn\'t connected to a Source.</div>';
  } else if (res.table) {
    var t = res.table;
    var trows = t.series.slice(0, 5).map(function(s) {
      return '<tr><td>'+esc(s.label)+'</td><td>'+esc(s.text)+'</td></tr>';
    }).join('');
    body = '<div class="ep-count"><span class="ep-num">'+t.series.length+'</span> branch'+
      (t.series.length===1?'':'es')+' on this edge</div>'+
      (t.series.length === 0
        ? '<div class="ep-note">Nothing to compare yet.</div>'
        : '<table class="ep-table"><thead><tr><th>'+esc(t.cols[0])+'</th><th>'+esc(t.cols[1])+'</th></tr></thead>'+
          '<tbody>'+trows+'</tbody></table>'+
          (t.series.length > 5 ? '<div class="ep-foot">showing 5 of '+t.series.length+'</div>' : ''));
  } else {
    var n = res.data.length;
    var shown = Math.min(5, n);
    var count = '<div class="ep-count"><span class="ep-num">'+n+'</span> record'+(n===1?'':'s')+' on this edge</div>';
    if (n === 0) {
      body = count + '<div class="ep-note">Empty stream — nothing passes this point.</div>';
    } else {
      body = count + previewTableHTML(res.data) +
        '<div class="ep-foot">showing '+shown+' of '+n+', in dataset order</div>';
    }
  }
  el.innerHTML = body;

  // Anchor to the curve midpoint, offset upward so the preview floats clear
  // above the delete badge. Both reference the same point, so curvature is
  // irrelevant — they stay stacked however the arrow bows.
  var mid = pathEl._mid || { x: 0, y: 0 };
  el.style.display = 'block';

  var cw = document.getElementById('canvas').clientWidth;
  var pw = el.offsetWidth, ph = el.offsetHeight;
  var GAP = 26; // clears the ~9px badge radius plus breathing room

  var left = mid.x - pw / 2;
  left = Math.max(6, Math.min(left, cw - pw - 6)); // keep within canvas sides

  var top = mid.y - ph - GAP; // preferred: above the badge
  el.classList.remove('ep-below');
  if (top < 6) {                // not enough room above → flip below
    top = mid.y + GAP;
    el.classList.add('ep-below');
  }
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(top) + 'px';
}

function drawArrows() {
  var svg = document.getElementById('svg');
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // A rebuild invalidates the path element the pending preview was armed on
  cancelPreviewTimer();

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
    g.addEventListener('mouseleave', function() {
      setHover(false);
      cancelPreviewTimer();
      hidePreview();
    });

    // Data preview after a deliberate dwell — a quick pass to reach the delete
    // badge won't summon it. Anchored to the curve midpoint, not the cursor.
    hit.addEventListener('mousemove', function() { armPreviewTimer(conn, pathEl); });

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
      var dnCanBeFrom = canConnect(dn.type, gt.type);
      var gtCanBeFrom = canConnect(gt.type, dn.type);
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


/* QUERY LOG
   Entries are structured, not pre-baked HTML, so the same entry can render as
   markup for the panel and as plain text for export. Building HTML first and
   stripping tags later loses operators like "<" — they are indistinguishable
   from markup once concatenated. */

function logEntry(kw, parts) { return { kw: kw, parts: parts }; }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function logHTML(e) {
  return '<span class="kw">' + esc(e.kw) + '</span>  ' + e.parts.map(function(p) {
    return p.c ? '<span class="' + p.c + '">' + esc(p.s) + '</span>' : esc(p.s);
  }).join(' ');
}

function logText(e) {
  return e.kw + '  ' + e.parts.map(function(p) { return p.s; }).join(' ');
}

function sourceData(node, log) {
  var pop = node._pop || 'all';
  if (pop === '2022' || pop === '2023') {
    var yr = parseInt(pop, 10);
    log.push(logEntry('SOURCE', [{s:'year'}, {c:'op', s:'='}, {c:'val', s:yr}]));
    return STUDENTS.filter(function(s){ return s.year === yr; });
  }
  log.push(logEntry('SOURCE', [{s:'all_students'}]));
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
      log.push(logEntry('FILTER', [{s:'gradeAvg'}, {c:'op', s:(OP_SYM[c.op]||'>')}, {c:'val', s:num}]));

    } else if (ft === 'year') {
      var yr = parseInt(c.year, 10);
      data = data.filter(function(s){ return s.year === yr; });
      log.push(logEntry('FILTER', [{s:'year'}, {c:'op', s:'='}, {c:'val', s:yr}]));

    } else if (ft === 'specialisation') {
      var sp = c.spec;
      data = data.filter(function(s){ return s.specialisation === sp; });
      log.push(logEntry('FILTER', [{s:'spec'}, {c:'op', s:'='}, {c:'val', s:'"'+sp+'"'}]));

    } else if (ft === 'gender') {
      var gnd = c.gender;
      data = data.filter(function(s){ return s.gender === gnd; });
      log.push(logEntry('FILTER', [{s:'gender'}, {c:'op', s:'='}, {c:'val', s:'"'+gnd+'"'}]));
    }
  }
  return { data: data };
}

/* COMPARE
   Every other node narrows or passes through one stream. Compare is the first
   that treats its inputs as separate things: each incoming branch stays its own
   series and becomes one labelled row of a table, instead of being unioned into
   a single row set. That table is what travels on to the Output. */

function stripQuotes(s) { return String(s).replace(/^"|"$/g, ''); }

// A branch's label, derived from the query that produced it, so a user who
// hasn't typed anything still gets something readable rather than "Branch 2".
// Filters describe a branch far better than its source does, so they win.
function autoLabel(r, idx) {
  var filters = r.log.filter(function(e){ return e.kw === 'FILTER'; });
  if (filters.length) {
    return filters.map(function(e) {
      return e.parts.map(function(p){ return stripQuotes(p.s); }).join(' ');
    }).join(', ');
  }
  var src = r.log.filter(function(e){ return e.kw === 'SOURCE'; })[0];
  if (src) {
    var txt = src.parts.map(function(p){ return stripQuotes(p.s); }).join(' ');
    return txt === 'all_students' ? 'All students' : txt;
  }
  return 'Branch ' + (idx + 1);
}

function meanGrade(d) {
  if (!d.length) return 0;
  return d.reduce(function(a, s){ return a + s.gradeAvg; }, 0) / d.length;
}

var COMPARE_HEADS = { count: 'Students', average: 'Avg grade', share: 'Share' };

function buildCompareTable(node, inIds, res, log) {
  var metric = node._metric || 'count';
  var sortBy = node._sort || 'wired';
  var labels = node._labels || {};

  var series = [];
  inIds.forEach(function(inId, i) {
    var r = res[inId];
    if (!r) return;
    var manual = labels[inId];
    series.push({
      id: inId,
      label: (manual && manual.trim()) ? manual.trim() : autoLabel(r, i),
      count: r.data.length,
      avg: meanGrade(r.data)
    });
  });

  var total = series.reduce(function(a, s){ return a + s.count; }, 0);

  series.forEach(function(s) {
    if (metric === 'average') { s.value = s.avg; s.text = s.avg.toFixed(1); }
    else if (metric === 'share') {
      s.value = total ? (s.count / total) * 100 : 0;
      s.text = s.value.toFixed(1) + '%';
    }
    else { s.value = s.count; s.text = String(s.count); }
  });

  if (sortBy === 'desc') series.sort(function(a,b){ return b.value - a.value; });
  else if (sortBy === 'asc') series.sort(function(a,b){ return a.value - b.value; });
  else if (sortBy === 'label') series.sort(function(a,b){ return a.label.localeCompare(b.label); });

  log.push(logEntry('COMPARE', [
    {s: series.length + (series.length === 1 ? ' branch by' : ' branches by')},
    {c:'val', s: metric}
  ]));

  return {
    cols: ['Branch', COMPARE_HEADS[metric] || 'Value'],
    series: series,
    metric: metric,
    max: series.reduce(function(m, s){ return Math.max(m, s.value); }, 0)
  };
}

// Walks the DAG in topological order. Returns {res:{nodeId:{data,log,hasSource,table}}}
// or {error:'msg'}.
function evaluateGraph() {
  var order = topoSort();
  if (order.length < nodes.length) {
    return { error: 'Circular connection detected — remove an arrow that loops back on itself.' };
  }

  var res = {};
  for (var i = 0; i < order.length; i++) {
    var node = order[i];
    var log = [], data, hasSource, table = null;

    if (node.type === 'source') {
      data = sourceData(node, log);
      hasSource = true;
    } else {
      var inIds = inputsOf(node.id);
      var ins = inIds
        .map(function(id){ return res[id]; })
        .filter(Boolean);

      ins.forEach(function(r){ log.push.apply(log, r.log); });
      // Compare keeps its branches apart, so a merge would misdescribe it
      if (ins.length > 1 && node.type !== 'compare') {
        log.push(logEntry('MERGE', [{s:ins.length + ' inputs'}]));
      }

      data = unionOf(ins.map(function(r){ return r.data; }));
      hasSource = ins.some(function(r){ return r.hasSource; });

      if (node.type === 'filter') {
        var out = applyFilter(node, data, log);
        if (out.error) return { error: out.error };
        data = out.data;
      }

      if (node.type === 'compare') {
        table = buildCompareTable(node, inIds, res, log);
      } else {
        // A table travels downstream unchanged. Only Compare builds one, and it
        // may only feed an Output, so this just carries it the final hop.
        ins.forEach(function(r){ if (r.table) table = r.table; });
      }
    }
    res[node.id] = { data: data, log: log, hasSource: hasSource, table: table };
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

function compareCardHTML(t) {
  if (t.series.length === 0) {
    return '<div class="result-card">'+
      '<div class="result-head">Comparison</div>'+
      '<div class="cmp-empty">No branches connected to this Compare node.</div>'+
    '</div>';
  }
  var rows = t.series.map(function(s) {
    // Floor the width so a non-zero series is never an invisible sliver
    var pct = t.max > 0 ? Math.max(2, (s.value / t.max) * 100) : 0;
    return '<tr>'+
      '<td class="cmp-cell-label" title="'+esc(s.label)+'">'+esc(s.label)+'</td>'+
      '<td class="cmp-cell-bar"><span class="cmp-bar" style="width:'+pct.toFixed(1)+'%"></span></td>'+
      '<td class="cmp-cell-val">'+esc(s.text)+'</td>'+
    '</tr>';
  }).join('');
  var note = t.series.length === 1
    ? '<div class="cmp-empty">Only one branch — connect another to compare.</div>'
    : '';
  return '<div class="result-card">'+
    '<div class="result-head">Comparison <span class="result-badge">'+t.series.length+' branches</span></div>'+
    '<table class="rtable cmp-table">'+
      '<thead><tr><th>'+esc(t.cols[0])+'</th><th></th><th class="cmp-cell-val">'+esc(t.cols[1])+'</th></tr></thead>'+
      '<tbody>'+rows+'</tbody>'+
    '</table>'+
    note+
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
  exportData = {};
  var html = '';

  outNodes.forEach(function(onode, oi) {
    var r = res[onode.id] || { data: [], log: [], hasSource: false };
    var body;

    if (!r.hasSource) {
      body = '<div class="error-box">Not connected to a Source — this Output has no data path.</div>';
    } else if (r.table) {
      // A table arrives already aggregated, so the Output's count/list/average
      // selector has nothing left to decide and is bypassed.
      lastResults[onode.id] = r.table.series.length;
      var tlog = r.log.concat(logEntry('OUTPUT', [{c:'val', s:'comparison table'}]));
      exportData[onode.id] = {
        index: oi + 1,
        ot: 'comparison',
        log: tlog.map(logText),
        data: r.data,
        table: r.table
      };
      body = '<div class="query-log">'+tlog.map(logHTML).join('\n')+'</div>' + compareCardHTML(r.table);
    } else {
      var ot = onode._outputType || 'count';
      lastResults[onode.id] = outputValue(ot, r.data);
      var log = r.log.concat(logEntry('OUTPUT', [{c:'val', s:ot}]));
      exportData[onode.id] = {
        index: oi + 1,
        ot: ot,
        log: log.map(logText),
        data: r.data
      };
      body = '<div class="query-log">'+log.map(logHTML).join('\n')+'</div>' + outputCardHTML(ot, r.data);
    }

    // Export buttons only exist for blocks that actually hold a result.
    // An empty result set is still a result and stays exportable.
    var actions = r.hasSource
      ? '<div class="result-actions">'+
          '<button class="rbtn" onclick="copyOutput('+onode.id+',this)">Copy</button>'+
          '<button class="rbtn" onclick="saveOutput('+onode.id+',this)">Save</button>'+
        '</div>'
      : '';
    var showLabel = outNodes.length > 1;
    var head = (showLabel || actions)
      ? '<div class="result-block-head">'+
          (showLabel ? '<div class="result-block-label">Output '+(oi+1)+'</div>' : '<div></div>')+
          actions+
        '</div>'
      : '';

    html += '<div class="result-block">'+ head + body +'</div>';
  });

  setOutput(html);
  resultsFresh = true;
  render();
}

/* EXPORT: CLIPBOARD + FILE
   Results are only exportable while they still match the graph that produced
   them. Any structural or config change calls markStale(), which dims the
   panel and hides the buttons until the query is re-run. */

function markStale() {
  if (!resultsFresh) return;
  resultsFresh = false;
  var pb = document.getElementById('panelBody');
  if (!pb || !pb.querySelector('.result-block')) return;
  pb.classList.add('stale');
  if (!pb.querySelector('.stale-note')) {
    var note = document.createElement('div');
    note.className = 'stale-note';
    note.textContent = 'Graph changed since this run — re-run the query to export.';
    pb.insertBefore(note, pb.firstChild);
  }
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function timeStamp(fileSafe) {
  var d = new Date();
  var date = d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate());
  var time = pad2(d.getHours()) + (fileSafe ? '' : ':') + pad2(d.getMinutes());
  return date + (fileSafe ? '-' : ' ') + time;
}

var EXPORT_COLS = ['ID','Gender','Year','GradeAvg','LetterGrade','Specialisation'];
function rowOf(s) { return [s.id, s.gender, s.year, s.gradeAvg, s.letterGrade, s.specialisation]; }

function csvCell(v) {
  var s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// A comparison exports as the table on screen — label and value per branch —
// not the underlying rows, which is what makes it paste usefully into a chart.
function compareDelim(t, sep, quote) {
  var cell = quote ? csvCell : function(v){ return String(v); };
  return [t.cols.map(cell).join(sep)]
    .concat(t.series.map(function(s){ return [cell(s.label), cell(s.text)].join(sep); }))
    .join('\n');
}

// Tab-separated — pastes straight into Excel/Sheets as columns
function tsvFor(e) {
  if (e.table) return compareDelim(e.table, '\t', false);
  return [EXPORT_COLS.join('\t')]
    .concat(e.data.map(function(s){ return rowOf(s).join('\t'); }))
    .join('\n');
}

// Clean data only — no provenance rows, so imports don't need cleaning up
function csvFor(e) {
  if (e.table) return compareDelim(e.table, ',', true);
  return [EXPORT_COLS.join(',')]
    .concat(e.data.map(function(s){ return rowOf(s).map(csvCell).join(','); }))
    .join('\n');
}

function resultLine(e) {
  if (e.ot === 'average') {
    var avg = e.data.length === 0 ? 0 : (e.data.reduce(function(a,r){return a+r.gradeAvg;},0)/e.data.length);
    return 'Average: ' + avg.toFixed(1) + ' / 100  (' + e.data.length + ' records)';
  }
  if (e.ot === 'list') return 'Rows: ' + e.data.length;
  return 'Count: ' + e.data.length;
}

// Readable text carrying the query that produced the number
function scalarText(e) {
  return [
    'Student Data Analyser — Output ' + e.index,
    'Generated: ' + timeStamp(false),
    '',
    'Query:',
    e.log.map(function(l){ return '  ' + l; }).join('\n'),
    '',
    'Result:',
    '  ' + resultLine(e)
  ].join('\n');
}

// Returns {name, content, mime} for a Save action
function fileFor(e) {
  if (e.table) {
    return {
      name: 'output' + e.index + '-comparison-' + timeStamp(true) + '.csv',
      content: csvFor(e),
      mime: 'text/csv'
    };
  }
  if (e.ot === 'list') {
    return {
      name: 'output' + e.index + '-list-' + timeStamp(true) + '.csv',
      content: csvFor(e),
      mime: 'text/csv'
    };
  }
  return {
    name: 'output' + e.index + '-' + e.ot + '-' + timeStamp(true) + '.txt',
    content: scalarText(e),
    mime: 'text/plain'
  };
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

// execCommand fallback — navigator.clipboard needs a secure context, which
// isn't guaranteed when the page is opened straight off the filesystem
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
    navigator.clipboard.writeText(text).then(
      function() { done(true); },
      function() { done(legacyCopy(text)); }
    );
  } else {
    done(legacyCopy(text));
  }
}

function downloadFile(name, content, mime) {
  try {
    var blob = new Blob([content], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    return true;
  } catch (err) { return false; }
}

// Guard shared by both actions: the payload must exist and still be current
function exportEntry(id, btn) {
  var e = exportData[id];
  if (!e || !resultsFresh) { flashBtn(btn, 'Re-run first'); return null; }
  return e;
}

function copyOutput(id, btn) {
  var e = exportEntry(id, btn);
  if (!e) return;
  writeClipboard((e.table || e.ot === 'list') ? tsvFor(e) : scalarText(e), btn);
}

function saveOutput(id, btn) {
  var e = exportEntry(id, btn);
  if (!e) return;
  var f = fileFor(e);
  flashBtn(btn, downloadFile(f.name, f.content, f.mime) ? 'Saved ✓' : 'Save failed');
}

function showError(msg) {
  exportData = {};
  resultsFresh = false;
  setOutput('<div class="error-box">'+msg+'</div>');
}
function setOutput(html) {
  var pb = document.getElementById('panelBody');
  pb.classList.remove('stale');
  pb.innerHTML = html;
}

/* PROCESSING MENU
   The toolbar holds one button per pipeline stage. Processing nodes are a
   growing family, so they live behind a single dropdown rather than adding a
   button each — the toolbar stays readable as more are added. */

function procMenuEl() { return document.getElementById('procMenu'); }

function closeProcMenu() {
  var m = procMenuEl();
  if (m) m.classList.remove('open');
}

function toggleProcMenu(e) {
  // Without this the document listener below sees the same click and closes
  // the menu in the same tick it was opened.
  if (e) e.stopPropagation();
  var m = procMenuEl();
  if (m) m.classList.toggle('open');
}

function addProcNode(type) {
  closeProcMenu();
  addNode(type);
}

document.addEventListener('click', closeProcMenu);
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeProcMenu();
});

/* GLOBALS */
window.addNode = addNode;
window.toggleProcMenu = toggleProcMenu;
window.addProcNode = addProcNode;
window.removeNode = removeNode;
window.addCriterion = addCriterion;
window.removeCriterion = removeCriterion;
window.clearAll = clearAll;
window.runQuery = runQuery;
window.copyOutput = copyOutput;
window.saveOutput = saveOutput;

render();
})();
