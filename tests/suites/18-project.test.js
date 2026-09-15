/* The Project node — unfolding nested enrolments into rows of their own.

   This is the node app.js:238 specified and nobody built:

     Nothing unfolds nested enrolments into their own rows any more. If that is
     wanted later it should be a node on the canvas, where the change in row
     identity is visible, rather than a setting hidden on the Source.

   So the tests come in two halves. The first is ordinary — does it produce the
   right rows. The second is unusual, and is the point of the node: is the
   change in what a row MEANS actually visible? That used to be a dropdown on
   the Source, and it made "count students" wrong by a factor of eight with
   nothing on screen to say so. A correct unfold that hid its own effect would
   be a regression to that, however right its numbers. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const A = boot().app;
  const S = A.STUDENTS;
  const TOTAL = S.reduce((a, s) => a + s.courses.length, 0);

  function rig(...mid) {
    const h = boot();
    const made = h.build('source', 'project', ...mid, 'output');
    return { ...h, s: made[0], p: made[1], mid: made.slice(2, -1), o: made[made.length - 1] };
  }
  const col = (t, k) => t.columns.findIndex(c => c.key === k);

  describe('registration', () => {
    test('it appears in every table the registry keeps', () => {
      assert.ok(A.SHAPE.project, 'no shape');
      assert.ok(A.NODE_SPEC.project, 'no spec');
      assert.ok(A.CONNECT_RULES.project, 'no wiring rules');
      assert.ok(A.NODE_PORTS.project, 'no ports');
      assert.deepEqual(A.defaultCfg('project'), {}, 'nothing to configure');
    });

    test('it goes wherever a row-shaping node goes', () => {
      assert.deepEqual(A.CONNECT_RULES.project, A.CONNECT_RULES.select);
    });

    test('it takes exactly one wire', () => {
      assert.equal(A.portsOf('project').length, 1);
      assert.notOk(A.portDef('project', 'in').multi);
    });

    test('it has its own menu group, not Reshape', () => {
      /* The placement is load-bearing. Reshape is described as "the same data,
         narrowed or reordered"; this node is neither, and filing it there would
         be the first place the tool understated what it does. */
      const h = boot();
      const btn = h.qa('.proc-item').find(b => b.getAttribute('onclick').includes("'project'"));
      assert.ok(btn, 'no menu entry');
      assert.includes(btn.className, 'cat-expand');
      assert.excludes(btn.className, 'cat-reshape');
    });

    test('adding one from the menu renders its shape', () => {
      const h = boot();
      h.w.addProcNode('project');
      assert.equal(h.app.nodes[0].type, 'project');
      assert.ok(h.q('.shape-project'));
    });
  });

  describe('what comes out', () => {
    test('one row per student-course pair', () => {
      const r = rig();
      r.w.runQuery();
      assert.equal(r.entry(r.o.id).table.rows.length, TOTAL);
      assert.equal(TOTAL, S.length * A.COURSES_PER_YEAR, 'eight courses each');
    });

    test('the enrolment columns are added', () => {
      const r = rig();
      r.w.runQuery();
      const keys = r.entry(r.o.id).table.columns.map(c => c.key);
      A.enrolmentColumns().forEach(c => assert.includes(keys, c.key));
    });

    test('the nested column is gone, having become the rows', () => {
      const r = rig();
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(A.coursesColIndex(t), -1);
    });

    test('student context rides onto every row', () => {
      const r = rig();
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      const si = col(t, 'studentId'), yi = col(t, 'year'), pi = col(t, 'specialisation');
      const byId = {};
      S.forEach(s => { byId[s.id] = s; });
      t.rows.forEach(row => {
        const s = byId[row[si]];
        assert.ok(s, 'unknown student ' + row[si]);
        assert.equal(row[yi], s.year);
        assert.equal(row[pi], s.specialisation);
      });
    });

    test('the marks and grades are the per-course ones, not the student average', () => {
      /* The claim the whole node rests on. A Filter could always ask "did this
         student take SWEN421"; what it could never do was read the mark. */
      const r = rig();
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      const si = col(t, 'studentId'), ci = col(t, 'code'),
            mi = col(t, 'mark'), gi = col(t, 'letterGrade');
      const got = t.rows.map(x => [x[si], x[ci], x[mi], x[gi]].join('|')).sort();
      const want = [];
      S.forEach(s => s.courses.forEach(c =>
        want.push([s.id, c.code, c.mark, c.letterGrade].join('|'))));
      assert.deepEqual(got, want.sort());
    });

    test('and they really do differ from the student average', () => {
      // Otherwise the test above would pass on a table that carried the wrong
      // column and nobody would notice.
      const r = rig();
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      const si = col(t, 'studentId'), gi = col(t, 'letterGrade');
      const overall = {};
      S.forEach(s => { overall[s.id] = s.letterGrade; });
      const differing = t.rows.filter(x => x[gi] !== overall[x[si]]).length;
      assert.ok(differing > 0, 'a per-course grade that never differs is the average in disguise');
    });

    test('every row has one cell per column', () => {
      const r = rig();
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      t.rows.forEach(x => assert.equal(x.length, t.columns.length));
    });
  });

  describe('the change in row identity is visible', () => {
    test('ID is renamed, because it no longer names a row', () => {
      /* One student now owns eight rows. A column still called "ID" invites the
         miscount this node exists to make visible. */
      const r = rig();
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(col(t, 'id'), -1, 'the old name must not survive');
      assert.ok(col(t, 'studentId') >= 0);
      assert.equal(t.columns[col(t, 'studentId')].label, 'Student');
    });

    test('a student id now appears many times over', () => {
      const r = rig();
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      const si = col(t, 'studentId');
      const seen = {};
      t.rows.forEach(x => { seen[x[si]] = (seen[x[si]] || 0) + 1; });
      assert.equal(seen[S[0].id], S[0].courses.length);
    });

    test('the log states the multiplication', () => {
      const r = rig();
      r.w.runQuery();
      const log = r.text('.query-log').replace(/\s+/g, ' ');
      assert.includes(log, 'PROJECT');
      assert.includes(log, String(S.length) + ' rows');
      assert.includes(log, String(TOTAL) + ' rows');
      assert.includes(log, 'one per course');
    });

    test('the panel says what it does to a count, before anything runs', () => {
      const r = rig();
      const panel = r.qa('.node')[1].textContent;
      assert.includes(panel, 'one row per course');
      assert.includes(panel, 'counts enrolments',
        'the panel has to warn, because there is no control here to explain');
    });

    test('the warning is the one coloured hint on any panel', () => {
      const r = rig();
      assert.ok(r.q('.proj-warn'), 'a plain grey hint would read as ordinary help text');
    });

    test('and a count really is eight times what it was', () => {
      const plain = boot();
      const [s1, o1] = plain.build('source', 'output');
      plain.set(o1.id, 'show', 'count');
      plain.w.runQuery();

      const r = rig();
      r.set(r.o.id, 'show', 'count');
      r.w.runQuery();

      assert.equal(Number(plain.bigNum()), S.length);
      assert.equal(Number(r.bigNum()), TOTAL);
    });
  });

  describe('a column that would now mislead is replaced, and said so', () => {
    test('the student letter grade gives way to the course one', () => {
      /* Both are called letterGrade. On a table of enrolments the course grade
         is what that name should mean; the student's average is still reachable
         as gradeAvg. */
      const r = rig();
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(t.columns.filter(c => c.key === 'letterGrade').length, 1,
        'a duplicated key would make colIndex ambiguous');
      assert.ok(col(t, 'gradeAvg') >= 0, 'the student average survives under its own name');
    });

    test('the replacement is named in the log rather than happening quietly', () => {
      const r = rig();
      r.w.runQuery();
      assert.includes(r.text('.query-log'), 'replaced by course values');
    });

    test('a column with no clash is carried through untouched', () => {
      const r = rig();
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      ['gender', 'year', 'specialisation', 'gradeAvg'].forEach(k =>
        assert.ok(col(t, k) >= 0, k + ' should have been carried'));
    });

    test('which columns carry is decided by key, not by a hardcoded list', () => {
      // So a column added to the Source schema tomorrow is carried for free
      const t = A.studentsTable([]);
      const carried = A.projectCarried(t).map(c => c.key);
      const enrolKeys = A.enrolmentColumns().map(c => c.key);
      t.columns.forEach(c => {
        if (c.type === A.COLTYPE.COURSES) {
          assert.excludes(carried, c.key, 'the nested column becomes the rows');
        } else if (enrolKeys.indexOf(c.key) !== -1) {
          assert.excludes(carried, c.key, c.key + ' clashes with an enrolment column');
        } else {
          assert.includes(carried, c.key, c.key + ' has no reason to be dropped');
        }
      });
    });
  });

  describe('the header is known before anything runs', () => {
    test('the schema walk and the engine agree', () => {
      const r = rig();
      const declared = r.app.computeSchemas()[r.p.id].columns.map(c => c.key + ':' + c.label);
      const produced = r.app.evaluateGraph().res[r.p.id].table.columns.map(c => c.key + ':' + c.label);
      assert.deepEqual(produced, declared);
    });

    test('a downstream panel offers the enrolment columns without a run', () => {
      /* This is what "statically known" buys: a Filter after a Project can
         offer Mark and Course before the query has ever been run. */
      const h = boot();
      const [s, p, f, o] = h.build('source', 'project', 'filter', 'output');
      const opts = h.qa('.ft-sel option').map(x => x.value);
      ['mark', 'code', 'subject', 'points'].forEach(k => assert.includes(opts, k, k));
      assert.excludes(opts, 'courses.mark', 'the nested predicates make no sense once unfolded');
    });

    test('a downstream Aggregate offers Mark as a measure', () => {
      const h = boot();
      const [s, p, a, o] = h.build('source', 'project', 'aggregate', 'output');
      h.set(a.id, 'op', 'average');
      assert.includes(h.optionsOf(a.id, 'col'), 'mark');
    });
  });

  describe('nothing to unfold', () => {
    test('a table with no course data passes straight through', () => {
      const h = boot();
      const [s, a, p, o] = h.build('source', 'aggregate', 'project', 'output');
      h.w.runQuery();
      assert.notOk(h.q('.error-box'), h.text('.error-box'));
      assert.equal(h.entry(o.id).table.rows.length, 1, 'the aggregate result is untouched');
    });

    test('and says so rather than failing silently', () => {
      const h = boot();
      const [s, a, p, o] = h.build('source', 'aggregate', 'project', 'output');
      h.w.runQuery();
      assert.includes(h.text('.query-log'), 'nothing to expand');
    });

    test('the panel says so too, before the run', () => {
      const h = boot();
      const [s, a, p, o] = h.build('source', 'aggregate', 'project', 'output');
      assert.includes(h.qa('.node')[2].textContent, 'nothing to expand');
    });

    test('canProject is what decides, and both walks ask it', () => {
      assert.ok(A.canProject(A.studentsTable([])));
      assert.notOk(A.canProject(A.makeTable([{ key: 'x', label: 'X', type: A.COLTYPE.NUMBER }], [])));
    });

    test('a second Project in series is a no-op, not a crash', () => {
      const r = rig('project');
      r.w.runQuery();
      assert.notOk(r.q('.error-box'));
      assert.equal(r.entry(r.o.id).table.rows.length, TOTAL);
    });

    test('an empty table unfolds to an empty table with the right header', () => {
      const h = boot();
      const [s, f, p, o] = h.build('source', 'filter', 'project', 'output');
      h.set(f.id, 'crit.0.value:gradeAvg', '500');   // matches nobody
      h.w.runQuery();
      const t = h.entry(o.id).table;
      assert.equal(t.rows.length, 0);
      assert.ok(col(t, 'mark') >= 0, 'the columns are still declared');
    });
  });

  describe('use case (f): grades in a particular course', () => {
    const CODE = 'SWEN421';

    test('the course can be filtered on as a column, not just a predicate', () => {
      const h = boot();
      const [s, p, f, o] = h.build('source', 'project', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'code');
      h.set(f.id, 'crit.0.value:code', CODE);
      h.w.runQuery();
      let want = 0;
      S.forEach(x => x.courses.forEach(c => { if (c.code === CODE) want++; }));
      assert.equal(h.entry(o.id).table.rows.length, want);
    });

    test('and the grade that survives is the grade in that course', () => {
      const h = boot();
      const [s, p, f, o] = h.build('source', 'project', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'code');
      h.set(f.id, 'crit.0.value:code', CODE);
      h.w.runQuery();
      const t = h.entry(o.id).table;
      const si = col(t, 'studentId'), gi = col(t, 'letterGrade');
      const got = t.rows.map(r => r[si] + ':' + r[gi]).sort();
      const want = [];
      S.forEach(x => x.courses.forEach(c => { if (c.code === CODE) want.push(x.id + ':' + c.letterGrade); }));
      assert.deepEqual(got, want.sort());
    });

    test('the distinct grades in that course can be listed', () => {
      const h = boot();
      const [s, p, f, u, o] = h.build('source', 'project', 'filter', 'unique', 'output');
      h.set(f.id, 'crit.0.field', 'code');
      h.set(f.id, 'crit.0.value:code', CODE);
      h.w.render();
      h.set(u.id, 'col', 'letterGrade');
      h.w.runQuery();
      const got = h.entry(o.id).table.rows.map(r => r[0]).sort();
      const want = [];
      S.forEach(x => x.courses.forEach(c => {
        if (c.code === CODE && want.indexOf(c.letterGrade) === -1) want.push(c.letterGrade);
      }));
      assert.deepEqual(got, want.sort());
    });

    test('a mark band within one course — Project and the range together', () => {
      const h = boot();
      const [s, p, f, o] = h.build('source', 'project', 'filter', 'output');
      h.set(o.id, 'show', 'count');
      h.set(f.id, 'crit.0.field', 'code');
      h.set(f.id, 'crit.0.value:code', CODE);
      h.w.addCriterion(f.id);
      h.set(f.id, 'crit.1.field', 'mark');
      h.set(f.id, 'crit.1.op:mark', 'between');
      h.set(f.id, 'crit.1.value:mark', '70');
      h.set(f.id, 'crit.1.value:mark:max', '79');
      h.w.runQuery();
      let want = 0;
      S.forEach(x => x.courses.forEach(c => {
        if (c.code === CODE && c.mark >= 70 && c.mark <= 79) want++;
      }));
      assert.equal(Number(h.bigNum()), want);
    });

    test('the average mark in one course, which no graph could ask before', () => {
      const h = boot();
      const [s, p, f, a, o] = h.build('source', 'project', 'filter', 'aggregate', 'output');
      h.set(f.id, 'crit.0.field', 'code');
      h.set(f.id, 'crit.0.value:code', CODE);
      h.w.render();
      h.set(a.id, 'op', 'average');
      h.set(a.id, 'col', 'mark');
      h.w.runQuery();
      const marks = [];
      S.forEach(x => x.courses.forEach(c => { if (c.code === CODE) marks.push(c.mark); }));
      assert.close(h.entry(o.id).table.rows[0][0],
        marks.reduce((x, y) => x + y, 0) / marks.length, 1e-9);
    });
  });

  describe('it composes like any other node', () => {
    test('its result feeds onward', () => {
      const r = rig('sort', 'take');
      r.set(r.mid[1].id, 'n', '5');
      r.w.runQuery();
      assert.equal(r.entry(r.o.id).table.rows.length, 5);
    });

    test('Select can narrow an unfolded table', () => {
      const r = rig('select');
      ['gender', 'year', 'specialisation', 'gradeAvg', 'name', 'subject', 'points']
        .forEach(k => r.set(r.mid[0].id, 'column:' + k, false));
      r.w.runQuery();
      assert.deepEqual(r.entry(r.o.id).table.columns.map(c => c.key),
        ['studentId', 'code', 'mark', 'letterGrade']);
    });

    test('Unique on studentId gets back one row per student', () => {
      // The counterpart to the multiplication, and how a count is made honest
      // again after a Project.
      const r = rig('unique');
      r.set(r.mid[0].id, 'col', 'studentId');
      r.w.runQuery();
      assert.equal(r.entry(r.o.id).table.rows.length, S.length);
    });

    test('it survives a save and load', () => {
      const r = rig('filter');
      r.set(r.mid[0].id, 'crit.0.field', 'subject');
      r.w.runQuery();
      const before = r.app.serialiseTable(r.app.exportTableFor(r.entry(r.o.id)), ',', true);

      const json = JSON.stringify(r.app.serialiseGraph());
      r.w.clearAll();
      r.app.loadGraphFromText(json, r.doc.createElement('button'));
      assert.includes(r.app.nodes.map(n => n.type), 'project');
      r.w.runQuery();
      const out = r.app.nodes.find(n => n.type === 'output');
      assert.equal(r.app.serialiseTable(r.app.exportTableFor(r.entry(out.id)), ',', true), before);
    });

    test('the export carries one row per enrolment', () => {
      const r = rig();
      r.w.runQuery();
      r.w.saveOutput(r.o.id, r.doc.createElement('button'));
      const lines = r.saved[r.saved.length - 1].content.split('\n');
      assert.equal(lines.length - 1, TOTAL);
      assert.includes(lines[0], 'Mark');
      assert.includes(lines[0], 'Student');
    });
  });
};
