/* engine/specs.js: One specification per node type, for the two graph walks.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* ============================================================================
   NODE SPECIFICATIONS
   ============================================================================
   One entry per node type, declaring the two things the graph walks need to
   know: what shape comes out, and how the rows are computed.

     schema:    (node, inSchema, ctx) -> table of columns, no rows. The header
                this node produces, derived from the header it is given.
                inSchema is the header on the node's primary port; ctx.port(key)
                reaches the others, which is what a two-input node needs.
     rows:      (node, table, log) -> table | {error}. The ordinary path: one
                table in, one table out. Omitted by nodes that pass their rows
                through untouched.
     evaluate:  (node, ctx) -> {table, error, hasSource}. For nodes that read
                their inputs separately rather than taking one table: Source
                (no inputs), Combine and Compare (many).

   `merges` is gone. It meant "union this node's inputs before running it", and
   that union is what a wire into an occupied port now prevents: a single-input
   node has one table, so there is nothing to reconcile and no way for rows to
   disappear into a silent deduplication. Nodes that genuinely take several
   tables declare a multi port and read them through ctx.

   Why a registry rather than branches in two functions: schema propagation and
   evaluation must agree about every node, and until now they agreed by
   coincidence. Filter, Sort and Take leave the header alone, so schema
   propagation could get away with `out[node.id] = ins[0]`. A pass-through
   that is simply wrong for every node still to be built. Histogram, Aggregate
   and Project all rewrite the header, and each would have needed a branch in
   computeSchemas() and another in evaluateGraph(), in two places that no
   mechanism keeps in step.

   Declaring both against one type means a new node is one entry here plus its
   implementation, and the invariant that ties the pair together
   (headerOnly(rows(node, t)) equals schema(node, headerOnly(t))) is a property
   of the registry that can be tested across every type at once, rather than
   remembered.                                                                */

function passthroughSchema(node, inSchema) { return inSchema; }

var NODE_SPEC = {
  source: {
    /* The header depends on the Source's own config, the way Unique's does.
       It was fixed while every Source emitted students; a Source set to
       enrolments emits what Project would have made of them, so the header is
       asked of the same function rather than restated here. Both walks read
       sourceGrain(), so the schema pass and the row pass cannot disagree about
       which grain this Source is in. */
    schema: function(node) {
      /* A table Source's header is the file's, so it is read from what the node
         is holding rather than from STUDENT_COLUMNS. That is data informing a
         header, which every other node avoids, and it is unavoidable here: the
         columns of an arbitrary file are not knowable from the config. It stays
         sound because both walks call datasetFor() and get the same answer, and
         because a Source with nothing loaded falls back to the archive's
         columns, which is what an unconfigured Source has always described. */
      var data = datasetFor(node);
      if (data && isTableDataset(data)) return headerOnly(makeTable(data.columns, []));

      var t = makeTable(STUDENT_COLUMNS, []);
      return headerOnly(sourceGrain(node).key === 'enrolment' ? projectSchema(node, t) : t);
    },
    evaluate: function(node, ctx) {
      var out = sourceTable(node, ctx.log);
      if (out.error) return { error: out.error };
      return { table: out.table, hasSource: true };
    }
  },

  filter: {
    schema: passthroughSchema,
    rows: function(node, t, log) { return applyFilter(node, t, log); }
  },

  sort: {
    schema: passthroughSchema,
    rows: function(node, t, log) { return { table: applySort(node, t, log) }; }
  },

  reverse: {
    // Nothing to declare: same header out as in, and no config to read.
    schema: passthroughSchema,
    rows: function(node, t, log) { return { table: applyReverse(node, t, log) }; }
  },

  take: {
    schema: passthroughSchema,
    rows: function(node, t, log) { return { table: applyTake(node, t, log) }; }
  },

  unique: {
    // The first built node whose output header depends on its own config
    // rather than only on its input: naming a column narrows the header to
    // that column. Both walks call uniqueCol() on the columns they hold, so
    // they cannot disagree about which mode the node is in.
    schema: uniqueSchema,
    rows: function(node, t, log) { return { table: applyUnique(node, t, log) }; }
  },

  select: {
    // The only node that narrows the header without touching the rows, so both
    // halves of the registry contract come from selectedCols(): the schema pass
    // and the evaluator resolve the same keys against the same header and
    // cannot disagree about what comes out.
    schema: selectSchema,
    rows: function(node, t, log) { return { table: applySelect(node, t, log) }; }
  },

  project: {
    // The only node that changes what a ROW means. Its header still follows
    // from the incoming header alone. The enrolment columns are fixed and the
    // carried ones are chosen by key, so it needs no more of the registry than
    // any other node, however different its effect.
    schema: projectSchema,
    rows: function(node, t, log) { return { table: applyProject(node, t, log) }; }
  },

  aggregate: {
    schema: aggregateSchema,
    rows: function(node, t, log) { return { table: applyAggregate(node, t, log) }; }
  },

  aggregateColumns: {
    schema: aggregateColumnsSchema,
    rows: function(node, t, log) { return { table: applyAggregateColumns(node, t, log) }; }
  },

  aggregateRows: {
    // Header depends only on the chosen measure, never on the incoming columns,
    // so the schema walk knows it without looking at anything upstream.
    schema: aggregateRowsSchema,
    rows: function(node, t, log) { return { table: applyAggregateRows(node, t, log) }; }
  },

  combine: {
    /* One multi port. Where an ordinary node now refuses a second wire, this is
       the node that exists to accept it: stacking several tables is its job,
       and how they stack (merge, intersect, difference, dedupe or not) is its
       settings rather than a rule applied behind the user's back. Its header is
       whatever arrives, so the schema is the ordinary pass-through. */
    /* Pass-through for the three row modes: the header that arrives is the
       header that leaves. Join is the exception (the one mode that produces a
       header neither input had), so it builds one from every input on the port,
       through the same function the evaluator uses. */
    schema: function(node, inSchema, ctx) {
      if (combineMode(node).key !== 'join') return inSchema;
      var ids = inputsOf(node.id, 'in');
      var heads = ctx.at('in');
      if (heads.length < 2) return inSchema;
      var sperm = combineOrder(node, ids);
      return makeTable(joinColumns(node,
        sperm.map(function(i){ return heads[i]; }),
        sperm.map(function(i){ return combineInputLabel(ids[i]); })), []);
    },
    evaluate: function(node, ctx) {
      // The base is a node the user named, not the wire that happened to be
      // drawn first, so the tables are ordered before the reduction sees them,
      // and the labels ride the same permutation, so a renamed joined column
      // names the node it actually came from.
      var perm = combineOrder(node, ctx.inIds);
      var ctabs = perm.map(function(i){ return ctx.ins[i].table; });
      var clabels = perm.map(function(i){ return combineInputLabel(ctx.inIds[i]); });
      var out = combineTables(node, ctabs, ctx.log, clabels);
      return {
        table: out.table,
        error: out.error,
        hasSource: ctx.ins.some(function(r){ return r.hasSource; })
      };
    }
  },

  selectFor: {
    /* The first node with two DIFFERENT ports rather than one port taking many
       wires, and it needed nothing added to the port model to have them. The
       entry in NODE_PORTS is the whole declaration, which is what the comment
       there predicted when it named this node.

       schema reads the data port for the measures and the labels port for ONE
       fact: whether the groups are values or named bands. That used to be true
       of the data port alone, and the note here said so, because what the
       labels supplied was only which groups exist, and that is rows.

       Bands changed it. A band is named text where a value carries its own
       column's type, so the reading decides the TYPE of the group column, and a
       type is header. It is still only the labels HEADER that is read, never
       its rows, so a half-built graph still describes itself and the schema
       walk stays a walk over headers. labelsAreBands() takes a header for
       exactly this reason. */
    schema: function(node, inSchema, ctx) {
      return makeTable(selectForColumns(node, inSchema, ctx.at('labels')[0]), []);
    },
    evaluate: evaluateSelectFor
  },

  histogram: {
    /* One input and one table out, so it declares `rows` rather than
       `evaluate`. The header is the bin column plus the measures and depends on
       the config alone, which is what lets the schema walk describe it before
       anything has run: which bins exist is rows, not columns. */
    schema: function(node, inSchema) {
      return makeTable(histogramColumns(node, inSchema), []);
    },
    rows: applyHistogram
  },

  compare: {
    // The other multi port. Each branch becomes a row, so it reads the branch
    // results directly rather than receiving one table.
    schema: function(node) { return makeTable(compareColumns(measuresOf(node)), []); },
    evaluate: function(node, ctx) {
      return {
        table: buildCompare(node, ctx.inIds, ctx.res, ctx.log),
        hasSource: ctx.ins.some(function(r){ return r.hasSource; })
      };
    }
  },

  output: {
    /* An Output is now chainable, and this is the entry the old comment here
       said would have to grow up when that happened.

       The rule it settles: what an Output SHOWS is what it passes on. The view
       is part of the graph rather than a coat of paint applied at render time,
       so a node wired after an Output receives the table the user is looking
       at, and the screen and the dataflow can never disagree about what came
       out of it. A Count emits its one-row count; a row view narrowed to three
       columns emits three columns.

       The header therefore depends on the view AND on the column selection,
       which is why this is a real schema rather than passthroughSchema: a
       Filter wired after a narrowed Output must offer the columns that survive
       it, not the ones that arrived.

       meta survives exactly where it is needed. outputTable() returns its input
       untouched for the summary and lists views, which are the only views a
       branch table ever reaches, and drops meta only when narrowing a row view,
       which is what Select does for the same reason. */
    schema: function(node, inSchema) {
      return makeTable(outputTable(node, inSchema).columns, []);
    },
    /* The OUTPUT line is logged here rather than at render time so that it is
       carried by the result like every other node's line. A node wired after an
       Output inherits its log, and a query log that skipped the Output would
       describe a path the data did not take. */
    rows: function(node, t, log) {
      log.push(logEntry('OUTPUT', [{ c:'val', s:normaliseShow(node) }]));
      return { table: outputTable(node, t) };
    }
  }
};

function specFor(type) { return NODE_SPEC[type] || null; }

/* The context handed to spec.evaluate and spec.schema. One object serves both
   walks: `at(portKey)` returns what is on that port, whether "what" is a result
   or a header, so a node's two functions ask the same question in the same
   words. Nodes that only ever have one input never call it. */
function portContext(node, valueOf) {
  return function(portKey) {
    return inputsOf(node.id, portKey).map(valueOf).filter(Boolean);
  };
}

/* GRAPH EVALUATION
   Walks the DAG in topological order. Each node computes from its own inputs,
   so parallel branches stay independent.
   Returns {res: {nodeId: {table, log, hasSource}}} or {error}.

   The default path is now genuinely single-input: whatever is on the primary
   port is the table, with no union step to lose rows in. An empty port yields
   an empty table rather than an error, so a half-built graph still renders and
   still runs. The node simply has nothing to work on yet. */
function evaluateGraph() {
  var order = topoSort();
  if (order.length < nodes.length) {
    return { error: 'Circular connection detected. Remove an arrow that loops back on itself.' };
  }

  var res = {};
  for (var i = 0; i < order.length; i++) {
    var node = order[i];
    var spec = specFor(node.type);
    if (!spec) continue;   // a type no longer supported: skip rather than throw
    var log = [], table, hasSource;

    var inIds = inputsOf(node.id);
    var ins = inIds.map(function(id){ return res[id]; }).filter(Boolean);
    if (node.type !== 'source') {
      ins.forEach(function(r){ log.push.apply(log, r.log); });
    }

    var ctx = {
      inIds: inIds,
      ins: ins,
      res: res,
      log: log,
      at: portContext(node, function(id){ return res[id]; })
    };

    /* A node that is switched off is not skipped, it is made transparent: it
       emits its primary input exactly as it arrived. That is the whole point of
       the switch. Deleting a Filter from a chain leaves a gap to rewire, while
       switching it off leaves the chain intact and the query still running, so
       the comparison being asked for ("what does this look like without the
       filter") costs one keystroke each way rather than a rebuild.

       Source is the one type this cannot apply to and nodeCanBeOff() refuses it
       there, because a Source has no input to pass through and "off" could only
       mean "emit nothing", which is the broken state the switch exists to avoid.

       The log passes through with the table. A switched-off node contributes no
       line of its own, which is correct: nothing happened at it. */
    if (isNodeOff(node)) {
      var through = ctx.at(primaryPort(node.type))[0];
      table = through ? through.table : makeTable([], []);
      hasSource = !!(through && through.hasSource);
      res[node.id] = { table: table, log: log, hasSource: hasSource };
      continue;
    }

    if (spec.evaluate) {
      var ev = spec.evaluate(node, ctx);
      // A node that reads its inputs itself can fail the same way a row
      // transform can (Combine rejects mismatched headers), so the error has
      // to surface here too, rather than only on the spec.rows path.
      if (ev.error) return { error: ev.error };
      table = ev.table;
      hasSource = ev.hasSource;
    } else {
      var head = ctx.at(primaryPort(node.type))[0];
      table = head ? head.table : makeTable([], []);
      hasSource = !!(head && head.hasSource);

      if (spec.rows) {
        var out = spec.rows(node, table, log);
        if (out.error) return { error: out.error };
        table = out.table;
      }
    }

    res[node.id] = { table: table, log: log, hasSource: hasSource };
  }
  return { res: res };
}

/* SCHEMA PROPAGATION
   The same walk as evaluateGraph but carrying only column headers, no rows. It
   is what lets a Filter's field list and an Output's average-column list be
   built from whatever is actually flowing into them. Cheap enough to run on
   every render because no row is ever touched.

   Both walks read the same registry and the same ports, so a node cannot
   describe one header here and produce another there, and cannot read a
   different input in the two passes either. */
function computeSchemas() {
  var order = topoSort();
  var out = {};
  order.forEach(function(node) {
    var spec = specFor(node.type);
    if (!spec) { out[node.id] = makeTable([], []); return; }
    var at = portContext(node, function(id){ return out[id]; });
    var head = at(primaryPort(node.type))[0];
    /* The same bypass as evaluateGraph, and it has to be here too. These two
       walks are required to agree: if a switched-off Aggregate still described
       its aggregated headers here while passing its input through there, every
       panel downstream would offer field names that no longer exist in the data
       flowing past it. */
    if (isNodeOff(node)) {
      out[node.id] = headerOnly(head || makeTable([], []));
      return;
    }
    out[node.id] = headerOnly(spec.schema(node, head || makeTable([], []), { at: at }));
  });
  return out;
}

// The header a node's config panel should describe: what arrives, not what
// leaves. Reads the primary port, so a two-input node's panel describes its
// data rather than whichever wire happened to be drawn first. An unconnected
// node falls back to the student schema so its panel is still meaningful
// before anything is wired up.
function inputSchema(node, schemas, portKey) {
  var key = portKey === undefined ? primaryPort(node.type) : portKey;
  var ins = inputsOf(node.id, key).map(function(id){ return schemas[id]; }).filter(Boolean);
  if (ins.length) return ins[0];
  return makeTable(STUDENT_COLUMNS, []);
}
