/* Graph structure: wiring rules, evaluation order, merging. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  describe('wiring rules', () => {
    test('the rule table is the single source of truth', () => {
      const { app } = boot();
      const R = app.CONNECT_RULES;
      assert.deepEqual(R.output, [], 'an Output is terminal');
      assert.includes(R.source, 'filter');
      assert.includes(R.source, 'output');
      assert.includes(R.filter, 'filter');
      assert.deepEqual(R.compare, ['output'], 'a comparison table cannot be filtered again');
    });

    test('every node type appears in the rule table', () => {
      const { app } = boot();
      ['source', 'filter', 'compare', 'output'].forEach(t =>
        assert.ok(app.CONNECT_RULES[t] !== undefined, 'missing rules for ' + t));
    });
  });

  describe('evaluation order', () => {
    test('a linear chain sorts in order', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      assert.deepEqual(h.app.topoSort().map(n => n.id), [s.id, f.id, o.id]);
    });

    test('a diamond evaluates every node exactly once', () => {
      const h = boot();
      h.w.addNode('source'); const s = h.app.nodes[0];
      h.w.addNode('filter');  const f1 = h.app.nodes[1];
      h.w.addNode('filter');  const f2 = h.app.nodes[2];
      h.w.addNode('output');  const o = h.app.nodes[3];
      h.app.connect(s.id, f1.id); h.app.connect(s.id, f2.id);
      h.app.connect(f1.id, o.id); h.app.connect(f2.id, o.id);
      const order = h.app.topoSort().map(n => n.id);
      assert.equal(order.length, 4);
      assert.equal(new Set(order).size, 4);
      assert.ok(order.indexOf(s.id) < order.indexOf(f1.id));
      assert.ok(order.indexOf(f1.id) < order.indexOf(o.id));
    });

    test('a cycle is detected and reported instead of hanging', () => {
      const h = boot();
      const [f1, f2] = h.build('filter', 'filter');
      h.app.connect(f2.id, f1.id);       // close the loop
      const ev = h.app.evaluateGraph();
      assert.ok(ev.error);
      assert.includes(ev.error, 'Circular');
    });

    test('a disconnected node does not break evaluation', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.w.addNode('filter');           // never wired to anything
      h.w.runQuery();
      assert.notOk(h.q('.error-box'));
      // Assert on the exported table, not the rendered rows: the display
      // truncates long results, so counting <tr> would measure the row limit.
      assert.equal(h.entry(o.id).table.rows.length, h.app.STUDENTS.length);
    });
  });

  describe('merging multiple inputs', () => {
    test('two branches union without duplicating shared rows', () => {
      const h = boot();
      h.w.addNode('source'); const s = h.app.nodes[0];
      h.w.addNode('filter');  const f1 = h.app.nodes[1];
      h.w.addNode('filter');  const f2 = h.app.nodes[2];
      h.w.addNode('output');  const o = h.app.nodes[3];
      h.app.connect(s.id, f1.id); h.app.connect(s.id, f2.id);
      h.app.connect(f1.id, o.id); h.app.connect(f2.id, o.id);
      h.w.render();
      h.set(o.id, 'show', 'count');
      h.set(f1.id, 'crit.0.op:gradeAvg', 'gte'); h.set(f1.id, 'crit.0.value:gradeAvg', '80');
      h.set(f2.id, 'crit.0.op:gradeAvg', 'gte'); h.set(f2.id, 'crit.0.value:gradeAvg', '70');
      h.w.runQuery();
      // Everyone >= 80 is also >= 70, so the union is exactly the wider set
      assert.equal(Number(h.bigNum()), h.app.STUDENTS.filter(x => x.gradeAvg >= 70).length);
    });

    test('the merge is announced in the log', () => {
      const h = boot();
      h.w.addNode('source'); const s1 = h.app.nodes[0];
      h.w.addNode('source'); const s2 = h.app.nodes[1];
      h.w.addNode('output'); const o = h.app.nodes[2];
      h.app.connect(s1.id, o.id); h.app.connect(s2.id, o.id);
      h.w.render(); h.w.runQuery();
      assert.includes(h.text('.query-log'), 'MERGE');
    });

    test('rowKey dedupes students by id and enrolments by student plus course', () => {
      const { app } = boot();
      const st = app.studentsTable(app.STUDENTS.slice(0, 2));
      assert.ok(app.rowKey(st, st.rows[0]) !== app.rowKey(st, st.rows[1]));
      const en = app.enrolmentsTable(app.STUDENTS.slice(0, 1));
      const keys = en.rows.map(r => app.rowKey(en, r));
      assert.equal(new Set(keys).size, keys.length, 'same student, different courses must differ');
    });

    test('merging identical tables yields one copy of each row', () => {
      const { app } = boot();
      const t = app.studentsTable(app.STUDENTS.slice(0, 10));
      const merged = app.unionTables([t, t]);
      assert.equal(merged.rows.length, 10);
    });

    test('merging mismatched granularities is refused with an explanation', () => {
      const h = boot();
      h.w.addNode('source'); const s1 = h.app.nodes[0];
      h.w.addNode('source'); const s2 = h.app.nodes[1];
      h.w.addNode('output'); const o = h.app.nodes[2];
      h.app.connect(s1.id, o.id); h.app.connect(s2.id, o.id);
      h.w.render();
      h.set(s2.id, 'rows', 'enrolments');
      h.w.runQuery();
      const err = h.text('.error-box');
      assert.ok(err, 'a ragged table would otherwise be produced silently');
      assert.includes(err, 'different columns');
    });

    test('schemaKey distinguishes the two granularities', () => {
      const { app } = boot();
      assert.ok(app.schemaKey(app.studentsTable([])) !== app.schemaKey(app.enrolmentsTable([])));
      assert.equal(app.schemaKey(app.studentsTable([])), app.schemaKey(app.studentsTable(app.STUDENTS)));
    });
  });

  describe('source population', () => {
    test('a year restriction narrows the source', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(o.id, 'show', 'count');
      const y = h.app.YEARS[0];
      h.set(s.id, 'pop', String(y));
      h.w.runQuery();
      assert.equal(Number(h.bigNum()), h.app.STUDENTS.filter(x => x.year === y).length);
    });

    test('every year option produces the right cohort', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(o.id, 'show', 'count');
      h.app.YEARS.forEach(y => {
        h.set(s.id, 'pop', String(y));
        h.w.runQuery();
        assert.equal(Number(h.bigNum()), h.app.STUDENTS.filter(x => x.year === y).length, 'year ' + y);
      });
    });

    test('the year restriction also applies at enrolment granularity', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(o.id, 'show', 'count');
      h.set(s.id, 'rows', 'enrolments');
      const y = h.app.YEARS[0];
      h.set(s.id, 'pop', String(y));
      h.w.runQuery();
      let n = 0;
      h.app.STUDENTS.filter(x => x.year === y).forEach(x => n += x.courses.length);
      assert.equal(Number(h.bigNum()), n);
    });
  });

  describe('guard rails before running', () => {
    const cases = [
      ['no nodes at all',   [],                    'Source'],
      ['no Output',         ['source'],            'Output'],
      ['no Source',         ['output'],            'Source']
    ];
    cases.forEach(([label, types, expect]) => {
      test(label + ' gives a specific message', () => {
        const h = boot();
        types.forEach(t => h.w.addNode(t));
        h.w.runQuery();
        assert.includes(h.text('.error-box'), expect);
      });
    });

    test('nodes present but nothing wired explains how to connect them', () => {
      const h = boot();
      h.w.addNode('source'); h.w.addNode('output');
      h.w.runQuery();
      assert.includes(h.text('.error-box').toLowerCase(), 'connect');
    });
  });

  describe('node removal', () => {
    test('removing a node removes its connections too', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      assert.equal(h.app.connections.length, 2);
      h.w.removeNode(f.id);
      assert.equal(h.app.nodes.length, 2);
      assert.equal(h.app.connections.length, 0, 'dangling edges would break evaluation');
    });

    test('clearAll empties everything', () => {
      const h = boot();
      h.build('source', 'filter', 'output');
      h.w.clearAll();
      assert.equal(h.app.nodes.length, 0);
      assert.equal(h.app.connections.length, 0);
      assert.equal(h.qa('.node').length, 0);
      assert.equal(h.doc.getElementById('hint').style.display, 'block');
    });
  });
};
