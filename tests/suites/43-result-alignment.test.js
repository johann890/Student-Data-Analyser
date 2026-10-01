/* Where a value sits in the results panel, and what it sits under.

   The supervisor ran an average down the columns, showed Year and GPA, and got
   a single "5.53" pinned to the right-hand edge of the panel with the word GPA
   a few hundred pixels to its left. Nothing had computed the wrong answer: the
   table fills the panel, so two columns shared six hundred pixels between them,
   and the two halves of a numeric column were set in opposite directions. The
   cell went right, because the digits of a column of numbers have to line up.
   The heading went left, because `.rtable th` says so with a selector no weaker
   than `.cmp-num`, and so every number in this tool has been drawn under a
   heading that was somewhere else since the panel was written.

   Two things hold it together now and both are checked here:

     - a heading and the cells under it are set the same way, which means the
       question "is this column drawn as a number" is asked once. It was asked
       twice, and the two answers differed for a Courses column: the count went
       right with the numbers, its heading stayed left with the words.
     - the panel's leftover width goes to an empty column at the end, so the
       real columns are as wide as their contents and a value stays beside the
       heading it belongs to however wide the panel is dragged.

   WHAT THIS SUITE CANNOT SEE. jsdom does no layout, so nothing here can say a
   column is 58 pixels wide or that the filler swallowed the other 500. It can
   say what the markup is and what the stylesheet resolves to for a real element
   of a real result, which is what decides both. The widths themselves were read
   off a browser at three panel widths against every shape below.             */

const { boot, appStyles } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  /* THE CASCADE, SCORED THE WAY A BROWSER SCORES IT
     -------------------------------------------------------------------------
     jsdom's own getComputedStyle applies every matching rule in document order
     and ignores specificity. That is not a detail here: it is exactly the rule
     this bug turned on. `.cmp-num { text-align: right }` sits after
     `.rtable th { text-align: left }` in the cascade, so jsdom would report a
     right-aligned heading and pass a suite written against it, while every
     browser drew the heading on the left. So the stylesheet is read here and
     scored properly: weight first, then source order.

     The scoring covers the selector forms this stylesheet uses, which is tags,
     classes, attribute selectors and descendant combinators. There are no id
     selectors in it and nothing nested inside :not(), so neither is counted. */
  const SHEET = (() => {
    const dom = boot();
    const doc = dom.doc;
    const style = doc.createElement('style');
    style.textContent = appStyles();
    doc.head.appendChild(style);
    const out = [];
    [...doc.styleSheets[0].cssRules].forEach((rule, i) => {
      if (!rule.selectorText || !rule.style) return;
      out.push({ rule, order: i });
    });
    return out;
  })();

  function specificity(sel) {
    const ids = (sel.match(/#[A-Za-z_][\w-]*/g) || []).length;
    const classy = (sel.match(/\.[A-Za-z_][\w-]*|\[[^\]]+\]|:(?!:)[A-Za-z-]+(\([^)]*\))?/g) || []).length;
    const types = (sel.match(/(?:^|[\s>+~])[A-Za-z][\w-]*/g) || []).length;
    return (ids * 10000) + (classy * 100) + types;
  }

  /* What the shipped stylesheet resolves `prop` to for this element. Null when
     no rule claims it, which for text-align means the table's own default. */
  function styleOf(el, prop) {
    let best = null;
    SHEET.forEach(({ rule, order }) => {
      const value = rule.style.getPropertyValue(prop);
      if (!value) return;
      const weighty = rule.style.getPropertyPriority(prop) === 'important' ? 1 : 0;
      rule.selectorText.split(',').forEach(part => {
        const sel = part.trim();
        let hit = false;
        try { hit = el.matches(sel); } catch (e) { hit = false; }
        if (!hit) return;
        const rank = [weighty, specificity(sel), order];
        if (!best || rank[0] > best.rank[0] ||
            (rank[0] === best.rank[0] && rank[1] > best.rank[1]) ||
            (rank[0] === best.rank[0] && rank[1] === best.rank[1] && rank[2] > best.rank[2])) {
          best = { rank, value };
        }
      });
    });
    return best ? best.value : null;
  }

  const alignOf = (el) => styleOf(el, 'text-align') || 'left';

  /* EVERY CLAIM THIS SUITE MAKES ABOUT A TABLE, IN ONE PLACE
     -------------------------------------------------------------------------
     Returned as a list of complaints rather than asserted in place, so that a
     sweep over a dozen graph shapes names the shape that broke and the column
     inside it, instead of failing on a line that could have come from any of
     them. An empty list is a table that is drawn correctly.                  */
  function faults(table, where) {
    const bad = [];
    const say = (m) => bad.push(where + ': ' + m);

    const heads = [...table.querySelectorAll('thead th')];
    if (!heads.length) { say('no heading row'); return bad; }

    const fillHeads = heads.filter(th => th.classList.contains('rt-fill'));
    if (fillHeads.length !== 1) say('wants exactly one filler heading, has ' + fillHeads.length);
    if (!heads[heads.length - 1].classList.contains('rt-fill')) say('the filler is not the last heading');

    [...table.querySelectorAll('tbody tr')].forEach((tr, ri) => {
      const cells = [...tr.children];

      // The truncation row is one cell that stands in for the whole width.
      if (cells.length === 1 && cells[0].classList.contains('cmp-more')) {
        const span = Number(cells[0].getAttribute('colspan'));
        if (span !== heads.length) {
          say('the "more rows" line spans ' + span + ' of ' + heads.length + ' columns');
        }
        return;
      }

      if (cells.length !== heads.length) {
        say('row ' + ri + ' has ' + cells.length + ' cells under ' + heads.length + ' headings');
        return;
      }
      const fillCells = cells.filter(td => td.classList.contains('rt-fill'));
      if (fillCells.length !== 1) say('row ' + ri + ' has ' + fillCells.length + ' filler cells');
      if (!cells[cells.length - 1].classList.contains('rt-fill')) {
        say('row ' + ri + ' does not end with the filler');
      }
      if (cells[cells.length - 1].textContent !== '') say('row ' + ri + ' put data in the filler');

      cells.forEach((td, ci) => {
        if (td.classList.contains('rt-fill')) return;
        const head = heads[ci];
        if (alignOf(head) !== alignOf(td)) {
          say('column "' + head.textContent.trim() + '" is drawn ' + alignOf(td) +
              ' under a heading drawn ' + alignOf(head));
        }
        if (head.classList.contains('cmp-num') !== td.classList.contains('cmp-num')) {
          say('column "' + head.textContent.trim() + '" disagrees with its heading about being a number');
        }
      });
    });
    return bad;
  }

  const tablesIn = (h) => h.qa('#panelBody .rtable');

  function sweep(h, where) {
    const found = tablesIn(h);
    const bad = [];
    found.forEach((t, i) => {
      bad.push(...faults(t, where + (found.length > 1 ? ' (table ' + (i + 1) + ')' : '')));
    });
    return { count: found.length, bad };
  }

  /* ─────────────────────────────────────────────────────────────────────── */

  describe('the stylesheet', () => {
    test('a numeric heading is set to the right, where its numbers are', () => {
      const h = boot();
      h.build('source', 'output');
      h.w.runQuery();
      const gpa = h.qa('.rtable thead th').find(th => th.textContent.trim() === 'GPA');
      assert.ok(gpa, 'the run should draw a GPA column');
      assert.equal(alignOf(gpa), 'right',
        'the heading a number sits under must be set the way the number is');
    });

    test('a text heading is left alone', () => {
      const h = boot();
      h.build('source', 'output');
      h.w.runQuery();
      const degree = h.qa('.rtable thead th').find(th => th.textContent.trim() === 'Degree');
      assert.equal(alignOf(degree), 'left');
    });

    test('the heading rule still governs the columns it should', () => {
      /* The fix is a rule for numeric headings, not a loosening of the heading
         rule itself, which is right for every other column in the table. */
      const css = appStyles();
      assert.includes(css.replace(/\s+/g, ' '), '.rtable th { padding: 5px 9px; text-align: left;');
    });

    test('the filler column asks for all of the width that is going', () => {
      const h = boot();
      h.build('source', 'output');
      h.w.runQuery();
      const fill = h.q('.rtable .rt-fill');
      assert.ok(fill, 'every result table should carry one');
      assert.equal(styleOf(fill, 'width'), '100%',
        'this is the whole mechanism: the leftover width has to land here rather ' +
        'than being shared out among the real columns');
      assert.equal(styleOf(fill, 'padding'), '0',
        'an empty column should not also take up room');
    });
  });

  describe('the filler column', () => {
    function rows() {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.w.runQuery();
      return { ...h, s, o };
    }

    test('it is the last cell of the heading row and of every body row', () => {
      const r = rows();
      assert.deepEqual(sweep(r, 'rows').bad, []);
    });

    test('it holds nothing and is hidden from a screen reader', () => {
      const r = rows();
      /* Counted first: a loop over nothing is a test that cannot fail. Every
         row has one except the "... N more" line, which is a single cell
         spanning the lot. */
      const lines = r.qa('.rtable tr').filter(tr => !tr.querySelector('.cmp-more'));
      assert.ok(lines.length > 1, 'the run should have drawn some rows');
      assert.equal(r.qa('.rt-fill').length, lines.length,
        'one filler per row, heading row included');
      r.qa('.rt-fill').forEach(el => {
        assert.equal(el.textContent, '', 'the filler is not for data');
        assert.equal(el.getAttribute('aria-hidden'), 'true',
          'an empty cell on all 80 rows must not be announced');
      });
    });

    test('the truncation line spans it, so no rule hangs over a gap', () => {
      const r = rows();
      const more = r.q('.cmp-more');
      assert.ok(more, 'the synthetic dataset is longer than the display limit');
      assert.equal(Number(more.getAttribute('colspan')),
                   r.qa('.rtable thead th').length);
    });

    test('a result with no rows still has it in the heading', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.value:gpa', '99');
      h.w.runQuery();
      assert.equal(h.qa('.rtable tbody tr').length, 0, 'nothing should match');
      assert.equal(h.qa('.rtable thead th.rt-fill').length, 1);
    });

    test('a table with no columns draws no table, and so no filler', () => {
      const h = boot();
      const html = h.app.tableHTML(h.app.makeTable([], []), 'Rows', '0');
      assert.excludes(html, 'rt-fill');
      assert.includes(html, 'no columns');
    });

    test('ticking a column redraws the view with it still there', () => {
      /* The view is replaced without a re-run, by a different code path than
         the one the run uses. It is the same builder underneath and this is
         what says so. */
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.w.runQuery();
      h.set(o.id, 'column:gpa', false);
      assert.deepEqual(sweep(h, 'after unticking GPA').bad, []);
      assert.equal(h.qa('.rtable thead th.rt-fill').length, 1);
    });
  });

  describe('a heading is drawn the way its column is', () => {
    test('a Courses count is a number on both rows', () => {
      /* The one column the two answers disagreed about: it is shown as a count
         of enrolments, its cells were set with the numbers and its heading was
         only ever tested for COLTYPE.NUMBER. */
      const h = boot();
      h.build('source', 'output');
      h.w.runQuery();
      const heads = h.qa('.rtable thead th');
      const courses = heads.find(th => th.textContent.trim() === 'Courses');
      assert.ok(courses, 'the student table carries a Courses column');
      assert.ok(courses.classList.contains('cmp-num'),
        'a column of counts is a column of numbers, heading included');
      assert.equal(alignOf(courses), alignOf(h.q('.rtable td.crs-cell')));
    });

    test('Aggregate columns makes every column a number, headings and all', () => {
      // The reported case: average down the columns, then show two of them.
      const h = boot();
      const [s, a, o] = h.build('source', 'aggregateColumns', 'output');
      h.w.runQuery();
      const heads = h.qa('.rtable thead th:not(.rt-fill)');
      assert.ok(heads.length > 1, 'the aggregate keeps the header it was given');
      heads.forEach(th => assert.equal(alignOf(th), 'right',
        '"' + th.textContent.trim() + '" holds a measure now, whatever it held before'));
      assert.deepEqual(sweep(h, 'aggregate columns').bad, []);
    });

    test('the two halves of the decision cannot drift apart again', () => {
      /* Both are one predicate now. If a third column type is added and only
         the cell learns about it, this is what fails. */
      const h = boot();
      const A = h.app;
      const t = A.makeTable([
        { key: 'a', label: 'N',   type: A.COLTYPE.NUMBER },
        { key: 'b', label: 'W',   type: A.COLTYPE.TEXT },
        { key: 'c', label: 'E',   type: A.COLTYPE.ENUM },
        { key: 'd', label: 'C',   type: A.COLTYPE.COURSES }
      ], [[1, 'x', 'y', [{ code: 'SWEN221' }]]]);
      h.doc.getElementById('panelBody').innerHTML = A.tableHTML(t, 'Rows', '1');
      assert.deepEqual(sweep(h, 'one column of every type').bad, []);
    });
  });

  /* EVERY SHAPE THE PANEL CAN DRAW
     -------------------------------------------------------------------------
     The bug was reported against one of these and was true of all of them, so
     the check is run against all of them. Each entry builds a graph, runs it,
     and hands every table the panel drew to the same set of claims.          */
  describe('across every shape the panel draws', () => {
    const SHAPES = {
      'plain rows': (h) => h.build('source', 'output'),
      'a filtered list': (h) => h.build('source', 'filter', 'output'),
      'one column': (h) => {
        const made = h.build('source', 'select', 'output');
        ['id', 'gender', 'year', 'degree', 'specialisation', 'letterGrade', 'courses']
          .forEach(k => h.set(made[1].id, 'column:' + k, false));
        return made;
      },
      'sorted and cut short': (h) => h.build('source', 'sort', 'take', 'output'),
      'unique values': (h) => h.build('source', 'unique', 'output'),
      'one enrolment per row': (h) => h.build('source', 'project', 'output'),
      'aggregate down the columns': (h) => h.build('source', 'aggregateColumns', 'output'),
      'aggregate along the rows': (h) => h.build('source', 'aggregateRows', 'output'),
      'a histogram': (h) => h.build('source', 'histogram', 'output'),
      'a group for each value': (h) => h.build('source', 'selectFor', 'output'),
      'a comparison': (h) => {
        const s1 = h.add('source'), f1 = h.add('filter'),
              s2 = h.add('source'), f2 = h.add('filter'),
              c = h.add('compare'), o = h.add('output');
        h.app.connect(s1.id, f1.id); h.app.connect(s2.id, f2.id);
        h.app.connect(f1.id, c.id); h.app.connect(f2.id, c.id);
        h.app.connect(c.id, o.id);
        h.set(f1.id, 'crit.0.value:gpa', '3');
        h.set(f2.id, 'crit.0.value:gpa', '7');
        h.w.render();
        return [s1, f1, s2, f2, c, o];
      },
      'two tables from one run': (h) => {
        const [s, o1] = h.build('source', 'output');
        const a = h.add('aggregateColumns'), o2 = h.add('output');
        h.app.connect(s.id, a.id); h.app.connect(a.id, o2.id);
        h.w.render();
        return [s, o1, a, o2];
      }
    };

    Object.keys(SHAPES).forEach(name => {
      test(name, () => {
        const h = boot();
        SHAPES[name](h);
        h.w.runQuery();
        const swept = sweep(h, name);
        assert.deepEqual(swept.bad, []);
        assert.ok(swept.count > 0, name + ' drew no table to check');
      });
    });

    /* The view that draws a table per branch under the summary. Kept apart from
       the sweep above because it is a setting on the Output rather than a
       different graph, and because the cards are the one place a table is drawn
       inside another result rather than as the result. */
    test('every branch card of a SelectFor', () => {
      const h = boot();
      const [s, sf, out] = h.build('source', 'selectFor', 'output');
      h.w.runQuery();
      h.set(out.id, 'show', 'lists');
      h.w.render();
      h.w.runQuery();
      const swept = sweep(h, 'selectFor lists');
      assert.ok(swept.count > 2, 'a summary and a card for each group, got ' + swept.count);
      assert.deepEqual(swept.bad, []);
    });

    test('every branch card of a Compare', () => {
      // A Compare-fed Output opens on `lists`, so this is its ordinary state.
      const h = boot();
      const s1 = h.add('source'), f1 = h.add('filter'),
            s2 = h.add('source'), f2 = h.add('filter'),
            c = h.add('compare'), o = h.add('output');
      h.app.connect(s1.id, f1.id); h.app.connect(s2.id, f2.id);
      h.app.connect(f1.id, c.id); h.app.connect(f2.id, c.id);
      h.app.connect(c.id, o.id);
      h.set(f1.id, 'crit.0.value:gpa', '3');
      h.set(f2.id, 'crit.0.value:gpa', '7');
      h.w.render();
      h.w.runQuery();
      const swept = sweep(h, 'compare lists');
      assert.ok(swept.count > 2, 'a summary and a card for each branch, got ' + swept.count);
      assert.deepEqual(swept.bad, []);
    });

    test('a single value is still a headline, not a one-cell table', () => {
      /* The filler must not turn a scalar into a table: nothing about this
         change should reach the big-number display. */
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(o.id, 'show', 'count');
      h.w.runQuery();
      assert.equal(tablesIn(h).length, 0, 'a count is a headline number');
      assert.ok(h.bigNum(), 'and it is still drawn');
    });
  });
};
