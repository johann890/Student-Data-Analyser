/* One Source node, any number of columns.

   The supervisor's ruling of 2026-09-24, in his words:

     "having just one source node that is capable of reading data from a file
      with various numbers of columns seems more parsimonious and simpler. Users
      would not have to wonder which node kind they'll need. A single Source
      node kind can automatically adapt to whatever the input format is."

     "I don't think the notion of misshaped data should exist, only feeding in
      the wrong format to another node should result in an error or warning (the
      latter, if it can be rectified by ignoring data, or otherwise
      automatically fixing the mismatch)."

     "We do not need to cater for misshaped input. The input files all come from
      a certain source and will always have the right format."

   So the archive's column list stopped deciding WHETHER a file may be read and
   started deciding HOW: a header carrying those columns is the archive and its
   rows fold into students; any other header describes a table and its rows come
   through as they are.

   WHAT DID NOT GO, AND IS ASSERTED HERE
   The size cap, the control-character refusal, the row and field caps and the
   path-segment stripping all stay. They do not reject a differently shaped
   file, they reject a hostile one, and his ruling is about shape. Every cell
   that survives this module still reaches the DOM. The suite asserts they are
   still in force, because relaxing an admission layer is exactly the change
   that takes the wrong things with it. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

const ARCHIVE_NAMES = 'ID gender deg1 maj1 Year Crse Grade Pts';

module.exports = ({ describe, test }) => {

  const A = boot().app;
  const named = (name, size) => ({ name, size: size === undefined ? 10 : size });

  function rig() {
    const h = boot();
    const [s, o] = h.build('source', 'output');
    return { ...h, s, o };
  }

  // A header and a data file, loaded the way the pickers load them.
  async function loadTable(h, nodeId, headerName, headerText, dataName, dataText) {
    const hr = await h.loadHeaders(nodeId, h.file(headerName, headerText));
    if (hr.err) throw new Error('header: ' + hr.err);
    const dr = await h.loadYears(nodeId, h.file(dataName, dataText));
    return dr;
  }

  const BANDS_HEADER = 'Band Lowest Highest';
  const BANDS_ROWS = 'Fail\t0\t4\nPass\t4\t6\nMerit\t6\t8\nExcellent\t8\t9\n';

  describe('the header naming scheme', () => {
    test('the plain name is still a column file', () => {
      assert.equal(A.headersFileProblem(named('headers.txt')), null);
      assert.ok(A.isHeaderFileName('headers.txt'));
    });

    test('and the qualified one, which is what lets a folder hold several', () => {
      assert.equal(A.headersFileProblem(named('headers-gpa-bands.txt')), null);
      assert.equal(A.headersFileProblem(named('headers-course-labels.txt')), null);
      assert.ok(A.isHeaderFileName('headers-anything at all.txt'));
    });

    test('anything else is not a column file', () => {
      ['header.txt', 'headers', 'headers.csv', 'my-headers.txt', 'headers-.csv']
        .forEach(n => assert.ok(A.headersFileProblem(named(n)), n + ' should be refused'));
    });

    test('the scheme reads both ways', () => {
      assert.equal(A.headerNameFor('gpa-bands.txt'), 'headers-gpa-bands.txt.txt');
      assert.equal(A.headerTargetOf('headers-gpa-bands.txt'), 'gpa-bands');
      assert.equal(A.headerTargetOf('headers.txt'), '',
        'the plain form names no particular data file');
    });

    test('a data file may be called anything that is not a column file', () => {
      ['course-labels.txt', 'gpa-bands', 'bands.csv', 'mcs-students-2022']
        .forEach(n => assert.equal(A.dataFileProblem(named(n)), null, n));
      assert.ok(A.dataFileProblem(named('headers.txt')),
        'the two pickers being used the wrong way round is worth naming');
    });
  });

  describe('what the columns decide', () => {
    const parse = (text) => A.parseHeaderFile(text, 'headers.txt');

    test('the archive\'s columns mean students', () => {
      assert.ok(A.headerIsArchive(parse(ARCHIVE_NAMES)));
    });

    test('one column short of them means a table', () => {
      assert.notOk(A.headerIsArchive(parse('ID gender deg1 maj1 Year Crse Grade')));
    });

    test('a single column is a header, and a table', () => {
      const p = parse('Course');
      assert.notOk(p.error);
      assert.deepEqual(p.columns, ['Course']);
      assert.notOk(A.headerIsArchive(p));
    });

    test('extra columns beyond the archive\'s are still the archive', () => {
      assert.ok(A.headerIsArchive(parse(ARCHIVE_NAMES + ' Sem Email')));
    });

    test('a header with nothing in it is still refused', () => {
      assert.ok(parse('').error);
      assert.ok(parse('  \n \n').error);
    });

    test('and one past the column ceiling', () => {
      const wide = Array.from({ length: A.MAX_HEADER_COLUMNS + 1 }, (_, i) => 'c' + i).join(' ');
      assert.ok(parse(wide).error);
    });

    test('the index line is still checked when it is there', () => {
      assert.ok(parse('A B C\n1 2\n').error, 'three names numbered two is a contradiction');
      assert.ok(parse('A B C\n1 3 2\n').error, 'out of order');
      assert.notOk(parse('A B C\n1 2 3\n').error);
    });
  });

  describe('the separator is worked out, not demanded', () => {
    const sep = (line, width) => A.detectSeparator([line], width).label;

    test('tabs, which the archive uses', () => {
      assert.equal(sep('a\tb\tc', 3), 'tabs');
    });

    test('commas', () => {
      assert.equal(sep('a,b,c', 3), 'commas');
    });

    test('spaces, which is what somebody typing a band file will use', () => {
      assert.equal(sep('Fail 0 4', 3), 'spaces');
    });

    test('tab wins over comma when both would split, so a tabbed file with commas survives', () => {
      assert.equal(sep('a,1\tb,2\tc,3', 3), 'tabs');
    });

    test('nothing that fits falls back to tabs rather than guessing widest', () => {
      assert.equal(sep('a b c d e', 3), 'tabs');
    });
  });

  describe('column types are inferred, which is what bands depend on', () => {
    const typeOf = (rows) => A.inferColumnType(rows.map(v => [v]), 0);

    test('a column of numbers is a number column', () => {
      assert.equal(typeOf(['1', '2', '3']), A.COLTYPE.NUMBER);
    });

    test('decimals, negatives and exponents count as numbers', () => {
      assert.equal(typeOf(['-1.5', '.25', '1e3', '+7']), A.COLTYPE.NUMBER);
    });

    test('one non-number makes the whole column text', () => {
      assert.equal(typeOf(['1', '2', 'n/a']), A.COLTYPE.TEXT);
    });

    test('blanks do not spoil it', () => {
      assert.equal(typeOf(['1', '', '3']), A.COLTYPE.NUMBER);
    });

    test('a column of nothing is text, not a guess about absent data', () => {
      assert.equal(typeOf(['', '', '']), A.COLTYPE.TEXT);
    });
  });

  describe('reading a table file', () => {
    const header = (names) => A.parseHeaderFile(names, 'headers-x.txt');
    const read = (names, text) => A.parseTableFile(text, header(names), 'x.txt');

    test('rows come through as they are, one per line', () => {
      const t = read(BANDS_HEADER, BANDS_ROWS);
      assert.notOk(t.error);
      assert.equal(t.rows.length, 4);
      assert.deepEqual(t.rows[0], ['Fail', 0, 4]);
    });

    test('the numeric columns arrive as numbers, not as text that looks numeric', () => {
      const t = read(BANDS_HEADER, BANDS_ROWS);
      assert.deepEqual(t.columns.map(c => c.type),
        [A.COLTYPE.TEXT, A.COLTYPE.NUMBER, A.COLTYPE.NUMBER]);
      assert.equal(typeof t.rows[0][1], 'number');
    });

    test('a space-separated file reads the same way', () => {
      const t = read(BANDS_HEADER, 'Fail 0 4\nPass 4 6\n');
      assert.equal(t.rows.length, 2);
      assert.deepEqual(t.rows[1], ['Pass', 4, 6]);
      assert.equal(t.separator, 'spaces');
    });

    test('blank lines are skipped rather than becoming empty rows', () => {
      const t = read(BANDS_HEADER, 'Fail\t0\t4\n\n   \nPass\t4\t6\n');
      assert.equal(t.rows.length, 2);
    });

    test('a short row is padded and said out loud, not refused', () => {
      const t = read(BANDS_HEADER, 'Fail\t0\t4\nPass\t4\n');
      assert.notOk(t.error, 'refusing the file is the behaviour that was overruled');
      assert.deepEqual(t.rows[1], ['Pass', 4, '']);
      assert.equal(t.warnings.length, 1);
      assert.includes(t.warnings[0], 'padded or trimmed');
    });

    test('a long row is trimmed and said out loud', () => {
      const t = read(BANDS_HEADER, 'Fail\t0\t4\tspare\n');
      assert.notOk(t.error);
      assert.deepEqual(t.rows[0], ['Fail', 0, 4]);
      assert.includes(t.warnings[0], 'padded or trimmed');
    });

    test('an over-long field is cut and said out loud', () => {
      const long = 'x'.repeat(A.MAX_FIELD_CHARS + 50);
      const t = read(BANDS_HEADER, long + '\t0\t4\n');
      assert.equal(t.rows[0][0].length, A.MAX_FIELD_CHARS);
      assert.ok(t.warnings.some(w => w.indexOf('cut') !== -1));
    });

    test('a file with no rows is refused, because there is nothing to read', () => {
      assert.ok(read(BANDS_HEADER, '').error);
      assert.ok(read(BANDS_HEADER, '\n\n  \n').error);
    });

    test('control characters are still refused: that guard is not about shape', () => {
      assert.ok(read(BANDS_HEADER, 'Fail\t0\t\u0000\n').error);
    });

    test('more rows than the tool will read is still refused', () => {
      /* Built with repeat() rather than an array of a quarter of a million
         strings: the array version held ~250k live strings AND the joined
         result at once, which was enough to exhaust the heap when this suite
         ran after thirty others in the same process. The guard is what is under
         test, not the way the input is assembled. */
      const many = 'a\t1\t2\n'.repeat(A.MAX_DATA_ROWS + 1);
      assert.ok(read(BANDS_HEADER, many).error);
    });

    test('column keys are safe to put in a selector, and never collide', () => {
      const t = read('My Band  Low %  Low %', 'a\t1\t2\n');
      const keys = t.columns.map(c => c.key);
      keys.forEach(k => assert.ok(/^[A-Za-z0-9_]+$/.test(k), k + ' is not selector-safe'));
      assert.equal(new Set(keys).size, keys.length, 'two columns cannot share a key');
      assert.deepEqual(t.columns.map(c => c.label), ['My', 'Band', 'Low', '%', 'Low', '%'],
        'the label keeps whatever the header said');
    });
  });

  describe('a Source holding a table', () => {
    async function tableSource() {
      const h = rig();
      const r = await loadTable(h, h.s.id, 'headers-gpa-bands.txt', BANDS_HEADER,
                                'gpa-bands.txt', BANDS_ROWS);
      if (r.err) throw new Error('loading the table failed: ' + r.err);
      return h;
    }

    test('the dataset knows which shape it is', async () => {
      const h = await tableSource();
      const d = h.app.sourceData()[h.s.id];
      assert.equal(h.app.datasetKind(d), 'table');
      assert.ok(h.app.isTableDataset(d));
    });

    test('and the Source emits the file, not students', async () => {
      const h = await tableSource();
      h.w.runQuery();
      const t = h.entry(h.o.id).table;
      assert.deepEqual(t.columns.map(c => c.label), ['Band', 'Lowest', 'Highest']);
      assert.equal(t.rows.length, 4);
      assert.deepEqual(t.rows[0], ['Fail', 0, 4]);
    });

    test('the header it declares is the header it emits', async () => {
      const h = await tableSource();
      const declared = h.app.computeSchemas()[h.s.id];
      h.w.runQuery();
      assert.deepEqual(declared.columns.map(c => c.key),
        h.entry(h.o.id).table.columns.map(c => c.key));
      assert.deepEqual(declared.columns.map(c => c.type),
        h.entry(h.o.id).table.columns.map(c => c.type));
    });

    test('a one-column file is not described as having a separator', async () => {
      /* There was no separator to choose, so naming one reads as a decision the
         tool did not make. A label list is exactly the one-column case. */
      const h = rig();
      const r = await loadTable(h, h.s.id, 'headers-labels.txt', 'Course',
                                'labels.txt', 'COMP103\nSWEN221\n');
      assert.notOk(r.err);
      h.w.render();
      const t = h.q('.node-config').textContent.replace(/\s+/g, ' ');
      assert.includes(t, '2 rows of 1 column');
      assert.excludes(t, 'separated by');
    });

    test('but a multi-column one is, because that one could have gone wrong', async () => {
      const h = await tableSource();
      h.w.render();
      assert.includes(h.q('.node-config').textContent.replace(/\s+/g, ' '), 'separated by tabs');
    });

    test('the log names the file and what came out of it', async () => {
      const h = await tableSource();
      h.w.runQuery();
      const l = h.entry(h.o.id).log.join('\n');
      assert.includes(l, 'gpa-bands.txt');
      assert.includes(l, '4 rows');
    });

    test('a downstream Sort cannot reorder the Source\'s own held rows', async () => {
      const h = await tableSource();
      const srt = h.add('sort');
      h.app.connect(h.s.id, srt.id);
      h.w.render();
      h.w.runQuery();
      const held = h.app.sourceData()[h.s.id].rows.map(r => r[0]);
      assert.deepEqual(held, ['Fail', 'Pass', 'Merit', 'Excellent'],
        'the rows handed on have to be a copy, or a re-run reports something else');
    });

    test('choosing several files at once is refused with a reason', async () => {
      const h = rig();
      const hr = await h.loadHeaders(h.s.id, h.file('headers-x.txt', BANDS_HEADER));
      assert.notOk(hr.err);
      const dr = await h.loadYears(h.s.id,
        [h.file('a.txt', BANDS_ROWS), h.file('b.txt', BANDS_ROWS)]);
      assert.ok(dr.err);
      assert.includes(dr.err, 'one of those at a time');
    });

    test('the registries do not try to read students out of it', async () => {
      /* This is a regression test for a real hang, not a hypothetical. The
         registries are the archive's vocabulary and walk every loaded dataset's
         students; a table has none, so the walk threw inside the FileReader
         callback and the loader's `done` was never called. Nothing reported an
         error, because nothing caught one: the page simply stopped mid-load.
         Asserting the load COMPLETES is the assertion that matters. */
      const h = await tableSource();
      assert.ok(h.app.sourceData()[h.s.id], 'the load has to finish, not hang');
      assert.deepEqual(h.app.YEARS.filter(y => y === null), [],
        'a table must not put anything in the year registry');
    });

    test('a second file replaces the first rather than stacking on it', async () => {
      const h = await tableSource();
      const dr = await h.loadYears(h.s.id, h.file('other.txt', 'Solo\t1\t2\n'));
      assert.notOk(dr.err);
      h.w.runQuery();
      assert.equal(h.entry(h.o.id).table.rows.length, 1);
    });
  });

  describe('the archive is untouched by any of it', () => {
    test('its header still reads as the archive', function () {
      const h = boot();
      assert.ok(A.headerIsArchive(A.parseHeaderFile(ARCHIVE_NAMES, 'headers.txt')));
    });

    test('its year files keep their strict naming rule', () => {
      assert.equal(A.yearFileProblem(named('mcs-students-2022')), null);
      ['mcs-students-2022.txt', 'students-2022', 'mcs-students-22']
        .forEach(n => assert.ok(A.yearFileProblem(named(n)), n + ' should still be refused'));
    });

    test('a Source given the archive still emits students', async () => {
      const h = rig();
      await h.loadArchive(h.s.id, [2022]);
      h.w.runQuery();
      const t = h.entry(h.o.id).table;
      assert.includes(t.columns.map(c => c.key), 'courses');
      assert.equal(h.app.datasetKind(h.app.sourceData()[h.s.id]), 'archive');
    });

    test('and a non-archive file is refused on the archive\'s own path', async () => {
      const h = rig();
      const hr = await h.loadHeaders(h.s.id, h.archiveFile('headers.txt'));
      assert.notOk(hr.err);
      const dr = await h.loadYears(h.s.id, h.file('course-labels.txt', 'a\tb\n'));
      assert.ok(dr.err, 'the archive header means archive files');
    });
  });

  describe('the panel follows the shape', () => {
    const text = (h) => h.q('.node-config').textContent.replace(/\s+/g, ' ').trim();

    test('an archive Source offers Rows and Population', async () => {
      const h = rig();
      await h.loadArchive(h.s.id, [2022]);
      h.w.render();
      assert.ok(h.q('[data-node="' + h.s.id + '"][data-key="grain"]'));
      assert.ok(h.q('[data-node="' + h.s.id + '"][data-key="pop"]'));
    });

    test('a table Source offers neither, because it has neither', async () => {
      const h = rig();
      await loadTable(h, h.s.id, 'headers-x.txt', BANDS_HEADER, 'x.txt', BANDS_ROWS);
      h.w.render();
      assert.notOk(h.q('[data-node="' + h.s.id + '"][data-key="grain"]'),
        'a table has no students, so there is no grain to choose');
      assert.notOk(h.q('[data-node="' + h.s.id + '"][data-key="pop"]'),
        'and no years to narrow to');
    });

    test('it states the header it is handing on, and which columns are numbers', async () => {
      const h = rig();
      await loadTable(h, h.s.id, 'headers-x.txt', BANDS_HEADER, 'x.txt', BANDS_ROWS);
      h.w.render();
      const t = text(h);
      assert.includes(t, '4 rows');
      assert.includes(t, 'Lowest');
      assert.includes(t, 'as a number');
    });

    test('before anything is loaded it still describes the archive', () => {
      const h = rig();
      h.w.render();
      assert.ok(h.q('[data-node="' + h.s.id + '"][data-key="grain"]'),
        'the common case is the archive, so an empty Source names that');
    });
  });

  describe('it travels with the query', () => {
    test('the table file\'s name is remembered, so a reopened query asks for it', async () => {
      const h = rig();
      await loadTable(h, h.s.id, 'headers-gpa-bands.txt', BANDS_HEADER,
                      'gpa-bands.txt', BANDS_ROWS);
      const d = h.app.datasetCfg(h.app.findNode(h.s.id));
      assert.equal(d.file, 'gpa-bands.txt');
      assert.equal(d.headers, 'headers-gpa-bands.txt');
      assert.deepEqual(d.years, [], 'a table has no years to remember');
    });

    test('and not one byte of what was in it', async () => {
      const h = rig();
      await loadTable(h, h.s.id, 'headers-gpa-bands.txt', BANDS_HEADER,
                      'gpa-bands.txt', BANDS_ROWS);
      const json = JSON.stringify(h.app.serialiseGraph());
      assert.includes(json, 'gpa-bands.txt');
      assert.excludes(json, 'Excellent', 'the contents stay out of the file');
    });

    test('a query saved before any of this still names its year files', () => {
      const h = boot();
      const g = { kind: 'student-data-analyser-query', version: 1,
        nodes: [{ id: 1, type: 'source', x: 5, y: 5,
                  cfg: { pop: 'all', dataset: { headers: 'headers.txt', years: [2022] } } }],
        connections: [] };
      const r = h.app.deserialiseGraph(JSON.stringify(g));
      assert.notOk(r.error, r.error);
      const d = h.app.datasetCfg(r.nodes[0]);
      assert.deepEqual(d.years, [2022]);
      assert.equal(d.file, '', 'the new field defaults rather than breaking the old shape');
    });
  });

  describe('the point of the whole change: bands from a file', () => {
    test('a three-column band file reaches SelectFor as bands', async () => {
      const h = boot();
      const [dsrc, sf, out] = h.build('source', 'selectFor', 'output');
      const lsrc = h.add('source');
      h.app.connect(lsrc.id, sf.id, null, 'labels');
      h.w.render();

      await h.loadArchive(dsrc.id, [2022]);
      const r = await loadTable(h, lsrc.id, 'headers-gpa-bands.txt', BANDS_HEADER,
                                'gpa-bands.txt', BANDS_ROWS);
      assert.notOk(r.err, 'the band file must load: ' + r.err);
      h.w.render();

      const lt = h.app.computeSchemas()[lsrc.id];
      assert.ok(h.app.labelsAreBands(lt),
        'a file of name, lowest, highest is what a band table is');

      h.set(sf.id, 'by', 'gpa');
      h.w.runQuery();

      const t = h.entry(out.id).table;
      assert.deepEqual(t.rows.map(r2 => r2[0]), ['Fail', 'Pass', 'Merit', 'Excellent']);
      assert.equal(t.columns[0].label, 'GPA');
      assert.includes(h.entry(out.id).log.join('\n'), 'in named bands');

      const counted = t.rows.reduce((a, r2) => a + r2[1], 0);
      assert.ok(counted > 0, 'the bands have to actually catch students');
    });
  });
};
