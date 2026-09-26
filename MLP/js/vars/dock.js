/* vars/dock.js: The toolbar menu the variables live in, and the two repaints
   it needs.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   THE VARIABLES MENU
   ============================================================================
   A dropdown in the toolbar. It was a panel pinned to the top left of the
   canvas first, and that was the wrong place for it: a variable is set before a
   run and then left alone, so a panel showing them permanently spends canvas on
   something nobody is looking at. Behind a button it costs nothing until it is
   asked for, and the canvas is left to the query.

   The separation the supervisor asked for is stronger here rather than weaker.
   His constraint was that the variables must not read as part of the graph, and
   the toolbar is not the graph at all: the query is the method, the toolbar
   holds what is declared about it. A dropdown cannot be dragged into the middle
   of a dataflow, which a placeable panel eventually would be.

   WHAT A CLOSED MENU STILL SAYS
   ---------------------------------------------------------------------------
   The count, on the button. That is the whole of what is lost by hiding the
   list, and it is the part that matters: somebody opening a query written by
   somebody else has to know it is parameterised before they run it. The load
   message names the variables for the same reason, and a bound operand is
   yellow on the panel whether this menu is open or not.

   The machinery is .proc-menu's, which the node menus already use: opening one
   closes the others, a click anywhere else closes them all, and the markup
   stops a click inside from reaching that listener, so typing in a field cannot
   dismiss the menu the field is in.

   TWO REPAINTS, NOT ONE
   ---------------------------------------------------------------------------
   renderVariables() rebuilds the chips and is called when the LIST changes:
   added, removed, loaded, cleared. syncVarUsage() rewrites only the lines that
   describe usage and is called when the GRAPH changes, from render(), because
   deleting a node changes what a variable is used by without changing the
   variable.

   They are separate for the same reason syncSelectionUI() is separate from
   render(): a rebuild destroys the input the user is typing in. Every chip
   holds two text fields, and the value in one of them is read by node panels
   that repaint on every keystroke. Repainting the chips as well would take the
   field away mid-word.                                                       */

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

/* The nodes a variable reaches, as a sentence. Named by node rather than by
   setting once a node holds more than one binding, because "Filter #3" twice
   over reads as a mistake in the tool. */
function varUseWords(uses) {
  var seen = [], out = [];
  uses.forEach(function(u) {
    var label = upstreamLabel(u.node);
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
   ---------------------------------------------------------------------------
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
