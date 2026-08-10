/* The generated dataset.
   These are invariants, not spot checks: if the generator is ever changed or
   swapped for real data, these say what downstream code is entitled to assume. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {
  const { app } = boot();
  const S = app.STUDENTS;

  describe('catalogue', () => {
    test('every course has a code, name, subject and points', () => {
      app.COURSES.forEach(c => {
        assert.ok(/^[A-Z]{4}\d{3}$/.test(c.code), 'malformed code: ' + c.code);
        assert.ok(c.name && c.name.length > 3, 'missing name for ' + c.code);
        assert.equal(c.subject, c.code.slice(0, 4), 'subject must derive from the code');
        assert.ok(c.points > 0, 'points must be positive');
      });
    });

    test('course codes are unique', () => {
      const codes = app.COURSES.map(c => c.code);
      assert.equal(new Set(codes).size, codes.length);
    });

    test('subjects are derived from codes, not hardcoded', () => {
      const fromCodes = [...new Set(app.COURSES.map(c => c.code.slice(0, 4)))];
      assert.equal(app.SUBJECTS.length, fromCodes.length);
      fromCodes.forEach(s => assert.includes(app.SUBJECTS, s));
    });

    test('every catalogue course is looked up by code', () => {
      app.COURSES.forEach(c => assert.ok(app.COURSE_BY_CODE[c.code], 'not indexed: ' + c.code));
    });
  });

  describe('students', () => {
    test('the cohort is non-empty', () => assert.ok(S.length > 0));

    test('student ids are unique', () => {
      assert.equal(new Set(S.map(s => s.id)).size, S.length);
    });

    test('every student carries exactly the expected number of courses', () => {
      S.forEach(s => assert.equal(s.courses.length, app.COURSES_PER_YEAR,
        'student ' + s.id + ' has ' + s.courses.length));
    });

    test('a student never takes the same course twice', () => {
      S.forEach(s => {
        const codes = s.courses.map(c => c.code);
        assert.equal(new Set(codes).size, codes.length, 'duplicate course for ' + s.id);
      });
    });

    test('every enrolment references a real catalogue course', () => {
      S.forEach(s => s.courses.forEach(c => {
        const cat = app.COURSE_BY_CODE[c.code];
        assert.ok(cat, 'unknown course ' + c.code);
        assert.equal(c.name, cat.name);
        assert.equal(c.subject, cat.subject);
      }));
    });

    test('gradeAvg is the mean of the course marks, not a separate figure', () => {
      S.forEach(s => {
        const mean = s.courses.reduce((a, c) => a + c.mark, 0) / s.courses.length;
        assert.equal(s.gradeAvg, Math.round(mean),
          'student ' + s.id + ': stored ' + s.gradeAvg + ' vs computed ' + mean);
      });
    });

    test('marks stay within a plausible range', () => {
      S.forEach(s => s.courses.forEach(c => {
        assert.ok(c.mark >= 0 && c.mark <= 100, 'mark out of range: ' + c.mark);
      }));
    });

    test('letter grades agree with the numeric marks', () => {
      const band = m => m >= 90 ? 'A+' : m >= 85 ? 'A' : m >= 80 ? 'A-' : m >= 75 ? 'B+'
                     : m >= 70 ? 'B' : m >= 65 ? 'B-' : m >= 60 ? 'C+' : m >= 55 ? 'C' : 'D';
      S.forEach(s => {
        assert.equal(s.letterGrade, band(s.gradeAvg), 'student ' + s.id);
        s.courses.forEach(c => assert.equal(c.letterGrade, band(c.mark), c.code));
      });
    });

    test('every enrolment year matches the student year', () => {
      S.forEach(s => s.courses.forEach(c => assert.equal(c.year, s.year)));
    });

    test('specialisations all come from the declared list', () => {
      S.forEach(s => assert.includes(app.SPECS, s.specialisation));
    });
  });

  describe('generation properties', () => {
    test('core courses are taken by everybody', () => {
      app.CORE_COURSES.forEach(code => {
        const takers = S.filter(s => s.courses.some(c => c.code === code)).length;
        assert.equal(takers, S.length, code + ' taken by ' + takers + ' of ' + S.length);
      });
    });

    test('the whole catalogue is exercised, so no course is untestable', () => {
      const used = new Set();
      S.forEach(s => s.courses.forEach(c => used.add(c.code)));
      assert.equal(used.size, app.COURSES.length,
        'unused: ' + app.COURSES.map(c => c.code).filter(c => !used.has(c)).join(','));
    });

    test('specialisation biases course choice rather than randomising it', () => {
      // Read the intended bias out of the generator's own preference table, so
      // this keeps testing the real relationship if the catalogue changes.
      const spec = 'Software Engineering';
      const preferred = { 'Software Engineering': 'SWEN', 'Cybersecurity': 'CYBR',
                          'Artificial Intelligence': 'AIML' };
      Object.keys(preferred).forEach(sp => {
        const subj = preferred[sp];
        if (!app.SUBJECTS.includes(subj)) return;   // catalogue no longer has it
        const rate = list => {
          let hit = 0, total = 0;
          list.forEach(s => s.courses.forEach(c => { total++; if (c.subject === subj) hit++; }));
          return total ? hit / total : 0;
        };
        const group = S.filter(s => s.specialisation === sp);
        if (!group.length) return;
        assert.ok(rate(group) > rate(S),
          sp + ' should favour ' + subj + ': ' + rate(group).toFixed(3) + ' vs ' + rate(S).toFixed(3));
      });
    });

    test('the preference table only names subjects that exist', () => {
      // A stale entry would not throw — subjectWeight() returns 1 for anything
      // unlisted — so removing a subject from the catalogue without updating
      // this table would silently flatten the bias into noise.
      Object.keys(app.SPEC_SUBJECTS).forEach(spec => {
        app.SPEC_SUBJECTS[spec].forEach(subj => {
          assert.includes(app.SUBJECTS, subj,
            spec + ' prefers "' + subj + '", which is not in the catalogue');
        });
      });
    });

    test('every specialisation has a preference entry', () => {
      app.SPECS.forEach(sp => assert.ok(app.SPEC_SUBJECTS[sp],
        'no subject preferences for ' + sp + ' — its students would pick at random'));
    });

    test('preference ranking translates into real weights', () => {
      const spec = app.SPECS[0];
      const prefs = app.SPEC_SUBJECTS[spec];
      for (let i = 1; i < prefs.length; i++) {
        assert.ok(app.subjectWeight(spec, prefs[i - 1]) > app.subjectWeight(spec, prefs[i]),
          'rank ' + i + ' should outweigh rank ' + (i + 1));
      }
      const unlisted = app.SUBJECTS.find(x => prefs.indexOf(x) === -1);
      if (unlisted) {
        assert.ok(app.subjectWeight(spec, unlisted) < app.subjectWeight(spec, prefs[prefs.length - 1]),
          'an unlisted subject should be the least likely, but still possible');
        assert.ok(app.subjectWeight(spec, unlisted) > 0, 'never impossible — cohorts should overlap');
      }
    });

    test('the withdrawn subjects stay withdrawn', () => {
      /* COMP, NWEN and DATA were deliberately removed from the catalogue. This
         is a regression guard, not a rule about the domain: without it, pasting
         a course back in would go unnoticed, because every other test derives
         its subject from whatever the catalogue happens to contain. If these
         subjects are ever reinstated, delete this test rather than working
         around it. */
      ['COMP', 'NWEN', 'DATA'].forEach(prefix => {
        assert.excludes(app.SUBJECTS, prefix, prefix + ' is back in the subject list');
        const offenders = app.COURSES.filter(c => c.code.indexOf(prefix) === 0).map(c => c.code);
        assert.deepEqual(offenders, [], prefix + ' courses are back: ' + offenders.join(','));
      });
    });

    test('no student holds an enrolment in a withdrawn subject', () => {
      const gone = ['COMP', 'NWEN', 'DATA'];
      S.forEach(s => s.courses.forEach(c => {
        assert.excludes(gone, c.subject, 'student ' + s.id + ' still holds ' + c.code);
      }));
    });

    test('no subject is removed from the catalogue without leaving courses behind', () => {
      app.SUBJECTS.forEach(subj => {
        assert.ok(app.COURSES.some(c => c.subject === subj), 'empty subject: ' + subj);
      });
    });

    test('generation is deterministic across instances', () => {
      const second = boot().app.STUDENTS;
      assert.equal(second.length, S.length);
      assert.deepEqual(second.map(s => s.id + ':' + s.gradeAvg),
                       S.map(s => s.id + ':' + s.gradeAvg));
      assert.deepEqual(second[0].courses.map(c => c.code + c.mark),
                       S[0].courses.map(c => c.code + c.mark));
    });

    test('more than one year is present', () => {
      assert.ok(app.YEARS.length >= 2, 'years: ' + app.YEARS.join(','));
    });
  });
};
