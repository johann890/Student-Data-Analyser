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

/* Structural equality, used by deepEqual. Object.is at the leaves, so NaN
   matches NaN and +0 does not match -0.

   `seen` records PAIRS already under comparison, not single objects. Keyed on
   the left side alone it would answer "yes" the second time it met an object it
   had seen, whatever it was being compared against this time, so one structure
   referring to the same array twice would match another that did not. Pairs
   also give the cycle guard its real meaning: a structure that refers to itself
   is equal to another that refers to itself in the same shape. */
function sameValue(a, b, seen) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  /* Tag rather than constructor: the suite compares objects made inside a jsdom
     window against ones made in node, where every constructor differs and only
     the tag agrees. */
  const tag = (v) => Object.prototype.toString.call(v);
  if (tag(a) !== tag(b)) return false;
  if (tag(a) === '[object Date]') return Object.is(+a, +b);
  if (tag(a) === '[object RegExp]') return String(a) === String(b);

  let partners = seen.get(a);
  if (partners && partners.has(b)) return true;
  if (!partners) { partners = new Set(); seen.set(a, partners); }
  partners.add(b);

  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i], seen)) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!sameValue(a[k], b[k], seen)) return false;
  }
  return true;
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

  /* Floating-point comparison. Averages and shares should never be compared
     with ===; a tolerance makes the intent explicit rather than relying on
     toFixed() rounding to paper over it.

     NaN is refused before the tolerance is applied, and has to be: every
     comparison against NaN is false, so `Math.abs(NaN - 5) > tol` is false and
     the original form PASSED a NaN silently. That is the one value this
     assertion most needs to catch, since it is what an average over no rows, a
     share with an empty denominator and a failed parse all produce. */
  close(actual, expected, tolerance, message) {
    const tol = tolerance === undefined ? 1e-9 : tolerance;
    const say = (why) => {
      throw new AssertionError(
        (message || 'values differ') + ' (' + why + ')', expected, actual);
    };
    if (typeof actual !== 'number') say('not a number');
    if (Number.isNaN(actual) || Number.isNaN(expected)) say('NaN never satisfies a tolerance');
    // Infinity is comparable to itself and to nothing else.
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
      if (!Object.is(actual, expected)) say('not finite');
      return;
    }
    if (Math.abs(actual - expected) > tol) say('tolerance ' + tol);
  },

  /* A real structural comparison rather than a comparison of two JSON strings.
     JSON.stringify made this assertion sensitive to things that are not part of
     the claim being made: {a:1,b:2} and {b:2,a:1} are the same object and
     differed, an undefined property vanished, NaN became null, and a circular
     structure threw a TypeError that was not an AssertionError and so was
     reported without its expected and actual values. */
  deepEqual(actual, expected, message) {
    if (!sameValue(actual, expected, new Map())) {
      throw new AssertionError(message || 'structures differ', expected, actual);
    }
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

  /* `want` is an optional RegExp the thrown message must match. Without one,
     any throw satisfies this, which is how a misspelled call passes: a
     ReferenceError from a typo in the test looks exactly like the refusal the
     test meant to provoke. Those two are therefore rejected by name unless a
     pattern asks for them, so a broken test reads as broken rather than green.

     A string in the second position is still the failure message, as it always
     was, so existing calls are unaffected. */
  throws(fn, want, message) {
    if (typeof want === 'string') { message = want; want = undefined; }
    let caught = null, threw = false;
    try { fn(); } catch (e) { threw = true; caught = e; }
    if (!threw) {
      throw new AssertionError(message || 'expected the call to throw', 'a throw', 'no throw');
    }
    const text = caught && caught.message ? String(caught.message) : String(caught);
    if (want) {
      if (!want.test(text)) {
        throw new AssertionError(message || 'it threw, but not the expected error',
          'a message matching ' + want, text);
      }
      return caught;
    }
    const name = caught && caught.name;
    if (name === 'ReferenceError' || name === 'SyntaxError') {
      throw new AssertionError(
        (message ? message + '. ' : '') +
        'it threw a ' + name + ', which is almost always a mistake in the test ' +
        'rather than the refusal being asked for. Pass a RegExp as the second ' +
        'argument if this one is genuinely expected.', 'a refusal from the code', text);
    }
    return caught;
  },

  fail(message) { throw new AssertionError(message || 'failed'); }
};

module.exports = { assert, AssertionError, fmt };
