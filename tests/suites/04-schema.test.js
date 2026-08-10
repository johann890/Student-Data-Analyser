/* Schema propagation.
   The claim being tested is that nodes adapt to whatever table reaches them,
   rather than assuming student records. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  describe('source granularity', () => {
    test('the two granularities declare different columns', () => {
      const { app } = boot();
      const st = app.studentsTable([]).columns.map(c => c.key);
      const en = app.enrolmentsTable([]).columns.map(c => c.key);
      assert.includes(st, 'gradeAvg');
      assert.includes(st, 'courses');
      assert.includes(en, 'mark');
      assert.includes(en, 'code');
      assert.excludes(en, 'courses', 'enrolment rows are already unfolded');
      assert.excludes(st, 'mark');
    });

    test('row counts differ by the courses-per-student factor', () => {
      const { app } = boot();
      const st = app.studentsTable(app.STUDENTS);
      const en = app.enrolmentsTable(app.STUDENTS);
      assert.equal(en.rows.length, app.STUDENTS.reduce((a, s) => a + s.courses.length, 0));
      assert.equal(en.rows.length, st.rows.length * app.COURSES_PER_YEAR);
    });
  });

  describe('propagation through the graph', () => {
    test('a filter inherits its input schema', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      const schemas = h.app.computeSchemas();
      assert.deepEqual(schemas[f.id].columns.map(c => c.key), schemas[s.id].columns.map(c => c.key));
    });

    test('changing the Source rewrites the schema downstream', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      const before = h.app.computeSchemas()[f.id].columns.map(c => c.key);
      h.set(s.id, 'rows', 'enrolments');
      const after = h.app.computeSchemas()[f.id].columns.map(c => c.key);
      assert.includes(before, 'gradeAvg');
      assert.includes(after, 'mark');
      assert.excludes(after, 'gradeAvg');
    });

    test('an unconnected node falls back to the student schema so its panel still works', () => {
      const h = boot();
      h.w.addNode('filter');
      const f = h.app.nodes[0];
      const schema = h.app.inputSchema(f, h.app.computeSchemas());
      assert.ok(schema.columns.length > 0);
      assert.ok(h.app.hasCol(schema, 'gradeAvg'));
    });
  });

  describe('the Filter panel follows the schema', () => {
    test('student rows offer student fields plus course predicates', () => {
      const h = boot();
      const [s, f] = h.build('source', 'filter');
      const opts = h.qa('.ft-sel option').map(o => o.value);
      ['gradeAvg', 'specialisation', 'gender',
       'courses.subject', 'courses.code', 'courses.mark'].forEach(k => assert.includes(opts, k));
      assert.excludes(opts, 'mark');
      assert.excludes(opts, 'year', 'year is scoped at the Source, not filtered here');
    });

    test('enrolment rows offer course fields and drop the nested predicates', () => {
      const h = boot();
      const [s, f] = h.build('source', 'filter');
      h.set(s.id, 'rows', 'enrolments');
      const opts = h.qa('.ft-sel option').map(o => o.value);
      ['mark', 'code', 'subject', 'points'].forEach(k => assert.includes(opts, k));
      assert.excludes(opts, 'courses.subject', 'nested predicates make no sense once unfolded');
      assert.excludes(opts, 'gradeAvg');
    });

    test('a column marked filter:false is displayed but not filterable', () => {
      const { app } = boot();
      const t = app.studentsTable(app.STUDENTS.slice(0, 2));
      assert.ok(app.hasCol(t, 'year'), 'the column must still exist');
      assert.excludes(app.filterFields(t).map(f => f.key), 'year');
      // and it still carries data, so Output and export are unaffected
      assert.equal(app.cellAt(t, t.rows[0], 'year'), app.STUDENTS[0].year);
    });

    test('the flag survives the unfold to enrolments', () => {
      const { app } = boot();
      const en = app.toEnrolments(app.studentsTable(app.STUDENTS.slice(0, 2)));
      assert.ok(app.hasCol(en, 'year'));
      assert.excludes(app.filterFields(en).map(f => f.key), 'year',
        'rebuilding the column descriptors must not drop filter:false');
    });

    test('filterFields turns a nested column into three predicates', () => {
      const { app } = boot();
      const fields = app.filterFields(app.studentsTable([]));
      const keys = fields.map(f => f.key);
      assert.includes(keys, 'courses.subject');
      assert.includes(keys, 'courses.code');
      assert.includes(keys, 'courses.mark');
      assert.excludes(keys, 'courses', 'the raw nested column is not directly filterable');
    });

    test('a numeric field renders an operator and a number box', () => {
      const h = boot();
      const [s, f] = h.build('source', 'filter');
      h.set(f.id, 'crit.0.field', 'gradeAvg');
      assert.ok(h.control(f.id, 'crit.0.op:gradeAvg'), 'operator select missing');
      assert.equal(h.control(f.id, 'crit.0.value:gradeAvg').type, 'number');
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
      h.set(f.id, 'crit.0.field', 'courses.mark');
      assert.ok(h.control(f.id, 'crit.0.course'), 'course picker missing');
      assert.ok(h.control(f.id, 'crit.0.op:courses.mark'));
      assert.ok(h.control(f.id, 'crit.0.value:courses.mark'));
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

  describe('the Output panel follows the schema', () => {
    test('the average column list comes from the incoming numeric columns', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(o.id, 'show', 'average');
      assert.includes(h.optionsOf(o.id, 'avgCol'), 'gradeAvg');
      h.set(s.id, 'rows', 'enrolments');
      h.set(o.id, 'show', 'average');
      const opts = h.optionsOf(o.id, 'avgCol');
      assert.includes(opts, 'mark');
      assert.excludes(opts, 'gradeAvg');
    });

    test('identifier columns are not offered as averages', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(o.id, 'show', 'average');
      assert.excludes(h.optionsOf(o.id, 'avgCol'), 'id', 'averaging an ID is meaningless');
    });

    test('defaultAvgCol picks the meaningful column for each granularity', () => {
      const { app } = boot();
      assert.equal(app.defaultAvgCol(app.studentsTable([])), 'gradeAvg');
      assert.equal(app.defaultAvgCol(app.enrolmentsTable([])), 'mark');
    });
  });
};
