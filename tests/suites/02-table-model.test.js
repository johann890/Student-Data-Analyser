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
      assert.ok(app.colIndex(t, 'gpa') >= 0);
      assert.equal(app.colIndex(t, 'nonexistent'), -1);
    });

    test('cellAt reads by column key, not position', () => {
      const s = app.STUDENTS[0];
      const t = app.studentsTable([s]);
      assert.equal(app.cellAt(t, t.rows[0], 'id'), s.id);
      assert.equal(app.cellAt(t, t.rows[0], 'gpa'), s.gpa);
      assert.equal(app.cellAt(t, t.rows[0], 'specialisation'), s.specialisation);
    });

    test('every row has exactly one cell per column', () => {
      const t = app.studentsTable(app.STUDENTS);
      t.rows.forEach(r => assert.equal(r.length, t.columns.length));
    });

    test('every column declares a known type', () => {
      const types = Object.keys(T).map(k => T[k]);
      app.studentsTable([]).columns.forEach(c =>
        assert.includes(types, c.type, c.key + ' has type ' + c.type));
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
      // The nested-cell renderers must not take the integer for a course list
      // either: fmtCell would print its length, cellTitle would join it.
      const numCol = decoy.columns[1];
      assert.equal(app.fmtCell(numCol, 27), '27');
      assert.equal(app.cellTitle(numCol, 27), '');
    });

    test('numericCols returns only numeric columns', () => {
      const t = app.studentsTable([]);
      app.numericCols(t).forEach(c => assert.equal(c.type, T.NUMBER));
      assert.ok(app.numericCols(t).length > 0);
    });
  });

  /* The unfold (toEnrolments) and the per-course breakdown (breakdownTable)
     were removed in 52d5e6a along with the Source's enrolment granularity, so
     the twelve tests that covered them are gone rather than skipped.

     Their subject is not gone: app.js:238 records that unfolding nested
     enrolments should return as a NODE on the canvas, where the change in row
     identity is visible, rather than as a hidden Source mode. When that node is
     built these are the assertions to restore. One row per student-course
     pair, student context carried onto every row, marks intact, an empty input
     giving an empty table rather than an error. `git show 52d5e6a` has both the
     implementation and the original tests. */

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

    test('whole numbers stay whole, fractions keep two places without padding', () => {
      /* Two places because a GPA is quoted to two, and rounding to one would
         move 6.25 into a different grade band. No padding, and no floating
         point noise: averaging grade points is what produces the noise. */
      const col = { key: 'n', type: T.NUMBER };
      assert.equal(app.fmtCell(col, 12), '12');
      assert.equal(app.fmtCell(col, 12.25), '12.25');
      assert.equal(app.fmtCell(col, 12.5), '12.5', 'no trailing zero');
      assert.equal(app.fmtCell(col, 6.233749999999999), '6.23', 'no float noise');
      assert.equal(app.exportCell(col, 6.233749999999999), '6.23', 'and the same in the CSV');
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
