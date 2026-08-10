/* Filtering.
   Every result is cross-checked against the same question asked directly of the
   raw dataset, so a wrong answer cannot pass by agreeing with itself. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  // Builds source -> filter -> output(count) and returns a runner
  function rig(sourceRows) {
    const h = boot();
    const [s, f, o] = h.build('source', 'filter', 'output');
    if (sourceRows) h.set(s.id, 'rows', sourceRows);
    h.set(o.id, 'show', 'count');
    return { ...h, s, f, o,
      count: () => { h.w.runQuery(); return Number(h.bigNum()); },
      log:   () => h.text('.query-log') };
  }

  const S = boot().app.STUDENTS;

  /* Pick the subject to exercise from the catalogue rather than naming one.
     Hardcoding a code meant these tests broke the moment a subject was removed,
     and — worse — a test naming a subject that no longer exists would filter
     nothing and quietly pass by matching zero against zero.
     A core subject is avoided because every student takes it, which would make
     "took a course in X" indistinguishable from no filter at all. */
  const A = boot().app;
  const CORE_SUBJECTS = new Set(A.CORE_COURSES.map(c => A.COURSE_BY_CODE[c].subject));
  const SUBJ = A.SUBJECTS.find(x => !CORE_SUBJECTS.has(x));
  const CODE = A.COURSES.find(c => c.subject === SUBJ).code;

  describe('numeric fields', () => {
    test('greater-than matches the dataset', () => {
      const r = rig();
      r.set(r.f.id, 'crit.0.op:gradeAvg', 'gt');
      r.set(r.f.id, 'crit.0.value:gradeAvg', '80');
      assert.equal(r.count(), S.filter(x => x.gradeAvg > 80).length);
    });

    test('all six operators behave correctly', () => {
      const r = rig();
      const cases = { gt: (a,b)=>a>b, gte: (a,b)=>a>=b, lt: (a,b)=>a<b,
                      lte: (a,b)=>a<=b, eq: (a,b)=>a===b, ne: (a,b)=>a!==b };
      Object.keys(cases).forEach(op => {
        r.set(r.f.id, 'crit.0.op:gradeAvg', op);
        r.set(r.f.id, 'crit.0.value:gradeAvg', '75');
        assert.equal(r.count(), S.filter(x => cases[op](x.gradeAvg, 75)).length, 'operator ' + op);
      });
    });

    test('a threshold nothing can meet gives zero, not an error', () => {
      const r = rig();
      r.set(r.f.id, 'crit.0.value:gradeAvg', '500');
      assert.equal(r.count(), 0);
    });

    test('a blank number reports a clear error instead of matching everything', () => {
      const r = rig();
      r.set(r.f.id, 'crit.0.value:gradeAvg', '');
      r.w.runQuery();
      const err = r.text('.error-box');
      assert.ok(err, 'expected an error box');
      assert.includes(err.toLowerCase(), 'number');
    });

    test('a non-numeric string is rejected', () => {
      const r = rig();
      r.app.setCfg(r.f.id, 'crit.0.value:gradeAvg', 'abc');
      r.w.runQuery();
      assert.ok(r.text('.error-box'));
    });
  });

  describe('enum fields', () => {
    test('specialisation equality', () => {
      const r = rig();
      r.set(r.f.id, 'crit.0.field', 'specialisation');
      r.set(r.f.id, 'crit.0.value:specialisation', 'Cybersecurity');
      assert.equal(r.count(), S.filter(x => x.specialisation === 'Cybersecurity').length);
    });

    test('specialisation inequality', () => {
      const r = rig();
      r.set(r.f.id, 'crit.0.field', 'specialisation');
      r.set(r.f.id, 'crit.0.value:specialisation', 'Cybersecurity');
      r.set(r.f.id, 'crit.0.op:specialisation', 'ne');
      assert.equal(r.count(), S.filter(x => x.specialisation !== 'Cybersecurity').length);
    });

    test('gender', () => {
      const r = rig();
      r.set(r.f.id, 'crit.0.field', 'gender');
      r.set(r.f.id, 'crit.0.value:gender', 'F');
      assert.equal(r.count(), S.filter(x => x.gender === 'F').length);
    });

    test('year is not offered as a filter — the Source scopes it', () => {
      /* Deliberate: the Source already restricts the population by year, and
         offering it in both places allowed a graph that said 2022 upstream and
         2023 downstream. The column still exists and is displayed, exported and
         grouped on — it just cannot be filtered here. */
      const r = rig();
      assert.excludes(r.qa('.ft-sel option').map(o => o.value), 'year');
      const enrol = rig('enrolments');
      assert.excludes(enrol.qa('.ft-sel option').map(o => o.value), 'year',
        'the exclusion should hold at both granularities');
    });

    test('a filterable enum compares by string, so "2022" would match 2022', () => {
      /* The coercion this protects used to be exercised through the year field.
         Tested directly now that year is excluded, because the comparison rule
         still applies to any enum whose values are numeric. */
      const { app } = boot();
      const col = { key: 'code', label: 'Code', type: app.COLTYPE.ENUM, values: [2022, 2023] };
      const t = app.makeTable([col], [[2022], [2023], [2022]]);
      const crit = { field: 'code', values: { code: '2022' }, ops: { code: 'eq' } };
      const out = app.applyFilter({ cfg: { criteria: [crit] } }, t, []);
      assert.equal(out.table.rows.length, 2,
        'a strict === between the control string and the numeric cell returns zero');
    });

    test('every offered enum option is selectable and yields a sane count', () => {
      const r = rig();
      r.set(r.f.id, 'crit.0.field', 'specialisation');
      r.app.SPECS.forEach(sp => {
        r.set(r.f.id, 'crit.0.value:specialisation', sp);
        assert.equal(r.count(), S.filter(x => x.specialisation === sp).length, sp);
      });
    });
  });

  describe('course predicates on student rows', () => {
    test('"took a course in SUBJECT" keeps whole students', () => {
      const r = rig();
      r.set(r.f.id, 'crit.0.field', 'courses.subject');
      r.set(r.f.id, 'crit.0.value:courses.subject', SUBJ);
      assert.equal(r.count(), S.filter(x => x.courses.some(c => c.subject === SUBJ)).length);
    });

    test('"took course CODE"', () => {
      const r = rig();
      r.set(r.f.id, 'crit.0.field', 'courses.code');
      r.set(r.f.id, 'crit.0.value:courses.code', CODE);
      assert.equal(r.count(), S.filter(x => x.courses.some(c => c.code === CODE)).length);
    });

    test('"mark in course" tests enrolment AND threshold together', () => {
      const r = rig();
      r.set(r.f.id, 'crit.0.field', 'courses.mark');
      r.set(r.f.id, 'crit.0.course', CODE);
      r.set(r.f.id, 'crit.0.op:courses.mark', 'gte');
      r.set(r.f.id, 'crit.0.value:courses.mark', '75');
      const want = S.filter(x => { const c = x.courses.find(c => c.code === CODE); return c && c.mark >= 75; });
      assert.equal(r.count(), want.length);
    });

    test('a student who never took the course is excluded from a "less than" test', () => {
      // The trap: treating a missing enrolment as 0 would pass every < test.
      const r = rig();
      r.set(r.f.id, 'crit.0.field', 'courses.mark');
      r.set(r.f.id, 'crit.0.course', CODE);
      r.set(r.f.id, 'crit.0.op:courses.mark', 'lt');
      r.set(r.f.id, 'crit.0.value:courses.mark', '50');
      const got = r.count();
      const want = S.filter(x => { const c = x.courses.find(c => c.code === CODE); return c && c.mark < 50; });
      assert.equal(got, want.length);
      assert.ok(got < S.length, 'non-takers leaked in as zero-mark students');
    });

    test('the log says these filters select students, not courses', () => {
      const r = rig();
      r.set(r.f.id, 'crit.0.field', 'courses.subject');
      r.set(r.f.id, 'crit.0.value:courses.subject', SUBJ);
      r.count();
      assert.includes(r.log(), 'took');
      assert.includes(r.log(), 'student');
    });
  });

  describe('filtering at enrolment granularity', () => {
    test('subject filters rows, not students', () => {
      const r = rig('enrolments');
      r.set(r.f.id, 'crit.0.field', 'subject');
      r.set(r.f.id, 'crit.0.value:subject', SUBJ);
      let n = 0;
      S.forEach(x => x.courses.forEach(c => { if (c.subject === SUBJ) n++; }));
      assert.equal(r.count(), n);
    });

    test('mark filters individual enrolments', () => {
      const r = rig('enrolments');
      r.set(r.f.id, 'crit.0.field', 'mark');
      r.set(r.f.id, 'crit.0.op:mark', 'gte');
      r.set(r.f.id, 'crit.0.value:mark', '90');
      let n = 0;
      S.forEach(x => x.courses.forEach(c => { if (c.mark >= 90) n++; }));
      assert.equal(r.count(), n);
    });

    test('the two granularities give different, individually correct answers', () => {
      const students = rig();
      students.set(students.f.id, 'crit.0.field', 'courses.subject');
      students.set(students.f.id, 'crit.0.value:courses.subject', SUBJ);
      const byStudent = students.count();

      const enrol = rig('enrolments');
      enrol.set(enrol.f.id, 'crit.0.field', 'subject');
      enrol.set(enrol.f.id, 'crit.0.value:subject', SUBJ);
      const byEnrolment = enrol.count();

      assert.equal(byStudent, S.filter(x => x.courses.some(c => c.subject === SUBJ)).length);
      let n = 0; S.forEach(x => x.courses.forEach(c => { if (c.subject === SUBJ) n++; }));
      assert.equal(byEnrolment, n);
      assert.ok(byStudent !== byEnrolment, 'the distinction should be observable');
    });
  });

  describe('multiple criteria', () => {
    test('criteria compose as AND', () => {
      const r = rig();
      r.w.addCriterion(r.f.id); r.w.addCriterion(r.f.id); r.w.render();
      r.set(r.f.id, 'crit.0.op:gradeAvg', 'gte');
      r.set(r.f.id, 'crit.0.value:gradeAvg', '75');
      r.set(r.f.id, 'crit.1.field', 'gender');
      r.set(r.f.id, 'crit.1.value:gender', 'F');
      r.set(r.f.id, 'crit.2.field', 'courses.subject');
      r.set(r.f.id, 'crit.2.value:courses.subject', 'AIML');
      const want = S.filter(x => x.gradeAvg >= 75 && x.gender === 'F' &&
                                 x.courses.some(c => c.subject === 'AIML'));
      assert.equal(r.count(), want.length);
    });

    test('order of criteria does not change the result', () => {
      const build = (first, second) => {
        const r = rig();
        r.w.addCriterion(r.f.id); r.w.render();
        r.set(r.f.id, 'crit.0.field', first.field);
        r.set(r.f.id, 'crit.0.value:' + first.field, first.value);
        r.set(r.f.id, 'crit.1.field', second.field);
        r.set(r.f.id, 'crit.1.value:' + second.field, second.value);
        return r.count();
      };
      const a = { field: 'gender', value: 'M' };
      const b = { field: 'specialisation', value: 'Data Science' };
      assert.equal(build(a, b), build(b, a));
    });

    test('removing a criterion widens the result', () => {
      const r = rig();
      r.w.addCriterion(r.f.id); r.w.render();
      r.set(r.f.id, 'crit.0.op:gradeAvg', 'gte');
      r.set(r.f.id, 'crit.0.value:gradeAvg', '70');
      r.set(r.f.id, 'crit.1.field', 'gender');
      r.set(r.f.id, 'crit.1.value:gender', 'F');
      const narrow = r.count();
      r.w.removeCriterion(r.f.id, 1);
      const wide = r.count();
      assert.ok(wide > narrow, wide + ' should exceed ' + narrow);
      assert.equal(wide, S.filter(x => x.gradeAvg >= 70).length);
    });

    test('the first criterion cannot be removed', () => {
      // The remove buttons carry an onclick rather than data attributes, so they
      // are counted within the filter node's own element.
      const r = rig();
      const panel = () => r.qa('.node').find(el => el.querySelector('.shape-filter'));
      assert.equal(panel().querySelectorAll('.remove-criterion-btn').length, 0,
        'the only condition must not be removable');
      r.w.addCriterion(r.f.id); r.w.render();
      assert.equal(panel().querySelectorAll('.remove-criterion-btn').length, 1,
        'the second condition should be removable');
    });
  });

  describe('chained filters', () => {
    test('two filter nodes in series narrow cumulatively', () => {
      const h = boot();
      const [s, f1, f2, o] = h.build('source', 'filter', 'filter', 'output');
      h.set(o.id, 'show', 'count');
      h.set(f1.id, 'crit.0.op:gradeAvg', 'gte');
      h.set(f1.id, 'crit.0.value:gradeAvg', '70');
      h.set(f2.id, 'crit.0.field', 'specialisation');
      h.set(f2.id, 'crit.0.value:specialisation', 'Computer Science');
      h.w.runQuery();
      const want = h.app.STUDENTS.filter(x => x.gradeAvg >= 70 && x.specialisation === 'Computer Science');
      assert.equal(Number(h.bigNum()), want.length);
    });
  });

  describe('orphaned criteria', () => {
    test('a criterion whose column vanished is skipped, and the query still runs', () => {
      const r = rig();
      r.set(r.f.id, 'crit.0.value:gradeAvg', '80');
      r.set(r.s.id, 'rows', 'enrolments');   // gradeAvg no longer exists upstream
      const got = r.count();
      let total = 0; S.forEach(x => total += x.courses.length);
      assert.equal(got, total, 'the skipped criterion should filter nothing');
      assert.includes(r.log(), 'SKIP');
    });
  });
};
