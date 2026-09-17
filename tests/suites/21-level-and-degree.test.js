/* COURSE LEVEL AND DEGREE.

   Two columns the archive was carrying all along and the tool was throwing on
   the floor, because the built-in dataset was a single honours year on a single
   programme and neither fact varied in it.

   Both vary in the real thing. 2022 alone holds 697 enrolments at 100-level
   against 454 at 400-level, and its 280 students are spread across BEHONS, BSC
   and BCA. Averaging a 100-level and a 400-level course together without being
   able to see the difference is an answer that is wrong without looking wrong,
   which is the reason this exists.

   The suite has three jobs:

     - pin what `level` and `degree` ARE, against the archive rather than against
       a fixture;
     - exercise the filter and the unfold that make them answerable, including
       the progression question that use cases (h) and (i) were waiting on;
     - guard the two positional-array bugs this change actually caused, because
       both were silent and both produced plausible-looking wrong answers. */

const { boot, dataDirFile, hasDataDir } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {
  const t = boot();
  const { app, w, doc } = t;
  const A = app;

  function reset() { w.clearAll(); app.clearAllSourceData(); }

  async function archiveSource(years) {
    reset();
    const made = t.build('source', 'output');
    await t.loadArchive(made[0].id, years || [2022]);
    return made;
  }

  /* ══ 1. WHAT A LEVEL IS ════════════════════════════════════════════════════
     Derived from the code, because the archive has no level column and the code
     is the only place the fact lives. */
  describe('the level is read out of the course code', () => {
    test('the first digit is the level', () => {
      assert.equal(A.courseLevel('SWEN421'), 4);
      assert.equal(A.courseLevel('CGRA151'), 1);
      assert.equal(A.courseLevel('COMP261'), 2);
      assert.equal(A.courseLevel('DATA301'), 3);
    });

    test('a trailing letter does not confuse it', () => {
      assert.equal(A.courseLevel('MATH261A'), 2);
    });

    test('a code with no digits has no level, rather than a wrong one', () => {
      [null, undefined, '', 'SWEN', 'no digits here'].forEach(c =>
        assert.equal(A.courseLevel(c), null, JSON.stringify(c)));
    });

    test('every code in the archive yields a level in 1 to 4', function () {
      if (!hasDataDir()) return;
      const seen = {};
      dataDirFile('mcs-students-2022').split('\n').filter(l => l.trim()).forEach(l => {
        const lv = A.courseLevel(l.split('\t')[9]);
        assert.ok(lv >= 1 && lv <= 4, l.split('\t')[9] + ' gave ' + lv);
        seen[lv] = true;
      });
      assert.deepEqual(Object.keys(seen).map(Number).sort(), [1, 2, 3, 4],
        'the archive is not the honours-only year the generator pretended');
    });
  });

  /* ══ 2. WHAT REACHES THE MODEL ═════════════════════════════════════════════ */
  describe('both columns survive the parser', () => {
    test('a parsed enrolment carries its level', function () {
      if (!hasDataDir()) return;
      const h = A.parseHeaderFile(dataDirFile('headers.txt'), 'headers.txt');
      const out = A.parseYearFile(dataDirFile('mcs-students-2022'), 2022, h);
      const s = out.students.find(x => x.id === 300107735);
      assert.ok(s, 'the first student in the file');
      assert.deepEqual(s.courses.map(c => c.code + ':' + c.level),
        ['AIML427:4', 'CGRA151:1', 'CYBR372:3', 'CYBR474:4',
         'ENGR489:4', 'NWEN438:4', 'SWEN422:4'],
        'one student really does span a 100-level and four 400-level courses');
    });

    test('a parsed student carries their degree', function () {
      if (!hasDataDir()) return;
      const h = A.parseHeaderFile(dataDirFile('headers.txt'), 'headers.txt');
      const out = A.parseYearFile(dataDirFile('mcs-students-2022'), 2022, h);
      assert.equal(out.students.find(x => x.id === 300107735).degree, 'BEHONS');
      const spread = {};
      out.students.forEach(s => { spread[s.degree] = (spread[s.degree] || 0) + 1; });
      assert.deepEqual(spread, { BEHONS: 129, BSC: 110, BCA: 41 },
        'three programmes, where the built-in dataset had one');
    });

    test('the column file must now declare deg1, since the tool reads it', () => {
      const p = A.parseHeaderFile('ID gender maj1 Year Crse Grade Pts x y', 'headers.txt');
      assert.ok(p.error);
      assert.includes(p.error, 'deg1');
    });

    test('the archive header still passes', function () {
      if (!hasDataDir()) return;
      assert.notOk(A.parseHeaderFile(dataDirFile('headers.txt'), 'headers.txt').error);
    });

    test('the generator produces the same two fields, or the paths diverge', function () {
      if (!hasDataDir()) return;
      const h = A.parseHeaderFile(dataDirFile('headers.txt'), 'headers.txt');
      const real = A.parseYearFile(dataDirFile('mcs-students-2022'), 2022, h).students[0];
      const syn = A.syntheticDataset().students[0];
      assert.deepEqual(Object.keys(real).sort(), Object.keys(syn).sort());
      assert.deepEqual(Object.keys(real.courses[0]).sort(),
                       Object.keys(syn.courses[0]).sort());
      assert.ok(syn.degree, 'the synthetic student has a degree too');
      assert.equal(syn.courses[0].level, 4, 'its catalogue is a 400-level honours year');
    });
  });

  /* ══ 3. THE REGISTRIES ═════════════════════════════════════════════════════ */
  describe('the registries pick both up', () => {
    test('DEGREES and LEVELS are the union of what is loaded', async () => {
      if (!hasDataDir()) return;
      reset();
      const s = t.add('source');
      w.render();
      await t.loadArchive(s.id, [2022]);
      assert.includes(A.DEGREES, 'BEHONS');
      assert.includes(A.DEGREES, 'BSC');
      assert.includes(A.DEGREES, 'BCA');
      assert.deepEqual(A.LEVELS.slice().sort(), [1, 2, 3, 4]);
    });

    test('they empty out with the data', async () => {
      if (!hasDataDir()) return;
      reset();
      const s = t.add('source');
      w.render();
      await t.loadArchive(s.id, [2022]);
      app.setSyntheticDataset(null);
      try {
        app.clearSourceData(s.id);
        assert.deepEqual(A.DEGREES, []);
        assert.deepEqual(A.LEVELS, []);
      } finally {
        app.installSyntheticDataset();
      }
    });

    test('the course catalogue carries the level too', async () => {
      if (!hasDataDir()) return;
      reset();
      const s = t.add('source');
      w.render();
      await t.loadArchive(s.id, [2022]);
      assert.equal(A.COURSE_BY_CODE['CGRA151'].level, 1);
      assert.equal(A.COURSE_BY_CODE['ENGR489'].level, 4);
    });
  });

  /* ══ 4. THE SCHEMA, AND THE TWO BUGS THIS CHANGE CAUSED ════════════════════
     Both were positional arrays written beside a column list and drifting from
     it. Neither threw. One made a Filter on Specialisation read grades; the
     other made Grade points hold a letter. These are the guards. */
  describe('a row is built from the column list, not beside it', () => {
    test('a student row has one cell per student column, by key', () => {
      const table = A.studentsTable(A.STUDENTS);
      assert.equal(table.columns.length, A.STUDENT_COLUMNS.length);
      table.rows.forEach(r => assert.equal(r.length, table.columns.length));

      // The cell under each column really is that column's value, which is the
      // part a matching length does not prove.
      const s = A.STUDENTS[0];
      A.STUDENT_COLUMNS.forEach(c =>
        assert.deepEqual(A.cellAt(table, table.rows[0], c.key), s[c.key], c.key));
    });

    test('Degree is in the schema and reaches the cell', () => {
      const table = A.studentsTable(A.STUDENTS);
      assert.ok(A.hasCol(table, 'degree'));
      assert.equal(A.colByKey(table, 'degree').type, A.COLTYPE.ENUM);
      assert.equal(A.cellAt(table, table.rows[0], 'degree'), A.STUDENTS[0].degree);
    });

    test('an unfolded row has one cell per enrolment column, by key', () => {
      reset();
      const [s, p, o] = t.build('source', 'project', 'output');
      w.runQuery();
      const table = t.entry(o.id).table;
      table.rows.forEach(r => assert.equal(r.length, table.columns.length));

      // Read back through the column keys, against the enrolment it came from.
      const first = A.STUDENTS[0].courses[0];
      A.enrolmentKeys().forEach(k => {
        if (!A.hasCol(table, k)) return;
        assert.deepEqual(A.cellAt(table, table.rows[0], k), first[k], k);
      });
      assert.ok(s && p, 'the graph is wired');
    });

    test('the enrolment keys and the enrolment columns are one list', () => {
      assert.deepEqual(A.enrolmentKeys(), A.enrolmentColumns().map(c => c.key),
        'two lists in the same order is how they drifted the first time');
    });

    test('Level lands under Level, not under whatever follows Subject', () => {
      reset();
      const [s, p, o] = t.build('source', 'project', 'output');
      w.runQuery();
      const table = t.entry(o.id).table;
      assert.ok(A.hasCol(table, 'level'));
      assert.equal(A.colByKey(table, 'level').type, A.COLTYPE.NUMBER);
      table.rows.forEach(r => {
        const lv = A.cellAt(table, r, 'level');
        const code = A.cellAt(table, r, 'code');
        assert.equal(lv, A.courseLevel(code), code);
      });
      assert.ok(s && p);
    });

    test('and the columns after it are still themselves', () => {
      // The symptom of the bug that was here: Grade points held a letter and
      // Grade held nothing at all.
      reset();
      const [s, p, o] = t.build('source', 'project', 'output');
      w.runQuery();
      const table = t.entry(o.id).table;
      table.rows.slice(0, 40).forEach(r => {
        const gp = A.cellAt(table, r, 'gradePoints');
        const lg = A.cellAt(table, r, 'letterGrade');
        assert.ok(typeof gp === 'number' || gp === null, 'grade points: ' + gp);
        assert.ok(typeof lg === 'string' && lg.length, 'letter grade: ' + lg);
        assert.equal(A.gradePoint(lg), gp, 'and the two agree');
      });
      assert.ok(s && p);
    });
  });

  /* ══ 5. FILTERING BY LEVEL ═════════════════════════════════════════════════ */
  describe('"Took level" keeps whole students', () => {
    const levelField = () => A.filterFields(A.studentsTable([]))
      .find(f => f.kind === 'courseLevel');

    test('it is offered beside the other course predicates', () => {
      const f = levelField();
      assert.ok(f, 'the field exists');
      assert.equal(f.key, 'courses.level');
      assert.equal(f.label, 'Took level');
    });

    test('it carries the numeric operators, because levels are ordered', () => {
      assert.deepEqual(A.opsFor('courseLevel'), A.NUM_OPS);
      assert.equal(A.defaultOpFor('courseLevel'), 'eq',
        '"took one at this level" is the common question');
    });

    test('the control offers the levels the files contain, not a free number', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, f, o] = t.build('source', 'filter', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(f.id, 'crit.0.field', 'courses.level');
      const opts = t.optionsOf(f.id, 'crit.0.value:courses.level');
      assert.deepEqual(opts, ['1', '2', '3', '4']);
      assert.ok(o);
    });

    test('equality keeps every student who took one at that level', async () => {
      if (!hasDataDir()) return;
      const [s, o] = await archiveSource([2022]);
      reset();
      const [s2, f, o2] = t.build('source', 'filter', 'output');
      await t.loadArchive(s2.id, [2022]);
      t.set(f.id, 'crit.0.field', 'courses.level');
      t.set(f.id, 'crit.0.op:courses.level', 'eq');

      // Cross-checked against the archive itself, not against the tool.
      const expected = { 1: 205, 2: 175, 3: 196, 4: 133 };
      Object.keys(expected).forEach(lv => {
        t.set(f.id, 'crit.0.value:courses.level', lv);
        w.runQuery();
        assert.equal(t.entry(o2.id).table.rows.length, expected[lv], 'level ' + lv);
      });
      assert.ok(s && o && s2);
    });

    test('a student spanning two levels satisfies both, because they did both', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, f, o] = t.build('source', 'filter', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(f.id, 'crit.0.field', 'courses.level');
      t.set(f.id, 'crit.0.op:courses.level', 'eq');

      const inLevel = (lv) => {
        t.set(f.id, 'crit.0.value:courses.level', String(lv));
        w.runQuery();
        const tab = t.entry(o.id).table;
        return tab.rows.map(r => A.cellAt(tab, r, 'id'));
      };
      const a = inLevel(1), b = inLevel(4);
      // 300107735 took CGRA151 and four 400-level courses.
      assert.includes(a, 300107735);
      assert.includes(b, 300107735);
    });

    test('the whole student comes through, enrolments intact', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, f, o] = t.build('source', 'filter', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(f.id, 'crit.0.field', 'courses.level');
      t.set(f.id, 'crit.0.value:courses.level', '4');
      w.runQuery();
      const tab = t.entry(o.id).table;
      const row = tab.rows.find(r => A.cellAt(tab, r, 'id') === 300107735);
      assert.equal(A.cellAt(tab, row, 'courses').length, 7,
        'all seven, not just the 400-level ones — the row is still a student');
    });

    test('"at level 3 or above" is the progression question, and it answers', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, f, o] = t.build('source', 'filter', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(f.id, 'crit.0.field', 'courses.level');
      t.set(f.id, 'crit.0.op:courses.level', 'gte');
      t.set(f.id, 'crit.0.value:courses.level', '3');
      w.runQuery();
      assert.equal(t.entry(o.id).table.rows.length, 205);
    });

    test('a level band composes with the range operator', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, f, o] = t.build('source', 'filter', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(f.id, 'crit.0.field', 'courses.level');
      t.set(f.id, 'crit.0.op:courses.level', 'between');
      t.set(f.id, 'crit.0.value:courses.level', '1');
      t.set(f.id, 'crit.0.value:courses.level:max', '4');
      w.runQuery();
      assert.equal(t.entry(o.id).table.rows.length, 280,
        'one to four is every student in the file');
    });

    test('the log says what was applied', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, f, o] = t.build('source', 'filter', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(f.id, 'crit.0.field', 'courses.level');
      t.set(f.id, 'crit.0.op:courses.level', 'gte');
      t.set(f.id, 'crit.0.value:courses.level', '3');
      w.runQuery();
      const log = t.entry(o.id).log.join(' ');
      assert.includes(log, 'took');
      assert.includes(log, 'level');
    });

    test('it survives a round trip through a saved query', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, f] = t.build('source', 'filter', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(f.id, 'crit.0.field', 'courses.level');
      t.set(f.id, 'crit.0.op:courses.level', 'gte');
      t.set(f.id, 'crit.0.value:courses.level', '3');

      const json = JSON.stringify(app.serialiseGraph());
      assert.ok(app.loadGraphFromText(json, null));
      const back = app.nodes.find(n => n.type === 'filter').cfg.criteria[0];
      assert.equal(back.field, 'courses.level');
      assert.equal(back.ops['courses.level'], 'gte');
      assert.equal(back.values['courses.level'], '3');
    });
  });

  /* ══ 6. FILTERING AND GROUPING BY DEGREE ═══════════════════════════════════ */
  describe('Degree is an ordinary enum column', () => {
    test('it is offered as a filter field', () => {
      const keys = A.filterFields(A.studentsTable([])).map(f => f.key);
      assert.includes(keys, 'degree');
    });

    test('its options are the degrees loaded', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, f, o] = t.build('source', 'filter', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(f.id, 'crit.0.field', 'degree');
      assert.deepEqual(t.optionsOf(f.id, 'crit.0.value:degree').sort(),
        ['BCA', 'BEHONS', 'BSC']);
      assert.ok(o);
    });

    test('filtering on it matches the archive', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, f, o] = t.build('source', 'filter', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(f.id, 'crit.0.field', 'degree');
      Object.entries({ BEHONS: 129, BSC: 110, BCA: 41 }).forEach(([d, n]) => {
        t.set(f.id, 'crit.0.value:degree', d);
        w.runQuery();
        assert.equal(t.entry(o.id).table.rows.length, n, d);
      });
      assert.ok(s);
    });

    test('a student carries one degree, never two', function () {
      if (!hasDataDir()) return;
      // The reason it is a student column rather than an enrolment one. If the
      // archive ever stops being true of this, the column is in the wrong place.
      const h = A.parseHeaderFile(dataDirFile('headers.txt'), 'headers.txt');
      const rows = dataDirFile('mcs-students-2022').split('\n').filter(l => l.trim());
      const seen = {};
      rows.forEach(l => {
        const f = l.split('\t');
        const id = f[0], deg = f[h.byName.deg1];
        if (seen[id] === undefined) seen[id] = deg;
        else assert.equal(seen[id], deg, 'student ' + id + ' carries two degrees');
      });
    });

    test('it can be sorted, and it can be counted per value', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, u, o] = t.build('source', 'unique', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(u.id, 'col', 'degree');
      w.runQuery();
      const tab = t.entry(o.id).table;
      assert.equal(tab.rows.length, 3, 'three distinct degrees');
      assert.ok(s && u);
    });
  });

  /* ══ 7. THE PAYOFF ═════════════════════════════════════════════════════════
     What the two columns were added for: the level question at enrolment
     granularity, where it can be aggregated. */
  describe('Level is a number, so it can be measured', () => {
    test('unfolding gives one row per enrolment with its level on it', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, p, o] = t.build('source', 'project', 'output');
      await t.loadArchive(s.id, [2022]);
      w.runQuery();
      const tab = t.entry(o.id).table;
      assert.equal(tab.rows.length, 2170, 'every enrolment in the file');
      const perLevel = {};
      tab.rows.forEach(r => {
        const lv = A.cellAt(tab, r, 'level');
        perLevel[lv] = (perLevel[lv] || 0) + 1;
      });
      assert.deepEqual(perLevel, { 1: 697, 2: 461, 3: 558, 4: 454 },
        'cross-checked against the raw file');
      assert.ok(s && p);
    });

    test('the average level across the cohort is a number the tool can now state', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, p, ag, o] = t.build('source', 'project', 'aggregate', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(ag.id, 'op', 'average');
      t.set(ag.id, 'col', 'level');
      w.runQuery();
      const tab = t.entry(o.id).table;
      const got = tab.rows[0][0];
      const want = (697 * 1 + 461 * 2 + 558 * 3 + 454 * 4) / 2170;
      assert.close(got, Math.round(want * 100) / 100, 0.01);
      assert.ok(s && p);
    });

    test('the highest level a student reached, which is the progression measure', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, f, p, ag, o] = t.build('source', 'filter', 'project', 'aggregate', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(f.id, 'crit.0.field', 'id');
      t.set(f.id, 'crit.0.op:id', 'eq');
      t.set(f.id, 'crit.0.value:id', '300107735');
      t.set(ag.id, 'op', 'max');
      t.set(ag.id, 'col', 'level');
      w.runQuery();
      assert.equal(t.entry(o.id).table.rows[0][0], 4);
      assert.ok(s && p);
    });

    test('level and degree together, which neither column could answer alone', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, f, o] = t.build('source', 'filter', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(f.id, 'crit.0.field', 'degree');
      t.set(f.id, 'crit.0.value:degree', 'BEHONS');
      w.addCriterion(f.id);
      t.set(f.id, 'crit.1.field', 'courses.level');
      t.set(f.id, 'crit.1.op:courses.level', 'eq');
      t.set(f.id, 'crit.1.value:courses.level', '1');
      w.runQuery();
      const n = t.entry(o.id).table.rows.length;
      assert.ok(n > 0 && n < 129,
        'some honours students are still taking a 100-level paper, but not all of them');
      assert.ok(s);
    });
  });
};
