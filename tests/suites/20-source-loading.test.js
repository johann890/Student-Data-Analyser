/* THE SOURCE, FROM THE PICKER TO THE ANSWER.

   Suite 19 proves what the parser will and will not accept. This one proves
   what the application does with it: that a Source refuses to run before it has
   files, that the two pickers are ordered, that a Source owns its own data and
   not its neighbour's, and (the part this feature was asked for), that saving
   a query saves the graph and not the records, so loading one asks for the
   files again.

   Everything here goes through the shipped code, including the real FileReader,
   which is why these tests are async. Where a test drives the hidden <input>
   directly it is standing exactly where the browser stands after a pick: files
   on the element, `change` dispatched. Nothing is stubbed on the way in. */

const { boot, dataDirFile, hasDataDir } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {
  const t = boot();
  const { app, w, doc, saved } = t;

  const HDR = hasDataDir() ? dataDirFile('headers.txt') : null;

  /* Every test starts from an empty canvas with no data anywhere. State inside
     the IIFE is module-global, so without this a test would inherit whatever
     the one before it loaded, which is the exact confusion these tests are
     about. */
  function reset() {
    w.clearAll();
    app.clearAllSourceData();
  }

  const src = () => { reset(); const [s] = t.build('source'); return s; };
  const chain = () => { reset(); return t.build('source', 'output'); };
  const resultText = () => doc.getElementById('panelBody').textContent.replace(/\s+/g, ' ').trim();
  /* A node's element carries no id of its own (render() keeps that mapping in a
     closure), so the node is found through a control inside it, which is the
     same handle every other helper in the harness uses. */
  const panelOf = (id) => {
    const ctl = doc.querySelector('[data-node="' + id + '"]');
    const el = ctl && ctl.closest('.node');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  };

  /* Run a block with the built-in dataset stood down, which is the state a
     shipped page is always in: no test flag, so no fallback, so a Source has
     nothing at all until someone hands it files. Restored afterwards even if
     the block throws, or one failing assertion would take the rest of the
     suite (which runs against the synthetic data) down with it. */
  function asShipped(fn) {
    const syn = app.syntheticDataset();
    app.setSyntheticDataset(null);
    try { return fn(); }
    finally { app.setSyntheticDataset(syn); }
  }

  /* ══ 1. A SOURCE WITHOUT FILES ═════════════════════════════════════════════
     The premise of the whole feature: no data until someone supplies it. */
  describe('a Source with no files is not an empty Source', () => {
    test('the built-in dataset is reachable only from the test flag', () => {
      // If this ever comes back as null the suites below are asserting against
      // nothing; if a shipped page ever gets one, the feature is not doing its
      // job. The flag is the only thing that separates the two.
      assert.ok(app.syntheticDataset(), 'the harness sets __QB_TEST__, so it is installed');
      assert.ok(app.syntheticDataset().synthetic, 'and it is marked as what it is');
    });

    test('with the fallback stood down, a Source answers with an error', () => {
      const [s] = chain();
      asShipped(() => {
        const out = app.sourceTable(app.findNode(s.id), []);
        assert.ok(out.error, 'not an empty table');
        assert.notOk(out.table, 'and not a table at all');
        assert.includes(out.error, 'headers.txt');
      });
    });

    test('an empty table would be a claim about the cohort, so none is produced', () => {
      // The distinction the error exists to preserve: "no students matched" and
      // "this tool has no data" are different answers, and only one of them is
      // about the university.
      const [s, o] = chain();
      asShipped(() => {
        w.runQuery();
        assert.notOk(t.entry(o.id), 'no Output entry at all');
        assert.includes(resultText(), 'no data');
        assert.excludes(resultText(), '0 students');
      });
      assert.ok(s, 'the Source is still on the canvas, waiting for its files');
    });

    test('the run is refused before anything is evaluated', () => {
      const [s, o] = chain();
      asShipped(() => {
        w.runQuery();
        assert.notOk(app.resultsFresh, 'a refusal is not a result');
        const msg = resultText();
        assert.includes(msg, '#' + s.id, 'the Source is named');
        assert.includes(msg, 'year files');
        assert.ok(o);
      });
    });

    test('the refusal names the node and says what to do about it', () => {
      const node = { id: 7, type: 'source', cfg: { pop: 'all', dataset: { headers: '', years: [] } } };
      const msg = app.sourceDataError(node);
      assert.includes(msg, '#7');
      assert.includes(msg, 'headers.txt');
      assert.includes(msg, 'year files');
    });

    test('a query that knows which files it wants says so in the refusal', () => {
      const node = { id: 3, type: 'source',
        cfg: { pop: 'all', dataset: { headers: 'headers.txt', years: [2022, 2023] } } };
      const msg = app.sourceDataError(node);
      assert.includes(msg, 'mcs-students-2022');
      assert.includes(msg, 'mcs-students-2023');
    });

    test('the ring on the canvas and hasSourceData() never disagree', () => {
      const s = src();
      const ring = () => doc.querySelector('.shape-source').classList.contains('no-data');
      assert.equal(ring(), !app.hasSourceData(app.findNode(s.id)));
      asShipped(() => {
        w.render();
        assert.equal(ring(), !app.hasSourceData(app.findNode(s.id)));
        assert.ok(ring(), 'and with no fallback it is definitely marked');
      });
    });
  });

  /* ══ 2. THE TWO PICKERS, IN ORDER ══════════════════════════════════════════ */
  describe('the column file comes first, and the panel says why', () => {
    test('a year file offered before a header is refused with the reason', async () => {
      if (!hasDataDir()) return;
      const s = src();
      const { err } = await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      assert.ok(err, 'it should not be read');
      assert.includes(err, 'headers.txt');
      assert.notOk(app.sourceData()[s.id], 'and nothing should have been stored');
    });

    test('the year button is disabled until a header is in hand', async () => {
      if (!hasDataDir()) return;
      const s = src();
      const btns = () => [...doc.querySelectorAll('.node .src-btn')];
      assert.equal(btns().length, 2, 'one button per step');
      assert.ok(btns()[1].disabled, 'step 2 is unavailable');
      assert.includes(panelOf(s.id), 'has to come first', 'and the panel says why');

      await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      assert.notOk(btns()[1].disabled, 'and available once step 1 is done');
    });

    test('accepting a header describes what was read', async () => {
      if (!hasDataDir()) return;
      const s = src();
      const { err, header } = await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      assert.notOk(err, err);
      assert.equal(header.columns.length, 27);
      assert.includes(panelOf(s.id), '27 columns');
      assert.equal(app.sourceNotice(s.id).kind, 'ok');
    });

    test('a header on its own is not yet a dataset', async () => {
      if (!hasDataDir()) return;
      const s = src();
      await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      assert.ok(app.headerFor(s.id), 'the header is held');
      assert.notOk(app.sourceData()[s.id], 'but there is nothing to query yet');
    });

    test('a refused header leaves the Source exactly as it was', async () => {
      if (!hasDataDir()) return;
      const s = src();
      await t.loadArchive(s.id, [2022]);
      const before = app.sourceData()[s.id];

      const { err } = await t.loadHeaders(s.id, t.file('columns.txt', HDR));
      assert.ok(err, 'the wrong name is refused');
      assert.equal(app.sourceData()[s.id], before, 'and the loaded data is untouched');
      assert.equal(app.sourceNotice(s.id).kind, 'error');
      assert.includes(panelOf(s.id), 'columns.txt', 'the panel names the file it refused');
    });

    test('a NEW header discards year files read against the old one', async () => {
      if (!hasDataDir()) return;
      const s = src();
      await t.loadArchive(s.id, [2022]);
      assert.ok(app.sourceData()[s.id]);

      await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      assert.notOk(app.sourceData()[s.id],
        'rows parsed against one column list must not be kept under another');
      assert.deepEqual(app.datasetCfg(app.findNode(s.id)).years, []);
    });
  });

  /* ══ 3. LOADING, THROUGH THE ACTUAL CONTROLS ═══════════════════════════════ */
  describe('loading the archive', () => {
    test('the hidden inputs the pickers drive are in the page', () => {
      const h = doc.getElementById('headersFile');
      const y = doc.getElementById('yearFiles');
      assert.ok(h, 'headersFile');
      assert.ok(y, 'yearFiles');
      assert.ok(y.multiple, 'several year files are chosen at once');
      assert.notOk(y.getAttribute('accept'),
        'the year files have no extension, so there is nothing for accept to match');
    });

    test('choosing files on the input loads them, exactly as a real pick would', async () => {
      if (!hasDataDir()) return;
      const s = src();

      t.choose('headersFile', s.id, t.archiveFile('headers.txt'));
      await t.waitFor(() => app.headerFor(s.id), 'the change listener to read the header');

      t.choose('yearFiles', s.id,
        [t.archiveFile('mcs-students-2022'), t.archiveFile('mcs-students-2023')]);
      const d = await t.waitFor(() => app.sourceData()[s.id], 'the year files to be read');
      assert.deepEqual(d.years, [2022, 2023]);
    });

    test('the archive loads with the counts the files actually hold', async () => {
      if (!hasDataDir()) return;
      const s = src();
      const d = await t.loadArchive(s.id, [2022, 2023]);
      assert.equal(d.files[0].rows, 2170);
      assert.equal(d.files[1].rows, 1956);
      assert.equal(d.students.length, d.files.reduce((n, f) => n + f.students, 0));
    });

    test('the panel names the files and counts what came in', async () => {
      if (!hasDataDir()) return;
      const s = src();
      await t.loadArchive(s.id, [2022, 2023]);
      const p = panelOf(s.id);
      assert.includes(p, 'headers.txt');
      assert.includes(p, 'mcs-students-2022');
      assert.includes(p, 'mcs-students-2023');
      assert.includes(p, '4126 rows', 'the two year files, added up');
    });

    test('the years offered are the years this Source was given', async () => {
      if (!hasDataDir()) return;
      const s = src();
      await t.loadArchive(s.id, [2022]);
      assert.deepEqual(t.optionsOf(s.id, 'pop'), ['all', '2022'],
        'not 2023, which this Source has never seen');
    });

    test('the same year twice in one selection is refused', async () => {
      if (!hasDataDir()) return;
      const s = src();
      await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      const f = t.archiveFile('mcs-students-2022');
      const { err } = await t.loadYears(s.id, [f, f]);
      assert.ok(err);
      assert.includes(err, '2022');
    });

    test('one bad file in a selection refuses the whole selection', async () => {
      if (!hasDataDir()) return;
      const s = src();
      await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      const { err } = await t.loadYears(s.id, [
        t.archiveFile('mcs-students-2022'),
        t.file('mcs-students-2024.txt', 'anything')
      ]);
      assert.ok(err, 'all or nothing');
      assert.notOk(app.sourceData()[s.id],
        'a half-loaded Source would answer about a cohort nobody asked for');
    });

    test('a renamed file is refused on its contents, not only on its name', async () => {
      if (!hasDataDir()) return;
      // The name says 2023; the rows say 2022. The name check passes and the
      // agreement check is what catches it.
      const s = src();
      await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      const { err } = await t.loadYears(s.id,
        [t.file('mcs-students-2023', dataDirFile('mcs-students-2022'))]);
      assert.ok(err, 'renaming a file must not change which year it is');
      assert.includes(err, 'named for 2023');
    });

    test('unloading gives the Source back its empty state', async () => {
      if (!hasDataDir()) return;
      const s = src();
      await t.loadArchive(s.id, [2022]);
      app.clearSourceData(s.id);
      assert.notOk(app.sourceData()[s.id]);
      assert.notOk(app.headerFor(s.id));
      assert.deepEqual(app.datasetCfg(app.findNode(s.id)), { headers: '', years: [], file: '' });
    });
  });

  /* ══ 3b. MANY YEAR FILES, ONE HEADER ═══════════════════════════════════════
     One header describes the shape of every year file, so a Source has exactly
     one of those. The years themselves are a collection: choosing more adds to
     what is held, choosing a year already held replaces that year, and each one
     can be taken back off on its own.

     The archive carries two years, which is not enough to tell "added" from
     "replaced" apart from "there are two of them now". The rest are made by
     rewriting the Year column of the real 2022 export, so they are genuine
     files by every rule in the parser (same 27 columns, same tab separation,
     same rows) differing only in the one field the file name has to agree
     with. */
  const YEAR_COL = 8;
  function yearFileFor(year) {
    const body = dataDirFile('mcs-students-2022')
      .split('\n')
      .map(line => {
        if (!line.trim()) return line;
        const f = line.split('\t');
        f[YEAR_COL] = String(year) + '01';
        return f.join('\t');
      })
      .join('\n');
    return t.file('mcs-students-' + year, body);
  }

  // A Source with its header loaded and nothing else. The starting point for
  // every test below, because all of them are about step 2.
  async function withHeader() {
    const s = src();
    const { err } = await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
    if (err) throw new Error('arranging the header failed: ' + err);
    return s;
  }

  const yearsHeld = (id) => (app.sourceData()[id] || { years: [] }).years;
  const yearRows = () => [...doc.querySelectorAll('.src-year')];

  describe('year files accumulate rather than replacing each other', () => {
    test('a second pick adds to the first', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();

      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      assert.deepEqual(yearsHeld(s.id), [2022]);

      await t.loadYears(s.id, t.archiveFile('mcs-students-2023'));
      assert.deepEqual(yearsHeld(s.id), [2022, 2023],
        'the second pick must not discard the first');
    });

    test('pick after pick after pick', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      for (const y of [2022, 2023, 2024, 2025]) {
        const { err } = await t.loadYears(s.id,
          y <= 2023 ? t.archiveFile('mcs-students-' + y) : yearFileFor(y));
        assert.notOk(err, 'loading ' + y + ': ' + err);
      }
      assert.deepEqual(yearsHeld(s.id), [2022, 2023, 2024, 2025]);
    });

    test('several files in one pick still land together', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [
        t.archiveFile('mcs-students-2022'),
        t.archiveFile('mcs-students-2023'),
        yearFileFor(2024)
      ]);
      assert.deepEqual(yearsHeld(s.id), [2022, 2023, 2024]);
    });

    test('a pick of several merges with a pick of several', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [yearFileFor(2019), yearFileFor(2020)]);
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'), yearFileFor(2024)]);
      assert.deepEqual(yearsHeld(s.id), [2019, 2020, 2022, 2024]);
    });

    test('the years are ordered by year, not by when they were chosen', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, yearFileFor(2025));
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      await t.loadYears(s.id, yearFileFor(2019));
      assert.deepEqual(yearsHeld(s.id), [2019, 2022, 2025]);
      assert.deepEqual(app.sourceData()[s.id].files.map(f => f.name),
        ['mcs-students-2019', 'mcs-students-2022', 'mcs-students-2025']);
    });

    test('the students are the union, and every row keeps its own year', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      const after2022 = app.sourceData()[s.id].students.length;

      await t.loadYears(s.id, t.archiveFile('mcs-students-2023'));
      const d = app.sourceData()[s.id];
      assert.ok(d.students.length > after2022, 'the second year added students');
      assert.equal(d.students.length, d.files.reduce((n, f) => n + f.students, 0),
        'and the total is exactly the files added up');

      const byYear = {};
      d.students.forEach(st => { byYear[st.year] = (byYear[st.year] || 0) + 1; });
      assert.equal(byYear[2022], d.files[0].students);
      assert.equal(byYear[2023], d.files[1].students);
    });

    test('a student appearing in two loaded years is two rows, as designed', async () => {
      if (!hasDataDir()) return;
      // 2024 here is the 2022 export with its Year column rewritten, so every
      // student in it is also in 2022. A row is a student IN A YEAR.
      const s = await withHeader();
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'), yearFileFor(2024)]);
      const d = app.sourceData()[s.id];
      const ids = d.students.filter(st => st.id === 300107735);
      assert.equal(ids.length, 2, 'once per year');
      assert.deepEqual(ids.map(st => st.year).sort(), [2022, 2024]);
    });

    test('the totals never drift from the files behind them', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      await t.loadYears(s.id, yearFileFor(2024));
      await t.loadYears(s.id, t.archiveFile('mcs-students-2023'));

      const d = app.sourceData()[s.id];
      assert.equal(d.parsed.length, d.files.length, 'one parsed year per listed file');
      assert.deepEqual(d.parsed.map(p => p.year), d.years);
      assert.equal(d.students.length,
        d.parsed.reduce((n, p) => n + p.students.length, 0),
        'the flattened students are exactly what the parsed years hold');
    });

    test('the notice says what was added', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      await t.loadYears(s.id, t.archiveFile('mcs-students-2023'));
      const n = app.sourceNotice(s.id);
      assert.equal(n.kind, 'ok');
      assert.includes(n.text, 'Added 2023');
      assert.includes(n.text, '2 year files', 'and how many are held now');
    });
  });

  describe('choosing a year already held replaces that year', () => {
    test('the count does not grow, and the other years are untouched', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023')]);
      const before = app.sourceData()[s.id].students.length;

      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      assert.deepEqual(yearsHeld(s.id), [2022, 2023], 'still two years');
      assert.equal(app.sourceData()[s.id].students.length, before,
        'holding the cohort twice would count it twice');
    });

    test('the rows kept are the new file\'s, not the old one\'s', async () => {
      if (!hasDataDir()) return;
      // The only reason to re-pick a year is a corrected export, so the second
      // file has to win. A three-row 2022 replacing the real one proves it.
      const s = await withHeader();
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      assert.equal(app.sourceData()[s.id].files[0].rows, 2170);

      const trimmed = dataDirFile('mcs-students-2022')
        .split('\n').filter(l => l.trim()).slice(0, 3).join('\n') + '\n';
      await t.loadYears(s.id, t.file('mcs-students-2022', trimmed));

      const d = app.sourceData()[s.id];
      assert.equal(d.files.length, 1);
      assert.equal(d.files[0].rows, 3, 'the corrected export replaced the original');
    });

    test('the notice distinguishes a replacement from an addition', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'), yearFileFor(2024)]);

      const n = app.sourceNotice(s.id);
      assert.includes(n.text, 'Added 2024');
      assert.includes(n.text, 'Replaced 2022',
        'a substitution the user did not ask for out loud should not be silent');
    });

    test('two files for the same year in ONE pick is still refused', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      const f = t.archiveFile('mcs-students-2022');
      const { err } = await t.loadYears(s.id, [f, f]);
      assert.ok(err, 'there is no way to tell which was meant');
      assert.includes(err, '2022');
      assert.notOk(app.sourceData()[s.id], 'and nothing was loaded');
    });

    test('a same-year collision in a pick does not disturb what is held', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, t.archiveFile('mcs-students-2023'));
      const f = t.archiveFile('mcs-students-2022');
      const { err } = await t.loadYears(s.id, [f, f]);
      assert.ok(err);
      assert.deepEqual(yearsHeld(s.id), [2023], 'the earlier pick survives');
    });
  });

  describe('a refused pick leaves the loaded years exactly as they were', () => {
    test('one bad file in a later pick adds none of them', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));

      const { err } = await t.loadYears(s.id, [
        yearFileFor(2024),
        t.file('mcs-students-2025.txt', 'anything')   // refused on its name
      ]);
      assert.ok(err);
      assert.deepEqual(yearsHeld(s.id), [2022],
        '2024 was fine, and is still not loaded — all or nothing within a pick');
    });

    test('a file refused on its contents is refused the same way', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));

      const { err } = await t.loadYears(s.id, [
        yearFileFor(2024),
        t.file('mcs-students-2025', dataDirFile('mcs-students-2023'))  // wrong year inside
      ]);
      assert.ok(err);
      assert.includes(err, 'named for 2025');
      assert.deepEqual(yearsHeld(s.id), [2022]);
    });

    test('a Source cannot exceed the year-file limit', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      const many = [];
      for (let y = 2000; y < 2000 + app.MAX_YEAR_FILES; y++) many.push(yearFileFor(y));
      const first = await t.loadYears(s.id, many);
      assert.notOk(first.err, first.err);
      assert.equal(yearsHeld(s.id).length, app.MAX_YEAR_FILES);

      const { err } = await t.loadYears(s.id, yearFileFor(2050));
      assert.ok(err, 'one more is refused');
      assert.includes(err, String(app.MAX_YEAR_FILES));
      assert.equal(yearsHeld(s.id).length, app.MAX_YEAR_FILES, 'and nothing changed');
    });

    test('at the limit, replacing a year already held is still allowed', async () => {
      if (!hasDataDir()) return;
      // Replacing does not grow the collection, so the cap has no business
      // blocking a corrected export.
      const s = await withHeader();
      const many = [];
      for (let y = 2000; y < 2000 + app.MAX_YEAR_FILES; y++) many.push(yearFileFor(y));
      await t.loadYears(s.id, many);

      const { err } = await t.loadYears(s.id, yearFileFor(2000));
      assert.notOk(err, err);
      assert.equal(yearsHeld(s.id).length, app.MAX_YEAR_FILES);
    });

    test('the limit matches the one the saved descriptor applies', () => {
      // A Source able to hold a year its own saved query could not name would
      // lose that year on the next round trip.
      assert.equal(app.MAX_YEAR_FILES, 50);
    });
  });

  describe('a year file can be taken back off on its own', () => {
    test('removing one leaves the others', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023'),
                               yearFileFor(2024)]);
      app.removeSourceYear(s.id, 2023);
      assert.deepEqual(yearsHeld(s.id), [2022, 2024]);
    });

    test('the counts and the students follow it out', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023')]);
      const d1 = app.sourceData()[s.id];
      const only2022 = d1.files[0].students;

      app.removeSourceYear(s.id, 2023);
      const d2 = app.sourceData()[s.id];
      assert.equal(d2.students.length, only2022);
      assert.equal(d2.files.length, 1);
      assert.equal(d2.parsed.length, 1);
      d2.students.forEach(st => assert.equal(st.year, 2022));
    });

    test('the saved descriptor follows it out too', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023')]);
      app.removeSourceYear(s.id, 2022);
      assert.deepEqual(app.datasetCfg(app.findNode(s.id)).years, [2023]);
    });

    test('the registries stop offering what the Source no longer holds', async () => {
      if (!hasDataDir()) return;
      reset();
      const s = t.add('source');
      w.render();
      await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'), yearFileFor(2024)]);

      asShipped(() => {
        app.rebuildRegistries();
        assert.includes(app.YEARS, 2024);
        app.removeSourceYear(s.id, 2024);
        assert.excludes(app.YEARS, 2024);
        assert.includes(app.YEARS, 2022);
      });
    });

    test('removing the LAST year keeps the header, so step 2 stays available', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      app.removeSourceYear(s.id, 2022);

      assert.notOk(app.sourceData()[s.id], 'there is nothing to query');
      assert.ok(app.headerFor(s.id), 'but the column list is still valid');
      const btns = [...doc.querySelectorAll('.node .src-btn')];
      assert.notOk(btns[1].disabled, 'so another year can be chosen straight away');
      assert.includes(app.sourceNotice(s.id).text, 'still loaded');
    });

    test('and the Source can be refilled without re-picking the header', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      app.removeSourceYear(s.id, 2022);
      const { err } = await t.loadYears(s.id, t.archiveFile('mcs-students-2023'));
      assert.notOk(err, err);
      assert.deepEqual(yearsHeld(s.id), [2023]);
    });

    test('removing a year the Source does not hold changes nothing', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      app.removeSourceYear(s.id, 1999);
      assert.deepEqual(yearsHeld(s.id), [2022]);
    });

    test('removing the year the Population names falls back to all students', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023')]);
      t.set(s.id, 'pop', '2023');
      assert.equal(app.findNode(s.id).cfg.pop, '2023');

      app.removeSourceYear(s.id, 2023);
      assert.equal(app.findNode(s.id).cfg.pop, 'all',
        'silently answering about nothing would be the worse option');
    });

    test('unloading everything still takes the header with it', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023')]);
      app.clearSourceData(s.id);
      assert.notOk(app.sourceData()[s.id]);
      assert.notOk(app.headerFor(s.id), 'the two controls mean different things');
    });
  });

  describe('a new header discards every year file, not merely the last', () => {
    test('all of them go, because all of them were read against the old one', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023'),
                               yearFileFor(2024)]);
      assert.equal(yearsHeld(s.id).length, 3);

      await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      assert.notOk(app.sourceData()[s.id],
        'rows parsed against one column list must not be kept under another');
      assert.deepEqual(app.datasetCfg(app.findNode(s.id)).years, []);
    });
  });

  describe('the panel is a list, because the year files are a collection', () => {
    test('one row per loaded year, each with its own remove control', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023'),
                               yearFileFor(2024)]);
      const rows = yearRows();
      assert.equal(rows.length, 3);
      assert.deepEqual(rows.map(r => r.querySelector('.src-year-name').textContent),
        ['mcs-students-2022', 'mcs-students-2023', 'mcs-students-2024']);
      rows.forEach(r => assert.ok(r.querySelector('.src-year-drop'),
        'every year can be removed on its own'));
    });

    test('the remove control on a row actually removes that row\'s year', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023')]);

      /* The handler is an inline attribute, like every other control on a node,
         and jsdom runs the page with scripts outside-only so it will not fire
         one on .click(). Evaluating the attribute's own text is what the
         browser does with it, so this still catches the bug worth catching: a
         button wired to the wrong year, or to a function that is not on
         window. */
      const attr = yearRows()[0].querySelector('.src-year-drop').getAttribute('onclick');
      assert.includes(attr, 'removeSourceYear(' + s.id + ',2022)');
      w.eval(attr);

      assert.deepEqual(yearsHeld(s.id), [2023]);
      assert.equal(yearRows().length, 1);
      assert.equal(yearRows()[0].querySelector('.src-year-name').textContent,
        'mcs-students-2023');
    });

    test('every row is wired to its own year, not to the first', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023'),
                               yearFileFor(2024)]);
      const wired = yearRows().map(r =>
        r.querySelector('.src-year-drop').getAttribute('onclick'));
      assert.deepEqual(wired,
        [2022, 2023, 2024].map(y => 'removeSourceYear(' + s.id + ',' + y + ')'));

      w.eval(wired[1]);   // the middle one
      assert.deepEqual(yearsHeld(s.id), [2022, 2024]);
    });

    test('each row says how many students its file brought', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023')]);
      const counts = yearRows().map(r => r.querySelector('.src-year-count').textContent);
      const files = app.sourceData()[s.id].files;
      assert.deepEqual(counts, files.map(f => f.students + ' students'));
      assert.includes(counts[0], '280', 'the 2022 cohort, as the file holds it');
    });

    test('the step-2 button says Choose, then Add', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      const btn = () => [...doc.querySelectorAll('.node .src-btn')][1];
      assert.equal(btn().textContent, 'Choose');
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      assert.equal(btn().textContent, 'Add',
        'the word for what the control does once there is something to add to');
    });

    test('the summary counts files rather than naming them all in one line', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023')]);
      const p = panelOf(s.id);
      assert.includes(p, '2 year files');
      assert.includes(p, '4126 rows', 'the two files added up');
      assert.includes(p, 'mcs-students-2022', 'and each one is still named, in the list');
      assert.includes(p, 'mcs-students-2023');
    });

    test('at the limit the Add button is unavailable and says why', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      const many = [];
      for (let y = 2000; y < 2000 + app.MAX_YEAR_FILES; y++) many.push(yearFileFor(y));
      await t.loadYears(s.id, many);
      const btn = [...doc.querySelectorAll('.node .src-btn')][1];
      assert.ok(btn.disabled);
      assert.includes(btn.getAttribute('title'), 'most year files');
    });

    test('a loaded query lists every year it wants, not just the first', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s] = t.build('source', 'output');
      await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023'),
                               yearFileFor(2024)]);
      const json = JSON.stringify(app.serialiseGraph());
      assert.ok(app.loadGraphFromText(json, null));

      const s2 = app.nodes.find(n => n.type === 'source');
      assert.deepEqual(s2.cfg.dataset.years, [2022, 2023, 2024]);
      const wanted = yearRows().map(r => r.querySelector('.src-year-name').textContent);
      assert.deepEqual(wanted,
        ['mcs-students-2022', 'mcs-students-2023', 'mcs-students-2024']);
      assert.equal(yearRows().filter(r => r.querySelector('.src-year-drop')).length, 0,
        'nothing is loaded, so there is nothing to remove');
    });
  });

  describe('every accumulated year reaches the answer', () => {
    test('the Population offers all of them', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      await t.loadYears(s.id, t.archiveFile('mcs-students-2023'));
      await t.loadYears(s.id, yearFileFor(2024));
      assert.deepEqual(t.optionsOf(s.id, 'pop'), ['all', '2022', '2023', '2024']);
    });

    test('running covers every year that was added', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, o] = t.build('source', 'output');
      await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      await t.loadYears(s.id, t.archiveFile('mcs-students-2023'));
      w.runQuery();

      const table = t.entry(o.id).table;
      const years = {};
      table.rows.forEach(r => { years[app.cellAt(table, r, 'year')] = true; });
      assert.deepEqual(Object.keys(years).map(Number).sort(), [2022, 2023]);
      assert.equal(table.rows.length, app.sourceData()[s.id].students.length);
    });

    test('the log names every file the answer came from', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, o] = t.build('source', 'output');
      await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      await t.loadYears(s.id, yearFileFor(2024));
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      w.runQuery();

      const log = t.entry(o.id).log.join(' ');
      assert.includes(log, 'mcs-students-2022');
      assert.includes(log, 'mcs-students-2024');
    });

    test('a removed year stops reaching the answer', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, o] = t.build('source', 'output');
      await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      await t.loadYears(s.id, [t.archiveFile('mcs-students-2022'),
                               t.archiveFile('mcs-students-2023')]);
      w.runQuery();
      const both = t.entry(o.id).table.rows.length;

      app.removeSourceYear(s.id, 2023);
      w.runQuery();
      const table = t.entry(o.id).table;
      assert.ok(table.rows.length < both);
      table.rows.forEach(r => assert.equal(app.cellAt(table, r, 'year'), 2022));
    });

    test('a saved query carries all the years and none of the records', async () => {
      if (!hasDataDir()) return;
      const s = await withHeader();
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      await t.loadYears(s.id, t.archiveFile('mcs-students-2023'));
      await t.loadYears(s.id, yearFileFor(2024));

      const json = JSON.stringify(app.serialiseGraph());
      assert.deepEqual(
        JSON.parse(json).nodes.find(n => n.type === 'source').cfg.dataset.years,
        [2022, 2023, 2024]);
      assert.excludes(json, '300107735');
      assert.excludes(json, '@myvuw');
      assert.excludes(json, 'Jennerly');
    });

    test('re-loading all of them answers as it did before', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, o] = t.build('source', 'output');
      await t.loadHeaders(s.id, t.archiveFile('headers.txt'));
      await t.loadYears(s.id, t.archiveFile('mcs-students-2022'));
      await t.loadYears(s.id, t.archiveFile('mcs-students-2023'));
      w.runQuery();
      const before = t.entry(o.id).table.rows.length;

      const json = JSON.stringify(app.serialiseGraph());
      assert.ok(app.loadGraphFromText(json, null));
      const s2 = app.nodes.find(n => n.type === 'source');
      const o2 = app.nodes.find(n => n.type === 'output');

      // Re-picked one at a time, which is not how they were first chosen —
      // accumulation has to make the two routes end in the same place.
      await t.loadHeaders(s2.id, t.archiveFile('headers.txt'));
      await t.loadYears(s2.id, t.archiveFile('mcs-students-2023'));
      await t.loadYears(s2.id, t.archiveFile('mcs-students-2022'));
      w.runQuery();

      assert.equal(t.entry(o2.id).table.rows.length, before);
    });
  });

  /* ══ 4. A SOURCE OWNS ITS FILES ════════════════════════════════════════════ */
  describe('one Source, one dataset', () => {
    test('loading into one Source does not load into another', async () => {
      if (!hasDataDir()) return;
      reset();
      const [a, b] = [t.add('source'), t.add('source')];
      w.render();
      await t.loadArchive(a.id, [2022]);

      assert.ok(app.sourceData()[a.id]);
      assert.notOk(app.sourceData()[b.id], 'b was given nothing and holds nothing');
      assert.equal(app.datasetFor(b), app.syntheticDataset(), 'it falls back, and only that');
    });

    test('two Sources can hold two different years and each answers about its own', async () => {
      if (!hasDataDir()) return;
      reset();
      const [a, b] = [t.add('source'), t.add('source')];
      w.render();
      await t.loadArchive(a.id, [2022]);
      await t.loadArchive(b.id, [2023]);

      const ta = app.sourceTable(app.findNode(a.id), []);
      const tb = app.sourceTable(app.findNode(b.id), []);
      assert.equal(ta.table.rows.length, 280);
      assert.ok(tb.table.rows.length > 0);
      ta.table.rows.forEach(r => assert.equal(app.cellAt(ta.table, r, 'year'), 2022));
      tb.table.rows.forEach(r => assert.equal(app.cellAt(tb.table, r, 'year'), 2023));
    });

    test('deleting a Source takes its data with it', async () => {
      if (!hasDataDir()) return;
      reset();
      const s = t.add('source');
      w.render();
      await t.loadArchive(s.id, [2022]);
      const before = app.STUDENTS.length;
      assert.ok(before > 0);

      w.removeNode(s.id);
      assert.notOk(app.sourceData()[s.id], 'the dataset goes with the node');
      assert.ok(app.STUDENTS.length < before, 'and stops feeding the dropdowns');
    });

    test('the registries are the union, so a dropdown covers the whole canvas', async () => {
      if (!hasDataDir()) return;
      reset();
      const [a, b] = [t.add('source'), t.add('source')];
      w.render();
      await t.loadArchive(a.id, [2022]);
      await t.loadArchive(b.id, [2023]);
      assert.includes(app.YEARS, 2022);
      assert.includes(app.YEARS, 2023);
      assert.ok(app.COURSES.length > 0, 'and the course catalogue comes from the files');
      assert.ok(app.SPECS.length > 0);
    });
  });

  /* ══ 5. THE ANSWER ═════════════════════════════════════════════════════════ */
  describe('running against loaded files', () => {
    test('a Source with files answers with the rows in them', async () => {
      if (!hasDataDir()) return;
      const [s, o] = chain();
      await t.loadArchive(s.id, [2022]);
      w.runQuery();
      const e = t.entry(o.id);
      assert.ok(e, 'the Output produced a result');
      assert.equal(e.table.rows.length, 280);
    });

    test('the log records which files the answer came from', async () => {
      if (!hasDataDir()) return;
      const [s, o] = chain();
      await t.loadArchive(s.id, [2022, 2023]);
      w.runQuery();
      const log = t.entry(o.id).log.join(' ');
      assert.includes(log, 'mcs-students-2022');
      assert.includes(log, 'mcs-students-2023',
        'a query run against one export and one run against another are different runs');
    });

    test('the population narrows to a year the files actually contain', async () => {
      if (!hasDataDir()) return;
      const [s, o] = chain();
      await t.loadArchive(s.id, [2022, 2023]);
      t.set(s.id, 'pop', '2023');
      w.runQuery();
      const table = t.entry(o.id).table;
      table.rows.forEach(r => assert.equal(app.cellAt(table, r, 'year'), 2023));
    });

    test('a population the new files cannot answer falls back rather than emptying', async () => {
      if (!hasDataDir()) return;
      const s = src();
      await t.loadArchive(s.id, [2022, 2023]);
      t.set(s.id, 'pop', '2023');
      assert.equal(app.findNode(s.id).cfg.pop, '2023');

      await t.loadArchive(s.id, [2022]);
      assert.equal(app.findNode(s.id).cfg.pop, 'all',
        'silently answering about nothing would be the worse option');
    });

    test('real rows survive the whole graph, not only the Source', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, f, o] = t.build('source', 'filter', 'output');
      await t.loadArchive(s.id, [2022]);
      t.set(f.id, 'crit.0.field', 'gpa');
      t.set(f.id, 'crit.0.op:gpa', 'gte');
      t.set(f.id, 'crit.0.value:gpa', '7');
      w.runQuery();
      const e = t.entry(o.id);
      assert.ok(e.table.rows.length > 0, 'some students really do average an A-');
      assert.ok(e.table.rows.length < 280, 'and not all of them do');
      e.table.rows.forEach(r => assert.ok(app.cellAt(e.table, r, 'gpa') >= 7));
    });

    test('exporting real rows carries no column the parser dropped', async () => {
      if (!hasDataDir()) return;
      const [s, o] = chain();
      await t.loadArchive(s.id, [2022]);
      w.runQuery();
      const csv = app.serialiseTable(app.exportTableFor(t.entry(o.id)), ',', true);
      assert.excludes(csv, '@', 'no email address should be exportable');
      assert.excludes(csv, 'myvuw');
    });
  });

  /* ══ 6. RUNNING WITHOUT DATA ═══════════════════════════════════════════════
     Driven by taking the fallback away, which is what a real page looks like. */
  describe('Run refuses before it evaluates', () => {
    test('the guard names every starved Source, not just the first', () => {
      // Fixing one and re-running to be told about the next is a poor way to
      // find out there were three.
      reset();
      const a = t.add('source'), b = t.add('source'), o = t.add('output');
      app.connect(a.id, o.id);
      w.render();
      asShipped(() => {
        w.runQuery();
        const msg = resultText();
        assert.includes(msg, '#' + a.id);
        assert.includes(msg, '#' + b.id);
        assert.includes(msg, '2 Source nodes');
      });
    });

    test('one loaded Source does not excuse an unloaded one', async () => {
      if (!hasDataDir()) return;
      reset();
      const [a, b, o] = [t.add('source'), t.add('source'), t.add('output')];
      app.connect(a.id, o.id);
      w.render();
      await t.loadArchive(a.id, [2022]);

      asShipped(() => {
        w.runQuery();
        assert.includes(resultText(), '#' + b.id);
        assert.excludes(resultText(), '#' + a.id, 'the loaded one is not complained about');
      });
    });

    test('a refusal quotes no student data', () => {
      const [s] = chain();
      asShipped(() => {
        w.runQuery();
        const msg = resultText();
        assert.ok(!/\d{9}/.test(msg), 'no student ID');
        assert.excludes(msg, '@', 'no email address');
      });
    });

    test('the canvas marks the Source that cannot run', () => {
      const s = src();
      asShipped(() => {
        w.render();
        const shape = doc.querySelector('.shape-source');
        assert.ok(shape.classList.contains('no-data'),
          'a dashed ring, so an unfinished Source is visible without opening it');
        assert.notOk(app.hasSourceData(app.findNode(s.id)));
      });
    });

    test('the mark is the outline, and leaves the delete button its corner', () => {
      // A badge in the top-right shared the spot with .node-remove, which made
      // it read as something to click. The state is carried by the border, so
      // the shape has exactly one control on it and nothing that looks like a
      // second one.
      const s = src();
      asShipped(() => {
        w.render();
        const shape = doc.querySelector('.shape-source');
        assert.equal(shape.querySelectorAll('.node-remove').length, 1);
        assert.equal(shape.children.length, 1,
          'the remove button, and nothing else layered over it');
        assert.notOk(app.hasSourceData(app.findNode(s.id)));
      });
    });

    test('the population control is unavailable while there are no years', () => {
      const s = src();
      asShipped(() => {
        w.render();
        assert.ok(t.control(s.id, 'pop').disabled,
          'offering a year nothing can answer would be offering an empty result');
        assert.deepEqual(t.optionsOf(s.id, 'pop'), ['all']);
      });
    });

    test('once files are loaded, the same graph runs', async () => {
      if (!hasDataDir()) return;
      const [s, o] = chain();
      asShipped(() => {
        w.runQuery();
        assert.notOk(t.entry(o.id), 'refused while empty');
      });
      await t.loadArchive(s.id, [2022]);
      w.runQuery();
      assert.ok(t.entry(o.id), 'and answers once fed');
      assert.equal(t.entry(o.id).table.rows.length, 280);
    });
  });

  /* ══ 7. SAVE AND LOAD: THE POINT OF ALL OF IT ═════════════════════════════ */
  describe('a saved query holds the graph and not the records', () => {
    /* A floor rather than an exact number. What this suite is entitled to
       assume is that the dataset descriptor exists, which it does from version 3
       onwards; pinning the exact version here made every later addition to the
       format fail a test about loading source files. The exact number is pinned
       by the suite that owns the newest addition to it — see 39-variables. */
    test('the file format says which version it is, and it is at least the one that added descriptors', () => {
      assert.equal(typeof app.FILE_VERSION, 'number');
      assert.ok(app.FILE_VERSION >= 3, 'the dataset descriptor arrived in version 3');
    });

    test('a Source records the NAMES of its files', async () => {
      if (!hasDataDir()) return;
      const s = src();
      await t.loadArchive(s.id, [2022, 2023]);
      const g = app.serialiseGraph();
      const node = g.nodes.find(n => n.type === 'source');
      assert.equal(node.cfg.dataset.headers, 'headers.txt');
      assert.deepEqual(node.cfg.dataset.years, [2022, 2023]);
    });

    test('and not one byte of their contents', async () => {
      if (!hasDataDir()) return;
      const s = src();
      await t.loadArchive(s.id, [2022]);
      const json = JSON.stringify(app.serialiseGraph());

      assert.excludes(json, '@myvuw', 'no email address');
      assert.excludes(json, 'Jennerly', 'no student name');
      assert.excludes(json, '300107735', 'no student ID');
      assert.excludes(json, 'SWEN421', 'not even a course code');
      assert.ok(json.length < 4000, 'a query is kilobytes; a cohort is not');
    });

    test('the written file is likewise free of it', async () => {
      if (!hasDataDir()) return;
      const s = src();
      await t.loadArchive(s.id, [2022]);
      const before = saved.length;
      app.writeQueryFile('q.json', null);
      assert.equal(saved.length, before + 1, 'a file was written');
      assert.excludes(saved[saved.length - 1].content, '300107735');
      assert.excludes(saved[saved.length - 1].content, 'Jennerly');
    });

    test('loading a query brings the graph back', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, f, o] = t.build('source', 'filter', 'output');
      await t.loadArchive(s.id, [2022, 2023]);
      t.set(s.id, 'pop', '2023');
      t.set(f.id, 'crit.0.field', 'gpa');
      t.set(f.id, 'crit.0.value:gpa', '6');
      const json = JSON.stringify(app.serialiseGraph());

      reset();
      assert.equal(app.nodes.length, 0);
      assert.ok(app.loadGraphFromText(json, null));

      assert.equal(app.nodes.length, 3);
      assert.equal(app.connections.length, 2);
      const s2 = app.nodes.find(n => n.type === 'source');
      const f2 = app.nodes.find(n => n.type === 'filter');
      assert.equal(s2.cfg.pop, '2023', 'the population setting came back');
      assert.equal(f2.cfg.criteria[0].values.gpa, '6', 'and the filter threshold');
      assert.ok(o, 'and the Output');
    });

    test('but not the data — every Source starts empty again', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s] = t.build('source', 'output');
      await t.loadArchive(s.id, [2022]);
      const json = JSON.stringify(app.serialiseGraph());
      assert.ok(app.sourceData()[s.id], 'loaded before the save');

      assert.ok(app.loadGraphFromText(json, null));
      assert.deepEqual(Object.keys(app.sourceData()), [],
        'the files have to be chosen again, by the user, in the picker');
      assert.deepEqual(Object.keys(app.pendingHeaders()), []);
    });

    test('a matching node id is a coincidence, not a grant', async () => {
      if (!hasDataDir()) return;
      // The id counter restarts on load, so a Source in the loaded file can
      // easily carry the id of one that was just holding records.
      reset();
      const [s] = t.build('source', 'output');
      await t.loadArchive(s.id, [2022]);
      const json = JSON.stringify(app.serialiseGraph());
      assert.ok(app.loadGraphFromText(json, null));
      const s2 = app.nodes.find(n => n.type === 'source');
      assert.equal(s2.id, s.id, 'same id, as expected');
      assert.notOk(app.sourceData()[s2.id], 'and still no data');
    });

    test('the loaded query remembers which files it wants, and says so', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s] = t.build('source', 'output');
      await t.loadArchive(s.id, [2022, 2023]);
      const json = JSON.stringify(app.serialiseGraph());

      assert.ok(app.loadGraphFromText(json, null));
      const s2 = app.nodes.find(n => n.type === 'source');
      assert.deepEqual(s2.cfg.dataset.years, [2022, 2023]);

      const msg = resultText();
      assert.includes(msg, 'not saved with a query');
      assert.includes(msg, 'mcs-students-2022');
      assert.includes(msg, 'headers.txt');
      assert.includes(panelOf(s2.id), 'mcs-students-2022',
        'and the panel names them where the picker is');
    });

    test('running a loaded query before re-loading the files is refused', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s] = t.build('source', 'output');
      await t.loadArchive(s.id, [2022]);
      const json = JSON.stringify(app.serialiseGraph());
      assert.ok(app.loadGraphFromText(json, null));

      const s2 = app.nodes.find(n => n.type === 'source');
      assert.notOk(app.sourceData()[s2.id]);
      const msg = app.sourceDataError(s2);
      assert.includes(msg, 'mcs-students-2022', 'it can even say which file to pick');
    });

    test('re-loading the files makes the same query answer the same way', async () => {
      if (!hasDataDir()) return;
      reset();
      const [s, o] = t.build('source', 'output');
      await t.loadArchive(s.id, [2022]);
      w.runQuery();
      const before = t.entry(o.id).table.rows.length;

      const json = JSON.stringify(app.serialiseGraph());
      assert.ok(app.loadGraphFromText(json, null));
      const s2 = app.nodes.find(n => n.type === 'source');
      const o2 = app.nodes.find(n => n.type === 'output');
      await t.loadArchive(s2.id, [2022]);
      w.runQuery();

      assert.equal(t.entry(o2.id).table.rows.length, before,
        'a query kept and re-run is the point of saving one');
    });
  });

  /* ══ 8. THE DESCRIPTOR IS INPUT TOO ════════════════════════════════════════
     It arrives from a .json file, which is no more trusted than any other. */
  describe('the dataset descriptor is normalised on the way in', () => {
    const load = (dataset) => {
      reset();
      const g = app.deserialiseGraph(JSON.stringify({
        kind: app.FILE_KIND, version: 3,
        nodes: [{ id: 1, type: 'source', x: 0, y: 0, cfg: { pop: 'all', dataset } }],
        connections: []
      }));
      assert.notOk(g.error, g.error);
      return g.nodes[0].cfg.dataset;
    };

    test('a well-formed descriptor survives intact', () => {
      assert.deepEqual(load({ headers: 'headers.txt', years: [2022, 2023] }),
        { headers: 'headers.txt', years: [2022, 2023] });
    });

    test('a missing descriptor becomes the empty one rather than undefined', () => {
      assert.deepEqual(load(undefined), { headers: '', years: [] });
      assert.deepEqual(load(null), { headers: '', years: [] });
    });

    test('a descriptor of the wrong type is replaced, not coerced', () => {
      assert.deepEqual(load('headers.txt'), { headers: '', years: [] });
      assert.deepEqual(load([1, 2, 3]), { headers: '', years: [] });
    });

    test('a header name is stripped of any path and capped in length', () => {
      assert.equal(load({ headers: '../../etc/passwd', years: [] }).headers, 'passwd');
      assert.equal(load({ headers: 'a'.repeat(500), years: [] }).headers.length, 120);
      assert.equal(load({ headers: { evil: true }, years: [] }).headers, '');
    });

    test('years are integers in the admitted range, deduplicated and ordered', () => {
      assert.deepEqual(load({ headers: '', years: ['2023', 2022, 2022, 'x', 1500, 9999] }).years,
        [2022, 2023]);
    });

    test('a fabricated list of years cannot grow without bound', () => {
      const many = [];
      for (let y = 1990; y <= 2099; y++) many.push(y);
      assert.equal(load({ headers: '', years: many }).years.length, 50);
    });

    test('nothing in the descriptor is ever used to reach a file', () => {
      // The user picks every file through the browser's own dialog. The worst a
      // hostile descriptor can do is misdescribe itself in one line of a panel,
      // which is why it is escaped there and capped here.
      const d = load({ headers: '<img src=x onerror=alert(1)>', years: [] });
      assert.equal(d.headers, '<img src=x onerror=alert(1)>',
        'kept as text — the name has no path in it to strip');
      reset();
      const s = t.add('source');
      s.cfg.dataset = d;
      w.render();
      assert.equal(doc.querySelectorAll('.node img').length, 0,
        'and rendered as text, never as markup');
    });
  });

  /* ══ 9. OLDER FILES ════════════════════════════════════════════════════════ */
  describe('queries saved before this feature existed', () => {
    test('a version 2 file still loads, with an empty descriptor', () => {
      reset();
      const g = app.deserialiseGraph(JSON.stringify({
        kind: app.FILE_KIND, version: 2,
        nodes: [
          { id: 1, type: 'source', x: 0, y: 0, cfg: { pop: '2022' } },
          { id: 2, type: 'output', x: 200, y: 0, cfg: { show: 'rows' } }
        ],
        connections: [{ from: 1, to: 2, port: 'in' }]
      }));
      assert.notOk(g.error, g.error);
      assert.equal(g.nodes.length, 2);
      assert.equal(g.nodes[0].cfg.pop, '2022', 'its own settings are kept');
      assert.deepEqual(g.nodes[0].cfg.dataset, { headers: '', years: [] },
        'and it simply asks for its files without being able to name them');
    });

    test('a file from a newer tool is still refused', () => {
      // One past whatever this tool writes, so the test asks the question it
      // means ("newer than me") rather than naming a version that stops being
      // newer the next time the format widens.
      const g = app.deserialiseGraph(JSON.stringify({
        kind: app.FILE_KIND, version: app.FILE_VERSION + 1, nodes: [], connections: []
      }));
      assert.ok(g.error);
      assert.includes(g.error, 'newer version');
    });
  });
};
