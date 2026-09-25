/* Named bands on SelectFor's labels port.

   The supervisor's generalisation, in his format:

       binName    binMinValue    binMaxValue

   His argument for it over a Histogram is comparability: band widths derived
   from the data differ between one year's file and the next, so two runs cannot
   be held against each other. A file of four rows is the same four rows next
   year. That is the property being protected here, and it is why the band names
   and their order come from the table rather than from anything computed.

   The part that goes wrong is the boundary. Histogram's note says it for the
   arithmetic case: `between` includes both ends, which is right for a filter
   and fatal for a distribution, where a value on a shared edge lands in two
   bands and the bands stop summing to the rows. The half-open-then-closed rule
   is tested hardest here for that reason.

   The evaluator is driven directly for the semantics. A band table is three
   columns whose second and third are numbers, and nothing in the tool can read
   a file of that shape yet (a Source reads the archive's columns), so a graph
   cannot yet supply a realistic one. Driving evaluateSelectFor with exact
   tables tests the shipped function against the exact cases that matter rather
   than against whatever the archive happens to contain; the wiring itself is
   covered end to end further down. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const A = boot().app;
  const NUM = (key, label) => ({ key, label, type: A.COLTYPE.NUMBER });
  const TXT = (key, label) => ({ key, label, type: A.COLTYPE.TEXT });

  const bandTable = (rows) => A.makeTable(
    [TXT('name', 'Band'), NUM('lo', 'Lowest'), NUM('hi', 'Highest')], rows);

  // One numeric column called gpa, which measurableCols() certainly offers:
  // it is a NUMBER and it is not an identifier.
  const dataTable = (values) => A.makeTable(
    [TXT('id2', 'Who'), NUM('gpa', 'GPA')],
    values.map((v, i) => ['s' + i, v]));

  function run(dataT, labelT, cfg) {
    const node = { id: 1, type: 'selectFor', cfg: Object.assign(
      { by: 'gpa', stats: [{ op: 'count', col: '' }], labelCol: '', labelsAs: 'auto' }, cfg || {}) };
    const log = [];
    const ctx = {
      log,
      at: (p) => p === 'data'
        ? [{ table: dataT, hasSource: true }]
        : (labelT ? [{ table: labelT }] : [])
    };
    const out = A.evaluateSelectFor(node, ctx);
    return { out, node,
             log: log.map(e => e.kw + ' ' + e.parts.map(p => p.s).join(' ')),
             rows: out.table.rows,
             names: out.table.rows.map(r => r[0]),
             counts: out.table.rows.map(r => r[1]) };
  }

  const GRADES = () => bandTable([
    ['Fail', 0, 4], ['Pass', 4, 6], ['Merit', 6, 8], ['Excellent', 8, 9]
  ]);

  describe('which reading a labels table gets', () => {
    test('three columns whose 2nd and 3rd are numbers are bands', () => {
      assert.ok(A.labelsAreBands(GRADES()));
    });

    test('one column is a list of values', () => {
      assert.notOk(A.labelsAreBands(A.makeTable([TXT('c', 'Course')], [['COMP103']])));
    });

    test('two columns are a list of values', () => {
      assert.notOk(A.labelsAreBands(A.makeTable([TXT('a', 'A'), NUM('b', 'B')], [])));
    });

    test('three columns with a text middle are a list of values', () => {
      assert.notOk(A.labelsAreBands(
        A.makeTable([TXT('a', 'A'), TXT('b', 'B'), NUM('c', 'C')], [])));
    });

    test('more than three columns still reads as bands on the first three', () => {
      assert.ok(A.labelsAreBands(A.makeTable(
        [TXT('n', 'N'), NUM('lo', 'Lo'), NUM('hi', 'Hi'), TXT('note', 'Note')], [])));
    });

    test('an empty labels port is never bands, whatever the setting says', () => {
      assert.notOk(A.selectForUsesBands({ cfg: { labelsAs: 'bands' } }, null));
    });

    test('the setting can pin it on', () => {
      const oneCol = A.makeTable([TXT('c', 'Course')], []);
      assert.notOk(A.selectForUsesBands({ cfg: { labelsAs: 'auto' } }, oneCol));
      assert.ok(A.selectForUsesBands({ cfg: { labelsAs: 'bands' } }, oneCol));
    });

    test('and pin it off, which is the escape hatch for a lookalike table', () => {
      assert.ok(A.selectForUsesBands({ cfg: { labelsAs: 'auto' } }, GRADES()));
      assert.notOk(A.selectForUsesBands({ cfg: { labelsAs: 'values' } }, GRADES()));
    });

    test('a mode nobody declared falls back to working it out', () => {
      assert.equal(A.selectForLabelMode({ cfg: { labelsAs: 'sideways' } }), 'auto');
      assert.equal(A.selectForLabelMode({ cfg: {} }), 'auto');
    });
  });

  describe('reading the band rows', () => {
    const parse = (rows) => A.bandsFromLabels(bandTable(rows));

    test('three good rows are three bands, in the order given', () => {
      const p = parse([['C', 2, 3], ['A', 0, 1], ['B', 1, 2]]);
      assert.equal(p.malformed, 0);
      assert.equal(p.duplicates, 0);
      assert.deepEqual(p.bands.map(b => b.name), ['C', 'A', 'B']);
    });

    test('a blank name is malformed, not a duplicate', () => {
      const p = parse([['A', 0, 1], ['', 1, 2]]);
      assert.equal(p.bands.length, 1);
      assert.equal(p.malformed, 1);
      assert.equal(p.duplicates, 0);
    });

    test('an edge that is not a number is malformed', () => {
      const p = parse([['A', 0, 1], ['B', 'x', 2], ['C', 2, 'y']]);
      assert.deepEqual(p.bands.map(b => b.name), ['A']);
      assert.equal(p.malformed, 2);
    });

    test('a maximum below its minimum is a typo, not an empty band', () => {
      const p = parse([['A', 5, 1]]);
      assert.equal(p.bands.length, 0);
      assert.equal(p.malformed, 1);
    });

    test('a band of one value is allowed', () => {
      const p = parse([['Exactly seven', 7, 7]]);
      assert.equal(p.bands.length, 1);
      assert.equal(p.malformed, 0);
    });

    test('a repeated name counts as a duplicate, which has a different fix', () => {
      const p = parse([['A', 0, 1], ['A', 1, 2]]);
      assert.equal(p.bands.length, 1);
      assert.equal(p.duplicates, 1);
      assert.equal(p.malformed, 0,
        'a repeat is a table that was never bands, not a typo in one');
    });

    test('negative edges are ordinary numbers', () => {
      const p = parse([['Below', -5, 0]]);
      assert.deepEqual(p.bands.map(b => [b.lo, b.hi]), [[-5, 0]]);
    });
  });

  describe('the boundary rule, which is the part that goes wrong', () => {
    const B = A.bandsFromLabels(GRADES()).bands;
    const at = (v) => A.bandIndexOf(B, v);

    test('a value on a shared edge goes in the higher band, once', () => {
      assert.equal(at(4), 1, '4 belongs to Pass, not to Fail');
      assert.equal(at(6), 2, '6 belongs to Merit, not to Pass');
      assert.equal(at(8), 3, '8 belongs to Excellent, not to Merit');
    });

    test('the inside of each band is its own', () => {
      assert.equal(at(0), 0);
      assert.equal(at(3.9), 0);
      assert.equal(at(5), 1);
      assert.equal(at(7.5), 2);
      assert.equal(at(8.5), 3);
    });

    test('the top of the last band is included, which is what 8 to 9 means', () => {
      assert.equal(at(9), 3, 'an A+ has to land in Excellent');
    });

    test('below every band and above every band are both no band', () => {
      assert.equal(at(-0.1), -1);
      assert.equal(at(9.1), -1);
    });

    test('a gap between bands is a gap', () => {
      const g = A.bandsFromLabels(bandTable([['Low', 0, 2], ['High', 5, 7]])).bands;
      assert.equal(A.bandIndexOf(g, 3), -1);
      assert.equal(A.bandIndexOf(g, 5), 1);
    });

    test('where bands overlap the first one wins', () => {
      const o = A.bandsFromLabels(bandTable([['Wide', 0, 9], ['Narrow', 4, 5]])).bands;
      assert.equal(A.bandIndexOf(o, 4.5), 0);
    });

    test('the closed pass never steals a value the half-open pass could take', () => {
      // Exhaustive over the contiguous scheme: every value lands in exactly one
      // band under the half-open rule, so the totals cannot exceed the rows.
      for (let v = 0; v <= 8.99; v += 0.01) {
        const i = at(Number(v.toFixed(2)));
        assert.ok(i >= 0, 'value ' + v.toFixed(2) + ' fell out of a covering scheme');
      }
    });
  });

  describe('the breakdown it produces', () => {
    test('rows land in the band they belong to', () => {
      const r = run(dataTable([1, 3, 4, 5, 6, 7, 8, 9]), GRADES());
      assert.deepEqual(r.names, ['Fail', 'Pass', 'Merit', 'Excellent']);
      assert.deepEqual(r.counts, [2, 2, 2, 2]);
    });

    test('contiguous bands sum to the rows they cover', () => {
      const vals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const r = run(dataTable(vals), GRADES());
      assert.equal(r.counts.reduce((a, b) => a + b, 0), vals.length,
        'a value counted twice would push this over');
    });

    test('a band nothing falls in still gets a row, with zero', () => {
      const r = run(dataTable([8, 8.5, 9]), GRADES());
      assert.deepEqual(r.counts, [0, 0, 0, 3]);
      assert.equal(r.rows.length, 4, 'the zero rows are the reason to supply bands at all');
    });

    test('the group column is the banded column named over text cells', () => {
      const r = run(dataTable([5]), GRADES());
      const col = r.out.table.columns[0];
      assert.equal(col.key, 'group');
      assert.equal(col.label, 'GPA', 'the header names what was banded');
      assert.equal(col.type, A.COLTYPE.TEXT, 'a band name is not a GPA');
    });

    test('and declares the bands as its order, so a Sort does not go alphabetical', () => {
      const r = run(dataTable([5]), GRADES());
      const col = r.out.table.columns[0];
      assert.deepEqual(col.order, ['Fail', 'Pass', 'Merit', 'Excellent']);
      assert.deepEqual(col.values, ['Fail', 'Pass', 'Merit', 'Excellent']);
    });

    test('measures are computed per band', () => {
      const r = run(dataTable([6, 7, 8.5]), GRADES(),
        { stats: [{ op: 'average', col: 'gpa' }] });
      const avg = r.out.table.rows.map(x => x[1]);
      assert.equal(avg[2], 6.5, 'Merit holds 6 and 7');
      assert.equal(avg[3], 8.5);
    });

    test('a share divides by the rows that came in, not by the banded ones', () => {
      // Two of four rows fall outside every band, so the shares total 50%.
      const r = run(dataTable([5, 5, -1, 20]), GRADES(), { stats: [{ op: 'share', col: '' }] });
      const total = r.out.table.rows.reduce((a, x) => a + x[1], 0);
      assert.close(total, 50, 0.001, 'dividing by the banded rows would read 100%');
    });

    test('the per-band tables ride along for the Output cards', () => {
      const r = run(dataTable([1, 5]), GRADES());
      const br = r.out.table.meta.branches;
      assert.equal(br.length, 4);
      assert.deepEqual(br.map(b => b.label), ['Fail', 'Pass', 'Merit', 'Excellent']);
      assert.equal(br[0].table.rows.length, 1);
      assert.equal(r.out.table.meta.unit, 'bands');
    });
  });

  describe('what it says out loud', () => {
    test('the log names the reading, so bands are never a silent choice', () => {
      const r = run(dataTable([5]), GRADES());
      assert.includes(r.log.join('\n'), 'in named bands from the labels branch');
    });

    test('rows outside every band are counted', () => {
      const r = run(dataTable([5, 100, 200]), GRADES());
      assert.includes(r.log.join('\n'), '2 rows fall in no band');
    });

    test('rows with no value are counted separately: a blank is not a zero', () => {
      const t = A.makeTable([TXT('id2', 'Who'), NUM('gpa', 'GPA')],
        [['a', 5], ['b', ''], ['c', null]]);
      const r = run(t, GRADES());
      const l = r.log.join('\n');
      assert.includes(l, '2 rows have no GPA');
      assert.excludes(l, 'rows fall in no band', 'a blank is not an out-of-range value');
    });

    test('a malformed band row is counted, and named as malformed', () => {
      const r = run(dataTable([5]), bandTable([['Pass', 4, 6], ['', 1, 2]]));
      assert.includes(r.log.join('\n'), '1 band row needs a name, a lowest value and a highest');
    });

    test('a repeated band name is counted separately, with its own fix', () => {
      const r = run(dataTable([5]), bandTable([['Pass', 4, 6], ['Pass', 6, 8]]));
      const l = r.log.join('\n');
      assert.includes(l, '1 band row repeats a name');
      assert.excludes(l, 'needs a name',
        'a repeat must not be reported as a typo: the two are fixed differently');
    });

    test('singular and plural are both right', () => {
      const one = run(dataTable([5, 100]), GRADES());
      assert.includes(one.log.join('\n'), '1 row falls in no band');
    });

    test('a table with no number to band says so rather than reporting nothing', () => {
      const textOnly = A.makeTable([TXT('a', 'A')], [['x']]);
      const r = run(textOnly, GRADES());
      assert.includes(r.log.join('\n'), 'no number in this table to put in bands');
      assert.equal(r.rows.length, 0);
    });
  });

  describe('the two walks agree', () => {
    test('the header declared is the header emitted', () => {
      const r = run(dataTable([5]), GRADES());
      const node = r.node;
      const declared = A.selectForColumns(node, A.makeTable(
        [TXT('id2', 'Who'), NUM('gpa', 'GPA')], []), GRADES());
      assert.deepEqual(declared.map(c => c.key), r.out.table.columns.map(c => c.key));
      assert.deepEqual(declared.map(c => c.type), r.out.table.columns.map(c => c.type));
    });

    test('the group column type follows the reading, not the data', () => {
      const head = A.makeTable([TXT('id2', 'Who'), NUM('gpa', 'GPA')], []);
      const node = { id: 1, type: 'selectFor', cfg: { by: 'gpa', labelsAs: 'auto' } };
      assert.equal(A.selectForGroupColumn(node, head, GRADES()).type, A.COLTYPE.TEXT);
      assert.equal(A.selectForGroupColumn(node, head, null).type, A.COLTYPE.NUMBER,
        'grouping by a value keeps that value’s own type');
    });
  });

  describe('wired up on a real canvas', () => {
    /* Nothing in the tool reads a three-column file yet, so the band table here
       is built out of ordinary nodes: a Project gives course rows, and a Select
       narrowed to Subject, Level and Points is a name and two numbers.

       That particular trio because a Select emits columns in HEADER order and a
       band whose maximum sits below its minimum is dropped as a typo, so the
       pair has to ascend in the order the header puts them. Level and Points
       are the only numeric pair that does on the built-in dataset, where both
       are constant. Every band therefore covers the same range, which makes
       this a poor fixture for distribution semantics and a fine one for the
       only thing it is here to prove: that a real graph reaches the band path.
       The semantics are covered exhaustively by the direct calls above, where
       the tables can be stated exactly. */
    const BAND_FIXTURE = ['subject', 'level', 'points'];

    function banded() {
      const h = boot();
      const src = h.add('source'), prj = h.add('project'), sel = h.add('select');
      const sf = h.add('selectFor'), out = h.add('output');
      h.app.connect(src.id, prj.id);
      h.app.connect(prj.id, sel.id);
      h.app.connect(sel.id, sf.id, null, 'labels');
      const src2 = h.add('source');
      h.app.connect(src2.id, sf.id, null, 'data');
      h.app.connect(sf.id, out.id);
      h.w.render();
      const keep = {};
      BAND_FIXTURE.forEach(k => { keep[k] = 1; });
      h.app.computeSchemas()[prj.id].columns.forEach(c => {
        if (!keep[c.key]) h.set(sel.id, 'column:' + c.key, false);
      });
      h.w.render();
      return { ...h, src, prj, sel, sf, out };
    }

    const bandBranch = (h) => h.app.evaluateGraph().res[h.sel.id].table;

    test('the labels branch really does arrive shaped like bands', () => {
      const h = banded();
      const lt = h.app.computeSchemas()[h.sel.id];
      assert.deepEqual(lt.columns.map(c => c.key), BAND_FIXTURE);
      assert.ok(A.labelsAreBands(lt), 'the fixture stopped being a band table');
    });

    test('every row of it is a well formed band, and the skips are duplicates', () => {
      /* One row per enrolment means a subject repeats, and a repeated name is
         dropped by design: the group column declares its order from these
         names. So skips are EXPECTED, and what has to be true is that none of
         them is a malformed band. If a future header order put the larger
         number first, every band would be inside out and the count would
         collapse, which is what the second assertion catches. */
      const h = banded();
      const lt = bandBranch(h);
      const p = A.bandsFromLabels(lt);
      const distinct = new Set(lt.rows.map(r => String(r[0]))).size;

      assert.ok(p.bands.length > 1, 'need more than one band to be worth running');
      assert.equal(p.bands.length, distinct,
        'one band per distinct name, so nothing was dropped as malformed');
      assert.equal(p.malformed, 0,
        'a header order putting the larger number first would show up here');
      assert.equal(p.duplicates, lt.rows.length - distinct,
        'every skip has to be a repeated name');
      p.bands.forEach(b => assert.ok(b.lo <= b.hi, b.name + ' is inside out'));
    });

    test('and the node reads it as bands, end to end', () => {
      const h = banded();
      h.set(h.sf.id, 'by', 'gpa');
      h.w.runQuery();
      const t = h.entry(h.out.id).table;
      const distinct = new Set(bandBranch(h).rows.map(r => String(r[0]))).size;

      assert.equal(t.columns[0].type, h.app.COLTYPE.TEXT, 'a band name is not a GPA');
      assert.equal(t.columns[0].label, 'GPA', 'the header names what was banded');
      assert.equal(t.rows.length, distinct, 'one row per band, zero-count ones included');
      assert.includes(h.entry(h.out.id).log.join('\n'), 'in named bands');
    });

    test('the bands it emits are the ones the branch supplied, in that order', () => {
      const h = banded();
      h.set(h.sf.id, 'by', 'gpa');
      h.w.runQuery();
      const supplied = A.bandsFromLabels(bandBranch(h)).bands.map(b => b.name);
      const t = h.entry(h.out.id).table;
      assert.deepEqual(t.rows.map(r => r[0]), supplied);
      assert.deepEqual(t.columns[0].order, supplied,
        'the order has to reach the column, or a Sort reads them alphabetically');
    });

    test('pinning it to values puts the ordinary breakdown back', () => {
      const h = banded();
      h.set(h.sf.id, 'labelsAs', 'values');
      h.w.runQuery();
      assert.excludes(h.entry(h.out.id).log.join('\n'), 'in named bands');
    });

    test('unwiring the labels branch returns it to the data’s own values', () => {
      const h = banded();
      h.w.removeConnection(h.sel.id, h.sf.id, 'labels');
      h.w.runQuery();
      const l = h.entry(h.out.id).log.join('\n');
      assert.includes(l, 'from the data');
      assert.excludes(l, 'in named bands');
    });
  });

  describe('the panel', () => {
    const cfgText = (h, id) =>
      h.q('[data-node="' + id + '"]').closest('.node-config')
        .textContent.replace(/\s+/g, ' ').trim();

    function withLabelsPort(mode) {
      const h = boot();
      const src = h.add('source'), sf = h.add('selectFor'), out = h.add('output');
      const lsrc = h.add('source'), uniq = h.add('unique');
      h.app.connect(src.id, sf.id, null, 'data');
      h.app.connect(lsrc.id, uniq.id);
      h.app.connect(uniq.id, sf.id, null, 'labels');
      h.app.connect(sf.id, out.id);
      h.w.render();
      if (mode) h.set(sf.id, 'labelsAs', mode);
      return { ...h, sf };
    }

    test('an unwired Labels port mentions both shapes in one line', () => {
      const h = boot();
      const src = h.add('source'), sf = h.add('selectFor');
      h.app.connect(src.id, sf.id, null, 'data');
      h.w.render();
      const t = cfgText(h, sf.id);
      assert.includes(t, 'one column');
      assert.includes(t, 'three for named bands');
    });

    test('a wired port offers the reading, with the detected one named', () => {
      const h = withLabelsPort();
      const t = cfgText(h, h.sf.id);
      assert.includes(t, 'Read the Labels branch as');
      assert.includes(t, 'a list of values', 'Unique gives one column, so auto says values');
    });

    test('pinning to bands swaps "For each" for "Put in bands"', () => {
      const h = withLabelsPort('bands');
      const t = cfgText(h, h.sf.id);
      assert.includes(t, 'Put in bands');
      assert.excludes(t, 'For each');
    });

    test('and offers only columns a band can be compared against', () => {
      const h = withLabelsPort('bands');
      const opts = h.optionsOf(h.sf.id, 'by');
      assert.includes(opts, 'gpa');
      assert.excludes(opts, 'specialisation', 'a band cannot be compared to a word');
    });

    test('the value reading keeps the column picker, bands drop it', () => {
      const v = withLabelsPort('values');
      assert.includes(cfgText(v, v.sf.id), 'Groups from the Labels branch');
      const b = withLabelsPort('bands');
      assert.excludes(cfgText(b, b.sf.id), 'Groups from the Labels branch',
        'the format is positional, so there is no column to pick');
    });

    test('the "Out:" line follows the reading rather than the data alone', () => {
      /* It states the output shape, so it is the one line that may not describe
         the other reading. It took the labels schema to get this right. */
      const b = withLabelsPort('bands');
      assert.includes(cfgText(b, b.sf.id), 'one row per band');
      const v = withLabelsPort('values');
      assert.includes(cfgText(v, v.sf.id), 'one row per group');
    });
  });

  describe('it travels with the query', () => {
    test('the reading is saved and comes back', () => {
      const h = boot();
      /* Wired on the labels port, because the control only exists once there is
         a branch for it to describe. Driven through the DOM rather than by
         writing cfg, which keeps it honest about the control's data-key. */
      const src = h.add('source'), sf = h.add('selectFor'), lsrc = h.add('source');
      h.app.connect(src.id, sf.id, null, 'data');
      h.app.connect(lsrc.id, sf.id, null, 'labels');
      h.w.render();
      h.set(sf.id, 'labelsAs', 'bands');
      const json = JSON.stringify(h.app.serialiseGraph());
      const back = boot();
      const r = back.app.deserialiseGraph(json);
      assert.notOk(r.error, r.error);
      assert.equal(back.app.selectForLabelMode(r.nodes.find(n => n.type === 'selectFor')),
        'bands');
    });

    test('a reading given as an object is coerced, not trusted', () => {
      const h = boot();
      const g = { kind: 'student-data-analyser-query', version: 1,
        nodes: [{ id: 1, type: 'selectFor', x: 5, y: 5, cfg: { labelsAs: { evil: 1 } } }],
        connections: [] };
      const r = h.app.deserialiseGraph(JSON.stringify(g));
      assert.notOk(r.error, r.error);
      assert.equal(h.app.selectForLabelMode(r.nodes[0]), 'auto');
    });
  });
};
