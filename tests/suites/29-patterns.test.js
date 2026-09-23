/* PATTERNS: one wildcard where two convenience fields used to be
   ===========================================================================
   The supervisor's closing note: "It is very good that Filter allows for
   selecting 'subjects' and 'levels' but note that a more powerful way of
   achieving the same would be to support regular expression. For instance
   using 'SWEN*' for 'course' would select the subject 'SWEN' and using '*4..'
   would select 400-level courses", and the point behind it, that patterns
   "would result in fewer filter nodes being required".

   The claim worth testing is the one he made rather than the feature on its
   own: that a pattern over the code reaches what Took subject and Took level
   reach. So the interesting tests here are EQUIVALENCES. If SWEN* does not
   keep exactly the students Took subject SWEN keeps, the pattern is not doing
   what he said it would, however well it matches strings in isolation.

   WILDCARDS, NOT REGULAR EXPRESSIONS, which is less than he asked for. His own
   first example is a wildcard, and the other two translate by one character.
   What that buys is the property in the second group here: there is no such
   thing as an invalid pattern, because nothing a user types becomes syntax.   */

const { boot, hasDataDir } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const A = boot().app;

  describe('a wildcard is translated, and anchored', () => {

    const hits = (pattern, value) => A.globToRegExp(pattern).test(value);

    test('* is any run of characters', () => {
      assert.ok(hits('SWEN*', 'SWEN301'));
      assert.ok(hits('SWEN*', 'SWEN'), 'any run includes none of them');
      assert.notOk(hits('SWEN*', 'COMP103'));
    });

    test('? is exactly one', () => {
      assert.ok(hits('SWEN3??', 'SWEN301'));
      assert.notOk(hits('SWEN3??', 'SWEN30'), 'one short');
      assert.notOk(hits('SWEN3??', 'SWEN3012'), 'one long');
    });

    /* "SWEN" means the code SWEN, not every code containing it. Unanchored,
       every pattern would silently mean "*pattern*" and a user asking for one
       course would get the four that share its prefix. */
    test('a pattern is the whole code, not part of it', () => {
      assert.ok(hits('COMP103', 'COMP103'));
      assert.notOk(hits('COMP', 'COMP103'), 'a bare subject must not match a course');
      assert.notOk(hits('103', 'COMP103'));
    });

    test('case is not a different question', () => {
      assert.ok(hits('swen*', 'SWEN301'));
      assert.ok(hits('SWEN*', 'swen301'));
    });

    test('his examples, as he wrote them and as they translate', () => {
      assert.ok(hits('SWEN*', 'SWEN421'), 'SWEN* is every SWEN course');
      assert.ok(hits('*4??', 'SWEN401'), '*4?? is 400 level, whatever the subject');
      assert.notOk(hits('*4??', 'SWEN301'));
      assert.ok(hits('SWEN3??', 'SWEN301'), 'SWEN3?? is 300-level SWEN');
      assert.notOk(hits('SWEN3??', 'COMP301'));
    });
  });

  describe('nothing a user types becomes syntax', () => {

    /* The reason for wildcards over regular expressions. Every one of these is
       a pattern somebody could plausibly type, and in a regex dialect each is
       either an error or means something they did not ask for. */
    test('regex metacharacters are searched for, not obeyed', () => {
      [['C[O]MP', 'C[O]MP'], ['A+', 'A+'], ['a.c', 'a.c'],
       ['x(y)', 'x(y)'], ['a|b', 'a|b'], ['^start', '^start'],
       ['end$', 'end$'], ['back\\slash', 'back\\slash']
      ].forEach(([pattern, value]) => {
        assert.ok(A.globToRegExp(pattern).test(value),
          pattern + ' should match itself literally');
      });
    });

    test('a dot is a dot, not any character', () => {
      assert.ok(A.globToRegExp('a.c').test('a.c'));
      assert.notOk(A.globToRegExp('a.c').test('abc'),
        'if this passes, the pattern language is a regex and his *4.. is a trap');
    });

    test('no pattern can throw', () => {
      ['[', '(', '\\', '*', '?', '**', '+', '{2,', ''].forEach(p => {
        A.globToRegExp(p);   // a throw here fails the test by escaping
      });
      assert.ok(true);
    });
  });

  describe('the operator is offered where a code is', () => {

    test('Took course and Took subject offer it', () => {
      assert.includes(A.CODE_OPS, 'matches');
    });

    test('and it reads as a comparison rather than a list', () => {
      // opGroups puts anything that is not a range or a list under Compare, so
      // the pattern sits beside "is" where a user looking for it would look.
      const groups = A.opGroups(A.CODE_OPS);
      const compare = groups.filter(g => g.label === 'Compare')[0];
      assert.ok(compare && compare.ops.indexOf('matches') !== -1);
    });
  });

  describe('the panel gives it a box and says what the wildcards do', () => {

    function filterOn(field, op) {
      const h = boot();
      const [src, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', field);
      h.w.render();
      h.set(f.id, 'crit.0.op:' + field, op);
      h.w.render();
      return { ...h, f };
    }

    test('a pattern gets a text box, not the course dropdown', () => {
      const h = filterOn('courses.code', 'matches');
      const box = h.app.nodes && h.doc.querySelector(
        '[data-key="crit.0.value:courses.code"]');
      assert.ok(box, 'no control for the pattern');
      assert.equal(box.tagName, 'INPUT', 'a pattern cannot be picked from a list');
    });

    test('and the two wildcards are explained beside it', () => {
      const h = filterOn('courses.code', 'matches');
      const note = h.doc.querySelector('.crit-pattern-note');
      assert.ok(note, 'a pattern language is not guessable from an empty box');
      assert.includes(note.textContent, '*');
      assert.includes(note.textContent, '?');
    });

    test('choosing "is" again brings the dropdown back', () => {
      const h = filterOn('courses.code', 'eq');
      const box = h.doc.querySelector('[data-key="crit.0.value:courses.code"]');
      assert.equal(box.tagName, 'SELECT');
      assert.notOk(h.doc.querySelector('.crit-pattern-note'));
    });
  });

  if (!hasDataDir()) {
    describe('against the real archive (skipped: no data directory)', () => {
      test('skipped', () => {});
    });
  } else {
    describe('against the real archive', () => {

      async function run(field, op, value) {
        const h = boot();
        const [src, f, o] = h.build('source', 'filter', 'output');
        const ds = await h.loadArchive(src.id, [2024]);
        h.w.render();
        h.set(f.id, 'crit.0.field', field);
        h.w.render();
        h.set(f.id, 'crit.0.op:' + field, op);
        h.w.render();
        h.set(f.id, 'crit.0.value:' + field, value);
        h.w.render();
        h.w.runQuery();
        /* The entry is absent when the run was refused, which is a case one of
           these tests is specifically about. Reaching through it would fail
           that test on the wrong line and report a TypeError rather than the
           refusal it is checking for. */
        const entry = h.entry(o.id);
        return { h, o, ds, table: entry ? entry.source : null };
      }

      test('SWEN* keeps exactly the students a SWEN course keeps', async () => {
        const { table, ds } = await run('courses.code', 'matches', 'SWEN*');
        const raw = ds.students.filter(s =>
          s.courses.some(c => /^SWEN/.test(c.code))).length;
        assert.ok(raw > 0, 'the fixture has to contain some SWEN enrolments');
        assert.equal(table.rows.length, raw);
      });

      /* His actual claim, tested as an equivalence. If these two disagree, a
         pattern does not reach what Took subject reaches and the argument for
         fewer filter nodes does not hold. */
      test('SWEN* on the code is Took subject SWEN', async () => {
        const byPattern = await run('courses.code', 'matches', 'SWEN*');
        const byField   = await run('courses.subject', 'eq', 'SWEN');
        assert.equal(byPattern.table.rows.length, byField.table.rows.length,
          'the pattern must reach what the convenience field reaches');
      });

      test('*4?? on the code is Took level 400', async () => {
        const byPattern = await run('courses.code', 'matches', '*4??');
        const byField   = await run('courses.level', 'eq', '4');
        assert.equal(byPattern.table.rows.length, byField.table.rows.length);
        assert.ok(byPattern.table.rows.length > 0);
      });

      /* Row semantics, which the pattern must not quietly change: this keeps
         STUDENTS, and a student who took six SWEN courses is one student. */
      test('a student is kept once however many courses match', async () => {
        const { table } = await run('courses.code', 'matches', 'SWEN*');
        const ids = table.rows.map(r => r[0]);
        assert.equal(new Set(ids).size, ids.length,
          'a pattern must not multiply rows the way a Project does');
      });

      test('an empty pattern is refused rather than matching nothing', async () => {
        const { h } = await run('courses.code', 'matches', '   ');
        assert.ok(h.q('.error-box'), 'an empty pattern silently keeping no rows looks like an answer');
        assert.includes(h.text('.error-box'), 'pattern');
      });

      test('the log says what was matched against', async () => {
        const { h, o } = await run('courses.code', 'matches', 'SWEN*');
        const log = h.entry(o.id).log.join('\n');
        assert.includes(log, 'matching');
        assert.includes(log, 'SWEN*');
      });
    });
  }
};
