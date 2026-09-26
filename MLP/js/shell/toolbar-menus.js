/* shell/toolbar-menus.js: the Reshape, Processing and Distribution dropdowns.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */

/* THE NODE MENUS
   Processing nodes are a growing family, so they live behind dropdowns rather
   than adding a toolbar button each. There are two, split on colour: Reshape
   holds the violet nodes and is violet itself, Processing holds the other three
   families and stays neutral because it cannot honestly claim one of them.
   Written against every .proc-menu rather than a named one, so a third menu is
   markup and needs no change here. Opening one closes the others: two open
   dropdowns overlap, and the second would look like a submenu of the first. */
function procMenus() {
  return Array.prototype.slice.call(document.querySelectorAll('.proc-menu'));
}

/* Tell the button whether its menu is open, for any button that says it wants
   to be told. A menu closes down four different paths (its own button, another
   menu opening, Escape, a click anywhere else) and only one of them ran through
   the button, so the attribute went stale on the other three and a screen
   reader was told the menu was open while it was not.

   Written against whatever declares `aria-controls` and already carries
   `aria-expanded`, rather than against a named button, so it is inert for the
   three node buttons (which declare neither) and correct for any button added
   later that does. */
function syncMenuButtons() {
  procMenus().forEach(function(m) {
    var btn = m.id && document.querySelector('[aria-controls="' + m.id + '"]');
    if (!btn || !btn.hasAttribute('aria-expanded')) return;
    btn.setAttribute('aria-expanded', m.classList.contains('open') ? 'true' : 'false');
  });
}

function closeProcMenu() {
  procMenus().forEach(function(m){ m.classList.remove('open'); });
  syncMenuButtons();
}
function toggleProcMenu(e, id) {
  // Without this the document listener below sees the same click and closes the
  // menu in the tick it was opened.
  if (e) e.stopPropagation();
  var wanted = document.getElementById(id);
  procMenus().forEach(function(m) {
    if (m === wanted) m.classList.toggle('open');
    else m.classList.remove('open');
  });
  syncMenuButtons();
}
function addProcNode(type) {
  closeProcMenu();
  addNode(type);
}
