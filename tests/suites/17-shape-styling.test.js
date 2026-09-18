/* Shapes: the model's geometry against the stylesheet's.

   SHAPE is what the graph measures — snap-to-connect compares shape edges,
   nodeBox feeds zoomToFit, and shapeEntry/shapeExit place the arrowheads. The
   stylesheet is what is actually on screen. Nothing checks that the two agree,
   and nothing goes visibly wrong when they do not: arrows land slightly off a
   box that is a different size than the model believes, and Fit leaves a margin
   nobody asked for. AggregateRows shipped with no width rule at all and the
   model saying 112x72, and it took a person looking at it to notice.

   The colour check is here for the same reason. A processing node is read by
   its family colour, and a node left out of its family's rule silently keeps
   whatever the base rule gave it — which is how AggregateRows came out violet
   among the teal ones. */

const fs = require('fs');
const path = require('path');
const { boot, APP_DIR } = require('../lib/harness');
const { assert } = require('../lib/assert');

const CSS = (() => {
  const f = fs.readdirSync(APP_DIR).filter(x => x.endsWith('.css'))[0];
  return fs.readFileSync(path.join(APP_DIR, f), 'utf8');
})();

/* The class each node type renders. Written out rather than derived, because
   deriving it from shapeHTML would make the test agree with the code by
   construction and check nothing. */
const CLASS = {
  source: 'shape-source', filter: 'shape-filter', compare: 'shape-compare',
  sort: 'shape-sort', reverse: 'shape-reverse', take: 'shape-take',
  unique: 'shape-unique', select: 'shape-select', project: 'shape-project',
  aggregate: 'shape-aggregate', aggregateColumns: 'shape-aggcols',
  aggregateRows: 'shape-aggrows', combine: 'shape-combine',
  selectFor: 'shape-selectfor', output: 'shape-output'
};

/* The family each node belongs to, and the colour that family is drawn in.
   These are the values in the stylesheet's own group headings. */
const FAMILY = {
  reshape:   { colour: '#5a3a7a', types: ['sort', 'reverse', 'take', 'unique', 'select'] },
  /* Project has a family to itself. That is deliberate rather than an oversight
     waiting to be tidied: it is the only node that changes what a row means, and
     its colour and its own menu group are two of the ways it says so. */
  expand:    { colour: '#4a6a1e', types: ['project'] },
  summarise: { colour: '#1f6a6a', types: ['aggregate', 'aggregateColumns', 'aggregateRows'] },
  /* SelectFor joins Branches rather than Summarise, though it does summarise.
     The family is read off the canvas as "this node takes more than one wire",
     and it is the only node with two different ports — putting it in teal
     would say it behaves like Aggregate, which takes one table and cannot be
     fed a label set at all. */
  branches:  { colour: '#7a2f52', types: ['combine', 'compare', 'selectFor'] }
};

function declaredSize(cls) {
  const m = CSS.match(new RegExp('\\.' + cls + '[^{]*\\{[^}]*?width:\\s*(\\d+)px;\\s*height:\\s*(\\d+)px', 's'));
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

module.exports = ({ describe, test }) => {

  const A = boot().app;
  const TYPES = Object.keys(A.SHAPE);

  describe('every node type is accounted for', () => {
    test('SHAPE covers every type in the registry', () => {
      Object.keys(A.NODE_SPEC).forEach(t =>
        assert.ok(A.SHAPE[t], t + ' has no entry in SHAPE'));
    });

    test('this test knows the class of every type', () => {
      // Otherwise a new node could be added and silently skip every check below
      TYPES.forEach(t => assert.ok(CLASS[t], t + ' is missing from this suite\'s CLASS map'));
    });

    test('every type renders the class this suite expects', () => {
      TYPES.forEach(t => {
        const h = boot();
        h.w.addNode(t);
        assert.ok(h.q('.' + CLASS[t]), t + ' did not render .' + CLASS[t]);
      });
    });
  });

  describe('the model and the stylesheet agree about size', () => {
    TYPES.forEach(t => {
      test(t + ' is the size the graph thinks it is', () => {
        const want = A.SHAPE[t];
        const got = declaredSize(CLASS[t]);
        assert.ok(got, CLASS[t] + ' declares no width/height — the box will collapse to its content');
        assert.equal(got.w, want.w, t + ' width');
        assert.equal(got.h, want.h, t + ' height');
      });
    });
  });

  describe('processing nodes wear their family colour', () => {
    Object.keys(FAMILY).forEach(fam => {
      const { colour, types } = FAMILY[fam];
      test(fam + ' nodes are all ' + colour, () => {
        /* Every rule that sets this colour, not the first one — the toolbar
           buttons use the family colours too, and matching the first hit found
           .add-btn.processing rather than the shapes. A member is styled if ANY
           such rule names its class; one left out of all of them keeps whatever
           the base rule gave it and reads as a member of another family. */
        const rules = [];
        const re = new RegExp('([^{}]*)\\{([^}]*)\\}', 'g');
        let m;
        while ((m = re.exec(CSS))) {
          if (new RegExp('border-color:\\s*' + colour, 'i').test(m[2]) && m[1].indexOf('.shape-') !== -1) {
            rules.push(m[1]);
          }
        }
        assert.ok(rules.length, 'no shape rule sets ' + colour);
        const named = rules.join(' ');
        types.forEach(t =>
          assert.includes(named, '.' + CLASS[t],
            CLASS[t] + ' is in no rule setting ' + colour + ', so it keeps the base colour'));
      });
    });

    test('the family colour is the one that actually wins', () => {
      /* The check above asks whether a class is NAMED in a rule setting its
         family colour. That is not the same question as what gets drawn, and
         SelectFor shipped for an afternoon proving it: its own block, appended
         to the end of the stylesheet, carried a `border:` shorthand in the
         violet of the block it was copied from, and won on source order over
         the Branches rule above it. The node rendered violet among the rose
         ones with this suite green — the AggregateRows bug exactly, wearing
         the one disguise the suite had no eye for.

         So: walk every rule that sets a border colour on a shape class and
         keep the LAST one for each. These selectors are all single classes of
         equal specificity, so source order is the whole cascade here. */
      const winner = {};
      const re = /([^{}]*)\{([^}]*)\}/g;
      let m;
      while ((m = re.exec(CSS))) {
        const decl = /border(?:-color)?:[^;]*?(#[0-9a-f]{3,8})/i.exec(m[2]);
        if (!decl) continue;
        m[1].split(',').forEach(sel => {
          const cls = /\.(shape-[a-z]+)\s*$/i.exec(sel.trim());
          if (cls) winner[cls[1]] = decl[1].toLowerCase();
        });
      }
      Object.keys(FAMILY).forEach(fam => {
        FAMILY[fam].types.forEach(t => {
          assert.equal(winner[CLASS[t]], FAMILY[fam].colour,
            CLASS[t] + ' is drawn ' + winner[CLASS[t]] + ', not the ' + fam +
            ' colour ' + FAMILY[fam].colour + ' — a later rule is overriding it');
        });
      });
    });

    test('no node belongs to two families', () => {
      const seen = {};
      Object.keys(FAMILY).forEach(fam => FAMILY[fam].types.forEach(t => {
        assert.notOk(seen[t], t + ' is in both ' + seen[t] + ' and ' + fam);
        seen[t] = fam;
      }));
    });

    test('every processing node is in exactly one family', () => {
      const inFamily = [].concat(...Object.keys(FAMILY).map(f => FAMILY[f].types));
      const processing = TYPES.filter(t => ['source', 'filter', 'output'].indexOf(t) === -1);
      assert.deepEqual(processing.slice().sort(), inFamily.slice().sort(),
        'a processing node with no family will not read as anything');
    });
  });

  describe('the menu offers what the registry holds', () => {
    test('every processing node has a menu entry', () => {
      const h = boot();
      const offered = h.qa('.proc-item')
        .map(b => (b.getAttribute('onclick').match(/addProcNode\('([^']+)'\)/) || [])[1]);
      const processing = TYPES.filter(t => ['source', 'filter', 'output'].indexOf(t) === -1);
      processing.forEach(t => assert.includes(offered, t, t + ' cannot be added from the menu'));
    });

    test('every menu entry names a type that exists', () => {
      const h = boot();
      h.qa('.proc-item').forEach(b => {
        const t = (b.getAttribute('onclick').match(/addProcNode\('([^']+)'\)/) || [])[1];
        assert.ok(A.NODE_SPEC[t], 'the menu offers "' + t + '", which the registry does not have');
      });
    });

    test('a node is offered exactly once, not once per menu', () => {
      // Two menus means two places to list a node, and a node listed in both
      // would give the same type two different homes.
      const h = boot();
      const offered = h.qa('.proc-item')
        .map(b => (b.getAttribute('onclick').match(/addProcNode\('([^']+)'\)/) || [])[1]);
      offered.forEach(t => assert.equal(
        offered.filter(x => x === t).length, 1, t + ' is listed more than once'));
    });

    test('each menu entry carries its family class', () => {
      const CAT = { reshape: 'cat-reshape', expand: 'cat-expand',
                    summarise: 'cat-summarise', branches: 'cat-branches' };
      const h = boot();
      h.qa('.proc-item').forEach(b => {
        const t = (b.getAttribute('onclick').match(/addProcNode\('([^']+)'\)/) || [])[1];
        const fam = Object.keys(FAMILY).filter(f => FAMILY[f].types.indexOf(t) !== -1)[0];
        assert.ok(fam, t + ' has no family');
        assert.includes(b.className, CAT[fam], t + ' is listed under the wrong group');
      });
    });
  });

  /* THE SPLIT
     Reshape is its own button because it is its own colour. The whole point of
     the split is that a coloured button can promise the colour behind it, so
     these check the promise rather than the markup: which types are in which
     menu is derived from FAMILY, so moving a node between families moves the
     expectation with it. */
  describe('the two menus', () => {
    const menuOf = b => b.closest('.proc-menu').id;
    const typeOf = b => (b.getAttribute('onclick').match(/addProcNode\('([^']+)'\)/) || [])[1];

    test('there are exactly two, and both are dropdowns of the same kind', () => {
      const h = boot();
      const ids = h.qa('.proc-menu').map(m => m.id).sort();
      assert.deepEqual(ids, ['procMenu', 'reshapeMenu']);
    });

    test('Reshape holds every violet node and nothing else', () => {
      const h = boot();
      const inReshape = h.qa('.proc-item').filter(b => menuOf(b) === 'reshapeMenu').map(typeOf);
      assert.deepEqual(inReshape.slice().sort(), FAMILY.reshape.types.slice().sort(),
        'the violet button must open a menu of exactly the violet nodes');
    });

    test('Processing holds everything that is not violet', () => {
      const h = boot();
      const rest = [].concat(...Object.keys(FAMILY)
        .filter(f => f !== 'reshape').map(f => FAMILY[f].types));
      const inProc = h.qa('.proc-item').filter(b => menuOf(b) === 'procMenu').map(typeOf);
      assert.deepEqual(inProc.slice().sort(), rest.slice().sort());
    });

    test('the Reshape button wears the family colour, and Processing does not', () => {
      // Grey is the honest answer for a menu holding three families; claiming
      // one of their colours would promise a menu of that colour.
      const h = boot();
      const reshape = h.qa('.add-btn').find(b => b.className.indexOf('reshape') !== -1);
      const proc    = h.qa('.add-btn').find(b => b.className.indexOf('processing') !== -1);
      assert.ok(reshape, 'no Reshape button'); assert.ok(proc, 'no Processing button');

      const rule = /\.add-btn\.reshape\s*\{([^}]*)\}/.exec(CSS);
      assert.ok(rule, 'the Reshape button has no colour rule of its own');
      assert.includes(rule[1].toLowerCase(), FAMILY.reshape.colour,
        'the button must carry the same border colour as the nodes behind it');

      const procRule = /\.add-btn\.processing\s*\{([^}]*)\}\s*\n\.add-btn\.processing:hover/.exec(CSS);
      assert.ok(procRule, 'no Processing colour rule');
      Object.keys(FAMILY).forEach(f => assert.excludes(
        procRule[1].toLowerCase(), FAMILY[f].colour,
        'Processing must not claim the ' + f + ' colour'));
    });

    test('the Reshape menu carries no group heading', () => {
      // The button already says Reshape. A heading repeating it would read as
      // the first of several groups, which is the thing the split removed.
      const h = boot();
      const headings = h.qa('#reshapeMenu .proc-group');
      assert.equal(headings.length, 0);
      assert.ok(h.qa('#procMenu .proc-group').length >= 3,
        'Processing still needs its headings — it holds three families');
    });

    test('opening one menu closes the other', () => {
      const h = boot();
      h.w.toggleProcMenu(null, 'reshapeMenu');
      assert.includes(h.doc.getElementById('reshapeMenu').className, 'open');

      h.w.toggleProcMenu(null, 'procMenu');
      assert.includes(h.doc.getElementById('procMenu').className, 'open');
      assert.excludes(h.doc.getElementById('reshapeMenu').className, 'open',
        'two open dropdowns overlap, and the second reads as a submenu of the first');
    });

    test('adding from either menu closes both', () => {
      const h = boot();
      h.w.toggleProcMenu(null, 'reshapeMenu');
      h.w.addProcNode('sort');
      h.qa('.proc-menu').forEach(m => assert.excludes(m.className, 'open'));
      assert.ok(h.app.nodes.some(n => n.type === 'sort'), 'the node was still added');
    });
  });
};
