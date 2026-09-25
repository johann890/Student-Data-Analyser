/* Saying why a drop did not wire.

   The complaint: "Say why a node can't connect. Right now a refused connection
   just doesn't happen." The tool shows a ghost arrow for the drop that WILL
   wire, and nothing at all for the drop that will not, so the only gesture with
   no feedback was the one where the user's expectation had just broken.

   Two halves are tested here. connectRefusal() is the sentence, asked for
   directly, which is how the other wiring suites treat resolveDirection(). The
   drop itself is then driven with real pointer events, because the sentence
   being right is worth nothing if the release never asks for it.

   The rule the wording follows: name the node the user aimed at, say what is in
   the way, and say what to do about it. Never claim dragging the nodes apart
   breaks a wire, because it does not: only the x badge on the wire does. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  // Two unwired nodes, placed within snapping distance of each other.
  // A Source's exit sits 160px right of its own x, an entry 60px right of the
  // target's, so 180px apart leaves a gap of 80 against a SNAP_DIST of 160.
  function pair(h, aType, bType) {
    const a = h.add(aType), b = h.add(bType);
    a.x = 300; a.y = 300;
    b.x = 480; b.y = 300;
    h.w.render();
    return [a, b];
  }

  const mouse = (h, type, x, y) =>
    new h.w.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });

  // The real gesture: press on the shape, move past the click threshold, release.
  function dragNudge(h, node) {
    const i = h.app.nodes.indexOf(node);
    const shape = h.qa('#viewport .node')[i].querySelector('.node-shape');
    shape.dispatchEvent(mouse(h, 'mousedown', 100, 100));
    h.doc.dispatchEvent(mouse(h, 'mousemove', 110, 100));
    h.doc.dispatchEvent(mouse(h, 'mouseup', 110, 100));
  }

  describe('the sentence: a Source has no input', () => {
    test('two Sources say what a Source is, not what the rule is', () => {
      const h = boot();
      const [a, b] = pair(h, 'source', 'source');
      const why = h.app.connectRefusal(a, b);
      assert.includes(why, 'Nothing wires into a Source');
      assert.includes(why, 'reads its rows from a file');
    });

    test('and points at what to drag there instead', () => {
      const h = boot();
      const [a, b] = pair(h, 'source', 'source');
      assert.includes(h.app.connectRefusal(a, b), 'Filter or an Output');
    });

    test('a Source beside a Filter is not refused at all', () => {
      const h = boot();
      const [a, b] = pair(h, 'source', 'filter');
      assert.equal(h.app.connectRefusal(a, b), null, 'this drop wires them, so there is nothing to say');
    });
  });

  describe('the sentence: the input is already taken', () => {
    function filterFed() {
      const h = boot();
      const [s1, f] = h.build('source', 'filter');
      const s2 = h.add('source');
      h.w.render();
      return { h, s1, f, s2 };
    }

    test('it names the node aimed at and its arity', () => {
      const { h, f, s2 } = filterFed();
      const why = h.app.connectRefusal(s2, f);
      assert.includes(why, h.app.upstreamLabel(f));
      assert.includes(why, 'already has an input wire');
      assert.includes(why, 'Combine and Compare');
    });

    test('and says how to free it', () => {
      const { h, f, s2 } = filterFed();
      assert.includes(h.app.connectRefusal(s2, f), h.app.CONN_FREE_FIX);
      assert.includes(h.app.CONN_FREE_FIX, 'click the x');
    });

    test('it never claims dragging the nodes apart breaks the wire', () => {
      const { h, f, s2 } = filterFed();
      const why = h.app.connectRefusal(s2, f).toLowerCase();
      assert.excludes(why, 'apart', 'dragging apart does not remove a connection');
    });

    test('a two-input node names both of its ports', () => {
      const h = boot();
      const [s1, sf] = h.build('source', 'selectFor');
      const s2 = h.add('source');
      h.app.connect(s2.id, sf.id, null, 'labels');
      const s3 = h.add('source');
      h.w.render();
      const why = h.app.connectRefusal(s3, sf);
      assert.includes(why, 'Data and Labels');
    });

    test('one port of two still free is not a refusal', () => {
      const h = boot();
      const [s1, sf] = h.build('source', 'selectFor');
      const s2 = h.add('source');
      s2.x = sf.x - 180; s2.y = sf.y;
      h.w.render();
      assert.equal(h.app.connectRefusal(s2, sf), null, 'the Labels port is still open');
    });

    test('Combine takes as many wires as it is given, so it never refuses for fullness', () => {
      const h = boot();
      const [s1, c] = h.build('source', 'combine');
      const s2 = h.add('source');
      s2.x = c.x - 180; s2.y = c.y;
      h.w.render();
      assert.equal(h.app.connectRefusal(s2, c), null);
    });
  });

  describe('what is left unsaid', () => {
    test('an already wired pair says nothing: the wire on screen is the answer', () => {
      const h = boot();
      const [s, f] = h.build('source', 'filter');
      assert.ok(h.app.wireBetween(s, f), 'arranged: they are wired');
      assert.equal(h.app.connectRefusal(s, f), null);
      assert.equal(h.app.connectRefusal(f, s), null, 'in either order');
    });

    test('a node is not refused against itself', () => {
      const h = boot();
      const s = h.add('source');
      assert.equal(h.app.connectRefusal(s, s), null);
    });

    test('a missing node is not refused either', () => {
      const h = boot();
      const s = h.add('source');
      assert.equal(h.app.connectRefusal(s, null), null);
    });
  });

  describe('the drop is what asks for it', () => {
    test('dropping a Source on a Source puts the reason on the canvas', () => {
      const h = boot();
      const [a, b] = pair(h, 'source', 'source');
      assert.equal(h.app.connNoteText(), null, 'nothing is showing to begin with');
      dragNudge(h, a);
      assert.includes(h.app.connNoteText() || '', 'Nothing wires into a Source');
      assert.equal(h.qa('.conn-note').length, 1, 'one note, on the canvas');
    });

    test('the note is announced, not only drawn', () => {
      const h = boot();
      const [a] = pair(h, 'source', 'source');
      dragNudge(h, a);
      assert.equal(h.q('.conn-note').getAttribute('role'), 'status');
    });

    test('a drop that wires says nothing', () => {
      const h = boot();
      const [a, b] = pair(h, 'source', 'output');
      dragNudge(h, a);
      assert.equal(h.app.connections.length, 1, 'arranged: the drop wired them');
      assert.equal(h.app.connNoteText(), null);
    });

    test('a drop far from anything says nothing', () => {
      const h = boot();
      const a = h.add('source'), b = h.add('source');
      a.x = 100; a.y = 100;
      b.x = 1200; b.y = 900;
      h.w.render();
      dragNudge(h, a);
      assert.equal(h.app.connNoteText(), null);
    });

    test('a full input explains itself at the drop', () => {
      const h = boot();
      const [s1, f] = h.build('source', 'filter');
      const s2 = h.add('source');
      f.x = 480; f.y = 300;
      s1.x = 480; s1.y = 900;
      s2.x = 300; s2.y = 300;
      h.w.render();
      dragNudge(h, s2);
      assert.equal(h.app.connections.length, 1, 'no second wire was made');
      assert.includes(h.app.connNoteText() || '', 'already has an input wire');
    });

    test('the one refusal a ghost arrow promised: a duplicate into Combine', () => {
      const h = boot();
      const [s, c] = pair(h, 'source', 'combine');
      h.app.connect(s.id, c.id);
      h.w.render();
      dragNudge(h, s);
      assert.equal(h.app.connections.length, 1, 'the duplicate was refused');
      const why = h.app.connNoteText() || '';
      assert.includes(why, 'already feeds');
      assert.includes(why, 'same rows twice');
    });
  });

  describe('the note does not outlive what it names', () => {
    test('deleting the nodes takes the note with them', () => {
      const h = boot();
      const [a] = pair(h, 'source', 'source');
      dragNudge(h, a);
      assert.ok(h.app.connNoteText(), 'arranged: a note is showing');
      h.app.selectAll();
      h.app.deleteSelection();
      assert.equal(h.app.connNoteText(), null);
    });

    test('the per-node delete button clears it too', () => {
      const h = boot();
      const [a, b] = pair(h, 'source', 'source');
      dragNudge(h, a);
      h.w.removeNode(b.id);
      assert.equal(h.app.connNoteText(), null);
    });

    test('clearing the canvas clears it', () => {
      const h = boot();
      const [a] = pair(h, 'source', 'source');
      dragNudge(h, a);
      h.w.clearAll();
      assert.equal(h.app.connNoteText(), null);
    });

    test('loading a query clears it, since the numbers in it change', () => {
      const h = boot();
      const [a] = pair(h, 'source', 'source');
      dragNudge(h, a);
      const json = JSON.stringify(h.app.serialiseGraph());
      h.app.loadGraphFromText(json, h.doc.createElement('button'));
      assert.equal(h.app.connNoteText(), null);
    });

    test('starting another drag clears the last refusal', () => {
      const h = boot();
      const [a, b] = pair(h, 'source', 'source');
      dragNudge(h, a);
      assert.ok(h.app.connNoteText(), 'arranged');
      b.x = 1400; b.y = 1000;
      h.w.render();
      dragNudge(h, a);
      assert.equal(h.app.connNoteText(), null, 'the new gesture wiped the old note');
    });
  });

  describe('the wording reads as one voice', () => {
    const everyReason = (h) => {
      const [x, y] = pair(h, 'source', 'source');
      const [s1, f] = h.build('source', 'filter');
      const s3 = h.add('source');
      return [h.app.connectRefusal(x, y), h.app.connectRefusal(s3, f)];
    };

    test('no em dashes, like the rest of the interface', () => {
      const h = boot();
      everyReason(h).forEach(why => assert.excludes(why, '—', why));
    });

    test('every reason is a sentence, not a code', () => {
      const h = boot();
      everyReason(h).forEach(why => {
        assert.ok(why.length > 30, 'too terse to be an explanation: ' + why);
        assert.ok(/\.$/.test(why.trim()), 'not a finished sentence: ' + why);
      });
    });
  });
};
