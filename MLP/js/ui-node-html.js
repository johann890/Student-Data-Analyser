/* ui-node-html.js: The markup for a node: its config panel, its ports and its shape.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
function configHTML(node, schemas) {
  var id = node.id;
  var cfg = node.cfg = node.cfg || defaultCfg(node.type);
  var schema = inputSchema(node, schemas);
  var html = '<div class="node-config">';

  if (node.type === 'source') {
    html += sourceFilesHTML(node);

    /* The population offers THIS Source's years, not every year loaded anywhere
       on the canvas. Offering a year this Source cannot answer would be
       offering an empty result dressed as a choice. */
    var data = datasetFor(node);
    var years = data ? data.years : [];

    /* Rows and Population are facts about STUDENTS: one asks whether a row is a
       student or an enrolment, the other which cohort. A table Source has
       neither, so the controls are absent rather than present and ignored. A
       disabled control says "not yet"; no control says "not here", and the
       second is the true one. */
    if (isTableDataset(data)) return html + sourceTableShapeHTML(data) + '</div>';

    /* Before Population, because it is the larger question. Population narrows
       a set of rows; this decides what a row IS, and every count downstream
       means something different depending on the answer. The same reasoning
       puts "Show in results panel" at the top of an Output's panel. */
    var grain = sourceGrain(node);
    html += '<div class="cfg-label">Rows</div>' +
      '<select' + ctl(id, 'grain') + '>' +
        SOURCE_GRAINS.map(function(g) {
          return opt(g.key, grain.key, g.label);
        }).join('') +
      '</select>';
    /* States the multiplication rather than describing the setting, which is
       what Project's panel does and for the same reason: the number is the
       part that goes wrong silently. The student count is read from the files
       this Source is actually holding, so it is this Source's multiplication
       and not a worked example. */
    html += '<div class="cmp-hint">' + sourceGrainHint(node, data) + '</div>';

    html += '<div class="cfg-label">Population</div>' +
      '<select' + ctl(id, 'pop') + (years.length ? '' : ' disabled') + '>' +
        opt('all', cfg.pop, 'All students') +
        years.map(function(y){ return opt(String(y), cfg.pop, y + ' only'); }).join('') +
      '</select>';
  }

  if (node.type === 'filter') {
    html += '<div class="criteria-list">' +
      cfg.criteria.map(function(c, ci){ return criterionHTML(node, ci, c, schema); }).join('') +
    '</div>' +
    '<button class="add-criterion-btn" onclick="addCriterion(' + id + ')">+ add condition</button>';
  }

  if (node.type === 'compare') {
    var inIds = inputsOf(id);
    var labels = cfg.labels || {};
    html += '<div class="cfg-label">Branches (' + inIds.length + ')</div>';
    if (inIds.length === 0) {
      html += '<div class="cmp-hint">Drag a Source or Filter next to this node to add a branch.</div>';
    } else {
      if (inIds.length === 1) {
        html += '<div class="cmp-hint">One branch connected. Add another to compare against.</div>';
      }
      html += '<div class="cmp-branches">';
      inIds.forEach(function(inId, i) {
        var up = findNode(inId);
        html += '<div class="cmp-branch">' +
          '<span class="cmp-swatch" style="background:' + (up ? getNodeEdgeColor(up) : '#555') + '"></span>' +
          '<input type="text" class="cmp-label-input" placeholder="Branch ' + (i + 1) + ' (auto)" ' +
            'value="' + esc(labels[inId] || '') + '"' + ctl(id, 'label:' + inId) + '>' +
        '</div>';
      });
      html += '</div>';
    }

    var picked = measuresOf(node);
    html += '<div class="cfg-label">Columns to show</div><div class="cmp-measures">' +
      MEASURES.map(function(m) {
        return '<label class="cmp-measure">' +
          '<input type="checkbox"' + (picked.indexOf(m.key) !== -1 ? ' checked' : '') +
            ctl(id, 'measure:' + m.key) + '>' +
          '<span>' + esc(m.label) + '</span></label>';
      }).join('') +
    '</div>' +
    /* Said at the boxes and not only in the Help. A group headed "Columns"
       names what the list is about and not what ticking one does, and that is
       the question the supervisor asked of it: he could see the boxes change
       and could not see what they were for. The second sentence is the other
       half of the same question. These three are measures, so each one is a
       figure that has to be worked out; the box cannot answer until the query
       runs, and saying so is cheaper than leaving the reader to infer it from
       a dimmed panel. */
    '<div class="cmp-hint">Each ticked box is one column of the result. ' +
      'Re-run the query to fill in a column you have just ticked.</div>' +
    '<div class="cfg-label">Order</div>' +
    '<select' + ctl(id, 'sort') + '>' +
      opt('wired', cfg.sort, 'As connected') +
      opt('desc',  cfg.sort, 'Highest first') +
      opt('asc',   cfg.sort, 'Lowest first') +
      opt('label', cfg.sort, 'Label A–Z') +
    '</select>';
    // Named only when an order that actually ranks is chosen.
    if (cfg.sort === 'desc' || cfg.sort === 'asc') {
      html += '<div class="cmp-hint">Ranked by the first ticked column.</div>';
    }
    /* The columns named here follow the tick boxes immediately, which is what
       makes the boxes legible: a run is not needed to see what they do. */
    html += '<div class="cmp-hint">Out: one row per branch \u2014 ' +
      compareColumns(measuresOf(node)).map(function(c){ return '<b>' + esc(c.label) + '</b>'; }).join(', ') +
      '.</div>';
  }

  if (node.type === 'selectFor') {
    /* `schema` is the DATA port, because data is the primary port. The labels
       branch is fetched separately and only when something is actually wired
       to it: inputSchema() falls back to the student header when a port is
       empty, which is right for a panel describing the rows and wrong for one
       asking which column holds the labels. It would offer 27 columns of a
       table that is not there. */
    var labelWires = inputsOf(id, 'labels');
    var lschema = labelWires.length ? inputSchema(node, schemas, 'labels') : null;
    var bands = selectForUsesBands(node, lschema);

    /* The "For each" list follows the reading. In bands mode the node is
       putting a NUMBER in ranges, which is binField()'s question and
       binField()'s set of columns; offering "Specialisation" there would offer
       a group that can never match a band. Two readings, two lists, one
       stored key, resolved by whichever resolver the reading calls for. */
    if (bands) {
      var bcols = binnableCols(schema);
      var bf = binField(node, schema);
      if (!bcols.length) {
        html += '<div class="cmp-hint">No number in this table to put in bands. ' +
          'Wire a table with a numeric column into <b>Data</b>.</div>';
      } else {
        html += '<div class="cfg-label">Put in bands</div>' +
          '<select' + ctl(id, 'by') + '>' +
            bcols.map(function(c) {
              return opt(c.key, bf ? bf.key : '', c.label);
            }).join('') +
          '</select>';
      }
    } else {
      var gfields = groupFields(schema);
      var gf = groupField(node, schema);
      if (!gfields.length) {
        html += '<div class="cmp-hint">Nothing to group by. Wire a table into ' +
          '<b>Data</b>.</div>';
      } else {
        html += '<div class="cfg-label">For each</div>' +
          '<select' + ctl(id, 'by') + '>' +
            gfields.map(function(f) {
              return opt(f.key, gf ? gf.key : '', f.label);
            }).join('') +
          '</select>';
      }
    }

    /* Where the groups come from is decided by a wire rather than by a
       control, so it is the one thing the settings cannot show. Said in one
       line while the port is empty, and dropped once it is wired, because a
       connected port describes itself: the picker below it names the column
       the labels are read from. What the port BUYS (zero-count groups, labels
       from another branch) is reference material and lives in Help. */
    if (labelWires.length) {
      /* The reading is never left to be inferred. Auto is right for anything
         anyone types by hand, but a Histogram with two measures has the shape
         of a band table and is not one, so what the node decided is written
         down where the decision can be seen and overridden. */
      html += '<div class="cfg-label">Read the Labels branch as</div>' +
        '<select' + ctl(id, 'labelsAs') + '>' +
          opt('auto',   selectForLabelMode(node),
              'Work it out (' + (labelsAreBands(lschema) ? 'named bands' : 'a list of values') + ')') +
          opt('values', selectForLabelMode(node), 'A list of values') +
          opt('bands',  selectForLabelMode(node), 'Named bands') +
        '</select>';

      if (bands) {
        /* Positional, because the format is positional, so there is no column
           to pick and the picker would be a control with nothing to decide.
           The three column names, and nothing else: the boundary rule is a
           paragraph and belongs in Help, which is where the supervisor asked
           node explanation to go and where Histogram's own boundary paragraph
           already went when this budget was set. */
        var bn = lschema.columns;
        html += '<div class="cmp-hint">In order: <b>' + esc(bn[0].label) +
          '</b> names the band, <b>' + esc(bn[1].label) + '</b> is its lowest ' +
          'value, <b>' + esc(bn[2].label) + '</b> its highest.</div>';
      } else {
        var lcols = labelCols(lschema);
        var lchosen = (cfg.labelCol && colByKey(lschema, cfg.labelCol) &&
                       colByKey(lschema, cfg.labelCol).type !== COLTYPE.COURSES)
          ? cfg.labelCol
          : (lcols.length ? lcols[0].key : '');
        html += '<div class="cfg-label">Groups from the Labels branch</div>' +
          (lcols.length
            ? '<select' + ctl(id, 'labelCol') + '>' +
                lcols.map(function(c){ return opt(c.key, lchosen, c.label); }).join('') +
              '</select>'
            : '<div class="cmp-hint">No column on that branch can supply labels. ' +
                'Put a <b>Project</b> in front of it.</div>');
      }
    } else {
      html += '<div class="cmp-hint"><b>Labels</b> (optional). Unconnected: the ' +
        'groups are the values found in the column above. Wire one column in ' +
        'for a fixed list, or three for named bands.</div>';
    }

    var stats = statsOf(node);
    html += '<div class="cfg-label">Measure</div><div class="stat-list">' +
      stats.map(function(st, si) {
        var sop = selectForOp(st && st.op);
        var scol = sop.needsCol ? statCol(st, schema) : null;
        return '<div class="stat-row">' +
          '<select class="stat-op"' + ctl(id, 'stat.' + si + '.op') + '>' +
            SELECTFOR_OPS.map(function(o){ return opt(o.key, sop.key, o.label); }).join('') +
          '</select>' +
          // The column select appears only for the measures that take one, so
          // the row does not carry a control that means nothing for Count.
          (sop.needsCol
            ? '<select class="stat-col"' + ctl(id, 'stat.' + si + '.col') + '>' +
                measurableCols(schema).map(function(c) {
                  return opt(c.key, scol ? scol.key : '', c.label);
                }).join('') +
              '</select>'
            : '<span class="stat-nocol"></span>') +
          (si > 0
            ? '<button class="remove-criterion-btn" onclick="removeStat(' + id + ',' + si + ')">x</button>'
            : '<span class="stat-nodel"></span>') +
        '</div>';
      }).join('') +
    '</div>' +
    '<button class="add-criterion-btn sort-add" onclick="addStat(' + id + ')">+ add measure</button>';

    if (statsOf(node).some(function(st){ return selectForOp(st && st.op).needsCol; }) &&
        !measurableCols(schema).length) {
      html += '<div class="cmp-hint">No numeric column upstream: Those ' +
        'measures will come out blank.</div>';
    }

    /* Say what comes out, in the words the header will use, for the same
       reason the Aggregate panels do: the shape is the part people get wrong.

       `lschema` is passed, not left out, because the reading decides the group
       column. Without it this line would describe the value reading while the
       node emitted bands, which is the one thing a panel that exists to state
       the output shape may not get wrong. */
    html += '<div class="cmp-hint">Out: one row per ' + (bands ? 'band' : 'group') +
      ' \u2014 ' +
      selectForColumns(node, schema, lschema).map(function(c){ return '<b>' + esc(c.label) + '</b>'; }).join(', ') +
      '. Not ordered; put a <b>Sort</b> after it.</div>';
  }

  if (node.type === 'histogram') {
    var bcols = binnableCols(schema);
    var bf = binField(node, schema);

    if (!bcols.length) {
      html += '<div class="cmp-hint">Nothing to bin. This node needs a number ' +
        'column.</div>';
    } else {
      html += '<div class="cfg-label">Distribution of</div>' +
        '<select' + ctl(id, 'by') + '>' +
          bcols.map(function(c){ return opt(c.key, bf ? bf.key : '', c.label); }).join('') +
        '</select>' +
        '<div class="cfg-label">In bands of</div>' +
        // Left empty it says "auto", because empty is a real setting here: the
        // width is then chosen from the data, which the panel cannot see.
        '<input type="number" min="0" step="any" placeholder="auto" ' +
          'value="' + esc(cfg.width === undefined ? '' : cfg.width) + '"' + ctl(id, 'width') + '>';

      /* Shown only while the width is the one thing still undecided. Once a
         number is typed the control states itself. The boundary rule (which
         side of a shared edge a value falls on) is the one thing about a
         histogram a reader cannot check by looking at it, and it is true on
         every render, which is what makes it reference material rather than a
         panel hint: it is explained in Help instead of asserted here. */
      if (binWidth(node) === null) {
        html += '<div class="cmp-hint">Empty: the width is chosen from the data.</div>';
      }
    }

    var hstats = statsOf(node);
    html += '<div class="cfg-label">Measure</div><div class="stat-list">' +
      hstats.map(function(st, si) {
        var hop = selectForOp(st && st.op);
        var hcol = hop.needsCol ? statCol(st, schema) : null;
        return '<div class="stat-row">' +
          '<select class="stat-op"' + ctl(id, 'stat.' + si + '.op') + '>' +
            SELECTFOR_OPS.map(function(o){ return opt(o.key, hop.key, o.label); }).join('') +
          '</select>' +
          (hop.needsCol
            ? '<select class="stat-col"' + ctl(id, 'stat.' + si + '.col') + '>' +
                measurableCols(schema).map(function(c) {
                  return opt(c.key, hcol ? hcol.key : '', c.label);
                }).join('') +
              '</select>'
            : '<span class="stat-nocol"></span>') +
          (si > 0
            ? '<button class="remove-criterion-btn" onclick="removeStat(' + id + ',' + si + ')">x</button>'
            : '<span class="stat-nodel"></span>') +
        '</div>';
      }).join('') +
    '</div>' +
    '<button class="add-criterion-btn sort-add" onclick="addStat(' + id + ')">+ add measure</button>';

    html += '<div class="cmp-hint">Out: one row per band \u2014 ' +
      histogramColumns(node, schema).map(function(c){ return '<b>' + esc(c.label) + '</b>'; }).join(', ') +
      '. Empty bands are kept, as zero.</div>';
  }

  if (node.type === 'sort') {
    var scols = sortableCols(schema);
    if (!scols.length) {
      html += '<div class="cmp-hint">No sortable columns upstream. Connect a Source.</div>';
    } else {
      var skeys = cfg.keys && cfg.keys.length ? cfg.keys : [newSortKey()];
      html += '<div class="cfg-label">Sort by</div><div class="sort-list">' +
        skeys.map(function(k, si) {
          // A saved key can outlive its column: Rewiring a Source from students
          // to enrolments is enough. Show the fallback the engine will actually
          // use, rather than a select silently displaying option one while the
          // model still says something else.
          var kc = k.col ? colByKey(schema, k.col) : null;
          var chosen = (kc && kc.type !== COLTYPE.COURSES) ? k.col : scols[0].key;
          var scol = colByKey(schema, chosen);
          var sdir = k.dir === 'desc' ? 'desc' : 'asc';
          return '<div class="sort-row">' +
            '<span class="sort-rank">' + (si + 1) + '</span>' +
            '<select class="sort-col"' + ctl(id, 'sort.' + si + '.col') + '>' +
              scols.map(function(c){ return opt(c.key, chosen, c.label); }).join('') +
            '</select>' +
            '<select class="sort-dir"' + ctl(id, 'sort.' + si + '.dir') + '>' +
              SORT_DIRS.map(function(d){ return opt(d, sdir, dirLabel(scol, d)); }).join('') +
            '</select>' +
            (si > 0
              ? '<button class="remove-criterion-btn" onclick="removeSortKey(' + id + ',' + si + ')">x</button>'
              : '<span class="sort-nodel"></span>') +
          '</div>';
        }).join('') +
      '</div>';
      // Offering more keys than there are columns invites a sort key that can
      // never break a tie the earlier ones did not already settle.
      if (skeys.length < scols.length) {
        html += '<button class="add-criterion-btn sort-add" onclick="addSortKey(' + id + ')">+ add tie-breaker</button>';
      }
      if (skeys.length > 1) {
        html += '<div class="cmp-hint">Row 1 decides; the rest break its ties.</div>';
      }
    }
  }

  if (node.type === 'reverse') {
    /* The exception to the rule the other panels follow. Everywhere else a hint
       is dropped once a control describes the same thing; here there is no
       control to drop it in favour of, because there is nothing to choose. The
       hint IS the panel, so the pairing with Take stays in both states: on its
       own Reverse looks like a node that does nothing useful, and that pairing
       is the whole point of it. Shortened rather than removed. */
    var rn = inputsOf(id).length
      ? 'Out: the same rows and columns, last one first.'
      : 'Wire a table in.';
    html += '<div class="cmp-hint">' + rn +
      ' Before a <b>Take</b>, that is the last few rows.</div>';
  }

  if (node.type === 'take') {
    // Bound to cfg.n verbatim, so a partially typed value is preserved between
    // renders. The engine's fallback is what protects the Run, not the control.
    html += '<div class="cfg-label">Keep first</div>' +
      '<input type="number" min="' + TAKE_MIN + '" step="1" ' +
        'value="' + esc(cfg.n === undefined ? '' : cfg.n) + '"' + ctl(id, 'n') + '>' +
      '<div class="cmp-hint">Out: the first ' + takeCount(node) +
        ' rows as they arrive. Put a <b>Sort</b> in front to rank them.</div>';
  }

  if (node.type === 'unique') {
    /* One selector, defaulting to whole rows. The two modes are genuinely
       different operations (one keeps the table's shape, the other reduces it
       to a list), so the control says which is which in words rather than
       leaving the user to infer it from the result. */
    var ucols = uniqueCols(schema);
    var ucur  = uniqueCol(node, schema);
    html += '<div class="cfg-label">Distinct</div>' +
      '<select' + ctl(id, 'col') + '>' +
        opt('', ucur ? 'x' : '', 'Whole rows') +
        ucols.map(function(c) {
          return opt(c.key, ucur ? ucur.key : '', 'Values of ' + c.label);
        }).join('') +
      '</select>';
    html += '<div class="cmp-hint">' + (ucur
      ? 'Out: one column of distinct <b>' + esc(ucur.label) + '</b> values.'
      : 'Out: the same columns, with repeated rows removed.') +
      '</div>';
  }

  if (node.type === 'aggregate' || node.type === 'aggregateColumns' ||
      node.type === 'aggregateRows') {
    var isCols = node.type === 'aggregateColumns';
    var isRows = node.type === 'aggregateRows';
    var op = aggOp(node);

    html += '<div class="cfg-label">Measure</div>' +
      '<select' + ctl(id, 'op') + '>' +
        AGG_OPS.map(function(o){ return opt(o.key, op.key, o.label); }).join('') +
      '</select>';

    if (!isCols && !isRows && op.needsCol) {
      // Only the whole-table Aggregate picks a column: AggregateColumns applies
      // the measure to every column at once, which is the point of it.
      var mcols = measurableCols(schema);
      var chosen = aggregateCol(node, schema);
      html += '<div class="cfg-label">Of column</div>' +
        (mcols.length
          ? '<select' + ctl(id, 'col') + '>' +
              mcols.map(function(c){ return opt(c.key, chosen ? chosen.key : '', c.label); }).join('') +
            '</select>'
          : '<div class="cmp-hint">No numeric column upstream: The result will be blank.</div>');
    }

    // Say what will come out, in the same words the result will use. The shape
    // of an aggregation is the thing people get wrong about it, and stating it
    // before the query runs is cheaper than explaining it afterwards.
    if (isRows) {
      /* Naming the count of contributing columns is the whole warning: if it
         says 1, the measure is reducing a single column to itself, and if it
         counts a column the user thinks of as a label, the label is being
         added into the total. */
      var rIdx = aggregateRowsIdx(node, schema);
      var rTotal = schema.columns.length;
      var rSkip = rTotal - rIdx.length;
      html += '<div class="cmp-hint">' +
        'Out: one column, one row per row in \u2014 ' + esc(op.label.toLowerCase()) +
        ' across ' + (rTotal
          ? rIdx.length + ' of ' + rTotal + ' column' + (rTotal === 1 ? '' : 's')
          : 'each row') + '.' +
        (rSkip > 0
          ? ' ' + rSkip + ' non-measure column' + (rSkip === 1 ? ' is' : 's are') +
            ' ignored. Put a <b>Select</b> in front.'
          : '') +
        '</div>';
    } else if (isCols) {
      var ncols = schema.columns.length;
      html += '<div class="cmp-hint">Out: one row, ' +
        (ncols ? ncols + ' column' + (ncols === 1 ? '' : 's') : 'one column per column in') +
        ', same headers, ' + esc(op.label.toLowerCase()) + ' down each.' +
        (op.key === 'count' ? '' : ' Non-numeric columns come out blank.') +
        '</div>';
    } else {
      html += '<div class="cmp-hint">Out: one row, one column \u2014 ' +
        esc(aggregateColumn(node, schema).label) + '.</div>';
    }
  }

  if (node.type === 'select') {
    var availCols = schema.columns;
    if (!availCols.length) {
      html += '<div class="cmp-hint">Nothing upstream yet. Wire a Source in to choose columns.</div>';
    } else {
      var kept = selectedCols(node, schema).map(function(c){ return c.key; });
      html += '<div class="cfg-label">Columns to keep</div><div class="cmp-measures sel-cols">' +
        availCols.map(function(c) {
          // The last ticked box is disabled rather than hidden. A Select with no
          // columns is a table with nothing in it, and the panel it leaves behind
          // offers no way back. Every box would be unticked and identical.
          var on = kept.indexOf(c.key) !== -1;
          var locked = on && kept.length === 1;
          return '<label class="cmp-measure' + (locked ? ' locked' : '') + '"' +
              (locked ? ' title="At least one column has to be kept"' : '') + '>' +
            '<input type="checkbox"' + (on ? ' checked' : '') + (locked ? ' disabled' : '') +
              ctl(id, 'column:' + c.key) + '>' +
            '<span>' + esc(c.label) + '</span></label>';
        }).join('') +
      '</div>';
      /* A Select narrows the table that travels on, so unticking here changes
         what every node downstream receives. That is a computation, and the
         boxes say so rather than leaving the user to read it off the stale
         note. Deliberately different wording from the Output's boxes below,
         because the two do different things and reading alike would be the
         confusion rather than the cure. */
      html += '<div class="cmp-hint">Out: ' + kept.length + ' of ' +
        availCols.length + ' columns, in the order they arrive. Rows are never ' +
        'touched. Re-run the query to pass the change on.</div>';
    }
  }

  if (node.type === 'project') {
    /* No controls, so the panel exists entirely to say what the node does to
       the meaning of a row. That is the thing this node was asked to make
       visible, and a panel that said nothing would put it back where it was
       when it lived hidden on the Source. */
    if (!canProject(schema)) {
      html += '<div class="cmp-hint">No course data here, so rows pass through ' +
        'unchanged. Wire this after a <b>Source</b> or a <b>Filter</b>.</div>';
    } else {
      var pCols = projectColumns(schema);
      var pGained = enrolmentColumns().map(function(c){ return c.label; }).join(', ');
      html += '<div class="cfg-label">One row per course</div>' +
        '<div class="cmp-hint proj-warn">Every row becomes one row per course ' +
        'taken, so a row is an enrolment from here on, not a student. ' +
        '<b>A count after this counts enrolments.</b></div>' +
        '<div class="cmp-hint">Out: ' + pCols.length + ' columns. Adds ' +
        esc(pGained) + '. ID becomes Student.</div>';
    }
  }

  if (node.type === 'combine') {
    var cinIds = inputsOf(id);
    var cmode = combineMode(node);

    html += '<div class="cfg-label">Inputs (' + cinIds.length + ')</div>';
    if (cinIds.length === 0) {
      html += '<div class="cmp-hint">Wire two branches into this node to stack them.</div>';
    } else if (cinIds.length === 1) {
      html += '<div class="cmp-hint">One input, passed straight through. Add another to combine.</div>';
    }

    html += '<div class="cfg-label">Mode</div>' +
      '<select' + ctl(id, 'mode') + '>' +
        COMBINE_MODES.map(function(m){ return opt(m.key, cmode.key, m.label); }).join('') +
      '</select>';

    if (cmode.key === 'merge') {
      html += '<label class="cmb-check"><input type="checkbox"' +
          (cfg.dedupe ? ' checked' : '') + ctl(id, 'dedupe') + '>' +
        '<span>Drop duplicate rows</span></label>' +
        '<div class="cmp-hint">Off: duplicates are kept. On: a set union.</div>';
    } else {
      // Difference is not symmetric, so the base has to be named rather than
      // inferred from the order the wires happened to be drawn.
      var baseId = combineBaseId(node, cinIds);
      if (cinIds.length > 1) {
        html += '<div class="cfg-label">Base</div>' +
          '<select' + ctl(id, 'base') + '>' +
            cinIds.map(function(inId) {
              var up = findNode(inId);
              return opt(String(inId), String(baseId), up ? (upstreamLabel(up)) : ('Input ' + inId));
            }).join('') +
          '</select>';
      }
      /* The key column comes from the BASE, not from whichever wire happened to
         be drawn first. They are usually the same table, and were always assumed
         to be, but join makes the difference visible: pick the second input as
         the base and the picker would otherwise offer columns the base does not
         have, then refuse the key it just offered. */
      var baseSchema = (schemas && schemas[combineBaseId(node, cinIds)]) || schema;
      var kcols = combineKeyCols(baseSchema);
      var kcur = combineKeyCol(node, baseSchema);
      html += '<div class="cfg-label">Match rows on</div>' +
        (kcols.length
          ? '<select' + ctl(id, 'key') + '>' +
              kcols.map(function(c){ return opt(c.key, kcur ? kcur.key : '', c.label); }).join('') +
            '</select>'
          : '<div class="cmp-hint">No column upstream to match on.</div>');
      if (cmode.key === 'join') {
        html += '<label class="cmb-check"><input type="checkbox"' +
            (cfg.keepUnmatched ? ' checked' : '') + ctl(id, 'keepUnmatched') + '>' +
          '<span>Keep base rows with no match</span></label>';
      }
      html += '<div class="cmp-hint">' +
        (cmode.key === 'intersect'
          ? 'Keeps base rows whose value also appears in every other input.'
          : cmode.key === 'difference'
          ? 'Keeps base rows whose value appears in none of the other inputs.'
          : 'Out: the base\u2019s rows, never more, with the other inputs\u2019 ' +
            'columns added on. A repeated key uses its first matching row.') +
        '</div>';
    }
  }

  if (node.type === 'output') {
    var show = normaliseShow(node);
    cfg.show = show;

    /* First, because it is the larger question: is this Output an answer to
       read, or a step on the way to one? Everything below describes how the
       block is drawn, and none of it matters while it is not being drawn. */
    html += '<label class="cmb-check"><input type="checkbox"' +
        (hiddenInPanel(node) ? '' : ' checked') + ctl(id, 'panel') + '>' +
      '<span>Show in results panel</span></label>';

    html += '<div class="cfg-label">Show</div><select' + ctl(id, 'show') + '>';
    if (branchesFeedOutput(node)) {
      html += opt('summary', show, 'Summary table') +
              opt('lists',   show, 'Summary + row lists');
    } else {
      html += opt('rows',    show, 'Rows (raw data)') +
              opt('count',   show, 'Count');
    }
    html += '</select>';

    /* The column picker appears only on the row view. It is the same control as
       Select's, deliberately (two panels that do the same thing should look
       the same), and it reads the header that is actually arriving, so an
       Output rewired behind a different branch offers that branch's columns. */
    if (show === 'rows') {
      var oCols = schema.columns;
      if (!oCols.length) {
        html += '<div class="cmp-hint">Nothing wired in yet. Connect a Source to ' +
          'choose which columns to show.</div>';
      } else {
        var oKept = outputCols(node, schema).map(function(c){ return c.key; });
        html += '<div class="cfg-label">Columns to show</div><div class="cmp-measures sel-cols">' +
          oCols.map(function(c) {
            // Last box locked for Select's reason: an Output showing no columns
            // has nothing to show, and the panel it leaves behind offers no way
            // back, since every box would be unticked and identical.
            var on = oKept.indexOf(c.key) !== -1;
            var locked = on && oKept.length === 1;
            return '<label class="cmp-measure' + (locked ? ' locked' : '') + '"' +
                (locked ? ' title="At least one column has to be shown"' : '') + '>' +
              '<input type="checkbox"' + (on ? ' checked' : '') + (locked ? ' disabled' : '') +
                ctl(id, 'column:' + c.key) + '>' +
              '<span>' + esc(c.label) + '</span></label>';
          }).join('') +
        '</div>';
        /* The only tick boxes in the tool that answer without a run, so the
           only ones whose hint may promise it. See refreshOutputView(). */
        html += '<div class="cmp-hint">Showing ' + oKept.length + ' of ' +
          oCols.length + ' columns. No rows are lost, and Copy and Save follow ' +
          'this. The results update as you tick, with no re-run.' +
          (outputFeedsAnother(node)
            ? ' A node is wired after this Output, so that branch does need a ' +
              're-run to catch up.'
            : '') +
          '</div>';
      }
    }

    // The file name deliberately lives with the Copy/Save buttons in the results
    // panel rather than here. It describes the exported file, not the query, and
    // putting it on the node implied it was part of what gets computed.
  }

  return html + '</div>';
}

/* Port stubs are drawn only where they carry information. On a node with more
   than one input, where the user has to know which is which. A single-input
   node shows nothing: it has one entry point, in the place arrows have always
   landed, and decorating it would be noise on every node on the canvas.

   Each stub is positioned by the same fraction as portOffsetY, so the marker on
   the shape and the arrowhead in the SVG are placed by one rule rather than two
   that have to be kept in step. An occupied port is styled differently, which
   is how a user sees that a single input is full before trying to drop on it. */
function portsHTML(node) {
  var ps = portsOf(node.type);
  if (ps.length < 2) return '';
  return '<span class="node-ports">' + ps.map(function(p, i) {
    var taken = wiresInto(node.id, p.key).length > 0;
    var top = 100 * (i + 1) / (ps.length + 1);
    return '<span class="node-port' + (taken ? ' filled' : '') + '"' +
           ' style="top:' + top + '%"' +
           ' title="' + esc(p.label) + (p.multi ? ' (accepts several)' : '') + '">' +
           '<i></i><em>' + esc(p.label) + '</em></span>';
  }).join('') + '</span>';
}

function shapeHTML(node) {
  var removeBtn = '<button class="node-remove" onclick="removeNode(' + node.id + ')">x</button>' +
                  portsHTML(node);
  if (node.type === 'source') {
    /* A Source with no files looks exactly like a Source with files until you
       open its panel, and on a graph of a dozen nodes that is the difference
       between "why is this empty" and "load that one". The dashed ring says
       which, and it says it around the whole shape.

       A badge in the corner did the same job and was a worse way to do it: the
       delete button lives at top-right, so the two occupied the same spot and
       the badge read as something to click. The border carries the state
       without competing for that corner. */
    /* The grain is named ON THE SHAPE, not left to the panel. That is the
       whole of what was wrong with this setting the first time it existed: it
       was a dropdown nobody had open while reading a count that it had
       multiplied by eight. Only the non-default grain is written, so an
       ordinary Source is the shape it has always been and the words appear
       exactly when they carry information.

       Inside the circle rather than in a corner, for the reason the no-data
       state is a ring rather than a badge: the delete button owns the top
       right, and a second thing there reads as something to click. */
    var grain = sourceGrain(node);
    var sub = grain.key === SOURCE_GRAINS[0].key ? ''
      : '<span class="node-grain">' + esc(grain.label.toLowerCase()) + '</span>';
    return '<div class="node-shape shape-source' +
      (hasSourceData(node) ? '' : ' no-data') + (sub ? ' has-grain' : '') + '">' +
      removeBtn + 'Source' + sub + '</div>';
  }
  if (node.type === 'filter') return '<div class="node-shape shape-filter">' + removeBtn + 'Filter</div>';
  if (node.type === 'compare') {
    var glyph = '<span class="cmp-glyph"><i style="width:26px"></i><i style="width:16px"></i><i style="width:21px"></i></span>';
    return '<div class="node-shape shape-compare">' + removeBtn + glyph + 'Compare</div>';
  }
  if (node.type === 'sort') {
    // Bars of increasing length: the glyph says "ordered", and reads as
    // distinct from Take's equal-length bars with a cut through them.
    var sbars = '<span class="sort-glyph"><i style="width:9px"></i>' +
      '<i style="width:16px"></i><i style="width:23px"></i></span>';
    return '<div class="node-shape shape-sort">' + removeBtn + sbars + 'Sort</div>';
  }
  if (node.type === 'reverse') {
    /* Sort's ascending bars, upside down, with a turn arrow beside them. Read
       against Sort the inversion is the message: same bars, opposite order. The
       arrow is what stops it being mistaken for "sort descending", which is a
       different node reached a different way. */
    var rv = '<span class="rev-glyph">' +
      '<span class="rev-bars"><i style="width:23px"></i>' +
      '<i style="width:16px"></i><i style="width:9px"></i></span>' +
      '<b class="rev-turn"></b></span>';
    return '<div class="node-shape shape-reverse">' + removeBtn + rv + 'Reverse</div>';
  }
  if (node.type === 'take') {
    // Three kept bars above the cut, one dropped below it. The glyph says
    // "first few, rest discarded" without repeating the word on the label.
    var bars = '<span class="take-glyph">' +
      '<i></i><i></i><i></i><b></b><i class="cut"></i></span>';
    return '<div class="node-shape shape-take">' + removeBtn + bars + 'Take</div>';
  }
  if (node.type === 'unique') {
    /* Two pairs, each a value and its repeat. The first of each pair is solid,
       meaning kept, and the second is an empty outline of the same width,
       the same value again, dropped. Matching widths say "the same value";
       the outline is what says "not kept".

       The previous glyph struck a line through the repeat, which read as Take's
       cut rule and so said "everything below here is discarded" rather than
       "this one is a duplicate". Two pairs rather than one also matter: a
       single repeat looks like a rule separating a top group from a bottom one,
       which is exactly the wrong reading. */
    var uq = '<span class="uniq-glyph">' +
      '<i class="wide"></i><i class="wide dupe"></i>' +
      '<i class="narrow"></i><i class="narrow dupe"></i></span>';
    return '<div class="node-shape shape-unique">' + removeBtn + uq + 'Unique</div>';
  }
  if (node.type === 'select') {
    /* Three columns with the middle one hollow. Every other glyph on the canvas
       is read top to bottom because it says something about rows; this one is
       read left to right, which is the distinction the node exists to make. The
       dropped column is outlined rather than absent, so the glyph shows a
       choice being made rather than a table that happens to be narrow. */
    var sg = '<span class="sel-glyph"><i></i><i class="off"></i><i></i></span>';
    return '<div class="node-shape shape-select">' + removeBtn + sg + 'Select</div>';
  }
  if (node.type === 'project') {
    /* One bar fanning out into three. Every other glyph on the canvas shows
       rows being kept, dropped, reordered or reduced; this is the only one that
       shows them multiplying, which is the single fact about this node worth
       recognising from across the canvas. Drawn left to right, like Select's,
       because both change the header, but opening out rather than narrowing. */
    var pj = '<span class="proj-glyph">' +
      '<i class="proj-one"></i><b class="proj-fan"></b>' +
      '<span class="proj-many"><i></i><i></i><i></i></span></span>';
    return '<div class="node-shape shape-project">' + removeBtn + pj + 'Project</div>';
  }
  if (node.type === 'aggregate') {
    // Rows funnelling into a single dot: many values, one value out.
    var ag = '<span class="agg-glyph"><i></i><i></i><i></i><b></b></span>';
    return '<div class="node-shape shape-aggregate">' + removeBtn + ag + 'Aggregate</div>';
  }
  if (node.type === 'aggregateColumns') {
    // The same funnel turned ninety degrees: three columns, each collapsing to
    // its own value, so the pair read as variants of one idea rather than two
    // unrelated nodes.
    var agc = '<span class="aggc-glyph">' +
      '<span class="aggc-col"><i></i><i></i><b></b></span>' +
      '<span class="aggc-col"><i></i><i></i><b></b></span>' +
      '<span class="aggc-col"><i></i><i></i><b></b></span></span>';
    return '<div class="node-shape shape-aggcols">' + removeBtn + agc + 'Agg. Columns</div>';
  }
  if (node.type === 'aggregateRows') {
    /* AggregateColumns' glyph turned through ninety degrees: three ROWS, each
       collapsing rightwards to its own value. Read beside its sibling the axis
       is the whole message: One reduces down the page, the other across it. */
    var aggr = '<span class="aggr-glyph">' +
      '<span class="aggr-row"><i></i><i></i><b></b></span>' +
      '<span class="aggr-row"><i></i><i></i><b></b></span>' +
      '<span class="aggr-row"><i></i><i></i><b></b></span></span>';
    return '<div class="node-shape shape-aggrows">' + removeBtn + aggr + 'Agg. Rows</div>';
  }
  if (node.type === 'combine') {
    // Two streams converging into one: the mirror image of Compare's glyph,
    // which holds branches apart rather than joining them.
    var cg = '<span class="cmb-glyph">' +
      '<span class="cmb-in"><i></i><i></i></span>' +
      '<b></b>' +
      '<span class="cmb-out"><i></i></span></span>';
    return '<div class="node-shape shape-combine">' + removeBtn + cg + 'Combine</div>';
  }
  if (node.type === 'selectFor') {
    /* Three labelled rows, each with its own bar: the output shape drawn
       literally. Compare's glyph is three bars held apart with nothing naming
       them, and that is the difference between the two nodes. These groups
       have names, which is what makes them nameable in one control instead of
       wired one at a time. */
    var sfg = '<span class="sf-glyph">' +
      '<span class="sf-row"><b></b><i style="width:18px"></i></span>' +
      '<span class="sf-row"><b></b><i style="width:11px"></i></span>' +
      '<span class="sf-row"><b></b><i style="width:15px"></i></span></span>';
    return '<div class="node-shape shape-selectfor">' + removeBtn + sfg + 'Select For</div>';
  }
  if (node.type === 'histogram') {
    /* Bars of unequal height with no gaps between them, which is the one thing
       that distinguishes a histogram from the bar charts the other glyphs draw:
       Sort's bars ascend and are spaced, Compare's three are held apart. Touching
       bars say the axis underneath is continuous, which is the whole idea here. */
    var hg = '<span class="hist-glyph">' +
      '<i style="height:5px"></i><i style="height:9px"></i><i style="height:14px"></i>' +
      '<i style="height:11px"></i><i style="height:6px"></i></span>';
    return '<div class="node-shape shape-histogram">' + removeBtn + hg + 'Histogram</div>';
  }
  if (node.type === 'output') return '<div class="node-shape shape-output">' + removeBtn + 'Output</div>';
  return '';
}

