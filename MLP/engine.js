/* ============================================================================
   ENGINE: Evaluation, the nodes that transform a Table, and their specs
   ============================================================================
   The query engine and every operation it dispatches to: Compare, Unique,
   Select, Project, Output, Aggregation, Combine, then the node specifications
   that describe them to the editor. Zero DOM references, by rule now rather
   than by habit: if a function in this file needs an element, it is in the
   wrong file.
   ============================================================================
   Part of the query builder. LOAD ORDER MATTERS: data.js, engine.js, ui.js.
   See querybuilder_MMP.html. These are deliberately NOT ES modules; the tool is
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
  return { table: studentsTable(list) };
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

/* ============================================================================
   COMPARE
   ============================================================================
   NOTE: superseded by the planned SelectFor / Histogram node. Compare is a
   group-by whose groups are wired by hand. The user builds each branch as a
   separate Filter chain instead of naming a column to split on. It is kept
   working here so the table refactor changes no behaviour, but new work should
   go into SelectFor rather than into extending this.                          */

/* SORT
   Reorders rows by one or more columns with a priority, the way Excel's sort
   dialog does: the first key decides, the second breaks its ties, and so on.
   Like Take it is a pure row operation (same columns out as in), so
   computeSchemas() needs no case for it either.

   This is the first node that visibly earns the uniform table model. It sorts
   a student list, an enrolment list and (once Histogram lands) a histogram
   with no knowledge of any of them: it asks the incoming table for its columns
   and their types, and everything else follows from that. */

// COURSES cells hold an array of enrolment objects. There is no defensible
// ordering on "eight courses". By count? by first code?, so the column is
// offered nowhere rather than sorted arbitrarily.
function sortableCols(t) {
  return t.columns.filter(function(c){ return c.type !== COLTYPE.COURSES; });
}

/* Declared order beats lexical order. Specialisation and Year are ENUMs whose
   `values` array is already the order a reader expects, and letterGrade now
   carries an explicit `order` for the same reason: sorted as text, an A+ lands
   between A and A- because '+' precedes '-' in ASCII. Any column may opt in by
   declaring `order`; columns that declare neither fall back to comparison by
   value. */
function ordinalsFor(col) {
  if (col && col.order) return col.order;
  if (col && col.type === COLTYPE.ENUM && col.values) return col.values;
  return null;
}

function isBlank(v) {
  return v === undefined || v === null || v === '' ||
         (typeof v === 'number' && !isFinite(v));
}

/* One comparator per column, built once per sort rather than per comparison. */
function comparatorFor(col) {
  var ord = ordinalsFor(col);
  if (ord) {
    var rank = {};
    ord.forEach(function(v, i){ rank[String(v)] = i; });
    return function(a, b) {
      // A value absent from the declared order sorts after every declared one,
      // then alphabetically among its peers, so a course prefix added to the
      // catalogue without being added to the order still lands somewhere
      // predictable instead of at the front.
      var ra = rank[String(a)], rb = rank[String(b)];
      if (ra === undefined && rb === undefined) return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0);
      if (ra === undefined) return 1;
      if (rb === undefined) return -1;
      return ra - rb;
    };
  }
  if (col && col.type === COLTYPE.NUMBER) {
    return function(a, b){ return Number(a) - Number(b); };
  }
  // numeric:true so SWEN430 precedes SWEN4300, sensitivity:'base' so case does
  // not split otherwise-equal values into two groups.
  return function(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric:true, sensitivity:'base' });
  };
}

var SORT_DIRS = ['asc', 'desc'];

// Direction labels follow the column type: "A → Z" is meaningless on a mark and
// "high → low" is meaningless on a name.
function dirLabel(col, dir) {
  if (col && col.type === COLTYPE.NUMBER) return dir === 'desc' ? 'high → low' : 'low → high';
  if (ordinalsFor(col))                   return dir === 'desc' ? 'last → first' : 'first → last';
  return dir === 'desc' ? 'Z → A' : 'A → Z';
}

function newSortKey() { return { col:'', dir:'asc' }; }

/* Resolve the configured keys against a table. A key naming a column that is
   no longer there (rewire a Source from students to enrolments and 'gpa'
   simply stops existing) is reported rather than silently dropped, because a
   sort that quietly stopped happening looks identical to one that ran. */
function resolveSortKeys(node, t) {
  var cfg = (node && node.cfg) || defaultCfg('sort');
  var avail = sortableCols(t);
  var out = [];
  (cfg.keys || []).forEach(function(k) {
    var key = k && k.col;
    if (!key) { if (avail.length) out.push({ col:avail[0], dir:(k && k.dir) || 'asc' }); return; }
    var col = colByKey(t, key);
    if (!col || col.type === COLTYPE.COURSES) { out.push({ missing:key }); return; }
    out.push({ col:col, dir:(k.dir === 'desc' ? 'desc' : 'asc') });
  });
  return out;
}

/* Compares two decorated rows {row, i} against a plan of resolved keys. Pulled
   out of applySort so the tie rule is a testable function rather than a
   property of whichever engine runs Array.sort. */
function sortRowComparator(plan) {
  return function(A, B) {
    for (var p = 0; p < plan.length; p++) {
      var a = A.row[plan[p].idx], b = B.row[plan[p].idx];
      // Blanks sink to the bottom under both directions. Reversing a sort
      // should not drag empty cells to the top of the report.
      var ba = isBlank(a), bb = isBlank(b);
      if (ba || bb) { if (ba && bb) continue; return ba ? 1 : -1; }
      var c = plan[p].cmp(a, b);
      if (c) return c * plan[p].sign;
    }
    return A.i - B.i;   // fully tied: arrival order decides
  };
}

function applySort(node, t, log) {
  var keys = resolveSortKeys(node, t);
  var missing = keys.filter(function(k){ return k.missing; });
  var live    = keys.filter(function(k){ return k.col; });

  missing.forEach(function(k) {
    log.push(logEntry('SORT', [{s:'skipped'}, {c:'val', s:k.missing},
                               {s:'(not a column in this table)'}]));
  });
  if (!live.length) return t;

  log.push(logEntry('SORT', live.reduce(function(parts, k, i) {
    if (i) parts.push({s:'then'});
    parts.push({c:'val', s:k.col.label}, {s:dirLabel(k.col, k.dir)});
    return parts;
  }, [])));

  var plan = live.map(function(k) {
    return { idx: colIndex(t, k.col.key), cmp: comparatorFor(k.col), sign: k.dir === 'desc' ? -1 : 1 };
  });

  /* Decorated with the arrival position and compared on it last. Array.sort is
     specified stable since ES2019, but relying on that would make the tie
     behaviour a property of the engine rather than of this node, and ties are
     the normal case here, not the edge case (sorting 80 students by Year gives
     two groups of forty). The comparator is extracted so a test can assert the
     tiebreak directly: an engine that is already stable hides the difference,
     so exercising it through sort() alone would prove nothing. */
  var cmpRows = sortRowComparator(plan);
  var decorated = t.rows.map(function(row, i){ return { row:row, i:i }; });
  decorated.sort(cmpRows);

  /* A new rows array, never an in-place sort. One node's result object is read
     by every node wired downstream of it, so sorting t.rows in place would
     reorder a sibling branch's data as a side effect, and the bug would only
     appear on graphs that fork. */
  return makeTable(t.columns, decorated.map(function(d){ return d.row; }), t.meta);
}

/* REVERSE
   Flips row order. Its reason for existing is Take: Take deliberately keeps the
   FIRST N rows and does not rank, so "the last N" and "the bottom 10" had no
   expression at all. Sort, Reverse, Take says it in three nodes that each do
   one thing, rather than growing Take a direction setting that would duplicate
   what Sort already decides.

   Sort with the direction flipped covers most of the same ground, but not all
   of it: reversing needs no column, so it works on a table whose order came
   from somewhere other than a sort. The order rows arrived from a Combine, or
   the order a Compare's branches were wired in. Those have no key to sort on.

   Like Take it is a pure row operation: no column is added, removed, renamed or
   retyped, so the outgoing header is the incoming header and the schema pass
   needs nothing but passthroughSchema.

   meta is carried through for the same reason Sort and Take carry it. The rows
   are the same rows in a different order, so whatever a producer upstream
   recorded about them is still true.                                          */
function applyReverse(node, t, log) {
  var n = t.rows.length;
  log.push(logEntry('REVERSE', n
    ? [{s:'row order of'}, {c:'val', s:n}, {s:'rows'}]
    : [{s:'no rows to reverse'}]));
  /* slice() first: reverse() is in place, and one node's result object is read
     by every node wired downstream of it, so reversing t.rows directly would
     reorder a sibling branch's data as a side effect. Sort guards the same way
     and for the same reason. The bug would only show up on graphs that fork. */
  return makeTable(t.columns, t.rows.slice().reverse(), t.meta);
}

/* TAKE
   Keeps the first N rows and discards the rest. It is the whole node: no
   column is added, removed, renamed or retyped, so the outgoing header is the
   incoming header and computeSchemas() needs no case for it.

   Deliberately not a sort. "Top 10 by mark" is Sort then Take, two nodes doing
   one thing each, which is why the supervisor asked for Take as its own node
   rather than a Top-N that quietly sorts on your behalf. Behind an unsorted
   input this returns the first ten rows in whatever order they arrived, which
   is a legitimate thing to want (a sample to eyeball) and is stated in the
   panel so it cannot be mistaken for a ranking.

   N is stored as typed, never parsed on write. A number input yields '' while
   the field is mid-edit and '1e3' if pasted; coercing on write would have to
   pick a number for text the user has not finished typing, and would then feed
   that guess back into the control. Coercion happens once, on read. */
var TAKE_DEFAULT = 10;
var TAKE_MIN = 1;

function takeCount(node) {
  var raw = node && node.cfg ? node.cfg.n : undefined;
  var n = parseInt(raw, 10);
  // Blank, non-numeric or out of range all fall back rather than throwing: a
  // half-typed field must not break a Run, and a saved file written by hand
  // must not be able to produce a negative slice.
  if (!isFinite(n) || n < TAKE_MIN) return TAKE_DEFAULT;
  return Math.floor(n);
}

function applyTake(node, t, log) {
  var n = takeCount(node);
  var before = t.rows.length;

  // Log what actually happened, not what was asked for. "first 10" above a
  // seven-row table reads as a bug in the tool; saying all 7 were kept shows
  // the node ran and the input was simply short.
  log.push(logEntry('TAKE', before <= n
    ? [{s:'first'}, {c:'val', s:n}, {s:'rows (kept all)'}, {c:'val', s:before}]
    : [{s:'first'}, {c:'val', s:n}, {s:'rows of'}, {c:'val', s:before}]));

  if (before <= n) return t;
  // meta is carried through: Take is a row operation and has no opinion about
  // whatever a producer upstream recorded there.
  return makeTable(t.columns, t.rows.slice(0, n), t.meta);
}

/* ============================================================================
   UNIQUE
   ============================================================================
   Removes duplicates. A Reduction in the supervisor's categorisation, sitting
   beside Filter and Take: fewer rows out than in, nothing invented.

   Two modes, and the second is the one his example asks for. "It could be used
   to produce all available course labels from a multiplicity of course grade
   rows" cannot be done by deduplicating whole rows. Every enrolment row
   differs in its mark, so nothing would be removed. Getting course labels means
   reducing to the course column first and then deduplicating that. So:

     all columns:   A row survives if no identical row came before it. The
                    header is untouched.
     one column:    The table is reduced to that column, then deduplicated. The
                    header becomes that one column. This is the label-producing
                    mode, and what makes a list of labels an ordinary table on
                    an ordinary wire rather than a special kind of input.

   Duplicate means equal values, not the same entity. rowKey() deliberately says
   two rows are the same when they share a student id, which is right for
   merging branches and wrong here: Unique is asked what distinct values are
   present, and answering "these two rows are one student" would collapse a
   student's two enrolments into one course label. Comparison is therefore on
   the cells themselves.

   First-seen order is preserved rather than sorted. The node's job is to remove
   duplicates and nothing else; if an order is wanted, Sort is the node that
   provides it, and preserving arrival order means a label list keeps whatever
   order its source imposed, which a declared column order can then carry
   through.                                                                   */

/* Columns offered as the single-column selector. A nested enrolment cell is not
   a label ("all distinct values of Courses" would be a list of arrays), so the
   COURSES type is excluded, the same exclusion Sort makes for its own reason. */
function uniqueCols(t) {
  return t.columns.filter(function(c){ return c.type !== COLTYPE.COURSES; });
}

/* Resolved against the table rather than trusted from the config, so the schema
   pass and the row pass reach the same answer from the same columns. A saved
   query naming a column that a rewired Source no longer produces falls back to
   all-columns mode in both walks, and the row pass says so in the log. */
function uniqueCol(node, t) {
  var key = (node && node.cfg && node.cfg.col) || '';
  if (!key) return null;
  var col = colByKey(t, key);
  if (!col || col.type === COLTYPE.COURSES) return null;
  return col;
}

/* One cell to a comparable string. A nested enrolment list is flattened to its
   course/mark pairs in order, so two students with the same enrolments compare
   equal instead of being distinguished by array identity, which would make
   whole-row Unique silently do nothing on any table carrying a Courses
   column. */
function uniqueCellKey(col, v) {
  if (col && col.type === COLTYPE.COURSES) {
    return (v || []).map(function(e){ return e.code + ':' + e.letterGrade; }).join(',');
  }
  return String(v);
}

function uniqueSchema(node, inSchema) {
  var col = uniqueCol(node, inSchema);
  return col ? makeTable([col], []) : inSchema;
}

function applyUnique(node, t, log) {
  var col = uniqueCol(node, t);
  var wanted = (node && node.cfg && node.cfg.col) || '';
  var before = t.rows.length;

  // Named a column that is not here any more. Said rather than silently
  // widened, because "distinct course codes" quietly becoming "distinct whole
  // rows" returns a plausible table that answers a different question.
  if (wanted && !col) {
    log.push(logEntry('UNIQUE', [{s:'ignored'}, {c:'val', s:wanted},
                                 {s:'(not a column in this table)'}]));
  }

  var cols = col ? [col] : t.columns;
  var idxs = cols.map(function(c){ return colIndex(t, c.key); });

  var seen = {}, rows = [];
  t.rows.forEach(function(r) {
    var k = idxs.map(function(i, n) {
      return uniqueCellKey(cols[n], r[i]);
    }).join('\u0001');
    if (seen[k]) return;
    seen[k] = true;
    rows.push(col ? [r[idxs[0]]] : r);
  });

  log.push(logEntry('UNIQUE', col
    ? [{s:'distinct'}, {c:'val', s:col.label}, {s:'→'},
       {c:'val', s:rows.length}, {s:'of'}, {c:'val', s:before}, {s:'rows'}]
    : [{s:'distinct rows'}, {s:'→'}, {c:'val', s:rows.length},
       {s:'of'}, {c:'val', s:before}]));

  /* meta is carried through in all-columns mode, where the table is the same
     table with fewer rows, and dropped in one-column mode, where it is not:
     a Compare's branch metadata does not describe a single column of labels. */
  return makeTable(cols, rows, col ? {} : t.meta);
}

/* ============================================================================
   SELECT: Choose which columns travel on
   ============================================================================
   Aggregate used to do two things at once: measure a column, and leave that
   column as the only one in the result. Measuring is Aggregate's job. The
   narrowing is not, and bundling them meant there was no way to narrow a table
   without also collapsing it to a single row.

   Select is the narrowing on its own. Rows are untouched (same rows, same
   order, same count), and only the header changes. That makes the two
   composable: Select then Aggregate measures a column of a narrowed table, and
   Select alone answers "just show me these three columns" without summarising
   anything.

   Column order follows the incoming table, not the order the boxes were
   ticked. Choosing columns and ordering them are different questions, and
   ticking order is invisible once the panel is closed. A user who unticks a
   box and ticks it again would otherwise find that column had silently moved to
   the end. If column order is wanted later it should be its own control, where
   it can be seen and changed deliberately.                                    */

/* Resolved against the arriving table rather than trusted from config, the same
   way Aggregate resolves its measure column. A saved key outlives its column
   easily (rewiring the node behind a different branch is enough), and a config
   that names nothing still present falls back to the whole header, so a rewired
   Select passes its data through instead of emptying it. */
function selectedCols(node, t) {
  var saved = (node && node.cfg && Array.isArray(node.cfg.cols)) ? node.cfg.cols : null;
  if (!saved) return t.columns.slice();
  var keep = t.columns.filter(function(c){ return saved.indexOf(c.key) !== -1; });
  return keep.length ? keep : t.columns.slice();
}

function selectSchema(node, inSchema) {
  return makeTable(selectedCols(node, inSchema), []);
}

function applySelect(node, t, log) {
  var keep = selectedCols(node, t);

  if (keep.length === t.columns.length) {
    // Nothing dropped. Return the same table rather than a copy, so meta
    // survives: it describes the rows, and the rows have not changed.
    log.push(logEntry('SELECT', [{s:'all'}, {c:'val', s:keep.length},
                                 {s:'columns (nothing dropped)'}]));
    return t;
  }

  var idx = keep.map(function(c){ return colIndex(t, c.key); });
  var rows = t.rows.map(function(r) {
    return idx.map(function(i){ return r[i]; });
  });

  var dropped = t.columns.length - keep.length;
  log.push(logEntry('SELECT', [{s:'keep'},
    {c:'val', s:keep.map(function(c){ return c.label; }).join(', ')},
    {s:'(' + dropped + ' column' + (dropped === 1 ? '' : 's') + ' dropped)'}]));

  /* meta is dropped even though the rows are unchanged. A Compare's branch
     metadata holds whole branch tables with the old header, so carrying it past
     a narrowing would leave the summary and its branches disagreeing about what
     columns exist. Compare cannot currently feed a Select, so this costs
     nothing today and is correct if that ever changes. */
  return makeTable(keep, rows);
}

var MEASURES = [
  { key:'count',   label:'Students',       head:'Students'  },
  { key:'average', label:'Avg grade',      head:'Avg grade' },
  { key:'share',   label:'Share of total', head:'Share'     }
];
var DEFAULT_MEASURES = ['count', 'average'];

function measuresOf(node) {
  var m = node.cfg && node.cfg.measures;
  // Array.isArray, not a truthy length check: a string has .length, and a
  // loaded file with measures:"count" would silently yield zero columns.
  return Array.isArray(m) ? m : DEFAULT_MEASURES;
}

/* Which column "average" refers to, chosen from the table rather than assumed.
   gpa on a student table, gradePoints on an enrolment table, otherwise the
   first numeric column that is not an identifier. */
function defaultAvgCol(t) {
  if (hasCol(t, 'gpa')) return 'gpa';
  if (hasCol(t, 'gradePoints')) return 'gradePoints';
  var nums = numericCols(t).filter(function(c) {
    return c.key !== 'id' && c.key !== 'studentId' && c.key !== 'points';
  });
  return nums.length ? nums[0].key : '';
}

function meanOf(t, key) {
  if (!key || !hasCol(t, key) || t.rows.length === 0) return 0;
  var i = colIndex(t, key), sum = 0;
  t.rows.forEach(function(r){ sum += Number(r[i]) || 0; });
  return sum / t.rows.length;
}

function stripQuotes(s) { return String(s).replace(/^"|"$/g, ''); }

// A branch's label derived from the query that produced it, so a user who never
// typed one still gets something readable. Filters describe a branch far better
// than its source does, so they win.
function autoLabel(r, idx) {
  var filters = r.log.filter(function(e){ return e.kw === 'FILTER'; });
  if (filters.length) {
    return filters.map(function(e) {
      return e.parts.map(function(p){ return stripQuotes(p.s); }).join(' ');
    }).join(', ');
  }
  var src = r.log.filter(function(e){ return e.kw === 'SOURCE'; })[0];
  if (src) {
    var txt = src.parts.map(function(p){ return stripQuotes(p.s); }).join(' ');
    return txt === 'all_students' ? 'All students' : txt;
  }
  return 'Branch ' + (idx + 1);
}

function compareColumns(keys) {
  return [{ key:'branch', label:'Branch', type:COLTYPE.TEXT }].concat(
    keys.map(function(k) {
      var m = MEASURES.filter(function(x){ return x.key === k; })[0];
      return { key:k, label:(m ? m.head : k), type:COLTYPE.NUMBER };
    })
  );
}

function buildCompare(node, inIds, res, log) {
  var labels = (node.cfg && node.cfg.labels) || {};
  var keys = measuresOf(node).filter(function(k) {
    return MEASURES.some(function(m){ return m.key === k; });
  });

  var branches = [];
  inIds.forEach(function(inId, i) {
    var r = res[inId];
    if (!r) return;
    var manual = labels[inId];
    branches.push({
      id: inId,
      label: (manual && String(manual).trim()) ? String(manual).trim() : autoLabel(r, i),
      table: r.table
    });
  });

  var total = branches.reduce(function(a, b){ return a + b.table.rows.length; }, 0);

  branches.forEach(function(b) {
    var avgKey = defaultAvgCol(b.table);
    b.values = {
      count:   b.table.rows.length,
      average: meanOf(b.table, avgKey),
      share:   total ? (b.table.rows.length / total) * 100 : 0
    };
  });

  var sortBy = (node.cfg && node.cfg.sort) || 'wired';
  if (sortBy === 'label') {
    branches.sort(function(a, b){ return a.label.localeCompare(b.label); });
  } else if (keys.length && (sortBy === 'desc' || sortBy === 'asc')) {
    var dir = sortBy === 'desc' ? -1 : 1;
    branches.sort(function(a, b){ return dir * (a.values[keys[0]] - b.values[keys[0]]); });
  }

  log.push(logEntry('COMPARE', [
    {s: branches.length + (branches.length === 1 ? ' branch' : ' branches')}
  ]));

  // The branch tables ride along in meta so an Output can still show per-branch
  // detail. The table itself is the primary value. Everything downstream can
  // read it without knowing Compare exists.
  return makeTable(
    compareColumns(keys),
    branches.map(function(b) {
      return [b.label].concat(keys.map(function(k) {
        return k === 'share' ? b.values[k] : b.values[k];
      }));
    }),
    { branches: branches, measures: keys }
  );
}

/* ============================================================================
   OUTPUT
   ============================================================================
   Every Output emits a table, including Count. A scalar is a 1x1 table. That
   is what lets one renderer and one CSV writer serve every result shape instead
   of a branch per output type.

   An Output displays a table; it does not compute one. Averaging and per-course
   grouping used to live here as shortcuts, which made the same operation exist
   in two places and hid two of the three steps a breakdown actually performs.
   Both are reachable by wiring an Aggregate in front of the Output, where the
   step is visible on the canvas and appears in the query log like every other.
                                                                               */

var ROW_SHOWS = ['rows', 'count'];
var CMP_SHOWS = ['summary', 'lists'];

/* The nodes that hand an Output a table with per-group detail attached. Both
   emit meta.branches in the same shape, so both can offer the same two views:
   The summary alone, or the summary with each group's rows underneath.

   Asked as a list of TYPES rather than by looking for meta.branches on the
   arriving table, because this is called from the config panel, which runs on
   the schema walk, and headerOnly() drops meta by construction. The list is
   the honest way to ask the question at that point, and it is short.

   Direct inputs only, unchanged. A Compare or a SelectFor reaching an Output
   through a Sort still carries its metadata, and the Output then shows the
   ordinary two views. That is the behaviour that was here before SelectFor,
   and widening it is a separate change from adding a second node to the
   list. */
/* A map rather than a list, because the two nodes want different defaults and
   the difference is a fact about them rather than a special case.

   Compare's branches are hand-wired, so there are two or three of them and
   their rows are what the user built the graph to see: "show me the data"
   means the per-branch lists. A breakdown by course has seventy-eight groups
   and the breakdown table IS the answer. The per-group rows are a drill-down
   nobody opens by default. Defaulting a SelectFor to lists rendered a
   nine-hundred-kilobyte page in under two seconds of solid work, to show
   seventy-eight tables no one asked for. */
var BRANCH_NODES = {
  compare:   'lists',
  selectFor: 'summary'
};

function branchProducer(node) {
  var found = null;
  inputsOf(node.id).forEach(function(id) {
    var up = findNode(id);
    if (!found && up && BRANCH_NODES[up.type]) found = up.type;
  });
  return found;
}

function branchesFeedOutput(node) { return branchProducer(node) !== null; }

// The two sides no longer share a value, so rewiring an Output across a Compare
// always lands on that side's nearest equivalent: rows and per-branch lists both
// mean "show me the data", count and summary both mean "show me the figures".
function normaliseShow(node) {
  var v = node.cfg && node.cfg.show;
  var producer = branchProducer(node);
  if (producer) {
    if (CMP_SHOWS.indexOf(v) !== -1) return v;
    // "rows" means "show me the data", and which of the two views that is
    // depends on what made the branches. "count" means the figures, which is
    // the summary either way.
    return (v === 'rows') ? BRANCH_NODES[producer] : 'summary';
  }
  if (ROW_SHOWS.indexOf(v) !== -1) return v;
  return (v === 'lists') ? 'rows' : 'count';
}

/* COLUMN SELECTION ON AN OUTPUT
   ---------------------------------------------------------------------------
   A deliberate duplication of what Select does, and worth being explicit about
   why, because the Output's other shortcuts were removed for being exactly
   this. Average and the course breakdown were removed because they COMPUTED.
   They hid steps that changed the answer, and hid them somewhere the query log
   could not describe. Choosing which columns to look at changes no answer. It
   is a property of the view, which is what an Output is.

   The supervisor put it as a question: one could always wire a Select in front,
   but so many Outputs would need the pair that the duplication earns its place.
   Both routes stay open, and they compose. A Select upstream narrows what
   arrives, this narrows what is shown of it.

   Applied to the row view alone. A count is a count of rows however many
   columns are on them, and a Compare's summary already has the measure
   checkboxes on the Compare itself; offering a second way to hide those would
   be the duplication that is not worth it. */
function outputCols(node, t) {
  return selectedCols(node, t);
}

function outputTable(node, t) {
  var show = normaliseShow(node);

  if (show === 'count') {
    return makeTable([{ key:'count', label:'Count', type:COLTYPE.NUMBER }],
                     [[t.rows.length]]);
  }
  if (show !== 'rows') return t;   // 'summary' and 'lists' display as they arrive

  var keep = outputCols(node, t);
  if (keep.length === t.columns.length) return t;   // same table, so meta survives

  var idx = keep.map(function(c){ return colIndex(t, c.key); });
  /* meta is dropped for the reason Select drops it: branch tables carry the
     header that arrived, and keeping them past a narrowing would leave the
     summary and its branches disagreeing about what columns exist. */
  return makeTable(keep, t.rows.map(function(r) {
    return idx.map(function(i){ return r[i]; });
  }));
}

/* ============================================================================
   PROJECT: Unfold the nested enrolments into rows of their own
   ============================================================================
   The one node that makes a row mean something different on the way out than it
   meant on the way in. Everywhere else a row is a student; after a Project a row
   is a single enrolment, so one student becomes eight rows and a count counts
   course registrations rather than people.

   That used to be a setting on the Source ("one per student" or "one per
   enrolment"), and it was removed because a granularity switch hidden in a
   dropdown made "count students" wrong by a factor of eight with nothing on
   screen to say so. app.js:238 recorded what should replace it:

     Nothing unfolds nested enrolments into their own rows any more. If that is
     wanted later it should be a node on the canvas, where the change in row
     identity is visible, rather than a setting hidden on the Source.

   This is that node, and "where the change is visible" is its whole design
   brief rather than a nicety:
     - it is a node, so the step appears on the canvas and in the query log;
     - it has its own colour and its own group in the menu, because it is not
       the same kind of operation as the ones that narrow or reorder;
     - it renames `id` to `studentId`, because after the unfold that column no
       longer identifies a row. The same student now owns eight of them;
     - its panel states the multiplication, and says what it does to a count.

   Without it, nothing in the tool can reach a mark or a grade in a particular
   course as a VALUE. Filter can already ask "did this student take SWEN421",
   because it reads inside the nesting, but the mark itself can never become a
   column, so a distribution of grades in one course is unaskable. That is use
   case (f), and (g) on top of it.

   The header is a function of the incoming header alone (the enrolment columns
   are fixed, and which student columns come across is decided by their keys),
   so computeSchemas answers without seeing a single row, and the registry
   invariant holds with no special case.                                        */

/* The columns an enrolment contributes. Fixed, because an enrolment has the
   shape the data file gives it. */
/* Derived from enrolmentColumns() rather than written beside it, so the unfold
   and the header it claims to produce cannot disagree. */
function enrolmentKeys() {
  return enrolmentColumns().map(function(c){ return c.key; });
}

function enrolmentColumns() {
  return [
    { key:'code',        label:'Course',      type:COLTYPE.ENUM,   values:COURSES.map(function(c){ return c.code; }) },
    { key:'name',        label:'Course name', type:COLTYPE.TEXT },
    { key:'subject',     label:'Subject',     type:COLTYPE.ENUM,   values:SUBJECTS },
    /* A number rather than an enum, so it can be averaged, maximised and
       compared. "The highest level this student reached" is an Aggregate over
       this column, and it is the closest thing the archive has to a year of
       study, which is what use cases (h) and (i) have been waiting on. */
    { key:'level',       label:'Level',       type:COLTYPE.NUMBER, def:'4' },
    { key:'points',      label:'Points',      type:COLTYPE.NUMBER, def:'15' },
    { key:'gradePoints', label:'Grade points',type:COLTYPE.NUMBER, def:'5' },
    { key:'letterGrade', label:'Grade',       type:COLTYPE.TEXT,   order:GRADE_ORDER }
  ];
}

/* Whether this node has anything to do. A table with no nested column has
   nothing to unfold, and a Project wired behind an Aggregate is a mistake worth
   reporting rather than an error worth stopping for. The same treatment a
   Filter gives a criterion whose column has gone. */
function canProject(t) { return coursesColIndex(t) !== -1; }

/* Which of the incoming columns survive the unfold, and under what names.

   The nested column itself goes, having become rows. `id` is renamed, because
   after the unfold it identifies a student rather than a row and leaving it
   called "ID" invites exactly the miscount this node exists to make visible.

   A column whose key an enrolment also uses is dropped rather than carried: a
   student row's `letterGrade` is their average grade, an enrolment's is their
   grade in that course, and on a table of enrolments the second is the one the
   name should mean. The log names what was replaced, so nothing vanishes
   quietly. Derived by key rather than from a fixed list, so a column added to
   the Source schema tomorrow is carried without this function changing. */
/* The student columns that survive the unfold: everything that is not the
   nested column itself and does not collide with a column the enrolment is
   about to supply.

   ONE COLLISION EXISTS, and it is worth naming rather than leaving to be
   rediscovered. `letterGrade` is a key on both sides: the student's overall
   grade for the year, and the letter awarded for one course. The enrolment's
   wins, which is right, because after this step a row IS an enrolment and the
   grade that belongs to it is the course's.

   What made that a trap was the display name. Both were called "Grade", so the
   column appeared to continue across the step while quietly changing meaning.
   The student's is now called "Overall grade" and the enrolment's is still
   "Grade", so the substitution is visible in the header rather than implied.

   GPA does NOT collide and so rides along, which is the reason the two are not
   treated alike: after a Project a row carries the student's GPA and the
   course's Grade, and those really are facts about different things. */
function projectCarried(t) {
  var taken = {};
  enrolmentColumns().forEach(function(c){ taken[c.key] = true; });
  return t.columns.filter(function(c) {
    return c.type !== COLTYPE.COURSES && !taken[c.key];
  });
}

function projectColumns(t) {
  return projectCarried(t).map(function(c) {
    // Same column, new name where the name would now mislead.
    return c.key === 'id'
      ? { key:'studentId', label:'Student', type:c.type, def:c.def, values:c.values, filter:c.filter }
      : c;
  }).concat(enrolmentColumns());
}

function projectSchema(node, inSchema) {
  if (!canProject(inSchema)) return inSchema;
  return makeTable(projectColumns(inSchema), []);
}

function applyProject(node, t, log) {
  if (!canProject(t)) {
    log.push(logEntry('PROJECT', [{s:'nothing to expand (no course data on this table)'}]));
    return t;
  }

  var ci = coursesColIndex(t);
  var carry = projectCarried(t);
  var carryIdx = carry.map(function(c){ return colIndex(t, c.key); });
  var cols = projectColumns(t);
  var eKeys = enrolmentKeys();   // hoisted: this is per unfold, not per row

  var rows = [];
  t.rows.forEach(function(r) {
    var prefix = carryIdx.map(function(i){ return r[i]; });
    var list = r[ci] || [];
    list.forEach(function(e) {
      /* Read out of the enrolment BY KEY, in the order enrolmentColumns()
         declares, rather than as a hand-written array in the same order. The
         two were positional and drifted the moment Level was added: every cell
         after Subject shifted, so Grade points held a letter and Grade held
         nothing. Same failure studentsTable() had, same fix. The column list
         is the single statement of what a row holds. */
      rows.push(prefix.concat(eKeys.map(function(k){ return e[k]; })));
    });
  });

  /* The row count is the message. Saying "80 rows -> 640 rows, one per course"
     in the log puts the multiplication in the same place every other step
     reports itself, so a count that looks eight times too large downstream has
     an explanation one line above it. */
  log.push(logEntry('PROJECT', [
    {c:'val', s:t.rows.length}, {s:'rows'}, {c:'op', s:'->'},
    {c:'val', s:rows.length}, {s:'rows, one per course'}
  ]));

  var replaced = t.columns.filter(function(c) {
    return c.type !== COLTYPE.COURSES && carry.indexOf(c) === -1;
  });
  if (replaced.length) {
    log.push(logEntry('PROJECT', [{s:'replaced by course values:'},
      {c:'val', s:replaced.map(function(c){ return c.label; }).join(', ')}]));
  }
  return makeTable(cols, rows);
}

/* ============================================================================
   AGGREGATION
   ============================================================================
   Two nodes, one implementation. Both reduce a set of values to one value; they
   differ only in which set.

     Aggregate         the whole table  ->  a 1x1 table
     AggregateColumns  each column      ->  one row, one value per column

   The names say what survives, not what is destroyed: AggregateColumns keeps
   the columns and collapses the rows beneath them.

   Three decisions apply to both, and are made here rather than per node so the
   two cannot drift apart:

   1. The empty case is blank, not zero. The count of nothing is 0. That is a
      true statement about an empty table. The average, minimum or maximum of
      nothing is not 0; it does not exist. meanOf() returns 0 for an empty
      table, which is why the existing Output card special-cases it and prints
      an em dash. Rather than repeat that trick, these nodes emit null, which
      fmtCell and exportCell already render as empty in both the panel and the
      CSV.

   2. Count means "values that are actually there". On the whole table that is
      the row count; per column it is the number of non-blank cells, which is
      the more useful reading and the one that differs between columns.

   3. A measure that cannot apply to a column yields blank rather than dropping
      the column. Dropping would make the output header depend on the data,
      and matching headers is precisely what Combine will require in order to
      stack two of these results. A header that quietly changes shape when a
      column happens to be non-numeric would break that at the worst moment. */

var AGG_OPS = [
  { key:'count',   label:'Count',   verb:'Count of',   needsCol:false },
  { key:'sum',     label:'Sum',     verb:'Sum of',     needsCol:true  },
  { key:'average', label:'Average', verb:'Average',    needsCol:true  },
  // Next to Average because it answers the same question about the same
  // column, and differs exactly where that matters: a handful of very low
  // marks drags an average down and leaves a median where it was.
  { key:'median',  label:'Median',  verb:'Median',     needsCol:true  },
  { key:'min',     label:'Minimum', verb:'Minimum',    needsCol:true  },
  { key:'max',     label:'Maximum', verb:'Maximum',    needsCol:true  }
];
var AGG_DEFAULT_OP = 'count';

function aggOp(node) {
  var k = node && node.cfg ? node.cfg.op : null;
  for (var i = 0; i < AGG_OPS.length; i++) if (AGG_OPS[i].key === k) return AGG_OPS[i];
  return AGG_OPS[0];   // anything unrecognised, including a hand-edited file
}

// Columns a numeric measure can be applied to. Identifiers are excluded: the
// sum of a set of student IDs is a number, but it is not a fact about anything.
function ID_KEYS() { return { id:1, studentId:1 }; }
function measurableCols(t) {
  var skip = ID_KEYS();
  return numericCols(t).filter(function(c){ return !skip[c.key]; });
}

function isMeasurable(t, col) {
  if (!col || col.type !== COLTYPE.NUMBER) return false;
  return !ID_KEYS()[col.key];
}

/* Reduce a list of raw cell values. Blanks are skipped rather than counted as
   zero. A missing mark is not a mark of nought, and treating it as one drags
   every average down by an amount that depends on how much data is missing. */
function reduceValues(opKey, values) {
  var nums = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (isBlank(v)) continue;
    if (opKey === 'count') { nums.push(1); continue; }
    var n = Number(v);
    if (isFinite(n)) nums.push(n);
  }
  if (opKey === 'count') return nums.length;
  if (!nums.length) return null;              // see decision 1 above
  if (opKey === 'sum')     return nums.reduce(function(a, b){ return a + b; }, 0);
  if (opKey === 'average') return nums.reduce(function(a, b){ return a + b; }, 0) / nums.length;
  if (opKey === 'median') {
    /* Sorted numerically. The default sort is lexical, which puts 100 before
       30 and would pick the wrong middle. An even count averages the two
       middle values rather than picking one, so the median of [1,2,3,4] is
       2.5: taking either alone would claim a value the data does not contain
       is more central than its neighbour. */
    var sorted = nums.slice().sort(function(a, b){ return a - b; });
    var mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  if (opKey === 'min')     return Math.min.apply(null, nums);
  if (opKey === 'max')     return Math.max.apply(null, nums);
  return null;
}

function columnValues(t, key) {
  var i = colIndex(t, key);
  if (i === -1) return [];
  return t.rows.map(function(r){ return r[i]; });
}

/* ---- Aggregate: whole table -> 1x1 ---------------------------------------- */

/* Which column the measure applies to, resolved against the table rather than
   trusted from config. A saved key can outlive its column (rewiring the node
   behind a different branch is enough), so this falls back rather than
   measuring nothing. */
function aggregateCol(node, t) {
  var op = aggOp(node);
  if (!op.needsCol) return null;
  var key = (node && node.cfg && node.cfg.col) || '';
  var col = key ? colByKey(t, key) : null;
  if (col && isMeasurable(t, col)) return col;
  var avail = measurableCols(t);
  return avail.length ? avail[0] : null;
}

// The single column both the schema walk and the engine must agree on. Derived
// in one place so they cannot disagree. The registry invariant depends on it.
function aggregateColumn(node, t) {
  var op = aggOp(node);
  if (!op.needsCol) {
    return { key:'count', label:'Count', type:COLTYPE.NUMBER };
  }
  var col = aggregateCol(node, t);
  return {
    key: op.key,
    label: col ? (op.verb + ' ' + col.label) : op.label,
    type: COLTYPE.NUMBER
  };
}

function aggregateSchema(node, inSchema) {
  return makeTable([aggregateColumn(node, inSchema)], []);
}

function applyAggregate(node, t, log) {
  var op = aggOp(node);
  var outCol = aggregateColumn(node, t);
  var value;

  if (!op.needsCol) {
    value = t.rows.length;
    log.push(logEntry('AGGREGATE', [{s:'count of'}, {c:'val', s:t.rows.length}, {s:'rows'}]));
  } else {
    var col = aggregateCol(node, t);
    if (!col) {
      // No column the measure could apply to. Blank and say so, rather than
      // returning a number that describes nothing.
      log.push(logEntry('AGGREGATE', [{s:op.label.toLowerCase()}, {s:'(no numeric column in this table)'}]));
      return makeTable([outCol], [[null]]);
    }
    value = reduceValues(op.key, columnValues(t, col.key));
    log.push(logEntry('AGGREGATE', [{s:op.label.toLowerCase() + ' of'}, {c:'val', s:col.label},
                                    {s:'over'}, {c:'val', s:t.rows.length}, {s:'rows'}]));
  }
  return makeTable([outCol], [[value]]);
}

/* ---- AggregateColumns: many rows -> one row ------------------------------- */

/* Keys and labels are preserved so the result still reads as the same table.
   That is what makes "run a histogram twice, stack them, total the columns"
   work. Types become NUMBER across the board because every cell is now a
   measure or blank, whatever the column held before. */
function aggregateColumnsSchema(node, inSchema) {
  return makeTable(inSchema.columns.map(function(c) {
    return { key:c.key, label:c.label, type:COLTYPE.NUMBER };
  }), []);
}

function applyAggregateColumns(node, t, log) {
  var op = aggOp(node);
  var out = aggregateColumnsSchema(node, t);

  var skipped = [];
  var row = t.columns.map(function(c) {
    // Count applies to any column: it asks how many values are present, which
    // is a question a text column can answer.
    if (op.key === 'count') {
      return reduceValues('count', columnValues(t, c.key));
    }
    if (!isMeasurable(t, c)) { skipped.push(c.label); return null; }
    return reduceValues(op.key, columnValues(t, c.key));
  });

  log.push(logEntry('AGGREGATE COLUMNS', [{s:op.label.toLowerCase() + ' down'},
                                          {c:'val', s:t.rows.length}, {s:'rows'}]));
  if (skipped.length) {
    log.push(logEntry('AGGREGATE COLUMNS', [{s:'left blank:'}, {c:'val', s:skipped.join(', ')}]));
  }
  return makeTable(out.columns, [row]);
}

/* ---- AggregateRows: one row -> one value, per row ------------------------- */

/* The third member of the family, and the one that runs the other way. Aggregate
   collapses a table to a cell; AggregateColumns collapses each column to a cell
   and emits one row; AggregateRows collapses each ROW to a cell and emits one
   column. Row count is preserved, which is what makes it the counterpart of
   AggregateColumns rather than a second spelling of it:

     AggregateColumns   N rows x M cols  ->  1 row  x M cols   (down each column)
     AggregateRows      N rows x M cols  ->  N rows x 1 col    (across each row)

   THE WHOLE ROW IS REPLACED, not appended to. The settled position is that row
   aggregation assumes a row of measures: totalling a row that still carries a
   student id is not a meaningful operation, so the question of whether the
   answer replaces the row or joins it never arises. Narrowing to the measures
   first is a Select, which is a node that exists, so the composition is
   Select then AggregateRows, and neither node grows a column picker for the
   other's benefit.

   The cost is that a label column goes with everything else: total a histogram
   of one row per year and the years are not in the result. That is the honest
   consequence of the rule above rather than an oversight, and the fix, if it is
   ever wanted, is the general "say which columns are aggregated" approach the
   supervisor described and explicitly deferred. */
function aggregateRowsColumn(node) {
  var op = aggOp(node);
  // No single input column to name, so the measure names itself. Keyed on the
  // op so two of these in series produce distinguishable headers.
  return { key: op.key, label: op.label, type: COLTYPE.NUMBER };
}

function aggregateRowsSchema(node, inSchema) {
  return makeTable([aggregateRowsColumn(node)], []);
}

/* Which cells of a row feed the measure. The same rule AggregateColumns uses,
   applied along the other axis: Count asks how many values are present and any
   column can answer that, while the arithmetic measures take only the columns
   that hold a number and are not an identifier. Resolved once for the table
   rather than per row, since the header does not change between rows. */
function aggregateRowsIdx(node, t) {
  var op = aggOp(node);
  var idx = [];
  t.columns.forEach(function(c, i) {
    if (op.key === 'count' || isMeasurable(t, c)) idx.push(i);
  });
  return idx;
}

function applyAggregateRows(node, t, log) {
  var op = aggOp(node);
  var out = aggregateRowsColumn(node);
  var idx = aggregateRowsIdx(node, t);

  var rows = t.rows.map(function(r) {
    return [reduceValues(op.key, idx.map(function(i){ return r[i]; }))];
  });

  var skipped = t.columns.length - idx.length;
  log.push(logEntry('AGGREGATE ROWS', [{s:op.label.toLowerCase() + ' across'},
                                       {c:'val', s:idx.length},
                                       {s:'column' + (idx.length === 1 ? '' : 's') + ', per row'}]));
  if (skipped > 0) {
    log.push(logEntry('AGGREGATE ROWS', [{s:'ignored'}, {c:'val', s:skipped},
      {s:'non-measure column' + (skipped === 1 ? '' : 's')}]));
  }
  return makeTable([out], rows);
}

/* ============================================================================
   SELECT FOR: A group-by whose groups are named rather than wired
   ============================================================================
   The node Compare was always standing in for. Compare makes the user build one
   Filter chain per group and wire each of them in by hand; this names the
   column to split on and does it once per value.

   Placed here, after the aggregation section, because that is where the parts
   it is assembled from are: AGG_OPS, reduceValues and measurableCols all come
   from Aggregate, and a `var` list built by concatenating one of them has to
   run after it. Reading order agrees with that. A group-by is an aggregation
   with a label, and it is next to the two Branches nodes it shares a menu and
   a colour with.

   The definition it is built from is one already written down, at the top of
   filterFields():

     "Grouping by a column means filtering on it once per label. How many in
      2022, how many in 2023 is a filter for each year."

   Taken literally, that is the whole implementation. A group is the rows a
   Filter would keep for one value, so the matching is applyCriterion's, with
   the value coming from a label instead of from a text box. Nothing here
   reimplements what it means to match: not string versus number comparison,
   not the nested "took this course" test, not the COURSES column at all. That
   is why a node covering four of the supervisor's use cases is this short, and
   why it groups by things that are not columns. "Took course" is a predicate
   Filter already owns, and a predicate is all a group needs.

   TWO PORTS, AND WHY THE SECOND IS OPTIONAL
   `data` is the table being summarised. `labels` is one row per group to
   report on, and leaving it empty means "use the values that are in the data".

   Three things the labels port buys that a column alone cannot:

     1. Zero-count groups survive. Grouping the data by its own values cannot
        produce a row for a course nobody took. The interesting zero is the
        one value that is missing. Wire the 2022 course list into `labels` and
        it comes out as 0.
     2. The groups can come from a different query than the rows. "For each
        course that ran in 2022, how many took it in 2024" is two branches, and
        no single table holds both halves.
     3. The label set can be narrowed, widened or ordered by ordinary nodes.
        A Sort and a Take in front of the labels port is "the ten biggest",
        built out of the same nodes as everything else.

   WHAT COMES OUT
   One row per group: a label column, then one column per measure. That is
   Compare's shape, deliberately. A node meant to replace Compare that emitted
   something else would leave every downstream node with two cases to handle.
   The per-group tables ride in meta.branches in Compare's format too, which is
   what gives the Output its per-group detail cards and the long-form CSV
   export without either of them learning this node exists.

   WHAT IS DELIBERATELY NOT HERE
   No ordering control, though Compare has one. Groups come out in the label
   set's own order (the labels table's row order, or the grouping column's own
   comparator when the values come from the data), and anything else is a Sort.
   Compare's Order setting predates Compare being allowed to feed Sort; an
   in-node copy of a node that is one wire away is the shortcut this tool keeps
   deleting, most recently the Output's Average.                              */

/* The fields it can group by are the fields a Filter can test, minus the one
   that needs a second value to mean anything: "grade in course" is a course
   AND a mark, so a bare label cannot supply it. Everything else follows the
   incoming table, so this node knows nothing about students either. */
function groupFields(t) {
  return filterFields(t).filter(function(f){ return f.kind !== 'courseGrade'; });
}

/* Resolved against the table rather than trusted from the config, the way
   every other node resolves a saved column: rewiring this node behind a
   different branch can outlive the field it was set to, and falling back to a
   real field beats grouping by nothing. Both walks call this, so they cannot
   disagree about what is being grouped. */
function groupField(node, t) {
  var fs = groupFields(t);
  if (!fs.length) return null;
  var key = (node && node.cfg && node.cfg.by) || '';
  for (var i = 0; i < fs.length; i++) if (fs[i].key === key) return fs[i];
  return fs[0];
}

/* The label column. Its key is fixed at 'group' (Compare fixes 'branch' for
   the same reason), so that what a downstream node reaches for does not change
   when the grouping does, and so that it can never collide with a measure key.

   Its TYPE is copied from the column being grouped on, along with any declared
   value set or order. That is what keeps a breakdown by Year sorting 2022,
   2023, 2024 rather than lexically, and what lets a downstream Filter offer
   the same dropdown it would have offered upstream. */
function groupColumn(node, t) {
  var f = groupField(node, t);
  if (!f) return { key:'group', label:'Group', type:COLTYPE.TEXT };
  var src = f.column;
  var col = {
    key:   'group',
    label: f.label,
    type:  src ? src.type : (f.kind === 'courseLevel' ? COLTYPE.NUMBER : COLTYPE.TEXT)
  };
  if (src && src.values) col.values = src.values;
  if (src && src.order)  col.order  = src.order;
  return col;
}

/* The measures, and why they are not Compare's.

   Compare offers a fixed three and guesses which column "average" refers to.
   The guess is the part worth removing: defaultAvgCol() picks gpa, then
   gradePoints, then the first numeric column that is not an identifier, and on
   a table it did not anticipate that is a silent choice presented as a number.
   Here a measure is an operation AND a column, resolved the way Aggregate
   resolves its own, so the header says which column it measured.

   The operation set is AGG_OPS plus one. It is built by concatenation rather
   than by adding an entry to AGG_OPS, because AGG_OPS is what the three
   Aggregate nodes offer and "share of total" is meaningless on a single table.
   A share needs the other groups to be a share OF. */
var SELECTFOR_OPS = AGG_OPS.concat([
  { key:'share', label:'Share of total', verb:'Share of', needsCol:false, head:'Share %' }
]);

function selectForOp(key) {
  for (var i = 0; i < SELECTFOR_OPS.length; i++) {
    if (SELECTFOR_OPS[i].key === key) return SELECTFOR_OPS[i];
  }
  return SELECTFOR_OPS[0];   // count: Anything unrecognised, including a hand-edited file
}

function newStat() { return { op:'count', col:'' }; }

/* A fresh array of fresh objects every time, which measuresOf() does not have
   to do because its default holds strings. These hold objects, and handing the
   same two out to every unconfigured node on the canvas would make one node's
   edit everyone's. */
function defaultStats() { return [newStat()]; }

/* Array.isArray rather than a truthy length check, for the reason measuresOf()
   gives: a string has .length, and a loaded file with stats:"count" would
   otherwise yield one garbage measure per character. */
function statsOf(node) {
  var s = node && node.cfg && node.cfg.stats;
  return (Array.isArray(s) && s.length) ? s : defaultStats();
}

/* Which column one measure applies to. Resolved against the table exactly as
   aggregateCol() does, and against the WHOLE data table rather than a group's
   rows. A per-group resolve could reach different columns in different groups
   and the one header would then be true of neither. */
function statCol(stat, t) {
  var op = selectForOp(stat && stat.op);
  if (!op.needsCol) return null;
  var key = (stat && stat.col) || '';
  var col = key ? colByKey(t, key) : null;
  if (col && isMeasurable(t, col)) return col;
  var avail = measurableCols(t);
  return avail.length ? avail[0] : null;
}

/* The output header, built once and called by both walks. The registry
   invariant for this node is exactly "these two agree", and one function is
   the only way to be sure of it. Reads t.columns and never t.rows, so passing
   a header-only table gives the same answer as passing the real one.

   Duplicate keys are suffixed rather than allowed. Two measures can legitimately
   be the same operation on the same column ("count, count" is a mistake, but
   "average gpa" twice while the second is being retargeted is not), and
   colIndex() answers with the first match, so an unsuffixed duplicate would be
   a column nothing downstream could ever reach. */
function measureColumns(node, t) {
  var seen = { group:true };
  var cols = [];

  statsOf(node).forEach(function(s) {
    var op = selectForOp(s && s.op);
    var col = op.needsCol ? statCol(s, t) : null;
    var base = op.key + (col ? '_' + col.key : '');
    var key = base, n = 2;
    while (seen[key]) { key = base + '_' + n; n++; }
    seen[key] = true;
    cols.push({
      key:   key,
      label: op.needsCol ? (col ? op.verb + ' ' + col.label : op.label) : (op.head || op.label),
      type:  COLTYPE.NUMBER
    });
  });
  return cols;
}

function selectForColumns(node, t) {
  return [groupColumn(node, t)].concat(measureColumns(node, t));
}

/* One group's measures, in the order the header declares them. Shared with
   Histogram, whose groups are ranges rather than values but whose measures are
   the same question asked of the same rows. `total` is the denominator a share
   divides by, decided by the caller for the reason the SELECT FOR block gives
   at length: it is the rows that came in, not the sum of the groups. */
function measureValues(groupTable, stats, statCols, total) {
  return stats.map(function(s, si) {
    var op = selectForOp(s && s.op);
    if (op.key === 'share') return total ? (groupTable.rows.length / total) * 100 : 0;
    if (!op.needsCol)       return groupTable.rows.length;      // count
    var col = statCols[si];
    if (!col) return null;   // no column the measure could apply to. Blank, as Aggregate does
    return reduceValues(op.key, columnValues(groupTable, col.key));
  });
}

/* THE GROUPS THEMSELVES

   From a wired labels table: its own row order, deduplicated, blanks dropped.
   The order is not re-derived here because the user has already chosen it
   (possibly with a Sort on that very branch), and re-sorting would make that
   Sort invisible, which is the failure mode this tool spends most of its
   comments avoiding.

   From the data: the distinct values present, put in the grouping column's own
   order. Appearance order would be deterministic too, but "2023, 2022, 2024"
   because that is how the rows happened to arrive is a table that looks wrong
   and is not, which costs more to explain than the sort costs to run. */
/* A nested enrolment list is not a label: there is no one value in it to name
   a group with. Same exclusion sortableCols() and uniqueCols() make, for the
   same reason. */
function labelCols(t) {
  return t.columns.filter(function(c){ return c.type !== COLTYPE.COURSES; });
}

function labelsFromTable(node, lt) {
  if (!lt || !lt.columns.length) return [];
  var key = (node && node.cfg && node.cfg.labelCol) || '';
  var col = key ? colByKey(lt, key) : null;
  if (!col || col.type === COLTYPE.COURSES) col = labelCols(lt)[0] || null;
  if (!col) return [];

  var i = colIndex(lt, col.key), seen = {}, out = [];
  lt.rows.forEach(function(r) {
    var v = r[i];
    if (isBlank(v)) return;
    if (seen[String(v)]) return;
    seen[String(v)] = true;
    out.push(v);
  });
  return out;
}

function labelsFromData(node, t) {
  var f = groupField(node, t);
  if (!f) return [];
  var seen = {}, out = [];
  function push(v) {
    if (isBlank(v)) return;
    if (seen[String(v)]) return;
    seen[String(v)] = true;
    out.push(v);
  }

  if (f.column) {
    var i = colIndex(t, f.key);
    if (i === -1) return [];
    t.rows.forEach(function(r){ push(r[i]); });
  } else {
    // A course predicate. The values live inside the nested column, one per
    // enrolment, so the distinct set is gathered from there rather than from
    // any cell, which is precisely the set no other node can reach.
    var ci = coursesColIndex(t);
    if (ci === -1) return [];
    var prop = f.kind === 'courseSubject' ? 'subject'
             : f.kind === 'courseLevel'   ? 'level'
             : 'code';
    t.rows.forEach(function(r) {
      (r[ci] || []).forEach(function(e){ push(e[prop]); });
    });
  }

  out.sort(comparatorFor(f.column ||
    (f.kind === 'courseLevel' ? { type:COLTYPE.NUMBER } : null)));
  return out;
}

/* ONE LABEL, ONE SUBSET.

   The criterion is synthesised, not typed. Everything that makes matching
   correct ('2022' from a label equalling 2022 in a cell, "took" reaching
   inside the nested column, a level compared as a number) is applyCriterion's
   and is not repeated here.

   applyCriterion logs every call, and here it is called once per group, so the
   entries go to a sink that is thrown away: SELECT FOR writes one line of its
   own and the per-group detail is in meta.branches. Building a few dozen log
   entries and dropping them costs nothing at these sizes, and it is cheaper
   than a second matching path that could drift from the first. */
function rowsForLabel(t, f, value) {
  var crit = { field: f.key, values: {}, ops: {}, course: '' };
  crit.values[f.key] = value;
  crit.ops[f.key] = 'eq';
  return applyCriterion(t, crit, f, []);
}

function evaluateSelectFor(node, ctx) {
  var dataRes  = ctx.at('data')[0];
  var labelRes = ctx.at('labels')[0];
  var t = dataRes ? dataRes.table : makeTable([], []);
  var hasSource = !!(dataRes && dataRes.hasSource);

  var cols = selectForColumns(node, t);
  var f = groupField(node, t);

  if (!f) {
    // Nothing to group by: an unwired data port, or a table whose every column
    // has opted out of being filtered. Said rather than returned as an empty
    // breakdown, which reads as "no groups found": A claim about the data.
    ctx.log.push(logEntry('SELECT FOR', [{s:'nothing to group by in this table'}]));
    return { table: makeTable(cols, []), hasSource: hasSource };
  }

  var values = labelRes ? labelsFromTable(node, labelRes.table) : labelsFromData(node, t);

  /* A label the criterion cannot use (a word in a column of numbers, say,
     which a wired labels table can easily contain) takes that one group out
     rather than failing the query. The count is logged: a breakdown quietly
     missing a third of its rows is the failure this is guarding against, and
     the guard is only worth having if it says so. */
  var groups = [], skipped = 0;
  values.forEach(function(v) {
    var r = rowsForLabel(t, f, v);
    if (r.error) { skipped++; return; }
    groups.push({ label: String(v), value: v, table: r.table });
  });

  /* The denominator is the rows that came in, not the sum of the groups, and
     the two differ whenever groups overlap. They overlap on every course
     predicate: a student with eight enrolments is in eight of the groups.
     Dividing by the sum would turn "42% of students took COMP103" into 5%.
     A number that is wrong, in range, and impossible to spot. Dividing by the
     input says what it means, and shares that total more than 100% are the
     honest signal that the groups are not a partition.

     This is a deliberate difference from Compare, which divides by the sum of
     its branches. Compare's branches are arbitrary filter chains with no table
     they are all subsets of; a group always has one. */
  var total = t.rows.length;
  var stats = statsOf(node);

  // Resolved once, outside the loop, for the reason statCol() gives.
  var statCols = stats.map(function(s){ return statCol(s, t); });

  var rows = groups.map(function(g) {
    return [g.value].concat(measureValues(g.table, stats, statCols, total));
  });

  ctx.log.push(logEntry('SELECT FOR', [
    {s:'for each'}, {c:'val', s:f.label},
    {s:'from'}, {c:'val', s:(labelRes ? 'the labels branch' : 'the data')},
    {c:'op', s:'->'},
    {c:'val', s:groups.length}, {s:(groups.length === 1 ? 'group' : 'groups')},
    {s:'over'}, {c:'val', s:total}, {s:'rows'}
  ]));
  if (skipped) {
    ctx.log.push(logEntry('SKIP', [
      {c:'val', s:skipped}, {s:(skipped === 1 ? 'label' : 'labels')},
      {s:'this column cannot be matched against'}
    ]));
  }

  /* meta.branches in Compare's shape and under Compare's name, so the Output's
     per-group cards and the long-form export work here without knowing this
     node exists. meta.title is what those cards are headed with; Compare emits
     none and keeps the wording it always had. */
  return {
    table: makeTable(cols, rows, {
      branches: groups,
      measures: stats.map(function(s){ return selectForOp(s && s.op).key; }),
      title:   'Breakdown',
      unit:    (groups.length === 1 ? 'group' : 'groups')
    }),
    hasSource: hasSource
  };
}

/* ============================================================================
   HISTOGRAM: a group-by whose groups are ranges
   ============================================================================
   SelectFor is built on one sentence, taken from filterFields(): "grouping by a
   column means filtering on it once per label". This node is the same sentence
   with one word changed. A bin is the rows a Filter would keep for one RANGE,
   and ranges are a thing the tool already has: the `between` operator, added
   for "a mark between 70 and 80".

   WHY IT IS NOT JUST SELECTFOR
   SelectFor groups by value, which is a histogram already for any column with
   few enough values: group by Grade and the distribution comes out, in the
   declared A+ to D order, with no node needed here. It falls apart the moment
   the column is continuous. The 2024 archive has 248 students and 83 distinct
   GPAs, so grouping by GPA is 83 rows of mostly one, which is a list of
   students wearing a summary's shape. What is missing is not a way to group. It
   is a way to decide which values count as the same.

   THE EDGES, AND WHY THEY ARE NOT THE DATA'S
   The first edge is a multiple of the width, not the smallest value present.
   Anchoring to the data means two runs over two years produce bins that do not
   line up, and a comparison between them is then quietly meaningless: 2023's
   "4.3 to 5.3" against 2024's "4.1 to 5.1". Multiples of the width are the same
   bins for everyone, which is what makes two histograms comparable at all.

   THE BOUNDARY RULE, WHICH IS THE PART THAT GOES WRONG
   `between` includes both ends: applyCriterion's band keeps 70 for "70 to 80"
   AND for "60 to 70", which is right for a filter and fatal for a histogram,
   where it counts one row twice and the bins no longer sum to the rows. So the
   bins are not built out of `between`. Each row is placed by arithmetic instead,
   floor((v - first) / width), which puts every value in exactly one bin by
   construction rather than by a comparison that has to be got right twice. Bins
   are therefore half-open, [lo, hi), and the last one closed so the maximum has
   somewhere to go. A test sums the bins and compares against the rows that went
   in, because that is the property this decision exists to protect.

   EMPTY BINS SURVIVE
   A gap in the middle of a distribution is the finding. Bins are generated from
   the edges rather than discovered from the data, so a range nothing falls in
   comes out as a zero. This is the same thing SelectFor's Labels port buys, for
   the same reason, and is why neither node groups by "what happened to be
   there" when it can avoid it.

   WHAT COMES OUT
   SelectFor's shape exactly: a label column, then one column per measure, with
   the per-bin tables in meta.branches in Compare's format. Downstream, a
   histogram IS a breakdown, so Sort, Take, the Output's per-group cards and the
   long-form CSV all work without any of them learning this node exists.

   Measures are the full set rather than Count alone. "Average mark per GPA
   band" is the second question anyone asks of a distribution, and the machinery
   for it is already here.                                                     */

var HIST_BINS_WANTED = 10;   // roughly, when nobody has said how wide a band is
var HIST_MAX_BINS = 200;     // past this it is not a distribution, it is the data

/* Floating point: a value sitting exactly on an edge must not fall through to
   the bin below because (4.8 - 0) / 0.8 came to 5.999999999999999. The nudge is
   far smaller than any width a person would type and far larger than the error
   it is covering. */
var HIST_EPS = 1e-9;

// The columns worth binning are the ones worth measuring: numbers, minus the
// identifiers, for the reason measurableCols() gives about summing student IDs.
function binnableCols(t) { return measurableCols(t); }

/* Resolved against the arriving table rather than trusted from the config, the
   way every other node resolves a saved column. Both walks call this, so they
   cannot disagree about what is being binned. */
function binField(node, t) {
  var cols = binnableCols(t);
  if (!cols.length) return null;
  var key = (node && node.cfg && node.cfg.by) || '';
  for (var i = 0; i < cols.length; i++) if (cols[i].key === key) return cols[i];
  return cols[0];
}

/* Stored as typed and coerced on read, the same way Take stores N. A number
   input yields '' mid-edit and would otherwise have to be given a value the
   user has not finished choosing. Zero and negative widths are not a narrower
   histogram, they are no histogram. All of those mean "decide for me", which is
   null here and a width chosen from the data at evaluation time. */
function binWidth(node) {
  var n = Number(node && node.cfg ? node.cfg.width : undefined);
  return (isFinite(n) && n > 0) ? n : null;
}

/* A width nobody typed. A fixed default cannot work across these columns: ten
   is sensible for a mark out of a hundred and absurd for a GPA out of nine,
   where it puts the whole cohort in one band and calls it a distribution.

   So the width comes from the data, rounded to a number a person would have
   chosen. Aiming for about ten bands and then snapping to 1, 2, 2.5 or 5 times
   a power of ten is the same rule an axis uses to pick its tick marks, and for
   the same reason: bands of 2.5 can be read at a glance, bands of 2.7183
   cannot. */
function autoWidth(min, max) {
  var span = max - min;
  if (!(span > 0)) return 1;                 // one value, or all the same
  var raw = span / HIST_BINS_WANTED;
  var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  var steps = [1, 2, 2.5, 5, 10];
  for (var i = 0; i < steps.length; i++) {
    if (raw <= steps[i] * mag + 1e-12) return steps[i] * mag;
  }
  return 10 * mag;
}

/* An edge as a person would write it. Widths are typed by hand and can be
   fractional, so the printed precision follows the width rather than being
   fixed: bins of 0.25 need two places, bins of 10 need none, and neither wants
   the other's trailing zeros. */
function fmtEdge(n, w) {
  var dp = 0, step = w;
  while (dp < 4 && Math.abs(step - Math.round(step)) > 1e-9) { step *= 10; dp++; }
  var out = n.toFixed(dp);
  return out === '-0' ? '0' : out;
}

/* "70 to 80", not "70-80". A hyphen between two numbers is what Excel reads as
   a date, and these results are exported to be opened in Excel. */
function binLabel(lo, hi, w) { return fmtEdge(lo, w) + ' to ' + fmtEdge(hi, w); }

/* The edges, from the values present and the chosen width. Returns null when
   there is nothing to bin, and an error when the answer would be thousands of
   rows: a width of 0.01 over grade points is not a question anyone asked, and
   silently building 900 bins helps nobody. */
function binsFor(values, w) {
  if (!values.length) return null;
  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  var first = Math.floor(min / w) * w;
  var last  = Math.floor((max - first) / w + HIST_EPS);
  if (last + 1 > HIST_MAX_BINS) {
    return { error: (last + 1) + ' bins of ' + fmtEdge(w, w) + ' would be needed to cover ' +
      fmtEdge(min, w) + ' to ' + fmtEdge(max, w) + '. Widen the bins: at most ' +
      HIST_MAX_BINS + ' fit in a readable table.' };
  }
  var out = [];
  for (var i = 0; i <= last; i++) {
    var lo = first + i * w;
    out.push({ lo: lo, hi: lo + w, label: binLabel(lo, lo + w, w) });
  }
  return { first: first, last: last, bins: out };
}

/* The label column. Fixed key 'group', exactly as SelectFor fixes it, so a
   downstream node reaches for the same thing whichever of the two produced the
   table. TEXT, because "70 to 80" is what the cell says, with the bin labels
   declared as its value set and its order: that is what makes a downstream Sort
   put 100 to 110 after 90 to 100 rather than after 10 to 20, and what lets a
   downstream Filter offer the bins as a dropdown. Computable from the header
   alone it is not, so the ordering is attached by the evaluator, where the bins
   are known, and the schema walk declares the column without it. */
function binColumn(node, t) {
  var col = binField(node, t);
  return {
    key:   'group',
    label: col ? col.label : 'Bin',
    type:  COLTYPE.TEXT
  };
}

function histogramColumns(node, t) {
  return [binColumn(node, t)].concat(measureColumns(node, t));
}

function applyHistogram(node, t, log) {
  var cols = histogramColumns(node, t);
  var col = binField(node, t);

  if (!col) {
    // No numeric column to bin: an unwired node, or a table of text. Said
    // rather than returned as an empty distribution, which reads as a claim
    // about the data instead of about the graph.
    log.push(logEntry('HISTOGRAM', [{s:'no numeric column in this table to bin'}]));
    return { table: makeTable(cols, []) };
  }

  var idx = colIndex(t, col.key);

  // The values, and the rows that have none. A blank mark is not a mark of
  // zero, so it belongs in no bin, for the same reason reduceValues() skips it.
  var values = [], blanks = 0;
  t.rows.forEach(function(r) {
    var v = Number(r[idx]);
    if (r[idx] === '' || r[idx] === null || r[idx] === undefined || !isFinite(v)) blanks++;
    else values.push(v);
  });

  if (!values.length) {
    log.push(logEntry('HISTOGRAM', [{c:'val', s:col.label}, {s:'has no values to bin'}]));
    return { table: makeTable(cols, []) };
  }

  // Chosen from the values when nobody has typed one, which needs the values,
  // which is why this happens here and not in the panel.
  var w = binWidth(node);
  if (w === null) w = autoWidth(Math.min.apply(null, values), Math.max.apply(null, values));

  var spec = binsFor(values, w);
  if (spec.error) return { error: spec.error };

  // Every row into exactly one bin, by arithmetic rather than by comparison.
  var groups = spec.bins.map(function(b) {
    return { label: b.label, value: b.label, lo: b.lo, hi: b.hi, table: makeTable(t.columns, []) };
  });
  t.rows.forEach(function(r) {
    var v = Number(r[idx]);
    if (r[idx] === '' || r[idx] === null || r[idx] === undefined || !isFinite(v)) return;
    var i = Math.floor((v - spec.first) / w + HIST_EPS);
    if (i < 0) i = 0;
    if (i > spec.last) i = spec.last;   // the last bin is closed, so the maximum lands in it
    groups[i].table.rows.push(r);
  });

  var stats = statsOf(node);
  var statCols = stats.map(function(s){ return statCol(s, t); });
  var total = t.rows.length;

  var rows = groups.map(function(g) {
    return [g.value].concat(measureValues(g.table, stats, statCols, total));
  });

  // The order the bins are in IS their order, and saying so on the column is
  // what keeps a downstream Sort from reading these labels alphabetically.
  cols[0] = {
    key: cols[0].key, label: cols[0].label, type: cols[0].type,
    values: groups.map(function(g){ return g.label; }),
    order:  groups.map(function(g){ return g.label; })
  };

  log.push(logEntry('HISTOGRAM', [
    {c:'val', s:col.label},
    {s:'in bands of'}, {c:'val', s:fmtEdge(w, w)},
    {c:'op', s:'->'},
    {c:'val', s:groups.length}, {s:(groups.length === 1 ? 'bin' : 'bins')},
    {s:'over'}, {c:'val', s:values.length}, {s:'rows'}
  ]));
  if (blanks) {
    log.push(logEntry('SKIP', [
      {c:'val', s:blanks}, {s:(blanks === 1 ? 'row has' : 'rows have')},
      {s:'no'}, {c:'val', s:col.label}, {s:'and are in no bin'}
    ]));
  }

  return { table: makeTable(cols, rows, {
    branches: groups,
    measures: stats.map(function(s){ return selectForOp(s && s.op).key; }),
    title:   'Distribution',
    unit:    (groups.length === 1 ? 'bin' : 'bins')
  }) };
}

/* ============================================================================
   COMBINE
   ============================================================================
   Two or more tables with matching headers into one. Modes: merge, intersect,
   difference. The supervisor's suggestion that "set ops" is not a node but a
   setting on Combine.

   Combine reads its inputs separately rather than letting the graph merge them
   first, for the same reason Compare does: it has to know which table is which.
   That is also what keeps it clear of the implicit multi-wire union, which
   matters more than it sounds:

   MERGE CONCATENATES; IT DOES NOT DEDUPLICATE BY DEFAULT.
   The implicit union deduplicates by rowKey(), and for merging two student
   lists that is right. Student 1042 appearing in both branches is one
   student. For stacking two result tables it is wrong, and wrong in a way that
   produces a plausible number rather than an error. Take the supervisor's own
   worked example: run a Histogram once per year, stack the two rows, total the
   columns. rowKey() has no id column to work with there, so it falls back to
   joining the whole row, and if 2022 and 2023 happen to produce identical
   counts, the two rows are identical, one is discarded, and the sum silently
   halves. The failure is invisible precisely when the data is unremarkable.

   So row identity is a choice the user makes, not one the tool makes for them:
   merge concatenates, and dropping duplicates is a tick box. That also gives a
   true set union (merge + drop duplicates) alongside intersect and difference,
   which is what "set ops" meant in the first place.                          */

/* Merge adds vertically: more rows, same columns. Join adds horizontally: same
   rows or fewer, more columns. Intersect and difference are the set operations
   on rows. All four are one node because they all answer "these branches should
   become one table" and differ only in how. Putting the horizontal case in a
   node of its own would have meant two nodes with the same two input ports, the
   same base picker and the same key column, differing in one line. */
var COMBINE_MODES = [
  { key:'merge',      label:'Merge (stack rows)' },
  { key:'join',       label:'Join (add columns)' },
  { key:'intersect',  label:'Intersect (in all inputs)' },
  { key:'difference', label:'Difference (in the base only)' }
];

function combineMode(node) {
  var k = node && node.cfg ? node.cfg.mode : null;
  for (var i = 0; i < COMBINE_MODES.length; i++) if (COMBINE_MODES[i].key === k) return COMBINE_MODES[i];
  return COMBINE_MODES[0];
}

/* Which input is the base. Intersect is symmetric, but difference is not
   (A minus B is not B minus A), and connection order is an artefact of the
   order two nodes happened to be dragged together, which is invisible on the
   canvas. So the base is named explicitly, defaulting to the first input and
   falling back to it whenever the saved choice is no longer connected. */
function combineBaseId(node, inIds) {
  if (!inIds.length) return null;
  var saved = node && node.cfg ? node.cfg.base : null;
  for (var i = 0; i < inIds.length; i++) if (String(inIds[i]) === String(saved)) return inIds[i];
  return inIds[0];
}

/* The column that decides whether two rows are "the same row". Whole-row
   equality is a poor default for set operations: a float that differs in the
   last place makes two rows that mean the same thing compare unequal. An
   explicit key column says what identity means for this data. */
function combineKeyCols(t) {
  return t.columns.filter(function(c){ return c.type !== COLTYPE.COURSES; });
}

function combineKeyCol(node, t) {
  var saved = (node && node.cfg && node.cfg.key) || '';
  var col = saved ? colByKey(t, saved) : null;
  if (col && col.type !== COLTYPE.COURSES) return col;
  if (hasCol(t, 'id')) return colByKey(t, 'id');
  var avail = combineKeyCols(t);
  return avail.length ? avail[0] : null;
}

function keyValuesOf(t, colKey) {
  var set = {};
  var i = colIndex(t, colKey);
  if (i === -1) return set;
  t.rows.forEach(function(r){ set['k' + String(r[i])] = true; });
  return set;
}

/* The permutation that puts the chosen base first, as positions rather than as
   reordered tables. Reordering the tables directly was enough while the base
   was the only thing position meant; join has to reorder two parallel lists
   (the tables, and the upstream labels that name their columns), and deriving
   both from one permutation is what stops them drifting out of step.

   Done here rather than inside combineTables so the reduction itself has one
   rule, "the base is tables[0]", and the mapping from a node id to a position
   stays with the node ids. */
function combineOrder(node, inIds) {
  var baseId = combineBaseId(node, inIds);
  var at = -1;
  for (var i = 0; i < inIds.length; i++) if (inIds[i] === baseId) { at = i; break; }
  var idx = inIds.map(function(_, i){ return i; });
  if (at <= 0) return idx;
  return [at].concat(idx.filter(function(i){ return i !== at; }));
}

/* The name a joined column carries when it has to say where it came from. */
function combineInputLabel(id) {
  var up = findNode(id);
  return up ? upstreamLabel(up) : ('Input ' + id);
}

/* ---- Join: the horizontal combination ------------------------------------ */

/* The joined header. The base contributes every column it has. Each other input
   contributes everything except the key, which is shared rather than repeated.

   A clash is renamed rather than overwritten: two branches off one Source both
   carry Year, and silently dropping the second would lose data while silently
   overwriting the first would lose different data. The incoming key gets a
   suffix and the label says which node it came from, so the header stays unique,
   which matters beyond the screen, since these become CSV column names.

   Derived from headers alone so the schema pass and the evaluator can call the
   same function and cannot disagree about the result's shape. */
function joinColumns(node, heads, labels) {
  if (!heads.length) return [];
  var base = heads[0];
  var keyCol = combineKeyCol(node, base);
  var cols = base.columns.slice();
  var used = {};
  cols.forEach(function(c){ used[c.key] = true; });

  heads.slice(1).forEach(function(h, i) {
    h.columns.forEach(function(c) {
      if (keyCol && c.key === keyCol.key) return;
      var key = c.key, n = 2;
      while (used[key]) { key = c.key + '_' + n; n++; }
      used[key] = true;
      cols.push({
        key: key,
        label: (key === c.key) ? c.label : (c.label + ' \u00b7 ' + (labels[i + 1] || 'input ' + (i + 2))),
        type: c.type, values: c.values, order: c.order, def: c.def, filter: c.filter
      });
    });
  });
  return cols;
}

function joinTables(node, tables, labels, log) {
  var base = tables[0];
  var keyCol = combineKeyCol(node, base);
  if (!keyCol) {
    return { error: 'Join matches rows on a key column, and this table has none that can be used. ' +
      'Every column here is either nested or absent.' };
  }
  for (var i = 1; i < tables.length; i++) {
    if (!hasCol(tables[i], keyCol.key)) {
      return { error: 'Join is matching rows on ' + keyCol.label + ', but ' +
        (labels[i] || 'another input') + ' has no such column. ' +
        'Pick a key column that every input carries.' };
    }
  }

  var cols = joinColumns(node, tables, labels);
  var keepUnmatched = !!(node && node.cfg && node.cfg.keepUnmatched);

  /* Each other input is indexed by key, first row winning. The alternative
     (a row out per matching pair, which is what a relational join does) turns a
     key with repeats into a multiplication: joining two 400-row tables on Year
     would produce 160,000 rows from a single dropdown change. Looking up one
     match keeps the output the size of the base, which is the shape the user is
     looking at when they wire it. Repeats are reported rather than silently
     resolved, so a badly chosen key says so instead of just being wrong. */
  var dupeIn = [];
  var index = tables.slice(1).map(function(t, i) {
    var ki = colIndex(t, keyCol.key), map = {}, dup = 0;
    t.rows.forEach(function(r) {
      var k = 'k' + String(r[ki]);
      if (map[k] === undefined) map[k] = r; else dup++;
    });
    if (dup) dupeIn.push((labels[i + 1] || 'input ' + (i + 2)) + ' (' + dup + ')');
    return { t: t, map: map };
  });

  var bi = colIndex(base, keyCol.key);
  var rows = [], unmatched = 0;

  base.rows.forEach(function(r) {
    var k = 'k' + String(r[bi]);
    var extra = [], miss = false;
    index.forEach(function(ix) {
      var hit = ix.map[k];
      if (!hit) miss = true;
      ix.t.columns.forEach(function(c, ci) {
        if (c.key === keyCol.key) return;
        extra.push(hit ? hit[ci] : null);
      });
    });
    if (miss) {
      unmatched++;
      if (!keepUnmatched) return;
    }
    rows.push(r.concat(extra));
  });

  log.push(logEntry('COMBINE', [{s:'join on'}, {c:'val', s:keyCol.label}, {s:'\u2192'},
    {c:'val', s:rows.length}, {s:'rows,'}, {c:'val', s:cols.length}, {s:'columns'}]));
  if (unmatched) {
    log.push(logEntry('COMBINE', [{s:(keepUnmatched ? 'kept' : 'dropped')},
      {c:'val', s:unmatched}, {s:'base row(s) with no match' + (keepUnmatched ? ' (blank cells)' : '')}]));
  }
  if (dupeIn.length) {
    log.push(logEntry('COMBINE', [{s:'repeated keys in'}, {c:'val', s:dupeIn.join(', ')},
      {s:'(first match used)'}]));
  }

  // meta describes the base's rows against the base's header, which the join has
  // widened. Dropped for the same reason Select drops it.
  return { table: makeTable(cols, rows) };
}

function combineTables(node, tables, log, labels) {
  if (!tables.length) return { table: makeTable([], []) };
  labels = labels || [];
  var mode = combineMode(node);

  /* Matching headers are required by the three modes that work on rows, because
     a row from one input has to be a row of the other's table too. Join is the
     one mode where differing headers are the point, so the check is scoped to
     the modes it describes rather than applied to the node. */
  if (mode.key !== 'join') {
    var first = schemaKey(tables[0]);
    for (var i = 1; i < tables.length; i++) {
      if (schemaKey(tables[i]) !== first) {
        return { error: 'Combine needs inputs with the same columns for ' + mode.key + '. ' +
          'These inputs have different headers, so their rows cannot be stacked. ' +
          'Make the branches produce the same columns, or switch the mode to ' +
          'Join to put their columns side by side instead.' };
      }
    }
  }

  if (tables.length === 1) {
    log.push(logEntry('COMBINE', [{s:'one input (passed through)'}]));
    return { table: tables[0] };
  }

  if (mode.key === 'join') return joinTables(node, tables, labels, log);

  var base = tables[0];
  var others = tables.slice(1);

  if (mode.key === 'merge') {
    var rows = [];
    tables.forEach(function(t){ rows = rows.concat(t.rows); });
    var total = rows.length;

    if (node && node.cfg && node.cfg.dedupe) {
      var seen = {}, kept = [];
      rows.forEach(function(r) {
        var k = rowKey(base, r);
        if (seen[k]) return;
        seen[k] = true;
        kept.push(r);
      });
      rows = kept;
      log.push(logEntry('COMBINE', [{s:'merge'}, {c:'val', s:tables.length}, {s:'inputs →'},
        {c:'val', s:rows.length}, {s:'rows, ' + (total - rows.length) + ' duplicate(s) dropped'}]));
    } else {
      log.push(logEntry('COMBINE', [{s:'merge'}, {c:'val', s:tables.length}, {s:'inputs →'},
        {c:'val', s:total}, {s:'rows'}]));
    }
    return { table: makeTable(base.columns, rows, base.meta) };
  }

  // intersect / difference
  var keyCol = combineKeyCol(node, base);
  if (!keyCol) {
    return { error: 'Combine needs a column to match rows on for ' + mode.key +
      '. This table has no column that can be used as a key.' };
  }
  var sets = others.map(function(t){ return keyValuesOf(t, keyCol.key); });
  var ki = colIndex(base, keyCol.key);

  var out = base.rows.filter(function(r) {
    var k = 'k' + String(r[ki]);
    if (mode.key === 'intersect') {
      return sets.every(function(s){ return !!s[k]; });
    }
    return sets.every(function(s){ return !s[k]; });   // difference
  });

  log.push(logEntry('COMBINE', [{s:mode.key + ' on'}, {c:'val', s:keyCol.label},
    {s:'→'}, {c:'val', s:out.length}, {s:'of'}, {c:'val', s:base.rows.length}, {s:'base rows'}]));

  return { table: makeTable(base.columns, out, base.meta) };
}

/* ============================================================================
   NODE SPECIFICATIONS
   ============================================================================
   One entry per node type, declaring the two things the graph walks need to
   know: what shape comes out, and how the rows are computed.

     schema:    (node, inSchema, ctx) -> table of columns, no rows. The header
                this node produces, derived from the header it is given.
                inSchema is the header on the node's primary port; ctx.port(key)
                reaches the others, which is what a two-input node needs.
     rows:      (node, table, log) -> table | {error}. The ordinary path: one
                table in, one table out. Omitted by nodes that pass their rows
                through untouched.
     evaluate:  (node, ctx) -> {table, error, hasSource}. For nodes that read
                their inputs separately rather than taking one table: Source
                (no inputs), Combine and Compare (many).

   `merges` is gone. It meant "union this node's inputs before running it", and
   that union is what a wire into an occupied port now prevents: a single-input
   node has one table, so there is nothing to reconcile and no way for rows to
   disappear into a silent deduplication. Nodes that genuinely take several
   tables declare a multi port and read them through ctx.

   Why a registry rather than branches in two functions: schema propagation and
   evaluation must agree about every node, and until now they agreed by
   coincidence. Filter, Sort and Take leave the header alone, so schema
   propagation could get away with `out[node.id] = ins[0]`. A pass-through
   that is simply wrong for every node still to be built. Histogram, Aggregate
   and Project all rewrite the header, and each would have needed a branch in
   computeSchemas() and another in evaluateGraph(), in two places that no
   mechanism keeps in step.

   Declaring both against one type means a new node is one entry here plus its
   implementation, and the invariant that ties the pair together
   (headerOnly(rows(node, t)) equals schema(node, headerOnly(t))) is a property
   of the registry that can be tested across every type at once, rather than
   remembered.                                                                */

function passthroughSchema(node, inSchema) { return inSchema; }

var NODE_SPEC = {
  source: {
    // Every Source now emits the same shape (the rows in the file), so the
    // header is fixed rather than derived from anything.
    schema: function(node) {
      return headerOnly(makeTable(STUDENT_COLUMNS, []));
    },
    evaluate: function(node, ctx) {
      var out = sourceTable(node, ctx.log);
      if (out.error) return { error: out.error };
      return { table: out.table, hasSource: true };
    }
  },

  filter: {
    schema: passthroughSchema,
    rows: function(node, t, log) { return applyFilter(node, t, log); }
  },

  sort: {
    schema: passthroughSchema,
    rows: function(node, t, log) { return { table: applySort(node, t, log) }; }
  },

  reverse: {
    // Nothing to declare: same header out as in, and no config to read.
    schema: passthroughSchema,
    rows: function(node, t, log) { return { table: applyReverse(node, t, log) }; }
  },

  take: {
    schema: passthroughSchema,
    rows: function(node, t, log) { return { table: applyTake(node, t, log) }; }
  },

  unique: {
    // The first built node whose output header depends on its own config
    // rather than only on its input: naming a column narrows the header to
    // that column. Both walks call uniqueCol() on the columns they hold, so
    // they cannot disagree about which mode the node is in.
    schema: uniqueSchema,
    rows: function(node, t, log) { return { table: applyUnique(node, t, log) }; }
  },

  select: {
    // The only node that narrows the header without touching the rows, so both
    // halves of the registry contract come from selectedCols(): the schema pass
    // and the evaluator resolve the same keys against the same header and
    // cannot disagree about what comes out.
    schema: selectSchema,
    rows: function(node, t, log) { return { table: applySelect(node, t, log) }; }
  },

  project: {
    // The only node that changes what a ROW means. Its header still follows
    // from the incoming header alone. The enrolment columns are fixed and the
    // carried ones are chosen by key, so it needs no more of the registry than
    // any other node, however different its effect.
    schema: projectSchema,
    rows: function(node, t, log) { return { table: applyProject(node, t, log) }; }
  },

  aggregate: {
    schema: aggregateSchema,
    rows: function(node, t, log) { return { table: applyAggregate(node, t, log) }; }
  },

  aggregateColumns: {
    schema: aggregateColumnsSchema,
    rows: function(node, t, log) { return { table: applyAggregateColumns(node, t, log) }; }
  },

  aggregateRows: {
    // Header depends only on the chosen measure, never on the incoming columns,
    // so the schema walk knows it without looking at anything upstream.
    schema: aggregateRowsSchema,
    rows: function(node, t, log) { return { table: applyAggregateRows(node, t, log) }; }
  },

  combine: {
    /* One multi port. Where an ordinary node now refuses a second wire, this is
       the node that exists to accept it: stacking several tables is its job,
       and how they stack (merge, intersect, difference, dedupe or not) is its
       settings rather than a rule applied behind the user's back. Its header is
       whatever arrives, so the schema is the ordinary pass-through. */
    /* Pass-through for the three row modes: the header that arrives is the
       header that leaves. Join is the exception (the one mode that produces a
       header neither input had), so it builds one from every input on the port,
       through the same function the evaluator uses. */
    schema: function(node, inSchema, ctx) {
      if (combineMode(node).key !== 'join') return inSchema;
      var ids = inputsOf(node.id, 'in');
      var heads = ctx.at('in');
      if (heads.length < 2) return inSchema;
      var sperm = combineOrder(node, ids);
      return makeTable(joinColumns(node,
        sperm.map(function(i){ return heads[i]; }),
        sperm.map(function(i){ return combineInputLabel(ids[i]); })), []);
    },
    evaluate: function(node, ctx) {
      // The base is a node the user named, not the wire that happened to be
      // drawn first, so the tables are ordered before the reduction sees them,
      // and the labels ride the same permutation, so a renamed joined column
      // names the node it actually came from.
      var perm = combineOrder(node, ctx.inIds);
      var ctabs = perm.map(function(i){ return ctx.ins[i].table; });
      var clabels = perm.map(function(i){ return combineInputLabel(ctx.inIds[i]); });
      var out = combineTables(node, ctabs, ctx.log, clabels);
      return {
        table: out.table,
        error: out.error,
        hasSource: ctx.ins.some(function(r){ return r.hasSource; })
      };
    }
  },

  selectFor: {
    /* The first node with two DIFFERENT ports rather than one port taking many
       wires, and it needed nothing added to the port model to have them. The
       entry in NODE_PORTS is the whole declaration, which is what the comment
       there predicted when it named this node.

       schema reads only the data port. The output header is the grouping field
       plus the measures, and neither depends on the labels branch: what the
       labels supply is which groups exist, and that is rows. So a half-built
       graph with nothing on `labels` still describes itself correctly, and the
       two walks cannot drift over a wire only one of them looks at. */
    schema: function(node, inSchema) {
      return makeTable(selectForColumns(node, inSchema), []);
    },
    evaluate: evaluateSelectFor
  },

  histogram: {
    /* One input and one table out, so it declares `rows` rather than
       `evaluate`. The header is the bin column plus the measures and depends on
       the config alone, which is what lets the schema walk describe it before
       anything has run: which bins exist is rows, not columns. */
    schema: function(node, inSchema) {
      return makeTable(histogramColumns(node, inSchema), []);
    },
    rows: applyHistogram
  },

  compare: {
    // The other multi port. Each branch becomes a row, so it reads the branch
    // results directly rather than receiving one table.
    schema: function(node) { return makeTable(compareColumns(measuresOf(node)), []); },
    evaluate: function(node, ctx) {
      return {
        table: buildCompare(node, ctx.inIds, ctx.res, ctx.log),
        hasSource: ctx.ins.some(function(r){ return r.hasSource; })
      };
    }
  },

  output: {
    /* An Output's result IS its input: outputTable() applies the chosen view at
       render time, not here, so neither the count reshaping nor the column
       narrowing is part of the graph. Nothing reads downstream of an Output
       (CONNECT_RULES gives it no outgoing edges), so the distinction costs
       nothing today, and passthroughSchema stays honest because no node ever
       asks what an Output produces.

       If an Output ever becomes chainable this is the entry that has to grow a
       real schema, and it is now a real piece of work rather than a formality:
       the header depends on the view AND on the column selection, so the answer
       is makeTable(outputTable(node, inSchema).columns, []). */
    schema: passthroughSchema
  }
};

function specFor(type) { return NODE_SPEC[type] || null; }

/* The context handed to spec.evaluate and spec.schema. One object serves both
   walks: `at(portKey)` returns what is on that port, whether "what" is a result
   or a header, so a node's two functions ask the same question in the same
   words. Nodes that only ever have one input never call it. */
function portContext(node, valueOf) {
  return function(portKey) {
    return inputsOf(node.id, portKey).map(valueOf).filter(Boolean);
  };
}

/* GRAPH EVALUATION
   Walks the DAG in topological order. Each node computes from its own inputs,
   so parallel branches stay independent.
   Returns {res: {nodeId: {table, log, hasSource}}} or {error}.

   The default path is now genuinely single-input: whatever is on the primary
   port is the table, with no union step to lose rows in. An empty port yields
   an empty table rather than an error, so a half-built graph still renders and
   still runs. The node simply has nothing to work on yet. */
function evaluateGraph() {
  var order = topoSort();
  if (order.length < nodes.length) {
    return { error: 'Circular connection detected. Remove an arrow that loops back on itself.' };
  }

  var res = {};
  for (var i = 0; i < order.length; i++) {
    var node = order[i];
    var spec = specFor(node.type);
    if (!spec) continue;   // a type no longer supported: skip rather than throw
    var log = [], table, hasSource;

    var inIds = inputsOf(node.id);
    var ins = inIds.map(function(id){ return res[id]; }).filter(Boolean);
    if (node.type !== 'source') {
      ins.forEach(function(r){ log.push.apply(log, r.log); });
    }

    var ctx = {
      inIds: inIds,
      ins: ins,
      res: res,
      log: log,
      at: portContext(node, function(id){ return res[id]; })
    };

    if (spec.evaluate) {
      var ev = spec.evaluate(node, ctx);
      // A node that reads its inputs itself can fail the same way a row
      // transform can (Combine rejects mismatched headers), so the error has
      // to surface here too, rather than only on the spec.rows path.
      if (ev.error) return { error: ev.error };
      table = ev.table;
      hasSource = ev.hasSource;
    } else {
      var head = ctx.at(primaryPort(node.type))[0];
      table = head ? head.table : makeTable([], []);
      hasSource = !!(head && head.hasSource);

      if (spec.rows) {
        var out = spec.rows(node, table, log);
        if (out.error) return { error: out.error };
        table = out.table;
      }
    }

    res[node.id] = { table: table, log: log, hasSource: hasSource };
  }
  return { res: res };
}

/* SCHEMA PROPAGATION
   The same walk as evaluateGraph but carrying only column headers, no rows. It
   is what lets a Filter's field list and an Output's average-column list be
   built from whatever is actually flowing into them. Cheap enough to run on
   every render because no row is ever touched.

   Both walks read the same registry and the same ports, so a node cannot
   describe one header here and produce another there, and cannot read a
   different input in the two passes either. */
function computeSchemas() {
  var order = topoSort();
  var out = {};
  order.forEach(function(node) {
    var spec = specFor(node.type);
    if (!spec) { out[node.id] = makeTable([], []); return; }
    var at = portContext(node, function(id){ return out[id]; });
    var head = at(primaryPort(node.type))[0];
    out[node.id] = headerOnly(spec.schema(node, head || makeTable([], []), { at: at }));
  });
  return out;
}

// The header a node's config panel should describe: what arrives, not what
// leaves. Reads the primary port, so a two-input node's panel describes its
// data rather than whichever wire happened to be drawn first. An unconnected
// node falls back to the student schema so its panel is still meaningful
// before anything is wired up.
function inputSchema(node, schemas, portKey) {
  var key = portKey === undefined ? primaryPort(node.type) : portKey;
  var ins = inputsOf(node.id, key).map(function(id){ return schemas[id]; }).filter(Boolean);
  if (ins.length) return ins[0];
  return makeTable(STUDENT_COLUMNS, []);
}
