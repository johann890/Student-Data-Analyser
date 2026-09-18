# Tests — Student Data Analyser

Automated test suite for the node-based student query analyser.

## Running

```bash
cd tests
npm install          # once — installs jsdom, the only dependency
npm test             # run everything
npm run test:verbose # list every passing test, not just failures
node run.js filter   # run only suites whose filename matches "filter"
```

Exit code is `0` when everything passes and `1` otherwise, so this can gate a
commit hook or a CI step directly.

## Layout

```
tests/
  run.js                 test runner — discovery, reporting, exit code
  lib/harness.js         boots the app in jsdom, exposes internals, UI helpers
  lib/assert.js          assertions (equal, close, deepEqual, includes, ...)
  suites/*.test.js       the tests
```

## The data the suites run against

Two datasets, for two different jobs.

**The built-in synthetic one** is what `app.js` used to ship with. It is now
installed only under `__QB_TEST__` (`installSyntheticDataset()`), so a real page
opens with no data and a Source refuses to run until it is handed files. Several
hundred assertions are written in terms of its forty students a year and its
seeded GPAs, and rewriting them against the archive would have changed what those
tests *say* rather than what they check — so the generator stayed, behind the
same flag that publishes the internals.

`20-source-loading` calls `setSyntheticDataset(null)` around the blocks that test
the refusal, because a refusal tested with a fallback still in place is not the
refusal a user would meet.

**The real archive** lives in `../data` beside the application, and `19-data-files`
reads it through the shipped parser. A parser tested only against fixtures its own
author wrote is a parser tested against its own assumptions; fixtures still cover
the refusals, because a file has to be malformed deliberately.

If `../data` is absent those tests return early rather than failing — the suite
should still be runnable from a checkout that does not carry student records.

The archive has **three** years: 2022 and 2023 as exported, and 2024, which was
built afterwards to carry the patterns two years cannot express. A trend needs
three points — two years tell you a number changed but not which way it is
going — and the movement between programmes that the head of school and the
programme directors care about was simply absent, because nobody in 2022 or 2023
changes degree or major at all.

`20-source-loading` still needs more year files than the archive holds, and
makes them by rewriting the `Year` column of the real 2022 export, so they are
genuine files by every rule in the parser — same 27 columns, same tab
separation, same rows — differing only in the one field the file name has to
agree with. A hand-written fixture would have been a fixture the parser was
allowed to disagree with.

## Asynchronous tests

`run.js` awaits each test function, because the loading path goes through a real
`FileReader` and a `FileReader` is asynchronous by construction. Stubbing it would
have left the very path those suites exist to check — pick a file, read it, refuse
or accept it — untested in favour of a synchronous imitation.

The harness's `waitFor(predicate)` polls with a ceiling, rather than guessing at a
fixed delay that is flaky on a slow machine and slow on a fast one. `choose()`
puts real `File` objects on a hidden input and fires `change`, which is exactly
where the browser stands after a pick: everything inward of the listener is the
shipped code.

## Where it looks for the application

By default the harness searches sibling folders for one containing `data.js`,
`engine.js`, `ui.js` and an `.html` file — `../MMP`, `../mmp`, `../MVP`, `../mvp`, then `..`. To point it
somewhere else:

```bash
APP_DIR=../some/other/folder npm test
```

If nothing is found it fails with a message rather than testing nothing.

## How the harness reaches inside the application

The application is three classic scripts — `data.js`, `engine.js`, `ui.js` —
sharing one global scope, with no module system. That is deliberate: the tool has
to run from a `file://` URL with no build step, where a module script is fetched
with CORS against an opaque origin and refused outright. The harness loads them
in the page's order, which is load-bearing — `ui.js` ends by wiring events and
painting the first frame, and needs the other two parsed.

`ui.js` solves the access question itself. Setting `window.__QB_TEST__ = true` **before** it
loads makes it publish its internals on `window.__qb`. In normal use the flag is
undefined, nothing is exported, and the cost is one branch at start-up.

```js
w.__QB_TEST__ = true;
w.eval(fs.readFileSync(APP_JS, 'utf8'));   // the shipped file, verbatim
```

### Why not source injection

This harness used to rewrite the source instead, splicing an export block in
before the closing `})();`. The application warns against exactly that, and was
right:

> The alternative — having the tests reach in by rewriting the source text — is
> silently broken by any edit near the end of this file, and a test suite that
> fails for reasons unrelated to the code under test is worse than none.

That is what happened. The injected block named six functions
(`enrolmentsTable`, `toEnrolments`, `breakdownTable`, `explodesHere`,
`canExplode`, `ENROLMENT_COLUMNS`) that a later refactor deleted, so **every**
test died at boot with `enrolmentsTable is not defined` — none of them reached
anything they were meant to be testing.

The flag cannot rot that way. If a symbol goes, the suite that uses it fails on
its own line and names it.

### Adding to the hook

If a test needs something `__qb` does not expose, add it to the export block at
the bottom of `ui.js` rather than reaching around it. The block is grouped by
subject; put the new entry with its neighbours.

Live state (`nodes`, `connections`, `exportData`, `selection`, `view`) is
exported as *functions*, because those bindings are reassigned wholesale by
`clearAll()` and `applyGraph()` and a captured value would go stale. The harness
bridges them back to getters so tests can write `app.nodes`, in one place —
`shim()` in `lib/harness.js`.

## The suites

| Suite | Covers |
|---|---|
| `01-dataset` | The grade model, and the built-in dataset's invariants: eight courses each, `gradeAvg` equals the mean of the marks, letter grades agree with numbers, catalogue fully exercised, generation is deterministic |
| `02-table-model` | The `{columns, rows, meta}` primitive: access by key, finding the nested column by type rather than name, type-driven cell formatting |
| `03-filter` | Every field type and operator, cross-checked against the raw dataset; multi-criterion AND; criteria orphaned by a narrowed header |
| `04-schema` | Schema propagation, and that the Filter and Aggregate panels follow the incoming table rather than assuming student records |
| `05-output` | Every output is a table; count is 1×1; scalar vs table display; show-type normalisation; multiple outputs |
| `06-export` | CSV quoting and escaping, field-count integrity, file naming, the staleness guard |
| `07-saveload` | Round trip, rejection of non-query files, repair of salvageable ones, forward compatibility, the save dialog |
| `08-graph` | Wiring rules, topological order, cycle detection, single-input arity, Combine, guard rails |
| `09-ui-state` | Config lives in the model; dragging does not rebuild the DOM; typing does not destroy the field; escaping |
| `10-aggregation` | Aggregate and AggregateColumns: the operation set, every measure cross-checked against the dataset, empty input, the registry invariant, persistence |
| `11-edge-preview` | The hover preview: the column cap and the stylesheet width held together, what is shown and which columns, real edges |
| `12-compare-downstream` | Compare feeding the row nodes: every downstream node accepts a comparison, the registry invariant holds for each, and branch metadata stops being honoured the moment it stops describing the rows |
| `13-reverse` | The Reverse node: registration in all six tables, row order, the Sort/Reverse/Take pairing, and the in-place-mutation guard |
| `14-aggregate-rows` | AggregateRows: the mirror of AggregateColumns, values cross-checked against the dataset, which cells feed the measure, and composition with Select |
| `15-output-columns` | Choosing columns on an Output: the control, that it changes the view and never the answer, where the picker does and does not appear, and both empty-selection guards |
| `16-range` | The `between` operator: that it can be found at all, which columns may carry a range and which may not, the amber band's appearance, bounds cross-checked against the dataset on numbers, years and grade letters, reversed and incomplete bounds |
| `17-shape-styling` | The model's `SHAPE` geometry against the stylesheet's, and that every processing node is named in its family's colour rule and its menu group |
| `18-project` | The Project node: the unfold cross-checked against the raw enrolments, that the change in row identity is *visible*, the header being statically known, and use case (f) |
| `19-data-files` | The boundary between an arbitrary file and the DOM: the two name rules, the size caps, the column file, every per-field check in a year file, the file-name/row-year agreement, and the real archive in `../data` read end to end |
| `21-level-and-degree` | Course level (derived from the code) and degree (read from `deg1`): what they are against the archive, the `Took level` predicate and its operators, level as a measurable column after a Project — and guards for the two positional-array bugs adding them caused |
| `22-archive-patterns` | The patterns `../data` claims to carry, read through the shipped parser: three linked years, the BEHONS CYBR → BSC COMP migration, a course improving every year, courses growing and shrinking every year, the reliably hard and reliably easy ones measured against the cohort, and the student-level claims — progression, own-subject advantage, who leaves and why |
| `20-source-loading` | The Source from the picker to the answer: the two ordered pickers driven through the real hidden inputs, year files accumulating across picks and coming back off one at a time, all-or-nothing within a pick, one Source per dataset, and that a saved query carries the graph and not one byte of the records |

### What was removed, and why

Roughly thirty tests were deleted rather than repaired, because the features
they covered no longer exist:

| Gone | Where it went |
|---|---|
| `toEnrolments` / the unfold (6) | Source enrolment granularity removed in `52d5e6a`. `app.js:238` records that unfolding should return as a **node** on the canvas, where the change in row identity is visible. Restore these with it — `git show 52d5e6a` has the implementation and the original tests. |
| `breakdownTable` (5) | The Output's course-breakdown shortcut, removed in the same commit. Built on the canvas now: filter, group, aggregate. |
| Enrolment-granularity filter and schema tests (8) | Same removal. A row is always a student, so "filters rows, not students" no longer names two different things. |
| The Output's Average shortcut (4) | Averaging is an Aggregate wired in front. The claims moved to `10-aggregation`. |
| The implicit union (6) | Two wires into one node no longer merge quietly (`app.js:615`). `08-graph` now tests the refusal, and Combine. |

Several assertions were **reversed** rather than deleted, where behaviour
changed deliberately. Each says so at the point of the change:

- Year *is* filterable now (`03-filter`, `04-schema`) — `app.js:1149` explains why.
- Saved CSVs carry **no** timestamp (`06-export`) — the name typed is the name written.
- `saveGraph` opens a naming dialog rather than writing immediately (`07-saveload`).
- `CONNECT_RULES.compare` is no longer `['output']` (`08-graph`) — a comparison
  can be sorted, taken and aggregated like any other table.

## Rows are built from the column list, not beside it

Adding Degree to `STUDENT_COLUMNS` and Level to `enrolmentColumns()` broke two
things at once, in the same way and for the same reason: both row builders were
hand-written positional arrays sitting next to a column list, and neither was
updated with it. Every cell after the insertion point shifted one place.

Neither threw. A Filter on Specialisation started reading grades and returning
zero rows; a projected Grade points column held a letter and Grade held nothing.
Both produced output that looked like output.

`studentsTable()` and `applyProject()` now map over the column list by `key`, so
the invariant is true by construction rather than by vigilance, and
`21-level-and-degree` asserts the stronger version of it — not just that a row
has one cell per column, but that the cell under each column *is that column's
value*. A matching length is what both bugs already had.

Two consequences for writing tests here:

- assert column counts against `A.STUDENT_COLUMNS.length`, not against a
  literal, so a column added tomorrow moves the expectation instead of failing
  it. Several suites were changed to do this;
- where a test unticks columns by name to leave a known set behind, the new
  column has to be named in that list. That is not boilerplate — it is the test
  saying which columns it means.

## Tests that must be able to fail

Two guards here assert the *absence* of a bug, which makes them easy to write in
a form that can never go red. Both were checked by reintroducing the bug and
confirming the suite caught it:

- **`13-reverse` › a sibling branch off the same Source is unaffected.** Change
  `t.rows.slice().reverse()` to `t.rows.reverse()` in `applyReverse` and three
  tests fail. Without a forking graph the in-place version passes everything.
- **`12-compare-downstream` › a Take past a Compare exports the rows it kept.**
  Change `e.show !== 'lists'` back to `e.show === 'summary'` in
  `exportTableFor` and this fails. It needs a node *between* the Compare and the
  Output to show up at all.
- **`15-output-columns` › the two empty-selection guards.** An Output is stopped
  from showing no columns twice over — `setCfg` refuses to write an empty list,
  and `selectedCols` falls back to the whole header if one reaches it anyway.
  They are tested separately *because* a single test of the outcome passes when
  either one is removed. That is how the first version of this test was written,
  and it could not fail. Remove each guard in turn and exactly one test should
  go red.

- **`16-range` › a cleared bound stops the run instead of ranking as zero.**
  Remove the `isBlank(v)` line from `rankerFor` and two tests fail. `Number('')`
  is `0`, so without it a cleared upper bound ranked as zero, the bounds were
  put "the right way round", and "between 70 and nothing" became "between 0 and
  70" — a different question, answered confidently, with a log line reading
  `[ .. 70]` as the only clue.

- **`22-archive-patterns` › the pattern guards.** All four were checked by
  breaking the archive rather than the code: putting the three migrants back
  into BEHONS CYBR, flattening COMP103's improvement to a straight C, and moving
  sixteen enrolments into NWEN438 so it grew instead of shrank. Each fails
  exactly the test that names it.

  The leaver guard needed two goes, and is the reason this list is worth
  keeping. Its first version passed a deliberately broken archive, because
  "students who left before finishing" was written as *mean course level below
  3.5* — and a final-year student carrying three 300-level papers averages 3.4.
  Three graduands leaked into the attrition pool and held the assertion up on
  their own. Rewriting it as the modal level was not enough either: four 300s
  against four 400s is a tie, the tie broke downward, and the same three
  students came back. It now reads the ENGR489 capstone first and breaks ties
  upward. **A test about who leaves is only as good as its definition of who has
  finished**, and in this archive the graduands outnumber the leavers two to
  one.

If any of these is ever rewritten, re-check it the same way.

## The leaver pattern reads backwards unless you exclude the graduands

Worth stating on its own, because it caught both the data and the test that was
written to check it, and it will catch the next person to query this archive.

Taken as a whole, the students who leave have *higher* averages than the
students who stay — 5.84 against 5.35 across 2022 → 2023. That looks like the
"students who leave early were struggling" pattern is simply absent. It is not.
Almost every leaver is a final-year student who has **finished**, and final-year
students are the strongest in the archive because everybody improves as they
progress. Graduation swamps attrition: 62 of the 88 who go after 2023 are
completing.

Within each non-final year the pattern is clean and always was — leavers sit
roughly a grade below the students who stay. The 2024 file makes the other half
true as well, which it was not before: a minority of the students who go before
finishing are doing *well* when they go, because people leave for a job offer
and not only because they are failing. So the honest claim is that leavers are
*mostly* struggling, and an analysis that reports otherwise has usually forgotten
to take the graduands out.

## Testing that something is visible

`18-project` has a describe block called "the change in row identity is
visible", and it is the unusual half of that suite. Project is correct if it
produces the right rows; it is *finished* only if a person can see that a row
has stopped being a student. That distinction is not pedantry — the same
operation used to be a dropdown on the Source, and it was removed precisely
because it made "count students" wrong by a factor of eight with nothing on
screen to say so.

So four separate things are asserted, because each is a separate way the node
announces itself and any one could be removed without the numbers changing:

| Signal | Test |
|---|---|
| `id` becomes `studentId` | the old name must not survive |
| the log states the multiplication | 80 rows → 640 rows, one per course |
| the panel warns before anything runs | "counts enrolments" |
| the warning is coloured | `.proj-warn`, the only coloured hint on any panel |

All four were checked by removing them one at a time. Dropping the rename fails
eight tests, dropping the log line fails one, and making the warning a plain
grey hint fails exactly the test that says so.

## Why `17-shape-styling` exists

It checks the stylesheet from the test suite, which is unusual, and it is worth
saying why. `SHAPE` is what the graph measures — snap-to-connect compares shape
edges, `nodeBox` feeds `zoomToFit`, `shapeEntry`/`shapeExit` place arrowheads —
while the stylesheet is what is actually drawn. Nothing made the two agree, and
nothing goes loudly wrong when they disagree: arrows land slightly off, Fit
leaves a margin nobody asked for.

AggregateRows shipped with no width rule at all while the model said 112x72, and
with its class missing from the Summarise colour rule, so it rendered violet
among the teal ones. Both were found by a person looking at the screen, which is
the most expensive way to find them. Remove `.shape-aggrows` from either rule and
this suite says so.

## Conventions

**Cross-check, never self-check.** Filter and aggregation results are compared
against the same question asked directly of `STUDENTS`, so a wrong answer cannot
pass by agreeing with itself.

**Use `assert.close` for floats.** Averages and shares should never be compared
with `===`; the tolerance makes the intent explicit rather than relying on
`toFixed()` rounding to hide the problem.

**One application instance per test file.** State is module-global inside the
IIFE, so a shared instance would let one test's leftover nodes change another's
result.

**Assert on exported tables, not rendered rows,** when checking counts. The
display truncates long results, so counting `<tr>` measures the row limit rather
than the data.

## Adding a test

```js
const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {
  describe('a group name', () => {
    test('what should be true', () => {
      const h = boot();
      const [source, filter, output] = h.build('source', 'filter', 'output');
      h.set(output.id, 'show', 'count');
      h.w.runQuery();
      assert.equal(Number(h.bigNum()), h.app.STUDENTS.length);
    });
  });
};
```

Helpers returned by `boot()`:

| Helper | Purpose |
|---|---|
| `w`, `doc` | jsdom window and document |
| `app` | application internals (`nodes`, `STUDENTS`, `evaluateGraph`, ...) |
| `add(type)` | create one node, unwired — for graphs that fork |
| `build(...types)` | create nodes and wire them in sequence |
| `set(nodeId, key, value)` | drive a config control and fire its event |
| `control(nodeId, key)` | the control element itself |
| `optionsOf(nodeId, key)` | option values of a `<select>` |
| `entry(nodeId)` | that Output's export payload after a run |
| `q`, `qa`, `text`, `panel`, `bigNum` | DOM queries |
| `saved`, `copied` | captured downloads and clipboard writes |
