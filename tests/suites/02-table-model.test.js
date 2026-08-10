/* The table primitive.
   Everything on a wire is {columns, rows, meta}. These tests pin the contract
   the rest of the application relies on. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {
  const { app } = boot();
  const T = app.COLTYPE;

  describe('construction and access', () => {
    test('makeTable fills in missing rows and meta', () => {
      const t = app.makeTable([{ key: 'a', label: 'A', type: T.TEXT }]);
      assert.deepEqual(t.rows, []);
      assert.deepEqual(t.meta, {});
    });

    test('colIndex finds a column and reports -1 when absent', () => {
      const t = app.studentsTable(app.STUDENTS.slice(0, 1));
      assert.ok(app.colIndex(t, 'gradeAvg') >= 0);
      assert.equal(app.colIndex(t, 'nonexistent'), -1);
    });

    test('cellAt reads by column key, not position', () => {
      const s = app.STUDENTS[0];
      const t = app.studentsTable([s]);
      assert.equal(app.cellAt(t, t.rows[0], 'id'), s.id);
      assert.equal(app.cellAt(t, t.rows[0], 'gradeAvg'), s.gradeAvg);
      assert.equal(app.cellAt(t, t.rows[0], 'specialisation'), s.specialisation);
    });

    test('every row has exactly one cell per column', () => {
      const t = app.studentsTable(app.STUDENTS);
      t.rows.forEach(r => assert.equal(r.length, t.columns.length));
    });

    test('every column declares a known type', () => {
      const types = Object.keys(T).map(k => T[k]);
      [app.studentsTable([]), app.enrolmentsTable([])].forEach(t => {
        t.columns.forEach(c => assert.includes(types, c.type, c.key + ' has type ' + c.type));
      });
    });
  });

  describe('column type lookup', () => {
    test('the nested course column is found by type', () => {
      const t = app.studentsTable(app.STUDENTS.slice(0, 3));
      const i = app.coursesColIndex(t);
      assert.ok(i >= 0);
      assert.equal(t.columns[i].type, T.COURSES);
    });

    test('a numeric column named "courses" is NOT mistaken for nested data', () => {
      // This is the exact collision that broke toEnrolments: a Compare emits a
      // numeric measure column also called "courses".
      const decoy = app.makeTable([
        { key: 'branch',  label: 'Branch',  type: T.TEXT },
        { key: 'courses', label: 'Courses', type: T.NUMBER }
      ], [['A', 27], ['B', 29]]);
      assert.equal(app.coursesColIndex(decoy), -1, 'matched on name instead of type');
      assert.equal(app.toEnrolments(decoy), null);
      assert.equal(app.breakdownTable(decoy).rows.length, 0);
    });

    test('numericCols returns only numeric columns', () => {
      const t = app.studentsTable([]);
      app.numericCols(t).forEach(c => assert.equal(c.type, T.NUMBER));
      assert.ok(app.numericCols(t).length > 0);
    });
  });

  describe('toEnrolments (the unfold)', () => {
    test('a student table unfolds to one row per student-course pair', () => {
      const some = app.STUDENTS.slice(0, 5);
      const en = app.toEnrolments(app.studentsTable(some));
      const expected = some.reduce((a, s) => a + s.courses.length, 0);
      assert.equal(en.rows.length, expected);
    });

    test('the unfold carries student context onto every enrolment row', () => {
      const s = app.STUDENTS[0];
      const en = app.toEnrolments(app.studentsTable([s]));
      en.rows.forEach(r => {
        assert.equal(app.cellAt(en, r, 'studentId'), s.id);
        assert.equal(app.cellAt(en, r, 'specialisation'), s.specialisation);
        assert.equal(app.cellAt(en, r, 'year'), s.year);
      });
    });

    test('marks survive the unfold intact', () => {
      const s = app.STUDENTS[0];
      const en = app.toEnrolments(app.studentsTable([s]));
      const got = en.rows.map(r => app.cellAt(en, r, 'code') + ':' + app.cellAt(en, r, 'mark')).sort();
      const want = s.courses.map(c => c.code + ':' + c.mark).sort();
      assert.deepEqual(got, want);
    });

    test('an enrolment table passes through unchanged', () => {
      const t = app.enrolmentsTable(app.STUDENTS.slice(0, 3));
      assert.equal(app.toEnrolments(t), t, 'should be the same object, not a copy');
    });

    test('a table with no course information returns null rather than guessing', () => {
      const t = app.makeTable([{ key: 'x', label: 'X', type: T.NUMBER }], [[1]]);
      assert.equal(app.toEnrolments(t), null);
    });

    test('unfolding an empty student table gives an empty enrolment table', () => {
      const en = app.toEnrolments(app.studentsTable([]));
      assert.equal(en.rows.length, 0);
      assert.ok(en.columns.length > 0, 'columns should still be declared');
    });
  });

  describe('breakdownTable', () => {
    test('counts and averages agree with the raw data', () => {
      const some = app.STUDENTS.slice(0, 20);
      const bt = app.breakdownTable(app.studentsTable(some));
      const tally = {};
      some.forEach(s => s.courses.forEach(c => {
        (tally[c.code] = tally[c.code] || []).push(c.mark);
      }));
      assert.equal(bt.rows.length, Object.keys(tally).length);
      bt.rows.forEach(r => {
        const marks = tally[r[0]];
        assert.equal(r[3], marks.length, r[0] + ' count');
        assert.close(r[4], marks.reduce((a, m) => a + m, 0) / marks.length, 1e-9, r[0] + ' mean');
      });
    });

    test('total enrolments are conserved by the aggregation', () => {
      const some = app.STUDENTS.slice(0, 30);
      const bt = app.breakdownTable(app.studentsTable(some));
      const total = some.reduce((a, s) => a + s.courses.length, 0);
      assert.equal(bt.rows.reduce((a, r) => a + r[3], 0), total);
    });

    test('rows are ordered by popularity, ties broken by code', () => {
      const bt = app.breakdownTable(app.studentsTable(app.STUDENTS));
      for (let i = 1; i < bt.rows.length; i++) {
        const prev = bt.rows[i - 1], cur = bt.rows[i];
        assert.ok(prev[3] > cur[3] || (prev[3] === cur[3] && prev[0] < cur[0]),
          'order broken at ' + prev[0] + '/' + cur[0]);
      }
    });

    test('the same result whether fed students or enrolments', () => {
      const some = app.STUDENTS.slice(0, 12);
      const a = app.breakdownTable(app.studentsTable(some));
      const b = app.breakdownTable(app.enrolmentsTable(some));
      assert.deepEqual(a.rows, b.rows);
    });

    test('an empty input gives an empty breakdown, not an error', () => {
      assert.equal(app.breakdownTable(app.studentsTable([])).rows.length, 0);
    });
  });

  describe('cell formatting', () => {
    test('a nested course cell shows a count on screen', () => {
      const col = { key: 'courses', type: T.COURSES };
      assert.equal(app.fmtCell(col, [{ code: 'A' }, { code: 'B' }]), '2');
    });

    test('a nested course cell exports as joined codes, keeping the row one row', () => {
      const col = { key: 'courses', type: T.COURSES };
      const out = app.exportCell(col, [{ code: 'COMP421' }, { code: 'SWEN430' }]);
      assert.equal(out, 'COMP421;SWEN430');
      assert.excludes(out, ',', 'a comma would collide with the CSV separator');
    });

    test('whole numbers stay whole, fractions get one decimal', () => {
      const col = { key: 'n', type: T.NUMBER };
      assert.equal(app.fmtCell(col, 12), '12');
      assert.equal(app.fmtCell(col, 12.25), '12.3');
    });

    test('null and undefined render as empty, never as "null"', () => {
      const col = { key: 'x', type: T.TEXT };
      assert.equal(app.fmtCell(col, null), '');
      assert.equal(app.fmtCell(col, undefined), '');
      assert.equal(app.exportCell(col, null), '');
    });

    test('a course cell exposes the full transcript as a tooltip', () => {
      const col = { key: 'courses', type: T.COURSES };
      assert.equal(app.cellTitle(col, [{ code: 'A' }, { code: 'B' }]), 'A, B');
      assert.equal(app.cellTitle({ key: 'x', type: T.TEXT }, 'hi'), '');
    });
  });
};
