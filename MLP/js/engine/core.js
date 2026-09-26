/* engine/core.js: The query walk, the operators it dispatches to, and Filter.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   ENGINE: Evaluation, the nodes that transform a Table, and their specs
   ============================================================================
   The query engine and every operation it dispatches to: Compare, Unique,
   Select, Project, Output, Aggregation, Combine, then the node specifications
   that describe them to the editor. Zero DOM references, by rule now rather
   than by habit: if a function in this file needs an element, it is in the
   wrong file.
   ============================================================================
   Part of the query builder. LOAD ORDER MATTERS, and the order is the script
   list at the foot of index.html. These are deliberately NOT ES modules; the tool is
   opened from Finder at file://, where module scripts are fetched with CORS
   against an opaque origin and refused. Classic scripts sharing one global
   scope are what works there, which is why nothing here is wrapped in an IIFE
   and why a name declared in one file is visible in the next.                */

/* ============================================================================
   QUERY ENGINE
   ============================================================================ */

var OP_FNS = {
  gt:  function(a,b){ return a >  b; },
  gte: function(a,b){ return a >= b; },
  lt:  function(a,b){ return a <  b; },
  lte: function(a,b){ return a <= b; },
  eq:  function(a,b){ return a == b; },   // deliberate ==: '2022' from a <select> must match 2022
  ne:  function(a,b){ return a != b; }
};
/* `between` takes three operands where every other comparison takes two. Rather
   than give it a different calling convention, every call site passes three and
   the binary functions ignore the one they do not want. JavaScript drops extra
   arguments, so `OP_FNS.gt(a, lo, hi)` is still `a > lo`. One call shape for
   every operator is what keeps applyCriterion free of a special case.

   The bounds are inclusive at both ends. "Between 70 and 80" asks a question
   about a band of marks, and a band that silently excluded 80 would be wrong in
   the way that is hardest to notice. The count is nearly right. */
OP_FNS.between = function(a, lo, hi) { return a >= lo && a <= hi; };

var OP_SYM = { gt:'>', gte:'>=', lt:'<', lte:'<=', eq:'=', ne:'!=',
               between:'in', in:'one of', matches:'~' };

/* What the operator dropdown says, where that differs from what the log says.
   A log line wants the terse form: "gpa in [5 .. 7]" reads well, but a
   control has to be findable, and "in" sitting last among six comparator
   symbols was not: it looks like a seventh comparator, and gives no hint that
   it is the one operator needing two values. The dropdown says so in words.

   `in` gets the same treatment for the same reason, and its log symbol is "one
   of" rather than "in" so the two set operators stay apart in a log line: a
   range prints `gpa in [5 .. 7]` and a list prints `code one of ["COMP103",
   "SWEN221"]`. Both are membership tests, and the bracket content says which
   kind, but a reader should not have to notice the brackets. */
var OP_LABEL = { between: 'in range', in: 'is one of', matches: 'matches' };
function opLabel(o) { return OP_LABEL[o] || OP_SYM[o] || o; }

/* The comparators are one idea, the range is another and the list is a third,
   so the dropdown says that too. A group heading is the cheapest way to make an
   option findable by someone who does not already know it is there, and the
   field selector above already groups its own options the same way, so the
   pattern is not new.

   Below three options there is nothing worth separating, and two headings over
   one option each read as clutter rather than as structure, so a short list
   stays flat. */
function opGroups(ops) {
  var cmp = ops.filter(function(o){ return o !== 'between' && o !== 'in'; });
  var rng = ops.filter(function(o){ return o === 'between'; });
  var lst = ops.filter(function(o){ return o === 'in'; });
  return [{ label:'Compare', ops:cmp }, { label:'Range', ops:rng },
          { label:'List', ops:lst }]
    .filter(function(g){ return g.ops.length; });
}

/* THE LIST OPERATOR
   `in` is the disjunction this tool had no way to express. Criteria are ANDed
   and there is no OR between them, so "took COMP103 or SWEN221" could only be
   built as one filtered branch per course merged back together: nine nodes to
   ask one question. Within a single field that OR is exactly set membership,
   and set membership is one operator rather than a second way of wiring.

   It is deliberately not a general OR. Criteria stay ANDed, so a filter reads
   as a conjunction of conditions and each condition may name several values.
   "Took one of these three courses AND is in their second year" is the shape
   people actually ask for; arbitrary boolean nesting in a side panel is not. */
var NUM_OPS  = ['gt','gte','lt','lte','eq','ne','between','in'];
var ENUM_OPS = ['eq','ne','in'];
/* An ordered category (a year, a letter grade) compares the same way a number
   does once its values are ranked, so it gets the range operator too. It does
   not get < and >, which would read as arithmetic on something that is not a
   number. */
var ORDERED_OPS = ['eq','ne','between','in'];
/* A mark in one named course is a threshold on a number, and a list of grade
   points is not a question anyone asks of it ("scored exactly 5, 7 or 8"), so
   this one field keeps the comparator set it had. Without a set of its own it
   would inherit `in` from NUM_OPS and offer an operator the engine does not
   implement for it, which is the worst kind of dead control: it looks like an
   answer. */
var MARK_OPS = ['gt','gte','lt','lte','eq','ne','between'];
/* "Took subject" and "Took course" had no operator control at all, because
   there was only ever one thing to say. There are now two, and the list is the
   reason this whole operator exists, so these two fields gain the select.
   Negation is not offered: "did not take COMP103" is a defensible question but
   a different one from the two here, and it can be added the day it is asked
   for rather than guessed at now. */
var CODE_OPS = ['eq','matches','in'];

/* THE PATTERN OPERATOR
   ---------------------------------------------------------------------------
   The supervisor's last note: "using 'SWEN*' for 'course' would select the
   subject 'SWEN' and using '*4..' would select 400-level courses", and the
   point behind it, that patterns "would result in fewer filter nodes being
   required". They do more than that. Took subject and Took level exist because
   a course code has a subject and a level buried in it and no other way to ask
   about either; one pattern over the code reaches both, so the two convenience
   fields become a convenience rather than the only route.

   WILDCARDS RATHER THAN REGULAR EXPRESSIONS, which is a smaller thing than he
   asked for and deliberate. His own first example is already a wildcard, and he
   observed that academics reach for that form first. The other two translate by
   one character: '*4..' is '*4??' and 'SWEN3..' is 'SWEN3??'.

   What that buys is that there is no such thing as an invalid pattern here. A
   user typing a bracket or a backslash gets a search for a bracket or a
   backslash, not a syntax error in a language nobody said they were writing,
   and the compiled pattern contains no construct that can backtrack. Full
   regular expressions are this function with the escaping removed, on the day
   somebody wants them.

   Anchored, because "SWEN" as a pattern means the code SWEN and not every code
   containing it. Case-insensitive, because a course code is written in capitals
   and typing it in lower case is not a different question. */
function globToRegExp(pattern) {
  var p = String(pattern), out = '';
  for (var i = 0; i < p.length; i++) {
    var ch = p.charAt(i);
    // The two wildcards are read BEFORE escaping, so everything reaching the
    // escape is a literal. Nothing a user types can become syntax.
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$', 'i');
}

/* WHICH COLUMNS CAN CARRY A RANGE
   A range needs a meaningful order, and "has a declared list of values" is not
   the same thing as "is ordered". Sort treats any ENUM's declared values as an
   order, which is defensible there. Some order beats lexical order, and the
   user can see the result. A range is a claim: "between Cybersecurity and Data
   Science" would look like a question and mean nothing, because the order it
   ranges over is the order somebody happened to type the list in.

   So a range is offered where the order is real:
     - a number, which is ordered by being a number;
     - a column with an explicit `order`, which is a deliberate statement about
       ranking (letterGrade declares GRADE_ORDER, best to worst);
     - an ENUM whose values are all numeric, which is how Year arrives. The
       supervisor's use cases group by year ranges, and Year is an ENUM because
       its values are a small fixed set, not because they are unordered.

   Gender and Specialisation therefore have no range, and gain one the day
   somebody declares what their order means. */
function numericValues(vals) {
  return !!(vals && vals.length) && vals.every(function(v) {
    return v !== '' && v !== null && isFinite(Number(v));
  });
}

function isRangeable(col) {
  if (!col) return false;
  if (col.type === COLTYPE.NUMBER) return true;
  if (col.order && col.order.length) return true;
  return col.type === COLTYPE.ENUM && numericValues(col.values);
}

/* A cell to a position on that order, so one comparison serves all three cases.
   Numbers rank as themselves; a declared order ranks by index. A value absent
   from a declared order has no position, so it cannot be inside any band. The
   same reading comparatorFor() takes, where an undeclared value sorts last. */
function rankerFor(col) {
  if (col && col.order && col.order.length) {
    var rank = {};
    col.order.forEach(function(v, i){ rank[String(v)] = i; });
    return function(v) {
      var r = rank[String(v)];
      return r === undefined ? null : r;
    };
  }
  return function(v) {
    /* Blank first, because Number('') is 0. Without this an upper bound the
       user had cleared ranked as zero rather than as missing, the bounds were
       then put "the right way round", and "between 70 and (nothing)" quietly
       became "between 0 and 70": A different question, answered confidently,
       with a log line reading "[ .. 70]" as the only clue. */
    if (isBlank(v)) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  };
}

function topoSort() {
  var inDeg = {}, adj = {};
  nodes.forEach(function(n){ inDeg[n.id] = 0; adj[n.id] = []; });
  connections.forEach(function(c) {
    if (!adj[c.from] || inDeg[c.to] === undefined) return;
    adj[c.from].push(c.to);
    inDeg[c.to]++;
  });
  var queue = nodes.filter(function(n){ return inDeg[n.id] === 0; }).map(function(n){ return n.id; });
  var order = [];
  while (queue.length) {
    var id = queue.shift();
    order.push(id);
    adj[id].forEach(function(nid){ if (--inDeg[nid] === 0) queue.push(nid); });
  }
  return order.map(findNode).filter(Boolean);
}

/* QUERY LOG: Structured, not pre-baked HTML, so one entry renders as markup
   for the panel and as plain text for a file. Building HTML first and stripping
   tags later loses operators like "<": once concatenated they are
   indistinguishable from markup. */
function logEntry(kw, parts) { return { kw:kw, parts:parts }; }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function logHTML(e) {
  return '<span class="kw">' + esc(e.kw) + '</span>  ' + e.parts.map(function(p) {
    return p.c ? '<span class="' + p.c + '">' + esc(p.s) + '</span>' : esc(p.s);
  }).join(' ');
}
function logText(e) {
  return e.kw + '  ' + e.parts.map(function(p){ return p.s; }).join(' ');
}

/* WHAT A ROW IS, CHOSEN ON THE SOURCE
   ---------------------------------------------------------------------------
   This setting existed once and was removed. The removal note is still in
   applyProject() below and it is worth reading before touching this, because
   the objection was never to the feature: it was that "a granularity switch
   hidden in a dropdown made 'count students' wrong by a factor of eight with
   nothing on screen to say so."

   The supervisor asked for it back by email on 2026-09-24, having found the
   nesting unexpected and wanting the choice: "I think it should be possible to
   select whether a Source node performs this transformation or not."

   Both are right, so what comes back is the switch WITHOUT the hiding. Four
   things say which grain a Source is emitting, and the first two are on screen
   before the panel is even opened:

     1. the node on the canvas carries the words "one row per enrolment"
        whenever it is not emitting students (shapeHTML);
     2. the panel states the multiplication, the way Project's panel does;
     3. the query log records it as its own step, with the row counts either
        side, so a count that looks eight times too large has an explanation a
        line above it;
     4. the header changes, and `id` becomes `Student`, which is the same
        rename Project makes and for the same reason.

   The unfold itself is applyProject(), called rather than reimplemented. Two
   copies of this transformation would be two things to keep in step, and the
   comment on projectColumns() already explains what happens when a row builder
   and the column list it claims to produce are allowed to drift. */
/* The label is the whole of what each option says. A parenthetical gloss was
   tried and removed: it pushed the option past the width of the select and was
   cut mid-word, and the hint under the control already says the same thing in
   this Source's own row counts, which is the better place for it. The shape on
   the canvas lowercases the same string rather than keeping a second copy. */
var SOURCE_GRAINS = [
  { key:'student',   label:'One row per student'   },
  { key:'enrolment', label:'One row per enrolment' }
];

/* The object, not the key, matching aggOp() and combineMode(). Anything
   unrecognised, including a hand-edited file, falls back to the first, which is
   the grain every existing saved query was built against. */
function sourceGrain(node) {
  var g = node && node.cfg ? node.cfg.grain : null;
  for (var i = 0; i < SOURCE_GRAINS.length; i++) {
    if (SOURCE_GRAINS[i].key === g) return SOURCE_GRAINS[i];
  }
  return SOURCE_GRAINS[0];
}

/* SOURCE
   Reads THIS node's dataset, not a global one. A Source with no files is not an
   empty result but an error: an empty table would travel down the graph and
   come out as "0 students", which is a claim about the cohort rather than about
   the tool, and the two are not the same answer.

   The log names the files as well as the population, because a query that was
   run against last year's export and one run against this year's are different
   queries with the same graph, and the log is the record of what was run. */
function sourceTable(node, log) {
  var cfg = node.cfg || defaultCfg('source');
  var data = datasetFor(node);
  if (!data) return { error: sourceDataError(node) };

  /* A table Source is the whole of the other shape: the rows as the file has
     them, under the columns the header named. Population and grain are not
     skipped here so much as absent, because both are facts about students and
     this table has none. The panel does not offer them either, for the same
     reason, so there is no setting being quietly ignored. */
  if (isTableDataset(data)) {
    log.push(logEntry('SOURCE', [
      {c:'val', s:data.files[0] ? data.files[0].name : 'a table'},
      {c:'op', s:'->'},
      {c:'val', s:data.rows.length}, {s:(data.rows.length === 1 ? 'row' : 'rows')},
      {s:'of'}, {c:'val', s:data.columns.length},
      {s:(data.columns.length === 1 ? 'column' : 'columns')}
    ]));
    // Copied, because a node downstream that sorts in place would otherwise
    // reorder the Source's own held rows and change what a re-run reports.
    return { table: makeTable(data.columns, data.rows.map(function(r){ return r.slice(); })) };
  }

  var pop = cfg.pop || 'all';
  var list = data.students;
  if (pop !== 'all') {
    var yr = parseInt(pop, 10);
    list = list.filter(function(s){ return s.year === yr; });
    log.push(logEntry('SOURCE', [{s:'year'}, {c:'op', s:'='}, {c:'val', s:yr}]));
  } else {
    log.push(logEntry('SOURCE', [{s:'all_students'}]));
  }
  if (data.files && data.files.length) {
    log.push(logEntry('FROM', data.files.map(function(f, i) {
      return { c:'val', s: f.name + (i === data.files.length - 1 ? '' : ',') };
    })));
  }

  /* Population first, then the unfold. The order is the meaning: "the 2022
     cohort, one row per enrolment" is the 2022 STUDENTS' enrolments, and
     filtering after the unfold would be filtering enrolments by the year on the
     row, which is the same answer here only because every enrolment carries its
     student's year. Doing it in the order the sentence reads keeps it the same
     answer when that stops being true. */
  var t = studentsTable(list);
  if (sourceGrain(node).key === 'enrolment') t = applyProject(node, t, log, 'ROWS');
  return { table: t };
}

/* Why this Source cannot run, in the terms the user is in a position to act on.
   A query loaded from a file knows which files it wants and says so; one built
   from scratch does not, and asking for "the data files" is as specific as it
   can honestly be. */
function sourceDataError(node) {
  var want = node.cfg && node.cfg.dataset;
  var named = want && want.headers && want.years && want.years.length
    ? ' This query was built against ' + want.headers + ' and ' +
      want.years.map(function(y){ return 'mcs-students-' + y; }).join(', ') + '.'
    : '';
  return 'Source #' + node.id + ' has no data. Open its panel and load ' +
    DATA_HEADERS_NAME + ', then the year files.' + named;
}

/* ROW IDENTITY AND UNION
   schemaKey and rowKey say when two tables have the same shape and when two
   rows are the same thing. Identity is per-granularity: two branches that both
   contain student 1042 hold one student, not two.

   unionTables is no longer on the evaluation path. It was the implicit merge
   (several wires into one node, silently deduplicated), and input ports removed
   the situation that called it: an ordinary node takes one table, and a node
   that takes several is a Combine, which decides its own semantics. It is kept
   because the two key functions are shared with Combine's dedupe option and
   because the deduplicating union is still a meaningful operation to have
   available; nothing calls it today. */
function schemaKey(t) { return t.columns.map(function(c){ return c.key; }).join('|'); }

function rowKey(t, row) {
  if (hasCol(t, 'id')) return 'i' + cellAt(t, row, 'id');
  if (hasCol(t, 'studentId') && hasCol(t, 'code')) {
    return 'e' + cellAt(t, row, 'studentId') + ':' + cellAt(t, row, 'code');
  }
  return 'r' + row.join('\u0001');
}

function unionTables(tables) {
  if (tables.length === 0) return makeTable(STUDENT_COLUMNS, []);
  if (tables.length === 1) return tables[0];
  var first = schemaKey(tables[0]);
  for (var i = 1; i < tables.length; i++) {
    if (schemaKey(tables[i]) !== first) {
      // Sources are all one shape now, so a mismatch here means the branches
      // were reshaped on the way down: By an Aggregate, or a Unique in
      // single-column mode. Name that rather than the Source.
      return { error: 'Merged inputs have different columns. The branches were ' +
        'reshaped differently on their way here. Make them match before merging, ' +
        'or give them separate Outputs.' };
    }
  }
  var seen = {}, rows = [];
  tables.forEach(function(t) {
    t.rows.forEach(function(r) {
      var k = rowKey(t, r);
      if (!seen[k]) { seen[k] = true; rows.push(r); }
    });
  });
  return makeTable(tables[0].columns, rows);
}

/* FILTER
   The available fields come from the incoming table's own columns, so a Filter
   wired behind an enrolment Source offers Mark and Course while the same node
   behind a student Source offers Avg and Specialisation. Nothing about student
   records is hardcoded here. */
function courseFields() {
  return [
    // Named for what they do to a ROW, not for the field they inspect. On a
    // student table these keep whole students. A student who took one SWEN
    // course is kept with all eight of their enrolments intact. Calling this
    // "Course subject" invited it to be read as "keep only SWEN enrolments",
    // which is what the same filter does at enrolment granularity.
    { key:'courses.subject', label:'Took subject',   kind:'courseSubject' },
    { key:'courses.code',    label:'Took course',    kind:'courseCode' },
    /* Named the same way, and a NUMBER rather than a set, so the operators come
       with it: "took a course at level 400" is the equality case, and "at 300
       or above" (the progression question) is the one that needed the
       ordering. Without this, asking it at student granularity means a Project
       first, which changes what a row is and therefore what a count counts. */
    { key:'courses.level',   label:'Took level',     kind:'courseLevel' },
    { key:'courses.gradePoints', label:'Grade in course', kind:'courseGrade' }
  ];
}

/* A column can opt out of being filterable with `filter: false`. Year used to:
   the Source already scopes the population by year, and offering it twice
   invited a graph that says 2022 in one place and 2023 in another.

   That reasoning no longer holds. Grouping by a column means filtering on it
   once per label ("how many in 2022, how many in 2023" is a filter for each
   year), so a column that cannot be filtered cannot be grouped on either. Year
   is the column four of the supervisor's use cases group by: enrolment trend
   for a course, average enrolment over several years, historical enrolment for
   a major, and grade trend for a student. Withholding it from Filter withheld
   it from all of them.

   The double-specification worry is answered by precedence rather than by
   removal: the Source's year setting scopes the population and a Filter narrows
   what the Source produced, so a graph saying 2022 at the Source and 2023 at a
   Filter yields nothing, which is the honest answer to a contradictory query,
   and visible in the log, where both entries appear in order.

   The opt-out itself stays. It is a property of a column rather than a rule
   about years, and the next column that has no sensible filter (a nested or
   derived one) declares it without any code changing. Nothing declares it
   today. */
function filterFields(schema) {
  var out = [];
  schema.columns.forEach(function(c) {
    if (c.filter === false) {
      return;
    }
    if (c.type === COLTYPE.COURSES) {
      out.push.apply(out, courseFields());
    } else {
      out.push({ key:c.key, label:c.label, kind:c.type, column:c });
    }
  });
  return out;
}

function fieldByKey(schema, key) {
  var fs = filterFields(schema);
  for (var i = 0; i < fs.length; i++) if (fs[i].key === key) return fs[i];
  return null;
}

function opsFor(kind, col) {
  // The two fields that reach inside the nested column by name. One operator
  // until the list arrived, two now, and neither of the numeric sets fits.
  if (kind === 'courseSubject' || kind === 'courseCode') return CODE_OPS;
  if (kind === 'courseGrade') return MARK_OPS;
  if (kind === COLTYPE.NUMBER || kind === 'courseLevel') return NUM_OPS;
  // Passed the column where there is one, because whether a category can carry
  // a range is a property of that column rather than of its type.
  if (isRangeable(col)) return ORDERED_OPS;
  return ENUM_OPS;
}
function defaultOpFor(kind) {
  if (kind === COLTYPE.NUMBER || kind === 'courseGrade') return 'gt';
  // Levels are a handful of small integers, so the common question is "did they
  // take one at THIS level" rather than "above it". The ordering is there when
  // it is wanted, but equality is the honest default.
  if (kind === 'courseLevel') return 'eq';
  return 'eq';
}

function applyFilter(node, t, log) {
  var crits = (node.cfg && node.cfg.criteria) || [];

  for (var ci = 0; ci < crits.length; ci++) {
    var c = crits[ci];
    var f = fieldByKey(t, c.field);

    // A criterion can outlive the column it referred to: Rewiring a Filter from
    // a student Source to an enrolment one is enough. Skipping with a note is
    // better than erroring: the rest of the query still runs and the log says
    // exactly what was ignored.
    if (!f) {
      log.push(logEntry('SKIP', [{s:'no column'}, {c:'val', s:'"'+(c.field||'?')+'"'}]));
      continue;
    }

    var res = applyCriterion(t, c, f, log);
    if (res.error) return res;
    t = res.table;
  }
  return { table: t };
}

/* A chosen list into something a row can be tested against.

   Membership is decided on the STRING form of a value, for the reason OP_FNS.eq
   is a deliberate `==`: '2022' arriving from a control has to match 2022 in a
   cell. Numbers are put through Number() first so that 7.50 typed by hand
   matches a stored 7.5, which string comparison alone would miss; a number
   column is the only place that coercion is safe, and the only place it is
   needed.

   An entry that is not a number on a number column cannot match anything, so it
   is dropped and counted rather than silently kept. The count is returned, not
   discarded: a list quietly matching on four of its five values is exactly the
   failure that produces a plausible wrong answer. */
function listMatcher(values, numeric) {
  var set = {}, kept = 0, dropped = 0;
  values.forEach(function(v) {
    if (numeric) {
      var n = Number(v);
      if (v === '' || v === null || !isFinite(n)) { dropped++; return; }
      set['k' + String(n)] = true;
    } else {
      set['k' + String(v)] = true;
    }
    kept++;
  });
  return {
    kept: kept,
    dropped: dropped,
    has: function(cell) {
      if (cell === null || cell === undefined) return false;
      if (!numeric) return set['k' + String(cell)] === true;
      var n = Number(cell);
      return isFinite(n) && set['k' + String(n)] === true;
    }
  };
}

// The list as the log should print it: quoted, comma separated, and truncated
// once it is long enough that printing it in full would bury the line it is on.
function listLog(values) {
  var head = values.slice(0, 6).map(function(v){ return '"' + v + '"'; }).join(', ');
  return '[' + head + (values.length > 6 ? ', +' + (values.length - 6) + ' more' : '') + ']';
}

function applyCriterion(t, c, f, log) {
  var coursesIdx = coursesColIndex(t);

  if (f.kind === 'courseSubject' || f.kind === 'courseCode') {
    if (coursesIdx === -1) return { table: t };
    var prop = f.kind === 'courseSubject' ? 'subject' : 'code';
    var cop = critOp(c, f.key, 'eq');

    /* THE DISJUNCTION THIS NODE EXISTS FOR.
       At student granularity "took one of these" is "took this OR took that",
       because a student holds every enrolment they made and any one of them can
       satisfy the test. That is the same `some()` the single-value case uses,
       asked of a set instead of a value, which is why the OR needs no new
       machinery: it was already inside the nested column.

       After a Project the same question is asked of `code` as an ordinary
       column, and there it means "this enrolment is one of these". Both
       readings are right for their granularity, and the field names say which
       one is in play: "Took course" keeps students, `Course` keeps enrolments. */
    if (cop === 'in') {
      var wanted = critList(c, f.key, null);
      if (!wanted.length) {
        return { error: (f.kind === 'courseSubject' ? 'Took subject' : 'Took course') +
          ' is set to "is one of" with nothing chosen. Tick at least one.' };
      }
      var m = listMatcher(wanted, false);
      var mrows2 = t.rows.filter(function(r) {
        return (r[coursesIdx] || []).some(function(e){ return m.has(e[prop]); });
      });
      log.push(logEntry('FILTER', [
        {s:'student'}, {c:'op', s:'took one of'},
        {s: prop === 'subject' ? 'subjects' : 'courses'},
        {c:'val', s: listLog(wanted)}
      ]));
      return { table: makeTable(t.columns, mrows2) };
    }

    /* One pattern, asked of every enrolment the student holds. The same
       some() the single-value case uses and the list case uses: at student
       granularity "took a course matching this" is a disjunction over their
       enrolments, and that was already inside the nested column. */
    if (cop === 'matches') {
      var pat = String(critValue(c, f.key, null) || '').trim();
      if (!pat) {
        return { error: (f.kind === 'courseSubject' ? 'Took subject' : 'Took course') +
          ' is set to "matches" with no pattern. Type one, such as SWEN* or *4??.' };
      }
      var re = globToRegExp(pat);
      var prows = t.rows.filter(function(r) {
        return (r[coursesIdx] || []).some(function(e){ return re.test(String(e[prop])); });
      });
      log.push(logEntry('FILTER', [
        {s:'student'}, {c:'op', s:'took'},
        {s: (prop === 'subject' ? 'subject' : 'course') + ' matching'},
        {c:'val', s:'"' + pat + '"'}
      ]));
      return { table: makeTable(t.columns, prows) };
    }

    var want = critValue(c, f.key, null) ||
               (f.kind === 'courseSubject' ? defaultSubject() : defaultCourse());
    var rows = t.rows.filter(function(r) {
      var list = r[coursesIdx] || [];
      return list.some(function(e){ return e[prop] === want; });
    });
    log.push(logEntry('FILTER', [
      {s:'student'}, {c:'op', s:'took'},
      {s: prop === 'subject' ? 'subject' : 'course'}, {c:'val', s:'"'+want+'"'}
    ]));
    return { table: makeTable(t.columns, rows) };
  }

  /* Keeps a STUDENT who took at least one course matching the test, with all
     their enrolments intact. The same row semantics "Took subject" has, and
     the reason these are named for what they do to a row. A student who took a
     100-level and a 400-level course satisfies both "level = 1" and
     "level = 4", because they genuinely did both. */
  if (f.kind === 'courseLevel') {
    if (coursesIdx === -1) return { table: t };
    var lvlCol = { def: String(defaultLevel() || 4) };
    var lop = critOp(c, f.key, 'eq');

    /* Levels are a handful of small integers, so "100 or 200 level" is a list
       rather than a range far more often than it is either. Same reading as the
       equality case: a student who took a 100-level and a 400-level course
       satisfies a list containing either, because they genuinely did both. */
    if (lop === 'in') {
      var lwanted = critList(c, f.key, lvlCol);
      if (!lwanted.length) {
        return { error: 'Took level is set to "is one of" with nothing chosen. Tick at least one.' };
      }
      var lm = listMatcher(lwanted, true);
      if (!lm.kept) return { error: 'Course level must be a number.' };
      var inrows = t.rows.filter(function(r) {
        return (r[coursesIdx] || []).some(function(e) {
          return e.level !== null && e.level !== undefined && lm.has(e.level);
        });
      });
      log.push(logEntry('FILTER', [
        {s:'student'}, {c:'op', s:'took one of levels'}, {c:'val', s: listLog(lwanted)}
      ]));
      if (lm.dropped) {
        log.push(logEntry('SKIP', [{c:'val', s:lm.dropped},
          {s:(lm.dropped === 1 ? 'level is' : 'levels are') + ' not a number and match nothing'}]));
      }
      return { table: makeTable(t.columns, inrows) };
    }

    var lrange = critRange(c, f.key, lvlCol);
    var lfn = OP_FNS[lop] || OP_FNS.eq;

    if (lop === 'between' && (lrange.lo === null || lrange.hi === null)) {
      return { error: 'A level range needs a number at both ends.' };
    }
    if (lop !== 'between' && isNaN(parseFloat(critValue(c, f.key, lvlCol)))) {
      return { error: 'Course level must be a number.' };
    }
    var lwant = parseFloat(critValue(c, f.key, lvlCol));

    var lrows = t.rows.filter(function(r) {
      return (r[coursesIdx] || []).some(function(e) {
        if (e.level === null || e.level === undefined) return false;
        return lop === 'between'
          ? (e.level >= lrange.lo && e.level <= lrange.hi)
          : lfn(e.level, lwant);
      });
    });

    log.push(logEntry('FILTER', lop === 'between'
      ? [{s:'student'}, {c:'op', s:'took'}, {s:'level'},
         {c:'op', s:'between'}, {c:'val', s:lrange.loRaw}, {s:'and'}, {c:'val', s:lrange.hiRaw}]
      : [{s:'student'}, {c:'op', s:'took'}, {s:'level'},
         {c:'op', s:OP_SYM[lop] || lop}, {c:'val', s:lwant}]));
    return { table: makeTable(t.columns, lrows) };
  }

  if (f.kind === 'courseGrade') {
    // Two conditions in one: enrolled in the course AND the mark passes. A
    // student who never took it is excluded rather than treated as zero, which
    // would silently satisfy every "less than" test.
    if (coursesIdx === -1) return { table: t };
    var code = c.course || defaultCourse();
    var num = parseFloat(critValue(c, f.key, { def:'5' }));
    if (isNaN(num)) return { error: 'Course mark must be a number.' };
    var op = critOp(c, f.key, 'gte');
    var fn = OP_FNS[op] || OP_FNS.gte;
    /* The mark field offers the numeric operators, and `between` is now one of
       them, so the upper bound has to be read here too. Without it the range
       would compare against an undefined ceiling and quietly match nobody.
       The worst way for an unsupported combination to fail, because it looks
       like an answer. */
    var hi = num;
    if (op === 'between') {
      hi = parseFloat(critHigh(c, f.key, { def:'5' }));
      if (isNaN(hi)) return { error: 'Course grade range needs two grade points.' };
      if (hi < num) { var tmp = num; num = hi; hi = tmp; }
    }
    var mrows = t.rows.filter(function(r) {
      var list = r[coursesIdx] || [];
      for (var i = 0; i < list.length; i++) {
        // An ungraded enrolment answers no comparison, not "below", which is
        // what a null coerced to 0 would silently claim.
        if (list[i].code === code) {
          var gp = gradePoint(list[i].letterGrade);
          return gp === null ? false : fn(gp, num, hi);
        }
      }
      return false;
    });
    log.push(logEntry('FILTER', [
      {s:'student'}, {c:'op', s:'took'}, {s: code + '.gradePoints'},
      {c:'op', s:(OP_SYM[op] || '>=')},
      {c:'val', s:(op === 'between' ? '[' + num + ' .. ' + hi + ']' : num)}
    ]));
    return { table: makeTable(t.columns, mrows) };
  }

  var idx = colIndex(t, f.key);
  var col = f.column;
  var opk = critOp(c, f.key, defaultOpFor(f.kind));
  var fnc = OP_FNS[opk] || OP_FNS.eq;
  var raw = critValue(c, f.key, col);

  /* The list, on an ordinary column. Placed before every comparison branch
     because it is not a comparison: there is no single operand to compare
     against, so nothing below this point would know what to do with it, and the
     `OP_FNS[opk] || OP_FNS.eq` fallback above would quietly turn "is one of"
     into "equals the first thing in the list". */
  if (opk === 'in') {
    var chosen = critList(c, f.key, col);
    if (!chosen.length) {
      return { error: col.label + ' is set to "is one of" with nothing chosen. ' +
        (col.values || col.order ? 'Tick at least one value.' : 'Type at least one value.') };
    }
    var lm2 = listMatcher(chosen, col.type === COLTYPE.NUMBER);
    if (!lm2.kept) return { error: col.label + ' list needs at least one number.' };
    var irows = t.rows.filter(function(r){ return lm2.has(r[idx]); });
    log.push(logEntry('FILTER', [
      {s:col.key}, {c:'op', s:'one of'}, {c:'val', s: listLog(chosen)}
    ]));
    if (lm2.dropped) {
      log.push(logEntry('SKIP', [{c:'val', s:lm2.dropped},
        {s:(lm2.dropped === 1 ? 'entry is' : 'entries are') + ' not a number and match nothing'}]));
    }
    return { table: makeTable(t.columns, irows) };
  }

  /* One branch for both kinds of range. rankerFor() turns a cell into a
     position (itself for a number, its index for a declared order), so
     "between 70 and 80" and "between A+ and B" are the same comparison on
     different rankings, rather than two implementations that could disagree
     about whether the ends are included. */
  if (opk === 'between') {
    var rng = critRange(c, f.key, col);
    if (rng.lo === null || rng.hi === null) {
      return { error: col.type === COLTYPE.NUMBER
        ? col.label + ' range needs two numbers.'
        : col.label + ' range needs two values from the column.' };
    }
    var rankOf = rankerFor(col);
    var brows = t.rows.filter(function(r) {
      // A value with no position cannot be inside any band. For a declared
      // order that means a value nobody declared, which is the same reading
      // comparatorFor() takes when it sorts such a value last.
      var v = rankOf(r[idx]);
      return v !== null && fnc(v, rng.lo, rng.hi);
    });
    log.push(logEntry('FILTER', [
      {s:col.key}, {c:'op', s:'in'},
      {c:'val', s:'[' + rng.loRaw + ' .. ' + rng.hiRaw + ']'}
    ]));
    return { table: makeTable(t.columns, brows) };
  }

  if (col.type === COLTYPE.NUMBER) {
    var n = parseFloat(raw);
    if (isNaN(n)) return { error: col.label + ' value must be a number.' };
    var nrows = t.rows.filter(function(r){ return fnc(Number(r[idx]), n); });
    log.push(logEntry('FILTER', [
      {s:col.key}, {c:'op', s:(OP_SYM[opk]||'>')}, {c:'val', s:n}
    ]));
    return { table: makeTable(t.columns, nrows) };
  }

  var out = t.rows.filter(function(r){ return fnc(String(r[idx]), String(raw)); });
  log.push(logEntry('FILTER', [
    {s:col.key}, {c:'op', s:(OP_SYM[opk]||'=')}, {c:'val', s:'"'+raw+'"'}
  ]));
  return { table: makeTable(t.columns, out) };
}

