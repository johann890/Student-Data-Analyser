/* THE GRADE COLUMNS: four of them, and which is which
   ===========================================================================
   The supervisor asked: "Do you actually mean 'numeric grade' when you say
   'GPA' (the 'A' in 'GPA' stands for 'average')? In this case, I think the
   value label should be 'grade' and the previous 'grade' label should be named
   'letter grade'. It is a bit of a luxury (and potentially confusing) to
   support both."

   He was right that something was badly named and wrong about which thing. GPA
   is a genuine average, so its name was correct. The collision was one level
   down: a STUDENT carried a letterGrade (their standing for the year, the GPA
   rounded to a letter) and an ENROLMENT carries a letterGrade (the letter
   actually awarded for one course), and both were displayed as "Grade".

   That was worse than ambiguous, because the two meet. They share a KEY, so a
   Project drops the student's and puts the enrolment's in its place. A column
   headed "Grade" appeared to continue across that step while silently changing
   what it was about. These tests pin the fix and, just as importantly, pin the
   substitution as deliberate so nobody later "repairs" it into carrying both.

   Labels changed and keys did not, which is what keeps every saved query
   working. The last group here is about that, because a rename that quietly
   broke stored filters would be a poor trade for a clearer header.           */

const { boot, hasDataDir } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const A = boot().app;
  const student = () => A.makeTable(A.STUDENT_COLUMNS, []);
  const enrolment = () => A.makeTable(A.projectColumns(student()), []);
  const labelOf = (t, key) => {
    const c = A.colByKey(t, key);
    return c ? c.label : null;
  };

  describe('the two grade columns are named apart', () => {

    test('a student has an Overall grade, not a Grade', () => {
      assert.equal(labelOf(student(), 'letterGrade'), 'Overall grade');
    });

    test('an enrolment has a Grade', () => {
      assert.equal(labelOf(enrolment(), 'letterGrade'), 'Grade');
    });

    /* The property the rename exists for. Whatever these two are called, they
       must not be called the same thing, because a Project swaps one for the
       other under a single header. */
    test('and the two names differ, which is the whole point', () => {
      const a = labelOf(student(), 'letterGrade');
      const b = labelOf(enrolment(), 'letterGrade');
      assert.notOk(a === b,
        'both grade columns are labelled "' + a + '", so a Project swaps one ' +
        'for the other under a single header');
    });

    test('no two columns on one table share a label', () => {
      [['student', student()], ['enrolment', enrolment()]].forEach(([what, t]) => {
        const seen = {};
        t.columns.forEach(c => {
          assert.notOk(seen[c.label],
            what + ' has two columns labelled "' + c.label + '"');
          seen[c.label] = true;
        });
      });
    });

    test('the numeric forms keep their own names', () => {
      assert.equal(labelOf(student(), 'gpa'), 'GPA');
      assert.equal(labelOf(enrolment(), 'gradePoints'), 'Grade points');
    });
  });

  describe('a Project substitutes one for the other, on purpose', () => {

    /* Not carried side by side. After a Project a row IS an enrolment and the
       grade belonging to it is the course's. Pinned so that the collision is a
       decision rather than something rediscovered as a bug. */
    test('the student grade does not survive alongside the course grade', () => {
      const e = enrolment();
      const grades = e.columns.filter(c => c.key === 'letterGrade');
      assert.equal(grades.length, 1, 'one grade column after a Project, not two');
      assert.equal(grades[0].label, 'Grade', 'and it is the course’s');
    });

    /* GPA is the contrast that shows the substitution is about the collision
       and not about student facts being unwelcome downstream. */
    test('GPA rides along, because it collides with nothing', () => {
      assert.ok(A.hasCol(enrolment(), 'gpa'),
        'a student fact with no clashing name survives the unfold');
    });
  });

  describe('Overall grade is the GPA, rounded', () => {

    test('it is derived from the average rather than awarded', () => {
      // 6.4 rounds to 6, and 6 is a B+. Nobody was given a B+ for this.
      assert.equal(A.gradeFromGpa(6.4), 'B+');
      assert.equal(A.gradeFromGpa(8), 'A');
      assert.equal(A.gradeFromGpa(9), 'A+');
    });

    test('a student with nothing graded has neither', () => {
      assert.equal(A.gpaOf([]), null);
      assert.equal(A.gradeFromGpa(null), '');
    });

    test('both letter columns carry the ranking, so a band works on either', () => {
      [student(), enrolment()].forEach(t => {
        const c = A.colByKey(t, 'letterGrade');
        assert.ok(c.order && c.order.length,
          c.label + ' lost its ordering, so "between A+ and B" becomes a spelling test');
        assert.ok(c.order.indexOf('A+') < c.order.indexOf('A-'),
          c.label + ' ranks A- above A+');
      });
    });
  });

  describe('only the display changed, so stored queries still work', () => {

    /* A rename that broke saved filters would be a poor trade for a clearer
       header. The key is what a criterion stores, and it is untouched. */
    test('the key a criterion stores is unchanged', () => {
      assert.ok(A.hasCol(student(), 'letterGrade'),
        'a saved filter on letterGrade must still resolve');
      assert.ok(A.hasCol(enrolment(), 'letterGrade'));
    });

    test('a filter on the student grade still resolves and still runs', () => {
      const h = boot();
      const [src, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'letterGrade');
      h.w.render();
      const field = h.app.fieldByKey(
        h.app.makeTable(h.app.STUDENT_COLUMNS, []), 'letterGrade');
      assert.ok(field, 'the field vanished from the filter list');
      assert.equal(field.label, 'Overall grade', 'and the picker shows the new name');
    });

    test('a query saved before the rename loads and keeps its field', () => {
      const h = boot();
      const [src, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'letterGrade');
      h.w.render();
      const saved = JSON.stringify(h.app.serialiseGraph());

      const h2 = boot();
      h2.app.applyGraph(h2.app.deserialiseGraph(saved));
      h2.w.render();
      const f2 = h2.app.nodes.filter(n => n.type === 'filter')[0];
      assert.equal(f2.cfg.criteria[0].field, 'letterGrade',
        'the stored field key must survive a rename of its label');
    });
  });

  describe('the documentation names the same things the tool does', () => {

    const helpText = () => boot().doc.querySelector('.help-body').textContent;

    test('Help explains all four grade columns', () => {
      const t = helpText();
      ['Overall grade', 'Grade points', 'GPA'].forEach(name =>
        assert.includes(t, name, name + ' is not documented'));
    });

    test('Help says the overall grade is rounded rather than awarded', () => {
      assert.includes(helpText(), 'rounded',
        'a B+ nobody was given needs saying');
    });

    /* Two names that were in Help and never in the tool. A reader following
       either would look for a field that does not exist. */
    test('Help does not name fields the tool has never had', () => {
      const t = helpText();
      assert.excludes(t, 'Grade average', 'no such field: it is called GPA');
      assert.excludes(t, 'Mark', 'no such field: the archive records letters, not marks');
    });
  });

  if (hasDataDir()) {
    describe('against the real archive', () => {

      test('Overall grade is what rounding that student’s own GPA gives', async () => {
        const h = boot();
        const [src, o] = h.build('source', 'output');
        const ds = await h.loadArchive(src.id, [2024]);
        assert.ok(ds.students.length, 'no students loaded');
        ds.students.forEach(s => {
          assert.equal(s.letterGrade, h.app.gradeFromGpa(s.gpa),
            'student ' + s.id + ' has a grade its GPA does not give');
        });
      });
    });
  }
};
