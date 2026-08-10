/* Saving and loading queries.
   A saved query is meant to be re-run against changed data, so the file must
   capture the query completely and never the results. Loading is strict about
   structure and forgiving about detail. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

const KIND = 'student-data-analyser-query';
const file = (over) => JSON.stringify(Object.assign(
  { kind: KIND, version: 1, nodes: [], connections: [] }, over));

module.exports = ({ describe, test }) => {

  function built() {
    const h = boot();
    const [s, f, o] = h.build('source', 'filter', 'output');
    h.set(s.id, 'pop', String(h.app.YEARS[0]));
    h.set(f.id, 'crit.0.field', 'specialisation');
    h.set(f.id, 'crit.0.value:specialisation', 'Data Science');
    h.set(o.id, 'show', 'courses');
    // The file name now lives beside Copy/Save, so it is set after a run.
    h.w.runQuery();
    h.setExportName(o.id, 'ds-cohort');
    return { ...h, s, f, o };
  }

  describe('the saved file', () => {
    test('declares its kind and version', () => {
      const g = built().app.serialiseGraph();
      assert.equal(g.kind, KIND);
      assert.equal(typeof g.version, 'number');
      assert.ok(g.savedAt);
    });

    test('captures the query, never the results', () => {
      const h = built();
      h.w.runQuery();
      const json = JSON.stringify(h.app.serialiseGraph());
      assert.excludes(json, 'gradeAvg":78', 'no student data should be in the file');
      assert.excludes(json, '"rows":[[');
      assert.includes(json, 'Data Science');
    });

    test('captures positions, so a query opens looking as it was left', () => {
      const h = built();
      h.s.x = 123; h.s.y = 45;
      const g = h.app.serialiseGraph();
      const n = g.nodes.find(n => n.id === h.s.id);
      assert.equal(n.x, 123);
      assert.equal(n.y, 45);
    });

    test('captures every config value', () => {
      const g = built().app.serialiseGraph();
      const src = g.nodes.find(n => n.type === 'source');
      const flt = g.nodes.find(n => n.type === 'filter');
      const out = g.nodes.find(n => n.type === 'output');
      assert.ok(src.cfg.pop);
      assert.equal(flt.cfg.criteria[0].field, 'specialisation');
      assert.equal(flt.cfg.criteria[0].values.specialisation, 'Data Science');
      assert.equal(out.cfg.show, 'courses');
      assert.equal(out.cfg.filename, 'ds-cohort');
    });

    test('is valid JSON', () => {
      const h = built();
      const json = JSON.stringify(h.app.serialiseGraph(), null, 2);
      assert.deepEqual(JSON.parse(json).kind, KIND);
    });
  });

  describe('round trip', () => {
    test('a cleared graph is fully restored', () => {
      const h = built();
      const json = JSON.stringify(h.app.serialiseGraph());
      const nodeCount = h.app.nodes.length, connCount = h.app.connections.length;
      h.w.clearAll();
      assert.equal(h.app.nodes.length, 0);
      h.app.loadGraphFromText(json, h.doc.createElement('button'));
      assert.equal(h.app.nodes.length, nodeCount);
      assert.equal(h.app.connections.length, connCount);
      assert.equal(h.qa('.node').length, nodeCount, 'nodes should be rendered');
    });

    test('results are identical before and after a reload', () => {
      const h = built();
      h.w.runQuery();
      const before = h.app.serialiseTable(
        h.app.exportTableFor(h.entry(h.o.id)), ',', true);
      const json = JSON.stringify(h.app.serialiseGraph());
      h.w.clearAll();
      h.app.loadGraphFromText(json, h.doc.createElement('button'));
      h.w.runQuery();
      const out = h.app.nodes.find(n => n.type === 'output');
      const after = h.app.serialiseTable(
        h.app.exportTableFor(h.entry(out.id)), ',', true);
      assert.equal(after, before);
    });

    test('loading into a different session works', () => {
      const a = built();
      const json = JSON.stringify(a.app.serialiseGraph());
      a.w.runQuery();
      const expected = a.app.serialiseTable(a.app.exportTableFor(a.entry(a.o.id)), ',', true);

      const b = boot();
      b.app.loadGraphFromText(json, b.doc.createElement('button'));
      b.w.runQuery();
      const out = b.app.nodes.find(n => n.type === 'output');
      assert.equal(b.app.serialiseTable(b.app.exportTableFor(b.entry(out.id)), ',', true), expected);
    });

    test('a node added after loading cannot collide with a loaded id', () => {
      const h = built();
      const json = JSON.stringify(h.app.serialiseGraph());
      h.w.clearAll();
      h.app.loadGraphFromText(json, h.doc.createElement('button'));
      h.w.addNode('filter');
      const ids = h.app.nodes.map(n => n.id);
      assert.equal(new Set(ids).size, ids.length, 'duplicate id after load: ' + ids.join(','));
    });

    test('loading does not leave stale results exportable', () => {
      const h = built();
      h.w.runQuery();
      assert.ok(h.app.resultsFresh);
      h.app.loadGraphFromText(JSON.stringify(h.app.serialiseGraph()), h.doc.createElement('button'));
      assert.notOk(h.app.resultsFresh, 'a freshly loaded graph has not been run');
    });
  });

  describe('rejecting files that are not queries', () => {
    const bad = [
      ['malformed JSON',      'not json {',           'valid JSON'],
      ['a different tool',    file({ kind: 'other' }), 'saved query'],
      ['a newer version',     file({ version: 999 }), 'newer version'],
      ['missing arrays',      '{"kind":"' + KIND + '","version":1}', 'missing'],
      ['null',                'null',                 'saved query'],
      ['a bare array',        '[]',                   'saved query'],
      ['a number',            '42',                   'saved query']
    ];
    bad.forEach(([label, raw, expect]) => {
      test('rejects ' + label + ' with a useful message', () => {
        const r = boot().app.deserialiseGraph(raw);
        assert.ok(r.error, 'should have been rejected');
        assert.includes(r.error.toLowerCase(), expect.toLowerCase());
      });
    });

    test('a rejected load leaves the current graph untouched', () => {
      const h = built();
      const before = h.app.nodes.length;
      h.app.loadGraphFromText('garbage', h.doc.createElement('button'));
      assert.equal(h.app.nodes.length, before);
      assert.ok(h.text('.error-box'));
    });
  });

  describe('repairing salvageable files', () => {
    const messy = file({
      nodes: [
        { id: 1, type: 'source', x: 10, y: 10, cfg: { pop: 'all', rows: 'students' } },
        { id: 2, type: 'output', x: 300, y: 10, cfg: { show: 'count' } },
        { id: 3, type: 'wormhole', x: 0, y: 0, cfg: {} },
        { id: 1, type: 'filter', x: 0, y: 0, cfg: {} }
      ],
      connections: [
        { from: 1, to: 2 },
        { from: 2, to: 1 },
        { from: 1, to: 99 },
        { from: 1, to: 2 }
      ]
    });

    test('an unknown node type is dropped', () => {
      const r = boot().app.deserialiseGraph(messy);
      assert.excludes(r.nodes.map(n => n.type), 'wormhole');
      assert.includes(r.warnings.join(' '), 'unknown node type');
    });

    test('a duplicate id is dropped, keeping the first', () => {
      const r = boot().app.deserialiseGraph(messy);
      assert.equal(r.nodes.filter(n => n.id === 1).length, 1);
      assert.equal(r.nodes.find(n => n.id === 1).type, 'source');
    });

    test('a connection to a missing node is dropped', () => {
      const r = boot().app.deserialiseGraph(messy);
      assert.notOk(r.connections.some(c => c.to === 99));
    });

    test('a connection breaking the wiring rules is dropped', () => {
      const r = boot().app.deserialiseGraph(messy);
      assert.notOk(r.connections.some(c => c.from === 2 && c.to === 1),
        'output must not feed a source');
    });

    test('duplicate connections collapse to one', () => {
      const r = boot().app.deserialiseGraph(messy);
      assert.equal(r.connections.filter(c => c.from === 1 && c.to === 2).length, 1);
    });

    test('the repaired graph still runs', () => {
      const h = boot();
      h.app.loadGraphFromText(messy, h.doc.createElement('button'));
      h.w.runQuery();
      assert.equal(Number(h.bigNum()), h.app.STUDENTS.length);
    });

    test('the user is told what was skipped', () => {
      const h = boot();
      h.app.loadGraphFromText(messy, h.doc.createElement('button'));
      assert.includes(h.panel(), 'Skipped');
    });
  });

  describe('forward compatibility', () => {
    test('a file predating a config key loads with that key at its default', () => {
      const r = boot().app.deserialiseGraph(file({
        nodes: [{ id: 1, type: 'output', x: 0, y: 0, cfg: { show: 'count' } }]
      }));
      const cfg = r.nodes[0].cfg;
      assert.equal(cfg.filename, '', 'should be defaulted, not undefined');
      assert.ok('avgCol' in cfg);
    });

    test('a filter with no criteria gets one rather than an empty panel', () => {
      const r = boot().app.deserialiseGraph(file({
        nodes: [{ id: 1, type: 'filter', x: 0, y: 0, cfg: { criteria: [] } }]
      }));
      assert.equal(r.nodes[0].cfg.criteria.length, 1);
    });

    test('a criteria value that is not an array is repaired', () => {
      const r = boot().app.deserialiseGraph(file({
        nodes: [{ id: 1, type: 'filter', x: 0, y: 0, cfg: { criteria: 'oops' } }]
      }));
      assert.ok(Array.isArray(r.nodes[0].cfg.criteria));
      assert.equal(r.nodes[0].cfg.criteria.length, 1);
    });

    test('junk inside a criterion does not survive into the model', () => {
      const r = boot().app.deserialiseGraph(file({
        nodes: [{ id: 1, type: 'filter', x: 0, y: 0,
                  cfg: { criteria: [{ field: 'gradeAvg', values: { gradeAvg: '80' }, evil: 1 }] } }]
      }));
      const c = r.nodes[0].cfg.criteria[0];
      assert.equal(c.field, 'gradeAvg');
      assert.equal(c.values.gradeAvg, '80');
      assert.equal(c.evil, undefined, 'unknown keys should not be copied through');
    });

    test('missing coordinates default to zero rather than NaN', () => {
      const r = boot().app.deserialiseGraph(file({
        nodes: [{ id: 1, type: 'source', cfg: {} }]
      }));
      assert.equal(r.nodes[0].x, 0);
      assert.equal(r.nodes[0].y, 0);
    });
  });

  describe('saving to disk', () => {
    test('save writes a .json file', () => {
      const h = built();
      h.w.saveGraph(h.doc.createElement('button'));
      const f = h.saved[h.saved.length - 1];
      assert.ok(/\.json$/.test(f.name), f.name);
      assert.equal(JSON.parse(f.content).kind, KIND);
    });

    test('saving an empty canvas is refused with a message', () => {
      const h = boot();
      const b = h.doc.createElement('button');
      h.w.saveGraph(b);
      assert.equal(h.saved.length, 0);
      assert.equal(b.textContent, 'Nothing to save');
    });
  });
};
