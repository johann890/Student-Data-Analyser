/* The range operator — value in [min .. max].

   Point 5 of the settled list: bands should generalise to ranges, "covering
   year ranges and mark ranges rather than grades alone". So the test that
   matters most is not that a number range works, but that the same operator
   works on a year and on a letter grade, and that it refuses the columns where
   an order would be a fiction. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const A = boot().app;
  const S = A.STUDENTS;
  const GRADE = A.GRADE_ORDER;

  /* Drive it through the controls, as a user would: pick the field, pick the
     operator, fill both ends of the band. */
  function band(field, lo, hi, extra) {
    const h = boot();
    const [s, f, o] = h.build('source', 'filter', 'output');
    h.set(o.id, 'show', 'count');
    h.set(f.id, 'crit.0.field', field);
    if (extra) extra(h, f);
    h.set(f.id, 'crit.0.op:' + field, 'between');
    h.set(f.id, 'crit.0.value:' + field, lo);
    h.set(f.id, 'crit.0.value:' + field + ':max', hi);
    h.w.runQuery();
    return { ...h, s, f, o, count: () => Number(h.bigNum()) };
  }
  const gradeBand = (a, b) => {
    const i = GRADE.indexOf(a), j = GRADE.indexOf(b);
    const lo = Math.min(i, j), hi = Math.max(i, j);
    return S.filter(s => { const k = GRADE.indexOf(s.letterGrade); return k >= lo && k <= hi; }).length;
  };

  describe('which columns can carry a range', () => {
    test('a number can', () => {
      assert.ok(A.isRangeable({ key: 'n', type: A.COLTYPE.NUMBER }));
    });

    test('a category whose values are numbers can — this is Year', () => {
      const year = A.colByKey(A.studentsTable([]), 'year');
      assert.equal(year.type, A.COLTYPE.ENUM, 'Year is an ENUM because its values are a fixed set');
      assert.ok(A.isRangeable(year), 'but its order is a real one, so it ranges');
    });

    test('a column with a declared order can — this is Grade', () => {
      const g = A.colByKey(A.studentsTable([]), 'letterGrade');
      assert.ok(g.order && g.order.length, 'letterGrade declares GRADE_ORDER');
      assert.ok(A.isRangeable(g));
    });

    test('a category whose values are only a list cannot', () => {
      /* "Between Cybersecurity and Data Science" would look like a question and
         mean nothing: the order it ranges over is the order somebody typed the
         list in. Sort treats any ENUM as ordered, which is defensible there
         because the user sees the result; a range is a claim. */
      const t = A.studentsTable([]);
      assert.notOk(A.isRangeable(A.colByKey(t, 'specialisation')));
      assert.notOk(A.isRangeable(A.colByKey(t, 'gender')));
    });

    test('a nested column cannot', () => {
      assert.notOk(A.isRangeable(A.colByKey(A.studentsTable([]), 'courses')));
    });

    test('numericValues is what tells Year from Specialisation', () => {
      assert.ok(A.numericValues([2022, 2023]));
      assert.ok(A.numericValues(['2022', '2023']));
      assert.notOk(A.numericValues(['M', 'F']));
      assert.notOk(A.numericValues([]));
      assert.notOk(A.numericValues(['2022', '']));
    });
  });

  describe('the operator is offered where it belongs', () => {
    test('on a number, alongside the other comparisons', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      assert.includes(h.optionsOf(f.id, 'crit.0.op:gpa'), 'between');
    });

    test('on Year and on Grade, without < and >', () => {
      ['year', 'letterGrade'].forEach(k => {
        const h = boot();
        const [s, f, o] = h.build('source', 'filter', 'output');
        h.set(f.id, 'crit.0.field', k);
        const ops = h.optionsOf(f.id, 'crit.0.op:' + k);
        assert.deepEqual(ops, A.ORDERED_OPS, k);
        assert.excludes(ops, 'gt', k + ': arithmetic on a category would read as nonsense');
      });
    });

    test('not on Specialisation or Gender', () => {
      ['specialisation', 'gender'].forEach(k => {
        const h = boot();
        const [s, f, o] = h.build('source', 'filter', 'output');
        h.set(f.id, 'crit.0.field', k);
        assert.excludes(h.optionsOf(f.id, 'crit.0.op:' + k), 'between', k);
      });
    });

    test('on a course mark, which is the other numeric field', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'courses.gradePoints');
      assert.includes(h.optionsOf(f.id, 'crit.0.op:courses.gradePoints'), 'between');
    });
  });

  describe('the range can be found without already knowing it is there', () => {
    test('the dropdown says "in range", not just "in"', () => {
      /* "in" sitting last among six comparator symbols looks like a seventh
         comparator and gives no hint that it is the one operator needing two
         values. This is the whole reason the first build of this feature went
         unnoticed by the person who asked for it. */
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      const labels = h.qa('[data-node="' + f.id + '"][data-key="crit.0.op:gpa"] option')
        .map(o2 => o2.textContent);
      assert.includes(labels, 'in range');
      assert.excludes(labels, 'in', 'the bare symbol belongs in the log, not the control');
    });

    test('and groups it apart from the comparisons', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      const groups = h.qa('[data-node="' + f.id + '"][data-key="crit.0.op:gpa"] optgroup')
        .map(g => g.getAttribute('label'));
      assert.deepEqual(groups, ['Compare', 'Range']);
    });

    test('a field with no range on offer gets a plain list, not an empty group', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'specialisation');
      assert.equal(h.qa('[data-node="' + f.id + '"][data-key="crit.0.op:specialisation"] optgroup').length, 0);
      assert.equal(h.optionsOf(f.id, 'crit.0.op:specialisation').length, A.ENUM_OPS.length);
    });

    test('the log keeps the terse form, which is what reads well there', () => {
      const r = band('gpa', '70', '80');
      assert.includes(r.text('.query-log'), 'in [70 .. 80]');
    });

    test('choosing it gives the control room for its label', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      assert.equal(h.q('.criterion-controls').className, 'criterion-controls');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      assert.includes(h.q('.criterion-controls').className, 'two-col',
        '"in range" will not fit the 38px column the symbols live in');
      assert.includes(h.control(f.id, 'crit.0.op:gpa').className, 'op-wide');
    });

    test('and takes the room back when it is turned off', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      h.set(f.id, 'crit.0.op:gpa', 'gte');
      assert.equal(h.q('.criterion-controls').className, 'criterion-controls');
      assert.ok(h.control(f.id, 'crit.0.value:gpa'), 'the single value box is back');
    });

    test('every field that offers a range labels it the same way', () => {
      ['year', 'letterGrade', 'courses.gradePoints'].forEach(k => {
        const h = boot();
        const [s, f, o] = h.build('source', 'filter', 'output');
        h.set(f.id, 'crit.0.field', k);
        const labels = h.qa('[data-node="' + f.id + '"][data-key="crit.0.op:' + k + '"] option')
          .map(o2 => o2.textContent);
        assert.includes(labels, 'in range', k);
      });
    });
  });

  describe('the band appears only while the range is chosen', () => {
    test('picking the range opens it', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      assert.equal(h.q('.crit-range'), null, 'not there to begin with');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      assert.ok(h.q('.crit-range'), 'the band should open');
      assert.ok(h.control(f.id, 'crit.0.value:gpa:max'), 'with a second bound');
    });

    test('picking anything else closes it', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      h.set(f.id, 'crit.0.op:gpa', 'gte');
      assert.equal(h.q('.crit-range'), null);
      assert.equal(h.control(f.id, 'crit.0.value:gpa:max'), null);
    });

    test('one band per criterion, not one per filter', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      h.w.addCriterion(f.id);
      h.set(f.id, 'crit.1.field', 'year');
      h.set(f.id, 'crit.1.op:year', 'between');
      assert.equal(h.qa('.crit-range').length, 2);
    });

    test('the single-value box gives way rather than sitting beside it', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      const inRow = h.qa('.criterion-controls [data-key="crit.0.value:gpa"]');
      assert.equal(inRow.length, 0, 'two places to type a lower bound is one too many');
      assert.ok(h.q('.crit-range [data-key="crit.0.value:gpa"]'), 'it moved into the band');
    });

    test('the band is styled as a band, not as another criterion', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      const el = h.q('.crit-range');
      assert.ok(el.closest('.criterion-row'), 'it belongs to its criterion');
      assert.equal(h.qa('.criterion-row').length, 1, 'and does not read as a second condition');
    });
  });

  describe('the defaults are usable, not degenerate where they need not be', () => {
    test('an ordered column opens on its full span', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'year');
      h.set(f.id, 'crit.0.op:year', 'between');
      assert.equal(h.control(f.id, 'crit.0.value:year').value, String(A.YEARS[0]));
      assert.equal(h.control(f.id, 'crit.0.value:year:max').value, String(A.YEARS[A.YEARS.length - 1]));
    });

    test('a declared order supplies a default even with no value set', () => {
      /* letterGrade carries an order and nothing else. Without the fallback the
         control renders with nothing selected, the browser shows option one and
         the model still says "" — the disagreement the sort keys avoid. */
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'letterGrade');
      h.set(f.id, 'crit.0.op:letterGrade', 'between');
      assert.equal(h.control(f.id, 'crit.0.value:letterGrade').value, GRADE[0]);
      assert.equal(h.control(f.id, 'crit.0.value:letterGrade:max').value, GRADE[GRADE.length - 1]);
    });

    test('a plain number has no span to open across, and says so', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      const note = h.text('.crit-range-note');
      assert.includes(note, 'Both ends are');
      assert.includes(note, 'widen', 'it should say what to do about it');
    });

    test('switching to the range carries the value already typed in as the floor', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.value:gpa', '85');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      assert.equal(h.control(f.id, 'crit.0.value:gpa').value, '85',
        'switching operators should feel continuous, not reset');
    });

    test('switching away and back remembers both ends', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      h.set(f.id, 'crit.0.value:gpa', '60');
      h.set(f.id, 'crit.0.value:gpa:max', '90');
      h.set(f.id, 'crit.0.op:gpa', 'lt');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      assert.equal(h.control(f.id, 'crit.0.value:gpa').value, '60');
      assert.equal(h.control(f.id, 'crit.0.value:gpa:max').value, '90');
    });
  });

  describe('what it keeps, cross-checked against the dataset', () => {
    test('a number range, inclusive at both ends', () => {
      assert.equal(band('gpa', '70', '80').count(),
                   S.filter(x => x.gpa >= 70 && x.gpa <= 80).length);
    });

    test('the ends really are included', () => {
      const lo = Math.min(...S.map(x => x.gpa));
      assert.equal(band('gpa', String(lo), String(lo)).count(),
                   S.filter(x => x.gpa === lo).length,
                   'a band of one value keeps the rows equal to it');
      const hi = Math.max(...S.map(x => x.gpa));
      assert.equal(band('gpa', String(lo), String(hi)).count(), S.length,
                   'a band of the whole span keeps everyone');
    });

    test('a year range — the use case this was asked for', () => {
      const [y1, y2] = [A.YEARS[0], A.YEARS[A.YEARS.length - 1]];
      assert.equal(band('year', String(y1), String(y2)).count(), S.length);
      assert.equal(band('year', String(y1), String(y1)).count(),
                   S.filter(x => x.year === y1).length);
    });

    test('a grade band, ranked by the declared order rather than by spelling', () => {
      assert.equal(band('letterGrade', 'A+', 'B').count(), gradeBand('A+', 'B'));
      assert.equal(band('letterGrade', 'C+', 'C').count(), gradeBand('C+', 'C'));
      assert.equal(band('letterGrade', GRADE[0], GRADE[GRADE.length - 1]).count(), S.length);
    });

    test('a grade band is not a string comparison', () => {
      /* 'A+' < 'A-' lexically, because '+' precedes '-' in ASCII — the exact
         trap GRADE_ORDER exists for. A band from A+ to A- must contain A. */
      const n = band('letterGrade', 'A+', 'A-').count();
      assert.equal(n, gradeBand('A+', 'A-'));
      assert.ok(n >= S.filter(x => x.letterGrade === 'A').length, 'A must be inside A+ .. A-');
    });

    test('a course mark range', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(o.id, 'show', 'count');
      h.set(f.id, 'crit.0.field', 'courses.gradePoints');
      h.set(f.id, 'crit.0.op:courses.gradePoints', 'between');
      const code = h.control(f.id, 'crit.0.course').value;
      h.set(f.id, 'crit.0.value:courses.gradePoints', '70');
      h.set(f.id, 'crit.0.value:courses.gradePoints:max', '80');
      h.w.runQuery();
      const want = S.filter(x => {
        const e = x.courses.filter(c => c.code === code)[0];
        return e && e.mark >= 70 && e.mark <= 80;
      }).length;
      assert.equal(Number(h.bigNum()), want);
    });

    test('a band nothing falls inside keeps nothing, without erroring', () => {
      const r = band('gpa', '200', '300');
      assert.equal(r.count(), 0);
      assert.equal(r.q('.error-box'), null);
    });
  });

  describe('bounds entered the wrong way round', () => {
    test('mean the same band rather than nothing', () => {
      assert.equal(band('gpa', '80', '70').count(), band('gpa', '70', '80').count());
      assert.equal(band('letterGrade', 'B', 'A+').count(), gradeBand('A+', 'B'));
    });

    test('and the log prints the band that was applied', () => {
      const r = band('gpa', '80', '70');
      assert.includes(r.text('.query-log'), '[70 .. 80]',
        'the swap must be visible, not silent');
    });

    test('the panel says it read them the other way round', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      h.set(f.id, 'crit.0.value:gpa', '80');
      h.set(f.id, 'crit.0.value:gpa:max', '70');
      // Typing into a number box does not rebuild the panel — that would
      // destroy the field being typed into — so the note is read after a redraw
      h.w.render();
      assert.includes(h.text('.crit-range-note'), 'other way round');
    });
  });

  describe('an incomplete band is refused, never guessed at', () => {
    test('a cleared bound stops the run instead of ranking as zero', () => {
      /* Number('') is 0. Without a blank check the cleared upper bound ranked
         as zero, the bounds were then put "the right way round", and
         "between 70 and nothing" quietly became "between 0 and 70" — a
         different question, answered confidently. */
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(o.id, 'show', 'count');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      h.set(f.id, 'crit.0.value:gpa', '70');
      h.app.setCfg(f.id, 'crit.0.value:gpa:max', '');
      h.w.runQuery();
      assert.ok(h.text('.error-box'), 'it must not silently answer a different question');
      assert.includes(h.text('.error-box'), 'number');
    });

    test('rankerFor is where that is decided', () => {
      const rank = A.rankerFor({ key: 'n', type: A.COLTYPE.NUMBER });
      assert.equal(rank(''), null, 'blank has no position');
      assert.equal(rank(null), null);
      assert.equal(rank(undefined), null);
      assert.equal(rank('abc'), null);
      assert.equal(rank('70'), 70);
      assert.equal(rank(0), 0, 'but a real zero still ranks as zero');
    });

    test('a value outside a declared order has no position, so it is in no band', () => {
      const rank = A.rankerFor({ key: 'g', type: A.COLTYPE.TEXT, order: GRADE });
      assert.equal(rank('A+'), 0);
      assert.equal(rank(GRADE[GRADE.length - 1]), GRADE.length - 1);
      assert.equal(rank('Z-'), null, 'the same reading comparatorFor takes');
    });

    test('a course-mark band with one end cleared is refused too', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'courses.gradePoints');
      h.set(f.id, 'crit.0.op:courses.gradePoints', 'between');
      h.app.setCfg(f.id, 'crit.0.value:courses.gradePoints:max', '');
      h.w.runQuery();
      assert.ok(h.text('.error-box'));
    });
  });

  describe('it composes like any other condition', () => {
    test('a range ANDs with a plain condition', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(o.id, 'show', 'count');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      h.set(f.id, 'crit.0.value:gpa', '70');
      h.set(f.id, 'crit.0.value:gpa:max', '80');
      h.w.addCriterion(f.id);
      h.set(f.id, 'crit.1.field', 'gender');
      h.set(f.id, 'crit.1.value:gender', 'F');
      h.w.runQuery();
      assert.equal(Number(h.bigNum()),
        S.filter(x => x.gpa >= 70 && x.gpa <= 80 && x.gender === 'F').length);
    });

    test('two ranges AND with each other', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(o.id, 'show', 'count');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      h.set(f.id, 'crit.0.value:gpa', '60');
      h.set(f.id, 'crit.0.value:gpa:max', '90');
      h.w.addCriterion(f.id);
      h.set(f.id, 'crit.1.field', 'year');
      h.set(f.id, 'crit.1.op:year', 'between');
      const y = A.YEARS[0];
      h.set(f.id, 'crit.1.value:year', String(y));
      h.set(f.id, 'crit.1.value:year:max', String(y));
      h.w.runQuery();
      assert.equal(Number(h.bigNum()),
        S.filter(x => x.gpa >= 60 && x.gpa <= 90 && x.year === y).length);
    });

    test('a range survives being pushed through the rest of a graph', () => {
      const h = boot();
      const [s, f, sort, take, o] = h.build('source', 'filter', 'sort', 'take', 'output');
      h.set(f.id, 'crit.0.op:gpa', 'between');
      h.set(f.id, 'crit.0.value:gpa', '5');
      h.set(f.id, 'crit.0.value:gpa:max', '7');
      h.set(take.id, 'n', '3');
      h.w.runQuery();
      const t = h.entry(o.id).table;
      assert.equal(t.rows.length, 3);
      t.rows.forEach(r => {
        const v = A.cellAt(t, r, 'gpa');
        assert.ok(v >= 5 && v <= 7, 'every surviving row is inside the band: ' + v);
      });
    });
  });

  describe('persistence', () => {
    test('both bounds are saved and restored', () => {
      const r = band('letterGrade', 'A+', 'B');
      const before = r.count();
      const json = JSON.stringify(r.app.serialiseGraph());
      assert.includes(json, 'letterGrade:max', 'the second bound must reach the file');

      r.w.clearAll();
      r.app.loadGraphFromText(json, r.doc.createElement('button'));
      r.w.runQuery();
      assert.equal(Number(r.bigNum()), before);
    });

    test('the second bound rides in the existing values map, so the format did not change', () => {
      const r = band('gpa', '70', '80');
      const crit = r.app.serialiseGraph().nodes.find(n => n.type === 'filter').cfg.criteria[0];
      assert.equal(crit.values['gpa'], '70');
      assert.equal(crit.values[A.rangeKey('gpa')], '80');
      assert.equal(crit.ops['gpa'], 'between');
    });

    test('a file saved before the operator existed still loads', () => {
      const raw = JSON.stringify({
        kind: 'student-data-analyser-query', version: 1,
        nodes: [{ id: 1, type: 'filter', x: 0, y: 0,
                  cfg: { criteria: [{ field: 'gpa', values: { gpa: '70' }, ops: { gpa: 'gt' } }] } }],
        connections: []
      });
      const r = boot().app.deserialiseGraph(raw);
      assert.notOk(r.error);
      assert.equal(r.nodes[0].cfg.criteria[0].ops.gpa, 'gt');
    });

    test('a file naming the range on a column that cannot carry one falls back', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'specialisation');
      h.app.setCfg(f.id, 'crit.0.op:specialisation', 'between');
      h.w.render();
      const sel = h.control(f.id, 'crit.0.op:specialisation');
      assert.excludes(h.optionsOf(f.id, 'crit.0.op:specialisation'), 'between');
      assert.includes(A.ENUM_OPS, sel.value, 'the control must show an operator it actually offers');
    });
  });

  describe('escaping', () => {
    test('a bound cannot break out of the note or the control', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'letterGrade');
      h.set(f.id, 'crit.0.op:letterGrade', 'between');
      h.app.setCfg(f.id, 'crit.0.value:letterGrade', '"><img src=x onerror=alert(1)>');
      h.w.render();
      assert.equal(h.q('img'), null, 'markup in a bound must not become markup');
      assert.ok(h.q('.crit-range'), 'and the band should still render');
    });
  });
};
