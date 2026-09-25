/* The edge data preview.
   Hovering a connection shows what is flowing along it. The panel is small and
   floating, so it shows a capped slice rather than the whole table, and the
   cap is paired with a width in the stylesheet, which is the thing most likely
   to drift. These tests hold the two together. */

const { boot, appStyles } = require('../lib/harness');
const { assert } = require('../lib/assert');

const CSS = appStyles();

module.exports = ({ describe, test }) => {

  const A = boot().app;
  const T = A.COLTYPE;
  const cols = n => Array.from({ length: n },
    (_, i) => ({ key: 'c' + i, label: 'C' + i, type: T.NUMBER }));
  const headers = html => (html.match(/<th[ >]/g) || []).length;

  describe('the cap and the box are sized together', () => {
    test('the stylesheet declares a width for the preview', () => {
      assert.ok(/\.edge-preview\s*\{[\s\S]*?width:\s*\d+px/.test(CSS));
    });

    test('width and max-width agree', () => {
      const m = CSS.match(/\.edge-preview\s*\{[\s\S]*?width:\s*(\d+)px;\s*max-width:\s*(\d+)px/);
      assert.ok(m, 'both should be declared together');
      assert.equal(m[1], m[2]);
    });

    test('the columns fit the box without getting thinner than they were', () => {
      /* box-sizing is border-box globally, so the declared width includes the
         9px side padding and the 1px border; table-layout:fixed then divides
         what is left, less the 18px "more columns" marker, evenly.

         The point of raising the cap was more columns, NOT thinner ones. The
         four-column layout at 230px is the baseline to beat. Assert it rather
         than eyeballing the result, because nothing else would notice the cap
         being raised on its own. */
      const w = Number(CSS.match(/\.edge-preview\s*\{[\s\S]*?width:\s*(\d+)px/)[1]);
      const perCol = (px, n) => ((px - 18 - 2) - 18) / n;
      const before = perCol(230, 4);
      const after  = perCol(w, A.PREVIEW_COLS);
      assert.ok(after >= before,
        `${after.toFixed(1)}px/col at ${w}px is narrower than the old ${before.toFixed(1)}px`);
      assert.ok(after - 10 >= 35,
        `${(after - 10).toFixed(1)}px of text per cell after padding is too little to read`);
    });
  });

  describe('how much is shown', () => {
    test('a table narrower than the cap shows every column', () => {
      const t = A.makeTable(cols(3), [[1, 2, 3]]);
      assert.equal(A.previewColumns(t).length, 3);
      assert.excludes(A.previewTableHTML(t), 'ep-more-col',
        'nothing is hidden, so nothing should claim to be');
    });

    test('a table exactly at the cap shows every column', () => {
      const t = A.makeTable(cols(A.PREVIEW_COLS), [cols(A.PREVIEW_COLS).map((_, i) => i)]);
      assert.equal(A.previewColumns(t).length, A.PREVIEW_COLS);
      assert.excludes(A.previewTableHTML(t), 'ep-more-col');
    });

    test('one column over the cap is capped, and says so', () => {
      const n = A.PREVIEW_COLS + 1;
      const t = A.makeTable(cols(n), [cols(n).map((_, i) => i)]);
      assert.equal(A.previewColumns(t).length, A.PREVIEW_COLS);
      assert.includes(A.previewTableHTML(t), 'ep-more-col');
      assert.equal(headers(A.previewTableHTML(t)), A.PREVIEW_COLS + 1, 'data headers plus the marker');
    });

    test('the student table shows all but its widest column', () => {
      // Asserted against the schema rather than against a literal, so a column
      // added to the Source moves this test's expectation with it instead of
      // failing it. What is being checked is the CAP, not the width.
      const t = A.studentsTable(A.STUDENTS);
      assert.equal(t.columns.length, A.STUDENT_COLUMNS.length);
      assert.ok(t.columns.length > A.PREVIEW_COLS, 'or there is nothing to drop');
      assert.equal(A.previewColumns(t).length, A.PREVIEW_COLS);
    });

    test('rows are capped as well as columns', () => {
      const t = A.studentsTable(A.STUDENTS);
      const bodyRows = (A.previewTableHTML(t).match(/<tr>/g) || []).length - 1;  // less the header
      assert.equal(bodyRows, A.PREVIEW_ROWS);
      assert.ok(t.rows.length > A.PREVIEW_ROWS, 'the table must actually be longer');
    });

    test('an empty table renders a header and no rows, not an error', () => {
      const t = A.makeTable(cols(3), []);
      const html = A.previewTableHTML(t);
      assert.equal(headers(html), 3);
      assert.equal((html.match(/<tr>/g) || []).length, 1, 'header only');
    });
  });

  describe('which columns are shown', () => {
    test('long free-text columns yield to shorter ones', () => {
      /* A course title or a specialisation fills the panel and says least about
         whether the right rows are flowing. */
      const keys = A.previewColumns(A.studentsTable(A.STUDENTS)).map(c => c.key);
      assert.excludes(keys, 'letterGrade', 'the TEXT column should be the one dropped');
      assert.includes(keys, 'id');
      assert.includes(keys, 'gpa');
    });

    test('the table\'s own order is kept, not the order they were picked in', () => {
      const t = A.studentsTable(A.STUDENTS);
      const picked = A.previewColumns(t).map(c => c.key);
      const inOrder = t.columns.map(c => c.key).filter(k => picked.includes(k));
      assert.deepEqual(picked, inOrder);
    });

    test('every cell carries its full value as a tooltip, since display truncates', () => {
      const html = A.previewTableHTML(A.studentsTable(A.STUDENTS.slice(0, 1)));
      const cells = html.match(/<td[^>]*>/g) || [];
      cells.filter(c => !c.includes('ep-more-col'))
           .forEach(c => assert.includes(c, 'title=', 'a truncated cell needs its tooltip'));
    });
  });

  describe('on a real edge', () => {
    test('edgeData resolves a wired connection', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      const res = h.app.edgeData(h.app.connections[0]);
      assert.notOk(res.error);
      assert.notOk(res.incomplete);
      assert.ok(res.table.rows.length > 0);
    });

    test('an edge with no path to a Source reports that rather than guessing', () => {
      const h = boot();
      const f = h.add('filter'), o = h.add('output');
      h.app.connect(f.id, o.id);
      h.w.render();
      assert.ok(h.app.edgeData(h.app.connections[0]).incomplete);
    });

    test('the widest table the tool can build is capped, not overflowed', () => {
      // A join carries both inputs' headers, which is what the cap exists for
      const h = boot();
      const s = h.add('source'), f = h.add('filter'), sel = h.add('select'),
            c = h.add('combine'), o = h.add('output');
      h.app.connect(s.id, f.id);  h.app.connect(s.id, sel.id);
      h.app.connect(f.id, c.id);  h.app.connect(sel.id, c.id);
      h.app.connect(c.id, o.id);
      h.w.render();
      h.set(c.id, 'mode', 'join');
      h.w.render();

      const joined = h.app.evaluateGraph().res[c.id].table;
      assert.ok(joined.columns.length > A.PREVIEW_COLS,
        'the join should be wider than the cap: ' + joined.columns.length);
      const html = h.app.previewTableHTML(joined);
      assert.equal(headers(html), A.PREVIEW_COLS + 1);
      assert.includes(html, 'ep-more-col');
    });

    test('the marker appears in the body as well as the header, so columns line up', () => {
      const n = A.PREVIEW_COLS + 2;
      const t = A.makeTable(cols(n), [cols(n).map((_, i) => i), cols(n).map((_, i) => i)]);
      const html = A.previewTableHTML(t);
      assert.equal((html.match(/<td class="ep-more-col">/g) || []).length, 2, 'one per body row');
    });
  });
};
