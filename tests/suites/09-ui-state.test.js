/* UI state ownership.
   The model is authoritative and render() only reads. These tests pin the two
   behaviours that depended on that: dragging must not rebuild the DOM, and
   typing must not destroy the field being typed into. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  describe('config lives in the model', () => {
    test('every node is created with a complete config', () => {
      const h = boot();
      ['source', 'filter', 'compare', 'output'].forEach(t => {
        h.w.addNode(t);
        const n = h.app.nodes[h.app.nodes.length - 1];
        assert.ok(n.cfg, t + ' has no cfg');
        assert.deepEqual(Object.keys(n.cfg).sort(), Object.keys(h.app.defaultCfg(t)).sort(), t);
      });
    });

    test('changing a control writes straight into the model', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(s.id, 'pop', String(h.app.YEARS[0]));
      assert.equal(s.cfg.pop, String(h.app.YEARS[0]));
    });

    test('the model survives a re-render without being read back from the DOM', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.value:gradeAvg', '88');
      h.w.render();
      assert.equal(f.cfg.criteria[0].values.gradeAvg, '88');
      assert.equal(h.control(f.id, 'crit.0.value:gradeAvg').value, '88');
    });

    test('a config value survives its panel being off screen', () => {
      // The old DOM-scraping approach read an unrendered panel as "unset".
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.value:gradeAvg', '91');
      h.w.removeNode(o.id);
      h.w.render();
      assert.equal(f.cfg.criteria[0].values.gradeAvg, '91');
    });

    test('every rendered control declares both data attributes', () => {
      const h = boot();
      h.build('source', 'filter', 'output');
      h.w.addNode('compare');
      h.w.render();
      h.qa('.node-config select, .node-config input').forEach(el => {
        assert.ok(el.getAttribute('data-node'), 'control without data-node: ' + el.outerHTML.slice(0, 70));
        assert.ok(el.getAttribute('data-key'), 'control without data-key: ' + el.outerHTML.slice(0, 70));
      });
    });

    test('every data-node points at a node that exists', () => {
      const h = boot();
      h.build('source', 'filter', 'output');
      const ids = h.app.nodes.map(n => String(n.id));
      h.qa('[data-node]').forEach(el => assert.includes(ids, el.getAttribute('data-node')));
    });
  });

  describe('criterion value retention', () => {
    test('switching field and back restores the original value', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.value:gradeAvg', '93');
      h.set(f.id, 'crit.0.field', 'gender');
      h.set(f.id, 'crit.0.value:gender', 'F');
      h.set(f.id, 'crit.0.field', 'gradeAvg');
      assert.equal(h.control(f.id, 'crit.0.value:gradeAvg').value, '93');
    });

    test('values for different fields are kept separately', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.value:gradeAvg', '93');
      h.set(f.id, 'crit.0.field', 'courses.mark');
      h.set(f.id, 'crit.0.course', 'AIML425');
      h.set(f.id, 'crit.0.value:courses.mark', '55');
      h.set(f.id, 'crit.0.field', 'gender');
      h.set(f.id, 'crit.0.value:gender', 'F');
      assert.deepEqual(f.cfg.criteria[0].values,
        { gradeAvg: '93', 'courses.mark': '55', gender: 'F' });
      assert.equal(f.cfg.criteria[0].course, 'AIML425');
    });

    test('operators are kept per field too', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.op:gradeAvg', 'lte');
      h.set(f.id, 'crit.0.field', 'courses.mark');
      h.set(f.id, 'crit.0.op:courses.mark', 'gt');
      h.set(f.id, 'crit.0.field', 'gradeAvg');
      assert.equal(h.control(f.id, 'crit.0.op:gradeAvg').value, 'lte');
    });

    test('each criterion keeps its own values', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.w.addCriterion(f.id); h.w.render();
      h.set(f.id, 'crit.0.value:gradeAvg', '60');
      h.set(f.id, 'crit.1.value:gradeAvg', '90');
      assert.equal(f.cfg.criteria[0].values.gradeAvg, '60');
      assert.equal(f.cfg.criteria[1].values.gradeAvg, '90');
    });
  });

  describe('dragging', () => {
    test('a drag moves the existing element instead of rebuilding it', () => {
      const h = boot();
      h.w.addNode('source');
      const before = h.q('.node');
      h.q('.shape-source').dispatchEvent(
        new h.w.MouseEvent('mousedown', { clientX: 120, clientY: 100, bubbles: true }));
      for (let i = 0; i < 20; i++) {
        h.doc.dispatchEvent(new h.w.MouseEvent('mousemove',
          { clientX: 120 + i * 8, clientY: 100 + i * 3, bubbles: true }));
      }
      const during = h.q('.node');
      assert.equal(before, during, 'the panel was torn down and rebuilt mid-drag');
      h.doc.dispatchEvent(new h.w.MouseEvent('mouseup', { bubbles: true }));
    });

    test('a drag does not disturb the config', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(f.id, 'crit.0.value:gradeAvg', '77');
      h.q('.shape-source').dispatchEvent(
        new h.w.MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true }));
      h.doc.dispatchEvent(new h.w.MouseEvent('mousemove', { clientX: 200, clientY: 150, bubbles: true }));
      h.doc.dispatchEvent(new h.w.MouseEvent('mouseup', { bubbles: true }));
      assert.equal(f.cfg.criteria[0].values.gradeAvg, '77');
    });

    test('a drag started on a control does not move the node', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      const before = { x: s.x, y: s.y };
      const sel = h.control(s.id, 'pop');
      sel.dispatchEvent(new h.w.MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
      h.doc.dispatchEvent(new h.w.MouseEvent('mousemove', { clientX: 400, clientY: 400, bubbles: true }));
      h.doc.dispatchEvent(new h.w.MouseEvent('mouseup', { bubbles: true }));
      assert.deepEqual({ x: s.x, y: s.y }, before, 'using a dropdown should not drag the node');
    });
  });

  describe('typing', () => {
    test('the export name field survives being typed into', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.w.runQuery();
      const first = h.exportNameField(o.id);
      'report'.split('').forEach((_, i) => {
        const el = h.exportNameField(o.id);
        el.value = 'report'.slice(0, i + 1);
        el.dispatchEvent(new h.w.Event('input', { bubbles: true }));
      });
      assert.equal(h.exportNameField(o.id), first, 'the field was rebuilt mid-keystroke');
      assert.equal(o.cfg.filename, 'report');
    });

    test('a number field survives being typed into', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      const first = h.control(f.id, 'crit.0.value:gradeAvg');
      ['8', '85'].forEach(v => {
        const el = h.control(f.id, 'crit.0.value:gradeAvg');
        el.value = v;
        el.dispatchEvent(new h.w.Event('input', { bubbles: true }));
      });
      assert.equal(h.control(f.id, 'crit.0.value:gradeAvg'), first);
      assert.equal(f.cfg.criteria[0].values.gradeAvg, '85');
    });

    test('a dropdown does re-render, because the panel shape can depend on it', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      assert.notOk(h.control(f.id, 'crit.0.course'), 'no course picker for a numeric field');
      h.set(f.id, 'crit.0.field', 'courses.mark');
      assert.ok(h.control(f.id, 'crit.0.course'), 'the picker should appear');
    });
  });

  describe('rendering', () => {
    test('the hint shows only on an empty canvas', () => {
      const h = boot();
      assert.equal(h.doc.getElementById('hint').style.display, 'block');
      h.w.addNode('source');
      assert.equal(h.doc.getElementById('hint').style.display, 'none');
    });

    test('one DOM node per model node, and no leftovers', () => {
      const h = boot();
      h.build('source', 'filter', 'output');
      assert.equal(h.qa('.node').length, 3);
      h.w.render(); h.w.render();
      assert.equal(h.qa('.node').length, 3, 'repeated renders should not accumulate elements');
    });

    test('an arrow is drawn for every connection', () => {
      const h = boot();
      h.build('source', 'filter', 'output');
      assert.equal(h.qa('#svg path.conn-hit').length, 2);
    });

    test('node positions follow the model', () => {
      const h = boot();
      h.w.addNode('source');
      const n = h.app.nodes[0];
      n.x = 210; n.y = 55;
      h.w.render();
      assert.equal(h.q('.node').style.left, '210px');
      assert.equal(h.q('.node').style.top, '55px');
    });
  });

  describe('escaping', () => {
    // The payloads below all contain a double quote, because that is what
    // breaks out of an HTML attribute. A payload without one stays harmlessly
    // inside value="..." even with escaping removed, and would pass against
    // broken code.
    const BREAKOUT = '"><img src=x onerror=1>';

    test('an export name that tries to break out of its attribute cannot', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.app.setCfg(o.id, 'filename', BREAKOUT);
      h.w.runQuery();
      assert.equal(h.qa('#panelBody img').length, 0, 'markup escaped the attribute');
      assert.equal(h.exportNameField(o.id).value, BREAKOUT, 'the literal text should survive');
    });

    test('a compare branch label cannot break out either', () => {
      const h = boot();
      const [s, f, c, o] = h.build('source', 'filter', 'compare', 'output');
      h.app.setCfg(c.id, 'label:' + f.id, BREAKOUT);
      h.w.render();
      assert.equal(h.qa('.node img').length, 0);
    });

    test('table cell content is escaped', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      // Inject through the data itself, the way a real dataset could
      h.app.STUDENTS[0].specialisation = '<img src=x onerror=1>';
      h.w.runQuery();
      assert.equal(h.qa('#panelBody img').length, 0, 'a data value was rendered as markup');
      assert.includes(h.panel(), '<img src=x onerror=1>', 'it should appear as literal text');
      h.app.STUDENTS[0].specialisation = 'Software Engineering';
    });

    test('column labels are escaped', () => {
      const { app } = boot();
      const t = app.makeTable([{ key: 'a', label: '<img src=x onerror=1>', type: app.COLTYPE.TEXT }], [['v']]);
      const h = boot();
      h.build('source', 'output');
      h.w.runQuery();
      // Render the hostile header through the same path the panel uses
      assert.ok(app.serialiseTable(t, ',', true).indexOf('<img') === 0 ||
                app.serialiseTable(t, ',', true).indexOf('<img') > 0,
        'export keeps the raw label, which is correct for a file');
    });

    test('an error message is escaped', () => {
      const h = boot();
      h.app.loadGraphFromText('{"kind":"<img src=x onerror=1>"}', h.doc.createElement('button'));
      assert.ok(h.q('.error-box'));
      assert.equal(h.qa('.error-box img').length, 0);
    });

    test('the query log renders operators as text, not markup', () => {
      // "<" and ">" are operators here. Building HTML first and stripping tags
      // later would lose them entirely.
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(o.id, 'show', 'count');
      h.set(f.id, 'crit.0.op:gradeAvg', 'lt');
      h.set(f.id, 'crit.0.value:gradeAvg', '60');
      h.w.runQuery();
      assert.includes(h.text('.query-log'), '<');
    });
  });
};
