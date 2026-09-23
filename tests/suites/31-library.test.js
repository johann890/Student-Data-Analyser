/* THE QUERY LIBRARY: the store.

   Saving a query into the browser rather than into a file. The format is the
   file format unchanged — an entry's `graph` is what serialiseGraph() writes —
   so the claims worth making here are not about queries, which 07-saveload
   already covers, but about the store around them:

     - that it survives every hostile thing browser storage can be, since it is
       the one input to this tool with no file picker in front of it;
     - that it refuses rather than overwrites, because there is no undo and the
       thing being lost is somebody's afternoon;
     - and that the guarantee 07-saveload asserts about a saved FILE — the query
       and never the records — holds for a saved ENTRY too. That one is the
       reason the format is reused rather than reinvented, and it is asserted
       here as well as there because a second store is a second way to leak.

   Storage itself comes from the harness now (see memoryStorage), because jsdom
   does not supply one at about:blank and the application's guards would
   otherwise swallow every access and let this whole suite pass by doing
   nothing. */

const { boot, withoutStorage, hasDataDir } = require('../lib/harness');
const { assert } = require('../lib/assert');

const KIND = 'student-data-analyser-query';
const LIB_KIND = 'student-data-analyser-library';
const STORE = 'sda.library.v1';

module.exports = ({ describe, test }) => {

  /* A real query on the canvas: a Source narrowed to one year, a Filter with a
     criterion typed into it, and an Output. Enough that the graph has something
     to lose and the file has something identifiable in it. */
  function built() {
    const h = boot();
    const [s, f, o] = h.build('source', 'filter', 'output');
    h.set(s.id, 'pop', String(h.app.YEARS[0]));
    h.set(f.id, 'crit.0.field', 'specialisation');
    h.set(f.id, 'crit.0.value:specialisation', 'Data Science');
    h.set(o.id, 'show', 'count');
    return { ...h, s, f, o };
  }

  const stored = (h) => JSON.parse(h.w.localStorage.getItem(STORE));

  /* ------------------------------------------------------------ round trip */

  describe('a query goes in and comes back', () => {
    test('saving writes one entry under the library key', () => {
      const h = built();
      const r = h.app.libAdd('Data Science cohort');
      assert.ok(r.ok, r.error && r.error.message);

      const d = stored(h);
      assert.equal(d.kind, LIB_KIND);
      assert.equal(d.version, 1);
      assert.equal(d.entries.length, 1);
      assert.equal(d.entries[0].name, 'Data Science cohort');
      assert.ok(d.entries[0].id, 'an entry with no id cannot be found again');
      assert.ok(d.entries[0].savedAt);
    });

    test('the stored graph is the file format, unchanged', () => {
      /* Not "a graph": the same object serialiseGraph() writes to a file. This
         is what lets deserialiseGraph() stay the only loader. */
      const h = built();
      h.app.libAdd('q');
      const g = stored(h).entries[0].graph;
      assert.equal(g.kind, KIND);
      assert.equal(typeof g.version, 'number');
      assert.deepEqual(
        Object.keys(g).sort(),
        Object.keys(h.app.serialiseGraph()).sort(),
        'the entry carries a different shape than a saved file does');
    });

    test('reading it back gives the entry', () => {
      const h = built();
      const id = h.app.libAdd('Data Science cohort').entry.id;
      const back = h.app.libGet(id);
      assert.ok(back, 'the entry could not be found again');
      assert.equal(back.name, 'Data Science cohort');
      assert.equal(back.graph.nodes.length, 3);
    });

    test('it loads through the same door a file does', () => {
      /* The point of storing the file format. An entry is handed to
         loadGraphFromText(), which is the loader a picked file goes through,
         so the version guard, the port resolution and the repair all apply to
         a library entry without being written a second time. */
      const h = built();
      const id = h.app.libAdd('Data Science cohort').entry.id;

      h.w.clearAll();
      assert.equal(h.app.nodes.length, 0, 'the canvas did not clear');

      assert.ok(h.app.loadGraphFromText(h.app.libGraphText(id)));
      assert.equal(h.app.nodes.length, 3);
      const flt = h.app.nodes.find(n => n.type === 'filter');
      assert.equal(flt.cfg.criteria[0].field, 'specialisation');
    });

    test('positions survive, so a query opens as it was left', () => {
      const h = built();
      h.s.x = 321; h.s.y = 99;
      const id = h.app.libAdd('placed').entry.id;
      const n = h.app.libGet(id).graph.nodes.find(n => n.type === 'source');
      assert.equal(n.x, 321);
      assert.equal(n.y, 99);
    });
  });

  /* ----------------------------------------------------- the invariant */

  describe('an entry carries the query and never the records', () => {
    test('no student data reaches storage', () => {
      /* The same claim 07-saveload makes about a file, made again about the
         store. Asserted twice on purpose: it is a property of serialiseGraph(),
         and the only thing keeping it true here is that the library reuses it.
         Give the library its own serialiser and this is what goes red. */
      const h = built();
      h.w.runQuery();
      h.app.libAdd('after a run');

      const raw = h.w.localStorage.getItem(STORE);
      assert.excludes(raw, 'gpa":78', 'a student record reached the library');
      assert.excludes(raw, '"rows":[[');
      assert.includes(raw, 'Data Science', 'the query itself should be there');
    });

    test('the results are not stored even though they exist', () => {
      const h = built();
      h.w.runQuery();
      assert.ok(Object.keys(h.app.exportData).length, 'nothing ran, so this proves nothing');
      const raw = h.w.localStorage.getItem(STORE);
      h.app.libAdd('q');
      assert.excludes(h.w.localStorage.getItem(STORE), 'exportData');
      assert.equal(raw, null);
    });

    test('a Source stores the names of its files and not their contents', async () => {
      /* The archive rather than the synthetic dataset, because the claim is
         about a Source that has actually been handed files. Skipped rather
         than failed where ../data is absent, like the other suites that read
         it: a checkout without student records should still run green. */
      if (!hasDataDir()) return;
      const h = built();
      await h.loadArchive(h.s.id, [2022]);
      h.app.libAdd('with data loaded');
      const raw = h.w.localStorage.getItem(STORE);

      /* The descriptor names the header file and lists the YEARS, not the year
         filenames: loadGraphFromText() rebuilds "mcs-students-<year>" when it
         tells the user what to go and find. So that is what is asserted. */
      assert.includes(raw, 'headers.txt', 'the query should still say what it was built against');
      assert.includes(raw, '"years":[2022]', 'and which year it was built against');

      /* Cross-checked against a record that is genuinely loaded, rather than
         against a pattern this test invented. A year file is ~320KB and a saved
         query is a few, so the size is the other half of the same claim. */
      const id = String(h.app.STUDENTS[0].id);
      assert.ok(id.length > 3, 'no student to check against, so this proves nothing');
      assert.excludes(raw, id, 'a student identifier reached the library');
      assert.ok(raw.length < 20000, 'the entry is too big to be a query: ' + raw.length);
    });
  });

  /* --------------------------------------------------------- hostile storage */

  describe('the store survives what browser storage can be', () => {
    test('no storage at all is reported, not thrown', () => {
      // A private window, or file:// with site data blocked: the property
      // access itself throws, which is why the guard is inside the try.
      const h = withoutStorage(built());
      const st = h.app.libRead();
      assert.deepEqual(st.entries, []);
      assert.equal(st.error.code, 'nostore');
      assert.ok(st.error.message, 'a code with no sentence is no use to the panel');

      const r = h.app.libAdd('q');
      assert.notOk(r.ok);
      assert.equal(r.error.code, 'nostore');
    });

    test('a slot holding something that is not JSON is refused, not parsed', () => {
      const h = built();
      h.w.localStorage.setItem(STORE, 'not json at all {{{');
      const st = h.app.libRead();
      assert.deepEqual(st.entries, []);
      assert.equal(st.error.code, 'unreadable');
    });

    test('a slot holding somebody else\'s JSON is refused', () => {
      const h = built();
      h.w.localStorage.setItem(STORE, JSON.stringify({ kind: 'something-else', entries: [] }));
      assert.equal(h.app.libRead().error.code, 'alien');
    });

    test('a library from a newer tool is refused rather than half-read', () => {
      const h = built();
      h.w.localStorage.setItem(STORE, JSON.stringify({
        kind: LIB_KIND, version: 99, entries: []
      }));
      assert.equal(h.app.libRead().error.code, 'newer');
    });

    test('an unreadable store is never written over by an ordinary save', () => {
      /* The guard that matters most. A library that this code cannot parse may
         still be a term's work, recoverable by hand from the browser's storage
         inspector. Writing a single new query over it destroys that silently.
         Remove the `st.error` check in libAdd and this goes red. */
      const h = built();
      h.w.localStorage.setItem(STORE, 'corrupt, but somebody\'s');
      const r = h.app.libAdd('new query');
      assert.notOk(r.ok, 'the save should have refused');
      assert.equal(r.error.code, 'unreadable');
      assert.equal(h.w.localStorage.getItem(STORE), 'corrupt, but somebody\'s',
        'the old store was overwritten');
    });

    test('but it can be replaced deliberately', () => {
      const h = built();
      h.w.localStorage.setItem(STORE, 'corrupt');
      const r = h.app.libAdd('new query', { replaceStore: true });
      assert.ok(r.ok, r.error && r.error.message);
      assert.equal(stored(h).entries.length, 1);
    });

    test('no amount of deliberateness conjures storage that is not there', () => {
      const h = withoutStorage(built());
      assert.equal(h.app.libAdd('q', { replaceStore: true }).error.code, 'nostore');
    });

    test('entries that are not entries are dropped, and the rest still load', () => {
      const h = built();
      const good = { id: 'keep', name: 'Real', savedAt: '', graph: h.app.serialiseGraph() };
      h.w.localStorage.setItem(STORE, JSON.stringify({
        kind: LIB_KIND, version: 1, entries: [
          null,
          'a string',
          { id: 'x', name: 'no graph' },
          { id: 'y', name: 'graph is not a query', graph: { kind: 'other', nodes: [] } },
          { name: 'no id', graph: h.app.serialiseGraph() },
          good,
          { id: 'keep', name: 'duplicate id', graph: h.app.serialiseGraph() }
        ]
      }));
      const st = h.app.libRead();
      assert.equal(st.error, null, 'one bad entry should not condemn the library');
      assert.equal(st.entries.length, 1);
      assert.equal(st.entries[0].name, 'Real');
    });

    test('a broken graph keeps its card instead of vanishing', () => {
      /* Dropped entries and repaired graphs are different jobs. An entry whose
         graph no longer loads is still the query somebody saved: it should be
         on screen, where it can be read and exported, and fail when OPENED —
         which is deserialiseGraph()'s answer to give, not the store's. */
      const h = built();
      h.w.localStorage.setItem(STORE, JSON.stringify({
        kind: LIB_KIND, version: 1, entries: [{
          id: 'old', name: 'From a newer tool', savedAt: '',
          graph: { kind: KIND, version: 99, nodes: [], connections: [] }
        }]
      }));
      assert.equal(h.app.libRead().entries.length, 1, 'the card disappeared');
      const g = h.app.deserialiseGraph(h.app.libGraphText('old'));
      assert.ok(g.error, 'and opening it should be what complains');
    });
  });

  /* ------------------------------------------------------------------ quota */

  describe('running out of room is said out loud', () => {
    test('a save that does not fit is reported as a failure', () => {
      /* Failing to remember the panel width is a shrug. Failing to save a query
         the user just spent twenty minutes on is not, and a swallowed write
         that still flashes "Saved" is the worst outcome available here. */
      const h = built();
      h.storage.quota = 200;                     // bytes: far under one entry
      const r = h.app.libAdd('too big to fit');
      assert.notOk(r.ok, 'the save reported success with nowhere to put it');
      assert.equal(r.error.code, 'quota');
      assert.includes(r.error.message.toLowerCase(), 'export');
      assert.equal(h.w.localStorage.getItem(STORE), null);
    });

    test('a quota failure leaves what was already saved alone', () => {
      const h = built();
      h.app.libAdd('first');
      const before = h.w.localStorage.getItem(STORE);
      h.storage.quota = before.length * 2 + 10;  // room for what is there, not more
      const r = h.app.libAdd('second');
      assert.notOk(r.ok);
      assert.equal(h.w.localStorage.getItem(STORE), before, 'the first query was lost');
    });

    test('the entry ceiling is its own refusal, with its own message', () => {
      const h = built();
      const entries = [];
      for (let i = 0; i < h.app.LIB_MAX_ENTRIES; i++) {
        entries.push({ id: 'e' + i, name: 'q' + i, savedAt: '', graph: h.app.serialiseGraph() });
      }
      h.w.localStorage.setItem(STORE, JSON.stringify({ kind: LIB_KIND, version: 1, entries }));
      const r = h.app.libAdd('one too many');
      assert.notOk(r.ok);
      assert.equal(r.error.code, 'full');
    });

    test('usage is measured off what is actually stored', () => {
      const h = built();
      assert.equal(h.app.libBytes(), 0);
      h.app.libAdd('q');
      assert.equal(h.app.libBytes(), h.w.localStorage.getItem(STORE).length * 2);
    });
  });

  /* ------------------------------------------------------------------ names */

  describe('a library name is not a file name', () => {
    test('punctuation a filename could not carry is kept', () => {
      /* safeName() exists to protect a filesystem, and there is no file here:
         the name is shown on a card. Putting it through safeName would turn
         "Semester 1: withdrawals" into "Semester-1-withdrawals" for no reason. */
      const h = built();
      const r = h.app.libAdd('Semester 1: withdrawals (2024)');
      assert.equal(r.entry.name, 'Semester 1: withdrawals (2024)');
    });

    test('runs of whitespace collapse, so two names cannot look alike and differ', () => {
      const h = built();
      assert.equal(h.app.libName('  Grade   histogram \n'), 'Grade histogram');
    });

    test('a name is capped rather than allowed to swamp the grid', () => {
      const h = built();
      const long = 'x'.repeat(500);
      assert.equal(h.app.libName(long).length, h.app.LIB_NAME_MAX);
    });

    test('an empty name falls back rather than saving something unnamed', () => {
      const h = built();
      const r = h.app.libAdd('   ');
      assert.ok(r.ok);
      assert.ok(r.entry.name, 'a card with no name cannot be found again');
    });

    test('a name is not coerced from an object into "[object Object]"', () => {
      const h = built();
      assert.equal(h.app.libName({}), '[object Object]'.slice(0, h.app.LIB_NAME_MAX));
      // Which is why libAdd's fallback is on emptiness, not on type: the
      // coercion above cannot produce an empty string, so a hostile name is
      // ugly on a card and nothing worse. It is escaped at render like the rest.
    });
  });

  /* ------------------------------------------------------- refusing to clobber */

  describe('nothing is replaced without being asked', () => {
    test('a name already in the library comes back as a conflict', () => {
      const h = built();
      h.app.libAdd('Grade histogram');
      const r = h.app.libAdd('Grade histogram');
      assert.notOk(r.ok);
      assert.equal(r.error, null, 'a clash is a question, not a failure');
      assert.ok(r.conflict, 'the caller needs the entry to ask about');
      assert.equal(r.conflict.name, 'Grade histogram');
      assert.equal(stored(h).entries.length, 1, 'a second copy was written anyway');
    });

    test('the clash is case-insensitive, because the grid is read not parsed', () => {
      const h = built();
      h.app.libAdd('Grade histogram');
      assert.ok(h.app.libAdd('grade HISTOGRAM').conflict);
    });

    test('answering the question replaces in place', () => {
      const h = built();
      const first = h.app.libAdd('Grade histogram').entry;
      h.app.libAdd('another');
      h.add('filter');                                   // change the graph
      const r = h.app.libAdd('Grade histogram', { replace: true });

      assert.ok(r.ok, r.error && r.error.message);
      const d = stored(h);
      assert.equal(d.entries.length, 2, 'replacing should not add');
      assert.equal(r.entry.id, first.id, 'the card changed identity underneath itself');
      assert.equal(d.entries[1].id, first.id, 'and it should not have jumped position');
      assert.equal(d.entries[1].graph.nodes.length, 4, 'the new graph was not written');
    });

    test('a new query goes to the front, where it will be looked for', () => {
      const h = built();
      h.app.libAdd('older');
      h.app.libAdd('newer');
      assert.deepEqual(stored(h).entries.map(e => e.name), ['newer', 'older']);
    });

    test('an empty canvas is not saved as a query', () => {
      const h = boot();
      const r = h.app.libAdd('nothing');
      assert.notOk(r.ok);
      assert.equal(r.error.code, 'empty');
      assert.equal(h.w.localStorage.getItem(STORE), null);
    });
  });

  /* ---------------------------------------------------------- rename, remove */

  describe('managing what is in there', () => {
    test('renaming changes the name and nothing else', () => {
      const h = built();
      const e = h.app.libAdd('first name').entry;
      const r = h.app.libRename(e.id, 'second name');
      assert.ok(r.ok);
      const back = h.app.libGet(e.id);
      assert.equal(back.name, 'second name');
      assert.equal(back.savedAt, e.savedAt, 'a rename is not a re-save');
      assert.deepEqual(back.graph, e.graph);
    });

    test('renaming onto a name already taken is a conflict too', () => {
      const h = built();
      h.app.libAdd('taken');
      const e = h.app.libAdd('mine').entry;
      const r = h.app.libRename(e.id, 'taken');
      assert.notOk(r.ok);
      assert.ok(r.conflict);
      assert.equal(h.app.libGet(e.id).name, 'mine');
    });

    test('renaming an entry to its own name is not a conflict with itself', () => {
      const h = built();
      const e = h.app.libAdd('Same').entry;
      assert.ok(h.app.libRename(e.id, 'same').ok);
    });

    test('removing takes out exactly one entry', () => {
      const h = built();
      const a = h.app.libAdd('a').entry;
      const b = h.app.libAdd('b').entry;
      h.app.libAdd('c');

      const r = h.app.libRemove(b.id);
      assert.ok(r.ok);
      assert.equal(r.entry.name, 'b', 'the caller needs to know what went, to offer it back');
      assert.deepEqual(stored(h).entries.map(e => e.name), ['c', 'a']);
      assert.ok(h.app.libGet(a.id), 'a neighbour went with it');
    });

    test('removing something that is already gone says so', () => {
      const h = built();
      const r = h.app.libRemove('never-existed');
      assert.notOk(r.ok);
      assert.equal(r.error.code, 'missing');
    });
  });

  /* ---------------------------------------------------------- two windows */

  describe('the store is read every time, not held', () => {
    test('a save does not write back a copy taken before someone else\'s', () => {
      /* Two windows open on the same tool share the storage. A copy kept in a
         variable goes stale the moment the other window saves, and writing it
         back deletes their query with no error and nothing to notice. Cache
         libRead()'s result in a module variable and this goes red. */
      const h = built();
      h.app.libAdd('mine');

      /* Read once first, the way opening the grid does. Without this the test
         catches only a cache that holds on every path: a cache written on the
         full-parse path but not on the empty-store path is never populated by
         a save into an empty library, and the assertions below pass with the
         bug in place. Checked by writing exactly that version. */
      assert.equal(h.app.libRead().entries.length, 1);

      // The other window saves, which this one learns about only by re-reading.
      const other = JSON.parse(h.w.localStorage.getItem(STORE));
      other.entries.unshift({
        id: 'theirs', name: 'theirs', savedAt: '', graph: h.app.serialiseGraph()
      });
      h.w.localStorage.setItem(STORE, JSON.stringify(other));

      h.app.libAdd('mine again');
      const names = stored(h).entries.map(e => e.name);
      assert.includes(names.join(','), 'theirs', 'the other window\'s query was deleted');
      assert.equal(names.length, 3);
    });
  });

  /* ------------------------------------------------------------- the picture */

  describe('the card is drawn from the graph, not captured from the screen', () => {
    test('nothing out of the entry reaches the markup', () => {
      /* The claim that makes it safe to inject with innerHTML, and a privacy
         property besides: a Filter can legitimately hold a typed value that
         names a person, and a card is the sort of thing shown on a projector.
         A card says what KIND of node each one is and nothing else. */
      const h = built();
      h.set(h.f.id, 'crit.0.value:specialisation', 'Cybersecurity');
      const svg = h.app.libThumb(h.app.serialiseGraph());

      assert.excludes(svg, 'Cybersecurity', 'a config value reached the card');
      assert.excludes(svg, 'headers.txt');
      assert.excludes(svg, '<script');
      assert.includes(svg, 'FILTER', 'the node type is what a card shows');
    });

    test('it is markup rather than an image, and small', () => {
      const h = built();
      const svg = h.app.libThumb(h.app.serialiseGraph());
      assert.includes(svg, '<svg');
      assert.excludes(svg, '<image', 'a rasterised card would taint the canvas in WebKit');
      assert.excludes(svg, 'data:', 'nothing embedded');
      assert.ok(svg.length < 6000, 'a card should cost kilobytes, not tens of them: ' + svg.length);
    });

    test('the arrows use the canvas\'s own geometry', () => {
      /* shapeExit and shapeEntry are pure, so the card calls the same ones the
         canvas does. A second copy of that arithmetic would drift, and the
         symptom would be a thumbnail that quietly stopped resembling the
         query. Checked by reading a real exit point out of the markup. */
      const h = built();
      const svg = h.app.libThumb(h.app.serialiseGraph());
      const lines = svg.match(/<line [^>]*>/g) || [];
      assert.equal(lines.length, 2, 'two wires, two lines');
      assert.equal((svg.match(/<path [^>]*>/g) || []).length, 2, 'and an arrowhead each');
    });

    test('a hostile or outdated graph produces a card, not a broken one', () => {
      const h = built();
      const bad = {
        kind: KIND, version: 3,
        nodes: [
          { id: 1, type: 'source', x: '12', y: null },      // strings and nulls
          { id: 2, type: 'nodeTypeFromTheFuture', x: 0, y: 0 },
          { id: 3, type: 'output', x: 300, y: 200 }
        ],
        connections: [{ from: 1, to: 3, port: undefined }, { from: 9, to: 3 }]
      };
      const svg = h.app.libThumb(bad);
      assert.excludes(svg, 'NaN', 'one NaN in an SVG is a blank card');
      assert.excludes(svg, 'undefined');
      assert.equal((svg.match(/<line /g) || []).length, 1,
        'the wire to a node that is not there should be dropped');
    });

    test('a graph with nothing drawable says so instead of showing a frame', () => {
      const h = built();
      const svg = h.app.libThumb({ kind: KIND, version: 3, nodes: [], connections: [] });
      assert.includes(svg, '<svg');
      assert.includes(svg.toLowerCase(), 'nothing');
    });

    test('an absurd node count is capped rather than drawn', () => {
      const h = built();
      const many = [];
      for (let i = 0; i < 5000; i++) many.push({ id: i, type: 'output', x: i * 10, y: 0 });
      const svg = h.app.libThumb({ kind: KIND, version: 3, nodes: many, connections: [] });
      assert.equal((svg.match(/<rect /g) || []).length, h.app.LIB_THUMB_MAX_NODES);
    });
  });

  /* -------------------------------------------------------------- the dialog */

  describe('the dialog', () => {
    test('opens, closes, and takes Escape out of the canvas\'s hands', () => {
      const h = built();
      assert.notOk(h.app.libraryOpen());
      h.w.openLibrary(null);
      assert.ok(h.app.libraryOpen());
      h.w.closeLibrary();
      assert.notOk(h.app.libraryOpen());
    });

    test('a name with markup in it is escaped onto the card', () => {
      const h = built();
      h.app.libAdd('<img src=x onerror=alert(1)>');
      h.w.openLibrary(null);
      const body = h.doc.getElementById('libBody');
      assert.equal(body.querySelectorAll('img').length, 0, 'a name became markup');
      assert.includes(body.textContent, '<img src=x', 'and it should still be readable');
    });

    test('an id that is not one is refused before it can become an attribute', () => {
      /* The card's buttons carry the id inline, the way the toolbar's do, so an
         id holding a quote would be markup. Constrained in libRead rather than
         escaped at each of the four call sites. */
      const h = built();
      h.w.localStorage.setItem(STORE, JSON.stringify({
        kind: LIB_KIND, version: 1, entries: [{
          id: "x' onclick='alert(1)", name: 'hostile', savedAt: '',
          graph: h.app.serialiseGraph()
        }]
      }));
      assert.equal(h.app.libRead().entries.length, 0, 'the entry should not survive its id');
    });

    test('Open asks before replacing a canvas, and not when there is nothing to lose', () => {
      const h = built();
      const id = h.app.libAdd('saved').entry.id;
      h.w.openLibrary(null);

      // Something on the canvas: the first press is the question.
      h.w.libOpenEntry(id, null);
      assert.ok(h.app.libPendingNow(), 'it opened without asking');
      assert.ok(h.app.libraryOpen(), 'and it should still be on screen to ask from');
      assert.includes(h.doc.getElementById('libBody').textContent, 'Replace canvas?');

      // The second press does it.
      h.w.libOpenEntry(id, null);
      assert.notOk(h.app.libraryOpen(), 'the dialog should get out of the way of the result');
      assert.equal(h.app.nodes.length, 3);
    });

    test('an empty canvas is opened onto without a question', () => {
      const h = built();
      const id = h.app.libAdd('saved').entry.id;
      h.w.clearAll();
      h.w.openLibrary(null);
      h.w.libOpenEntry(id, null);
      assert.equal(h.app.nodes.length, 3, 'a question with one sensible answer teaches clicking through');
    });

    test('Delete asks once, on the button, and the card says so too', () => {
      const h = built();
      const id = h.app.libAdd('doomed').entry.id;
      h.w.openLibrary(null);

      h.w.libDeleteEntry(id, null);
      assert.ok(h.app.libGet(id), 'one click deleted it');
      const body = h.doc.getElementById('libBody');
      assert.includes(body.textContent, 'Delete for good?');
      assert.ok(body.querySelector('.lib-card.danger'), 'the card should say so as well as the button');

      h.w.libDeleteEntry(id, null);
      assert.notOk(h.app.libGet(id));
    });

    test('Escape answers the button\'s question before it closes the dialog', () => {
      const h = built();
      const id = h.app.libAdd('doomed').entry.id;
      h.w.openLibrary(null);
      h.w.libDeleteEntry(id, null);
      assert.ok(h.app.libPendingNow());

      const esc = () => h.doc.dispatchEvent(new h.w.KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true
      }));

      esc();
      assert.notOk(h.app.libPendingNow(), 'the half-pressed button should be let go');
      assert.ok(h.app.libraryOpen(), 'but not by shutting the library');
      assert.ok(h.app.libGet(id), 'and certainly not by deleting it');

      esc();
      assert.notOk(h.app.libraryOpen(), 'a second Escape closes');
    });

    test('saving from the footer names the query and clears the field', () => {
      const h = built();
      h.w.openLibrary(null);
      h.doc.getElementById('libSaveName').value = 'Semester 1: withdrawals';
      h.w.libSaveCurrent(null);

      assert.equal(h.app.libRead().entries[0].name, 'Semester 1: withdrawals');
      assert.equal(h.doc.getElementById('libSaveName').value, '');
      assert.includes(h.doc.getElementById('libNotice').textContent, 'Semester 1');
    });

    test('a clash is asked about rather than refused or overwritten', () => {
      const h = built();
      h.app.libAdd('Grades');
      h.w.openLibrary(null);
      h.doc.getElementById('libSaveName').value = 'grades';

      h.w.libSaveCurrent(null);
      assert.equal(h.app.libRead().entries.length, 1, 'a second copy was written');
      assert.includes(h.doc.getElementById('libNotice').textContent.toLowerCase(), 'again');

      h.w.libSaveCurrent(null);
      assert.equal(h.app.libRead().entries.length, 1, 'the replacement added instead');
    });

    test('a store that cannot be read is a screen of its own, not an empty grid', () => {
      /* "You have no saved queries" and "your saved queries could not be
         opened" are opposite things to be told, and look identical as an
         empty grid. */
      const h = built();
      h.w.localStorage.setItem(STORE, 'corrupt');
      h.w.openLibrary(null);
      const body = h.doc.getElementById('libBody');
      assert.ok(body.querySelector('.lib-problem'), 'it rendered as though empty');
      assert.includes(body.textContent, 'Nothing has been overwritten');
      assert.ok(body.querySelector('.lib-del'), 'and should offer a deliberate way out');
    });

    test('renaming commits on blur and abandons on Escape', () => {
      const h = built();
      const id = h.app.libAdd('before').entry.id;
      h.w.openLibrary(null);

      h.w.libStartRename(id);
      h.doc.getElementById('libRenameInput').value = 'after';
      h.w.libCommitRename(id);
      assert.equal(h.app.libGet(id).name, 'after');

      h.w.libStartRename(id);
      const input = h.doc.getElementById('libRenameInput');
      input.value = 'never';
      h.w.libRenameKey({ key: 'Escape', preventDefault(){}, stopPropagation(){}, target: input }, id);
      h.w.libCommitRename(id);
      assert.equal(h.app.libGet(id).name, 'after', 'Escape committed what it should have dropped');
    });

    test('a card exports as the file Load already reads', () => {
      const h = built();
      const id = h.app.libAdd('Semester 1: withdrawals').entry.id;
      h.w.openLibrary(null);
      h.w.libExportEntry(id, null);

      const f = h.saved[h.saved.length - 1];
      assert.equal(f.name, 'Semester-1-withdrawals.json',
        'the library name is not a filename until it becomes one');
      assert.ok(h.app.loadGraphFromText(f.content), 'the file it wrote should load');
    });
  });

  /* --------------------------------------------------- the second destination */

  describe('the save dialog can send a query either way', () => {
    test('the same name, two places, and neither hidden behind the other', () => {
      const h = built();
      h.w.saveGraph(h.doc.createElement('button'));
      h.doc.getElementById('saveName').value = 'Semester 1: withdrawals';

      h.w.confirmSaveToLibrary(null);
      assert.equal(h.saved.length, 0, 'the library path should not write a file');
      assert.equal(h.app.libRead().entries[0].name, 'Semester 1: withdrawals',
        'and should keep the punctuation a filename could not');
      assert.notOk(h.app.saveDialogOpen(), 'the dialog should get out of the way');
    });

    test('a typed .json is dropped, because the chip beside the field put it there', () => {
      /* The field is shared with the file path and shows ".json" next to it. A
         user who types "grades.json" has said the query is called "grades";
         carrying the suffix onto a card reads the chip back at them. */
      const h = built();
      h.w.saveGraph(h.doc.createElement('button'));
      h.doc.getElementById('saveName').value = 'grades.json';
      h.w.confirmSaveToLibrary(null);
      assert.equal(h.app.libRead().entries[0].name, 'grades');
    });

    test('Enter still writes a file, as it always has', () => {
      /* Repointing a daily keyboard habit at a different destination would stop
         it producing files without anyone noticing. Checked through the real
         listener rather than by calling confirmSaveGraph directly. */
      const h = built();
      h.w.saveGraph(h.doc.createElement('button'));
      const field = h.doc.getElementById('saveName');
      field.value = 'by keyboard';
      field.dispatchEvent(new h.w.KeyboardEvent('keydown',
        { key: 'Enter', bubbles: true, cancelable: true }));

      assert.equal(h.saved[h.saved.length - 1].name, 'by-keyboard.json');
      assert.equal(h.app.libRead().entries.length, 0, 'Enter went to the library');
    });

    test('a clash is asked about on the button, and the question dies with the name', () => {
      const h = built();
      h.app.libAdd('Grades');
      h.w.saveGraph(h.doc.createElement('button'));
      const field = h.doc.getElementById('saveName');
      field.value = 'grades';

      h.w.confirmSaveToLibrary(null);
      assert.equal(h.app.libRead().entries.length, 1, 'a second copy was written');
      assert.ok(h.app.saveDialogOpen(), 'it should stay open to ask from');
      assert.includes(h.doc.getElementById('saveHint').textContent, 'again');
      assert.includes(h.doc.getElementById('saveHint').className, 'bad');

      // Changing the name retracts the question: it was about that name.
      field.value = 'grades other';
      field.dispatchEvent(new h.w.Event('input', { bubbles: true }));
      assert.equal(h.app.saveLibPendingNow(), '');
      assert.excludes(h.doc.getElementById('saveHint').className, 'bad',
        'the error colour outlived the error');

      field.value = 'grades';
      h.w.confirmSaveToLibrary(null);      // asks again, because the name came back
      h.w.confirmSaveToLibrary(null);      // and now replaces
      assert.equal(h.app.libRead().entries.length, 1);
    });
  });

  /* ------------------------------------------------------------ export / import */

  describe('getting a library out and back in', () => {
    const exported = (h) => {
      h.w.openLibrary(null);
      h.w.libExportAll(null);
      return h.saved[h.saved.length - 1];
    };

    test('export writes every query as one file that names itself', () => {
      const h = built();
      h.app.libAdd('one');
      h.add('filter');
      h.app.libAdd('two');

      const f = exported(h);
      assert.includes(f.name, 'query-library');
      assert.includes(f.name, '.json');
      const d = JSON.parse(f.content);
      assert.equal(d.kind, LIB_KIND);
      assert.equal(d.version, 1);
      assert.equal(d.entries.length, 2);
      assert.ok(d.exportedAt);
    });

    test('an exported library carries no student records either', () => {
      const h = built();
      h.w.runQuery();
      h.app.libAdd('after a run');
      const f = exported(h);
      assert.excludes(f.content, 'gpa":78');
      assert.excludes(f.content, '"rows":[[');
    });

    test('it round-trips into an empty library', () => {
      const h = built();
      h.app.libAdd('one');
      const f = exported(h);

      const fresh = built();
      const r = fresh.app.libImportText(f.content, 'ignored');
      assert.ok(r.ok, r.error && r.error.message);
      assert.equal(r.added, 1);
      assert.equal(fresh.app.libRead().entries[0].name, 'one');
    });

    test('import merges and never replaces', () => {
      /* One click between a colleague's standard queries and a term of your
         own work, if this were a replace. A name already here is left alone
         and counted. */
      const h = built();
      h.app.libAdd('mine');
      h.app.libAdd('shared');
      const f = exported(h);

      const other = built();
      other.app.libAdd('shared');        // same name, a different query
      other.add('filter'); other.add('sort');
      other.app.libAdd('theirs only');

      const r = other.app.libImportText(f.content, 'x');
      assert.equal(r.added, 1, 'only the one that was not already there');
      assert.equal(r.skipped, 1);

      const names = other.app.libRead().entries.map(e => e.name);
      assert.equal(names.length, 3);
      assert.includes(names.join(','), 'theirs only', 'their own work survived');
      assert.includes(names.join(','), 'mine');
      // Imported entries go on the end, so today's save is not buried.
      assert.equal(names[names.length - 1], 'mine');
    });

    test('every imported entry gets a fresh id', () => {
      /* Two jobs at once: it cannot collide with an id already here, and an id
         out of a file is never used for anything — which closes the inline-
         attribute route for the import path outright rather than by pattern. */
      const h = built();
      const mine = h.app.libAdd('one').entry;
      const f = exported(h);

      const fresh = built();
      fresh.app.libImportText(f.content, 'x');
      assert.notOk(fresh.app.libRead().entries[0].id === mine.id,
        'the imported entry kept the id it arrived with');
    });

    test('a hostile id in a file cannot reach a card', () => {
      const h = built();
      const r = h.app.libImportText(JSON.stringify({
        kind: LIB_KIND, version: 1, entries: [{
          id: "x' onclick='alert(1)", name: 'hostile', savedAt: '',
          graph: h.app.serialiseGraph()
        }]
      }), 'x');
      assert.equal(r.added, 1, 'the entry itself is fine, only its id was not');
      assert.equal(h.app.libRead().entries[0].id.indexOf("'"), -1);
    });

    test('a single saved query can be imported too', () => {
      /* The two files look identical in a folder and both end in .json.
         Refusing on a technicality would be the tool being right about
         something nobody asked. */
      const h = built();
      const query = JSON.stringify(h.app.serialiseGraph());
      const fresh = built();
      const r = fresh.app.libImportText(query, 'ds cohort');
      assert.ok(r.ok);
      assert.equal(r.added, 1);
      assert.equal(fresh.app.libRead().entries[0].name, 'ds cohort');
    });

    test('a file that is neither is refused, and nothing changes', () => {
      const h = built();
      h.app.libAdd('mine');
      const before = h.w.localStorage.getItem(STORE);

      assert.equal(h.app.libImportText('not json', 'x').error.code, 'badfile');
      assert.equal(h.app.libImportText(JSON.stringify({ kind: 'other' }), 'x').error.code, 'badfile');
      assert.equal(h.app.libImportText(JSON.stringify(
        { kind: LIB_KIND, version: 99, entries: [] }), 'x').error.code, 'newer');

      assert.equal(h.w.localStorage.getItem(STORE), before);
    });

    test('entries in a library file that are not queries are counted, not merged', () => {
      const h = built();
      const r = h.app.libImportText(JSON.stringify({
        kind: LIB_KIND, version: 1, entries: [
          { id: 'a', name: 'real', savedAt: '', graph: h.app.serialiseGraph() },
          null,
          { id: 'b', name: 'no graph' },
          { id: 'c', name: 'wrong kind', graph: { kind: 'other' } }
        ]
      }), 'x');
      assert.equal(r.added, 1);
      assert.equal(r.dropped, 3);
      assert.includes(h.app.libImportSummary(r), 'not a saved query');
    });

    test('a merge that will not fit leaves the library exactly as it was', () => {
      const h = built();
      h.app.libAdd('mine');
      const before = h.w.localStorage.getItem(STORE);

      const donor = built();
      donor.add('filter');
      donor.app.libAdd('theirs');
      const f = exported(donor);

      h.storage.quota = before.length * 2 + 10;
      const r = h.app.libImportText(f.content, 'x');
      assert.notOk(r.ok);
      assert.equal(r.error.code, 'quota');
      assert.equal(h.w.localStorage.getItem(STORE), before, 'a half-merged library');
    });

    test('an unreadable library is not merged into', () => {
      const donor = built();
      donor.app.libAdd('theirs');
      const f = exported(donor);

      const h = built();
      h.w.localStorage.setItem(STORE, 'corrupt, but somebody\'s');
      const r = h.app.libImportText(f.content, 'x');
      assert.notOk(r.ok);
      assert.equal(r.error.code, 'unreadable');
      assert.equal(h.w.localStorage.getItem(STORE), 'corrupt, but somebody\'s');
    });

    test('the picker refuses a file that was never a library', () => {
      const h = built();
      assert.includes(h.app.libFileProblem({ name: 'notes.txt', size: 10 }), 'not one');
      assert.includes(h.app.libFileProblem({ name: 'x.json', size: 0 }), 'empty');
      assert.includes(h.app.libFileProblem(
        { name: 'x.json', size: h.app.MAX_LIB_FILE_BYTES + 1 }), 'too large');
      assert.equal(h.app.libFileProblem({ name: 'x.json', size: 400 }), null);
    });

    test('exporting an empty library says so rather than writing nothing', () => {
      const h = built();
      h.w.openLibrary(null);
      const before = h.saved.length;
      h.w.libExportAll(null);
      assert.equal(h.saved.length, before, 'an empty file was written');
      assert.includes(h.doc.getElementById('libNotice').textContent, 'nothing in the library');
    });
  });
};
