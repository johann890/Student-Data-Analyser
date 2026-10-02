/* guide/steps.js: what the guided walkthrough says, and what it points at.

   THIS FILE IS DATA. It declares two names and no behaviour. Everything that
   reads them is in guide/guide.js, which names no step. Adding a step is
   inserting one object into the array below; reordering is moving it.

   Nothing is asked of the reader. An earlier version walked somebody through
   BUILDING a query, watching for each action and waiting, which fails entirely
   for a reader without the archive files to hand. The practice query is instead
   already built when the walkthrough starts, so every step is about something
   on screen at the moment it is read. The only controls are Back, Next and
   Close.

   The practice query is one of the worked examples from the library, not a
   second copy, so if the examples change this changes with them.

   THE RULE THAT KEEPS IT HONEST: a step may point at things and talk about
   them, but may not change the query. The one write the feature makes is
   loading the practice query at the start, which the reader asks for. onEnter
   may touch the view and the chrome (zoomToFit, showResultsPanel) and nothing
   else. 41-guide pins that by serialising the graph before and after. */

/* Which of LIB_EXAMPLES the walkthrough is about. Resolved at start time
   through libExampleGet(), so there is one copy of the query and it is the one
   the library offers. */
var GUIDE_EXAMPLE = 'ex-subject';

var GUIDE_STEPS = [
  {
    id: 'shape',
    target: '#canvas',
    title: 'This is a whole query',
    body: 'Three parts, wired left to right. Instead of writing a question in a language, you build it out of nodes and let the rows flow between them. This one asks for the students who took a subject.'
  },
  {
    id: 'source',
    node: function () { return guideNodeId('source', 0); },
    title: 'A Source is where the rows come from',
    body: 'Every query starts with one. It holds no data of its own: it remembers which files it was built against and asks for them again, which is why it says "not loaded" now.',
    onEnter: function () { zoomToFit(); }
  },
  {
    id: 'filter',
    node: function () { return guideNodeId('filter', 0); },
    title: 'The middle narrows things down',
    body: 'This Filter keeps the students who took anything in a subject and drops the rest. Its panel only offers columns that actually reach it, so a criterion you can set is one that can match.'
  },
  {
    id: 'output',
    node: function () { return guideNodeId('output', 0); },
    title: 'An Output is where the answer appears',
    body: 'Every query finishes at one. Without it the query has nowhere to put what it worked out, so nothing is shown. You can have several, each answering a different part of the same question.'
  },
  {
    id: 'wires',
    target: '#canvas',
    title: 'The wires are made by moving nodes, not drawn',
    body: 'There is nothing to click and drag between two nodes. Move one close to another and a wire appears on its own; the small x on a wire is what takes it away again.'
  },
  {
    id: 'run',
    target: '.run-btn',
    title: 'Nothing is worked out until you ask',
    body: 'No rows are read and nothing is calculated until you press Run Query. Until then the canvas is only a description of a question, so you can build and rearrange it freely.',
    onEnter: function () { closeProcMenu(); }
  },
  {
    id: 'results',
    target: '#outputPanel',
    title: 'The answer arrives here',
    body: 'One block per Output, as a table you can read, copy or save. Change anything on the canvas and the results say they are stale rather than quietly going out of date.',
    onEnter: function () { showResultsPanel(); }
  },
  {
    id: 'yours',
    target: '.add-btn.source',
    title: 'Now make it yours',
    body: 'Give this Source your own headers.txt and a year file and it will run. Or start again from the toolbar, and open the Library for three more worked examples to take apart.'
  }
];
