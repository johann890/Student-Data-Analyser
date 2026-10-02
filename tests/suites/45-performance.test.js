/* PERFORMANCE, AS PROPERTIES RATHER THAN AS STOPWATCH READINGS

   A test that says "this took under 40ms" is a test that fails on a loaded
   machine and passes on a fast one, and neither outcome says anything about the
   code. So most of this suite asserts the structural facts that make the tool
   fast, each of which is true or false regardless of how busy the host is:

     - the evaluator computes a shared subgraph once, proven by object identity
       rather than by a clock
     - the result panel's cost is bounded by its display cap, not by the row
       count behind it
     - parse cost per row is flat, so the loader is linear rather than quadratic
     - the two measures that spread an array into Math.min stopped doing so

   There are wall-clock budgets at the end, because some regressions only show
   up as time (an accidental O(n^2) in a node would pass every property above
   and still make the tool unusable). They are set at roughly ten times the
   measured median under jsdom, which is itself several times slower than the
   browser the tool runs in, so they catch an order-of-magnitude regression and
   nothing smaller. PERF_BUDGETS=0 turns them off for a run on a busy machine.

   Numbers quoted in the comments are medians measured on the real archive under
   jsdom. The browser figures are three to five times lower.                   */

const { boot, hasDataDir } = require('../lib/harness');
const { assert } = require('../lib/assert');

const BUDGETS = process.env.PERF_BUDGETS !== '0';

/* Median of several runs, not the mean. One slow run (a GC pause landing inside
   the measurement) moves a mean and does not move a median, and a GC pause is
   the single most common reason a timing test fails for no reason. */
function medianMs(times, fn) {
  const ts = [];
  for (let i = 0; i < times; i++) {
    const a = process.hrtime.bigint();
    fn();
    ts.push(Number(process.hrtime.bigint() - a) / 1e6);
  }
  ts.sort((x, y) => x - y);
  return ts[ts.length >> 1];
}

/* A numeric table of `n` rows, as a plain table file rather than the archive's
   shape. One column, so a quarter of a million rows is a few megabytes and stays
   inside MAX_DATA_FILE_BYTES, which is what makes the row ceiling reachable at
   all: 250,000 rows of the archive's 27 columns is about 36MB and the byte cap
   refuses it first. */
function numericColumn(n) {
  const lines = new Array(n);
  for (let i = 0; i < n; i++) lines[i] = String((i % 100) + 1);
  return lines.join('\n') + '\n';
}

async function tableSource(h, text) {
  const src = h.add('source');
  h.w.render();
  const hd = await h.loadHeaders(src.id, h.file('headers-marks.csv.txt', 'v\n1\n'));
  if (hd.err) throw new Error('arranging the header failed: ' + hd.err);
  const y = await h.loadYears(src.id, [h.file('marks.csv', text)]);
  if (y.err) throw new Error('arranging the table failed: ' + y.err);
  return src;
}

/* The archive at enrolment grain: 6,053 rows from three year files. The unfold
   is the most expensive thing the Source does, which is what makes it the right
   shared step to test memoisation with. */
async function archiveAtEnrolmentGrain(h) {
  const src = h.add('source');
  h.w.render();
  await h.loadArchive(src.id, [2022, 2023, 2024]);
  h.app.setCfg(src.id, 'grain', 'enrolment');
  h.w.render();
  return src;
}

module.exports = ({ describe, test }) => {

  /* ══ 1. SHARED WORK IS DONE ONCE ═══════════════════════════════════════════
     evaluateGraph walks the DAG in topological order and keeps each node's
     result in `res` keyed by node id, so a Source feeding eight branches is
     unfolded once and the branches read the same table. This is the single most
     important scalability property in the engine and the easiest to lose: any
     rewrite that evaluates a node by recursing into its inputs would still pass
     every correctness suite and would multiply the shared cost by the fan-out.

     Asserted by object identity first, because that cannot be flaky. If the
     Source were re-evaluated per branch, each branch would hold its own copy of
     the rows and the arrays would not be ===.                                 */
  describe('a shared subgraph is evaluated once, not once per branch', () => {

    test('every branch reads the identical rows array the Source produced', async () => {
      if (!hasDataDir()) return;
      const h = boot();
      const src = await archiveAtEnrolmentGrain(h);

      const outs = [];
      for (let i = 0; i < 8; i++) {
        const o = h.add('output');
        h.app.connect(src.id, o.id);
        outs.push(o);
      }
      h.w.render();

      const ev = h.app.evaluateGraph();
      assert.notOk(ev.error, 'the graph should evaluate: ' + ev.error);

      const srcRows = ev.res[src.id].table.rows;
      assert.equal(srcRows.length, 6053, 'the archive unfolds to 6,053 enrolments');

      outs.forEach(function (o) {
        const upstream = h.app.inputsOf(o.id, h.app.primaryPort('output'))[0];
        assert.ok(ev.res[upstream].table.rows === srcRows,
          'branch at node ' + o.id + ' should read the Source\'s own rows array, ' +
          'not a second copy of it. A copy means the Source was evaluated again.');
      });
    });

    test('fanning out to twelve branches does not multiply the cost', async () => {
      if (!hasDataDir() || !BUDGETS) return;
      const h = boot();
      const src = await archiveAtEnrolmentGrain(h);

      // 3.7ms measured. Outputs are the cheapest possible branch, so almost all
      // of this is the unfold, which is exactly the cost being shared.
      const alone = medianMs(15, () => h.app.evaluateGraph());

      for (let i = 0; i < 12; i++) {
        const o = h.add('output');
        h.app.connect(src.id, o.id);
      }
      h.w.render();

      // 5.7ms measured, a ratio of 1.5. Re-evaluating the Source per branch
      // would put this near 13. Four is far above the real figure and far below
      // the broken one, so this fails on the regression and not on a slow host.
      const many = medianMs(15, () => h.app.evaluateGraph());
      assert.ok(many < alone * 4,
        'twelve branches off one Source cost ' + many.toFixed(2) + 'ms against ' +
        alone.toFixed(2) + 'ms for the Source alone (' + (many / alone).toFixed(1) +
        'x). Re-evaluating the shared Source per branch would cost about 13x.');
    });
  });

  /* ══ 2. THE PANEL IS BOUNDED BY ITS CAP, NOT BY THE DATA ═══════════════════
     DISPLAY_ROW_LIMIT is why a result of any size renders in the same time: the
     panel writes fifty rows and a line saying how many more there are. The
     export is deliberately not capped, and both halves are asserted here
     because capping the export would make this test pass and the tool wrong. */
  describe('the result panel costs the same whatever the row count behind it', () => {

    test('150,000 rows render as the display cap, and export in full', async () => {
      const h = boot();
      const src = await tableSource(h, numericColumn(150000));
      const out = h.add('output');
      h.app.connect(src.id, out.id);
      h.w.render();
      h.w.runQuery();

      const drawn = h.qa('#panelBody tbody tr').length;
      assert.ok(drawn <= 51,
        'the panel drew ' + drawn + ' rows. The cap is fifty, plus at most one ' +
        'line saying how many were left out.');

      // The whole point of the cap is that it is a display decision only.
      assert.equal(h.app.exportData[out.id].table.rows.length, 150000,
        'the export carries every row, capped or not');
      assert.includes(h.panel(), 'more',
        'the panel should say how many rows it is not showing');
    });

    test('a hundredfold more data does not cost a hundredfold more to show', async () => {
      if (!BUDGETS) return;
      const small = boot();
      const s1 = await tableSource(small, numericColumn(1500));
      const o1 = small.add('output');
      small.app.connect(s1.id, o1.id);
      small.w.render();
      const tSmall = medianMs(5, () => small.w.runQuery());

      const big = boot();
      const s2 = await tableSource(big, numericColumn(150000));
      const o2 = big.add('output');
      big.app.connect(s2.id, o2.id);
      big.w.render();
      const tBig = medianMs(5, () => big.w.runQuery());

      /* The engine still walks every row, so this is not flat and is not meant
         to be. What it must not be is proportional: a hundred times the rows
         through a panel that draws fifty of them should cost single digits more,
         not a hundred more. Ten is the line. */
      assert.ok(tBig < tSmall * 10,
        '1,500 rows took ' + tSmall.toFixed(1) + 'ms and 150,000 took ' +
        tBig.toFixed(1) + 'ms (' + (tBig / tSmall).toFixed(1) + 'x for 100x the ' +
        'data). A panel whose cost tracked its input would be near 100x.');
    });
  });

  /* ══ 3. THE LOADER IS LINEAR ═══════════════════════════════════════════════
     Per-row parse cost measured 22.1, 17.3, 19.7 and 20.1 microseconds at 2k,
     8k, 32k and 128k rows: flat, so no quadratic term. The usual way to lose
     this is an indexOf or a find inside the row loop, which is invisible on the
     archive's 2,000 rows a year and ruinous on a real export.                 */
  describe('parse cost grows with the rows, not with their square', () => {

    test('four times the rows costs well under sixteen times the time', async () => {
      if (!BUDGETS) return;
      const n = 20000;

      const a = boot();
      const textA = numericColumn(n);
      const tA = Date.now();
      await tableSource(a, textA);
      const msA = Date.now() - tA;

      const b = boot();
      const textB = numericColumn(n * 4);
      const tB = Date.now();
      await tableSource(b, textB);
      const msB = Date.now() - tB;

      /* Linear is 4x and quadratic is 16x. Eight sits between them with room on
         both sides, which is what makes this fail on the regression rather than
         on the weather. The floor stops a fast machine turning a 3ms baseline
         into a division by almost nothing. */
      const ratio = msB / Math.max(msA, 1);
      assert.ok(ratio < 8,
        n + ' rows parsed in ' + msA + 'ms and ' + (n * 4) + ' rows in ' + msB +
        'ms (' + ratio.toFixed(1) + 'x for 4x the rows). Linear is about 4x; ' +
        'quadratic would be about 16x.');
    });
  });

  /* ══ 4. THE MEASURES THAT USED TO OVERFLOW THE CALL STACK ══════════════════
     Minimum and Maximum were Math.min.apply(null, nums), which spreads every
     value as a separate argument. Above roughly 125,000 of them V8 throws a
     RangeError, and the loader admits 250,000 rows in one file, so the ceiling
     sat inside the tool's own documented envelope.

     The failure was not a wrong answer. The RangeError came out of runQuery, and
     a throw from a click handler is swallowed by the browser, so the Run button
     appeared to do nothing. Sum, average and median were never affected because
     reduce and sort take the array rather than spreading it, which is why they
     are checked alongside: they are the control.

     Reintroduce Math.min.apply in core.js and every test here goes red.       */
  describe('a measure over a very large column returns instead of throwing', () => {

    const BIG = 150000;

    test('minOf and maxOf answer above the spread ceiling', () => {
      const h = boot();
      const nums = new Array(BIG);
      for (let i = 0; i < BIG; i++) nums[i] = (i % 100) + 1;

      assert.equal(h.app.minOf(nums), 1);
      assert.equal(h.app.maxOf(nums), 100);
    });

    test('an empty column has no smallest member, and says so', () => {
      const h = boot();
      // null rather than Infinity, which is what Math.min() of nothing returns
      // and which would print in a result cell as a value.
      assert.equal(h.app.minOf([]), null);
      assert.equal(h.app.maxOf([]), null);
    });

    test('every measure on an Aggregate survives 150,000 rows', async () => {
      const h = boot();
      const src = await tableSource(h, numericColumn(BIG));
      const agg = h.add('aggregate');
      h.app.connect(src.id, agg.id);
      const out = h.add('output');
      h.app.connect(agg.id, out.id);
      h.w.render();

      const key = h.app.evaluateGraph().res[src.id].table.columns[0].key;

      // The column cycles 1..100, so every expectation here is exact rather
      // than approximate, and a measure that silently used a subset of the rows
      // would not land on these numbers.
      const expected = {
        count: BIG, sum: 7575000, average: 50.5, median: 50.5, min: 1, max: 100
      };

      Object.keys(expected).forEach(function (op) {
        h.app.setCfg(agg.id, 'stats', [{ op: op, col: key }]);
        const ev = h.app.evaluateGraph();
        assert.notOk(ev.error, op + ' reported an engine error: ' + ev.error);
        assert.close(Number(ev.res[agg.id].table.rows[0][0]), expected[op], 1e-9,
          op + ' over ' + BIG + ' rows');
      });
    });

    test('a Histogram bins 150,000 rows instead of throwing', async () => {
      const h = boot();
      const src = await tableSource(h, numericColumn(BIG));
      const hist = h.add('histogram');
      h.app.connect(src.id, hist.id);
      h.w.render();

      const key = h.app.evaluateGraph().res[src.id].table.columns[0].key;
      h.app.setCfg(hist.id, 'by', key);
      h.w.render();

      /* binsFor() and the automatic bin width both took the smallest and largest
         value the same way the measures did, so the Histogram carried the same
         ceiling in two more places, and the automatic width is the one a user
         meets first because it is what an unconfigured node uses.

         The bin column has to be set explicitly. Without it binField() finds
         nothing, applyHistogram returns early with "no numeric column to bin",
         and the two calls under test are never reached: the first version of
         this test did exactly that and passed with the bug in place. The row
         count below is what proves the node really binned something.          */
      const ev = h.app.evaluateGraph();
      assert.notOk(ev.error, 'the histogram reported: ' + ev.error);

      /* The column cycles 1..100, so every value falls in the covered range and
         every row lands in exactly one bin. Summing the counts is how this test
         knows it measured the distribution rather than an empty table. */
      const t = ev.res[hist.id].table;
      assert.ok(t.rows.length > 1,
        'the histogram produced ' + t.rows.length + ' bins; an early return ' +
        'produces none, which is how this test used to pass with the bug in place');

      const countIdx = t.columns.length - 1;
      const total = t.rows.reduce(function (s, r) { return s + Number(r[countIdx]); }, 0);
      assert.equal(total, BIG, 'every row should be counted in exactly one bin');
    });

    test('runQuery returns rather than throwing out of the click handler', async () => {
      const h = boot();
      const src = await tableSource(h, numericColumn(BIG));
      const agg = h.add('aggregate');
      h.app.connect(src.id, agg.id);
      const out = h.add('output');
      h.app.connect(agg.id, out.id);
      h.w.render();

      const key = h.app.evaluateGraph().res[src.id].table.columns[0].key;
      h.app.setCfg(agg.id, 'stats', [{ op: 'min', col: key }]);

      // The shape of the original bug: this threw, the browser swallowed it, and
      // the button did nothing. assert.throws cannot express "does not throw",
      // so the call stands on its own and the panel is read afterwards.
      h.w.runQuery();
      assert.includes(h.panel(), '1', 'the minimum should have reached the panel');
    });
  });

  /* ══ 5. WALL-CLOCK BUDGETS ═════════════════════════════════════════════════
     Deliberately loose. Each is about ten times the measured median under
     jsdom, which is itself slower than the browser, so a budget here is an
     order-of-magnitude alarm and not a performance target. The targets live in
     the report, measured in a real browser; these exist so that an accidental
     O(n^2) cannot pass every property above and still ship.                   */
  describe('nothing has become an order of magnitude slower', () => {

    test('the real archive loads well inside a second and a half', async () => {
      if (!hasDataDir() || !BUDGETS) return;
      const h = boot();
      const src = h.add('source');
      h.w.render();

      const t0 = Date.now();
      await h.loadArchive(src.id, [2022, 2023, 2024]);
      const ms = Date.now() - t0;

      // 159ms measured for three files and 918KB, including a real FileReader.
      assert.ok(ms < 1500,
        'loading the three year files took ' + ms + 'ms; the measured median is ' +
        'about 160ms under jsdom.');
    });

    test('a six-node pipeline over the archive stays inside 400ms', async () => {
      if (!hasDataDir() || !BUDGETS) return;
      const h = boot();
      const src = await archiveAtEnrolmentGrain(h);

      const f = h.add('filter');
      h.app.connect(src.id, f.id);
      h.app.setCfg(f.id, 'field', 'grade');
      h.app.setCfg(f.id, 'op', 'ne');
      h.app.setCfg(f.id, 'value', 'K');
      const s = h.add('sort');      h.app.connect(f.id, s.id);
      const u = h.add('unique');    h.app.connect(s.id, u.id);
      const a = h.add('aggregate'); h.app.connect(u.id, a.id);
      const o = h.add('output');    h.app.connect(a.id, o.id);
      h.w.render();

      // 31.5ms measured under jsdom, 6.2ms in the browser.
      const ms = medianMs(5, () => h.app.evaluateGraph());
      assert.ok(ms < 400,
        'the pipeline took ' + ms.toFixed(1) + 'ms; the measured median is about ' +
        '32ms under jsdom and 6ms in a browser.');
    });

    test('the schema walk stays cheap enough to run on every render', async () => {
      if (!hasDataDir() || !BUDGETS) return;
      const h = boot();
      const src = await archiveAtEnrolmentGrain(h);
      for (let i = 0; i < 10; i++) {
        const f = h.add('filter');
        h.app.connect(src.id, f.id);
      }
      h.w.render();

      /* This one is worth a budget of its own because render() calls it every
         time, so a schema walk that started touching rows would make every
         redraw proportional to the data. It carries headers only: 0.06ms
         measured against a 6,053-row Source. */
      const ms = medianMs(20, () => h.app.computeSchemas());
      assert.ok(ms < 25,
        'computeSchemas took ' + ms.toFixed(2) + 'ms. It carries no rows, so the ' +
        'measured median is under a tenth of a millisecond; anything near this ' +
        'budget means it has started reading data.');
    });
  });
};
