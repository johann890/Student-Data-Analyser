/* Export.
   Results leave this tool as text for Excel, so the delimiting and quoting have
   to be exactly right — a single unescaped comma silently shifts a column. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  function rig(show) {
    const h = boot();
    const [s, f, o] = h.build('source', 'filter', 'output');
    h.set(f.id, 'crit.0.value:gradeAvg', '0');   // keep everyone
    if (show) h.set(o.id, 'show', show);
    return { ...h, s, f, o };
  }

  describe('CSV correctness', () => {
    test('the header row uses column labels', () => {
      const r = rig('rows');
      r.w.runQuery();
      const csv = r.app.serialiseTable(r.entry(r.o.id).table, ',', true);
      assert.equal(csv.split('\n')[0], r.entry(r.o.id).table.columns.map(c => c.label).join(','));
    });

    test('every data row has the same number of fields as the header', () => {
      const r = rig('rows');
      r.w.runQuery();
      const csv = r.app.serialiseTable(r.entry(r.o.id).table, ',', true);
      const lines = csv.split('\n');
      // Count fields outside quotes, the way a CSV reader would
      const fields = line => {
        let n = 1, inQ = false;
        for (const ch of line) {
          if (ch === '"') inQ = !inQ;
          else if (ch === ',' && !inQ) n++;
        }
        return n;
      };
      const want = fields(lines[0]);
      lines.forEach((l, i) => assert.equal(fields(l), want, 'line ' + i + ' has the wrong field count'));
    });

    test('values containing a comma are quoted', () => {
      const { app } = boot();
      const t = app.makeTable([{ key: 'a', label: 'A', type: app.COLTYPE.TEXT }], [['x,y']]);
      assert.equal(app.serialiseTable(t, ',', true).split('\n')[1], '"x,y"');
    });

    test('embedded quotes are doubled', () => {
      const { app } = boot();
      const t = app.makeTable([{ key: 'a', label: 'A', type: app.COLTYPE.TEXT }], [['say "hi"']]);
      assert.equal(app.serialiseTable(t, ',', true).split('\n')[1], '"say ""hi"""');
    });

    test('newlines inside a value are quoted', () => {
      const { app } = boot();
      const t = app.makeTable([{ key: 'a', label: 'A', type: app.COLTYPE.TEXT }], [['one\ntwo']]);
      assert.includes(app.serialiseTable(t, ',', true), '"one\ntwo"');
    });

    test('a transcript cell is semicolon-joined so the row stays one row', () => {
      const r = rig('rows');
      r.w.runQuery();
      const csv = r.app.serialiseTable(r.entry(r.o.id).table, ',', true);
      const line = csv.split('\n')[1];
      assert.includes(line, ';');
      assert.equal(csv.split('\n').length, r.entry(r.o.id).table.rows.length + 1,
        'a comma-joined transcript would have split the row');
    });

    test('TSV uses tabs and does not quote', () => {
      const r = rig('rows');
      r.w.runQuery();
      const tsv = r.app.serialiseTable(r.entry(r.o.id).table, '\t', false);
      assert.includes(tsv.split('\n')[0], '\t');
      assert.excludes(tsv.split('\n')[0], ',');
    });
  });

  describe('export shapes', () => {
    test('a count exports its 1x1 table', () => {
      const r = rig('count');
      r.w.runQuery();
      assert.equal(r.app.serialiseTable(r.entry(r.o.id).table, ',', true).split('\n').length, 2);
    });

    test('a breakdown exports one row per course', () => {
      const r = rig('courses');
      r.w.runQuery();
      const t = r.entry(r.o.id).table;
      const csv = r.app.serialiseTable(t, ',', true);
      assert.equal(csv.split('\n').length, t.rows.length + 1);
      assert.includes(csv.split('\n')[0], 'Course');
    });

    test('the enrolments export is long format, one row per student-course pair', () => {
      const r = rig('rows');
      r.w.runQuery();
      r.w.saveEnrolments(r.o.id, r.doc.createElement('button'));
      const file = r.saved[r.saved.length - 1];
      const expected = r.app.STUDENTS.reduce((a, s) => a + s.courses.length, 0);
      assert.equal(file.content.split('\n').length - 1, expected);
      assert.includes(file.content.split('\n')[0], 'Mark');
      assert.includes(file.name, 'enrolments');
    });

    test('enrolment rows carry the individual marks the student row cannot', () => {
      const r = rig('rows');
      r.w.runQuery();
      r.w.saveEnrolments(r.o.id, r.doc.createElement('button'));
      const lines = r.saved[r.saved.length - 1].content.split('\n');
      const head = lines[0].split(',');
      const markCol = head.indexOf('Mark');
      assert.ok(markCol >= 0);
      const first = lines[1].split(',');
      assert.ok(/^\d+$/.test(first[markCol]), 'mark should be a bare number');
    });
  });

  describe('file naming', () => {
    test('the name typed beside Save is used', () => {
      const r = rig('count');
      r.w.runQuery();
      r.setExportName(r.o.id, 'my-cohort');
      r.w.saveOutput(r.o.id, r.doc.createElement('button'));
      assert.includes(r.saved[r.saved.length - 1].name, 'my-cohort');
    });

    test('the name field appears next to the export buttons, not on the node', () => {
      const r = rig('count');
      r.w.runQuery();
      assert.ok(r.q('.result-actions [data-export-name]'), 'not in the results panel');
      assert.notOk(r.control(r.o.id, 'filename'), 'should no longer be on the node');
    });

    test('the field shows the default as a placeholder', () => {
      const r = rig('count');
      r.w.runQuery();
      assert.equal(r.exportNameField(r.o.id).getAttribute('placeholder'), 'output1');
    });

    test('naming the file does NOT invalidate the results', () => {
      // Otherwise typing a name would block the Save button being named for.
      const r = rig('count');
      r.w.runQuery();
      r.setExportName(r.o.id, 'still-valid');
      assert.ok(r.app.resultsFresh, 'the name has no bearing on what was computed');
      r.w.saveOutput(r.o.id, r.doc.createElement('button'));
      assert.includes(r.saved[r.saved.length - 1].name, 'still-valid');
    });

    test('clearing the name falls back to the default', () => {
      const r = rig('count');
      r.w.runQuery();
      r.setExportName(r.o.id, 'temporary');
      r.setExportName(r.o.id, '   ');
      r.w.saveOutput(r.o.id, r.doc.createElement('button'));
      assert.includes(r.saved[r.saved.length - 1].name, 'output1');
    });

    test('the name persists across a re-run', () => {
      const r = rig('count');
      r.w.runQuery();
      r.setExportName(r.o.id, 'kept');
      r.w.runQuery();
      assert.equal(r.exportNameField(r.o.id).value, 'kept');
      r.w.saveOutput(r.o.id, r.doc.createElement('button'));
      assert.includes(r.saved[r.saved.length - 1].name, 'kept');
    });

    test('the enrolments export uses the same name with a suffix', () => {
      const r = rig('rows');
      r.w.runQuery();
      r.setExportName(r.o.id, 'cohort');
      r.w.saveEnrolments(r.o.id, r.doc.createElement('button'));
      const n = r.saved[r.saved.length - 1].name;
      assert.includes(n, 'cohort');
      assert.includes(n, 'enrolments');
    });

    test('each Output has its own name field', () => {
      const h = boot();
      const [s, f] = h.build('source', 'filter');
      h.w.addNode('output'); const o1 = h.app.nodes[h.app.nodes.length - 1];
      h.w.addNode('output'); const o2 = h.app.nodes[h.app.nodes.length - 1];
      h.app.connect(f.id, o1.id); h.app.connect(f.id, o2.id);
      h.w.render(); h.w.runQuery();
      h.setExportName(o1.id, 'first');
      h.setExportName(o2.id, 'second');
      h.w.saveOutput(o1.id, h.doc.createElement('button'));
      h.w.saveOutput(o2.id, h.doc.createElement('button'));
      assert.includes(h.saved[h.saved.length - 2].name, 'first');
      assert.includes(h.saved[h.saved.length - 1].name, 'second');
    });

    test('an untouched name falls back to a default', () => {
      const r = rig('count');
      r.w.runQuery();
      r.w.saveOutput(r.o.id, r.doc.createElement('button'));
      assert.includes(r.saved[r.saved.length - 1].name, 'output');
    });

    test('path separators and illegal characters are stripped', () => {
      const { app } = boot();
      assert.equal(app.safeName('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
      assert.equal(app.safeName('  spaced  out  '), 'spaced-out');
      assert.equal(app.safeName(''), 'output');
      assert.equal(app.safeName('///'), 'output');
    });

    test('saved files end in .csv and carry a timestamp', () => {
      const r = rig('count');
      r.w.runQuery();
      r.w.saveOutput(r.o.id, r.doc.createElement('button'));
      const name = r.saved[r.saved.length - 1].name;
      assert.ok(/\.csv$/.test(name), name);
      assert.ok(/\d{4}-\d{2}-\d{2}/.test(name), name);
    });
  });

  describe('the staleness guard', () => {
    test('results are fresh immediately after a run', () => {
      const r = rig('count');
      r.w.runQuery();
      assert.ok(r.app.resultsFresh);
      assert.notOk(r.doc.getElementById('panelBody').classList.contains('stale'));
    });

    test('editing any config invalidates them', () => {
      const r = rig('count');
      r.w.runQuery();
      r.set(r.f.id, 'crit.0.value:gradeAvg', '50');
      assert.notOk(r.app.resultsFresh);
      assert.ok(r.doc.getElementById('panelBody').classList.contains('stale'));
    });

    test('adding a node invalidates them', () => {
      const r = rig('count');
      r.w.runQuery();
      r.w.addNode('filter');
      assert.notOk(r.app.resultsFresh);
    });

    test('removing a connection invalidates them', () => {
      const r = rig('count');
      r.w.runQuery();
      r.w.runQuery();
      const c = r.app.connections[0];
      r.app.connections.splice(0, 1);
      r.app.markStale();
      assert.notOk(r.app.resultsFresh);
    });

    test('copy and save are blocked while stale', () => {
      const r = rig('count');
      r.w.runQuery();
      r.set(r.f.id, 'crit.0.value:gradeAvg', '50');
      const b1 = r.doc.createElement('button'); r.w.copyOutput(r.o.id, b1);
      const b2 = r.doc.createElement('button'); r.w.saveOutput(r.o.id, b2);
      assert.equal(b1.textContent, 'Re-run first');
      assert.equal(b2.textContent, 'Re-run first');
      assert.equal(r.copied.length, 0);
    });

    test('re-running clears the block', () => {
      const r = rig('count');
      r.w.runQuery();
      r.set(r.f.id, 'crit.0.value:gradeAvg', '50');
      r.w.runQuery();
      const b = r.doc.createElement('button'); r.w.copyOutput(r.o.id, b);
      assert.equal(r.copied.length, 1);
    });
  });

  describe('clipboard', () => {
    test('copy writes tab-separated text', () => {
      const r = rig('rows');
      r.w.runQuery();
      r.w.copyOutput(r.o.id, r.doc.createElement('button'));
      assert.equal(r.copied.length, 1);
      assert.includes(r.copied[0], '\t');
    });
  });
};
