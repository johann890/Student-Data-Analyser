/* vars/operand.js: One settable value in a config panel, which is either typed
   or taken from a variable.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   THE OPERAND SLOT
   ============================================================================
   Every place a variable may be used goes through here, so the gesture is the
   same on a filter's threshold, on either end of a range, on a Take's row count
   and on a Histogram's band width. A panel asks for the slot and hands it the
   control it would otherwise have drawn; the slot decides whether to draw it.

   TWO STATES, ONE CELL
   ---------------------------------------------------------------------------
   Typed:  the panel's own control, with a small yellow chip beside it. The chip
           is the only new thing on a panel, and it is only there while there is
           a variable to bind, so a query that uses none looks exactly as it did.
   Bound:  a select naming the variables, in the control's place, with the value
           it currently carries underneath it. The control is replaced rather
           than disabled beside it, because two boxes offering the same number
           leave the user to work out which one is being obeyed.

   Unbinding is the first option in that select rather than a second button. It
   is the same control answering the same question ("where does this value come
   from"), and the typed value is still in the model, so going back finds what
   was there rather than a default.

   WHY THE VALUE IS PRINTED UNDER THE SELECT
   ---------------------------------------------------------------------------
   The name alone does not say what the node will do, and the menu that does say
   is shut nearly all the time. A panel here states what it is about to do
   everywhere else, and an operand reading "v1" with no number beside it would
   be the one control that does not.                                    */

/* nodeId   the node whose panel this is
   holder   where the binding lives: the node's cfg, or one criterion
   key      the key inside holder.vars, which is the key the literal is under
   bindKey  the data-key the select writes through, routed by setCfg
   literal  the HTML of the control the panel would have drawn                */
function operandHTML(nodeId, holder, key, bindKey, literal) {
  var bound = boundVar(holder, key);

  if (bound) {
    var val = String(bound.value == null ? '' : bound.value).trim();
    return '<span class="var-slot bound">' +
      '<select class="var-pick"' + ctl(nodeId, bindKey) +
          ' title="' + esc(varLabel(bound)) + '">' +
        /* Empty value, so setBinding clears the binding without a second path:
           anything that does not name a live variable means "typed". */
        '<option value="">a typed value</option>' +
        variables.map(function(v) {
          return '<option value="' + v.id + '"' + (v.id === bound.id ? ' selected' : '') + '>' +
            esc(varName(v)) + '</option>';
        }).join('') +
      '</select>' +
      /* An empty variable is named as empty rather than left blank. It is the
         reason a query will refuse to run, and a gap on the panel is not a
         reason anybody can act on. */
      '<em class="var-shown' + (val ? '' : ' none') + '">' +
        esc(val || '(empty)') + '</em>' +
    '</span>';
  }

  // No variables declared, so there is nothing to offer and no chip to explain.
  if (!variables.length) return literal;

  /* data-node and data-key rather than an inline onclick, which is what every
     other control on a panel carries and what the delegated listener reads. Not
     only for consistency: a bind key ends in a column key, which comes out of a
     header file, and writing one into an inline JavaScript string would put a
     quotation mark from that file inside a string literal. Attributes are
     escaped by esc(); a string literal inside an attribute would need escaping
     twice, in two languages, and the second pass is the one that gets
     forgotten. */
  return '<span class="var-slot">' + literal +
    '<button class="var-use"' + ctl(nodeId, bindKey) + ' ' +
      'title="Take this value from a variable" aria-label="Take this value from a variable">$</button>' +
  '</span>';
}

/* The chip's press, delegated from the canvas beside onConfigInput. A button
   fires neither input nor change, so it needs a listener of its own rather than
   a branch inside that one. */
function onVarChipClick(e) {
  var btn = e.target && e.target.closest ? e.target.closest('.var-use') : null;
  if (!btn) return;
  useVariableAt(parseInt(btn.getAttribute('data-node'), 10), btn.getAttribute('data-key'));
}

/* It binds to the FIRST variable rather than opening a menu to choose from:
   with one declared, which is the common case, a menu would be a question with
   one answer, and with several the select it turns into is already the right
   place to change the choice. */
function useVariableAt(nodeId, bindKey) {
  if (!variables.length) return;
  setCfg(nodeId, bindKey, variables[0].id);
  markStale();
  render();
  focusCfg(nodeId, bindKey);
}

/* The two keys a criterion's operands bind under: the plain field key for the
   single value and the low bound, and the range key for the high one. Written
   here so the panel and setCfg's parser cannot disagree about the spelling. */
function critBindKey(ci, valueKey) { return 'crit.' + ci + '.var:' + valueKey; }
function cfgBindKey(cfgKey)        { return 'var:' + cfgKey; }
