/* VARIABLES
   ===========================================================================
   A named value declared once and referenced by the nodes that use it, so a
   number appearing in three places is entered once and cannot drift apart.

   The design was settled by the supervisor on 2026-09-24, and four of his
   answers are behaviour rather than opinion, so they are pinned here:

     - the model is "named values referenced as operands", not source nodes
     - nothing is wired to a variable: no edges, no ports, no place in the
       dataflow, and the dock lives outside the scaled world layer
     - the variables are separated from the nodes: they are not on the canvas
       at all, but behind a button in the toolbar
     - "when a query is saved, the variables along with their current values
       should be saved"

   The fifth question he left to us, which is WHICH controls may take one. The
   answer this implements is "anywhere the tool asks for one value", and the
   boundary of that (no lists, no operators, no columns, no files) is asserted
   as deliberately as the inclusions are, because a boundary nobody wrote down
   is a boundary that moves.

   The property that makes the whole feature safe to add is asserted first: a
   query with no variables is byte-for-byte the query it was before they
   existed.                                                                   */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  /* A variable, made the way the dock makes one, then named and valued through
     its own fields rather than by writing the model: a chip that renders with
     the wrong data attribute is exactly the bug worth catching. */
  function declare(h, name, value) {
    const v = h.w.addVariable();
    const nameEl = h.q('[data-var-name="' + v.id + '"]');
    nameEl.value = name;
    nameEl.dispatchEvent(new h.w.Event('input', { bubbles: true }));
    const valEl = h.q('[data-var-value="' + v.id + '"]');
    valEl.value = value;
    valEl.dispatchEvent(new h.w.Event('input', { bubbles: true }));
    return v;
  }

  /* The chip that turns a typed setting into a bound one. Found by the same
     data-node/data-key pair every other control carries, which is also what the
     delegated listener reads: a chip rendered with the wrong key is not found
     here rather than being bound anyway. */
  function chipFor(h, nodeId, key) {
    return h.q('.var-use[data-node="' + nodeId + '"][data-key="' + key + '"]');
  }

  /* Pressed with a real click, which reaches the application through the
     listener on the canvas rather than through an inline handler. jsdom runs
     the page with runScripts:'outside-only', so an inline onclick would never
     fire and this would be testing nothing. */
  function pressChip(h, nodeId, key) {
    const btn = chipFor(h, nodeId, key);
    if (!btn) throw new Error('No $ chip for ' + key + ' on node ' + nodeId);
    btn.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
    return btn;
  }

  /* ══ 1. NOTHING CHANGES UNTIL A VARIABLE EXISTS ═══════════════════════════ */
  describe('a query that uses none is the query it always was', () => {

    test('no chips, no slots, anywhere on the canvas', () => {
      const h = boot();
      h.build('source', 'filter', 'take', 'histogram', 'output');
      assert.equal(h.qa('.var-use').length, 0, 'a chip with nothing to bind is clutter');
      assert.equal(h.qa('.var-slot').length, 0);
    });

    test('the panel markup is identical before and after a variable is added and removed', () => {
      const h = boot();
      const [, f] = h.build('source', 'filter', 'output');
      const before = h.qa('.node-config').map(e => e.innerHTML).join('');

      const v = declare(h, 'threshold', '5');
      assert.ok(h.qa('.var-use').length > 0, 'the chips appear with the variable');

      h.app.removeVariable(v.id);
      assert.equal(h.qa('.node-config').map(e => e.innerHTML).join(''), before,
        'removing the last variable puts every panel back exactly as it was');
      assert.ok(f);
    });

    test('the saved file carries an empty list rather than nothing at all', () => {
      const h = boot();
      h.build('source', 'output');
      const g = h.app.serialiseGraph();
      assert.deepEqual(g.variables, [], 'the key is always present, so a reader never guesses');
    });
  });

  /* ══ 2. THEY ARE NOT NODES ════════════════════════════════════════════════ */
  describe('nothing is wired to a variable', () => {

    test('a variable is not a node and adds none', () => {
      const h = boot();
      declare(h, 'v', '1');
      assert.equal(h.app.nodes.length, 0, 'the canvas is untouched');
      assert.equal(h.app.connections.length, 0);
    });

    test('there is no variable node type to add, and no port to wire one to', () => {
      const h = boot();
      assert.equal(h.app.CONNECT_RULES.variable, undefined);
      assert.equal(h.app.NODE_PORTS.variable, undefined);
      assert.equal(h.app.SHAPE.variable, undefined);
    });

    test('the variables are not on the canvas at all', () => {
      const h = boot();
      const menu = h.doc.getElementById('varDock');
      assert.ok(menu, 'the menu is in the page');
      assert.ok(!h.doc.getElementById('canvas').contains(menu),
        'nothing about the variables competes with the graph for canvas');
      assert.ok(h.doc.getElementById('toolbar').contains(menu),
        'they are declared above the query, not inside it');
    });

    test('it is one of the toolbar dropdowns, so it opens and closes like the others', () => {
      const h = boot();
      const menu = h.doc.getElementById('varDock');
      assert.ok(menu.classList.contains('proc-menu'),
        'sharing the class is what gives it the open, the close and the one-at-a-time');
      assert.ok(!h.app.varMenuOpen(), 'shut until asked for');

      h.w.toggleVarMenu(null);
      assert.ok(h.app.varMenuOpen());
      assert.equal(h.doc.getElementById('varBtn').getAttribute('aria-expanded'), 'true');

      // Opening a node menu closes it, which is the behaviour it inherits.
      h.w.toggleProcMenu(null, 'reshapeMenu');
      assert.ok(!h.app.varMenuOpen(), 'two open dropdowns would overlap');
    });
  });

  /* ══ 3. THE DOCK ══════════════════════════════════════════════════════════ */
  describe('the menu', () => {

    test('opens with an empty state that says what a variable is for', () => {
      const h = boot();
      const body = h.doc.getElementById('varBody');
      assert.ok(body.querySelector('.var-empty'), 'an empty menu explains itself');
      const words = body.textContent.toLowerCase();
      ['filter', 'take', 'histogram'].forEach(w =>
        assert.includes(words, w, 'the empty state names where a variable can go'));
    });

    test('a new variable arrives named and unique, so a chip is usable at once', () => {
      const h = boot();
      const a = h.w.addVariable();
      const b = h.w.addVariable();
      assert.equal(h.app.varName(a), 'v1');
      assert.equal(h.app.varName(b), 'v2');
      assert.ok(!h.app.varNameClashes(a), 'nothing arrives clashing');
    });

    test('the name and the value are stored as typed', () => {
      const h = boot();
      const v = declare(h, 'passGrade', '5');
      assert.equal(h.app.varById(v.id).name, 'passGrade');
      assert.equal(h.app.varById(v.id).value, '5');
    });

    test('a half-typed value survives in the model, as Take N does', () => {
      const h = boot();
      const v = declare(h, 'n', '');
      const el = h.q('[data-var-value="' + v.id + '"]');
      el.value = '1e';
      el.dispatchEvent(new h.w.Event('input', { bubbles: true }));
      assert.equal(h.app.varById(v.id).value, '1e',
        'coercing on write would have to pick a number nobody has finished typing');
    });

    test('typing in a chip does not take the field away', () => {
      const h = boot();
      const v = declare(h, 'a', '1');
      const el = h.q('[data-var-value="' + v.id + '"]');
      el.value = '12';
      el.dispatchEvent(new h.w.Event('input', { bubbles: true }));
      assert.ok(h.q('[data-var-value="' + v.id + '"]') === el,
        'the repaint rebuilds the nodes, never the chip being typed into');
    });

    test('the ceiling is refused on the line, not silently', () => {
      const h = boot();
      for (let i = 0; i < h.app.VAR_MAX; i++) h.w.addVariable();
      assert.equal(h.app.variables.length, h.app.VAR_MAX);
      assert.equal(h.w.addVariable(), null);
      assert.equal(h.app.variables.length, h.app.VAR_MAX, 'and nothing was added');
      assert.includes(h.doc.getElementById('varNotice').textContent, String(h.app.VAR_MAX));
      assert.ok(h.doc.getElementById('varAddBtn').disabled, 'the button says so too');
    });

    test('a name longer than the cap is cut rather than refused', () => {
      const h = boot();
      const v = declare(h, 'x'.repeat(200), '1');
      assert.equal(h.app.varById(v.id).name.length, h.app.VAR_NAME_MAX);
    });

    test('two chips with one name are flagged, not prevented', () => {
      const h = boot();
      declare(h, 'same', '1');
      const b = declare(h, 'same', '2');
      assert.ok(h.app.varNameClashes(b), 'the ids stay distinct, so nothing breaks');
      h.w.render();
      assert.includes(h.q('[data-var-note="' + b.id + '"]').textContent.toLowerCase(),
        'name', 'and the chip says which');
    });

    /* The one thing a shut menu still has to say. Without it a query somebody
       else parameterised looks exactly like one nobody did, and the first sign
       would be an answer that was not the question they thought they asked. */
    test('a shut menu still says the query carries variables', () => {
      const h = boot();
      assert.equal(h.doc.getElementById('varCount').textContent, '',
        'and says nothing at all when it carries none');
      assert.ok(!h.doc.getElementById('varBtn').classList.contains('has-vars'));

      declare(h, 'a', '1');
      declare(h, 'b', '2');
      assert.ok(!h.app.varMenuOpen(), 'still shut');
      assert.equal(h.doc.getElementById('varCount').textContent, '2');
      assert.ok(h.doc.getElementById('varBtn').classList.contains('has-vars'),
        'and the button wears the colour once there is something behind it');
    });

    test('opening it puts the caret where the work is', () => {
      const h = boot();
      h.w.toggleVarMenu(null);
      assert.equal(h.doc.activeElement.id, 'varAddBtn',
        'an empty list has one thing to do with it');
      h.w.toggleVarMenu(null);

      const v = declare(h, 'a', '1');
      h.w.toggleVarMenu(null);
      assert.equal(h.doc.activeElement.getAttribute('data-var-name'), String(v.id));
    });
  });

  /* ══ 4. BINDING AN OPERAND ════════════════════════════════════════════════ */
  describe('binding a filter operand', () => {

    function filtering(field, value) {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', field);
      const v = declare(h, 'wanted', value);
      return { ...h, s, f, o, v };
    }

    test('the chip binds it, and the operand then reads the variable', () => {
      const t = filtering('gpa', '6');
      pressChip(t, t.f.id, 'crit.0.var:gpa');
      const c = t.app.findNode(t.f.id).cfg.criteria[0];
      assert.equal(t.app.boundVar(c, 'gpa').id, t.v.id);
      assert.equal(t.app.critValue(c, 'gpa', null), '6',
        'the one function every call site in the evaluator goes through');
    });

    test('the typed value is shadowed, not destroyed', () => {
      const t = filtering('gpa', '6');
      t.set(t.f.id, 'crit.0.value:gpa', '3');
      pressChip(t, t.f.id, 'crit.0.var:gpa');
      const c = t.app.findNode(t.f.id).cfg.criteria[0];
      assert.equal(c.values.gpa, '3', 'still in the model underneath');
      assert.equal(t.app.critValue(c, 'gpa', null), '6', 'and shadowed while bound');

      t.set(t.f.id, 'crit.0.var:gpa', '');
      assert.equal(t.app.critValue(c, 'gpa', null), '3',
        'unbinding finds what was typed rather than a default');
    });

    test('the bound slot names the variable and prints the value it carries', () => {
      const t = filtering('gpa', '6');
      pressChip(t, t.f.id, 'crit.0.var:gpa');
      const slot = t.q('.var-slot.bound');
      assert.ok(slot, 'the control is replaced rather than joined');
      assert.includes(slot.textContent, 'wanted');
      assert.includes(slot.querySelector('.var-shown').textContent, '6',
        'a name with no number beside it does not say what the node will do');
      assert.ok(!chipFor(t, t.f.id, 'crit.0.var:gpa'),
        'and the chip is gone, since the select now answers the same question');
    });

    test('an empty variable is named as empty, because that is why a run will refuse', () => {
      const t = filtering('gpa', '');
      pressChip(t, t.f.id, 'crit.0.var:gpa');
      assert.includes(t.q('.var-shown').textContent, 'empty');
    });

    test('the select offers every variable, and a way back to typing', () => {
      const t = filtering('gpa', '6');
      declare(t, 'other', '9');
      pressChip(t, t.f.id, 'crit.0.var:gpa');
      const opts = t.qa('.var-pick option').map(o => o.value);
      assert.equal(opts[0], '', 'the first option hands the setting back');
      assert.equal(opts.length, 3, 'then one per variable');
    });

    test('changing the value changes every node that reads it, in one edit', () => {
      const t = filtering('gpa', '6');
      const [f2] = [t.add('filter')];
      t.app.connect(t.s.id, f2.id);
      t.w.render();
      t.set(f2.id, 'crit.0.field', 'gpa');
      pressChip(t, t.f.id, 'crit.0.var:gpa');
      pressChip(t, f2.id, 'crit.0.var:gpa');

      const el = t.q('[data-var-value="' + t.v.id + '"]');
      el.value = '8';
      el.dispatchEvent(new t.w.Event('input', { bubbles: true }));

      [t.f.id, f2.id].forEach(id => {
        const c = t.app.findNode(id).cfg.criteria[0];
        assert.equal(t.app.critValue(c, 'gpa', null), '8', 'node ' + id + ' followed');
      });
    });

    test('it filters on the variable, and the answer moves when the variable does', () => {
      const t = filtering('gpa', '8');
      t.set(t.o.id, 'show', 'count');
      pressChip(t, t.f.id, 'crit.0.var:gpa');
      t.set(t.f.id, 'crit.0.op:gpa', 'gte');
      t.w.runQuery();
      const high = t.app.exportData[t.o.id].table.rows[0][0];

      const el = t.q('[data-var-value="' + t.v.id + '"]');
      el.value = '1';
      el.dispatchEvent(new t.w.Event('input', { bubbles: true }));
      t.w.runQuery();
      const low = t.app.exportData[t.o.id].table.rows[0][0];

      assert.ok(low > high,
        'a lower bar keeps more students: ' + low + ' at 1 against ' + high + ' at 8');
    });

    test('a bound operand marks the results stale when its value changes', () => {
      const t = filtering('gpa', '6');
      pressChip(t, t.f.id, 'crit.0.var:gpa');
      t.w.runQuery();
      assert.ok(t.app.resultsFresh);
      const el = t.q('[data-var-value="' + t.v.id + '"]');
      el.value = '7';
      el.dispatchEvent(new t.w.Event('input', { bubbles: true }));
      assert.ok(!t.app.resultsFresh, 'the answer on screen is no longer the answer');
    });

    test('renaming one changes no answer, so nothing goes stale', () => {
      const t = filtering('gpa', '6');
      pressChip(t, t.f.id, 'crit.0.var:gpa');
      t.w.runQuery();
      const el = t.q('[data-var-name="' + t.v.id + '"]');
      el.value = 'renamed';
      el.dispatchEvent(new t.w.Event('input', { bubbles: true }));
      assert.ok(t.app.resultsFresh, 'a binding names the id, not the name');
      const c = t.app.findNode(t.f.id).cfg.criteria[0];
      assert.equal(t.app.critValue(c, 'gpa', null), '6', 'and the binding survived');
    });

    test('a variable nothing uses cannot make anything stale', () => {
      const h = boot();
      h.build('source', 'output');
      h.w.runQuery();
      assert.ok(h.app.resultsFresh);
      const v = declare(h, 'spare', '3');
      assert.ok(h.app.resultsFresh, 'declared and unused changes no answer');
      h.app.removeVariable(v.id);
      assert.ok(h.app.resultsFresh, 'and neither does removing it');
    });

    test('it works on a column that is picked rather than typed', () => {
      const t = filtering('specialisation', 'Data Science');
      pressChip(t, t.f.id, 'crit.0.var:specialisation');
      const c = t.app.findNode(t.f.id).cfg.criteria[0];
      assert.equal(t.app.critValue(c, 'specialisation', null), 'Data Science',
        'the supervisor\'s own example is an identifier, not a number');
    });

    test('each end of a range binds separately', () => {
      const t = filtering('gpa', '4');
      declare(t, 'ceiling', '7');
      t.set(t.f.id, 'crit.0.op:gpa', 'between');
      pressChip(t, t.f.id, 'crit.0.var:gpa');
      const c = t.app.findNode(t.f.id).cfg.criteria[0];
      /* The high end binds through its own chip, then its select is moved onto
         the second variable. The chip binds to the first one, which is the only
         sensible guess when there is no menu to open. */
      pressChip(t, t.f.id, 'crit.0.var:gpa:max');
      t.set(t.f.id, 'crit.0.var:gpa:max', String(t.app.variables[1].id));
      const rng = t.app.critRange(c, 'gpa', null);
      assert.equal(rng.loRaw, '4');
      assert.equal(rng.hiRaw, '7', 'one end bound to each');
    });

    test('a criterion removed takes its bindings with it', () => {
      const t = filtering('gpa', '6');
      t.w.addCriterion(t.f.id);
      const n = t.app.findNode(t.f.id);
      t.set(t.f.id, 'crit.1.field', 'gpa');
      pressChip(t, t.f.id, 'crit.1.var:gpa');
      assert.equal(t.app.varUsedCount(t.app.varById(t.v.id)), 1);
      t.w.removeCriterion(t.f.id, 1);
      assert.equal(n.cfg.criteria.length, 1);
      assert.equal(t.app.varUsedCount(t.app.varById(t.v.id)), 0,
        'bindings live inside the criterion, so an index can never go stale');
    });
  });

  /* ══ 5. THE TWO SETTINGS THE QUESTION NAMED ═══════════════════════════════ */
  describe('row count and band width, the two he asked about', () => {

    test('Take takes its count from a variable', () => {
      const h = boot();
      const [s, tk, o] = h.build('source', 'take', 'output');
      const v = declare(h, 'rows', '3');
      pressChip(h, tk.id, 'var:n');
      assert.equal(h.app.takeCount(h.app.findNode(tk.id)), 3);
      h.w.runQuery();
      assert.equal(h.app.exportData[o.id].table.rows.length, 3);
      assert.ok(s);
    });

    test('the Take hint states the number that will be used, not the one in the box', () => {
      const h = boot();
      const [, tk] = h.build('source', 'take', 'output');
      h.set(tk.id, 'n', '4');
      declare(h, 'rows', '25');
      pressChip(h, tk.id, 'var:n');
      const hints = h.qa('.cmp-hint').map(e => e.textContent).join(' ');
      assert.includes(hints, '25');
      assert.excludes(hints, 'first 4 rows');
    });

    test('a variable holding nonsense falls back exactly as typed nonsense does', () => {
      const h = boot();
      const [, tk] = h.build('source', 'take', 'output');
      declare(h, 'rows', 'abc');
      pressChip(h, tk.id, 'var:n');
      assert.equal(h.app.takeCount(h.app.findNode(tk.id)), h.app.TAKE_DEFAULT,
        'the binding decides where the text comes from and nothing else');
    });

    test('Histogram takes its band width from a variable', () => {
      const h = boot();
      const [, hg] = h.build('source', 'histogram', 'output');
      const v = declare(h, 'width', '2');
      pressChip(h, hg.id, 'var:width');
      assert.equal(h.app.binWidth(h.app.findNode(hg.id)), 2);
      assert.ok(v);
    });

    test('an empty width variable still means "decide from the data"', () => {
      const h = boot();
      const [, hg] = h.build('source', 'histogram', 'output');
      declare(h, 'width', '');
      pressChip(h, hg.id, 'var:width');
      assert.equal(h.app.binWidth(h.app.findNode(hg.id)), null);
    });

    test('two Histograms on one width variable cannot drift apart', () => {
      const h = boot();
      const [s, h1] = h.build('source', 'histogram', 'output');
      const h2 = h.add('histogram');
      h.app.connect(s.id, h2.id);
      h.w.render();
      declare(h, 'width', '2.5');
      pressChip(h, h1.id, 'var:width');
      pressChip(h, h2.id, 'var:width');
      assert.equal(h.app.binWidth(h.app.findNode(h1.id)), 2.5);
      assert.equal(h.app.binWidth(h.app.findNode(h2.id)), 2.5,
        'which is what makes the two distributions comparable');
    });
  });

  /* ══ 6. WHERE A VARIABLE MAY NOT GO ═══════════════════════════════════════ */
  describe('the boundary, which is as deliberate as the inclusions', () => {

    test('a list operand offers no chip: a variable holds one value', () => {
      const h = boot();
      const [, f] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'gpa');
      declare(h, 'v', '5');
      h.set(f.id, 'crit.0.op:gpa', 'in');
      assert.ok(h.q('.crit-list'), 'the list band is open');
      assert.equal(h.q('.crit-list .var-use'), null);
      assert.equal(h.q('.crit-list .var-slot'), null);
    });

    test('the operator and the column are structure, not values', () => {
      const h = boot();
      h.build('source', 'filter', 'output');
      declare(h, 'v', '5');
      const row = h.q('.criterion-row');
      const opSel = row.querySelector('[data-key^="crit.0.op:"]');
      const fieldSel = row.querySelector('[data-key="crit.0.field"]');
      assert.ok(opSel && fieldSel, 'both controls are there');
      assert.equal(opSel.closest('.var-slot'), null, 'the operator takes no variable');
      assert.equal(fieldSel.closest('.var-slot'), null, 'nor does the column');
      assert.ok(row.querySelector('.var-slot'), 'the value, meanwhile, does');
    });

    test('a Source is not offered one: it reads its rows from a file', () => {
      const h = boot();
      const [s] = h.build('source', 'output');
      declare(h, 'v', '2024');
      h.w.render();
      const el = h.qa('.node')[h.app.nodes.findIndex(n => n.id === s.id)];
      assert.equal(el.querySelector('.var-use'), null);
      assert.ok(!h.app.nodeTakesVars(h.app.findNode(s.id)));
    });

    test('the table of places is what a panel and the dock both read', () => {
      const h = boot();
      const keys = h.app.VAR_OPERANDS.map(o => o.type + '.' + o.key).sort();
      assert.deepEqual(keys, ['histogram.width', 'take.n'],
        'adding the next one is an entry here plus a slot in its panel');
    });
  });

  /* ══ 7. NO BINDING EVER DANGLES ═══════════════════════════════════════════ */
  describe('a binding cannot outlive the variable it named', () => {

    test('removing an unused variable does not ask', () => {
      const h = boot();
      const v = declare(h, 'spare', '1');
      h.w.requestRemoveVariable(v.id);
      assert.equal(h.app.variables.length, 0, 'nothing to lose, nothing to confirm');
    });

    test('removing one in use asks first, and says what it would change', () => {
      const h = boot();
      const [, f] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'gpa');
      const v = declare(h, 'wanted', '6');
      pressChip(h, f.id, 'crit.0.var:gpa');

      h.w.requestRemoveVariable(v.id);
      assert.equal(h.app.variables.length, 1, 'still there');
      assert.equal(h.app.varPendingNow(), v.id);
      const note = h.q('[data-var-note="' + v.id + '"]').textContent;
      assert.includes(note, 'Filter #' + f.id, 'it names what it would change');

      h.w.requestRemoveVariable(v.id);
      assert.equal(h.app.variables.length, 0, 'the second press does it');
    });

    test('and every operand gets its typed value back', () => {
      const h = boot();
      const [, f] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'gpa');
      h.set(f.id, 'crit.0.value:gpa', '2');
      const v = declare(h, 'wanted', '6');
      pressChip(h, f.id, 'crit.0.var:gpa');
      h.app.removeVariable(v.id);

      const c = h.app.findNode(f.id).cfg.criteria[0];
      assert.deepEqual(c.vars, {}, 'no reference is left pointing at nothing');
      assert.equal(h.app.critValue(c, 'gpa', null), '2');
    });

    test('a half-asked question does not survive another edit', () => {
      const h = boot();
      const [, f] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'gpa');
      const v = declare(h, 'wanted', '6');
      pressChip(h, f.id, 'crit.0.var:gpa');
      h.w.requestRemoveVariable(v.id);
      assert.equal(h.app.varPendingNow(), v.id);

      const el = h.q('[data-var-value="' + v.id + '"]');
      el.value = '7';
      el.dispatchEvent(new h.w.Event('input', { bubbles: true }));
      assert.equal(h.app.varPendingNow(), null, 'the question belonged to the press');
    });

    test('deleting the node that used it drops the use, not the variable', () => {
      const h = boot();
      const [, f] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'gpa');
      const v = declare(h, 'wanted', '6');
      pressChip(h, f.id, 'crit.0.var:gpa');
      assert.equal(h.app.varUsedCount(h.app.varById(v.id)), 1);

      h.w.removeNode(f.id);
      assert.equal(h.app.variables.length, 1, 'a variable is not owned by a node');
      assert.equal(h.app.varUsedCount(h.app.varById(v.id)), 0);
      assert.includes(h.q('[data-var-note="' + v.id + '"]').textContent, 'Not used',
        'and the line under it says so without the chip being rebuilt');
    });

    test('Clear takes the variables with the query', () => {
      const h = boot();
      h.build('source', 'output');
      declare(h, 'a', '1');
      h.w.clearAll();
      assert.equal(h.app.variables.length, 0,
        'parameters with nothing on screen to account for them');
      assert.equal(h.doc.getElementById('varCount').textContent, '',
        'and the button says so');
      assert.ok(h.q('.var-empty'), 'the menu is back to explaining itself');
    });
  });

  /* ══ 8. SAVED WITH THE QUERY, VALUES AND ALL ══════════════════════════════ */
  describe('a saved query carries its variables and their current values', () => {

    function saved() {
      const h = boot();
      const [s, f, tk, o] = h.build('source', 'filter', 'take', 'output');
      h.set(f.id, 'crit.0.field', 'gpa');
      const a = declare(h, 'passGrade', '5');
      const b = declare(h, 'rows', '7');
      pressChip(h, f.id, 'crit.0.var:gpa');
      // Bound by its chip, then moved onto the second variable through the select.
      pressChip(h, tk.id, 'var:n');
      h.set(tk.id, 'var:n', String(b.id));
      return { ...h, s, f, tk, o, a, b };
    }

    test('the format says it is version 4, which is what added them', () => {
      const h = boot();
      assert.equal(h.app.FILE_VERSION, 4,
        'the exact version is pinned by whichever suite owns the newest addition');
    });

    test('name and value both, which is what was asked for', () => {
      const t = saved();
      const g = t.app.serialiseGraph();
      assert.deepEqual(g.variables, [
        { id: t.a.id, name: 'passGrade', value: '5' },
        { id: t.b.id, name: 'rows',     value: '7' }
      ]);
    });

    test('the bindings ride along inside the nodes', () => {
      const t = saved();
      const g = t.app.serialiseGraph();
      const flt = g.nodes.find(n => n.type === 'filter');
      const take = g.nodes.find(n => n.type === 'take');
      assert.equal(flt.cfg.criteria[0].vars.gpa, t.a.id);
      assert.equal(take.cfg.vars.n, t.b.id);
    });

    test('a round trip restores the values and every reference to them', () => {
      const t = saved();
      const json = JSON.stringify(t.app.serialiseGraph());
      t.w.clearAll();
      assert.equal(t.app.variables.length, 0);

      t.app.loadGraphFromText(json, t.doc.createElement('button'));
      assert.equal(t.app.variables.length, 2);
      assert.equal(t.app.varById(t.a.id).value, '5');

      const flt = t.app.nodes.find(n => n.type === 'filter');
      const take = t.app.nodes.find(n => n.type === 'take');
      assert.equal(t.app.critValue(flt.cfg.criteria[0], 'gpa', null), '5');
      assert.equal(t.app.takeCount(take), 7);
    });

    test('and the chips are back in the menu', () => {
      const t = saved();
      const json = JSON.stringify(t.app.serialiseGraph());
      t.w.clearAll();
      t.app.loadGraphFromText(json, t.doc.createElement('button'));
      assert.equal(t.qa('.var-chip').length, 2);
      assert.equal(t.q('[data-var-name="' + t.a.id + '"]').value, 'passGrade');
    });

    test('a variable added after a load cannot collide with one from it', () => {
      const t = saved();
      const json = JSON.stringify(t.app.serialiseGraph());
      t.w.clearAll();
      t.app.loadGraphFromText(json, t.doc.createElement('button'));
      const fresh = t.w.addVariable();
      assert.ok(fresh.id > t.b.id, 'the counter was moved clear of the file');
      assert.equal(t.app.varUsedCount(fresh), 0, 'so it inherited nothing');
    });

    test('the load message names them, because changing one is the next thing to do', () => {
      const t = saved();
      const json = JSON.stringify(t.app.serialiseGraph());
      t.w.clearAll();
      t.app.loadGraphFromText(json, t.doc.createElement('button'));
      assert.includes(t.panel(), 'passGrade = 5');
    });

    /* A dropdown that opens itself would cover the canvas the user has just
       been shown. The two quieter signals carry it instead. */
    test('a load does not throw the menu open, but says what arrived', () => {
      const t = saved();
      const json = JSON.stringify(t.app.serialiseGraph());
      t.w.clearAll();
      t.app.loadGraphFromText(json, t.doc.createElement('button'));
      assert.ok(!t.app.varMenuOpen(), 'nothing opens itself over the canvas');
      assert.equal(t.doc.getElementById('varCount').textContent, '2');
      assert.includes(t.panel(), 'passGrade = 5');
    });

    test('the library keeps them too, being the same graph object', () => {
      const t = saved();
      const r = t.app.libAdd('with vars', {});
      assert.ok(r.ok, r.error && r.error.message);
      t.w.clearAll();
      t.app.loadGraphFromText(t.app.libGraphText(r.entry.id),
                              t.doc.createElement('button'));
      assert.equal(t.app.variables.length, 2);
      assert.equal(t.app.varById(t.b.id).value, '7');
    });
  });

  /* ══ 9. WHAT A HAND-EDITED FILE CANNOT DO ═════════════════════════════════ */
  describe('a file is admitted on its shape, never on its contents', () => {

    const load = (over) => {
      const h = boot();
      return h.app.deserialiseGraph(JSON.stringify(Object.assign({
        kind: h.app.FILE_KIND, version: 4, nodes: [], connections: []
      }, over)));
    };

    test('a file from before variables existed loads with none', () => {
      const g = load({ version: 3, nodes: [{ id: 1, type: 'take', cfg: { n: '4' } }] });
      assert.notOk(g.error);
      assert.deepEqual(g.variables, []);
      assert.deepEqual(g.nodes[0].cfg.vars, {}, 'and every operand reads its own literal');
    });

    test('variables that are not variables are dropped, with a warning', () => {
      const g = load({ variables: [null, 'x', [], { name: 'no id' }, { id: 2, name: 'ok', value: '1' }] });
      assert.equal(g.variables.length, 1);
      assert.equal(g.variables[0].name, 'ok');
      assert.ok(g.warnings.length);
    });

    test('two variables with one id keep the first', () => {
      const g = load({ variables: [{ id: 5, name: 'first', value: '1' },
                                   { id: 5, name: 'second', value: '2' }] });
      assert.equal(g.variables.length, 1);
      assert.equal(g.variables[0].name, 'first',
        'renumbering would silently re-point whatever was bound to it');
    });

    test('more than the ceiling is cut', () => {
      const h = boot();
      const many = [];
      for (let i = 1; i <= 40; i++) many.push({ id: i, name: 'v' + i, value: '1' });
      const g = h.app.deserialiseGraph(JSON.stringify({
        kind: h.app.FILE_KIND, version: 4, nodes: [], connections: [], variables: many
      }));
      assert.equal(g.variables.length, h.app.VAR_MAX);
    });

    test('an object where a name belongs becomes a blank name, not "[object Object]"', () => {
      const g = load({ variables: [{ id: 1, name: { a: 1 }, value: { b: 2 } }] });
      assert.equal(g.variables[0].name, '');
      assert.equal(g.variables[0].value, '');
    });

    test('a number where a value belongs is accepted, since a value is a scalar', () => {
      const g = load({ variables: [{ id: 1, name: 'n', value: 70 }] });
      assert.equal(g.variables[0].value, '70');
    });

    test('a value longer than the cap is cut', () => {
      const h = boot();
      const g = h.app.deserialiseGraph(JSON.stringify({
        kind: h.app.FILE_KIND, version: 4, nodes: [], connections: [],
        variables: [{ id: 1, name: 'n', value: 'x'.repeat(5000) }]
      }));
      assert.equal(g.variables[0].value.length, h.app.VAR_VALUE_MAX);
    });

    test('a reference to a variable the file does not declare is dropped', () => {
      const g = load({
        variables: [{ id: 1, name: 'real', value: '3' }],
        nodes: [{ id: 1, type: 'take', cfg: { n: '5', vars: { n: 99 } } }]
      });
      assert.deepEqual(g.nodes[0].cfg.vars, {});
      assert.ok(g.warnings.some(w => /does not declare/.test(w)));
    });

    test('a reference that does resolve is kept, as a number', () => {
      const g = load({
        variables: [{ id: 4, name: 'real', value: '3' }],
        nodes: [{ id: 1, type: 'take', cfg: { n: '5', vars: { n: '4' } } }]
      });
      assert.equal(g.nodes[0].cfg.vars.n, 4);
    });

    test('an array where the bindings map belongs becomes an empty map', () => {
      const g = load({ nodes: [{ id: 1, type: 'take', cfg: { n: '5', vars: [1, 2, 3] } }] });
      assert.deepEqual(g.nodes[0].cfg.vars, {});
    });

    test('a criterion dangling reference is pruned too', () => {
      const g = load({
        variables: [],
        nodes: [{ id: 1, type: 'filter',
                  cfg: { criteria: [{ field: 'gpa', values: { gpa: '2' }, ops: {}, vars: { gpa: 7 } }] } }]
      });
      assert.deepEqual(g.nodes[0].cfg.criteria[0].vars, {});
    });

    test('bindings are not normalised into existence on a node that has none', () => {
      const g = load({ nodes: [{ id: 1, type: 'reverse', cfg: {} }] });
      assert.equal(g.nodes[0].cfg.vars, undefined,
        'Reverse has nothing to configure, so it gains no map for it');
    });

    test('a bound setting that is loaded still refuses an impossible value the same way', () => {
      const h = boot();
      const [, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.field', 'gpa');
      declare(h, 'wanted', '');
      pressChip(h, f.id, 'crit.0.var:gpa');
      h.w.runQuery();
      assert.includes(h.panel().toLowerCase(), 'gpa',
        'an empty variable is an empty operand, refused where an empty box is');
      assert.ok(o);
    });
  });

  /* ══ 10. THE FEATURE EXPLAINS ITSELF ══════════════════════════════════════ */
  describe('it is documented where the longer explanations live', () => {

    test('Help has a section of its own, reachable from the nav', () => {
      const h = boot();
      assert.ok(h.doc.getElementById('help-vars'), 'a section');
      assert.ok(h.q('.help-navitem[data-goto="help-vars"]'), 'and a way to it');
    });

    test('it says what a variable is, where it goes, and what it will not do', () => {
      const h = boot();
      const text = h.doc.getElementById('help-vars').textContent;
      ['name once', 'not nodes', 'toolbar', 'Take', 'Histogram', 'in range'].forEach(w =>
        assert.includes(text, w, 'Help is missing: ' + w));
      assert.includes(text, 'is one of',
        'the one thing a variable cannot stand for is worth naming');
    });

    test('it carries a worked example, which is the form that was asked for', () => {
      const h = boot();
      const text = h.doc.getElementById('help-vars').textContent;
      assert.includes(text, 'worked example');
      assert.includes(text, 'Run Query');
    });

    test('the panels themselves stay short: the chip and the value are not prose', () => {
      const h = boot();
      const [, tk] = h.build('source', 'take', 'output');
      declare(h, 'rows', '9');
      pressChip(h, tk.id, 'var:n');
      const el = h.qa('.node')[h.app.nodes.findIndex(n => n.id === tk.id)];
      const hints = [...el.querySelectorAll('.cmp-hint')].map(d => d.textContent).join(' ');
      assert.ok(hints.length <= 240,
        'a bound operand must not spend the panel budget explaining itself: ' + hints.length);
    });
  });
};
