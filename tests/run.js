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
const { disposeWindows } = require('./lib/harness');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const filters = args.filter(a => !a.startsWith('-'));

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
      try {
        await t.fn();
        passed++;
        if (verbose) console.log('    ' + C.green + '\u2713' + C.off + ' ' + C.dim + t.name + C.off);
      } catch (err) {
        failed++;
        failures.push({ suite: label, group: t.group, name: t.name, err });
        console.log('    ' + C.red + '\u2717 ' + t.name + C.off);
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
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error('\n' + C.red + 'The runner itself failed: ' + (err && err.stack || err) + C.off);
  process.exit(1);
});
