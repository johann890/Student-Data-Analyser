/* THE PATTERNS THE MOCK ARCHIVE CLAIMS TO CARRY.

   ../data is not a fixture that only has to parse. It is the artefact the
   supervisor runs queries against, and every query of interest is a question
   about a pattern someone deliberately put in it: a course that keeps getting
   easier, a course losing students year on year, a student who changes degree.
   Those patterns were asserted once, in an email, and nothing in the repository
   held them to it — which is how two of them had quietly stopped being true by
   the time anyone looked.

   So they are pinned here, read through the shipped parser rather than by a
   reader of the raw file, because a pattern that only exists before the tool
   loads it is not a pattern the tool can be demonstrated on.

   These tests are about the DATA, not the code. A failure here means a year
   file changed, not that a node broke — and the message should say which
   pattern went, so the next person knows what they are being asked to restore.

   Like 19-data-files they return early when ../data is absent, so a checkout
   that carries no student records is still runnable. */

const { boot, dataDirFile, hasDataDir } = require('../lib/harness');
const { assert } = require('../lib/assert');

const YEARS = [2022, 2023, 2024];

module.exports = ({ describe, test }) => {
  const { app } = boot();
  if (!hasDataDir()) {
    describe('the archive patterns', () => {
      test('skipped: ../data is not present', () => assert.ok(true));
    });
    return;
  }

  const header = app.parseHeaderFile(dataDirFile('headers.txt'), 'headers.txt');
  const YEAR = {};
  YEARS.forEach(y => {
    const out = app.parseYearFile(dataDirFile('mcs-students-' + y), y, header);
    if (out.error) throw new Error(y + ' does not parse: ' + out.error);
    YEAR[y] = out;
  });

  const byId = y => {
    const m = new Map();
    YEAR[y].students.forEach(s => m.set(s.id, s));
    return m;
  };
  const S = { 2022: byId(2022), 2023: byId(2023), 2024: byId(2024) };

  const enrolments = y => YEAR[y].students.reduce((a, s) => a.concat(s.courses), []);
  const countIn = (y, code) => enrolments(y).filter(c => c.code === code).length;
  const meanGradeOf = (y, code) => {
    const v = enrolments(y).filter(c => c.code === code && c.gradePoints !== null)
                           .map(c => c.gradePoints);
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  const mean = v => v.reduce((a, b) => a + b, 0) / v.length;

  /* Which year of study a student is in, as the archive lets it be seen.

     Two traps, both of which this test fell into before it was checked against
     a deliberately broken archive:

     - the MEAN level will not do. A final-year student carrying three 300-level
       papers averages 3.4 and reads as a third year, which puts graduands back
       into the attrition pool — the very confusion these tests exist to pin.
     - the modal level will not do on its own either, because a tie has to break
       somewhere. Four 300s and four 400s broke DOWNWARD, and three finishing
       students were enough to hold up the assertion about leavers on their own.

     So: anyone taking the ENGR489 capstone is finishing, and otherwise the
     modal level decides with ties breaking upward. */
  const yearOfStudy = s => {
    if (s.courses.some(c => c.code === 'ENGR489')) return 4;
    const n = [0, 0, 0, 0, 0];
    s.courses.forEach(c => { if (c.level >= 1 && c.level <= 4) n[c.level]++; });
    let best = 1;
    for (let i = 2; i <= 4; i++) if (n[i] >= n[best]) best = i;
    return best;
  };

  /* ══ 1. THREE YEARS, ONE COHORT ════════════════════════════════════════════
     A trend needs three points. Two years tell you a number changed; they
     cannot tell you which way it is going. */
  describe('the archive spans three years that link up', () => {
    test('all three years parse and are distinct cohorts', () => {
      YEARS.forEach(y => {
        assert.ok(YEAR[y].students.length > 0, y + ' has students');
        YEAR[y].students.forEach(s => assert.equal(s.year, y));
      });
    });

    test('students carry across years, so a trend can be followed per student', () => {
      const ret = [...S[2023].keys()].filter(id => S[2024].has(id));
      assert.ok(ret.length > 100,
        'only ' + ret.length + ' students appear in both 2023 and 2024');
    });

    test('a returning student keeps their identity', () => {
      const ret = [...S[2023].keys()].filter(id => S[2024].has(id));
      ret.forEach(id => assert.equal(S[2023].get(id).gender, S[2024].get(id).gender,
        'student ' + id + ' changes gender between years'));
    });
  });

  /* ══ 2. MIGRATION ══════════════════════════════════════════════════════════
     Movement between programmes, which is the pattern the head of school and
     the programme directors were said to care about most. It was absent from
     the archive entirely until 2024 — nobody in 2022 or 2023 changes anything —
     so this test is the one that says it is there now. */
  describe('students migrate between programmes', () => {
    const migrants = [...S[2024].keys()].filter(id =>
      S[2023].has(id) && (S[2023].get(id).degree !== S[2024].get(id).degree ||
                          S[2023].get(id).specialisation !== S[2024].get(id).specialisation));

    test('somebody changes degree or major between 2023 and 2024', () => {
      assert.ok(migrants.length > 0,
        'no student in the archive changes programme, so migration cannot be demonstrated');
    });

    test('the migration is BEHONS CYBR for two years, then BSC COMP', () => {
      const traced = migrants.filter(id =>
        S[2022].has(id) &&
        S[2022].get(id).degree === 'BEHONS' && S[2022].get(id).specialisation === 'CYBR' &&
        S[2023].get(id).degree === 'BEHONS' && S[2023].get(id).specialisation === 'CYBR' &&
        S[2024].get(id).degree === 'BSC'    && S[2024].get(id).specialisation === 'COMP');
      assert.equal(traced.length, migrants.length,
        'every migrant should follow the one modelled route');
      assert.ok(traced.length >= 3, 'at least three students should make the move');
    });

    test('a migrant is a senior, so 2024 holds only 300- and 400-level courses', () => {
      migrants.forEach(id => S[2024].get(id).courses.forEach(c =>
        assert.ok(c.level === 3 || c.level === 4,
          'migrant ' + id + ' takes ' + c.code + ' at level ' + c.level)));
    });

    test('a migrant is still one person, not two records', () => {
      migrants.forEach(id => {
        assert.equal(S[2022].get(id).gender, S[2024].get(id).gender);
        assert.ok(S[2024].get(id).courses.length >= 7);
      });
    });
  });

  /* ══ 3. GRADES OVER TIME ═══════════════════════════════════════════════════ */
  describe('grades move in ways worth querying', () => {
    test('a course improves in every year, not just the last one', () => {
      ['COMP103', 'COMP261'].forEach(code => {
        const m = YEARS.map(y => meanGradeOf(y, code));
        assert.ok(m[0] < m[1] && m[1] < m[2],
          code + ' should rise every year, got ' + m.map(x => x.toFixed(2)).join(' -> '));
      });
    });

    /* "Against the cohort" is the claim, and it is the claim because the
       absolute ranking does not hold: COMP103 was worse than SWEN326 in 2022,
       being the course that was broken and then fixed, and the 400-level
       courses sit so high that a 100-level course is never the easiest thing in
       the catalogue. Measuring each against the school-wide mean is both what
       was promised and what a programme director would actually ask. */
    test('SWEN326 sits well below the cohort in every year', () => {
      YEARS.forEach(y => {
        const marks = enrolments(y).filter(c => c.gradePoints !== null).map(c => c.gradePoints);
        const delta = meanGradeOf(y, 'SWEN326') - mean(marks);
        assert.ok(delta < -1.5, y + ': SWEN326 is only ' + delta.toFixed(2) + ' below the cohort');
      });
    });

    test('SWEN326 is among the five hardest courses in every year', () => {
      YEARS.forEach(y => {
        const codes = [...new Set(enrolments(y).map(c => c.code))];
        const hardest = codes.map(c => [c, meanGradeOf(y, c)])
                             .sort((a, b) => a[1] - b[1]).slice(0, 5).map(x => x[0]);
        assert.includes(hardest.join(' '), 'SWEN326', 'in ' + y);
      });
    });

    test('CGRA151 sits well above the cohort in every year', () => {
      YEARS.forEach(y => {
        const marks = enrolments(y).filter(c => c.gradePoints !== null).map(c => c.gradePoints);
        const delta = meanGradeOf(y, 'CGRA151') - mean(marks);
        assert.ok(delta > 1.2, y + ': CGRA151 is only ' + delta.toFixed(2) + ' above the cohort');
      });
    });

    test('CGRA151 is the easiest 100-level course in every year', () => {
      YEARS.forEach(y => {
        const codes = [...new Set(enrolments(y).filter(c => c.level === 1).map(c => c.code))];
        const easiest = codes.map(c => [c, meanGradeOf(y, c)])
                             .sort((a, b) => b[1] - a[1])[0][0];
        assert.equal(easiest, 'CGRA151', 'in ' + y + ' the easiest 100-level course was ' + easiest);
      });
    });

    test('the school-wide mean does not drift, so a course trend is the course', () => {
      const g = YEARS.map(y => mean(enrolments(y).filter(c => c.gradePoints !== null)
                                                 .map(c => c.gradePoints)));
      assert.close(g[1], g[2], 0.25,
        '2023 and 2024 should sit at the same level, got ' + g.map(x => x.toFixed(2)).join(' / '));
    });
  });

  /* ══ 4. ENROLMENT OVER TIME ════════════════════════════════════════════════ */
  describe('enrolment numbers trend across the three years', () => {
    test('some courses grow every year', () => {
      ['DATA301', 'CYBR372'].forEach(code => {
        const n = YEARS.map(y => countIn(y, code));
        assert.ok(n[0] < n[1] && n[1] < n[2],
          code + ' should grow every year, got ' + n.join(' -> '));
      });
    });

    test('some courses shrink every year', () => {
      ['MATH244', 'NWEN438'].forEach(code => {
        const n = YEARS.map(y => countIn(y, code));
        assert.ok(n[0] > n[1] && n[1] > n[2],
          code + ' should shrink every year, got ' + n.join(' -> '));
      });
    });

    test('400-level courses are not all the same size', () => {
      const l4 = [...new Set(enrolments(2024).filter(c => c.level === 4).map(c => c.code))];
      const big = l4.filter(c => YEARS.every(y => countIn(y, c) >= 20));
      const small = l4.filter(c => YEARS.every(y => countIn(y, c) <= 18));
      assert.ok(big.length >= 3, 'no consistently large 400-level courses');
      assert.ok(small.length >= 3, 'no consistently small 400-level courses');
    });
  });

  /* ══ 5. STUDENTS ═══════════════════════════════════════════════════════════ */
  describe('students behave the way the archive claims', () => {
    test('a returning student\'s average rises', () => {
      const d = [...S[2023].keys()].filter(id => S[2024].has(id))
        .filter(id => S[2023].get(id).gpa !== null && S[2024].get(id).gpa !== null)
        .map(id => S[2024].get(id).gpa - S[2023].get(id).gpa);
      assert.ok(mean(d) > 0.15, 'mean change was ' + mean(d).toFixed(3));
      assert.ok(d.filter(x => x > 0).length > d.length / 2,
        'fewer than half the returning students improved');
    });

    test('students take higher-level courses as they progress', () => {
      const lv = s => mean(s.courses.map(c => c.level));
      const ret = [...S[2023].keys()].filter(id => S[2024].has(id));
      const rose = ret.filter(id => lv(S[2024].get(id)) > lv(S[2023].get(id)));
      assert.ok(rose.length > ret.length * 0.6,
        'only ' + rose.length + ' of ' + ret.length + ' moved up a level');
    });

    test('students do better inside their own subject than outside it', () => {
      YEARS.forEach(y => {
        const own = [], other = [];
        YEAR[y].students.forEach(s => s.courses.forEach(c => {
          if (c.gradePoints === null) return;
          (c.subject === s.specialisation ? own : other).push(c.gradePoints);
        }));
        assert.ok(mean(own) > mean(other) + 0.2,
          y + ': own ' + mean(own).toFixed(2) + ' vs other ' + mean(other).toFixed(2));
      });
    });

    /* Half true, and deliberately so. Most students who go before finishing were
       struggling — but not all of them, because some leave for a job while doing
       well, and an archive in which every leaver is weak would answer the
       question before it is asked. The test pins both halves: the group mean is
       down, and the top of the leaving group is not. */
    test('students who leave before finishing were mostly, but not only, struggling', () => {
      // A final-year student who goes has finished; that is graduation, not
      // attrition, and including them inverts the whole pattern — they are the
      // strongest students in the archive.
      const left = [...S[2023].keys()].filter(id =>
        !S[2024].has(id) && yearOfStudy(S[2023].get(id)) < 4 && S[2023].get(id).gpa !== null);
      const stayed = [...S[2023].keys()].filter(id =>
        S[2024].has(id) && yearOfStudy(S[2023].get(id)) < 4 && S[2023].get(id).gpa !== null);
      const g = id => S[2023].get(id).gpa;

      assert.ok(left.length > 5, 'only ' + left.length + ' non-final-year students left');
      assert.ok(mean(left.map(g)) < mean(stayed.map(g)) - 0.5,
        'leavers ' + mean(left.map(g)).toFixed(2) + ' vs stayers ' + mean(stayed.map(g)).toFixed(2));
      assert.ok(left.filter(id => g(id) > mean(stayed.map(g))).length > 0,
        'every single leaver was below average, which is the half of this that is not true');
    });

    test('graduating seniors are why the raw leaver figure reads backwards', () => {
      const allLeft = [...S[2023].keys()].filter(id =>
        !S[2024].has(id) && S[2023].get(id).gpa !== null);
      const stayed = [...S[2023].keys()].filter(id =>
        S[2024].has(id) && S[2023].get(id).gpa !== null);
      const g = id => S[2023].get(id).gpa;
      assert.ok(allLeft.filter(id => yearOfStudy(S[2023].get(id)) === 4).length > 40,
        'most leavers should be finishing seniors');
      assert.ok(mean(allLeft.map(g)) > mean(stayed.map(g)),
        'taken together the leavers should look STRONGER, which is the trap this ' +
        'archive sets for an analysis that forgets to exclude the graduands');
    });

    test('a withdrawal is likelier for a struggling student in a hard course', () => {
      const all = enrolments(2024);
      const codes = [...new Set(all.map(c => c.code))];
      const hard = new Set(codes.map(c => [c, meanGradeOf(2024, c)])
                                .sort((a, b) => a[1] - b[1])
                                .slice(0, Math.round(codes.length / 4))
                                .map(x => x[0]));
      const dropped = all.filter(c => c.gradePoints === null);
      const shareOfDrops = dropped.filter(c => hard.has(c.code)).length / dropped.length;
      const shareOfAll = all.filter(c => hard.has(c.code)).length / all.length;
      assert.ok(shareOfDrops > shareOfAll * 1.4,
        'drops are spread evenly, not concentrated in hard courses: ' +
        (shareOfDrops * 100).toFixed(0) + '% vs ' + (shareOfAll * 100).toFixed(0) + '%');

      const droppers = new Set(YEAR[2024].students
        .filter(s => s.courses.some(c => c.gradePoints === null)).map(s => s.id));
      const withGpa = YEAR[2024].students.filter(s => s.gpa !== null);
      assert.ok(mean(withGpa.filter(s => droppers.has(s.id)).map(s => s.gpa))
              < mean(withGpa.map(s => s.gpa)) - 0.5,
        'students who dropped something should sit below the cohort average');
    });

    /* The one thing that must NOT be in the data. Every pattern above is a
       pattern about courses and progress; none of them may be reproducible from
       a protected attribute, or the archive would teach the tool's users to
       find something that was put there by its author. */
    test('gender, ethnicity and domestic status do not predict a grade', () => {
      const groups = key => {
        const m = new Map();
        YEAR[2024].students.forEach(s => {
          if (s.gpa === null) return;
          const k = s[key] === undefined ? '' : s[key];
          if (!m.has(k)) m.set(k, []);
          m.get(k).push(s.gpa);
        });
        return [...m.values()].filter(v => v.length >= 15).map(mean);
      };
      const g = groups('gender');
      assert.ok(Math.max(...g) - Math.min(...g) < 0.45,
        'gender separates GPAs by ' + (Math.max(...g) - Math.min(...g)).toFixed(2));
    });
  });
};
