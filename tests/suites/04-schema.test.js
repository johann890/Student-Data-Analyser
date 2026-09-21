/* Schema propagation.
   The claim being tested is that nodes adapt to whatever table reaches them,
   rather than assuming student records. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  /* 'source granularity' (2 tests) tested that the Source's two row modes
     declared different columns. There is one mode now: app.js:275 records the
     decision that a row is always a student, so a count is always a count of
     students. What those tests protected (that downstream nodes follow the
     header rather than assuming student records) is now covered by the Select
     rewiring test below, which changes the header without changing the Source. */

  describe('propagation through the graph', () => {
    test('a filter inherits its input schema', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      const schemas = h.app.computeSchemas();
      assert.deepEqual(schemas[f.id].columns.map(c => c.key), schemas[s.id].columns.map(c => c.key));
    });

    test('changing the Source rewrites the schema downstream', () => {
      const h = boot();
      const [s, sel, f, o] = h.build('source', 'select', 'filter', 'output');
      const before = h.app.computeSchemas()[f.id].columns.map(c => c.key);
      assert.includes(before, 'gpa');
      assert.includes(before, 'specialisation');

      h.set(sel.id, 'column:gpa', false);
      const after = h.app.computeSchemas()[f.id].columns.map(c => c.key);
      assert.excludes(after, 'gpa', 'the narrowing must reach the Filter');
      assert.includes(after, 'specialisation', 'and leave everything else alone');
    });

    test('an unconnected node falls back to the student schema so its panel still works', () => {
      const h = boot();
      h.w.addNode('filter');
      const f = h.app.nodes[0];
      const schema = h.app.inputSchema(f, h.app.computeSchemas());
      assert.ok(schema.columns.length > 0);
      assert.ok(h.app.hasCol(schema, 'gpa'));
    });
  });

  describe('the Filter panel follows the schema', () => {
    test('student rows offer student fields plus course predicates', () => {
      const h = boot();
      const [s, f] = h.build('source', 'filter');
      const opts = h.qa('.ft-sel option').map(o => o.value);
      ['gpa', 'specialisation', 'gender',
       'courses.subject', 'courses.code', 'courses.gradePoints'].forEach(k => assert.includes(opts, k));
      assert.excludes(opts, 'gradePoints', 'nothing unfolds enrolments into rows any more');
      assert.includes(opts, 'year', 'withheld once; app.js:1149 records why it came back');
    });

    test('a column can opt out of being filterable, and still carry data', () => {
      /* The opt-out is a property of a column, not a rule about years. Year
         used to declare it and no longer does (app.js:1149), so the mechanism
         is exercised directly. Otherwise it would sit untested until the next
         column that needs it, and discover then that it had rotted. */
      const { app } = boot();
      const T = app.COLTYPE;
      const t = app.makeTable([
        { key: 'n',       label: 'N',       type: T.NUMBER },
        { key: 'derived', label: 'Derived', type: T.NUMBER, filter: false }
      ], [[1, 2]]);

      assert.ok(app.hasCol(t, 'derived'), 'the column must still exist');
      const keys = app.filterFields(t).map(f => f.key);
      assert.includes(keys, 'n');
      assert.excludes(keys, 'derived');
      // and it still carries its value, so Output and export are unaffected
      assert.equal(app.cellAt(t, t.rows[0], 'derived'), 2);
    });

    test('nothing in the shipped schema declares the opt-out today', () => {
      const { app } = boot();
      const opted = app.studentsTable([]).columns.filter(c => c.filter === false);
      assert.deepEqual(opted.map(c => c.key), [],
        'if a column starts opting out, say so here and test what it means');
    });

    test('filterFields turns a nested column into three predicates', () => {
      const { app } = boot();
      const fields = app.filterFields(app.studentsTable([]));
      const keys = fields.map(f => f.key);
      assert.includes(keys, 'courses.subject');
      assert.includes(keys, 'courses.code');
      assert.includes(keys, 'courses.gradePoints');
      assert.excludes(keys, 'courses', 'the raw nested column is not directly filterable');
    });

    test('a numeric field renders an operator and a number box', () => {
      const h = boot();
      const [s, f] = h.build('source', 'filter');
      h.set(f.id, 'crit.0.field', 'gpa');
      assert.ok(h.control(f.id, 'crit.0.op:gpa'), 'operator select missing');
      assert.equal(h.control(f.id, 'crit.0.value:gpa').type, 'number');
    });

    test('an enum field renders a dropdown of its declared values', () => {
      const h = boot();
      const [s, f] = h.build('source', 'filter');
      h.set(f.id, 'crit.0.field', 'specialisation');
      const opts = h.optionsOf(f.id, 'crit.0.value:specialisation');
      assert.deepEqual(opts.slice().sort(), h.app.SPECS.slice().sort());
    });

    test('the course-mark field renders a course picker as well as a threshold', () => {
      const h = boot();
      const [s, f] = h.build('source', 'filter');
      h.set(f.id, 'crit.0.field', 'courses.gradePoints');
      assert.ok(h.control(f.id, 'crit.0.course'), 'course picker missing');
      assert.ok(h.control(f.id, 'crit.0.op:courses.gradePoints'));
      assert.ok(h.control(f.id, 'crit.0.value:courses.gradePoints'));
    });

    test('the course picker offers the whole catalogue, grouped by subject', () => {
      const h = boot();
      const [s, f] = h.build('source', 'filter');
      h.set(f.id, 'crit.0.field', 'courses.code');
      const opts = h.optionsOf(f.id, 'crit.0.value:courses.code');
      assert.equal(opts.length, h.app.COURSES.length);
      const groups = h.qa('[data-key="crit.0.value:courses.code"] optgroup').map(g => g.label);
      assert.deepEqual(groups, h.app.SUBJECTS);
    });
  });

  /* What this block used to cover ("the average column list comes from the
     incoming numeric columns") was about the Output node's own Average
     shortcut. That shortcut is gone; averaging is an Aggregate wired in front,
     where the step is visible on the canvas. The same claim is therefore made
     about Aggregate, which is where the column is now chosen. */
  describe('the Aggregate panel follows the schema', () => {
    test('the column list comes from the incoming numeric columns', () => {
      const h = boot();
      const [s, a, o] = h.build('source', 'aggregate', 'output');
      h.set(a.id, 'op', 'average');
      assert.includes(h.optionsOf(a.id, 'col'), 'gpa');
    });

    test('it follows a narrowed header rather than assuming student records', () => {
      const h = boot();
      const [s, sel, a, o] = h.build('source', 'select', 'aggregate', 'output');
      h.set(a.id, 'op', 'average');
      assert.includes(h.optionsOf(a.id, 'col'), 'gpa');

      h.set(sel.id, 'column:gpa', false);
      assert.excludes(h.optionsOf(a.id, 'col'), 'gpa',
        'a column that stopped arriving must stop being offered');
    });

    test('identifier columns are not offered as measures', () => {
      const h = boot();
      const [s, a, o] = h.build('source', 'aggregate', 'output');
      h.set(a.id, 'op', 'average');
      const opts = h.optionsOf(a.id, 'col');
      assert.ok(opts.length > 0, 'the control must actually be rendered');
      assert.excludes(opts, 'id', 'averaging an ID is meaningless');
    });

    test('defaultAvgCol picks the meaningful column for a student table', () => {
      const { app } = boot();
      assert.equal(app.defaultAvgCol(app.studentsTable([])), 'gpa');
    });
  });
};
