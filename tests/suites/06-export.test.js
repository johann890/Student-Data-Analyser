/* Export.
   Results leave this tool as text for Excel, so the delimiting and quoting have
   to be exactly right: A single unescaped comma silently shifts a column. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  function rig(show) {
    const h = boot();
    const [s, f, o] = h.build('source', 'filter', 'output');
    h.set(f.id, 'crit.0.value:gpa', '0');   // keep everyone
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

    /* Three tests (the per-course breakdown export, and the separate
       long-format enrolments export (saveEnrolments)) went with those features
       in 52d5e6a. The shapes they checked, one row per group and one row per
       student-course pair, become reachable again through the unfold node
       app.js:238 specifies. Restore them with it. */
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

    test('saved files end in .csv and carry NO timestamp', () => {
      /* Reversed deliberately. The appended timestamp meant the name field
         never actually decided the filename: two saves of "grades" produced
         two differently-named files, and a user who had just named the file
         could not predict what they would get. The name written is now the
         name typed, which is what queryFileName() already did for saved
         queries, so the two export paths finally agree. */
      const r = rig('count');
      r.w.runQuery();
      r.w.saveOutput(r.o.id, r.doc.createElement('button'));
      const name = r.saved[r.saved.length - 1].name;
      assert.ok(/\.csv$/.test(name), name);
      assert.ok(!/\d{4}-\d{2}-\d{2}/.test(name), 'a date should not be appended: ' + name);
    });

    test('a second Save writes the same name again', () => {
      // The reviewer's actual request: having named the file once, saving
      // again should not produce a different one.
      const r = rig('count');
      r.w.runQuery();
      r.setExportName(r.o.id, 'cohort-2022');
      const btn = r.doc.createElement('button');
      r.w.saveOutput(r.o.id, btn);
      const first = r.saved[r.saved.length - 1].name;
      assert.equal(first, 'cohort-2022.csv');
      r.w.saveOutput(r.o.id, btn);
      assert.equal(r.saved[r.saved.length - 1].name, first);
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
      r.set(r.f.id, 'crit.0.value:gpa', '50');
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
      r.set(r.f.id, 'crit.0.value:gpa', '50');
      const b1 = r.doc.createElement('button'); r.w.copyOutput(r.o.id, b1);
      const b2 = r.doc.createElement('button'); r.w.saveOutput(r.o.id, b2);
      assert.equal(b1.textContent, 'Re-run first');
      assert.equal(b2.textContent, 'Re-run first');
      assert.equal(r.copied.length, 0);
    });

    test('re-running clears the block', () => {
      const r = rig('count');
      r.w.runQuery();
      r.set(r.f.id, 'crit.0.value:gpa', '50');
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

  /* ------------------------------------------------- leaving for another tool

     Three things decide whether a result survives the trip into Excel, Word or
     a report, and none of them is visible on screen: whether the separator can
     appear inside a cell, whether the encoding is declared, and whether the
     labels this tool generates are legal where they are going. */
  describe('what leaves here can be read by something else', () => {
    // A cell holding each character that can break a delimited file.
    function hostile(A) {
      return A.makeTable(
        [{ key:'a', label:'Student', type:A.COLTYPE.TEXT },
         { key:'b', label:'Note',    type:A.COLTYPE.TEXT }],
        [['Smith, Jo',     'a comma'],
         ['She said "hi"', 'a quote mark'],
         ['tab\there',     'a tab'],
         ['line\nbreak',   'a newline']]);
    }
    // Fields counted the way a reader counts them: a separator inside quotes
    // does not divide anything.
    function fieldCount(line, sep) {
      var n = 1, inQ = false;
      for (const ch of line) {
        if (ch === '"') inQ = !inQ;
        else if (ch === sep && !inQ) n++;
      }
      return n;
    }
    // Rows, respecting quoted line breaks, so an embedded newline is one row.
    function logicalRows(text) {
      var out = [''], inQ = false;
      for (const ch of text) {
        if (ch === '"') { inQ = !inQ; out[out.length - 1] += ch; continue; }
        if (ch === '\n' && !inQ) { out.push(''); continue; }
        out[out.length - 1] += ch;
      }
      return out.filter(l => l !== '');
    }

    [[',', 'the comma of a saved file'], ['\t', 'the tab of a copied one']].forEach(([sep, what]) => {
      test('a cell can hold ' + what + ' without shifting a column', () => {
        const A = boot().app;
        const text = A.serialiseTable(hostile(A), sep, true);
        const rows = logicalRows(text);
        assert.equal(rows.length, 5, 'four rows and a header, whatever is inside them');
        rows.forEach((l, i) => assert.equal(fieldCount(l, sep), 2,
          'row ' + i + ' should still be two fields: ' + JSON.stringify(l)));
      });
    });

    test('a cell with nothing special in it is not quoted', () => {
      const A = boot().app;
      const plain = A.makeTable([{ key:'a', label:'A', type:A.COLTYPE.TEXT }], [['x']]);
      assert.equal(A.serialiseTable(plain, '\t', true), 'A\nx');
      assert.equal(A.serialiseTable(plain, ',', true), 'A\nx');
    });

    test('quoting follows the separator rather than always the comma', () => {
      const A = boot().app;
      // A comma is ordinary in a tab-separated file and vice versa, so neither
      // should be quoted where it cannot divide anything.
      assert.equal(A.quotedCell('a,b', '\t'), 'a,b');
      assert.equal(A.quotedCell('a\tb', ','), 'a\tb');
      assert.equal(A.quotedCell('a,b', ','), '"a,b"');
      assert.equal(A.quotedCell('a\tb', '\t'), '"a\tb"');
    });

    test('a saved CSV declares UTF-8, so Excel on Windows reads a macron', () => {
      const r = rig('rows');
      r.w.runQuery();
      r.w.saveOutput(r.o.id, r.doc.createElement('button'));
      const content = r.saved[r.saved.length - 1].content;
      assert.equal(content.slice(0, 1), r.app.UTF8_BOM, 'the CSV should start with a BOM');
      assert.equal(content.slice(1, 2) === r.app.UTF8_BOM, false, 'exactly one BOM');
    });

    /* The BOM must NOT spread to the other thing this tool downloads. A saved
       query is JSON and JSON.parse refuses a leading BOM, so a marker added in
       the wrong place would have broken every saved query to fix an encoding
       problem the CSV has and this file does not. */
    test('a saved query carries no BOM and still parses', () => {
      const r = rig('rows');
      r.w.runQuery();
      r.w.saveGraph(r.doc.createElement('button'));
      r.doc.getElementById('saveName').value = 'a query';
      r.w.confirmSaveGraph();
      const f = r.saved[r.saved.length - 1];
      assert.excludes(f.content.slice(0, 1), r.app.UTF8_BOM);
      assert.ok(JSON.parse(f.content), 'the query file should still be JSON');
    });

    test('the clipboard is text, so it carries no BOM', () => {
      const r = rig('rows');
      r.w.runQuery();
      r.w.copyOutput(r.o.id, r.doc.createElement('button'));
      assert.excludes(r.copied[r.copied.length - 1].slice(0, 1), r.app.UTF8_BOM);
    });

    /* A per cent sign starts a comment in LaTeX, so a header carrying one loses
       the rest of its line when the table is pasted into a report, silently.
       The only label this tool generated with one in it was the percent
       measure's, and it spells the word out now. */
    test('no generated measure label carries a per cent sign', () => {
      const A = boot().app;
      A.ROW_PAIR_OPS.forEach(op => assert.excludes(op.sym, '%',
        op.key + ' puts a per cent sign in a column header'));
    });
  });
};
