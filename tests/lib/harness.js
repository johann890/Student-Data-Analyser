/* Test harness.
   Boots the application inside jsdom and exposes its internals to the tests.

   The application is three classic scripts sharing one global scope, with no
   module system. Deliberate, since it must run from a file:// URL with no
   build step, where module scripts are refused outright. They are loaded here
   in the same order the page loads them, and the last of them answers the
   access question itself: setting
   `window.__QB_TEST__ = true` BEFORE it loads makes it publish its internals on
   `window.__qb`. In normal use the flag is undefined and nothing is exported.

   This harness used to reach in by rewriting the source text instead, injecting
   an export block before the closing `})();`. ui.js warns against exactly that
   ("silently broken by any edit near the end of this file"), and it was: the
   injected block named functions that a later refactor deleted, so every test
   died at boot rather than failing on anything it was testing. The sanctioned
   flag cannot rot that way, if a symbol goes, the suite that uses it fails on
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

/* Locate the application. Defaults to the newest milestone folder present, and
   falls back through the older ones, so the suite follows the work rather than
   being pinned to the folder it was first written against. Any folder can be
   named explicitly:
       APP_DIR=../MMP node run.js

   The order matters and is not alphabetical. Later milestones are supersets:
   a suite written for MLP (the help-text placement rules, say) does not pass
   against MMP, because the behaviour it describes is not there yet. Testing
   the current milestone by default is the useful reading of "npm test", and an
   older folder is then a deliberate request rather than an accident.          */
/* Load order is the page's load order, and it is load-bearing: ui.js ends with
   event wiring and the first paint, both of which need the other two parsed. */
const APP_SCRIPTS = ['data.js', 'engine.js', 'ui.js'];

function findAppDir() {
  if (process.env.APP_DIR) return path.resolve(process.env.APP_DIR);
  const candidates = ['../MLP', '../mlp', '../MMP', '../mmp', '../MVP', '../mvp', '..', '.'];
  for (const c of candidates) {
    const dir = path.resolve(__dirname, '..', c);
    if (APP_SCRIPTS.every(f => fs.existsSync(path.join(dir, f))) && findHtml(dir)) return dir;
  }
  throw new Error(
    'Could not find the application. Looked for ' + APP_SCRIPTS.join(', ') +
    ' plus an .html file in: ' +
    candidates.join(', ') + '. Set APP_DIR to point at the right folder.');
}

function findHtml(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
  return files.length ? path.join(dir, files[0]) : null;
}

const APP_DIR = findAppDir();
const APP_PATHS = APP_SCRIPTS.map(f => path.join(APP_DIR, f));
const APP_HTML = findHtml(APP_DIR);

/* The real archive, beside the application rather than inside it. The data
   suites read from here, because a parser tested only against fixtures written
   by the same person who wrote the parser is a parser tested against its own
   assumptions. Fixtures still have their place (a file has to be malformed
   deliberately to test a refusal), but "does it read the actual export" is a
   question only the actual export answers. */
const DATA_DIR = path.resolve(APP_DIR, '..', 'data');

function dataDirFile(name) {
  return fs.readFileSync(path.join(DATA_DIR, name), 'utf8');
}
function hasDataDir() {
  try { return fs.existsSync(path.join(DATA_DIR, 'headers.txt')); }
  catch (e) { return false; }
}

/* __qb hands back live state through functions, because `nodes` and
   `connections` are reassigned wholesale by clearAll() and applyGraph() and a
   captured value would go stale. The suites were written against getters, so
   the two are bridged here rather than by editing several hundred assertions,
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

  /* Downloads: capture instead of performing, so save paths are assertable.

     What is captured is read off the anchor the application actually built, so
     these tests see what a browser would be handed. downloadFile() keeps the
     anchor in the document and revokes the object URL forty seconds later
     rather than immediately, because WebKit reads the blob after the click
     handler returns, so the anchor is still there to be read when click()
     fires, which is the whole point of the change. */
  const saved = [];
  w.URL.createObjectURL = () => 'blob:test';
  w.URL.revokeObjectURL = () => {};
  let pendingContent = null;
  w.Blob = class { constructor(parts) { pendingContent = parts.join(''); } };
  const hrefContent = (href) => {
    const comma = String(href || '').indexOf(',');
    if (!String(href).startsWith('data:') || comma === -1) return pendingContent;
    return decodeURIComponent(String(href).slice(comma + 1));
  };
  const realCreate = doc.createElement.bind(doc);
  doc.createElement = function (tag) {
    const el = realCreate(tag);
    if (tag === 'a') {
      el.click = function () {
        saved.push({ name: el.download, content: hrefContent(el.href), href: el.href });
      };
    }
    return el;
  };

  // Clipboard: capture writes rather than requiring a secure context
  const copied = [];
  w.navigator.clipboard = { writeText: (t) => { copied.push(t); return Promise.resolve(); } };

  // The flag must be set before the app runs: the export block is guarded by it.
  w.__QB_TEST__ = true;
  APP_PATHS.forEach(p => w.eval(fs.readFileSync(p, 'utf8')));

  const qb = w.__qb;
  if (!qb) {
    throw new Error(
      'window.__QB_TEST__ was set but window.__qb is missing. ui.js should end ' +
      'with a block guarded by that flag which publishes its internals. If that ' +
      'block was removed, restore it rather than going back to source injection.');
  }
  const app = shim(qb);

  // render() lives in ui.js's global scope but is not published on window —
  // only the toolbar entry points are. Tests legitimately need to force a
  // redraw, so alias it here rather than exporting it from production code.
  w.render = app.render;

  return { w, doc, app, saved, copied, ...helpers(w, doc, app), ...fileHelpers(w, doc, app) };
}

/* Helpers that drive the UI the way a user would (set a control's value and
   dispatch the event the app listens for), rather than calling setCfg directly.
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
     node (Combine, Compare) needs a graph that forks, and those have to be
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

/* DRIVING THE FILE PICKERS
   ---------------------------------------------------------------------------
   The two data inputs are hidden and opened by a button, so a test cannot
   "click" its way to a file. No browser lets script choose one, which is the
   whole point of the control. What a test CAN do is stand where the browser
   stands: build real File objects, put them on the input, and fire the change
   event the application listens for.

   That keeps the assertions honest about the path they exercise. Everything
   from the change listener inward is the shipped code, including the real
   FileReader, which is why these tests are async.                            */
function fileHelpers(w, doc, app) {
  // A real jsdom File. Its `name` and `size` are what the admission checks read,
  // and its contents are what the parser reads, so nothing about it is a stub.
  function file(name, text) { return new w.File([text], name); }

  // The archive's own files, as Files.
  function archiveFile(name) { return file(name, dataDirFile(name)); }

  /* Put a selection on a hidden input and fire `change`, which is exactly the
     sequence a real pick produces. `files` is read-only on an <input>, so it is
     redefined. The alternative is a DataTransfer, which jsdom does not
     implement. */
  function choose(inputId, nodeId, files) {
    const input = doc.getElementById(inputId);
    if (!input) throw new Error('No #' + inputId + ' in the page.');
    const list = [].concat(files);
    Object.defineProperty(input, 'files', {
      configurable: true,
      get: () => Object.assign(list.slice(), { item: (i) => list[i], length: list.length })
    });
    input._node = nodeId;
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    return input;
  }

  // The loader's callbacks, as promises, so a test reads as the sequence it is.
  function loadHeaders(nodeId, f) {
    return new Promise(res => app.loadHeadersFor(nodeId, f, (err, header) => res({ err, header })));
  }
  function loadYears(nodeId, files) {
    return new Promise(res =>
      app.loadYearFilesFor(nodeId, [].concat(files), (err, dataset) => res({ err, dataset })));
  }

  /* The common arrangement: a Source holding the real 2022 and 2023 archive.
     Written once because half the assertions in these suites need it and none
     of them are about the arranging. */
  async function loadArchive(nodeId, years) {
    const yrs = years || [2022, 2023];
    const h = await loadHeaders(nodeId, archiveFile('headers.txt'));
    if (h.err) throw new Error('arranging the archive header failed: ' + h.err);
    const y = await loadYears(nodeId, yrs.map(v => archiveFile('mcs-students-' + v)));
    if (y.err) throw new Error('arranging the archive years failed: ' + y.err);
    return y.dataset;
  }

  /* A real FileReader takes as long as it takes, and a test that guesses at a
     fixed delay is a test that is flaky on a slow machine and slow on a fast
     one. Poll for the condition instead, with a ceiling so a genuine failure
     reports as a failure rather than as a hang. */
  function waitFor(predicate, what) {
    const deadline = Date.now() + 2000;
    return new Promise((resolve, reject) => {
      (function tick() {
        let got;
        try { got = predicate(); } catch (e) { return reject(e); }
        if (got) return resolve(got);
        if (Date.now() > deadline) {
          return reject(new Error('timed out waiting for ' + (what || 'a condition')));
        }
        setTimeout(tick, 5);
      })();
    });
  }

  return { file, archiveFile, choose, loadHeaders, loadYears, loadArchive, waitFor };
}

module.exports = { boot, APP_DIR, APP_SCRIPTS, APP_PATHS, APP_HTML, DATA_DIR, dataDirFile, hasDataDir };
