/* queries/library-examples.js: Worked example queries, and the cards they draw.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.

   WHY THESE ARE NOT IN THE LIBRARY
   ---------------------------------------------------------------------------
   The obvious place for an example query is the library, seeded on first run.
   Three things are wrong with that, and the third is the one that settles it.

   There is no API that takes a graph. libAdd() refuses when the canvas is empty
   and builds its entry from libEntryFor(), which calls serialiseGraph() on the
   CURRENT canvas. Seeding through it would mean loading each example onto the
   user's canvas at start-up and saving it, destroying whatever was there.

   libCleanEntry() returns exactly { id, name, savedAt, graph } and drops
   everything else, so an entry cannot be marked as a built-in without bumping
   LIB_VERSION, writing a migration, and changing three functions that 31-library
   pins. And seeded entries would count against LIB_MAX_ENTRIES, appear in the
   byte figure and in Export All, be renameable, and be deletable and then
   silently re-seeded on the next visit unless a second flag remembered that the
   user had deleted them.

   The store is the user's drawer. Writing to it unasked is the wrong default
   whatever the contents.

   So the examples live here, in the page, and the dialog draws them above the
   user's own grid. They cost no storage, cannot be deleted or renamed, never
   appear in an export, and they improve when the application does rather than
   being frozen in whatever version first wrote them. Opening one goes through
   loadGraphFromText(), the same loader a picked file goes through, so the
   version guard, the port resolution and the repair all apply without being
   written a second time.

   HOW TO CHANGE ONE
   ---------------------------------------------------------------------------
   Do not hand-edit the JSON below. Build the query in the running application,
   press Save, and paste the contents of the resulting file in as `graph`,
   changing nothing but the removal of `savedAt` (an example is not a moment in
   time). Every graph here was produced that way, by the shipped serialiser at
   FILE_VERSION 4, against the real archive. Regenerating after a format change
   is then "open it, re-save it" rather than "edit it and hope".

   Each carries a `why`, which is the one thing a user-saved card does not have
   and the reason these are worth shipping at all: the card says what the query
   is demonstrating, not merely what it is called.                            */

var LIB_EXAMPLES = [
  {
    id: 'ex-one-year',
    name: 'Every student in one year',
    why: "The smallest complete query there is: a Source and an Output, with nothing in between. Start here and add to it.",
    graph: {"kind":"student-data-analyser-query","version":4,"nodes":[{"id":1,"type":"source","x":120,"y":260,"color":"#ffffff","cfg":{"pop":"all","grain":"student","dataset":{"headers":"headers.txt","years":[2022],"file":""}}},{"id":2,"type":"output","x":450,"y":260,"color":"#30d87a","cfg":{"show":"rows","filename":"","cols":null,"panel":true}}],"connections":[{"from":1,"to":2,"port":"in","color":"#ffffff"}],"variables":[]}
  },
  {
    id: 'ex-subject',
    name: 'Students who took a subject',
    why: "One Filter narrowing the rows to the students who took anything in a subject. Change SWEN to any other code to ask it again.",
    graph: {"kind":"student-data-analyser-query","version":4,"nodes":[{"id":1,"type":"source","x":120,"y":260,"color":"#ffffff","cfg":{"pop":"all","grain":"student","dataset":{"headers":"headers.txt","years":[2022],"file":""}}},{"id":2,"type":"filter","x":450,"y":260,"color":"#30d87a","cfg":{"criteria":[{"field":"courses.subject","values":{"courses.subject":"SWEN"},"ops":{"courses.subject":"eq"},"course":"AIML231","vars":{}}]}},{"id":3,"type":"output","x":780,"y":260,"color":"#4aaff0","cfg":{"show":"rows","filename":"","cols":null,"panel":true}}],"connections":[{"from":1,"to":2,"port":"in","color":"#ffffff"},{"from":2,"to":3,"port":"in","color":"#ffffff"}],"variables":[]}
  },
  {
    id: 'ex-spread',
    name: 'How the GPAs are spread',
    why: "A Distribution node counting students into bands one grade point wide, which is the shape of the cohort rather than a list of it.",
    graph: {"kind":"student-data-analyser-query","version":4,"nodes":[{"id":1,"type":"source","x":120,"y":260,"color":"#ffffff","cfg":{"pop":"all","grain":"student","dataset":{"headers":"headers.txt","years":[2022],"file":""}}},{"id":2,"type":"histogram","x":450,"y":260,"color":"#30d87a","cfg":{"by":"gpa","width":"1","stats":[{"op":"count","col":""}],"vars":{}}},{"id":3,"type":"output","x":780,"y":260,"color":"#4aaff0","cfg":{"show":"rows","filename":"","cols":null,"panel":true}}],"connections":[{"from":1,"to":2,"port":"in","color":"#ffffff"},{"from":2,"to":3,"port":"in","color":"#ffffff"}],"variables":[]}
  },
  {
    id: 'ex-compare',
    name: 'Two subjects side by side',
    why: "The query forks: two Filters off one Source, both arriving at a Compare. Each branch keeps its own label in the answer.",
    graph: {"kind":"student-data-analyser-query","version":4,"nodes":[{"id":1,"type":"source","x":120,"y":260,"color":"#ffffff","cfg":{"pop":"all","grain":"student","dataset":{"headers":"headers.txt","years":[2022],"file":""}}},{"id":2,"type":"filter","x":450,"y":150,"color":"#30d87a","cfg":{"criteria":[{"field":"courses.subject","values":{"courses.subject":"SWEN"},"ops":{"courses.subject":"eq"},"course":"AIML231","vars":{}}]}},{"id":3,"type":"filter","x":450,"y":370,"color":"#4aaff0","cfg":{"criteria":[{"field":"courses.subject","values":{"courses.subject":"COMP"},"ops":{"courses.subject":"eq"},"course":"AIML231","vars":{}}]}},{"id":4,"type":"compare","x":780,"y":260,"color":"#e060b0","cfg":{"measures":["count","average"],"sort":"wired","labels":{"2":"SWEN","3":"COMP"}}},{"id":5,"type":"output","x":1110,"y":260,"color":"#a0d040","cfg":{"show":"lists","filename":"","cols":null,"panel":true}}],"connections":[{"from":1,"to":2,"port":"in","color":"#ffffff"},{"from":1,"to":3,"port":"in","color":"#ffffff"},{"from":2,"to":4,"port":"in","color":"#ffffff"},{"from":3,"to":4,"port":"in","color":"#ffffff"},{"from":4,"to":5,"port":"in","color":"#ffffff"}],"variables":[]}
  }
];

function libExampleGet(id) {
  for (var i = 0; i < LIB_EXAMPLES.length; i++) {
    if (LIB_EXAMPLES[i].id === id) return LIB_EXAMPLES[i];
  }
  return null;
}

/* The same card as a saved query, minus the three buttons that would be lying:
   an example cannot be renamed, deleted or exported. libThumb() takes a plain
   graph object rather than an entry, which is what lets the picture be drawn
   with no store involved. */
function libExampleCardHTML(ex) {
  var n = (ex.graph && Array.isArray(ex.graph.nodes)) ? ex.graph.nodes.length : 0;
  var pend = !!(libPending && libPending.action === 'example' && libPending.id === ex.id);
  return '<div class="lib-card lib-example">' +
    '<div class="lib-thumb">' + libThumb(ex.graph) + '</div>' +
    '<div class="lib-meta">' +
      '<div class="lib-name" title="' + esc(ex.name) + '">' + esc(ex.name) + '</div>' +
      '<div class="lib-sub">' + n + ' node' + (n === 1 ? '' : 's') + '</div>' +
      '<div class="lib-why">' + esc(ex.why) + '</div>' +
    '</div>' +
    '<div class="lib-actions">' +
      '<button class="lib-go" onclick="libOpenExample(\'' + ex.id + '\', this)" ' +
        'title="Put this query on the canvas">' + (pend ? 'Replace?' : 'Open') + '</button>' +
    '</div>' +
  '</div>';
}

function libExamplesHTML() {
  if (!LIB_EXAMPLES.length) return '';
  return '<div class="lib-section">' +
    '<h4 class="lib-section-head">Examples</h4>' +
    '<p class="lib-section-note">Four queries to open and take apart. Each one asks for ' +
      'headers.txt and one year file, the same as any saved query does.</p>' +
    '<div class="lib-grid">' + LIB_EXAMPLES.map(libExampleCardHTML).join('') + '</div>' +
  '</div>';
}

/* The same guard libOpenEntry() uses, for the same reason: opening replaces the
   canvas, and there is no undo. An example is not special enough to skip it. */
function libOpenExample(id, btn) {
  var ex = libExampleGet(id);
  if (!ex) return;

  if (nodes.length && !(libPending && libPending.action === 'example' && libPending.id === id)) {
    libPending = { action: 'example', id: id };
    libSay(null, '');
    renderLibrary();
    return;
  }

  libPending = null;
  closeLibrary();
  /* No lastQueryName. Saving after opening an example should offer a name of
     the user's own, not quietly propose overwriting a file named after
     something they did not write. */
  loadGraphFromText(JSON.stringify(ex.graph), btn);
}
