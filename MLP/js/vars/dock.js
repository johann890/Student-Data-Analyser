/* vars/dock.js: the toolbar menu the variables live in, and the two repaints
   it needs.

   A dropdown rather than a panel pinned to the canvas: a variable is set before
   a run and then left alone, so a permanent panel spends canvas on something
   nobody is looking at. It also keeps the variables out of the graph, which was
   the supervisor's constraint, and a dropdown cannot be dragged into the middle
   of a dataflow the way a placeable panel eventually would be.

   A closed menu still shows the count on the button, which is the part that
   matters: somebody opening a query written by somebody else needs to know it
   is parameterised before they run it. The load message names the variables for
   the same reason, and a bound operand is yellow whether the menu is open or
   not.

   The machinery is .proc-menu's, which the node menus already use: opening one
   closes the others, a click elsewhere closes them all, and a click inside is
   stopped so typing in a field cannot dismiss the menu the field is in.

   TWO REPAINTS, NOT ONE
   renderVariables() rebuilds the chips and runs when the LIST changes: added,
   removed, loaded, cleared. syncVarUsage() rewrites only the usage lines and
   runs when the GRAPH changes, from render(), because deleting a node changes
   what a variable is used by without changing the variable.

   They are separate for the same reason syncSelectionUI() is separate from
   render(): a rebuild destroys the input the user is typing in. Each chip holds
   two text fields, and node panels repaint on every keystroke. */

/* Which delete button has been pressed once and is waiting to be pressed again.
   Held here rather than on the button so that any other edit clears it: a
   half-asked question about one variable must not be answerable after the user
   has moved on to another. */
var varPending = null;

function varDockEl()  { return document.getElementById('varDock'); }
function varBodyEl()  { return document.getElementById('varBody'); }
function varMenuOpen() {
  var d = varDockEl();
  return !!(d && d.classList.contains('open'));
}

/* The dock's one line of feedback, for the two things it has to refuse: a
   thirteenth variable, and removing one that is in use before the question has
   been answered. Cleared by the next repaint, so it never outlives the state it
   was describing. */
function varDockSay(text) {
  var el = document.getElementById('varNotice');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('show', !!text);
}

function varFocus(id, which) {
  var el = document.querySelector('[data-var-' + which + '="' + id + '"]');
  if (el && el.focus) { el.focus(); if (el.select) el.select(); }
}

/* Opening it puts the caret somewhere useful rather than leaving focus on the
   button: in the first name field when there are variables to edit, and on Add
   when there are none, which is the only thing there is to do with an empty
   list. toggleProcMenu does the opening; this adds what is particular to a menu
   you type in rather than pick from. */
function toggleVarMenu(e) {
  // The open, the close and the button's aria-expanded are all toggleProcMenu's:
  // this menu shuts by four routes and only one of them comes through here.
  toggleProcMenu(e, 'varDock');
  if (!varMenuOpen()) return;
  if (variables.length) varFocus(variables[0].id, 'name');
  else {
    var add = document.getElementById('varAddBtn');
    if (add && add.focus) add.focus();
  }
}

/* ONE CHIP
   name = value, and a line underneath saying where the value is going. The
   equals sign is drawn rather than implied: it is the whole of what a variable
   is, and two boxes side by side with a gap between them say nothing.

   The delete button carries the same x the criterion and connection controls
   use, so the gesture for "remove this row" is the one gesture everywhere. */
function varChipHTML(v) {
  var uses = varUsage(v);
  var clash = varNameClashes(v);
  var asking = varPending === v.id;

  var note;
  if (asking) {
    note = uses.length
      ? 'Used by ' + varUseWords(uses) + '. Press x again to remove it and put the ' +
        'typed values back.'
      : 'Press x again to remove it.';
  } else if (clash) {
    note = 'Another variable has this name. Rename one of them.';
  } else if (!varName(v) || varName(v) === 'unnamed') {
    note = 'Give it a name.';
  } else if (!uses.length) {
    note = 'Not used yet.';
  } else {
    note = 'Used by ' + varUseWords(uses) + '.';
  }

  return '<div class="var-chip' + (asking ? ' asking' : '') +
      (clash ? ' clash' : '') + '" data-var="' + v.id + '">' +
    '<div class="var-line">' +
      '<input type="text" class="var-name" spellcheck="false" autocomplete="off" ' +
        'maxlength="' + VAR_NAME_MAX + '" placeholder="name" aria-label="Variable name" ' +
        'data-var-name="' + v.id + '" value="' + esc(v.name) + '">' +
      '<span class="var-eq">=</span>' +
      '<input type="text" class="var-value" spellcheck="false" autocomplete="off" ' +
        'maxlength="' + VAR_VALUE_MAX + '" placeholder="value" aria-label="Variable value" ' +
        'data-var-value="' + v.id + '" value="' + esc(v.value) + '">' +
      '<button class="var-del" onclick="requestRemoveVariable(' + v.id + ')" ' +
        'title="Remove this variable" aria-label="Remove this variable">x</button>' +
    '</div>' +
    '<div class="var-note" data-var-note="' + v.id + '">' + esc(note) + '</div>' +
  '</div>';
}

/* What a variable reaches, as a sentence: the KINDS of node, not which ones.

   This used to name each node, number and all, and the number was the part
   that did not earn its place. A reader asking "what does changing this break"
   wants the sort of thing it reaches, and the canvas already shows them which
   nodes those are: a bound setting is drawn in the variable's own colour, so
   the nodes are pointed at by the thing they are bound to. Printing the ids as
   well made the note grow with the query ("Filter #3, Filter #7 and Filter
   #11") to say one thing: Filter.

   Dropping the number is also what makes the de-duplication below mean
   something. It was already here, but two Filters had two different labels, so
   it only ever collapsed the same node bound twice. On the type it collapses
   the case it was written for. */
function varUseWords(uses) {
  var seen = [], out = [];
  uses.forEach(function(u) {
    var label = NODE_LABELS[u.node.type] || u.node.type;
    if (seen.indexOf(label) !== -1) return;
    seen.push(label);
    out.push(label);
  });
  return listWords(out);
}

function renderVariables() {
  var dock = varDockEl(), body = varBodyEl();
  if (!dock || !body) return;

  /* The panels pay for the chip out of their own width, and only while there is
     something to bind. Set on <body> rather than on each panel because it is one
     fact about the query, and a stylesheet is where a layout consequence of it
     belongs. */
  if (document.body) document.body.classList.toggle('has-vars', variables.length > 0);

  /* On the button, so a closed menu still says the query is parameterised.
     Empty text rather than a "0", because nothing at all is the plainer
     statement and the badge then disappears instead of reading as a score. */
  var count = document.getElementById('varCount');
  if (count) count.textContent = variables.length ? String(variables.length) : '';
  var btn = document.getElementById('varBtn');
  if (btn) btn.classList.toggle('has-vars', variables.length > 0);

  var add = document.getElementById('varAddBtn');
  if (add) add.disabled = variables.length >= VAR_MAX;

  body.innerHTML = variables.length
    ? variables.map(varChipHTML).join('')
    /* The empty state carries the whole of what the feature is, because it is
       the only thing a first-time reader sees and a menu holding a bare + button
       would be a dropdown asking to be guessed at. */
    : '<div class="var-empty">Name a value once and use it in several nodes: ' +
      'a Filter, a Take, a Histogram.</div>';

  varDockSay('');
}

/* What changes when the GRAPH changes rather than the list: which nodes each
   variable reaches. Text only, so the fields keep their contents and their
   carets, which is the whole reason this is not just another renderVariables(). */
function syncVarUsage() {
  if (!varBodyEl()) return;
  variables.forEach(function(v) {
    var note = document.querySelector('[data-var-note="' + v.id + '"]');
    if (!note || varPending === v.id) return;
    var uses = varUsage(v);
    if (varNameClashes(v)) { note.textContent = 'Another variable has this name. Rename one of them.'; return; }
    if (!varName(v) || varName(v) === 'unnamed') { note.textContent = 'Give it a name.'; return; }
    note.textContent = uses.length ? 'Used by ' + varUseWords(uses) + '.' : 'Not used yet.';
  });
}

/* REMOVING ONE, WITH A QUESTION FIRST WHEN IT IS IN USE
   An unused variable is nothing to lose, so it goes on the first press. One
   that three nodes are reading is three settings about to change at once, and
   there is no undo, so the press asks first and the note says what it would
   break. The same "press again" shape the library uses for a replace, rather
   than a modal card, because the question is small and the answer is in the
   same place as the button. */
function requestRemoveVariable(id) {
  var v = varById(id);
  if (!v) return;
  if (varPending === id || varUsedCount(v) === 0) { removeVariable(id); return; }
  varPending = id;
  renderVariables();
}

/* Typing in a chip. The name and the value are both stored as typed, and both
   repaint the canvas: an operand bound to this variable prints its name and its
   value in the slot, and the hints that state what a node will do ("the first
   25 rows") are built from the value.

   Repainting the canvas on every keystroke is safe here and is not elsewhere.
   The field being typed into belongs to the menu, and render() rebuilds only
   the nodes, so nothing the user is holding is taken away. A number box inside
   a config panel cannot do this, which is why those repaint on change instead. */
function onVarInput(e) {
  var el = e.target;
  if (!el || !el.getAttribute) return;
  var nameId = el.getAttribute('data-var-name');
  var valId  = el.getAttribute('data-var-value');
  if (!nameId && !valId) return;

  // A half-answered "remove this?" belongs to the press that asked it.
  varPending = null;

  if (nameId) setVarName(nameId, el.value);
  else        setVarValue(valId, el.value);

  render();
  syncVarUsage();
  varDockSay('');
}
