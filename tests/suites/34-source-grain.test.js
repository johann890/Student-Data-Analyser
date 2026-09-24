/* What a row means, chosen on the Source.

   This setting existed once and was deliberately removed. The note survives in
   applyProject(): "a granularity switch hidden in a dropdown made 'count
   students' wrong by a factor of eight with nothing on screen to say so", and
   the replacement it prescribed was a node on the canvas, which is Project.

   The supervisor asked for the setting back on 2026-09-24, having found the
   nesting unexpected: "I think it should be possible to select whether a Source
   node performs this transformation or not."

   Both positions are right, so what came back is the switch without the hiding,
   and most of this suite is about the hiding rather than about the unfold. The
   unfold itself is applyProject() called rather than copied, so the tests that
   matter most here are the ones asserting that the two routes agree and that
   the grain is legible from four places at once. */

const { boot } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {

  const GRAIN = (h, id) => h.app.findNode(id).cfg.grain;

  function rig(grain) {
    const h = boot();
    const [s, o] = h.build('source', 'output');
    if (grain) h.set(s.id, 'grain', grain);
    h.w.runQuery();
    return { ...h, s, o };
  }

  const cols = (h, id) => h.entry(id).table.columns.map(c => c.key);
  const labels = (h, id) => h.entry(id).table.columns.map(c => c.label);
  const rowCount = (h, id) => h.entry(id).table.rows.length;
  const log = (h, id) => h.entry(id).log.join('\n');

  describe('the default is what every existing query was built against', () => {
    test('a fresh Source emits students', () => {
      const h = boot();
      const [s] = h.build('source', 'output');
      assert.equal(h.app.defaultCfg('source').grain, 'student');
      assert.equal(h.app.sourceGrain(s).key, 'student');
    });

    test('and carries the nested course column', () => {
      const r = rig();
      assert.includes(cols(r, r.o.id), 'courses');
      assert.includes(cols(r, r.o.id), 'id');
    });

    test('a saved query with no grain key at all still means students', () => {
      const h = boot();
      const g = { kind:'student-data-analyser-query', version:1,
                  nodes:[{ id:1, type:'source', x:10, y:10, cfg:{ pop:'all' } }],
                  connections:[] };
      const r = h.app.deserialiseGraph(JSON.stringify(g));
      assert.notOk(r.error, r.error);
      assert.equal(h.app.sourceGrain(r.nodes[0]).key, 'student');
    });

    test('and a file naming a grain that does not exist falls back, not throws', () => {
      const h = boot();
      const g = { kind:'student-data-analyser-query', version:1,
                  nodes:[{ id:1, type:'source', x:10, y:10, cfg:{ grain:'per-lecturer' } }],
                  connections:[] };
      const r = h.app.deserialiseGraph(JSON.stringify(g));
      assert.notOk(r.error, r.error);
      assert.equal(h.app.sourceGrain(r.nodes[0]).key, 'student');
    });

    test('a grain given as an object is coerced rather than trusted', () => {
      const h = boot();
      const g = { kind:'student-data-analyser-query', version:1,
                  nodes:[{ id:1, type:'source', x:10, y:10, cfg:{ grain:{ evil:1 } } }],
                  connections:[] };
      const r = h.app.deserialiseGraph(JSON.stringify(g));
      assert.notOk(r.error, r.error);
      assert.equal(typeof r.nodes[0].cfg.grain, 'string');
      assert.equal(h.app.sourceGrain(r.nodes[0]).key, 'student');
    });
  });

  describe('switching to enrolments', () => {
    test('multiplies the rows', () => {
      const a = rig(), b = rig('enrolment');
      assert.ok(rowCount(b, b.o.id) > rowCount(a, a.o.id),
        'one student becomes one row per course taken');
    });

    test('drops the nested column, having turned it into rows', () => {
      const r = rig('enrolment');
      assert.excludes(cols(r, r.o.id), 'courses');
    });

    test('brings the enrolment columns with it', () => {
      const r = rig('enrolment');
      ['code', 'subject', 'level', 'points', 'gradePoints', 'letterGrade']
        .forEach(k => assert.includes(cols(r, r.o.id), k));
    });

    test('renames ID to Student, because it no longer identifies a row', () => {
      const r = rig('enrolment');
      assert.includes(cols(r, r.o.id), 'studentId');
      assert.excludes(cols(r, r.o.id), 'id');
      assert.includes(labels(r, r.o.id), 'Student');
    });

    test('Grade now means the course, and Overall grade is gone', () => {
      const r = rig('enrolment');
      assert.includes(labels(r, r.o.id), 'Grade');
      assert.excludes(labels(r, r.o.id), 'Overall grade');
    });

    test('and back again, with nothing left behind', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(s.id, 'grain', 'enrolment');
      h.w.runQuery();
      const many = rowCount(h, o.id);
      h.set(s.id, 'grain', 'student');
      h.w.runQuery();
      assert.ok(rowCount(h, o.id) < many);
      assert.includes(cols(h, o.id), 'courses');
      assert.includes(cols(h, o.id), 'id');
    });
  });

  describe('it is the same unfold a Project performs', () => {
    test('Source-on-enrolments and Source-plus-Project agree on the header', () => {
      const a = rig('enrolment');
      const h = boot();
      const [s, p, o] = h.build('source', 'project', 'output');
      h.w.runQuery();
      assert.deepEqual(cols(a, a.o.id), cols(h, o.id));
    });

    test('and on the row count', () => {
      const a = rig('enrolment');
      const h = boot();
      const [s, p, o] = h.build('source', 'project', 'output');
      h.w.runQuery();
      assert.equal(rowCount(a, a.o.id), rowCount(h, o.id));
    });

    test('a Project after an enrolment Source has nothing to do, and says so', () => {
      const h = boot();
      const [s, p, o] = h.build('source', 'project', 'output');
      h.set(s.id, 'grain', 'enrolment');
      h.w.runQuery();
      assert.includes(log(h, o.id), 'nothing to expand');
      assert.equal(rowCount(h, o.id), rowCount(rig('enrolment'), rig('enrolment').o.id));
    });
  });

  describe('the schema pass agrees with the row pass', () => {
    test('a Filter downstream offers the enrolment columns', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(s.id, 'grain', 'enrolment');
      const fields = h.app.filterFields(h.app.inputSchema(f, h.app.computeSchemas()))
        .map(x => x.key);
      assert.includes(fields, 'level');
      assert.includes(fields, 'points');
    });

    test('and stops offering the student ones the unfold replaced', () => {
      const h = boot();
      const [s, f, o] = h.build('source', 'filter', 'output');
      h.set(s.id, 'grain', 'enrolment');
      const keys = h.app.inputSchema(f, h.app.computeSchemas()).columns.map(c => c.key);
      assert.excludes(keys, 'courses');
      assert.includes(keys, 'studentId');
    });

    test('the header a Source declares is the header it emits', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(s.id, 'grain', 'enrolment');
      const declared = h.app.computeSchemas()[s.id].columns.map(c => c.key);
      h.w.runQuery();
      assert.deepEqual(declared, cols(h, o.id));
    });
  });

  describe('population is applied before the unfold', () => {
    test('one year of enrolments is that year students’ enrolments', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      const year = h.app.YEARS[0];
      h.set(s.id, 'pop', String(year));
      h.set(s.id, 'grain', 'enrolment');
      h.w.runQuery();
      const yi = h.entry(o.id).table.columns.findIndex(c => c.key === 'year');
      assert.ok(h.entry(o.id).table.rows.length > 0);
      h.entry(o.id).table.rows.forEach(r =>
        assert.equal(String(r[yi]), String(year), 'a row from another cohort survived'));
    });
  });

  describe('nothing about it is hidden', () => {
    test('1. the node on the canvas names the grain', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      assert.notOk(h.q('.shape-source .node-grain'),
        'the default grain adds no words to the shape');
      h.set(s.id, 'grain', 'enrolment');
      const mark = h.q('.shape-source .node-grain');
      assert.ok(mark, 'a Source emitting enrolments must say so on the canvas');
      assert.includes(mark.textContent.replace(/\s+/g, ' '), 'one row per');
      assert.includes(mark.textContent, 'enrolment');
    });

    test('and carries the modifier its layout needs', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(s.id, 'grain', 'enrolment');
      const shape = h.q('.shape-source');
      assert.ok(shape.classList.contains('has-grain'));
      assert.ok(shape.classList.contains('shape-source'),
        'the base class has to survive, or the stylesheet loses the node');
    });

    test('2. the panel states the multiplication, not the setting', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(s.id, 'grain', 'enrolment');
      const t = h.q('[data-node="' + s.id + '"][data-key="grain"]')
                 .closest('.node-config').textContent.replace(/\s+/g, ' ');
      assert.includes(t, 'course registrations rather than people');
    });

    test('the student grain says what a row is there too', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      const t = h.q('[data-node="' + s.id + '"][data-key="grain"]')
                 .closest('.node-config').textContent.replace(/\s+/g, ' ');
      assert.includes(t, 'one student in one year');
    });

    test('3. the query log records it as its own step, with both row counts', () => {
      const r = rig('enrolment');
      const l = log(r, r.o.id);
      assert.includes(l, 'ROWS');
      assert.includes(l, 'one per course');
      assert.excludes(l, 'PROJECT',
        'a PROJECT line would name a step that is not on this canvas');
    });

    test('and says nothing at all on the default grain', () => {
      const r = rig();
      assert.excludes(log(r, r.o.id), 'ROWS');
      assert.excludes(log(r, r.o.id), 'one per course');
    });

    test('a real Project still logs under its own name', () => {
      const h = boot();
      const [s, p, o] = h.build('source', 'project', 'output');
      h.w.runQuery();
      assert.includes(log(h, o.id), 'PROJECT');
    });

    test('4. changing it stales the run, because it computes', () => {
      const r = rig();
      assert.ok(r.app.resultsFresh);
      r.set(r.s.id, 'grain', 'enrolment');
      assert.notOk(r.app.resultsFresh);
    });
  });

  describe('it travels with the query', () => {
    test('saved and loaded, the grain comes back', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(s.id, 'grain', 'enrolment');
      const json = JSON.stringify(h.app.serialiseGraph());
      assert.includes(json, 'enrolment');
      const back = boot();
      const r = back.app.deserialiseGraph(json);
      assert.notOk(r.error, r.error);
      const src = r.nodes.find(n => n.type === 'source');
      assert.equal(back.app.sourceGrain(src).key, 'enrolment');
    });

    test('and the data does not: only the file names are written', () => {
      const h = boot();
      const [s, o] = h.build('source', 'output');
      h.set(s.id, 'grain', 'enrolment');
      const json = JSON.stringify(h.app.serialiseGraph());
      assert.excludes(json, '"rows":[[');
    });
  });
};
