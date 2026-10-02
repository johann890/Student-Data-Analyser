#!/usr/bin/env node
/* Test runner.
   Discovers every *.test.js in suites/, runs it, and reports. Exits non-zero on
   any failure so it can gate a commit or a CI step.

   Usage:
     node run.js                 run everything
     node run.js filter output   run only suites whose name matches
     node run.js --verbose       list every passing test, not just failures  */

const fs = require('fs');
const path = require('path');
const { AssertionError, fmt } = require('./lib/assert');
const { disposeWindows, takeWindowErrors } = require('./lib/harness');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const filters = args.filter(a => !a.startsWith('-'));

/* A CEILING ON ONE TEST
   Without this a test that never settles ends the run, and not by hanging: an
   await on a promise nothing resolves leaves an empty event loop, so node
   exits, with code 0, no summary line, and every later suite unrun. A green
   CI step for a suite that mostly did not happen is the worst failure this
   runner can have, so every test is raced against a clock.

   Thirty seconds is far above the slowest real test (the archive suites take
   about two) and far below a wait anybody would sit through. TEST_TIMEOUT
   overrides it for a deliberately slow run; 0 turns the race off. */
const TIMEOUT_MS = process.env.TEST_TIMEOUT === undefined
  ? 30000 : Number(process.env.TEST_TIMEOUT);

function withTimeout(fn, label) {
  const out = fn();
  // A synchronous test is already finished; there is nothing to race.
  if (!out || typeof out.then !== 'function' || !(TIMEOUT_MS > 0)) return out;
  let timer;
  return Promise.race([
    Promise.resolve(out).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(function () {
        reject(new Error('timed out after ' + TIMEOUT_MS + 'ms: ' + label +
          '. Something it awaited never settled.'));
      }, TIMEOUT_MS);
      /* Deliberately NOT unref'd. An unref'd clock does not hold the event
         loop open, so a test awaiting something that never settles leaves
         nothing pending and node exits before the timeout can fire, which is
         the exact failure this exists to prevent. The timer is cleared the
         moment the test settles, so a run that finishes is never held up by
         one. */
    })
  ]);
}

/* ERRORS THAT ARRIVE FROM OUTSIDE THE TEST
   A rejected promise nobody awaited, or a throw from a timer callback, reaches
   node rather than the try/catch around the test. Node's default is to print a
   raw stack and kill the process: the run dies naming no test, with no summary,
   and whether it happens at all depends on when the microtask queue is drained,
   so the same mistake can pass one day and end the run the next.

   Caught here and attributed to whichever test was running, which turns both
   into an ordinary failure on an ordinary line. */
const strayErrors = [];

/* Failed until proven otherwise. Every exit from here on sets this explicitly,
   so an exit nobody planned (node running out of work while a test is still
   outstanding, say) reports failure rather than success. A run that ends green
   without printing a summary is the one outcome a CI step cannot catch. */
process.exitCode = 1;

function noteStray(kind, err) {
  strayErrors.push({ kind: kind, err: err instanceof Error ? err : new Error(String(err)) });
}
process.on('unhandledRejection', (reason) => noteStray('unhandled rejection', reason));
process.on('uncaughtException',  (err)    => noteStray('uncaught exception', err));

const SUITES_DIR = path.join(__dirname, 'suites');
const C = process.stdout.isTTY
  ? { red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', dim:'\x1b[2m', bold:'\x1b[1m', off:'\x1b[0m' }
  : { red:'', green:'', yellow:'', dim:'', bold:'', off:'' };

function collect(file) {
  const tests = [];
  let currentGroup = '';
  const api = {
    describe(name, fn) { const prev = currentGroup; currentGroup = name; fn(); currentGroup = prev; },
    test(name, fn) { tests.push({ group: currentGroup, name, fn }); },
    it(name, fn) { tests.push({ group: currentGroup, name, fn }); }
  };
  require(file)(api);
  return tests;
}

/* Tests may be async, and one class of them has to be: the data loader goes
   through a real FileReader, and a FileReader is asynchronous by construction.
   Stubbing it out would have left the very path this suite exists to check
   (pick a file, read it, refuse or accept it) untested in favour of a
   synchronous imitation of it.

   Synchronous tests are unaffected: a function that returns undefined is
   awaited once and carries on, which costs a microtask and no behaviour. */
async function main() {
  if (!fs.existsSync(SUITES_DIR)) {
    console.error('No suites/ folder found next to run.js');
    process.exit(1);
  }

  let files = fs.readdirSync(SUITES_DIR).filter(f => f.endsWith('.test.js')).sort();
  if (filters.length) {
    files = files.filter(f => filters.some(k => f.toLowerCase().includes(k.toLowerCase())));
  }
  if (!files.length) {
    console.error('No matching test files.');
    process.exit(1);
  }

  const started = Date.now();
  let passed = 0, failed = 0;
  const failures = [];

  for (const file of files) {
    const label = file.replace(/\.test\.js$/, '');
    let tests;
    try {
      tests = collect(path.join(SUITES_DIR, file));
    } catch (e) {
      console.log('\n' + C.bold + label + C.off);
      console.log('  ' + C.red + 'could not load suite: ' + e.message + C.off);
      failed++;
      failures.push({ suite: label, name: '(loading)', err: e });
      continue;
    }

    console.log('\n' + C.bold + label + C.off + C.dim + '  (' + tests.length + ')' + C.off);
    let lastGroup = null;

    for (const t of tests) {
      if (t.group && t.group !== lastGroup) {
        console.log('  ' + C.dim + t.group + C.off);
        lastGroup = t.group;
      }
      // Anything left over from the test before belongs to the test before.
      strayErrors.length = 0;
      takeWindowErrors();

      let err = null;
      try {
        await withTimeout(t.fn, label + ' \u203a ' + t.name);
      } catch (e) {
        err = e;
      }

      /* A rejection is only known to be unhandled once the microtask queue has
         drained, so a test that creates one on its last line would otherwise be
         credited with a pass and the error land on whichever test came next. */
      await new Promise(r => setImmediate(r));

      /* A throw inside a DOM event handler does not propagate out of
         dispatchEvent: jsdom reports it to the virtual console and the handler
         simply ends. This suite drives the application through dispatched
         events, so without this a regression that throws in onConfigInput would
         print a stack and still be counted as a pass. */
      if (!err) {
        const inWindow = takeWindowErrors();
        if (inWindow.length) {
          err = inWindow[0];
          err.message = 'uncaught in the page: ' + err.message;
        }
      }
      if (!err && strayErrors.length) {
        err = strayErrors[0].err;
        err.message = strayErrors[0].kind + ': ' + err.message;
      }

      if (err) {
        failed++;
        failures.push({ suite: label, group: t.group, name: t.name, err });
        console.log('    ' + C.red + '\u2717 ' + t.name + C.off);
      } else {
        passed++;
        if (verbose) console.log('    ' + C.green + '\u2713' + C.off + ' ' + C.dim + t.name + C.off);
      }
    }

    /* Put down every window the suite booted. See disposeWindows(): each one
       holds a live animation-frame timer, so without this the run keeps every
       window it has ever made and eventually dies of heap exhaustion rather
       than of a failing assertion. Between suites, never within one, because a
       suite may boot at module scope and use that window throughout. */
    disposeWindows();

    /* And then ask for the memory back, rather than waiting to be forced.

       Closing a window makes it collectable; it does not collect it. V8 has no
       reason to run a full collection until it is near its limit, so the run
       would climb to within a few megabytes of the 4GB ceiling and only then
       reclaim, in one emergency mark-compact, everything twenty suites had
       finished with. It survived that way, but with no headroom at all: a
       measured profile had it reaching 4051MB of a ~4090MB limit before the
       collection that saved it. At that margin whether the run completes stops
       being a property of the tests and becomes a matter of GC timing, and any
       change anywhere that shifts an allocation by a percent can turn a green
       suite into "Ineffective mark-compacts near heap limit" — a failure that
       names nothing and points at nobody.

       One collection between suites costs a fraction of a second and holds the
       run near its true working set instead. Guarded because --expose-gc is
       what provides it: without the flag this is a no-op and the run behaves
       exactly as it did before, which is why the flag is in the test script
       rather than being something anyone has to remember.

       This is half the answer. The other half is in package.json, and the
       reason both are needed is that not all of what a suite leaves behind is
       garbage. Evaluating the application into a JSDOM window leaves about
       8MB per window that closing the window does not release: V8 holds a
       context's compiled code, and jsdom has no way to dispose a context. Two
       bare windows measured against two carrying the application differ by
       exactly that, with no harness code involved either way. So a collection
       reclaims what is reclaimable, and the raised ceiling covers what is not.
       Fixing it properly means booting fewer windows, or running suites in
       separate processes; neither belongs in a change to the results panel. */
    if (typeof global.gc === 'function') global.gc();
  }

  if (failures.length) {
    console.log('\n' + C.bold + C.red + 'Failures' + C.off);
    failures.forEach((f, i) => {
      console.log('\n' + C.red + (i + 1) + ') ' + f.suite +
        (f.group ? ' \u203a ' + f.group : '') + ' \u203a ' + f.name + C.off);
      console.log('   ' + f.err.message);
      if (f.err instanceof AssertionError && f.err.hasValues) {
        console.log('   ' + C.dim + 'expected:' + C.off + ' ' + fmt(f.err.expected));
        console.log('   ' + C.dim + 'actual:  ' + C.off + ' ' + fmt(f.err.actual));
      }
      if (!(f.err instanceof AssertionError)) {
        const stack = (f.err.stack || '').split('\n').slice(1, 4).join('\n');
        if (stack) console.log(C.dim + stack + C.off);
      }
    });
  }

  const secs = ((Date.now() - started) / 1000).toFixed(2);
  console.log('\n' + '\u2500'.repeat(46));
  const summary = passed + ' passed' + (failed ? ', ' + failed + ' failed' : '');
  console.log((failed ? C.red : C.green) + C.bold + summary + C.off + C.dim + '   ' + secs + 's' + C.off);
  process.exitCode = failed ? 1 : 0;
}

main().catch(err => {
  console.error('\n' + C.red + 'The runner itself failed: ' + (err && err.stack || err) + C.off);
  process.exit(1);
});
