/* Export.
   Results leave this tool as text for Excel, so the delimiting and quoting have
   to be exactly right: A single unescaped comma silently shifts a column. */

const { boot, appStyles } = require('../lib/harness');
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

       Every measure table is swept rather than the one that was found first.
       Checking ROW_PAIR_OPS alone is what let SelectFor's share measure keep a
       "Share %" header through the fix that was supposed to remove exactly
       that, and it was found by exporting every result shape rather than by
       this test, which is the wrong way round.

       The fields are the ones that can REACH a header: `head`, `label` and
       `verb` are what selectForColumns() and Compare's measureColumns() build a
       column name out of, and `sym` is what a pair measure names itself. `pick`
       is deliberately not here: it names a control on the panel, is never
       exported, and still reads "As % of" because on screen the sign is the
       clearest thing to write. */
    test('no measure label that can reach a column header carries a per cent sign', () => {
      const A = boot().app;
      const TABLES = {
        AGG_OPS: A.AGG_OPS, SELECTFOR_OPS: A.SELECTFOR_OPS,
        ROW_OPS: A.ROW_OPS, ROW_PAIR_OPS: A.ROW_PAIR_OPS, MEASURES: A.MEASURES
      };
      const EXPORTED = ['head', 'label', 'verb', 'sym'];
      Object.keys(TABLES).forEach(name => {
        assert.ok(Array.isArray(TABLES[name]), name + ' should be exported for this check');
        TABLES[name].forEach(op => EXPORTED.forEach(field => {
          if (op[field] === undefined) return;
          assert.excludes(String(op[field]), '%',
            name + '.' + op.key + '.' + field + ' puts a per cent sign in a column header');
        }));
      });
    });

    /* The other half of the same claim, made against real output rather than
       against the tables: whatever a measure is called, the bytes that leave
       must not carry the character. A breakdown with a share measure is the
       shape that had it. */
    test('a share breakdown exports without one', () => {
      const h = boot();
      const [s, sf, o] = h.build('source', 'selectFor', 'output');
      h.set(sf.id, 'by', 'specialisation'); h.w.render();
      h.set(sf.id, 'stat.0.op', 'share'); h.w.render();
      h.w.runQuery();
      h.w.saveOutput(o.id, h.doc.createElement('button'));
      const csv = h.saved[h.saved.length - 1].content;
      assert.includes(csv.split('\n')[0], 'Share');
      assert.excludes(csv, '%');
    });

  /* ------------------------------------------------- choosing a format

     Copy and Save each have the format beside them. The two defaults ARE the
     old behaviour, which is the property most worth pinning: every query written
     before the dropdowns existed has to copy tabs and save CSV without anyone
     touching a control. */
  describe('the format beside each button', () => {
    function panelRig() {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.value:gpa', '0');
      h.set(o.id, 'show', 'rows');
      h.w.runQuery();
      return { ...h, s, f, o };
    }
    const pick = (r, which, value) => {
      const el = r.q('[data-export-format="' + r.o.id + '"][data-export-which="' + which + '"]');
      assert.ok(el, 'no ' + which + ' format control in the panel');
      el.value = value;
      el.dispatchEvent(new r.w.Event('change', { bubbles: true }));
      return el;
    };
    const save = (r) => {
      r.w.saveOutput(r.o.id, r.doc.createElement('button'));
      return r.saved[r.saved.length - 1];
    };
    const copy = (r) => {
      r.w.copyOutput(r.o.id, r.doc.createElement('button'));
      return r.copied[r.copied.length - 1];
    };

    test('both menus offer every declared format, in one order', () => {
      const r = panelRig();
      ['copy', 'save'].forEach(which => {
        const el = r.q('[data-export-format="' + r.o.id + '"][data-export-which="' + which + '"]');
        assert.deepEqual([...el.options].map(o => o.value),
          r.app.EXPORT_FORMATS.map(f => f.key), which + ' offers a different set');
      });
    });

    test('untouched, they are what Copy and Save always did', () => {
      const r = panelRig();
      assert.equal(r.app.copyFormatOf(r.app.findNode(r.o.id)).key, 'tsv');
      assert.equal(r.app.saveFormatOf(r.app.findNode(r.o.id)).key, 'csv');
      assert.includes(copy(r), '\t');
      const f = save(r);
      assert.includes(f.name, '.csv');
      assert.equal(f.content.slice(0, 1), r.app.UTF8_BOM);
    });

    test('the extension follows the save format', () => {
      const r = panelRig();
      assert.equal(r.q('.result-block .export-ext').textContent, '.csv');
      pick(r, 'save', 'latex');
      assert.equal(r.q('.result-block .export-ext').textContent, '.tex');
      assert.includes(save(r).name, '.tex');
      pick(r, 'save', 'html');
      assert.includes(save(r).name, '.html');
    });

    test('a LaTeX file carries no BOM, because only the CSV wants one', () => {
      const r = panelRig();
      pick(r, 'save', 'latex');
      const f = save(r);
      assert.excludes(f.content.slice(0, 1), r.app.UTF8_BOM);
      assert.includes(f.content, '\\begin{tabular}');
    });

    /* The reason the HTML format exists. PowerPoint decides what a paste becomes
       by asking for text/html first, so offering the markup as plain text would
       paste the markup. Both flavours go out, and the plain one is never lost. */
    test('copying as HTML offers text/html, with plain text alongside', () => {
      const r = panelRig();
      pick(r, 'copy', 'html');
      r.w.copyOutput(r.o.id, r.doc.createElement('button'));
      const flavours = r.copiedRich[r.copiedRich.length - 1];
      assert.ok(flavours, 'nothing was written to the clipboard');
      assert.includes(flavours['text/html'], '<table');
      assert.includes(flavours['text/html'], '<th');
      assert.ok(flavours['text/plain'] !== undefined, 'no plain text alongside the markup');
    });

    test('the other formats stay plain text, with no flavour claimed', () => {
      const r = panelRig();
      const before = r.copiedRich.length;
      ['tsv', 'csv', 'latex'].forEach(k => {
        pick(r, 'copy', k);
        r.w.copyOutput(r.o.id, r.doc.createElement('button'));
      });
      assert.equal(r.copiedRich.length, before, 'a plain format should not claim a flavour');
    });

    test('copying as CSV is the file without the BOM', () => {
      const r = panelRig();
      pick(r, 'copy', 'csv');
      const text = copy(r);
      assert.excludes(text.slice(0, 1), r.app.UTF8_BOM);
      assert.includes(text.split('\n')[0], ',');
    });

    test('a format choice does not invalidate the run', () => {
      const r = panelRig();
      assert.ok(r.app.resultsFresh);
      pick(r, 'copy', 'latex');
      pick(r, 'save', 'html');
      assert.ok(r.app.resultsFresh, 'picking a format must not ask for a re-run');
      // And the buttons still work, which is what staleness would have taken away.
      assert.ok(save(r).content);
    });

    test('the choice survives a save and reload', () => {
      const r = panelRig();
      pick(r, 'copy', 'html');
      pick(r, 'save', 'latex');
      const json = JSON.stringify(r.app.serialiseGraph());
      r.w.clearAll();
      r.app.loadGraphFromText(json, r.doc.createElement('button'));
      const out = r.app.nodes.filter(n => n.type === 'output')[0];
      assert.equal(r.app.copyFormatOf(out).key, 'html');
      assert.equal(r.app.saveFormatOf(out).key, 'latex');
    });

    test('a format name this build does not have falls back rather than failing', () => {
      const r = panelRig();
      const node = r.app.findNode(r.o.id);
      node.cfg.copyAs = 'parquet';
      node.cfg.saveAs = { not: 'a string' };
      assert.equal(r.app.copyFormatOf(node).key, 'tsv');
      assert.equal(r.app.saveFormatOf(node).key, 'csv');
      assert.ok(save(r).content, 'it should still export something');
    });
  });

  /* ------------------------------------------------------- the two new writers */
  describe('LaTeX, where the characters matter', () => {
    const esc = (A, v) => A.latexEscape(v);

    test('every active character is escaped', () => {
      const A = boot().app;
      assert.equal(esc(A, 'R&D'), 'R\\&D');
      assert.equal(esc(A, '50%'), '50\\%');
      assert.equal(esc(A, '#3'), '\\#3');
      assert.equal(esc(A, 'a_b'), 'a\\_b');
      assert.equal(esc(A, '$5'), '\\$5');
      assert.equal(esc(A, '{x}'), '\\{x\\}');
      assert.equal(esc(A, '~'), '\\textasciitilde{}');
      assert.equal(esc(A, '^'), '\\textasciicircum{}');
    });

    /* The ordering bug this had on the first attempt: replacing the backslash in
       place introduced braces, and the brace pass then escaped them, so a
       backslash typeset as a stray pair of braces. */
    test('a backslash becomes a backslash, not an escaped pair of braces', () => {
      const A = boot().app;
      assert.equal(esc(A, 'a\\b'), 'a\\textbackslash{}b');
      assert.excludes(esc(A, 'a\\b'), '\\textbackslash\\{');
    });

    /* The two non-ASCII characters this tool generates in its own headers. Mapped
       to maths rather than passed through, which is what lets the output compile
       in a document that does not read UTF-8. */
    test('the characters this tool generates become maths, so the file is ASCII', () => {
      const A = boot().app;
      assert.equal(esc(A, 'Count \u00b7 Select For #3'), 'Count $\\cdot$ Select For \\#3');
      assert.equal(esc(A, 'Passed \u00f7 Enrolled'), 'Passed $\\div$ Enrolled');
      const t = A.makeTable(
        [{ key:'a', label:'Count \u00b7 Select For #3', type:A.COLTYPE.TEXT },
         { key:'b', label:'Passed \u00f7 Enrolled', type:A.COLTYPE.NUMBER }],
        [['R&D 50% _x_', 1.5]]);
      assert.notOk(/[^\x09\x0A\x20-\x7E]/.test(A.latexTable(t)),
        'the LaTeX should be pure ASCII');
    });

    test('a newline in a cell becomes a space, because a tabular cell cannot hold one', () => {
      const A = boot().app;
      assert.equal(esc(A, 'line\nbreak'), 'line break');
    });

    test('the column spec aligns numbers right and everything else left', () => {
      const A = boot().app;
      const t = A.makeTable(
        [{ key:'a', label:'A', type:A.COLTYPE.TEXT },
         { key:'b', label:'B', type:A.COLTYPE.NUMBER },
         { key:'c', label:'C', type:A.COLTYPE.NUMBER }], []);
      assert.includes(A.latexTable(t), '\\begin{tabular}{lrr}');
    });

    test('it is a fragment with rules, and says what it is', () => {
      const A = boot().app;
      const t = A.makeTable([{ key:'a', label:'A', type:A.COLTYPE.TEXT }], [['x']]);
      const tex = A.latexTable(t);
      assert.includes(tex, '% Student Data Analyser export');
      assert.includes(tex, '\\hline');
      assert.includes(tex, '\\textbf{A}');
      assert.includes(tex, 'x \\\\');
      assert.includes(tex, '\\end{tabular}');
    });
  });

  /* The one thing jsdom cannot see for itself. Every select in this tool sets
     `appearance: none`, so none of them draws the browser's own arrow. A select
     in a config panel gets away with it: it is full width in a labelled row and
     nothing else there looks like that. These two sit against a button, at
     button size, so with no mark of their own they read as a second button that
     does nothing when clicked, which is the kind of thing the usability round
     scored badly on. Asserted against the stylesheet text because jsdom does no
     painting and would report the rule either way. */
  describe('a format menu looks like a menu', () => {
    test('the stylesheet gives it an arrow of its own', () => {
      const css = appStyles();
      const rule = css.slice(css.indexOf('.rfmt {'), css.indexOf('}', css.indexOf('.rfmt {')));
      assert.ok(rule, 'no .rfmt rule in the stylesheet');
      assert.includes(rule, 'svg', 'the format select draws no arrow, so it reads as a button');
      assert.includes(rule, 'padding', 'the arrow needs room, or it sits on the text');
    });
  });

  describe('HTML, for pasting into a slide', () => {
    test('it is a real table, headed and escaped', () => {
      const A = boot().app;
      const t = A.makeTable(
        [{ key:'a', label:'A & B', type:A.COLTYPE.TEXT }],
        [['<script>']]);
      const html = A.htmlTable(t);
      assert.includes(html, '<table');
      assert.includes(html, '<th');
      assert.includes(html, 'A &amp; B');
      assert.includes(html, '&lt;script&gt;');
      assert.excludes(html, '<script>');
    });

    test('a heading is aligned the way its column is', () => {
      const A = boot().app;
      const t = A.makeTable(
        [{ key:'a', label:'A', type:A.COLTYPE.TEXT },
         { key:'b', label:'B', type:A.COLTYPE.NUMBER }],
        [['x', 1]]);
      const html = A.htmlTable(t);
      assert.includes(html, '<th align="left">A</th>');
      assert.includes(html, '<th align="right">B</th>');
      assert.includes(html, '<td align="right">1</td>');
    });

    test('borders are attributes, so they survive the paste', () => {
      const A = boot().app;
      const t = A.makeTable([{ key:'a', label:'A', type:A.COLTYPE.TEXT }], [['x']]);
      assert.includes(A.htmlTable(t), 'border="1"');
    });
  });


  });
};
