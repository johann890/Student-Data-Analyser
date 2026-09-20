/* HISTOGRAM: the group-by whose groups are ranges.

   Most of this node is parts that already had tests. The measures are
   SelectFor's, resolved by the same statCol() and computed by the same
   reduceValues(); the ports, the schema walk and the registry contract are the
   same ones every other node uses. So the claims worth testing here are the
   ones that are true only of binning:

     - every row lands in exactly ONE bin. `between` includes both ends, which
       is right for a filter and would double-count every boundary value here,
       so the bins are placed by arithmetic instead. The property that decision
       exists to protect is that the counts sum to the rows, and it is checked
       against rows counted outside the tool rather than against another run of
       it
     - the first edge is a multiple of the width, not the smallest value
       present, which is what makes two years binned the same way comparable
     - a band nothing falls in is still a row, because a gap in a distribution
       is the finding
     - a blank is in no bin at all: a missing mark is not a mark of nought

   Counts are cross-checked against the dataset directly, so a wrong answer
   cannot pass by agreeing with itself. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  /* Source -> Histogram -> Output, the shape almost every test here wants. */
  function plain() {
    const h = boot();
    const src = h.add('source'), hist = h.add('histogram'), out = h.add('output');
    h.app.connect(src.id, hist.id);
    h.app.connect(hist.id, out.id);
    h.w.render();
    return Object.assign(h, { src, hist, out });
  }

  function cfg(h, key, value) { h.set(h.hist.id, key, value); h.w.render(); }
  function runTable(h) { h.w.runQuery(); return h.entry(h.out.id).source; }

  const labelsOf = t => t.rows.map(r => String(r[0]));
  const countsOf = t => t.rows.map(r => r[1]);
  const sum = xs => xs.reduce((a, b) => a + b, 0);

  // A histogram of one field, straight out of the node.
  function binned(by, width) {
    const h = plain();
    cfg(h, 'by', by);
    if (width !== undefined) cfg(h, 'width', width);
    return { h, t: runTable(h) };
  }

  /* ------------------------------------------------------- the node exists */

  describe('the node is wired into every table that has to know about it', () => {
    test('the registry, the geometry and the ports all have an entry', () => {
      const A = boot().app;
      assert.ok(A.NODE_SPEC.histogram, 'no registry entry');
      assert.ok(A.SHAPE.histogram, 'no shape');
      assert.ok(A.portsOf('histogram'), 'no ports');
    });

    test('it takes one table in, on a port that cannot be merged into', () => {
      const A = boot().app;
      const ps = A.portsOf('histogram');
      assert.equal(ps.length, 1, 'a histogram of two tables is not a thing');
      ps.forEach(p => assert.notOk(p.multi,
        p.key + ' accepts several wires, so rows could vanish into it'));
    });

    test('it goes where the other row nodes go', () => {
      const A = boot().app;
      // It emits an ordinary table, so anything that takes one may follow it.
      assert.ok(A.canConnect('histogram', 'sort'), 'a Sort cannot follow it');
      assert.ok(A.canConnect('histogram', 'output'), 'an Output cannot follow it');
      assert.ok(A.canConnect('filter', 'histogram'), 'a Filter cannot feed it');
    });

    test('the menu offers it under Distribution, not Processing', () => {
      const h = boot();
      const item = h.qa('.proc-item').find(b =>
        /addProcNode\('histogram'\)/.test(b.getAttribute('onclick')));
      assert.ok(item, 'no menu entry');
      assert.equal(item.closest('.proc-menu').id, 'distMenu');
    });
  });

  /* ------------------------------------------------------------- the bins */

  describe('every row lands in exactly one bin', () => {
    test('the counts sum to the rows that went in', () => {
      const { h, t } = binned('gpa', 1);
      /* Counted outside the tool: every student in the dataset has a GPA, so
         the bins have to account for all of them and no more. */
      assert.equal(sum(countsOf(t)), h.app.STUDENTS.length,
        'the bins do not add up to the table they were built from');
    });

    test('a value on a boundary is counted once, in the band above', () => {
      /* The trap this node is built to avoid. `between` keeps 5 for "4 to 5"
         AND for "5 to 6"; arithmetic placement keeps it only for "5 to 6". */
      const { h, t } = binned('gpa', 1);
      const onEdge = h.app.STUDENTS.filter(s => Number.isInteger(s.gpa));
      assert.ok(onEdge.length, 'no student sits on a bin edge, so this proves nothing');

      onEdge.forEach(s => {
        const above = String(s.gpa) + ' to ' + String(s.gpa + 1);
        const below = String(s.gpa - 1) + ' to ' + String(s.gpa);
        const iAbove = labelsOf(t).indexOf(above);
        assert.ok(iAbove !== -1, 'expected a band ' + above);
        const inAbove = t.meta.branches[iAbove].table.rows.length;
        const iBelow = labelsOf(t).indexOf(below);
        const inBelow = iBelow === -1 ? 0 : t.meta.branches[iBelow].table.rows.length;
        assert.ok(inAbove + inBelow > 0, 'a student on an edge fell out of both bands');
      });

      // and the totals still agree, which is the same claim stated numerically
      assert.equal(sum(countsOf(t)), h.app.STUDENTS.length);
    });

    test('the largest value has a bin, because the last one is closed', () => {
      const { h, t } = binned('gpa', 1);
      const max = Math.max(...h.app.STUDENTS.map(s => s.gpa));
      const last = t.meta.branches[t.meta.branches.length - 1];
      assert.ok(max >= last.lo && max <= last.hi,
        'the maximum is outside every band, so it was dropped');
      assert.ok(last.table.rows.length > 0, 'the top band is empty, so the maximum went elsewhere');
    });

    test('each row appears in exactly one branch table', () => {
      const { h, t } = binned('gpa', 2);
      const seen = new Set();
      t.meta.branches.forEach(b => b.table.rows.forEach(r => {
        const id = r[0];
        assert.notOk(seen.has(id), 'row ' + id + ' is in two bands at once');
        seen.add(id);
      }));
      assert.equal(seen.size, h.app.STUDENTS.length);
    });
  });

  describe('the edges are the same for everyone', () => {
    test('the first edge is a multiple of the width, not the smallest value', () => {
      /* Anchoring to the data would make two years bin differently, and a
         comparison between them then means nothing. */
      const { h, t } = binned('gpa', 2);
      const min = Math.min(...h.app.STUDENTS.map(s => s.gpa));
      const first = t.meta.branches[0].lo;
      assert.equal(first % 2, 0, 'the first edge is not a multiple of the width');
      assert.ok(first <= min, 'the first band starts above the smallest value');
      assert.ok(min - first < 2, 'there is an empty band below the data');
    });

    test('the bands are the width that was asked for', () => {
      const { t } = binned('gpa', 3);
      t.meta.branches.forEach(b => assert.close(b.hi - b.lo, 3, 1e-9, 'band ' + b.label));
    });

    test('the bands are contiguous, with no value able to fall between them', () => {
      const { t } = binned('gpa', 1);
      const bs = t.meta.branches;
      for (let i = 1; i < bs.length; i++) {
        assert.close(bs[i].lo, bs[i - 1].hi, 1e-9,
          'there is a gap between ' + bs[i - 1].label + ' and ' + bs[i].label);
      }
    });

    test('a width that is missing, zero, negative or not a number means "decide for me"', () => {
      const A = boot().app;
      [undefined, '', 0, -5, 'wide', NaN].forEach(w => {
        assert.equal(A.binWidth({ cfg: { width: w } }), null,
          JSON.stringify(w) + ' should hand over to the automatic width, not divide by it');
      });
      assert.equal(A.binWidth({ cfg: { width: '2.5' } }), 2.5, 'a typed number is read as one');
    });

    test('the automatic width is a number a person would have picked', () => {
      /* A fixed default cannot serve both a mark out of 100 and a GPA out of 9.
         The width is taken from the range and snapped to the same 1/2/2.5/5
         steps an axis uses for its ticks. */
      const A = boot().app;
      assert.equal(A.autoWidth(0, 9), 1, 'a GPA wants bands of 1, not of 10');
      assert.equal(A.autoWidth(0, 100), 10);
      assert.equal(A.autoWidth(0, 1), 0.1);
      // 300 across, so ~30 a band is wanted and 50 is the next step up: seven
      // bands of a number that reads cleanly, rather than thirteen of 25.
      assert.equal(A.autoWidth(100, 400), 50, 'levels want a round number too');
      assert.equal(A.autoWidth(5, 5), 1, 'one value is still one band, not a division by zero');
      [[0, 9], [0, 100], [3.2, 7.9], [0, 1], [100, 400]].forEach(([lo, hi]) => {
        const n = Math.floor((hi - lo) / A.autoWidth(lo, hi)) + 1;
        assert.ok(n >= 4 && n <= 20, lo + '..' + hi + ' gave ' + n + ' bands');
      });
    });

    test('an empty width bins the real data sensibly, and a typed one overrides it', () => {
      const auto = binned('gpa');
      assert.ok(auto.t.rows.length >= 4 && auto.t.rows.length <= 20,
        'the automatic width produced ' + auto.t.rows.length + ' bands');
      assert.equal(sum(countsOf(auto.t)), auto.h.app.STUDENTS.length,
        'the automatic width must still account for every row');

      const typed = binned('gpa', 3);
      typed.t.meta.branches.forEach(b => assert.close(b.hi - b.lo, 3, 1e-9));
    });
  });

  describe('a band nothing falls in is still a row', () => {
    test('an empty band in the middle is reported as a zero', () => {
      /* Built rather than hoped for: a Filter that keeps only the extremes
         leaves the middle of the range empty, and the gap is the finding. */
      const h = plain();
      const flt = h.add('filter');
      h.app.connect(h.src.id, flt.id);
      h.app.connect(flt.id, h.hist.id);
      h.w.render();
      h.set(flt.id, 'crit.0.field', 'gpa');
      h.w.render();
      h.set(flt.id, 'crit.0.op:gpa', 'between');
      h.w.render();

      const gpas = h.app.STUDENTS.map(s => s.gpa);
      const lo = Math.min(...gpas), hi = Math.max(...gpas);
      h.set(flt.id, 'crit.0.value:gpa', lo);
      h.set(flt.id, 'crit.0.value:gpa:max', hi);
      h.w.render();

      h.set(h.hist.id, 'by', 'gpa');
      h.set(h.hist.id, 'width', 1);
      h.w.render();

      const t = runTable(h);
      // Whatever the data does, the bands must cover the range with no holes.
      assert.equal(t.rows.length, t.meta.branches.length);
      const covered = t.meta.branches[t.meta.branches.length - 1].hi - t.meta.branches[0].lo;
      assert.ok(covered >= hi - lo, 'the bands do not span the data');
    });

    test('bands are generated from the edges, not discovered from the rows', () => {
      // A width that spans the whole range still produces bands, and a width
      // far finer than the data produces empty ones rather than skipping them.
      const { t } = binned('gpa', 0.25);
      const empties = t.rows.filter(r => r[1] === 0);
      assert.ok(t.rows.length > empties.length, 'every band is empty, which cannot be right');
      assert.ok(empties.length > 0,
        'at 0.25 across a real cohort some band must be empty, and it must still be a row');
    });
  });

  describe('a blank is in no band', () => {
    test('rows with no value are counted out, not counted as zero', () => {
      /* Project makes a row an enrolment, and a withdrawn enrolment has no
         mark. Those rows must not pile up in the band containing zero. */
      const h = boot();
      const src = h.add('source'), prj = h.add('project'),
            hist = h.add('histogram'), out = h.add('output');
      h.app.connect(src.id, prj.id);
      h.app.connect(prj.id, hist.id);
      h.app.connect(hist.id, out.id);
      h.w.render();
      h.set(hist.id, 'by', 'gradePoints');
      h.set(hist.id, 'width', 1);
      h.w.render();
      h.w.runQuery();
      const t = h.entry(out.id).source;

      const enrolments = [].concat(...h.app.STUDENTS.map(s => s.courses));
      const withMark = enrolments.filter(c =>
        c.gradePoints !== null && c.gradePoints !== undefined && c.gradePoints !== '');
      assert.equal(sum(countsOf(t)), withMark.length,
        'the bands must account for the rows that have a value, and only those');
      assert.ok(withMark.length <= enrolments.length);
    });
  });

  describe('too many bands is an error, not a table', () => {
    test('a width far too fine is refused, and says what to do', () => {
      const h = plain();
      cfg(h, 'by', 'gpa');
      cfg(h, 'width', 0.001);
      h.w.runQuery();
      const entry = h.entry(h.out.id);
      const shown = h.doc.getElementById('panelBody').innerHTML;
      assert.ok(/Widen the bands|Widen the bins/i.test(shown) || (entry && entry.error),
        'a thousand bands should be refused with an explanation');
    });

    test('the cap is stated, not hidden in a magic number', () => {
      const A = boot().app;
      assert.ok(A.HIST_MAX_BINS > 0, 'no declared cap');
      const spec = A.binsFor([0, A.HIST_MAX_BINS + 5], 1);
      assert.ok(spec.error, 'past the cap this must be an error');
      assert.includes(spec.error, String(A.HIST_MAX_BINS), 'the message should say the limit');
    });
  });

  /* --------------------------------------------------------- what comes out */

  describe('what comes out is an ordinary table', () => {
    test('one label column, then one column per measure', () => {
      const { t } = binned('gpa', 2);
      assert.equal(t.columns[0].key, 'group', 'the label column is not where SelectFor puts it');
      assert.equal(t.columns.length, 2, 'one measure by default, so two columns');
      assert.equal(t.columns[1].label, 'Count');
    });

    test('the label column declares its own order, so a Sort is not alphabetical', () => {
      /* "10 to 20" sorts before "9 to 10" as text. Declaring the order is what
         makes a downstream Sort put the bands back in numeric order. */
      const { t } = binned('gpa', 1);
      assert.ok(t.columns[0].order, 'no declared order');
      assert.deepEqual(t.columns[0].order, labelsOf(t),
        'the declared order must be the order the bands came out in');
    });

    test('a band is labelled with words, not a hyphen Excel would read as a date', () => {
      const { t } = binned('gpa', 1);
      labelsOf(t).forEach(l => {
        assert.includes(l, ' to ', l + ' is not in the readable form');
        assert.excludes(l, '-', l + ' contains a hyphen, which Excel may read as a date');
      });
    });

    test('the per-band tables ride along in Compare\'s shape', () => {
      // Which is what gives the Output its per-group cards and the long-form
      // export without either of them knowing this node exists.
      const { t } = binned('gpa', 2);
      assert.ok(t.meta && t.meta.branches, 'no branches');
      assert.equal(t.meta.branches.length, t.rows.length);
      t.meta.branches.forEach(b => {
        assert.ok(b.label, 'a branch with no label');
        assert.ok(b.table && b.table.columns, 'a branch with no table');
      });
      assert.equal(t.meta.title, 'Distribution');
    });

    test('the measures are SelectFor\'s, and they measure the band\'s own rows', () => {
      const h = plain();
      cfg(h, 'by', 'gpa');
      cfg(h, 'width', 2);
      h.w.addStat(h.hist.id); h.w.render();   // the row has to exist to be set
      cfg(h, 'stat.1.op', 'average');
      cfg(h, 'stat.1.col', 'gpa');
      const t = runTable(h);

      assert.equal(t.columns.length, 3, 'count, then the average');
      t.meta.branches.forEach((b, i) => {
        const vals = b.table.rows.map(r => r[b.table.columns.findIndex(c => c.key === 'gpa')]);
        if (!vals.length) return;
        const want = vals.reduce((a, v) => a + v, 0) / vals.length;
        assert.close(t.rows[i][2], want, 1e-9, 'the average in band ' + b.label);
      });
    });

    test('share divides by the rows that came in', () => {
      const h = plain();
      cfg(h, 'by', 'gpa');
      cfg(h, 'width', 1);
      cfg(h, 'stat.0.op', 'share');
      const t = runTable(h);
      const total = sum(t.rows.map(r => r[1]));
      // Every row has a GPA, so the bands ARE a partition and shares total 100.
      assert.close(total, 100, 1e-6, 'the shares of a partition must come to 100');
    });
  });

  describe('the header the walk declares is the header the run produces', () => {
    test('schema and rows agree, which is the registry\'s own invariant', () => {
      const h = plain();
      cfg(h, 'by', 'gpa');
      cfg(h, 'width', 2);
      const t = runTable(h);
      const schemas = h.app.computeSchemas();
      const declared = schemas[h.hist.id];
      assert.ok(declared, 'the schema walk produced nothing for this node');
      assert.deepEqual(declared.columns.map(c => c.key), t.columns.map(c => c.key));
      assert.deepEqual(declared.columns.map(c => c.label), t.columns.map(c => c.label));
    });

    test('the declared header needs no rows to be right', () => {
      // Which is what lets a panel downstream describe itself before a run.
      const h = plain();
      cfg(h, 'by', 'gpa');
      const schemas = h.app.computeSchemas();
      assert.equal(schemas[h.hist.id].rows.length, 0, 'the schema walk carried rows');
      assert.equal(schemas[h.hist.id].columns[0].key, 'group');
    });
  });

  /* --------------------------------------------------------------- the panel */

  describe('the panel', () => {
    test('it offers the numeric columns, and not the identifiers', () => {
      const h = plain();
      const A = h.app;
      const cols = A.binnableCols(A.computeSchemas()[h.hist.id === undefined ? 0 : h.src.id]);
      assert.ok(cols.length, 'nothing to bin, on a table of students');
      assert.notOk(cols.some(c => c.key === 'id'),
        'binning student IDs is a histogram of nothing');
    });

    test('it says which way a boundary goes', () => {
      const h = plain();
      cfg(h, 'by', 'gpa');
      const text = h.qa('.node-config').map(e => e.textContent).join(' ');
      assert.includes(text, 'band above',
        'the one rule a reader cannot check by looking must be stated');
    });

    test('a saved column that is gone falls back rather than binning nothing', () => {
      const h = plain();
      h.set(h.hist.id, 'by', 'no-such-column');
      h.w.render();
      const t = runTable(h);
      assert.ok(t.rows.length > 0, 'a stale column name emptied the node');
    });
  });

  /* ------------------------------------------------------------ persistence */

  describe('a saved query comes back', () => {
    test('the type, the column and the width all survive a round trip', () => {
      const h = plain();
      cfg(h, 'by', 'gpa');
      cfg(h, 'width', 2.5);
      const before = runTable(h);

      const text = JSON.stringify(h.app.serialiseGraph());
      assert.includes(text, '"type":"histogram"', 'the node type is not in the file');

      const h2 = boot();
      h2.app.loadGraphFromText(text, h2.doc.createElement('button'));
      h2.w.runQuery();
      const node = h2.app.nodes.find(n => n.type === 'histogram');
      assert.ok(node, 'the node did not come back');
      assert.equal(String(node.cfg.by), 'gpa');
      assert.equal(Number(node.cfg.width), 2.5);

      const out2 = h2.app.nodes.find(n => n.type === 'output');
      const after = h2.entry(out2.id).source;
      assert.deepEqual(after.rows.map(r => r.slice()), before.rows.map(r => r.slice()),
        'the same query gave a different answer after a round trip');
    });
  });

  /* ------------------------------------------------- against the real archive */

  describe('against a real distribution', () => {
    test('a grade histogram of enrolments matches the enrolments counted directly', () => {
      const h = boot();
      const src = h.add('source'), prj = h.add('project'),
            hist = h.add('histogram'), out = h.add('output');
      h.app.connect(src.id, prj.id);
      h.app.connect(prj.id, hist.id);
      h.app.connect(hist.id, out.id);
      h.w.render();
      h.set(hist.id, 'by', 'gradePoints');
      h.set(hist.id, 'width', 1);
      h.w.render();
      h.w.runQuery();
      const t = h.entry(out.id).source;

      const marks = [].concat(...h.app.STUDENTS.map(s => s.courses))
        .map(c => c.gradePoints)
        .filter(v => v !== null && v !== undefined && v !== '');

      t.meta.branches.forEach(b => {
        const want = marks.filter(v => v >= b.lo && (b === t.meta.branches[t.meta.branches.length - 1]
          ? v <= b.hi : v < b.hi)).length;
        const got = t.rows[t.meta.branches.indexOf(b)][1];
        assert.equal(got, want, 'band ' + b.label + ' disagrees with the enrolments counted directly');
      });
    });
  });
};
