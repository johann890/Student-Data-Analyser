/* Minimal assertion library.
   Deliberately dependency-free: the only thing this test suite installs is
   jsdom, so the checks themselves stay readable and auditable. Every assertion
   throws an AssertionError carrying the expected and actual values, which the
   runner formats. */

class AssertionError extends Error {
  constructor(message, expected, actual) {
    super(message);
    this.name = 'AssertionError';
    this.expected = expected;
    this.actual = actual;
    this.hasValues = arguments.length > 1;
  }
}

function fmt(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

const assert = {
  ok(value, message) {
    if (!value) throw new AssertionError(message || 'expected a truthy value', true, value);
  },

  notOk(value, message) {
    if (value) throw new AssertionError(message || 'expected a falsy value', false, value);
  },

  equal(actual, expected, message) {
    if (actual !== expected) {
      throw new AssertionError(message || 'values differ', expected, actual);
    }
  },

  // Floating-point comparison. Averages and shares should never be compared
  // with ===; a tolerance makes the intent explicit rather than relying on
  // toFixed() rounding to paper over it.
  close(actual, expected, tolerance, message) {
    const tol = tolerance === undefined ? 1e-9 : tolerance;
    if (typeof actual !== 'number' || Math.abs(actual - expected) > tol) {
      throw new AssertionError(
        (message || 'values differ') + ' (tolerance ' + tol + ')', expected, actual);
    }
  },

  deepEqual(actual, expected, message) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new AssertionError(message || 'structures differ', expected, actual);
  },

  includes(haystack, needle, message) {
    const has = typeof haystack === 'string'
      ? haystack.indexOf(needle) !== -1
      : Array.isArray(haystack) && haystack.indexOf(needle) !== -1;
    if (!has) {
      throw new AssertionError(message || 'value not found', 'to contain ' + fmt(needle), haystack);
    }
  },

  excludes(haystack, needle, message) {
    const has = typeof haystack === 'string'
      ? haystack.indexOf(needle) !== -1
      : Array.isArray(haystack) && haystack.indexOf(needle) !== -1;
    if (has) {
      throw new AssertionError(message || 'value present but should not be',
        'not to contain ' + fmt(needle), haystack);
    }
  },

  throws(fn, message) {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    if (!threw) throw new AssertionError(message || 'expected the call to throw', 'a throw', 'no throw');
  },

  fail(message) { throw new AssertionError(message || 'failed'); }
};

module.exports = { assert, AssertionError, fmt };
