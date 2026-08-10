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

function main() {
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
        t.fn();
        passed++;
        if (verbose) console.log('    ' + C.green + '\u2713' + C.off + ' ' + C.dim + t.name + C.off);
      } catch (err) {
        failed++;
        failures.push({ suite: label, group: t.group, name: t.name, err });
        console.log('    ' + C.red + '\u2717 ' + t.name + C.off);
      }
    }
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

main();
