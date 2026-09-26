/* nodes/controls.js: The controls inside a config panel: criteria rows, operators,
   range bands and list bands.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   RENDER: CONFIG PANELS
   ============================================================================
   Controls carry data-node / data-key and are read by one delegated listener.
   Nothing here reads the DOM back: render() is a pure function of the model,
   which is what makes the drag fast path and save/load safe.                  */

function ctl(nodeId, key, extra) {
  return ' data-node="' + nodeId + '" data-key="' + esc(key) + '"' + (extra || '');
}
function opt(val, cur, label) {
  return '<option value="' + esc(val) + '"' + (String(cur) === String(val) ? ' selected' : '') + '>' +
    esc(label === undefined ? val : label) + '</option>';
}
/* The archive names a course by code and never by title, so a loaded catalogue
   has name === code and there is nothing to append. Saying "AIML427" beats
   saying "AIML427: AIML427", and the synthetic catalogue, which does carry
   titles, still gets both. One function, because the course dropdown and its
   tooltip must not disagree about how a course is written. */
function courseLabel(c) {
  if (!c) return '';
  return (c.name && c.name !== c.code) ? c.code + ': ' + c.name : c.code;
}
function courseTitle(code) {
  var c = COURSE_BY_CODE[code];
  return c ? courseLabel(c) : String(code);
}

// Grouped by subject so a 31-course catalogue stays navigable and a longer real
// one degrades gracefully instead of becoming a single flat list.
function courseSelect(nodeId, key, cur) {
  var sel = cur || defaultCourse();
  var html = '<select class="course-sel" title="' + esc(courseTitle(sel)) + '"' + ctl(nodeId, key) + '>';
  SUBJECTS.forEach(function(subj) {
    var inSubj = COURSES.filter(function(c){ return c.subject === subj; });
    if (!inSubj.length) return;
    html += '<optgroup label="' + esc(subj) + '">';
    inSubj.forEach(function(c) {
      html += '<option value="' + c.code + '"' + (sel === c.code ? ' selected' : '') + '>' +
        esc(courseLabel(c)) + '</option>';
    });
    html += '</optgroup>';
  });
  return html + '</select>';
}

function opSelect(nodeId, key, ops, cur) {
  var groups = opGroups(ops);
  /* Only worth grouping when there is something to separate. A field with no
     range on offer gets a plain list, as before, and so does one with only two
     operators: two headings over one option each is decoration, not structure,
     which is what the two-item "Took course" selector would otherwise get. */
  var body = (groups.length < 2 || ops.length < 3)
    ? ops.map(function(o){ return opt(o, cur, opLabel(o)); }).join('')
    : groups.map(function(g) {
        return '<optgroup label="' + esc(g.label) + '">' +
          g.ops.map(function(o){ return opt(o, cur, opLabel(o)); }).join('') +
        '</optgroup>';
      }).join('');
  /* Marked when a band is open so the row can give the control room for its
     longer label. "in range" and "is one of" will not fit the 38px column the
     comparator symbols live in, and the value box either would have shared that
     row with has moved into the band below anyway. The two marks differ only in
     colour, each matching the band it opens, so the operator and its band read
     as one control rather than two. */
  var wide = cur === 'between' ? ' class="op-wide"'
           : cur === 'in'      ? ' class="op-list"'
           : '';
  return '<select' + wide + ctl(nodeId, key) + '>' + body + '</select>';
}

/* One criterion row. Its shape follows the field's type, and the field list
   follows the incoming table, so this function knows nothing about students. */
/* THE RANGE BAND
   A range is the one criterion that needs a second value, and squeezing it into
   the same row as the first would leave three controls and two numbers fighting
   over one panel's width. It gets its own strip below the row instead, banded down the left
   the way a criterion is banded, so it reads as part of that criterion rather
   than as a new one, and coloured, so a filter carrying a band is visibly
   doing something different from one that is not.

   It exists only while `between` is the operator. Choosing it adds the band and
   choosing anything else takes it away, which is the whole of the "add it or
   not": there is no separate switch to get out of step with the operator.

   The colour is the one this interface already uses for a state worth noticing
   (the amber of the stale-results notice), rather than a new hue invented for
   one control. */
/* Each end of the band is an operand in its own right, so a range can read
   "from v1 to 9" with one end bound and the other typed. The two bind under
   different keys (the field key and its range key), which is what lets them
   differ at all. */
function rangeBandHTML(nid, ci, cur, c, renderBound) {
  var rng = critRange(c, cur.key, cur.column);
  var loKey = 'crit.' + ci + '.value:' + cur.key;
  var hiKey = 'crit.' + ci + '.value:' + rangeKey(cur.key);
  return '<div class="crit-range">' +
    '<span class="crit-range-tag">range</span>' +
    '<div class="crit-range-pair">' +
      operandHTML(nid, c, cur.key, critBindKey(ci, cur.key),
                  renderBound(loKey, rng.loRaw)) +
      '<span class="crit-range-to">to</span>' +
      operandHTML(nid, c, rangeKey(cur.key), critBindKey(ci, rangeKey(cur.key)),
                  renderBound(hiKey, rng.hiRaw)) +
    '</div>' +
    '<div class="crit-range-note">' +
      (rng.lo === null || rng.hi === null
        ? (cur.column && cur.column.type === COLTYPE.NUMBER
            ? 'Both ends have to be numbers. The query will not run until they are.'
            : 'Both ends have to be values this column holds.')
        : rng.lo === rng.hi
        /* The two bounds start equal on a plain number column, which has no
           declared span to open the band across. Saying so, and saying what to
           do, beats leaving the user to work out why a range behaves like an
           equals. */
        ? 'Both ends are ' + esc(String(rng.loRaw)) + ', so this keeps only ' +
          'rows equal to it. Change one end to widen the band.'
        : 'Keeps rows from ' + esc(String(rng.loRaw)) + ' to ' + esc(String(rng.hiRaw)) +
          ', both included.' + (rng.swapped ? ' (Bounds read the other way round.)' : '')) +
    '</div>' +
  '</div>';
}

/* THE LIST BAND
   The range band's sibling, and deliberately built to the same pattern: it
   appears only while its operator is chosen, it is banded down the left so it
   reads as part of the criterion rather than as a criterion of its own, and it
   carries a one-line note saying what the current setting actually keeps.

   It is a different colour from the range band. Both are bands under a
   criterion and a reader glancing at a panel should be able to tell which one
   they are looking at without reading the tag, so the range keeps the amber it
   had and the list takes the violet this interface already uses for the
   measure tick boxes it borrows its controls from.

   TICK BOXES RATHER THAN A MULTI-SELECT.
   A native <select multiple> is the obvious control and the wrong one: it
   needs ctrl-click to choose a second value, which is undiscoverable, and it
   silently discards the whole selection when a plain click lands in it. Tick
   boxes cost more pixels and cannot be got wrong. They are also the control
   this panel already uses for "choose several of these" in the Select and
   Compare panels, so it is not a new idea, only a new place.

   A column with no declared values (a name, a free number) has nothing to tick,
   so it gets a text box and the list is split on commas. */
function listBandHTML(nid, ci, cur, c) {
  var choices = listChoices(cur.kind, cur.column);
  var chosen = critList(c, cur.key, cur.column);
  var n = chosen.length;
  var picked = {};
  chosen.forEach(function(v){ picked[v] = true; });

  var body;
  if (choices.length) {
    var box = function(v, label, title) {
      return '<label class="crit-pick' + (picked[v] ? ' on' : '') + '"' +
          (title ? ' title="' + esc(title) + '"' : '') + '>' +
        '<input type="checkbox"' + (picked[v] ? ' checked' : '') +
          ctl(nid, 'crit.' + ci + '.pick:' + cur.key + ':' + v) + '>' +
        '<span>' + esc(label) + '</span></label>';
    };
    /* The course catalogue is grouped by subject for the reason courseSelect
       groups its own options: eighty-odd codes in one flat run is a wall, and
       the same list under thirteen headings is a thing you can find COMP103 in.
       Every other field here has few enough values to stay flat. */
    if (cur.kind === 'courseCode') {
      body = SUBJECTS.map(function(subj) {
        var inSubj = COURSES.filter(function(x){ return x.subject === subj; });
        if (!inSubj.length) return '';
        return '<div class="crit-list-group">' + esc(subj) + '</div>' +
          '<div class="crit-list-picks">' +
            inSubj.map(function(x){ return box(x.code, x.code, courseLabel(x)); }).join('') +
          '</div>';
      }).join('');
    } else {
      body = '<div class="crit-list-picks">' +
        choices.map(function(v) {
          return box(v, cur.kind === 'courseLevel' ? v + '00-level' : v, '');
        }).join('') + '</div>';
    }
  } else {
    /* Stored as typed, split on read. The raw string is what goes back into the
       box so a half-written entry survives the re-render that every keystroke
       causes; critList does the tidying when the query runs. */
    var raw = c.values && c.values[listKey(cur.key)];
    var shown = Array.isArray(raw) ? raw.join(', ') : (raw === undefined ? '' : String(raw));
    body = '<input type="text" class="crit-list-text" placeholder="value, value, value" ' +
      'value="' + esc(shown) + '"' + ctl(nid, 'crit.' + ci + '.value:' + listKey(cur.key)) + '>';
  }

  /* WHY THERE MIGHT BE NOTHING TO TICK.
     Two different states produce an empty choice list and they want different
     sentences. A course field or a category has values, but they come from the
     loaded archive: SPECS, YEARS and the course catalogue are all filled by the
     loader and are empty on a Source nobody has given files to yet. A name or a
     free number never has a set to offer at all.

     The band falls back to a text box either way, which is the useful behaviour
     (a typed list still works, and it turns into ticked boxes the moment the
     files arrive). But telling somebody to type a course code when the reason
     they cannot pick one is that they have not loaded their data would be the
     panel answering a question they did not ask. */
  var awaitingData = !choices.length &&
    (cur.kind === 'courseCode' || cur.kind === 'courseSubject' ||
     (cur.column && cur.column.type === COLTYPE.ENUM));

  var note = !n
    ? 'Nothing chosen, so this query will not run. ' +
      (choices.length ? 'Tick at least one.'
        : awaitingData
        ? 'Load the data files on the Source and these become tick boxes; ' +
          'until then, type the values separated by commas.'
        : 'Type at least one value, separated by commas.')
    : n === 1
    /* Said for the same reason the range band says it when both ends match: a
       list of one behaves exactly like the operator the user just moved away
       from, and leaving them to work that out from an unchanged row count is
       the kind of silence this panel avoids. */
    ? 'One value chosen, so this keeps the same rows "is" would. Choose another to widen it.'
    : 'Keeps rows matching any of the ' + n + ' chosen' +
      (cur.kind === 'courseCode' || cur.kind === 'courseSubject'
        ? ', so a student counts once however many of them they took.' : '.');

  return '<div class="crit-list">' +
    '<span class="crit-list-tag">list' +
      (n ? '<b>' + n + '</b>' : '') + '</span>' +
    (n && choices.length
      ? '<button class="crit-list-clear" onclick="clearCritList(' + nid + ',' + ci + ')">clear</button>'
      : '') +
    body +
    '<div class="crit-list-note">' + note + '</div>' +
  '</div>';
}

/* What the two wildcards mean, beside the box they are typed into. A pattern
   language is not guessable from an empty field, and the alternative to saying
   it here is a user typing a course code and wondering what the operator was
   for. One line, no justification: the reasoning lives in Help. */
function patternNoteHTML(kind) {
  return '<div class="crit-pattern-note"><b>*</b> is any run of characters, ' +
    '<b>?</b> is one. ' +
    (kind === 'courseSubject'
      ? 'So <b>SW*</b> is every subject starting SW.'
      : 'So <b>SWEN*</b> is every SWEN course and <b>*4??</b> every 400 level.') +
    '</div>';
}

/* Untick everything in one click. Eighty-two courses is a plausible list to
   have opened by accident, and clearing it one box at a time is not a thing to
   ask of anybody. */
function clearCritList(nodeId, ci) {
  var n = findNode(nodeId);
  var c = n && n.cfg && n.cfg.criteria && n.cfg.criteria[ci];
  if (!c) return;
  var f = fieldByKey(inputSchema(n, computeSchemas()), c.field);
  if (!f) return;
  c.values = c.values || {};
  c.values[listKey(f.key)] = [];
  markStale();
  render();
}

function criterionHTML(node, ci, c, schema) {
  var fields = filterFields(schema);
  if (!fields.length) {
    return '<div class="criterion-row"><div class="cmp-hint">No columns upstream. Connect a Source.</div></div>';
  }
  var cur = fieldByKey(schema, c.field) || fields[0];
  var nid = node.id;
  var remove = ci > 0
    ? '<button class="remove-criterion-btn" onclick="removeCriterion(' + nid + ',' + ci + ')">x</button>'
    : '';

  var plain = fields.filter(function(f){ return f.key.indexOf('courses.') !== 0; });
  var crs   = fields.filter(function(f){ return f.key.indexOf('courses.') === 0; });
  var fieldSel = '<select class="ft-sel"' + ctl(nid, 'crit.' + ci + '.field') + '>' +
    (plain.length ? '<optgroup label="Row">' + plain.map(function(f){ return opt(f.key, cur.key, f.label); }).join('') + '</optgroup>' : '') +
    (crs.length   ? '<optgroup label="Courses">' + crs.map(function(f){ return opt(f.key, cur.key, f.label); }).join('') + '</optgroup>' : '') +
  '</select>';

  var vKey = 'crit.' + ci + '.value:' + cur.key;
  var oKey = 'crit.' + ci + '.op:' + cur.key;
  /* The single operand, wherever this criterion's shape happens to put it. Every
     branch below draws its own control (a number, a course picker, a pattern
     box) and hands it here, so all of them offer a variable in the same place
     and by the same gesture without any of them knowing how that works. The
     range band does the same for its two ends. */
  var vSlot = function(literal) {
    return operandHTML(nid, c, cur.key, critBindKey(ci, cur.key), literal);
  };
  var body;

  /* The two nested-column fields gained an operator select when the list
     arrived. They had none before, because "took this" was the only thing
     either of them could say. */
  if (cur.kind === 'courseSubject') {
    var sOp = critOp(c, cur.key, 'eq');
    if (CODE_OPS.indexOf(sOp) === -1) sOp = CODE_OPS[0];
    body = (sOp === 'in'
      ? '<div class="criterion-controls two-col">' + fieldSel +
          opSelect(nid, oKey, CODE_OPS, sOp) + '</div>' +
        listBandHTML(nid, ci, cur, c)
      : sOp === 'matches'
      ? '<div class="criterion-controls">' + fieldSel +
          opSelect(nid, oKey, CODE_OPS, sOp) +
          vSlot('<input type="text" placeholder="SW*" spellcheck="false" ' +
            'value="' + esc(critValue(c, cur.key, null) || '') + '"' + ctl(nid, vKey) + '>') +
        '</div>' + patternNoteHTML(cur.kind)
      : '<div class="criterion-controls">' + fieldSel +
          opSelect(nid, oKey, CODE_OPS, sOp) +
          vSlot('<select' + ctl(nid, vKey) + '>' +
            SUBJECTS.map(function(s){ return opt(s, critValue(c, cur.key, null) || defaultSubject()); }).join('') +
          '</select>') + '</div>');

  } else if (cur.kind === 'courseCode') {
    var cOp = critOp(c, cur.key, 'eq');
    if (CODE_OPS.indexOf(cOp) === -1) cOp = CODE_OPS[0];
    body = (cOp === 'in'
      ? '<div class="criterion-controls two-col">' + fieldSel +
          opSelect(nid, oKey, CODE_OPS, cOp) + '</div>' +
        listBandHTML(nid, ci, cur, c)
      : cOp === 'matches'
      ? '<div class="criterion-controls stack">' + fieldSel +
          '<div class="cc-pair">' + opSelect(nid, oKey, CODE_OPS, cOp) +
            vSlot('<input type="text" placeholder="SWEN*" spellcheck="false" ' +
              'value="' + esc(critValue(c, cur.key, null) || '') + '"' + ctl(nid, vKey) + '>') +
          '</div></div>' + patternNoteHTML(cur.kind)
      : '<div class="criterion-controls stack">' + fieldSel +
          '<div class="cc-pair">' + opSelect(nid, oKey, CODE_OPS, cOp) +
            vSlot(courseSelect(nid, vKey, critValue(c, cur.key, null) || defaultCourse())) +
          '</div></div>');

  } else if (cur.kind === 'courseLevel') {
    /* A select rather than a number box: the levels are the handful the loaded
       files actually contain, and offering a free number invites "level 7",
       which every file answers with nothing. */
    var lOp = critOp(c, cur.key, 'eq');
    var lvlDef = { def: String(defaultLevel() || 4) };
    var lvlBox = function(key, val) {
      return '<select' + ctl(nid, key) + '>' +
        (LEVELS.length ? LEVELS : [1, 2, 3, 4]).map(function(v) {
          return opt(String(v), String(val), v + '00-level');
        }).join('') + '</select>';
    };
    body = (lOp === 'between' || lOp === 'in'
      ? '<div class="criterion-controls two-col">' + fieldSel +
          opSelect(nid, oKey, NUM_OPS, lOp) + '</div>' +
        (lOp === 'in'
          ? listBandHTML(nid, ci, cur, c)
          : rangeBandHTML(nid, ci, { key: cur.key, column: lvlDef }, c, lvlBox))
      : '<div class="criterion-controls">' + fieldSel +
          opSelect(nid, oKey, NUM_OPS, lOp) +
          vSlot(lvlBox(vKey, critValue(c, cur.key, lvlDef))) +
        '</div>');

  } else if (cur.kind === 'courseGrade') {
    // MARK_OPS rather than NUM_OPS: a mark in one named course is a threshold,
    // and the list operator has no meaning here. See the comment on MARK_OPS.
    var mOp = critOp(c, cur.key, 'gte');
    if (MARK_OPS.indexOf(mOp) === -1) mOp = 'gte';
    var markBox = function(key, val) {
      return '<input type="number" min="0" max="9" value="' + esc(val) + '"' + ctl(nid, key) + '>';
    };
    body = '<div class="criterion-controls stack">' + fieldSel +
      courseSelect(nid, 'crit.' + ci + '.course', c.course) +
      (mOp === 'between'
        ? opSelect(nid, oKey, MARK_OPS, mOp)
        : '<div class="cc-pair">' + opSelect(nid, oKey, MARK_OPS, mOp) +
            vSlot(markBox(vKey, critValue(c, cur.key, { def:'5' }))) + '</div>') +
      '</div>' +
      (mOp === 'between'
        ? rangeBandHTML(nid, ci, { key: cur.key, column: { def:'5' } }, c, markBox)
        : '');

  } else if (cur.kind === COLTYPE.NUMBER) {
    var nOp = critOp(c, cur.key, 'gt');
    var numBox = function(key, val) {
      return '<input type="number" value="' + esc(val) + '"' + ctl(nid, key) + '>';
    };
    // The single box gives way to the band rather than sitting beside it: Two
    // places to type a lower bound would be one too many, so with the range on
    // the row has only two cells and the operator can have the spare width.
    body = (nOp === 'between' || nOp === 'in'
      ? '<div class="criterion-controls two-col">' + fieldSel +
          opSelect(nid, oKey, NUM_OPS, nOp) + '</div>' +
        (nOp === 'in'
          ? listBandHTML(nid, ci, cur, c)
          : rangeBandHTML(nid, ci, cur, c, numBox))
      : '<div class="criterion-controls">' + fieldSel +
          opSelect(nid, oKey, NUM_OPS, nOp) +
          vSlot(numBox(vKey, critValue(c, cur.key, cur.column))) +
        '</div>');

  } else if (cur.kind === COLTYPE.ENUM || isRangeable(cur.column)) {
    var vals = (cur.column && cur.column.values) || (cur.column && cur.column.order) || [];
    // Enum criteria carry an operator too. Without one, "specialisation is NOT
    // Data Science" is unaskable. The engine has always supported it, but
    // there was no control to reach it with.
    var eOps = opsFor(cur.kind, cur.column);
    var eOp = critOp(c, cur.key, 'eq');
    if (eOps.indexOf(eOp) === -1) eOp = eOps[0];
    var enumOp = opSelect(nid, oKey, eOps, eOp);
    var pick = function(key, val) {
      return '<select' + ctl(nid, key) + '>' +
        vals.map(function(v){ return opt(v, String(val)); }).join('') + '</select>';
    };
    var valSel = vSlot(pick(vKey, critValue(c, cur.key, cur.column)));
    // Long option text (specialisations, course names) will not survive the
    // 80px field column, so those wrap onto their own row.
    var wide = vals.some(function(v){ return String(v).length > 8; });
    body = (eOp === 'between' || eOp === 'in'
      // Both bounds, or the whole list, live in the band, so the row is field
      // and operator only, and the operator gets the width its label needs,
      // wide values or not.
      ? '<div class="criterion-controls two-col">' + fieldSel + enumOp + '</div>' +
        (eOp === 'in'
          ? listBandHTML(nid, ci, cur, c)
          : rangeBandHTML(nid, ci, cur, c, pick))
      : wide
      ? '<div class="criterion-controls stack">' + fieldSel +
          '<div class="cc-pair">' + enumOp + valSel + '</div></div>'
      : '<div class="criterion-controls">' + fieldSel + enumOp + valSel + '</div>');

  } else {
    /* A column with no declared values: a name, or a number the schema does not
       type as one. There is nothing to tick, so the list is typed, and the band
       renders a text box instead of a grid. */
    var tOp = critOp(c, cur.key, 'eq');
    if (ENUM_OPS.indexOf(tOp) === -1) tOp = 'eq';
    body = (tOp === 'in'
      ? '<div class="criterion-controls two-col">' + fieldSel +
          opSelect(nid, oKey, ENUM_OPS, tOp) + '</div>' +
        listBandHTML(nid, ci, cur, c)
      : '<div class="criterion-controls">' + fieldSel +
          opSelect(nid, oKey, ENUM_OPS, tOp) +
          vSlot('<input type="text" value="' + esc(critValue(c, cur.key, cur.column)) + '"' + ctl(nid, vKey) + '>') +
        '</div>');
  }

  return '<div class="criterion-row">' + body + remove + '</div>';
}

/* A short name for an upstream node, for panels that must let the user point at
   one input rather than another. Compare labels its branches from the query
   that produced them, which needs results; this is needed at render time,
   before anything has run, so it names the node instead. */
var NODE_LABELS = {
  source:'Source', filter:'Filter', sort:'Sort', reverse:'Reverse', take:'Take',
  unique:'Unique', select:'Select', project:'Project',
  aggregate:'Aggregate', aggregateColumns:'Agg. Columns', aggregateRows:'Agg. Rows',
  combine:'Combine', compare:'Compare', selectFor:'Select For',
  histogram:'Histogram', output:'Output'
};
function upstreamLabel(node) {
  return (NODE_LABELS[node.type] || node.type) + ' #' + node.id;
}

/* THE FILE SECTION ON A SOURCE PANEL
   ---------------------------------------------------------------------------
   Two rows, in the order the two steps have to happen in, each showing what is
   currently held rather than only offering a button. A Source that says
   "headers.txt, 27 columns" and "mcs-students-2022, 2170 rows" is a Source
   whose answer can be checked against the files on disk, which is the whole
   reason the names are shown at all.

   The year button is disabled until a header is in hand. The ordering is a real
   constraint rather than a stylistic one (a year file is a list of fields with
   no names on it), so the control says so by being unavailable, and the hint
   underneath says why. */
/* WHAT A ROW MEANS HERE, IN THIS SOURCE'S OWN NUMBERS
   ---------------------------------------------------------------------------
   Project's panel "states the multiplication" rather than describing the
   setting, because the number is the part that goes wrong quietly. This is that
   sentence for the Source, and it is built from the files this Source is
   actually holding, so it reads as a fact about the data in front of the user
   rather than as a worked example they have to map onto it.

   With nothing loaded there is no multiplication to state, so it describes the
   shape instead. Saying "0 students become 0 rows" would be arithmetic about
   nothing dressed as information. */
function sourceGrainHint(node, data) {
  var enrolments = null, students = null;
  if (data && !data.synthetic && data.files && data.files.length) {
    enrolments = data.files.reduce(function(a, f){ return a + f.rows; }, 0);
    students   = data.files.reduce(function(a, f){ return a + f.students; }, 0);
  }

  if (sourceGrain(node).key === SOURCE_GRAINS[0].key) {
    return students === null
      ? 'A row is one student in one year, with their courses nested inside it.'
      : 'A row is one student in one year, so this Source emits <b>' + students +
        '</b> rows. Counting them counts people.';
  }
  return enrolments === null
    ? 'A row is one enrolment, so one student becomes one row per course they ' +
      'took. Counting them counts course registrations rather than people.'
    : '<b>' + students + '</b> students become <b>' + enrolments + '</b> rows, ' +
      'one per course taken. Counting them counts course registrations rather ' +
      'than people, and <b>ID</b> arrives as <b>Student</b> because it no longer ' +
      'identifies a row.';
}

/* WHAT A TABLE SOURCE EMITS, in place of Rows and Population.
   The archive Source states its multiplication because a row can mean two
   things there. A table Source's rows mean one thing only, so what is worth
   stating instead is the header it is handing on: the columns are the file's
   rather than the archive's, and which of them came through as numbers is the
   part that decides what can be measured, sorted or used as a band edge. */
function sourceTableShapeHTML(data) {
  var cols = data.columns || [];
  var nums = cols.filter(function(c){ return c.type === COLTYPE.NUMBER; });
  return '<div class="cfg-label">Out</div>' +
    '<div class="cmp-hint"><b>' + data.rows.length + '</b> row' +
      (data.rows.length === 1 ? '' : 's') + ', one per line of the file, under ' +
      cols.map(function(c){ return '<b>' + esc(c.label) + '</b>'; }).join(', ') + '. ' +
      (nums.length
        ? (nums.length === cols.length
            ? 'Every column reads as a number.'
            : nums.map(function(c){ return '<b>' + esc(c.label) + '</b>'; }).join(' and ') +
              ' read' + (nums.length === 1 ? 's' : '') + ' as a number; the rest as text.')
        : 'Every column reads as text.') +
    '</div>';
}

function sourceFilesHTML(node) {
  var id = node.id;
  var data = datasetFor(node);
  var header = headerFor(id);
  var want = datasetCfg(node);
  var notice = SOURCE_NOTICE[id];

  /* WHICH OF THE TWO SHAPES THIS SOURCE IS IN
     Decided by the header, not by a setting, so the panel describes what the
     node is actually holding. Before a header is loaded there is nothing to
     decide, and the archive is what the step names then: it is the file
     everyone starts with, and naming the general case first would describe the
     rare one. */
  var archive = !header || headerIsArchive(header);
  var wantsFile = header ? headerTargetOf(header.name) : '';

  var html = '<div class="cfg-label">Data files</div><div class="src-files">';

  // 1: The column file
  html += '<div class="src-file' + (header ? ' done' : '') + '">' +
    '<span class="src-step">1</span>' +
    '<span class="src-what">' +
      (header
        ? '<b>' + esc(header.name) + '</b><small>' +
            (header.columns.length
              ? header.columns.length + ' column' + (header.columns.length === 1 ? '' : 's') +
                (archive ? ', the archive\u2019s' : '')
              : 'built in') + '</small>'
        : '<b>' + esc(DATA_HEADERS_NAME) + '</b><small>not loaded</small>') +
    '</span>' +
    '<button class="src-btn" onclick="pickHeadersFile(' + id + ')">' +
      (header ? 'Replace' : 'Choose') + '</button>' +
  '</div>';

  /* 2: The year files.
     A list rather than one line of comma-separated names, because they are a
     collection the user adds to and takes from: each one has to be countable on
     its own and removable on its own. Naming them all in a single label made
     four files look like one thing that had to be re-picked whole. */
  var files = (data && !data.synthetic) ? data.files : [];
  var full = files.length >= MAX_YEAR_FILES;

  if (archive) {
    html += '<div class="src-file' + (files.length ? ' done' : '') + '">' +
      '<span class="src-step">2</span>' +
      '<span class="src-what">' +
        (files.length
          ? '<b>' + files.length + ' year file' + (files.length === 1 ? '' : 's') + '</b>' +
            '<small>' + files.reduce(function(a, f){ return a + f.rows; }, 0) + ' rows, ' +
            files.reduce(function(a, f){ return a + f.students; }, 0) + ' students</small>'
          : '<b>' + yearFileNameFor(want.years.length ? want.years[0] : 'YYYY') + '</b>' +
            '<small>' + (want.years.length
              ? (want.years.length === 1 ? 'wanted by this query'
                 : want.years.length + ' wanted by this query')
              : 'not loaded') + '</small>') +
      '</span>' +
      '<button class="src-btn"' + (header && !full ? '' : ' disabled') +
        ' title="' + (full ? esc('This Source is holding the most year files it can.')
                           : 'Choose one or more mcs-students-YYYY files') + '"' +
        ' onclick="pickYearFiles(' + id + ')">' +
        (files.length ? 'Add' : 'Choose') + '</button>' +
    '</div>';
  } else {
    /* One file, and the step says so by naming it in the singular and by
       offering Replace rather than Add. See buildTableDataset() for why these
       do not accumulate. The name the header was qualified with is shown while
       nothing is loaded, because that is the file this Source is asking for and
       the user has it on disk beside the header they just chose. */
    var one = files[0];
    html += '<div class="src-file' + (one ? ' done' : '') + '">' +
      '<span class="src-step">2</span>' +
      '<span class="src-what">' +
        (one
          ? '<b>' + esc(one.name) + '</b><small>' + one.rows + ' row' +
            (one.rows === 1 ? '' : 's') + '</small>'
          : '<b>' + esc(wantsFile || want.file || 'the data file') + '</b><small>' +
            (want.file ? 'wanted by this query' : 'not loaded') + '</small>') +
      '</span>' +
      '<button class="src-btn"' +
        ' title="' + esc(wantsFile
          ? 'Choose ' + wantsFile + ', the file this column file is named for'
          : 'Choose the data file these columns describe') + '"' +
        ' onclick="pickYearFiles(' + id + ')">' +
        (one ? 'Replace' : 'Choose') + '</button>' +
    '</div>';
  }

  /* Each loaded year, with the control that drops it. Indented under step 2
     rather than being three more numbered steps: they are the contents of one
     step, and numbering them would say the order they were chosen in matters. */
  if (archive && files.length) {
    html += '<div class="src-years">' + files.map(function(f) {
      return '<div class="src-year">' +
        '<span class="src-year-name">' + esc(f.name) + '</span>' +
        '<span class="src-year-count">' + f.students + ' students</span>' +
        '<button class="src-year-drop" title="' +
          esc('Remove ' + f.name + ' from this Source') + '"' +
          ' onclick="removeSourceYear(' + id + ',' + f.year + ')">x</button>' +
      '</div>';
    }).join('') + '</div>';
  } else if (archive && want.years.length > 1) {
    // Nothing loaded, but the saved query knows what it wants. Naming all of
    // them is the difference between re-picking the right files and guessing.
    html += '<div class="src-years">' + want.years.map(function(y) {
      return '<div class="src-year wanted">' +
        '<span class="src-year-name">' + esc(yearFileNameFor(y)) + '</span>' +
        '<span class="src-year-count">not loaded</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  html += '</div>';

  if (!header) {
    /* The naming rule and nothing else. Why the column file has to come first
       is explained in Help, under Loading the data; a panel states what to do,
       and this one is read while standing in front of a file picker. */
    html += '<div class="src-hint">Name it ' + esc(DATA_HEADERS_NAME) +
      ', or "headers-" then the data file\u2019s name and ".txt".</div>';
  } else if (!archive && !files.length) {
    /* Said only in the state where it explains something: a header that is not
       the archive's, with nothing read yet. It is the one moment the user can
       be surprised by which of the two shapes they are in. */
    html += '<div class="src-hint">These are not the archive\u2019s columns, so this ' +
      'file will come through as an ordinary table: one row per line, no ' +
      'students and no years.</div>';
  }
  if (data && !data.synthetic) {
    html += '<button class="src-clear" onclick="clearSourceData(' + id + ')">' +
      'Unload everything, including ' + esc(header ? header.name : DATA_HEADERS_NAME) +
      '</button>';
  }
  if (notice) {
    html += '<div class="src-notice ' + (notice.kind === 'error' ? 'bad' : 'ok') + '">' +
      esc(notice.text) + '</div>';
  }
  return html;
}

