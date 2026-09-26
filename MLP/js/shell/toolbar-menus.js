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
function closeProcMenu() {
  procMenus().forEach(function(m){ m.classList.remove('open'); });
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
}
function addProcNode(type) {
  closeProcMenu();
  addNode(type);
}
