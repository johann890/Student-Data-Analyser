/* The generated dataset.
   These are invariants, not spot checks: if the generator is ever changed or
   swapped for real data, these say what downstream code is entitled to assume. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {
  const { app } = boot();
  const S = app.STUDENTS;

  /* THE GRADE MODEL
     Tested directly rather than through the generated data, because the
     generator never produces an ungraded enrolment and the archive is full of
     them: every dropped course carries a blank Grade. These are the assertions
     the file parser will rely on, so they are pinned before it exists. */
  describe('the grade model', () => {
    const e = (g, pts) => ({ letterGrade: g, points: pts === undefined ? 15 : pts });

    test('the scale is the university\'s nine points, fails all worth zero', () => {
      assert.equal(app.gradePoint('A+'), 9);
      assert.equal(app.gradePoint('C-'), 1);
      ['D', 'E', 'K'].forEach(g => assert.equal(app.gradePoint(g), 0, g));
    });

    test('anything not on the scale has no grade point — null, not zero', () => {
      // A blank Grade is the archive's ungraded marker and appears on every
      // dropped course. Zero would be a claim about attainment; null is not.
      ['', ' ', undefined, null, '?', 'WD'].forEach(g =>
        assert.equal(app.gradePoint(g), null, JSON.stringify(g)));
    });

    test('surrounding whitespace does not hide a grade', () => {
      assert.equal(app.gradePoint(' A- '), 7, 'tab-separated fields arrive padded');
    });

    test('the GPA is weighted by course points, not a plain mean', () => {
      // The university's own worked example: A+ over 15 points and B+ over 30
      // is 315/45 = 7.0. A plain mean would say 7.5.
      assert.equal(app.gpaOf([e('A+', 15), e('B+', 30)]), 7);
      assert.ok(app.gpaOf([e('A+', 15), e('B+', 30)]) !== 7.5, '7.5 is the unweighted answer');
    });

    test('ungraded enrolments are left out rather than counted as zero', () => {
      // Two As and a course still in progress is an A average, not a B.
      assert.equal(app.gpaOf([e('A'), e('A'), e('')]), 8);
      assert.equal(app.gpaOf([e('A'), e('A'), e('D')]), 5.33, 'a real D does count');
    });

    test('a zero-point course cannot drag the average anywhere', () => {
      // Dropped courses carry Pts=0 in the archive, so the weighting already
      // neutralises them even before the blank grade does.
      assert.equal(app.gpaOf([e('A', 15), e('D', 0)]), 8);
    });

    test('nothing graded means no GPA at all', () => {
      assert.equal(app.gpaOf([e(''), e('')]), null);
      assert.equal(app.gpaOf([]), null);
    });

    test('a GPA reads back as the letter for its nearest whole point', () => {
      assert.equal(app.gradeFromGpa(7), 'A-', 'a 7.0 average is an A-');
      assert.equal(app.gradeFromGpa(6.75), 'A-');
      assert.equal(app.gradeFromGpa(6.25), 'B+');
      assert.equal(app.gradeFromGpa(null), '', 'no GPA is not a D');
    });
  });

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

    test('gpa is the points-weighted mean of the course grades, not a separate figure', () => {
      /* The university's own formula: sum(gradePoint x points) / sum(points).
         Weighted, so a 30-point course counts twice a 15-point one — which is
         the part a plain mean would get wrong. */
      S.forEach(s => {
        let pts = 0, weighted = 0;
        s.courses.forEach(c => { pts += c.points; weighted += c.gradePoints * c.points; });
        const want = Math.round((weighted / pts) * 100) / 100;
        assert.equal(s.gpa, want,
          'student ' + s.id + ': stored ' + s.gpa + ' vs computed ' + want);
      });
    });

    test('grade points stay on the nine-point scale', () => {
      S.forEach(s => s.courses.forEach(c => {
        assert.ok(c.gradePoints >= 0 && c.gradePoints <= 9,
          'grade point off the scale: ' + c.gradePoints);
      }));
    });

    test('every letter grade is one the scale knows, and its points agree', () => {
      /* The letter and the number must never disagree: the number is what gets
         averaged and the letter is what gets read, and a student whose B was
         worth 7 would be a different student depending on which column you
         looked at. */
      S.forEach(s => {
        s.courses.forEach(c => {
          assert.ok(app.GRADE_ORDER.includes(c.letterGrade), 'unknown grade ' + c.letterGrade);
          assert.equal(c.gradePoints, app.GRADE_POINTS[c.letterGrade], c.code);
        });
        // The student's own letter is their GPA read back, to the nearest point.
        assert.equal(s.letterGrade, app.gradeFromGpa(s.gpa), 'student ' + s.id);
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
      assert.deepEqual(second.map(s => s.id + ':' + s.gpa),
                       S.map(s => s.id + ':' + s.gpa));
      assert.deepEqual(second[0].courses.map(c => c.code + c.letterGrade),
                       S[0].courses.map(c => c.code + c.letterGrade));
    });

    test('more than one year is present', () => {
      assert.ok(app.YEARS.length >= 2, 'years: ' + app.YEARS.join(','));
    });
  });
};
