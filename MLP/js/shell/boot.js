/* shell/boot.js: What the inline handlers call, the test hook, and the first paint.
   Loads last, because it paints.
   Part of the Student Data Analyser. A classic script, not a module: the order
   these load in is set by the list at the foot of index.html and is load-bearing.
   ========================================================================== */
/* GLOBALS: Referenced by inline onclick handlers in the toolbar and panels */
window.addNode = addNode;
window.addProcNode = addProcNode;
window.toggleProcMenu = toggleProcMenu;
window.closeProcMenu = closeProcMenu;
window.removeNode = removeNode;
window.addCriterion = addCriterion;
window.addSortKey = addSortKey;
window.removeSortKey = removeSortKey;
window.addStat = addStat;
window.removeStat = removeStat;
window.removeCriterion = removeCriterion;
window.clearCritList = clearCritList;
window.clearAll = clearAll;
window.requestClearAll = requestClearAll;
window.closeClearDialog = closeClearDialog;
window.confirmClearAll = confirmClearAll;
window.runQuery = runQuery;
window.copyOutput = copyOutput;
window.saveOutput = saveOutput;
window.saveGraph = saveGraph;
window.closeSaveDialog = closeSaveDialog;
window.openHelp = openHelp;
window.closeHelp = closeHelp;
window.confirmSaveGraph = confirmSaveGraph;
window.openGraphFile = openGraphFile;
window.pickHeadersFile = pickHeadersFile;
window.pickYearFiles = pickYearFiles;
window.clearSourceData = clearSourceData;
window.removeSourceYear = removeSourceYear;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.zoomReset = zoomReset;
window.zoomToFit = zoomToFit;
window.toggleResultsPanel = toggleResultsPanel;
window.deleteSelection = deleteSelection;
window.toggleSelectionOff = toggleSelectionOff;
window.clearSelection = clearSelection;
window.addVariable = addVariable;
window.requestRemoveVariable = requestRemoveVariable;
window.toggleVarMenu = toggleVarMenu;
window.useVariableAt = useVariableAt;

/* TEST HOOK
   Set window.__QB_TEST__ = true *before* loading these scripts to expose internals to
   the test suite. In normal use the flag is undefined and nothing is exported,
   so this costs one branch at start-up and leaks nothing.

   The alternative (having the tests reach in by rewriting the source text) is
   silently broken by any edit near the end of this file, and a test suite that
   fails for reasons unrelated to the code under test is worse than none. */
if (typeof window !== 'undefined' && window.__QB_TEST__) {
  /* The suites run against the dataset the tool used to generate for itself.
     Installing it here, behind the same flag that publishes the internals,
     means a real page reaches neither: it opens with no data, and a Source
     without files refuses to run. See the loader section for why the generator
     was kept rather than the several hundred assertions written against it
     being rewritten to talk about the archive instead. */
  installSyntheticDataset();

  window.__qb = {
    // live state
    nodes: function(){ return nodes; },
    connections: function(){ return connections; },
    exportData: function(){ return exportData; },
    isFresh: function(){ return resultsFresh; },
    findNode: findNode,
    setCfg: setCfg,
    render: render,
    // test convenience: wire two nodes without simulating a drag. The port
    // defaults to the target's primary input, so existing tests that predate
    // ports keep working unchanged.
    connect: function(a, b, color, port) {
      var to = findNode(b);
      connections.push({
        from: a, to: b,
        port: port || (to ? primaryPort(to.type) : 'in'),
        color: color || '#ffffff'
      });
    },

    // ports
    NODE_PORTS: NODE_PORTS, portsOf: portsOf, primaryPort: primaryPort,
    portDef: portDef, normalisePort: normalisePort, wiresInto: wiresInto,
    portAccepts: portAccepts, freePortsOn: freePortsOn,
    portOffsetY: portOffsetY, shapeEntry: shapeEntry, shapeExit: shapeExit,
    nearestFreePort: nearestFreePort, resolveDirection: resolveDirection,
    inputsOf: inputsOf, connKey: connKey, removeConnection: removeConnection,

    // data layer
    STUDENTS: STUDENTS, COURSES: COURSES, SUBJECTS: SUBJECTS, SPECS: SPECS, YEARS: YEARS,
    COURSE_BY_CODE: COURSE_BY_CODE, CORE_COURSES: CORE_COURSES, COURSES_PER_YEAR: COURSES_PER_YEAR,
    SPEC_SUBJECTS: SPEC_SUBJECTS, SUBJECT_WEIGHTS: SUBJECT_WEIGHTS, subjectWeight: subjectWeight,
    rebuildRegistries: rebuildRegistries, defaultCourse: defaultCourse,
    defaultSubject: defaultSubject, defaultLevel: defaultLevel,
    DEGREES: DEGREES, LEVELS: LEVELS, courseLevel: courseLevel,

    // loading the archive: admission, parsing, and per-source state
    DATA_HEADERS_NAME: DATA_HEADERS_NAME, DATA_YEAR_RE: DATA_YEAR_RE,
    DATA_YEAR_MIN: DATA_YEAR_MIN, DATA_YEAR_MAX: DATA_YEAR_MAX,
    MAX_DATA_FILE_BYTES: MAX_DATA_FILE_BYTES, MAX_DATA_ROWS: MAX_DATA_ROWS,
    MAX_FIELD_CHARS: MAX_FIELD_CHARS, MAX_COURSE_POINTS: MAX_COURSE_POINTS,
    REQUIRED_HEADER_COLUMNS: REQUIRED_HEADER_COLUMNS,
    dataFileName: dataFileName, headersFileProblem: headersFileProblem,
    yearFileProblem: yearFileProblem, yearOfFile: yearOfFile,
    // One Source, any number of columns: what the header says decides how it reads
    headerIsArchive: headerIsArchive, isHeaderFileName: isHeaderFileName,
    headerNameFor: headerNameFor, headerTargetOf: headerTargetOf,
    dataFileProblem: dataFileProblem, parseTableFile: parseTableFile,
    buildTableDataset: buildTableDataset, isTableDataset: isTableDataset,
    datasetKind: datasetKind, detectSeparator: detectSeparator,
    inferColumnType: inferColumnType, tableColumnKey: tableColumnKey,
    MAX_HEADER_COLUMNS: MAX_HEADER_COLUMNS,
    parseHeaderFile: parseHeaderFile, parseYearFile: parseYearFile,
    calendarYearOf: calendarYearOf, buildDataset: buildDataset,
    loadHeadersFor: loadHeadersFor, loadYearFilesFor: loadYearFilesFor,
    removeSourceYear: removeSourceYear, parsedYearsOf: parsedYearsOf,
    yearFileNameFor: yearFileNameFor, applyDatasetToNode: applyDatasetToNode,
    MAX_YEAR_FILES: MAX_YEAR_FILES,
    clearSourceData: clearSourceData, clearAllSourceData: clearAllSourceData,
    forgetSourceData: forgetSourceData,
    datasetFor: datasetFor, hasSourceData: hasSourceData, datasetCfg: datasetCfg,
    headerFor: headerFor, sourceDataError: sourceDataError, sourceTable: sourceTable,
    sourceFilesHTML: sourceFilesHTML,
    sourceData: function(){ return SOURCE_DATA; },
    pendingHeaders: function(){ return PENDING_HEADERS; },
    sourceNotice: function(id){ return SOURCE_NOTICE[id] || null; },
    syntheticDataset: function(){ return SYNTHETIC_DATASET; },
    setSyntheticDataset: setSyntheticDataset,
    installSyntheticDataset: installSyntheticDataset,

    // table primitives
    COLTYPE: COLTYPE, STUDENT_COLUMNS: STUDENT_COLUMNS,
    makeTable: makeTable, colIndex: colIndex, colByKey: colByKey,
    hasCol: hasCol, cellAt: cellAt, headerOnly: headerOnly, numericCols: numericCols,
    coursesColIndex: coursesColIndex, studentsTable: studentsTable,
    fmtCell: fmtCell, exportCell: exportCell, cellTitle: cellTitle,
    schemaKey: schemaKey, rowKey: rowKey,

    // engine
    topoSort: topoSort, evaluateGraph: evaluateGraph, computeSchemas: computeSchemas,
    NODE_SPEC: NODE_SPEC, specFor: specFor, SHAPE: SHAPE, passthroughSchema: passthroughSchema,
    inputSchema: inputSchema, unionTables: unionTables, filterFields: filterFields,
    fieldByKey: fieldByKey, applyFilter: applyFilter, applyCriterion: applyCriterion,
    opsFor: opsFor, defaultOpFor: defaultOpFor, OP_FNS: OP_FNS, OP_SYM: OP_SYM,
    NUM_OPS: NUM_OPS, ENUM_OPS: ENUM_OPS, ORDERED_OPS: ORDERED_OPS,
    MARK_OPS: MARK_OPS, CODE_OPS: CODE_OPS, opGroups: opGroups,
    isRangeable: isRangeable, numericValues: numericValues, rankerFor: rankerFor,
    critValue: critValue, critOp: critOp, critHigh: critHigh, critRange: critRange,
    rangeKey: rangeKey, isBlank: isBlank,
    critList: critList, listKey: listKey, orderList: orderList,
    listChoices: listChoices, listMatcher: listMatcher,
    newCriterion: newCriterion, defaultCfg: defaultCfg,
    normaliseShow: normaliseShow, outputTable: outputTable, defaultAvgCol: defaultAvgCol,
    // Named bands on SelectFor's labels port
    labelsAreBands: labelsAreBands, selectForUsesBands: selectForUsesBands,
    selectForLabelMode: selectForLabelMode, bandsFromLabels: bandsFromLabels,
    bandIndexOf: bandIndexOf, selectForGroupColumn: selectForGroupColumn,
    SELECTFOR_BAND_ARITY: SELECTFOR_BAND_ARITY,
    // What a row means, chosen on the Source
    SOURCE_GRAINS: SOURCE_GRAINS, sourceGrain: sourceGrain,
    sourceGrainHint: sourceGrainHint,
    // Output visibility in the results panel
    hiddenInPanel: hiddenInPanel, outputNodes: outputNodes,
    allHiddenNoteHTML: allHiddenNoteHTML, applyPanelVisibility: applyPanelVisibility,
    // Ticking a column on an Output re-dresses its block instead of asking for a run
    outputViewHTML: outputViewHTML, refreshOutputView: refreshOutputView,
    outputFeedsAnother: outputFeedsAnother,
    branchesFeedOutput: branchesFeedOutput, BRANCH_NODES: BRANCH_NODES,
    ROW_SHOWS: ROW_SHOWS, CMP_SHOWS: CMP_SHOWS, branchProducer: branchProducer,
    DISPLAY_ROW_LIMIT: DISPLAY_ROW_LIMIT, DISPLAY_CARD_LIMIT: DISPLAY_CARD_LIMIT,
    meanOf: meanOf, MEASURES: MEASURES,

    // sort
    applySort: applySort, sortableCols: sortableCols, comparatorFor: comparatorFor,
    sortRowComparator: sortRowComparator,
    resolveSortKeys: resolveSortKeys, newSortKey: newSortKey, dirLabel: dirLabel,
    ordinalsFor: ordinalsFor, GRADE_ORDER: GRADE_ORDER,
    GRADE_POINTS: GRADE_POINTS, gradePoint: gradePoint, gpaOf: gpaOf,
    gradeFromGpa: gradeFromGpa,

    // combine
    COMBINE_MODES: COMBINE_MODES, combineMode: combineMode, combineTables: combineTables,
    combineBaseId: combineBaseId, combineKeyCol: combineKeyCol, combineKeyCols: combineKeyCols,
    upstreamLabel: upstreamLabel,

    // aggregation
    AGG_OPS: AGG_OPS, aggOp: aggOp, reduceValues: reduceValues,
    measurableCols: measurableCols, isMeasurable: isMeasurable,
    aggregateCol: aggregateCol, aggregateColumn: aggregateColumn,
    aggregateSchema: aggregateSchema, applyAggregate: applyAggregate,
    aggregateColumnsSchema: aggregateColumnsSchema,
    applyAggregateColumns: applyAggregateColumns,
    aggregateRowsColumn: aggregateRowsColumn, aggregateRowsSchema: aggregateRowsSchema,
    aggregateRowsIdx: aggregateRowsIdx, applyAggregateRows: applyAggregateRows,
    outputCols: outputCols,
    columnValues: columnValues,

    // select for
    SELECTFOR_OPS: SELECTFOR_OPS, selectForOp: selectForOp,
    groupFields: groupFields, groupField: groupField, groupColumn: groupColumn,
    statsOf: statsOf, newStat: newStat, defaultStats: defaultStats, statCol: statCol,
    hasStats: hasStats,
    selectForColumns: selectForColumns, evaluateSelectFor: evaluateSelectFor,
    measureColumns: measureColumns, measureValues: measureValues,

    // histogram
    HIST_BINS_WANTED: HIST_BINS_WANTED, HIST_MAX_BINS: HIST_MAX_BINS,
    autoWidth: autoWidth,
    binnableCols: binnableCols, binField: binField, binWidth: binWidth,
    binsFor: binsFor, binLabel: binLabel, fmtEdge: fmtEdge,
    binColumn: binColumn, histogramColumns: histogramColumns,
    applyHistogram: applyHistogram,
    globToRegExp: globToRegExp,
    labelCols: labelCols, labelsFromTable: labelsFromTable,
    labelsFromData: labelsFromData, rowsForLabel: rowsForLabel,
    addStat: addStat, removeStat: removeStat,

    /* toolbar height. The drag itself is layout, and layout is the one thing
       jsdom does not do, so what is exposed here is the arithmetic around it:
       the ceiling, the clamp, the height-to-size lookup and the table they all
       read. A test supplies the heights by standing in for the bar's own
       measurement, which is what the browser does anyway. */
    BAR_S_MIN: BAR_S_MIN, BAR_S_MAX: BAR_S_MAX, BAR_S_STEP: BAR_S_STEP,
    CANVAS_MIN_H: CANVAS_MIN_H, BAR_HANDLE_H: BAR_HANDLE_H,
    buildBarSteps: buildBarSteps, barStepTable: barStepTable, barStepFor: barStepFor,
    barRowCount: barRowCount, barMaxScale: barMaxScale, barHeightBudget: barHeightBudget,
    clampBarScale: clampBarScale, barFitForHeight: barFitForHeight,
    applyBarScale: applyBarScale, saveBarPrefs: saveBarPrefs, loadBarPrefs: loadBarPrefs,
    barScaleNow: function(){ return barScale; },
    barFillNow:  function(){ return barFill; },
    barStepsDrop: function(){ barSteps = null; barStepsW = -1; },

    // canvas gestures
    isCanvasBackground: isCanvasBackground,

    // results panel width and visibility
    PANEL_MIN: PANEL_MIN, PANEL_DEFAULT: PANEL_DEFAULT, PANEL_STRIP: PANEL_STRIP,
    PANEL_OPEN_AT_FIRST: PANEL_OPEN_AT_FIRST,
    CANVAS_MIN: CANVAS_MIN, HANDLE_W: HANDLE_W,
    panelMaxWidth: panelMaxWidth, clampPanelWidth: clampPanelWidth,
    applyPanelWidth: applyPanelWidth,
    showResultsPanel: showResultsPanel, hideResultsPanel: hideResultsPanel,
    toggleResultsPanel: toggleResultsPanel,
    panelHiddenNow: function(){ return panelHidden; },
    panelWidthNow: function(){ return panelWidth; },
    savePanelPrefs: savePanelPrefs, loadPanelPrefs: loadPanelPrefs,

    // unique
    uniqueCols: uniqueCols, uniqueCol: uniqueCol, uniqueCellKey: uniqueCellKey,
    uniqueSchema: uniqueSchema, applyUnique: applyUnique,
    selectedCols: selectedCols, selectSchema: selectSchema, applySelect: applySelect,
    canProject: canProject, projectCarried: projectCarried, projectColumns: projectColumns,
    projectSchema: projectSchema, applyProject: applyProject,
    enrolmentColumns: enrolmentColumns, enrolmentKeys: enrolmentKeys,
    combineOrder: combineOrder, joinColumns: joinColumns, joinTables: joinTables,

    // take
    applyTake: applyTake, takeCount: takeCount,
    TAKE_DEFAULT: TAKE_DEFAULT, TAKE_MIN: TAKE_MIN,
    canConnect: canConnect, CONNECT_RULES: CONNECT_RULES,

    // why a drop did not wire, and the note that says so
    connectRefusal: connectRefusal, wireBetween: wireBetween,
    snapDistance: snapDistance, portGap: portGap, midWorld: midWorld,
    portsTakenText: portsTakenText, listWords: listWords,
    CONN_FREE_FIX: CONN_FREE_FIX, CONN_NOTE_MS: CONN_NOTE_MS,
    showConnNote: showConnNote, hideConnNote: hideConnNote,
    connNoteText: connNoteText, placeConnNote: placeConnNote,
    NODE_LABELS: NODE_LABELS,

    // the results panel follows the graph: a block whose Output is gone goes
    PANEL_START: PANEL_START, panelFollowsGraph: panelFollowsGraph,
    /* The two ways text reaches the panel. Exported apart because they differ
       in exactly one way that matters here: showError() opens a shut panel and
       setOutput() does not. See the pair in panel-width.js. */
    setOutput: setOutput, showError: showError,

    // what a node does, after a rest on its shape
    NODE_TIPS: NODE_TIPS, nodeTipText: nodeTipText, NODE_TIP_DELAY: NODE_TIP_DELAY,
    armNodeTip: armNodeTip, showNodeTip: showNodeTip, hideNodeTip: hideNodeTip,
    cancelNodeTip: cancelNodeTip, nodeTipShown: nodeTipShown,
    placeNodeTip: placeNodeTip, onNodeHover: onNodeHover,

    // edge preview. The column cap is paired with a width in the stylesheet,
    // so it is exported to be asserted on rather than trusted to stay in step.
    PREVIEW_COLS: PREVIEW_COLS, PREVIEW_ROWS: PREVIEW_ROWS,
    previewColumns: previewColumns, previewTableHTML: previewTableHTML,
    edgeData: edgeData,

    // view: zoom, pan and world coordinates
    view: function(){ return view; },
    setZoom: setZoom, zoomToFit: zoomToFit, centreView: centreView, clampPan: clampPan, applyView: applyView,
    toWorld: toWorld, toScreen: toScreen, viewCentreWorld: viewCentreWorld,
    nodeBox: nodeBox, graphBounds: graphBounds, freeSpotNear: freeSpotNear,
    WORLD_W: WORLD_W, WORLD_H: WORLD_H, MIN_ZOOM: MIN_ZOOM, MAX_ZOOM: MAX_ZOOM,

    // selection
    selection: function(){ return selection; },
    setSelection: setSelection, selectOnly: selectOnly, clearSelection: clearSelection,
    selectAll: selectAll, toggleSelected: toggleSelected, isSelected: isSelected,
    deleteSelection: deleteSelection, selectBranch: selectBranch,

    // the off switch
    isNodeOff: isNodeOff, nodeCanBeOff: nodeCanBeOff,
    toggleNodesOff: toggleNodesOff, toggleSelectionOff: toggleSelectionOff,
    EDGE_PALETTE: EDGE_PALETTE, EDGE_OFF_COLOR: EDGE_OFF_COLOR,

    connectedComponent: connectedComponent, nodesInWorldRect: nodesInWorldRect,

    // export + persistence
    serialiseTable: serialiseTable, exportTableFor: exportTableFor, safeName: safeName,
    exportNameOf: exportNameOf, defaultExportName: defaultExportName, markStale: markStale,
    timeStamp: timeStamp, dateStamp: dateStamp, resultHTML: resultHTML, scalarHTML: scalarHTML, tableHTML: tableHTML,
    courseLabel: courseLabel, courseTitle: courseTitle, courseSelect: courseSelect,
    serialiseGraph: serialiseGraph, deserialiseGraph: deserialiseGraph,
    applyGraph: applyGraph, loadGraphFromText: loadGraphFromText,
    FILE_KIND: FILE_KIND, FILE_VERSION: FILE_VERSION,

    // naming and file admission
    queryFileName: queryFileName, defaultQueryName: defaultQueryName,
    stripQueryExt: stripQueryExt,
    lastQueryName: function(){ return lastQueryName; },
    writeQueryFile: writeQueryFile, graphFileProblem: graphFileProblem,
    openSaveDialog: openSaveDialog, closeSaveDialog: closeSaveDialog,
    confirmSaveGraph: confirmSaveGraph, saveDialogOpen: saveDialogOpen,
    updateSaveHint: updateSaveHint,
    requestClearAll: requestClearAll, closeClearDialog: closeClearDialog,
    confirmClearAll: confirmClearAll, clearDialogOpen: clearDialogOpen,
    skipClearConfirm: function(){ return skipClearConfirm; },
    openHelp: openHelp, closeHelp: closeHelp, helpOpen: helpOpen,
    syncHelpNav: syncHelpNav, scrollHelpTo: scrollHelpTo,
    QUERY_EXT: QUERY_EXT, MAX_QUERY_FILE_BYTES: MAX_QUERY_FILE_BYTES,

    // query library
    LIB_STORE: LIB_STORE, LIB_KIND: LIB_KIND, LIB_VERSION: LIB_VERSION,
    LIB_NAME_MAX: LIB_NAME_MAX, LIB_MAX_ENTRIES: LIB_MAX_ENTRIES,
    LIB_MESSAGES: LIB_MESSAGES,
    libRead: libRead, libWrite: libWrite, libBytes: libBytes,
    libGet: libGet, libIndexOf: libIndexOf, libNameTaken: libNameTaken,
    libName: libName, libNewId: libNewId, libEntryFor: libEntryFor,
    libAdd: libAdd, libRename: libRename, libRemove: libRemove,
    libGraphText: libGraphText, libIsQuota: libIsQuota,

    // the card's picture. Drawn from the graph, never stored, never carrying
    // anything out of an entry but its node types: see libThumb.
    libThumb: libThumb, libInk: libInk, LIB_INK: LIB_INK,
    libThumbNodes: libThumbNodes, libShapeBox: libShapeBox,
    LIB_THUMB_W: LIB_THUMB_W, LIB_THUMB_H: LIB_THUMB_H,
    LIB_THUMB_MAX_NODES: LIB_THUMB_MAX_NODES,

    // the dialog
    openLibrary: openLibrary, closeLibrary: closeLibrary, libraryOpen: libraryOpen,
    renderLibrary: renderLibrary, libSearchInput: libSearchInput,
    libOpenEntry: libOpenEntry, libDeleteEntry: libDeleteEntry,
    libExportEntry: libExportEntry, libSaveCurrent: libSaveCurrent,
    libStartRename: libStartRename, libCommitRename: libCommitRename,
    libRenameKey: libRenameKey, libStartOver: libStartOver,
    libCardHTML: libCardHTML, libWhen: libWhen, libSizeText: libSizeText,
    LIB_SEARCH_MIN: LIB_SEARCH_MIN,
    libPendingNow: function(){ return libPending; },
    libNoticeNow:  function(){ return libNotice; },

    // export / import
    libCleanEntry: libCleanEntry, libExportPayload: libExportPayload,
    libImportText: libImportText, libImportSummary: libImportSummary,
    libFileProblem: libFileProblem, MAX_LIB_FILE_BYTES: MAX_LIB_FILE_BYTES,
    libExportAll: libExportAll, libPickImport: libPickImport,

    // the save dialog's second destination
    confirmSaveToLibrary: confirmSaveToLibrary, saveHintSay: saveHintSay,
    saveLibPendingNow: function(){ return saveLibPending; },

    /* VARIABLES
       `variables` is reassigned wholesale by applyGraph() and clearVariables(),
       so it is handed back through a function for the reason `nodes` is. */
    variables: function(){ return variables; },
    VAR_MAX: VAR_MAX, VAR_NAME_MAX: VAR_NAME_MAX, VAR_VALUE_MAX: VAR_VALUE_MAX,
    VAR_OPERANDS: VAR_OPERANDS, nodeTakesVars: nodeTakesVars,
    varById: varById, varName: varName, varLabel: varLabel,
    varNameClashes: varNameClashes, nextVarName: nextVarName,
    addVariable: addVariable, removeVariable: removeVariable,
    requestRemoveVariable: requestRemoveVariable,
    setVarName: setVarName, setVarValue: setVarValue, clearVariables: clearVariables,
    varUsage: varUsage, varUsedCount: varUsedCount,
    boundVar: boundVar, isBoundTo: isBoundTo, setBinding: setBinding,
    operandHTML: operandHTML, useVariableAt: useVariableAt,
    onVarChipClick: onVarChipClick, onVarInput: onVarInput,
    critBindKey: critBindKey, cfgBindKey: cfgBindKey,
    renderVariables: renderVariables, syncVarUsage: syncVarUsage,
    toggleVarMenu: toggleVarMenu, varMenuOpen: varMenuOpen, varDockSay: varDockSay,
    syncMenuButtons: syncMenuButtons,
    varUseWords: varUseWords, varChipHTML: varChipHTML,
    varPendingNow: function(){ return varPending; },
    readVariables: readVariables, pruneVarBindings: pruneVarBindings
  };
}

// The world layer needs its size and transform before the first paint, or the
// first frame shows an unsized viewport and the nodes jump when it settles.
applyView();
centreView();
/* Before render(), because render() only syncs the lines inside the chips and
   there are none until the dock has drawn its empty state. */
renderVariables();
render();
