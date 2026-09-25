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

By default the harness searches sibling folders for one holding an `.html` file
that loads scripts which exist beside it — `../MLP`, `../mlp`, `../MMP`, `../mmp`,
`../MVP`, `../mvp`, then `..`. The order is newest milestone first, so the suite
tests the work in progress rather than the folder it was first written against.
A folder is only accepted if every script its page names is really there, so the
suite cannot pick a folder it would then fail to boot. To point it somewhere else:

```bash
APP_DIR=../MMP npm test
```

Note that the milestones are supersets rather than variants: a suite describing
behaviour added in MLP will fail against MMP, because that behaviour is not
there yet. Running an earlier folder is a deliberate act, not a fallback.

If nothing is found it fails with a message rather than testing nothing.

## How the harness reaches inside the application

The application is a set of classic scripts (`js/data-*.js`, `js/engine-*.js`,
`js/ui-*.js`) sharing one global scope, with no module system. That is deliberate:
the tool has to run from a `file://` URL with no build step, where a module script
is fetched with CORS against an opaque origin and refused outright. The harness
reads the script list out of the page and loads them in that order, which is
load-bearing — `js/ui-boot.js` ends by wiring the inline handlers and painting the
first frame, and needs everything above it parsed. The list is not copied into the
harness: a script added to the page joins the suite by being added to the page.

`js/ui-boot.js` solves the access question itself. Setting `window.__QB_TEST__ = true` **before** it
loads makes it publish the application's internals on `window.__qb`. In normal use the flag is
undefined, nothing is exported, and the cost is one branch at start-up.

```js
w.__QB_TEST__ = true;
APP_PATHS.forEach(p => w.eval(fs.readFileSync(p, 'utf8')));   // the shipped files, verbatim
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

### Storage, which jsdom does not supply

`boot()` installs a `localStorage` on the window before the application loads,
beside the download and clipboard shims and for the same reason: it stands in
for a browser facility jsdom lacks, at the seam a browser would provide it.

jsdom only exposes `localStorage` for an origin it can key one to. The harness
builds the page from a string with no `url`, so the document sits at
`about:blank` and the property is **undefined**. Giving the boot a `file://`
url does not help either — that origin is opaque and jsdom leaves it undefined
too. Only an `http(s)` url produces a real one, and changing the origin of
every suite to serve one of them is the wrong trade.

This matters more than it looks, and it is the reason the shim is here rather
than in whichever suite noticed first:

```js
try { window.localStorage.setItem(K, v); } catch (e) { /* ... */ }
```

is how every storage access in the application is written, correctly — storage genuinely
throws on a `file://` origin with site data blocked, and in a private window.
With no storage object at all those catches swallow a `TypeError`, and the code
*appears* to work. A suite written over that would pass because nothing was
ever stored **or** read. `25-toolbar-size` used to carry its own shim for
exactly this reason; the query library needed the same thing, so it moved.

The shim has the two behaviours an object literal does not:

- it **stores strings**, so `setItem(k, {})` records `"[object Object]"` and a
  caller who forgets to stringify is caught by the defensive parse rather than
  by luck;
- it has a **ceiling**, settable per test, and exceeding it throws the way a
  browser does — name, code and all. Quota is a real limit for a library of
  saved queries rather than a theoretical one.

```js
const h = boot();
h.storage.quota = 400;      // bytes, counted as the spec counts them
h.storage.raw();            // what is actually stored, for assertions
```

`withoutStorage(h)` is the other half: it deletes the property, so a test about
having nowhere to save says so instead of inheriting jsdom's silence.

### Adding to the hook

If a test needs something `__qb` does not expose, add it to the export block at
the bottom of `js/ui-boot.js` rather than reaching around it. The block is grouped by
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
| `23-selectfor` | The SelectFor node: grouping as filtering once per label, the predicates that are not columns, the Labels port and the zero-count group only it can produce, share measured against the input rather than the sum of the groups, the registry invariant across five configurations, and the same claims once more against the real archive |
| `20-source-loading` | The Source from the picker to the answer: the two ordered pickers driven through the real hidden inputs, year files accumulating across picks and coming back off one at a time, all-or-nothing within a pick, one Source per dataset, and that a saved query carries the graph and not one byte of the records |
| `31-library` | The query library: the round trip through browser storage, that an entry is the file format unchanged and loads through the same door a file does, the no-student-records guarantee asserted a second time, every shape hostile storage can take, the refusals that protect a library from being clobbered, quota, two windows sharing one store — and the dialog: that a card's picture is drawn from the graph and carries nothing out of the entry, that names and ids cannot become markup, the two-step questions in front of Open and Delete, the save dialog's two destinations, and export/import — that a merge never replaces, that every imported entry is given a fresh id, and that a merge which will not fit leaves the library exactly as it was |

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

- **`23-selectfor` › the guards for the new node.** Eight of them, each checked
  by reintroducing the bug it names and confirming the suite went red:

  | Break | What fails |
  |---|---|
  | ignore the Labels port — always group by the data | the five Labels tests |
  | `share` divides by the sum of the groups | **only** the overlapping-groups test |
  | drop the duplicate-key suffix loop | the two-identical-measures test |
  | measure `t` instead of the group's rows | three of the measure tests |
  | re-sort the labels branch's own order | the two order tests |
  | drop the data-derived sort | the column-order test |
  | drop `values`/`order` from the label column | the label-column and downstream-Filter tests |
  | put SelectFor's measures back under Compare's `measures` key | ten tests |
  | default a breakdown's Output to a table per group | the default-view test |
  | uncap the per-group cards | the card-cap test |

  The share row is the one worth keeping. A column split sums to 100 whichever
  denominator is used, so the partition test passes with the bug in place and
  only the overlapping case — where a student is in eight course groups at
  once — can tell the two apart. Both tests exist because one of them cannot
  fail.

- **`31-library` › the store's guards.** Five, each checked by writing the bug
  back into `js/ui-library-store.js` and confirming the named test went red:

  | Break | What fails |
  |---|---|
  | drop `libAdd`'s refusal to write over a store it could not read | the unreadable-store test |
  | give the library its own serialiser that keeps `exportData` | "no student data reaches storage" |
  | swallow a failed `setItem` the way the panel-width guard does | both quota tests |
  | cache `libRead()`'s result in a module variable | the two-windows test |
  | let a name clash replace silently instead of returning a conflict | the clash tests |
  | accept any string as an entry id | the hostile-id test |
  | open or delete on the first click instead of asking | the two-step tests |
  | make import replace the library instead of merging into it | the merge test |
  | trust the id that arrives in an imported file | three import tests |
  | point the save field's Enter key at the library | the Enter test |
  | let a clash replace silently from the save dialog | the save-dialog clash test |

  The two-windows row is the one worth keeping, and it is here because the
  first version of that test **could not fail**. A cache written on every
  return path breaks it; a cache written only on the full-parse path does not,
  because a save into an *empty* library never reaches that path, so the cache
  is still null on the second save and the stale write never happens. The test
  now reads the store once before the collision — which is what opening the
  grid does anyway — and catches both shapes. Written the obvious way, it was
  testing a bug it had arranged not to meet.

  The import rows are worth their space because import is the only path here
  that takes a file from outside the machine. Two of them exist because the
  same bug has two shapes: a merge that replaces destroys the user's own work,
  and an id taken from a file reaches a card's inline `onclick`. Minting a
  fresh id for every imported entry closes the second one outright rather than
  by pattern-matching, which is why breaking it fails three tests and not one.

  The Enter row is not about correctness at all — both buttons work either way.
  It is there because repointing a daily keyboard habit at a different
  destination would stop it producing files without anyone noticing, and a
  change nobody notices is the kind that needs a test to hold it still.

  The no-student-records row is duplicated from `07-saveload` on purpose. It is
  a property of `serialiseGraph()`, and the only thing keeping it true of the
  library is that the library reuses it rather than writing a second
  serialiser. A second place to write a query down is a second place for
  records to escape to, and the one nobody would think to check is the one in
  browser storage that never appears as a file.

- **`17-shape-styling` › the library card's palette.** The fifth way a node's
  appearance can disagree with itself, and the first one with no screen to
  catch it: a node coloured wrongly on a card appears only inside a dialog,
  beside other cards that look perfectly plausible. Checked both ways — shipping
  SelectFor violet among the indigo ones (exactly the bug that suite was written
  for, one layer further out) fails the distribution test, and removing a type
  from `LIB_INK` altogether fails the "every node the canvas can draw" test as
  well, because the fallback grey is not a family.

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

## Two nodes, one word, different defaults

An Output's `show` is stored as `rows` or `count` and translated when a node
carrying branch metadata feeds it: `rows` means "show me the data", and behind
a Compare that is the per-branch lists.

SelectFor emits the same metadata and inherited the same translation, which was
right for the two or three branches a Compare has and wrong for the
seventy-eight a breakdown by course produces. A freshly wired Output rendered
**912 KB** of markup in 1.7 seconds to draw seventy-eight tables nobody had
asked for — with the grouping itself taking 11 ms. Every millisecond was in the
view.

So the translation is per producing node now (`BRANCH_NODES` maps a type to its
default) and the number of cards is capped at ten, the way the rows inside each
card have always been capped at fifty. Copy and Save are untouched and still
write every group.

Two tests hold it: the default view for each of the two nodes, and the cap
together with the export that ignores it. Both were checked by putting the old
behaviour back.

**Worth remembering when the next node emits `meta.branches`**: the metadata is
a contract about shape, not about how many. A node that can produce eighty of
something inherits a renderer written for three.

## A colour test that could not see the bug it was written for

`17-shape-styling` exists because AggregateRows shipped violet among the teal
ones. SelectFor then shipped violet among the rose ones, **with this suite
green**, which is worth recording because the reason is not carelessness.

The colour check asked whether a class is *named in* a rule that sets its
family colour. SelectFor was — the Branches rule lists it. But its own block is
appended to the end of the stylesheet, and it carried a `border:` shorthand in
the violet of the block it had been copied from. Same specificity, later in the
file, so the shorthand won and the Branches rule never applied. The suite was
asking about the stylesheet's contents; the screen is decided by its cascade.

`the family colour is the one that actually wins` now asks the second question:
walk every rule setting a border colour on a `.shape-` class, keep the last one
for each, and compare that against the family. These selectors are all single
classes of equal specificity, so source order is the whole cascade and the last
one is genuinely what is drawn.

It was checked by putting the violet shorthand back, and it names the node, the
colour it is drawn in and the colour it should be.

**The general lesson, since this is twice now**: a node's appearance is checked
by four separate things — `SHAPE`, the size rule, the family rule and the menu
group — and each new node is an opportunity for one of them to disagree
silently. If a fifth way to get it wrong turns up, it belongs in this suite
rather than in a comment.

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
