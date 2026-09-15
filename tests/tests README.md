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

## Where it looks for the application

By default the harness searches sibling folders for one containing `app.js` and
an `.html` file — `../MMP`, `../mmp`, `../MVP`, `../mvp`, then `..`. To point it
somewhere else:

```bash
APP_DIR=../some/other/folder npm test
```

If nothing is found it fails with a message rather than testing nothing.

## How the harness reaches inside the application

`app.js` is a single IIFE with no module system. That is deliberate — the tool
has to run from a `file://` URL with no build step — but it means nothing inside
is reachable from a test.

`app.js` solves this itself. Setting `window.__QB_TEST__ = true` **before** it
loads makes it publish its internals on `window.__qb`. In normal use the flag is
undefined, nothing is exported, and the cost is one branch at start-up.

```js
w.__QB_TEST__ = true;
w.eval(fs.readFileSync(APP_JS, 'utf8'));   // the shipped file, verbatim
```

### Why not source injection

This harness used to rewrite the source instead, splicing an export block in
before the closing `})();`. `app.js` warns against exactly that, and was right:

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
the bottom of `app.js` rather than reaching around it. The block is grouped by
subject; put the new entry with its neighbours.

Live state (`nodes`, `connections`, `exportData`, `selection`, `view`) is
exported as *functions*, because those bindings are reassigned wholesale by
`clearAll()` and `applyGraph()` and a captured value would go stale. The harness
bridges them back to getters so tests can write `app.nodes`, in one place —
`shim()` in `lib/harness.js`.

## The suites

| Suite | Covers |
|---|---|
| `01-dataset` | Generated data invariants: eight courses each, `gradeAvg` equals the mean of the marks, letter grades agree with numbers, catalogue fully exercised, generation is deterministic |
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

If any of these is ever rewritten, re-check it the same way.

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
