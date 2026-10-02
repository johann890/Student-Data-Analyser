/* queries/library-examples.js: worked example queries, and the cards they draw.

   These are NOT seeded into the library. There is no API that takes a graph:
   libAdd() refuses an empty canvas and builds its entry from libEntryFor(),
   which serialises the CURRENT canvas, so seeding would mean loading each
   example onto the user's canvas at start-up. libCleanEntry() also returns
   exactly { id, name, savedAt, graph }, so an entry cannot be marked built-in
   without bumping LIB_VERSION and a migration, and seeded entries would count
   against LIB_MAX_ENTRIES, appear in Export All, and be deletable and then
   re-seeded on the next visit.

   So they live here in the page, and the dialog draws them above the user's own
   grid. They cost no storage, never appear in an export, and improve with the
   application rather than being frozen at whatever version wrote them. Opening
   one goes through loadGraphFromText(), the same loader a picked file uses, so
   the version guard, port resolution and repair all apply.

   TO CHANGE ONE: do not hand-edit the JSON. Build the query in the running
   application, press Save, and paste the file's contents in as `graph`,
   removing only `savedAt`. Every graph here was produced that way by the
   shipped serialiser at FILE_VERSION 4.

   Each carries a `why`, which is what a user-saved card does not have: the card
   says what the query demonstrates, not just what it is called. */

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
