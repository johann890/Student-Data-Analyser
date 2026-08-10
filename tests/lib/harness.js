/* Test harness.
   Boots the application inside jsdom and exposes its internals to the tests.

   The application is a single IIFE with no module system, which is deliberate —
   it must run from a file:// URL with no build step. That means nothing inside
   it is reachable from outside by default. Rather than change the production
   code to suit the tests, the harness injects one line before the closing
   `})();` that publishes the internals onto `window.__app`. The shipped file is
   never modified: the injection happens on the in-memory copy only. If the
   injection point ever moves, the harness throws instead of silently testing a
   different thing. */

const fs = require('fs');
const path = require('path');

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  console.error('\n  jsdom is not installed. Run `npm install` inside the tests folder.\n');
  process.exit(1);
}

/* Locate the application. Defaults to a sibling MMP folder, which is the layout
   this suite was written against, but any folder can be passed explicitly:
       APP_DIR=../some/other/path node run.js                                  */
function findAppDir() {
  if (process.env.APP_DIR) return path.resolve(process.env.APP_DIR);
  const candidates = ['../MMP', '../mmp', '../MVP', '../mvp', '..', '.'];
  for (const c of candidates) {
    const dir = path.resolve(__dirname, '..', c);
    if (fs.existsSync(path.join(dir, 'app.js')) && findHtml(dir)) return dir;
  }
  throw new Error(
    'Could not find the application. Looked for app.js plus an .html file in: ' +
    candidates.join(', ') + '. Set APP_DIR to point at the right folder.');
}

function findHtml(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
  return files.length ? path.join(dir, files[0]) : null;
}

const APP_DIR = findAppDir();
const APP_JS = path.join(APP_DIR, 'app.js');
const APP_HTML = findHtml(APP_DIR);

/* Everything the tests need to reach. `nodes` and `connections` are reassigned
   by clearAll() and removeNode(), so they are exposed as getters rather than
   captured by value. */
const HOOK = `
window.__app = {
  get nodes(){ return nodes; },
  get connections(){ return connections; },
  get exportData(){ return exportData; },
  get resultsFresh(){ return resultsFresh; },
  findNode: findNode, inputsOf: inputsOf, topoSort: topoSort,
  evaluateGraph: evaluateGraph, computeSchemas: computeSchemas, inputSchema: inputSchema,
  makeTable: makeTable, colIndex: colIndex, colByKey: colByKey, hasCol: hasCol,
  cellAt: cellAt, coursesColIndex: coursesColIndex, numericCols: numericCols,
  studentsTable: studentsTable, enrolmentsTable: enrolmentsTable,
  toEnrolments: toEnrolments, breakdownTable: breakdownTable,
  explodesHere: explodesHere, canExplode: canExplode,
  fmtCell: fmtCell, exportCell: exportCell, cellTitle: cellTitle,
  unionTables: unionTables, schemaKey: schemaKey, rowKey: rowKey,
  filterFields: filterFields, fieldByKey: fieldByKey, applyFilter: applyFilter,
  outputTable: outputTable, normaliseShow: normaliseShow,
  defaultAvgCol: defaultAvgCol, meanOf: meanOf,
  serialiseTable: serialiseTable, exportTableFor: exportTableFor, safeName: safeName,
  serialiseGraph: serialiseGraph, deserialiseGraph: deserialiseGraph,
  applyGraph: applyGraph, loadGraphFromText: loadGraphFromText,
  setCfg: setCfg, defaultCfg: defaultCfg, newCriterion: newCriterion,
  render: render, markStale: markStale,
  STUDENTS: STUDENTS, COURSES: COURSES, SUBJECTS: SUBJECTS, SPECS: SPECS, YEARS: YEARS,
  COURSE_BY_CODE: COURSE_BY_CODE, CORE_COURSES: CORE_COURSES,
  SPEC_SUBJECTS: SPEC_SUBJECTS, SUBJECT_WEIGHTS: SUBJECT_WEIGHTS, subjectWeight: subjectWeight,
  COURSES_PER_YEAR: COURSES_PER_YEAR, DEFAULT_COURSE: DEFAULT_COURSE,
  STUDENT_COLUMNS: STUDENT_COLUMNS, ENROLMENT_COLUMNS: ENROLMENT_COLUMNS,
  COLTYPE: COLTYPE, MEASURES: MEASURES, CONNECT_RULES: CONNECT_RULES,
  connect: function(from, to, color) {
    connections.push({ from: from, to: to, color: color || '#ffffff' });
  }
};`;

function instrument(src) {
  const marker = /\n\s*render\(\);\s*\n\s*\}\)\(\);\s*$/;
  if (!marker.test(src)) {
    throw new Error(
      'Harness could not find the injection point in app.js. It expects the file ' +
      'to end with `render();` followed by `})();`. If that changed, update ' +
      'lib/harness.js — do not skip the check, or the tests will silently run ' +
      'against something other than the shipped file.');
  }
  return src.replace(marker, '\n' + HOOK + '\nrender();\n})();\n');
}

/* A fresh application instance per test file. State is module-global inside the
   IIFE, so sharing an instance between files would let one test's leftover
   nodes change another's result. */
function boot() {
  const dom = new JSDOM(fs.readFileSync(APP_HTML, 'utf8'), {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  const doc = w.document;

  // Downloads: capture instead of performing, so save paths are assertable
  const saved = [];
  w.URL.createObjectURL = () => 'blob:test';
  w.URL.revokeObjectURL = () => {};
  let pendingContent = null;
  w.Blob = class { constructor(parts) { pendingContent = parts.join(''); } };
  const realCreate = doc.createElement.bind(doc);
  doc.createElement = function (tag) {
    const el = realCreate(tag);
    if (tag === 'a') {
      el.click = function () { saved.push({ name: el.download, content: pendingContent }); };
    }
    return el;
  };

  // Clipboard: capture writes rather than requiring a secure context
  const copied = [];
  w.navigator.clipboard = { writeText: (t) => { copied.push(t); return Promise.resolve(); } };

  w.eval(instrument(fs.readFileSync(APP_JS, 'utf8')));

  const app = w.__app;
  if (!app) throw new Error('Harness injection ran but window.__app is missing.');

  // render() is internal to the IIFE — only the toolbar entry points are on
  // window. Tests legitimately need to force a redraw, so alias it here rather
  // than exporting it from production code.
  w.render = app.render;

  return { w, doc, app, saved, copied, ...helpers(w, doc, app) };
}

/* Helpers that drive the UI the way a user would — set a control's value and
   dispatch the event the app listens for — rather than calling setCfg directly.
   Tests that bypass the DOM would not catch a control that renders with the
   wrong data-key, which is exactly the class of bug worth catching. */
function helpers(w, doc, app) {
  function control(nodeId, key) {
    return doc.querySelector('[data-node="' + nodeId + '"][data-key="' + key + '"]');
  }

  function set(nodeId, key, value) {
    const el = control(nodeId, key);
    if (!el) {
      const available = [...doc.querySelectorAll('[data-node="' + nodeId + '"]')]
        .map(e => e.getAttribute('data-key')).join(', ');
      throw new Error('No control ' + key + ' on node ' + nodeId + '. Available: ' + (available || 'none'));
    }
    if (el.type === 'checkbox') el.checked = value; else el.value = value;
    const evt = (el.tagName === 'INPUT' && el.type !== 'checkbox') ? 'input' : 'change';
    el.dispatchEvent(new w.Event(evt, { bubbles: true }));
    return el;
  }

  // Build a wired graph in one call: build('source','filter','output') connects
  // them in sequence and returns the node objects.
  function build(...types) {
    const made = types.map(t => { w.addNode(t); return app.nodes[app.nodes.length - 1]; });
    for (let i = 0; i < made.length - 1; i++) app.connect(made[i].id, made[i + 1].id);
    w.render();
    return made;
  }

  /* The export file name lives in the results panel, not on the node, so it is
     only present after a run. Driven through its own delegated listener the
     same way `set` drives the node panel. */
  function exportNameField(nodeId) {
    return doc.querySelector('[data-export-name="' + nodeId + '"]');
  }

  function setExportName(nodeId, value) {
    const el = exportNameField(nodeId);
    if (!el) throw new Error('No export-name field for node ' + nodeId +
      ' — has runQuery() been called, and does this Output have a data path?');
    el.value = value;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    return el;
  }

  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => [...doc.querySelectorAll(sel)];
  const text = (sel) => { const e = q(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
  const panel = () => doc.getElementById('panelBody').textContent.replace(/\s+/g, ' ').trim();
  const bigNum = () => text('.big-num');
  const optionsOf = (nodeId, key) =>
    qa('[data-node="' + nodeId + '"][data-key="' + key + '"] option').map(o => o.value);
  const entry = (nodeId) => app.exportData[nodeId];

  return { control, set, build, exportNameField, setExportName,
           q, qa, text, panel, bigNum, optionsOf, entry };
}

module.exports = { boot, APP_DIR, APP_JS, APP_HTML };
