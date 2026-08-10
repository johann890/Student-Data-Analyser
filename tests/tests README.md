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

Rather than adding exports to production code, the harness injects one line onto
an **in-memory copy** just before the closing `})();`, publishing the internals
as `window.__app`. The shipped file is never modified.

If that injection point ever moves, the harness throws instead of carrying on.
That check matters: without it, a failed injection would leave the tests quietly
exercising something other than the real code.

Tests drive the interface the way a user does — set a control's value, dispatch
the event the app listens for — instead of calling internal setters. A test that
bypassed the DOM would not notice a control rendered with the wrong `data-key`,
which is exactly the kind of bug worth catching.

## The suites

| Suite | Covers |
|---|---|
| `01-dataset` | Generated data invariants: eight courses each, `gradeAvg` equals the mean of the marks, letter grades agree with numbers, catalogue fully exercised, generation is deterministic |
| `02-table-model` | The `{columns, rows, meta}` primitive: access by key, the unfold to enrolments, per-course aggregation, type-driven cell formatting |
| `03-filter` | Every field type and operator, cross-checked against the raw dataset; multi-criterion AND; both granularities; orphaned criteria |
| `04-schema` | Schema propagation, and that Filter and Output panels follow the incoming table rather than assuming student records |
| `05-output` | Every output is a table; count is 1×1; course-breakdown scope; show-type normalisation; multiple outputs |
| `06-export` | CSV quoting and escaping, field-count integrity, long-format enrolments, filenames, the staleness guard |
| `07-saveload` | Round trip, rejection of non-query files, repair of salvageable ones, forward compatibility |
| `08-graph` | Wiring rules, topological order, cycle detection, merging, guard rails |
| `09-ui-state` | Config lives in the model; dragging does not rebuild the DOM; typing does not destroy the field; escaping |

Compare is exercised only incidentally — it is superseded by the planned
SelectFor node and is not the subject of dedicated tests.

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
| `build(...types)` | create nodes and wire them in sequence |
| `set(nodeId, key, value)` | drive a config control and fire its event |
| `control(nodeId, key)` | the control element itself |
| `optionsOf(nodeId, key)` | option values of a `<select>` |
| `entry(nodeId)` | that Output's export payload after a run |
| `q`, `qa`, `text`, `panel`, `bigNum` | DOM queries |
| `saved`, `copied` | captured downloads and clipboard writes |
