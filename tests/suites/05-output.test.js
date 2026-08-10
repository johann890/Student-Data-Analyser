/* Output nodes.
   The governing requirement is that every Output emits a table — a count is a
   1x1 table, an average a 1x2 — so one renderer and one exporter serve all of
   them. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  // Catalogue-driven, for the reasons given in 03-filter.
  const A = boot().app;
  const CORE_SUBJECTS = new Set(A.CORE_COURSES.map(c => A.COURSE_BY_CODE[c].subject));
  const SUBJ = A.SUBJECTS.find(x => !CORE_SUBJECTS.has(x));

  function rig(show) {
    const h = boot();
    const [s, f, o] = h.build('source', 'filter', 'output');
    if (show) h.set(o.id, 'show', show);
    return { ...h, s, f, o };
  }

  describe('every output is a table', () => {
    test('count is a 1x1 table', () => {
      const r = rig('count');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(t.columns.length, 1);
      assert.equal(t.rows.length, 1);
      assert.equal(t.columns[0].label, 'Count');
      assert.equal(t.rows[0][0], r.app.STUDENTS.filter(x => x.gradeAvg > 70).length);
    });

    test('count exports exactly as the two-line CSV that was asked for', () => {
      const r = rig('count');
      r.w.runQuery();
      const csv = r.app.serialiseTable(r.entry(r.o.id).table, ',', true);
      const lines = csv.split('\n');
      assert.equal(lines.length, 2);
      assert.equal(lines[0], 'Count');
      assert.ok(/^\d+$/.test(lines[1]), 'second line should be the bare number');
    });

    test('average is a table carrying both the mean and the row count', () => {
      const r = rig('average');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(t.columns.length, 2);
      assert.equal(t.columns[1].key, 'n');
      const want = r.app.STUDENTS.filter(x => x.gradeAvg > 70);
      assert.close(t.rows[0][0], want.reduce((a, x) => a + x.gradeAvg, 0) / want.length, 1e-9);
      assert.equal(t.rows[0][1], want.length);
    });

    test('rows passes the incoming table through unchanged', () => {
      const r = rig('rows');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(t.rows.length, r.app.STUDENTS.filter(x => x.gradeAvg > 70).length);
      assert.ok(r.app.hasCol(t, 'specialisation'));
    });
  });

  describe('every output copies and saves as a table', () => {
    // The requirement is that a scalar is a 1x1 table, not a bare number, so
    // that one serialiser covers every result shape.
    test('Copy on a count yields a header and a value, not just the number', () => {
      const r = rig('count');
      r.w.runQuery();
      r.w.copyOutput(r.o.id, r.doc.createElement('button'));
      const lines = r.copied[r.copied.length - 1].split('\n');
      assert.equal(lines.length, 2);
      assert.equal(lines[0], 'Count');
      assert.ok(/^\d+$/.test(lines[1]));
    });

    test('Copy on an average carries its label and the row count', () => {
      const r = rig('average');
      r.w.runQuery();
      r.w.copyOutput(r.o.id, r.doc.createElement('button'));
      const lines = r.copied[r.copied.length - 1].split('\t').join('|').split('\n');
      assert.equal(lines.length, 2);
      assert.includes(lines[0], 'Average');
      assert.includes(lines[0], 'Rows');
    });

    test('Save on every show type writes a CSV with a header row', () => {
      ['count', 'average', 'rows', 'courses'].forEach(show => {
        const r = rig(show);
        r.w.runQuery();
        r.w.saveOutput(r.o.id, r.doc.createElement('button'));
        const f = r.saved[r.saved.length - 1];
        assert.ok(/\.csv$/.test(f.name), show + ' should save as CSV');
        const lines = f.content.split('\n');
        assert.ok(lines.length >= 2, show + ' should have a header and at least one row');
        assert.ok(lines[0].length > 0, show + ' has an empty header');
      });
    });

    test('the scalar display is a presentation of the same table', () => {
      const r = rig('count');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(r.text('.result-head'), t.columns[0].label);
      assert.equal(r.bigNum(), String(t.rows[0][0]));
    });

    test('an Output with no data path offers no export controls at all', () => {
      const h = boot();
      const [s, o1] = h.build('source', 'output');
      h.w.addNode('output'); const o2 = h.app.nodes[h.app.nodes.length - 1];
      h.w.render(); h.w.runQuery();
      assert.notOk(h.exportNameField(o2.id), 'nothing to name when there is nothing to export');
      assert.equal(h.qa('.result-actions').length, 1);
    });
  });

  describe('count and average display', () => {
    test('a scalar still renders as a headline number', () => {
      const r = rig('count');
      r.w.runQuery();
      assert.ok(r.q('.big-num'), 'expected the large display');
    });

    test('the mean of zero rows shows a dash, not zero', () => {
      const r = rig('average');
      r.set(r.f.id, 'crit.0.value:gradeAvg', '500');
      r.w.runQuery();
      assert.equal(r.bigNum(), '\u2014', 'showing 0 would assert something false about the data');
    });

    test('count of zero rows really is zero', () => {
      const r = rig('count');
      r.set(r.f.id, 'crit.0.value:gradeAvg', '500');
      r.w.runQuery();
      assert.equal(r.bigNum(), '0');
    });

    test('the average column is configurable, not hardwired', () => {
      const r = rig();
      r.set(r.s.id, 'rows', 'enrolments');
      r.set(r.o.id, 'show', 'average');
      r.set(r.o.id, 'avgCol', 'points');
      r.w.runQuery();
      assert.close(r.entry(r.o.id).table.rows[0][0], 15, 1e-9, 'every course is 15 points');
    });
  });

  describe('course breakdown', () => {
    test('fed students, it counts every course they took', () => {
      const r = rig('courses');
      r.set(r.f.id, 'crit.0.field', 'courses.subject');
      r.set(r.f.id, 'crit.0.value:courses.subject', SUBJ);
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      const matched = r.app.STUDENTS.filter(x => x.courses.some(c => c.subject === SUBJ));
      const total = matched.reduce((a, x) => a + x.courses.length, 0);
      assert.equal(t.rows.reduce((a, row) => a + row[3], 0), total,
        'the aggregation must conserve enrolments');
      const subjects = [...new Set(t.rows.map(row => row[2]))];
      assert.ok(subjects.length > 1,
        'a student-level filter keeps whole students, so other subjects appear');
    });

    test('the panel explains that scope rather than leaving it to be inferred', () => {
      const r = rig('courses');
      r.set(r.f.id, 'crit.0.field', 'courses.subject');
      r.set(r.f.id, 'crit.0.value:courses.subject', SUBJ);
      r.w.runQuery();
      const p = r.panel();
      assert.includes(p, 'Every course taken by these');
      assert.includes(p, 'One per enrolment');
    });

    test('fed enrolments filtered by subject, only that subject appears', () => {
      const r = rig();
      r.set(r.s.id, 'rows', 'enrolments');
      r.set(r.f.id, 'crit.0.field', 'subject');
      r.set(r.f.id, 'crit.0.value:subject', SUBJ);
      r.set(r.o.id, 'show', 'courses');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.deepEqual([...new Set(t.rows.map(row => row[2]))], [SUBJ]);
      const want = new Set();
      r.app.STUDENTS.forEach(x => x.courses.forEach(c => { if (c.subject === SUBJ) want.add(c.code); }));
      assert.equal(t.rows.length, want.size);
    });

    test('the note switches wording with the granularity', () => {
      const r = rig();
      r.set(r.s.id, 'rows', 'enrolments');
      r.set(r.o.id, 'show', 'courses');
      r.w.runQuery();
      const p = r.panel();
      assert.includes(p, 'enrolments');
      assert.excludes(p, 'Every course taken by these');
    });

    test('breakdown of an empty result is empty, not an error', () => {
      const r = rig('courses');
      r.set(r.f.id, 'crit.0.value:gradeAvg', '500');
      r.w.runQuery();
      assert.equal(r.entry(r.o.id).table.rows.length, 0);
      assert.notOk(r.q('.error-box'));
    });
  });

  describe('show-type normalisation', () => {
    test('an unknown stored value falls back rather than breaking', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.app.setCfg(o.id, 'show', 'nonsense');
      assert.includes(['count', 'rows'], h.app.normaliseShow(o));
    });

    test('compare-only values map back to row values when no Compare feeds it', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.app.setCfg(o.id, 'show', 'lists');
      assert.equal(h.app.normaliseShow(o), 'rows');
    });

    test('"courses" is valid on both sides and survives rewiring', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(o.id, 'show', 'courses');
      assert.equal(h.app.normaliseShow(o), 'courses');
    });
  });

  describe('multiple outputs', () => {
    test('two Outputs on one Filter render independently', () => {
      const h = boot();
      const [s, f] = h.build('source', 'filter');
      h.w.addNode('output'); const o1 = h.app.nodes[h.app.nodes.length - 1];
      h.w.addNode('output'); const o2 = h.app.nodes[h.app.nodes.length - 1];
      h.app.connect(f.id, o1.id); h.app.connect(f.id, o2.id);
      h.w.render();
      h.set(o1.id, 'show', 'count');
      h.set(o2.id, 'show', 'average');
      h.w.runQuery();
      assert.equal(h.qa('.result-block').length, 2);
      assert.equal(h.entry(o1.id).table.columns[0].label, 'Count');
      assert.equal(h.entry(o2.id).table.columns[0].key, 'average');
    });

    test('an Output with no path to a Source says so and offers no exports', () => {
      const h = boot();
      const [s, o1] = h.build('source', 'output');
      h.w.addNode('output'); const o2 = h.app.nodes[h.app.nodes.length - 1];
      h.w.render();
      h.w.runQuery();
      assert.equal(h.qa('.result-block').length, 2);
      assert.includes(h.panel(), 'Not connected to a Source');
      assert.equal(h.entry(o2.id), undefined, 'nothing should be exportable');
    });
  });

  describe('display limits', () => {
    test('a long table truncates on screen but records every row for export', () => {
      const r = rig('rows');
      r.set(r.f.id, 'crit.0.value:gradeAvg', '0');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      assert.equal(t.rows.length, r.app.STUDENTS.length, 'export keeps everything');
      assert.ok(r.qa('.rtable tbody tr').length < t.rows.length + 1, 'screen should truncate');
      assert.includes(r.panel(), 'more');
    });
  });
};
