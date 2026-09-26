/* Test harness.
   Boots the application inside jsdom and exposes its internals to the tests.

   The application is a set of classic scripts sharing one global scope, with no
   module system. Deliberate, since it must run from a file:// URL with no
   build step, where module scripts are refused outright. They are loaded here
   in the same order the page loads them, and the last of them answers the
   access question itself: setting
   `window.__QB_TEST__ = true` BEFORE it loads makes it publish its internals on
   `window.__qb`. In normal use the flag is undefined and nothing is exported.

   This harness used to reach in by rewriting the source text instead, injecting
   an export block before the closing `})();`. The source warns against exactly that
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
/* Load order is the page's load order, and it is load-bearing: the last script
   ends with event wiring and the first paint, both of which need everything
   above it parsed. The page is asked for that order rather than a copy of it
   being kept here: the application is now thirty scripts rather than three, and
   a list in two places is a list that goes out of date in one of them. A script
   added to the page joins the suite by being added to the page, which is the
   only place it has to be right anyway. */
function scriptSrcs(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const re = /<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

/* The scripts a folder's page asks for, as absolute paths, or null if this is
   not a folder holding the application: no page, a page that loads nothing, or
   one naming a file that is not there. Used both to choose the folder and to
   load it, so the test cannot be "found" by a folder it then fails to boot. */
function appScriptsIn(dir) {
  let html;
  try { html = findHtml(dir); } catch (e) { return null; }
  if (!html) return null;
  const srcs = scriptSrcs(html);
  if (!srcs.length) return null;
  const paths = srcs.map(s => path.join(dir, s));
  return paths.every(p => fs.existsSync(p)) ? paths : null;
}

function findAppDir() {
  if (process.env.APP_DIR) return path.resolve(process.env.APP_DIR);
  const candidates = ['../MLP', '../mlp', '../MMP', '../mmp', '../MVP', '../mvp', '..', '.'];
  for (const c of candidates) {
    const dir = path.resolve(__dirname, '..', c);
    if (appScriptsIn(dir)) return dir;
  }
  throw new Error(
    'Could not find the application. Looked for an .html file loading scripts ' +
    'that exist beside it, in: ' + candidates.join(', ') +
    '. Set APP_DIR to point at the right folder.');
}

/* index.html when there is one, so a folder that also keeps an older page (an
   export, a copy taken for the report) still boots the one that ships. */
function findHtml(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.html')).sort();
  if (files.indexOf('index.html') !== -1) return path.join(dir, 'index.html');
  return files.length ? path.join(dir, files[0]) : null;
}

const APP_DIR = findAppDir();
const APP_HTML = findHtml(APP_DIR);
const APP_PATHS = appScriptsIn(APP_DIR);

/* The stylesheet, for the suites that hold a rule and the code that depends on
   it together. It is several files now, read in the order the page links them,
   which is the order the cascade resolves them in. Concatenated rather than
   handed over one by one: a test asking "is this selector styled" is asking of
   the stylesheet as a whole, and which file a rule sits in is exactly the kind
   of detail a test should not be pinned to. */
function styleHrefs(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const re = /<link\b[^>]*>/g;
  const out = [];
  let tag;
  while ((tag = re.exec(html)) !== null) {
    if (!/rel\s*=\s*"stylesheet"/.test(tag[0])) continue;
    const href = /\bhref\s*=\s*"([^"]+)"/.exec(tag[0]);
    if (href) out.push(href[1]);
  }
  return out;
}

function appStyles() {
  const hrefs = styleHrefs(APP_HTML);
  if (!hrefs.length) throw new Error('No stylesheet linked from ' + APP_HTML);
  return hrefs.map(h => fs.readFileSync(path.join(APP_DIR, h), 'utf8')).join('\n');
}

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

/* A Storage implementation over a Map, with the two behaviours that matter to
   the code under test and that a naive object literal does not have.

   A real Storage stores strings. `setItem(k, {})` records "[object Object]",
   so a caller that forgets to stringify reads back something that is not JSON,
   and the application's defensive parse is what has to notice. Coercing here
   rather than storing the object keeps that bug reachable by a test.

   A real Storage also has a ceiling, and hitting it throws rather than
   returning false. Browsers give roughly 5MB per origin, which is a real limit
   for a library of saved queries rather than a theoretical one — so `quota` is
   settable and the throw is shaped like the browser's, name and code included.
   Left at Infinity, nothing changes.

     const h = boot();
     h.storage.quota = 400;     // bytes, counted as the browser counts them

   The size accounting matches the spec's: two bytes per UTF-16 code unit,
   summed over keys and values. Approximate against any real browser's
   bookkeeping, exact enough to put a test on the far side of a limit. */
function memoryStorage() {
  const map = new Map();
  const api = {
    quota: Infinity,
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    getItem(k) { return map.has(String(k)) ? map.get(String(k)) : null; },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
    setItem(k, v) {
      k = String(k); v = String(v);
      let used = 0;
      for (const [ek, ev] of map) if (ek !== k) used += (ek.length + ev.length) * 2;
      if (used + (k.length + v.length) * 2 > api.quota) {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        err.code = 22;
        throw err;
      }
      map.set(k, v);
    },
    // Not part of Storage. For assertions about what is actually on disk,
    // as opposed to what the application believes it wrote.
    raw() { return new Map(map); }
  };
  return api;
}

/* A fresh application instance per test file. State is module-global inside the
   IIFE, so sharing an instance between files would let one test's leftover
   nodes change another's result. */
/* EVERY WINDOW THIS HARNESS HAS BUILT, SO THE RUNNER CAN PUT THEM DOWN
   ---------------------------------------------------------------------------
   `pretendToBeVisual` gives each JSDOM a live requestAnimationFrame loop, and a
   live timer is a GC root: nothing a boot() produced was ever collected, so the
   whole run held every window it had ever made. With a suite this size that
   reached the heap limit and the run died with "Ineffective mark-compacts"
   rather than a failure, which is the worst way for a test run to end.

   Closing a window stops its timers and lets it go. It has to be the RUNNER
   that does it, between suites, because a suite may boot at module scope and
   use that window in every test it has. */
const LIVE_WINDOWS = [];

function disposeWindows() {
  while (LIVE_WINDOWS.length) {
    const w = LIVE_WINDOWS.pop();
    try { w.close(); } catch (e) { /* already gone; nothing to do */ }
  }
}

function boot() {
  const dom = new JSDOM(fs.readFileSync(APP_HTML, 'utf8'), {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  LIVE_WINDOWS.push(dom.window);
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

  /* Storage: supplied, because jsdom does not supply it here.

     jsdom only exposes localStorage for an origin it can key one to, and this
     harness boots the page from a string with no `url`, so the document sits at
     about:blank and `window.localStorage` is undefined. Giving the boot a
     `file://` url does not help — that origin is opaque and jsdom leaves it
     undefined too. Only an http(s) url produces a real one, and changing the
     origin of all twenty-six suites to serve one of them is the wrong trade.

     This matters more than it looks. The application already reads and writes
     localStorage for the panel width and the toolbar height, and every access
     is wrapped in a try/catch because it legitimately throws in some file://
     and private-window configurations. With no storage object at all, those
     catches swallow a TypeError and the code appears to work. Anything else
     written the same way would be tested by a suite that cannot fail: the
     assertions would pass because nothing was ever stored OR read.

     So the shim is here for the same reason the download and clipboard shims
     are — it stands in for a browser facility jsdom lacks, at the same seam a
     browser would provide it, and everything inward of it is the shipped code.

     Fresh per boot, like the rest of the instance: one test file's saved
     queries must not be visible to the next. */
  const storage = memoryStorage();
  Object.defineProperty(w, 'localStorage', {
    value: storage, writable: true, configurable: true
  });

  // The flag must be set before the app runs: the export block is guarded by it.
  w.__QB_TEST__ = true;
  APP_PATHS.forEach(p => w.eval(fs.readFileSync(p, 'utf8')));

  const qb = w.__qb;
  if (!qb) {
    throw new Error(
      'window.__QB_TEST__ was set but window.__qb is missing. The last script the ' +
      'page loads (shell/boot.js) should end with a block guarded by that flag which ' +
      'publishes its internals. If that block was removed, restore it rather than ' +
      'going back to source injection.');
  }
  const app = shim(qb);

  // render() lives in the application's global scope but is not published on window —
  // only the toolbar entry points are. Tests legitimately need to force a
  // redraw, so alias it here rather than exporting it from production code.
  w.render = app.render;

  return { w, doc, app, saved, copied, storage,
           ...helpers(w, doc, app), ...fileHelpers(w, doc, app) };
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

/* The other half of the storage shim: take it away again.

   Every access the application makes to localStorage is wrapped in a try/catch
   because a private window, or a file:// origin with site data blocked, does
   not merely return null — the property access itself throws. That guard is a
   real behaviour with a real user behind it, so it needs a test, and a test of
   it needs a window with no storage.

   Before the harness supplied storage that was the default state and the test
   asserted it. Now it has to be asked for, which is the better arrangement
   anyway: "this suite is about having nowhere to save" is a statement the test
   makes, rather than a property of jsdom it happened to inherit.

   Deleting the property is closer to the browser than substituting a throwing
   stub, because what the guards actually survive is `window.localStorage`
   being unusable, and both readings arrive there. */
function withoutStorage(h) {
  delete h.w.localStorage;
  return h;
}

module.exports = { boot, withoutStorage, disposeWindows, appStyles, APP_DIR, APP_PATHS, APP_HTML, DATA_DIR, dataDirFile, hasDataDir };
