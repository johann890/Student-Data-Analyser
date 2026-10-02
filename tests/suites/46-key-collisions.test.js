/* VALUES THAT COLLIDE WITH A PROPERTY EVERY OBJECT ALREADY HAS

   Six places in the application deduplicate by writing into an object literal
   and reading the truthiness back:

       var seen = {};
       if (seen[value]) return;        // already had this one
       seen[value] = true;

   `{}` inherits from Object.prototype, so `seen['constructor']` reads back a
   function and is truthy before anything has been stored at all. A value of
   "constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf" or
   "__proto__" was therefore discarded as a repeat of something that had never
   been seen. Measured on a column of eight distinct values, two came out.

   Nothing wrong ever appeared. No error, no warning, no log line: the row was
   dropped exactly the way a genuine duplicate is dropped, and the result looked
   like a result. That is what makes this worth a suite rather than a comment.

   It did not show on the student archive, where the keys are IDs, grades and
   course codes. It became reachable when Source was generalised to read any
   table, because a tag, category or band column holds ordinary English and
   these are ordinary English words. Two of the six sites already had the guard
   (combine.js prefixes its join keys, and rowKey() in core.js prefixes with
   'i', 'e' or 'r'), which is the clearest evidence that the other four were an
   oversight rather than a decision.

   The fix is a one-character prefix on the key, so the lookup can no longer
   name an inherited property. Each test here fails if that prefix is removed
   from the site it names.

   POISON is the full set rather than one example on purpose. The sites differ in
   whether they coerce with String(), concatenate, or pass the value straight
   through, and `__proto__` in particular behaves differently from the others:
   assigning to it on a plain object sets the prototype instead of a key, so a
   site that merely switched to hasOwnProperty would still mishandle it.       */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

const POISON = ['constructor', 'toString', '__proto__', 'valueOf',
                'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable'];

// Two ordinary values alongside, so a test cannot pass by dropping everything.
const ORDINARY = ['SWEN', 'CYBR'];
const ALL = ORDINARY.concat(POISON);

/* A one-column table of arbitrary text, loaded through the shipped parser. The
   qualified header name is what tells the loader this file is a plain table
   rather than an archive export. */
async function textColumnSource(h, values, col) {
  const name = col || 'tag';
  const src = h.add('source');
  h.w.render();
  const hd = await h.loadHeaders(src.id, h.file('headers-tags.csv.txt', name + '\n1\n'));
  if (hd.err) throw new Error('arranging the header failed: ' + hd.err);
  const y = await h.loadYears(src.id, [h.file('tags.csv', values.join('\n') + '\n')]);
  if (y.err) throw new Error('arranging the table failed: ' + y.err);
  return src;
}

module.exports = ({ describe, test }) => {

  describe('Unique keeps values that share a name with Object.prototype', () => {

    test('a column of distinct values comes back whole', async () => {
      const h = boot();
      const src = await textColumnSource(h, ALL);
      const u = h.add('unique');
      h.app.connect(src.id, u.id);
      const key = h.app.evaluateGraph().res[src.id].table.columns[0].key;
      h.app.setCfg(u.id, 'col', key);
      h.w.render();

      const ev = h.app.evaluateGraph();
      assert.notOk(ev.error, 'the graph should evaluate: ' + ev.error);
      const got = ev.res[u.id].table.rows.map(function (r) { return String(r[0]); });

      const lost = ALL.filter(function (v) { return got.indexOf(v) === -1; });
      assert.deepEqual(lost, [],
        'Unique dropped ' + JSON.stringify(lost) + ' from a column in which every ' +
        'value appears once. Unprefixed, seen["constructor"] is truthy before ' +
        'anything is stored.');
      assert.equal(got.length, ALL.length);
    });

    test('a genuine repeat is still removed', async () => {
      // The other half, and the reason this is not just "return every row".
      // Remove the dedupe entirely and the test above passes; this one fails.
      const h = boot();
      const src = await textColumnSource(h, ALL.concat(POISON));
      const u = h.add('unique');
      h.app.connect(src.id, u.id);
      const key = h.app.evaluateGraph().res[src.id].table.columns[0].key;
      h.app.setCfg(u.id, 'col', key);
      h.w.render();

      const got = h.app.evaluateGraph().res[u.id].table.rows;
      assert.equal(got.length, ALL.length,
        'each poisoned value was supplied twice and should appear once');
    });

    test('whole-row Unique keeps them too', async () => {
      // The same code path with no column chosen, where the key is the joined
      // row rather than one cell.
      const h = boot();
      const src = await textColumnSource(h, ALL);
      const u = h.add('unique');
      h.app.connect(src.id, u.id);
      h.w.render();

      const got = h.app.evaluateGraph().res[u.id].table.rows.length;
      assert.equal(got, ALL.length, 'whole-row Unique over distinct rows');
    });
  });

  describe('SelectFor groups by every label it was given', () => {

    test('labels read from the data include the poisoned ones', async () => {
      const h = boot();
      const src = await textColumnSource(h, ALL);
      const sf = h.add('selectFor');
      h.app.connect(src.id, sf.id);
      const key = h.app.evaluateGraph().res[src.id].table.columns[0].key;
      h.app.setCfg(sf.id, 'groupBy', key);
      h.w.render();

      const ev = h.app.evaluateGraph();
      assert.notOk(ev.error, 'the graph should evaluate: ' + ev.error);

      /* One row per group, so the row count is the number of labels the node
         found. Nine values in, nine groups out. */
      assert.equal(ev.res[sf.id].table.rows.length, ALL.length,
         'SelectFor found ' + ev.res[sf.id].table.rows.length + ' groups in ' +
         ALL.length + ' distinct values');
    });

    test('labels arriving on the Labels port include them as well', async () => {
      // A separate site in selectfor.js from the one above, and the port is how
      // a zero-count group is declared, so a dropped label is a group the user
      // asked for and did not get.
      const h = boot();
      const data = await textColumnSource(h, ALL);
      const dataKey = h.app.evaluateGraph().res[data.id].table.columns[0].key;

      const labels = h.add('source');
      h.w.render();
      const hd = await h.loadHeaders(labels.id, h.file('headers-labels.csv.txt', 'tag\n1\n'));
      if (hd.err) throw new Error(hd.err);
      const ly = await h.loadYears(labels.id, [h.file('labels.csv', ALL.join('\n') + '\n')]);
      if (ly.err) throw new Error(ly.err);

      const sf = h.add('selectFor');
      h.app.connect(data.id, sf.id, null, 'data');
      h.app.connect(labels.id, sf.id, null, 'labels');
      h.app.setCfg(sf.id, 'groupBy', dataKey);
      h.w.render();

      const ev = h.app.evaluateGraph();
      assert.notOk(ev.error, 'the graph should evaluate: ' + ev.error);
      assert.equal(ev.res[sf.id].table.rows.length, ALL.length,
        'every label on the port should produce a group, including the poisoned ones');
    });
  });

  describe('a multi-value filter keeps the words the user typed', () => {

    test('"constructor" in a value list is one of the values', () => {
      /* critList() in nodes/model.js, reached by typing a comma-separated list
         into a filter. Nothing to do with files: the user types it, and a word
         being a property of Object.prototype is not something they can be
         expected to know or avoid.

         Called directly because the whole function is the deduplication, so
         there is no intermediate state to assert through the node. The first
         version of this test asked for `splitList`, which does not exist: the
         lookup was undefined, the test returned early and reported a pass. It
         is spelled out here because a test that cannot fail is worse than no
         test, and this suite is the wrong place to have one. */
      const h = boot();
      const field = 'tag';
      const c = { values: {} };
      c.values[h.app.listKey(field)] = ALL.join(',');

      const parsed = h.app.critList(c, field, null);
      const lost = ALL.filter(function (v) { return parsed.indexOf(v) === -1; });
      assert.deepEqual(lost, [],
        'the value list dropped ' + JSON.stringify(lost) + ' of ' +
        JSON.stringify(ALL));
      assert.equal(parsed.length, ALL.length);
    });

    test('a repeated value in the list is still collapsed', () => {
      // So that the test above cannot be satisfied by removing the dedupe.
      const h = boot();
      const field = 'tag';
      const c = { values: {} };
      c.values[h.app.listKey(field)] = ALL.concat(POISON).join(',');

      assert.equal(h.app.critList(c, field, null).length, ALL.length);
    });
  });

  describe('a column may be named after a property of Object.prototype', () => {

    test('a header column called "constructor" keeps its own name', async () => {
      /* uniqueColumnKeys() in data/sources.js renames a repeated column by
         appending _2. Unprefixed, a column honestly named "constructor" looked
         like a repeat of one that did not exist, so it was renamed on sight and
         then disagreed with its own label in every dropdown built from it. */
      const h = boot();
      const src = h.add('source');
      h.w.render();
      const hd = await h.loadHeaders(src.id,
        h.file('headers-odd.csv.txt', 'constructor toString\n1 2\n'));
      if (hd.err) throw new Error('arranging the header failed: ' + hd.err);
      const y = await h.loadYears(src.id, [h.file('odd.csv', 'a\tb\nc\td\n')]);
      if (y.err) throw new Error('arranging the table failed: ' + y.err);

      const cols = h.app.evaluateGraph().res[src.id].table.columns;
      const keys = cols.map(function (c) { return c.key; });
      assert.deepEqual(keys, ['constructor', 'toString'],
        'the columns kept their declared names; got ' + JSON.stringify(keys));
    });

    test('two columns really sharing a name are still separated', async () => {
      // The behaviour the rename exists for, which the prefix must not remove.
      const h = boot();
      const src = h.add('source');
      h.w.render();
      const hd = await h.loadHeaders(src.id,
        h.file('headers-dup.csv.txt', 'tag tag\n1 2\n'));
      if (hd.err) throw new Error('arranging the header failed: ' + hd.err);
      const y = await h.loadYears(src.id, [h.file('dup.csv', 'a\tb\n')]);
      if (y.err) throw new Error('arranging the table failed: ' + y.err);

      const keys = h.app.evaluateGraph().res[src.id].table.columns
        .map(function (c) { return c.key; });
      assert.equal(keys.length, 2);
      assert.ok(keys[0] !== keys[1],
        'two columns named the same thing must still get distinct keys, got ' +
        JSON.stringify(keys));
    });
  });

  describe('an imported library entry may carry such an id', () => {

    test('an entry whose id is "constructor" survives a read', () => {
      /* libRead() in queries/library-store.js. An id arriving in an imported
         file only has to match [A-Za-z0-9_-]{1,64}, which "constructor" does,
         so an entry carrying one was dropped as a duplicate of an entry no file
         contained. Ids the tool mints itself start with 'q' and were never
         affected, which is why this needs a hand-made store to reach. */
      const h = boot();
      const graph = { kind: h.app.FILE_KIND, version: h.app.FILE_VERSION,
                      nodes: [], connections: [] };
      const entries = POISON.map(function (id) {
        return { id: id, name: 'query ' + id, savedAt: '', graph: graph };
      });
      // kind and version included because libRead refuses a store without them
      // before it looks at a single entry, and a refusal would make this test
      // pass for the wrong reason.
      h.storage.setItem(h.app.LIB_STORE, JSON.stringify({
        kind: h.app.LIB_KIND, version: h.app.LIB_VERSION, entries: entries
      }));

      const read = h.app.libRead();
      assert.notOk(read.error,
        'the store should be readable; got ' + JSON.stringify(read.error));
      const got = (read.entries || []).map(function (e) { return e.id; });
      const lost = POISON.filter(function (id) { return got.indexOf(id) === -1; });
      assert.deepEqual(lost, [],
        'the library dropped entries with ids ' + JSON.stringify(lost));
    });
  });
};
