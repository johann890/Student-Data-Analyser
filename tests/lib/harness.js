/* Test harness.
   Boots the application inside jsdom and exposes its internals to the tests.

   The application is a single IIFE with no module system — deliberate, since it
   must run from a file:// URL with no build step — so nothing inside it is
   reachable from outside by default. app.js answers that itself: setting
   `window.__QB_TEST__ = true` BEFORE it loads makes it publish its internals on
   `window.__qb`. In normal use the flag is undefined and nothing is exported.

   This harness used to reach in by rewriting the source text instead, injecting
   an export block before the closing `})();`. app.js warns against exactly that
   ("silently broken by any edit near the end of this file"), and it was: the
   injected block named functions that a later refactor deleted, so every test
   died at boot rather than failing on anything it was testing. The sanctioned
   flag cannot rot that way — if a symbol goes, the suite that uses it fails on
   its own line and says which one.

   The shipped file is never modified, in either scheme. */

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

/* __qb hands back live state through functions, because `nodes` and
   `connections` are reassigned wholesale by clearAll() and applyGraph() and a
   captured value would go stale. The suites were written against getters, so
   the two are bridged here rather than by editing several hundred assertions —
   and by keeping the bridge in one place, a later change to either side is one
   edit. Everything else passes through untouched. */
function shim(qb) {
  const app = Object.create(null);
  for (const k of Object.keys(qb)) app[k] = qb[k];
  Object.defineProperties(app, {
    nodes:        { get: () => qb.nodes() },
    connections:  { get: () => qb.connections() },
    exportData:   { get: () => qb.exportData() },
    resultsFresh: { get: () => qb.isFresh() },
    selection:    { get: () => qb.selection() },
    view:         { get: () => qb.view() }
  });
  return app;
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

  // The flag must be set before app.js runs: the export block is guarded by it.
  w.__QB_TEST__ = true;
  w.eval(fs.readFileSync(APP_JS, 'utf8'));

  const qb = w.__qb;
  if (!qb) {
    throw new Error(
      'window.__QB_TEST__ was set but window.__qb is missing. app.js should end ' +
      'with a block guarded by that flag which publishes its internals. If that ' +
      'block was removed, restore it rather than going back to source injection.');
  }
  const app = shim(qb);

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

  /* One node, unwired. build() covers a straight chain, but every multi-input
     node — Combine, Compare — needs a graph that forks, and those have to be
     wired deliberately rather than in sequence. */
  function add(type) {
    w.addNode(type);
    const ns = app.nodes;
    return ns[ns.length - 1];
  }

  // Build a wired graph in one call: build('source','filter','output') connects
  // them in sequence and returns the node objects.
  function build(...types) {
    const made = types.map(add);
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

  return { control, set, add, build, exportNameField, setExportName,
           q, qa, text, panel, bigNum, optionsOf, entry };
}

module.exports = { boot, APP_DIR, APP_JS, APP_HTML };
