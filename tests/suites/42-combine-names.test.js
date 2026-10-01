/* NAMING A COMBINE'S INPUTS.

   Join has always had to say where a column came from, and the only name it
   had was the node's own: "Count · Select For #5". Three branches joined to
   compare three years therefore produced a header in which the one fact the
   columns would not tell you was the year, and the number in the name is an
   id that changes if the query is rebuilt.

   An input can now be named, in the shape Compare already names a branch: a
   map on the node keyed by the INPUT'S node id, written through the same
   `label:<id>` control. Two things follow from naming one, and both are the
   reason to:

     - its columns always carry the name, clash or no clash, because telling
       the inputs apart is what the user asked for;
     - when it brings exactly ONE column, the name IS that column's heading,
       so three branches named 2022, 2023 and 2024 give a table headed with
       the years rather than with three spellings of "Count".

   The hardest thing to keep true here is that an UNNAMED input behaves exactly
   as it did before, since every query written until now has only unnamed ones.
   That is asserted first, and against a header written out in full rather than
   derived, so a change to the rule cannot quietly agree with itself.

   The other invariant worth the space: the shared key column belongs to no one
   input, so no input's name may ever land on it. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const A = boot().app;
  const NUM = A.COLTYPE.NUMBER, TXT = A.COLTYPE.TEXT;

  const col = (key, label, type, extra) =>
    Object.assign({ key, label, type: type || TXT }, extra || {});
  const head = (...cols) => A.makeTable(cols, []);

  /* A Combine as a plain object. joinColumns is pure over headers, so the
     interesting headers can be written out here rather than built upstream by
     a graph that happens to produce them. */
  const cmb = (labels, cfg) => ({
    id: 99, type: 'combine',
    cfg: Object.assign({ mode: 'join', dedupe: false, base: '', key: '',
                         labels: labels || {} }, cfg || {})
  });

  // heads/ids/labels travel as three parallel lists, already permuted so the
  // base is first. Built together here so a test cannot get them out of step.
  function join(node, inputs) {
    return A.joinColumns(node,
      inputs.map(i => i.head),
      inputs.map(i => A.combineInputLabel(node, i.id)),
      inputs.map(i => i.id));
  }
  const labelsOf = cols => cols.map(c => c.label);
  const keysOf   = cols => cols.map(c => c.key);

  /* The arrangement nearly every test wants: two branches off one Source, each
     a Select For grouped by Degree, joined. One column each beyond the key, so
     it is the case where a name can stand as a heading. */
  function wired(names, opts) {
    const h = boot();
    const s = h.add('source');
    const ids = [];
    const n = (opts && opts.branches) || 2;
    for (let i = 0; i < n; i++) {
      const f = h.add('filter'), sf = h.add('selectFor');
      h.app.connect(s.id, f.id);
      h.app.connect(f.id, sf.id, null, 'data');
      h.w.render();
      h.set(sf.id, 'by', 'specialisation');
      h.w.render();
      if (opts && opts.twoMeasures) {
        h.app.addStat(sf.id);
        h.w.render();
        h.set(sf.id, 'stat.1.op', 'average');
        h.w.render();
        h.set(sf.id, 'stat.1.col', 'gpa');
        h.w.render();
      }
      ids.push(sf.id);
    }
    const c = h.add('combine'), o = h.add('output');
    ids.forEach(id => h.app.connect(id, c.id, null, 'in'));
    h.app.connect(c.id, o.id);
    h.w.render();
    h.set(c.id, 'mode', 'join');
    h.w.render();
    (names || []).forEach((name, i) => {
      if (name != null) h.set(c.id, 'label:' + ids[i], name);
    });
    h.w.render();
    return Object.assign(h, { s, ids, c, o });
  }
  const headerOf = h => h.app.evaluateGraph().res[h.c.id].table.columns;

  describe('registration', () => {
    test('the config carries the key, in Compare’s shape', () => {
      assert.deepEqual(A.defaultCfg('combine'),
        { mode: 'merge', dedupe: false, base: '', key: '', labels: {} });
    });

    test('it is the same key and the same control name Compare uses', () => {
      // Deliberate: a user who has named a Compare branch should not have to
      // learn a second control. setCfg routes `label:<id>` for both.
      const h = boot();
      const c = h.add('combine');
      h.app.setCfg(c.id, 'label:7', 'hello');
      assert.deepEqual(c.cfg.labels, { 7: 'hello' });
      const cp = h.add('compare');
      h.app.setCfg(cp.id, 'label:7', 'hello');
      assert.deepEqual(cp.cfg.labels, { 7: 'hello' });
    });
  });

  describe('reading a name off the node', () => {
    test('a name is trimmed', () => {
      assert.equal(A.combineLabelOf(cmb({ 2: '  spaced  ' }), 2), 'spaced');
    });

    test('a name is capped, wherever it came from', () => {
      // Capped on the way out rather than only by the control's maxlength,
      // because the same value can arrive from a saved file.
      const long = 'x'.repeat(A.COMBINE_LABEL_MAX + 40);
      assert.equal(A.combineLabelOf(cmb({ 2: long }), 2).length, A.COMBINE_LABEL_MAX);
    });

    test('whitespace alone is not a name', () => {
      assert.equal(A.combineLabelOf(cmb({ 2: '   ' }), 2), '');
    });

    test('absent, empty and null are not names', () => {
      assert.equal(A.combineLabelOf(cmb({}), 2), '');
      assert.equal(A.combineLabelOf(cmb({ 2: '' }), 2), '');
      assert.equal(A.combineLabelOf(cmb({ 2: null }), 2), '');
    });

    test('a labels map that is not a map is no names at all', () => {
      [[], 'x', 7, null].forEach(v => {
        const node = { id: 99, type: 'combine', cfg: { mode: 'join', labels: v } };
        assert.equal(A.combineLabelOf(node, 2), '', JSON.stringify(v));
      });
      assert.equal(A.combineLabelOf({ id: 99, type: 'combine' }, 2), '', 'no cfg');
      assert.equal(A.combineLabelOf(null, 2), '', 'no node');
    });

    test('a value that is not a string is coerced, never thrown on', () => {
      // A hand-edited file can put anything here. It may misdescribe itself in
      // a column heading; it may not stop the query running.
      [[{ a: 1 }, '[object Object]'], [[1, 2], '1,2'], [42, '42'], [true, 'true']]
        .forEach(([v, want]) => assert.equal(A.combineLabelOf(cmb({ 2: v }), 2), want));
    });

    /* Through h.app, not A: combineInputLabel resolves the id against the node
       list of the instance it belongs to, and A is a different boot with an
       empty canvas. Asking A about h's nodes gets the "Input 1" fallback and a
       test that passes for the wrong reason. */
    test('with no name, the node’s own name is used', () => {
      const h = boot();
      const [s, c] = h.build('source', 'combine');
      assert.equal(h.app.combineInputLabel(cmb({}), s.id), h.app.upstreamLabel(s));
    });

    test('with a name, the name is used', () => {
      const h = boot();
      const [s, c] = h.build('source', 'combine');
      assert.equal(h.app.combineInputLabel(cmb({ [s.id]: '2022' }), s.id), '2022');
    });

    test('an id that is not a node still gets something readable', () => {
      assert.equal(A.combineInputLabel(cmb({}), 4242), 'Input 4242');
    });
  });

  describe('an input nobody named behaves exactly as it always did', () => {

    /* Written out rather than derived. The point of this block is that the old
       behaviour is unchanged, and a test that computed the expectation from the
       same rule as the code would agree with any rule at all. */
    test('a clashing column is renamed, and says which node it came from', () => {
      const h = boot();
      const [s1, s2] = [h.add('filter'), h.add('filter')];
      const node = cmb({});
      const t = head(col('g', 'Group'), col('n', 'Count', NUM));
      const cols = h.app.joinColumns(node, [t, t],
        [h.app.combineInputLabel(node, s1.id), h.app.combineInputLabel(node, s2.id)],
        [s1.id, s2.id]);
      assert.deepEqual(keysOf(cols), ['g', 'n', 'n_2']);
      assert.deepEqual(labelsOf(cols),
        ['Group', 'Count', 'Count · ' + h.app.upstreamLabel(s2)]);
    });

    test('a column that does not clash keeps its own label', () => {
      const node = cmb({});
      const a = head(col('g', 'Group'), col('n', 'Count', NUM));
      const b = head(col('g', 'Group'), col('avg', 'Average', NUM));
      const cols = A.joinColumns(node, [a, b], ['one', 'two'], [1, 2]);
      assert.deepEqual(keysOf(cols), ['g', 'n', 'avg']);
      assert.deepEqual(labelsOf(cols), ['Group', 'Count', 'Average']);
    });

    test('the base’s columns are never suffixed', () => {
      const node = cmb({});
      const t = head(col('g', 'Group'), col('n', 'Count', NUM));
      assert.equal(A.joinColumns(node, [t, t], ['one', 'two'], [1, 2])[1].label, 'Count');
    });

    test('through a real graph, end to end', () => {
      const h = wired(null);
      assert.deepEqual(labelsOf(headerOf(h)),
        ['Specialisation', 'Count', 'Count · ' + h.app.upstreamLabel(
          h.app.nodes.find(n => n.id === h.ids[1]))]);
    });
  });

  describe('a named input', () => {
    test('bringing one column is headed by the name alone', () => {
      const h = wired(['2022', '2023']);
      assert.deepEqual(labelsOf(headerOf(h)), ['Specialisation', '2022', '2023']);
    });

    test('and the keys stay distinct underneath', () => {
      const h = wired(['2022', '2023']);
      assert.deepEqual(keysOf(headerOf(h)), ['group', 'count', 'count_2']);
    });

    test('bringing several has the name added to each', () => {
      const h = wired(['2022', '2023'], { twoMeasures: true });
      assert.deepEqual(labelsOf(headerOf(h)),
        ['Specialisation',
         'Count · 2022', 'Average GPA · 2022',
         'Count · 2023', 'Average GPA · 2023']);
    });

    test('the base is named too, so it is not the odd one out', () => {
      // The asymmetry this change exists to remove: before it, the base's
      // column was the only one that could not say which input it was.
      const h = wired(['2022', '2023']);
      assert.equal(labelsOf(headerOf(h))[1], '2022');
    });

    test('naming one input leaves the others on their automatic names', () => {
      const h = wired([null, '2023']);
      assert.deepEqual(labelsOf(headerOf(h)), ['Specialisation', 'Count', '2023']);
    });

    test('the shared key column is never renamed', () => {
      const h = wired(['2022', '2023']);
      assert.equal(labelsOf(headerOf(h))[0], 'Specialisation');
      assert.equal(keysOf(headerOf(h))[0], 'group');
    });

    test('three inputs, which is the shape the use case asked for', () => {
      const h = wired(['2022', '2023', '2024'], { branches: 3 });
      assert.deepEqual(labelsOf(headerOf(h)),
        ['Specialisation', '2022', '2023', '2024']);
    });
  });

  describe('names cannot make two columns look the same', () => {
    test('two inputs named the same thing are still told apart', () => {
      const h = wired(['same', 'same']);
      assert.deepEqual(labelsOf(headerOf(h)), ['Specialisation', 'same', 'same 2']);
    });

    test('a name that collides with a column already in the header', () => {
      const h = wired(['Specialisation', 'other']);
      const ls = labelsOf(headerOf(h));
      assert.deepEqual(ls, ['Specialisation', 'Specialisation 2', 'other']);
      assert.equal(new Set(ls).size, ls.length);
    });

    test('keys stay unique whatever the names are', () => {
      const h = wired(['same', 'same', 'same'], { branches: 3 });
      const ks = keysOf(headerOf(h));
      assert.equal(new Set(ks).size, ks.length, ks.join(','));
    });

    test('so the exported file has no two columns under one heading', () => {
      const h = wired(['same', 'same']);
      h.w.runQuery();
      const line = A.serialiseTable(h.entry(h.o.id).table, ',', true).split('\n')[0];
      const names = line.split(',');
      assert.equal(new Set(names).size, names.length, line);
    });

    test('a name with a comma is quoted in the file, not left to split it', () => {
      const h = wired(['2022, Tri 1', 'x']);
      h.w.runQuery();
      const line = A.serialiseTable(h.entry(h.o.id).table, ',', true).split('\n')[0];
      assert.includes(line, '"2022, Tri 1"');
    });
  });

  describe('the header it declares is the header it produces', () => {
    [['unnamed', null],
     ['named', ['2022', '2023']],
     ['half named', [null, '2023']],
     ['clashing names', ['same', 'same']],
     ['two measures each', ['2022', '2023']]].forEach(([what, names]) => {
      test(what, () => {
        const h = wired(names, { twoMeasures: what === 'two measures each' });
        const declared = h.app.computeSchemas()[h.c.id].columns.map(c => c.key + ':' + c.label);
        const produced = headerOf(h).map(c => c.key + ':' + c.label);
        assert.deepEqual(produced, declared);
      });
    });
  });

  describe('what naming must not disturb', () => {
    test('the upstream header is not renamed along with the join', () => {
      /* The base's columns used to come through by reference. Relabelling one
         in place would have renamed it on the branch above, where nothing was
         named at all. */
      const shared = col('n', 'Count', NUM);
      const t = head(col('g', 'Group'), shared);
      A.joinColumns(cmb({ 1: '2022', 2: '2023' }), [t, t], ['2022', '2023'], [1, 2]);
      assert.equal(shared.label, 'Count');
      assert.deepEqual(labelsOf(t.columns), ['Group', 'Count']);
    });

    test('a column keeps everything else it was carrying', () => {
      // values, order, def and filter all drive downstream panels, so losing
      // one across a join would quietly change what a Filter offers.
      const rich = col('year', 'Year', A.COLTYPE.ENUM,
        { values: [2022, 2023], order: ['a'], def: '2022', filter: true });
      const t = head(col('g', 'Group'), rich);
      const cols = A.joinColumns(cmb({ 1: 'one', 2: 'two' }), [t, t], ['one', 'two'], [1, 2]);
      [1, 2].forEach(i => {
        assert.deepEqual(cols[i].values, [2022, 2023], 'values at ' + i);
        assert.deepEqual(cols[i].order, ['a'], 'order at ' + i);
        assert.equal(cols[i].def, '2022', 'def at ' + i);
        assert.equal(cols[i].filter, true, 'filter at ' + i);
      });
    });

    test('a name changes the heading and not one number', () => {
      const plain = wired(null);
      const named = wired(['2022', '2023']);
      plain.w.runQuery(); named.w.runQuery();
      assert.deepEqual(named.entry(named.o.id).table.rows,
                       plain.entry(plain.o.id).table.rows);
    });

    test('the row modes are untouched by a name left on the node', () => {
      // Naming only reaches the result through a column heading, and merge,
      // intersect and difference stack rows under one header.
      ['merge', 'intersect', 'difference'].forEach(mode => {
        const a = wired(null); a.set(a.c.id, 'mode', mode); a.w.render(); a.w.runQuery();
        const b = wired(['2022', '2023']); b.set(b.c.id, 'mode', mode); b.w.render(); b.w.runQuery();
        assert.deepEqual(b.entry(b.o.id).table.columns.map(c => c.label),
                         a.entry(a.o.id).table.columns.map(c => c.label), mode);
      });
    });

    test('a name follows its input when the base changes', () => {
      const h = wired(['FIRST', 'SECOND']);
      assert.deepEqual(labelsOf(headerOf(h)), ['Specialisation', 'FIRST', 'SECOND']);
      h.set(h.c.id, 'base', String(h.ids[1]));
      h.w.render();
      assert.deepEqual(labelsOf(headerOf(h)), ['Specialisation', 'SECOND', 'FIRST'],
        'the name rode the permutation, it did not stay at position 1');
    });

    test('a name is not inherited by whatever replaces a removed input', () => {
      // Keyed by node id rather than by position, so deleting the first wire
      // cannot move its name onto the second input's columns.
      const h = wired(['FIRST', 'SECOND'], { branches: 3 });
      const gone = h.app.connections.find(c => c.from === h.ids[0] && c.to === h.c.id);
      h.app.removeConnection(gone.from, gone.to, gone.port);
      h.w.render();
      const ls = labelsOf(headerOf(h));
      assert.excludes(ls, 'FIRST');
      assert.includes(ls, 'SECOND');
    });
  });

  describe('a name is text, and is rendered as text', () => {
    const NASTY = '<img src=x onerror=alert(1)>';

    test('in the results panel', () => {
      const h = wired([null, NASTY]);
      h.w.runQuery();
      assert.equal(h.doc.getElementById('panelBody').querySelectorAll('img').length, 0);
      assert.includes(h.doc.getElementById('panelBody').innerHTML, '&lt;img src=x');
    });

    test('in the edge preview', () => {
      const h = wired([null, NASTY]);
      const wire = h.app.connections.find(c => c.from === h.c.id);
      const html = A.previewTableHTML(h.app.edgeData(wire).table);
      assert.includes(html, '&lt;img');
      assert.excludes(html, '<img ');
    });

    test('in a downstream panel that offers the column', () => {
      const h = wired([null, NASTY]);
      const f = h.add('filter');
      h.app.connect(h.c.id, f.id);
      h.w.render();
      const sel = h.doc.querySelector('[data-node="' + f.id + '"][data-key="crit.0.field"]');
      assert.ok(sel, 'the Filter should offer the joined columns');
      assert.equal(sel.querySelectorAll('img').length, 0);
    });

    test('and in the box it was typed into', () => {
      const h = wired([null, NASTY]);
      const box = h.doc.querySelector(
        '[data-node="' + h.c.id + '"][data-key="label:' + h.ids[1] + '"]');
      assert.ok(box, 'the naming box should be on the panel');
      assert.equal(box.value, NASTY, 'the value is set as text, not parsed');
      assert.equal(box.querySelectorAll ? box.querySelectorAll('img').length : 0, 0);
    });
  });

  describe('the panel', () => {
    const keysOn = (h, id) =>
      h.qa('[data-node="' + id + '"]').map(e => e.getAttribute('data-key'));

    test('the boxes are offered in Join and in no other mode', () => {
      const h = wired(null);
      const naming = () => keysOn(h, h.c.id).filter(k => k.indexOf('label:') === 0);
      ['merge', 'intersect', 'difference'].forEach(m => {
        h.set(h.c.id, 'mode', m); h.w.render();
        assert.deepEqual(naming(), [], m + ' should not offer a setting that does nothing');
      });
      h.set(h.c.id, 'mode', 'join'); h.w.render();
      assert.equal(naming().length, 2, 'join names its inputs');
    });

    test('one box per input, named after the input’s id', () => {
      const h = wired(null, { branches: 3 });
      assert.deepEqual(keysOn(h, h.c.id).filter(k => k.indexOf('label:') === 0),
        h.ids.map(id => 'label:' + id));
    });

    test('nothing to name with only one input', () => {
      const h = boot();
      const [s, c, o] = h.build('source', 'combine', 'output');
      h.set(c.id, 'mode', 'join');
      h.w.render();
      assert.deepEqual(keysOn(h, c.id).filter(k => k.indexOf('label:') === 0), []);
    });

    test('the placeholder carries the automatic name, so an empty box is a choice', () => {
      const h = wired(null);
      const box = h.doc.querySelector(
        '[data-node="' + h.c.id + '"][data-key="label:' + h.ids[0] + '"]');
      const up = h.app.nodes.find(n => n.id === h.ids[0]);
      assert.includes(box.getAttribute('placeholder'), h.app.upstreamLabel(up));
      assert.includes(box.getAttribute('placeholder'), '(auto)');
    });

    test('the box stops at the cap, as the model does', () => {
      const h = wired(null);
      const box = h.doc.querySelector(
        '[data-node="' + h.c.id + '"][data-key="label:' + h.ids[0] + '"]');
      assert.equal(box.getAttribute('maxlength'), String(A.COMBINE_LABEL_MAX));
    });

    test('the Base list calls an input what the user calls it', () => {
      const h = wired(['2022', '2023']);
      const opts = h.qa('[data-node="' + h.c.id + '"][data-key="base"] option')
        .map(o => o.textContent);
      assert.deepEqual(opts, ['2022', '2023'],
        'two names for one input is one too many');
    });

    test('the panel says what a name will do', () => {
      const h = wired(null);
      const txt = h.doc.querySelector('[data-node="' + h.c.id + '"][data-key="label:' + h.ids[0] + '"]')
        .closest('.node-config').textContent.replace(/\s+/g, ' ');
      assert.includes(txt, 'Name the inputs');
      assert.includes(txt, 'one column is headed by the name alone');
    });

    test('typing a name asks for the query to be run again', () => {
      // The heading really does change, so the result on screen is out of date.
      const h = wired(null);
      h.w.runQuery();
      assert.ok(h.app.resultsFresh, 'arranged: the run is fresh');
      h.set(h.c.id, 'label:' + h.ids[0], '2022');
      assert.notOk(h.app.resultsFresh, 'a rename changes the header, so it is stale');
    });
  });

  describe('persistence', () => {
    test('a name survives a round trip, and so does the header it produces', () => {
      const h = wired(['2022', '2023']);
      const before = labelsOf(headerOf(h));
      const json = JSON.stringify(h.app.serialiseGraph());
      h.w.clearAll();
      h.app.loadGraphFromText(json, h.doc.createElement('button'));
      h.w.render();
      const back = h.app.nodes.find(n => n.type === 'combine');
      assert.deepEqual(h.app.computeSchemas()[back.id].columns.map(c => c.label), before);
    });

    test('a file whose labels are not a map loads as no names', () => {
      const h = wired(['2022', '2023']);
      const g = h.app.serialiseGraph();
      g.nodes.forEach(n => { if (n.type === 'combine') n.cfg.labels = ['2022', '2023']; });
      h.w.clearAll();
      h.app.loadGraphFromText(JSON.stringify(g), h.doc.createElement('button'));
      h.w.render();
      const back = h.app.nodes.find(n => n.type === 'combine');
      assert.deepEqual(back.cfg.labels, {}, 'an array is not a name map');
      assert.notOk(h.q('.error-box'), 'and it loads rather than failing');
    });

    test('a query saved before names existed still loads, and reads the same', () => {
      const h = wired(null);
      const before = labelsOf(headerOf(h));
      const g = h.app.serialiseGraph();
      g.nodes.forEach(n => { if (n.type === 'combine') delete n.cfg.labels; });
      h.w.clearAll();
      h.app.loadGraphFromText(JSON.stringify(g), h.doc.createElement('button'));
      h.w.render();
      const back = h.app.nodes.find(n => n.type === 'combine');
      assert.deepEqual(back.cfg.labels, {}, 'the default fills the gap');
      assert.deepEqual(h.app.computeSchemas()[back.id].columns.map(c => c.label), before);
    });
  });
};
