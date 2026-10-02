# Student-Data-Analyser
ENGR489 Honours Project for a Student Data Analyser using mock data

Download MVP folder and run HTML file for Usability testing.

## Layout

- `MLP/` is the current milestone: open `MLP/index.html`. The page is one file;
  the stylesheet is `MLP/css/` and the application is `MLP/js/`, both loaded by
  the lists in that page. Those lists are the load order and it is load-bearing.
- `MMP/` and `MVP/` are the earlier milestones, kept as they were delivered.
- `build/` makes the thing to hand over. `node build/build.js` folds those 50
  files into one self-contained `build/student-data-analyser.html` that runs on
  its own, with nothing beside it. Building twice from the same source gives the
  same bytes, so re-run it after any change to `MLP/`.
- `data/` is the archive the Sources are given. `tests/` is the suite: `npm test`
  inside it runs against the newest milestone folder present.
