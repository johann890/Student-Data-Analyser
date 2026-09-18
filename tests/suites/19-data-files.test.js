/* ADMITTING A FILE, AND READING ONE.

   These are the checks that stand between an arbitrary file on disk and the
   DOM. They are tested at two levels, deliberately:

     - the admission predicates and the parsers, called directly, because a
       refusal has to be provable for inputs nobody would build a fixture of by
       accident (a name with a path in it, a NUL byte, a field count off by one)

     - the real archive in ../data, read end to end, because a parser tested
       only against fixtures the same author wrote is a parser tested against
       its own assumptions.

   The suite is written so that a loosened rule fails a named test rather than
   quietly widening what the tool will read. That is the point of pinning a
   security boundary: it is not enough that it works today, it has to be
   noticeable when it stops. */

const { boot, dataDirFile, hasDataDir } = require('../lib/harness');
const { assert } = require('../lib/assert');

module.exports = ({ describe, test }) => {
  const t = boot();
  const { app } = t;

  const HDR = hasDataDir() ? dataDirFile('headers.txt') : null;
  const Y22 = hasDataDir() ? dataDirFile('mcs-students-2022') : null;

  // A file as the admission checks see one: a name and a size, nothing more.
  const named = (name, size) => ({ name, size: size === undefined ? 1024 : size });

  /* A minimal header that satisfies every rule, for tests about year files that
     should not also be tests about headers. Seven required columns plus two
     that are ignored, so "ignored columns are ignored" is exercised too. */
  const MINI_NAMES = 'ID gender deg1 maj1 Year Crse Grade Pts email';
  const MINI = () => {
    const h = app.parseHeaderFile(MINI_NAMES + '\n1 2 3 4 5 6 7 8 9\n', 'headers.txt');
    if (h.error) throw new Error('the fixture header is itself invalid: ' + h.error);
    return h;
  };
  // id, gender, deg1, maj1, Year, Crse, Grade, Pts, email
  const row = (o) => [
    o.id === undefined ? '300100001' : o.id,
    o.gender === undefined ? 'M' : o.gender,
    'BSC',
    o.maj1 === undefined ? 'SWEN' : o.maj1,
    o.year === undefined ? '202201' : o.year,
    o.code === undefined ? 'SWEN421' : o.code,
    o.grade === undefined ? 'A' : o.grade,
    o.pts === undefined ? '15' : o.pts,
    'a@b.nz'
  ].join('\t');

  /* ══ 1. THE NAMES ══════════════════════════════════════════════════════════
     The first gate, and the one the user meets most often. It runs before a
     byte is read, so every assertion here is also an assertion that nothing
     was read. */
  describe('the column file is admitted by name, and by that name only', () => {
    test('the archive\'s own name is accepted', () => {
      assert.equal(app.headersFileProblem(named('headers.txt')), null);
    });

    test('case is not the thing being enforced', () => {
      // macOS hands back whatever case the volume stores, and refusing
      // "Headers.txt" would refuse a file the user genuinely picked.
      assert.equal(app.headersFileProblem(named('Headers.TXT')), null);
    });

    test('a near miss is refused, and the refusal quotes what was offered', () => {
      ['header.txt', 'headers.txt.txt', 'headers', 'headers.csv', 'my-headers.txt']
        .forEach(n => {
          const p = app.headersFileProblem(named(n));
          assert.ok(p, n + ' should be refused');
          assert.includes(p, n, 'the refusal should name the file');
          assert.includes(p, 'headers.txt', 'and say what was wanted');
        });
    });

    test('a name carrying a path is judged on its last segment, then refused', () => {
      // Not a traversal defence so much as a refusal to have a special case:
      // strip the directory, and "../../etc/passwd" is answered by the ordinary
      // "that is not one of the two names" rule.
      const p = app.headersFileProblem(named('../../etc/passwd'));
      assert.ok(p, 'refused');
      assert.excludes(p, '../', 'the path should not be echoed back verbatim');
      assert.equal(app.dataFileName({ name: '../../etc/passwd' }), 'passwd');
      assert.equal(app.dataFileName({ name: 'C:\\Windows\\headers.txt' }), 'headers.txt');
    });

    test('a directory prefix does not smuggle the right name past the check', () => {
      // The flip side: "evil/headers.txt" IS headers.txt once the directory is
      // dropped, and a File's name never carries one anyway.
      assert.equal(app.headersFileProblem(named('evil/headers.txt')), null);
    });

    test('nothing chosen is a refusal, not a crash', () => {
      assert.ok(app.headersFileProblem(null));
      assert.ok(app.headersFileProblem(undefined));
    });
  });

  describe('a year file is admitted by name, and the name carries the year', () => {
    test('the archive\'s own names are accepted', () => {
      assert.equal(app.yearFileProblem(named('mcs-students-2022')), null);
      assert.equal(app.yearFileProblem(named('mcs-students-2023')), null);
    });

    test('an extension is not tolerated, because the archive has none', () => {
      ['mcs-students-2022.txt', 'mcs-students-2022.csv', 'mcs-students-2022.tsv']
        .forEach(n => assert.ok(app.yearFileProblem(named(n)), n + ' should be refused'));
    });

    test('the year has to be four digits and nothing else', () => {
      ['mcs-students-22', 'mcs-students-20222', 'mcs-students-', 'mcs-students-two',
       'mcs-students-2022a', 'mcs-students-2022-copy'].forEach(n =>
        assert.ok(app.yearFileProblem(named(n)), n + ' should be refused'));
    });

    test('the prefix is exact — no other cohort file gets in on the pattern', () => {
      ['students-2022', 'mcs-staff-2022', 'MCS-STUDENTS-2022', 'xmcs-students-2022']
        .forEach(n => assert.ok(app.yearFileProblem(named(n)), n + ' should be refused'));
    });

    test('a year outside the admitted range is refused even if it parses', () => {
      assert.ok(app.yearFileProblem(named('mcs-students-0001')));
      assert.ok(app.yearFileProblem(named('mcs-students-1989')));
      assert.equal(app.yearFileProblem(named('mcs-students-1990')), null, 'the floor is admitted');
      assert.equal(app.yearFileProblem(named('mcs-students-2099')), null, 'and the ceiling');
      assert.ok(app.yearFileProblem(named('mcs-students-2100')));
    });

    test('the year is read from the name and from nowhere else', () => {
      assert.equal(app.yearOfFile(named('mcs-students-2023')), 2023);
      assert.equal(app.yearOfFile(named('mcs-students-2023.txt')), null);
    });

    test('the refusal explains the convention rather than only rejecting', () => {
      const p = app.yearFileProblem(named('2022.csv'));
      assert.includes(p, 'mcs-students-', 'it should say what the name must look like');
      assert.includes(p, 'no extension');
    });
  });

  /* ══ 2. SIZE ═══════════════════════════════════════════════════════════════ */
  describe('size is judged before the file is opened', () => {
    test('an empty file is refused with a reason of its own', () => {
      assert.includes(app.headersFileProblem(named('headers.txt', 0)), 'empty');
      assert.includes(app.yearFileProblem(named('mcs-students-2022', 0)), 'empty');
    });

    test('a file past the cap is refused, and is said not to have been read', () => {
      const p = app.yearFileProblem(named('mcs-students-2022', app.MAX_DATA_FILE_BYTES + 1));
      assert.ok(p);
      assert.includes(p, 'not been read');
    });

    test('the cap leaves the archive two orders of magnitude of headroom', () => {
      // The real year files are ~300 KB. A cap that a real file could reach
      // would be a cap that fails the user rather than an attacker.
      assert.ok(app.MAX_DATA_FILE_BYTES >= 100 * 1024 * 1024 / 10,
        'the cap should be far above a real export');
      if (Y22) assert.ok(Buffer.byteLength(Y22) * 50 < app.MAX_DATA_FILE_BYTES);
    });
  });

  /* ══ 3. THE COLUMN FILE ════════════════════════════════════════════════════ */
  describe('reading the column file', () => {
    test('the archive\'s own header reads as 27 columns', function () {
      if (!HDR) return;
      const h = app.parseHeaderFile(HDR, 'headers.txt');
      assert.notOk(h.error, 'the real header should parse: ' + h.error);
      assert.equal(h.columns.length, 27);
      assert.equal(h.columns[0], 'ID');
      assert.equal(h.columns[26], 'email');
    });

    test('the columns the tool needs are located by name, not by position', function () {
      if (!HDR) return;
      const h = app.parseHeaderFile(HDR, 'headers.txt');
      assert.equal(h.byName.ID, 0);
      assert.equal(h.byName.gender, 1);
      assert.equal(h.byName.Year, 8);
      assert.equal(h.byName.Crse, 9);
      assert.equal(h.byName.Grade, 10);
      assert.equal(h.byName.Pts, 16);
    });

    test('a duplicated name resolves to its first occurrence', function () {
      if (!HDR) return;
      // maj1 and maj2 appear twice, once per degree. The first is the first
      // degree, which is what every other column on the row is about.
      const h = app.parseHeaderFile(HDR, 'headers.txt');
      assert.equal(h.byName.maj1, 3, 'the first maj1, not the second at 6');
    });

    test('a header missing a column the tool reads is refused by name', () => {
      const p = app.parseHeaderFile('ID gender deg1 maj1 Year Crse Grade x y', 'headers.txt');
      assert.ok(p.error);
      assert.includes(p.error, 'Pts', 'the refusal should say which column is missing');
    });

    test('a header too short to be one is refused', () => {
      assert.ok(app.parseHeaderFile('ID gender', 'headers.txt').error);
      assert.ok(app.parseHeaderFile('', 'headers.txt').error);
      assert.ok(app.parseHeaderFile('   \n  \n', 'headers.txt').error);
    });

    test('the index line is checked against the names when it is there', () => {
      const short = app.parseHeaderFile(MINI_NAMES + '\n1 2 3 4 5 6 7 8\n', 'headers.txt');
      assert.ok(short.error, 'nine names numbered eight is a contradiction');
      assert.includes(short.error, 'numbers');

      const jumbled = app.parseHeaderFile(MINI_NAMES + '\n1 2 3 4 5 6 7 9 8\n', 'headers.txt');
      assert.ok(jumbled.error, 'out-of-order numbering is a hand edit, not a header');
    });

    test('a header with no index line at all is still a usable header', () => {
      // The numbering is a convenience of the export, not part of the contract.
      const h = app.parseHeaderFile(MINI_NAMES, 'headers.txt');
      assert.notOk(h.error);
      assert.equal(h.columns.length, 9);
    });

    test('a second line that is not numbering is left alone', () => {
      // Only a line that is entirely digits is read as the index line, so a
      // header followed by a comment or a blank is not mistaken for one.
      const h = app.parseHeaderFile(MINI_NAMES + '\n# exported 2024\n', 'headers.txt');
      assert.notOk(h.error);
    });

    test('control characters are refused outright', () => {
      const p = app.parseHeaderFile(MINI_NAMES + '\u0000\n', 'headers.txt');
      assert.ok(p.error);
      assert.includes(p.error, 'control characters');
    });

    test('the name it reports is the file\'s own, stripped of any path', () => {
      const h = app.parseHeaderFile(MINI_NAMES, 'some/dir/headers.txt');
      assert.equal(h.name, 'headers.txt');
    });
  });

  /* ══ 4. THE YEAR FILE ══════════════════════════════════════════════════════
     The shape check is what makes the two files a pair. Everything else here is
     a claim about a single field being what it says it is. */
  describe('reading a year file', () => {
    test('a well-formed pair of rows becomes one student with two enrolments', () => {
      const out = app.parseYearFile(
        row({ code: 'SWEN421', grade: 'A+' }) + '\n' + row({ code: 'SWEN430', grade: 'B' }) + '\n',
        2022, MINI());
      assert.notOk(out.error, out.error);
      assert.equal(out.students.length, 1);
      assert.equal(out.rows, 2);
      assert.equal(out.students[0].courses.length, 2);
      assert.equal(out.students[0].id, 300100001);
    });

    test('the GPA is derived from the enrolments, not read from the file', () => {
      // A+ over 15 and B over 30 is (9*15 + 5*30) / 45 = 6.33.
      const out = app.parseYearFile(
        row({ code: 'SWEN421', grade: 'A+', pts: '15' }) + '\n' +
        row({ code: 'ENGR489', grade: 'B',  pts: '30' }) + '\n', 2022, MINI());
      assert.equal(out.students[0].gpa, 6.33);
      assert.equal(out.students[0].letterGrade, 'B+', 'the standing a 6.33 reads back as');
    });

    test('a dropped course is ungraded, and does not drag the average down', () => {
      const out = app.parseYearFile(
        row({ code: 'SWEN421', grade: 'A', pts: '15' }) + '\n' +
        row({ code: 'CGRA151', grade: '',  pts: '0' }) + '\n', 2022, MINI());
      assert.notOk(out.error, out.error);
      assert.equal(out.students[0].courses.length, 2, 'the dropped course is kept as a record');
      assert.equal(out.students[0].gpa, 8, 'but contributes nothing to the GPA');
      assert.equal(out.students[0].courses[0].gradePoints, null,
        'sorted by code, CGRA151 comes first and has no grade point');
    });

    test('the row count and the student count are different numbers, and both are kept', () => {
      const out = app.parseYearFile(
        row({ id: '300100001' }) + '\n' + row({ id: '300100001', code: 'SWEN430' }) + '\n' +
        row({ id: '300100002' }) + '\n', 2022, MINI());
      assert.equal(out.rows, 3);
      assert.equal(out.students.length, 2);
    });

    describe('the shape check — what makes the two files a pair', () => {
      test('a row with too few fields refuses the file and names the line', () => {
        const out = app.parseYearFile(
          row({}) + '\n' + '300100002\tM\tBSC\tSWEN\t202201\n', 2022, MINI());
        assert.ok(out.error);
        assert.includes(out.error, 'Line 2');
        assert.includes(out.error, '5 tab-separated fields');
        assert.includes(out.error, '9');
      });

      test('a row with too many fields is refused the same way', () => {
        const out = app.parseYearFile(row({}) + '\textra\n', 2022, MINI());
        assert.ok(out.error);
        assert.includes(out.error, 'do not describe the same export');
      });

      test('a file read against the wrong header is refused on its first row', function () {
        // The case this check exists for: the right file name, another
        // archive's columns. Twenty-seven fields judged against nine.
        if (!Y22 || !HDR) return;
        const out = app.parseYearFile(Y22.split('\n')[0] + '\n', 2022, MINI());
        assert.ok(out.error, 'a 27-field row must not be read into a 9-column header');
        assert.includes(out.error, 'Line 1');
      });
    });

    describe('a field is what it claims to be, or the file is refused', () => {
      test('an ID is digits', () => {
        ['30010000a', '', ' ', '-1', '3.5', "1'; DROP TABLE"].forEach(id => {
          const out = app.parseYearFile(row({ id }) + '\n', 2022, MINI());
          assert.ok(out.error, JSON.stringify(id) + ' should be refused');
          assert.includes(out.error, 'student ID');
        });
      });

      test('an ID longer than any student number is refused', () => {
        assert.ok(app.parseYearFile(row({ id: '1'.repeat(13) }) + '\n', 2022, MINI()).error);
      });

      test('the Year column has to be a year', () => {
        ['', 'soon', '20', '2022013'].forEach(year => {
          const out = app.parseYearFile(row({ year }) + '\n', 2022, MINI());
          assert.ok(out.error, JSON.stringify(year) + ' should be refused');
        });
      });

      test('a bare four-digit year is accepted as well as year-plus-trimester', () => {
        assert.notOk(app.parseYearFile(row({ year: '2022' }) + '\n', 2022, MINI()).error);
        assert.notOk(app.parseYearFile(row({ year: '202203' }) + '\n', 2022, MINI()).error);
      });

      test('points must be a non-negative number, and a small one', () => {
        ['-15', 'fifteen', '', '1e3', '15pts'].forEach(pts => {
          assert.ok(app.parseYearFile(row({ pts }) + '\n', 2022, MINI()).error,
            JSON.stringify(pts) + ' should be refused');
        });
        assert.ok(app.parseYearFile(row({ pts: '100000' }) + '\n', 2022, MINI()).error,
          'a course worth 100000 points is a misread column');
        assert.notOk(app.parseYearFile(row({ pts: '0' }) + '\n', 2022, MINI()).error,
          'a dropped course is worth zero and is legitimate');
      });

      test('a course code has the shape of a course code', () => {
        ['', 'SWEN', '421', 'SWEN-421', '<img src=x>', 'SWENSWEN4211'].forEach(code => {
          assert.ok(app.parseYearFile(row({ code }) + '\n', 2022, MINI()).error,
            JSON.stringify(code) + ' should be refused');
        });
        ['SWEN421', 'CGRA151', 'ENGR489', 'MATH261A'].forEach(code => {
          assert.notOk(app.parseYearFile(row({ code }) + '\n', 2022, MINI()).error, code);
        });
      });

      test('an unknown grade is a warning, not a refusal', () => {
        // gradePoint() already answers null for anything off the scale, so the
        // row is safe to keep. Refusing real data over a code the tool has not
        // been told about is the worse failure.
        const out = app.parseYearFile(row({ grade: 'WD' }) + '\n', 2022, MINI());
        assert.notOk(out.error);
        assert.equal(out.students[0].courses[0].gradePoints, null);
        assert.includes(out.warnings.join(' '), 'WD', 'and it is reported');
      });

      test('a field longer than any real one refuses the file', () => {
        const out = app.parseYearFile(
          row({ maj1: 'x'.repeat(app.MAX_FIELD_CHARS + 1) }) + '\n', 2022, MINI());
        assert.ok(out.error);
        assert.includes(out.error, 'longer than');
      });

      test('control characters anywhere in the file refuse it', () => {
        const out = app.parseYearFile(row({}) + '\u0007\n', 2022, MINI());
        assert.ok(out.error);
        assert.includes(out.error, 'control characters');
      });

      test('a tab and a newline are not control characters — they are the format', () => {
        assert.notOk(app.parseYearFile(row({}) + '\r\n' + row({ id: '2' }) + '\n',
          2022, MINI()).error, 'CRLF line endings are ordinary');
      });
    });

    describe('the file has to be the year it is named for', () => {
      test('a row from another year refuses the whole file', () => {
        const out = app.parseYearFile(row({ year: '202301' }) + '\n', 2022, MINI());
        assert.ok(out.error);
        assert.includes(out.error, 'named for 2022');
        assert.includes(out.error, '2023');
      });

      test('the refusal comes even when most of the file agrees', () => {
        const out = app.parseYearFile(
          row({}) + '\n' + row({ id: '300100002' }) + '\n' +
          row({ id: '300100003', year: '202301' }) + '\n', 2022, MINI());
        assert.ok(out.error);
        assert.includes(out.error, 'line 3');
      });

      test('the year on every enrolment is the file\'s year, not the row\'s digits', () => {
        const out = app.parseYearFile(row({ year: '202202' }) + '\n', 2022, MINI());
        assert.equal(out.students[0].year, 2022);
        assert.equal(out.students[0].courses[0].year, 2022);
      });
    });

    test('a file with no rows in it is refused rather than loaded as nothing', () => {
      const out = app.parseYearFile('\n\n   \n', 2022, MINI());
      assert.ok(out.error);
      assert.includes(out.error, 'no enrolment rows');
    });

    test('blank lines between rows are skipped, not counted', () => {
      const out = app.parseYearFile(row({}) + '\n\n' + row({ id: '300100002' }) + '\n', 2022, MINI());
      assert.notOk(out.error);
      assert.equal(out.rows, 2);
    });
  });

  /* ══ 5. THE REAL ARCHIVE ═══════════════════════════════════════════════════
     Everything above can be satisfied by a parser that happens to agree with
     its own fixtures. This is the part that cannot. */
  describe('the archive in ../data, read end to end', () => {
    test('the data folder is where the suite expects it', () => {
      assert.ok(hasDataDir(),
        'tests/../data should hold headers.txt and the mcs-students-YYYY files');
    });

    test('2022 reads without a single refusal', function () {
      if (!Y22) return;
      const out = app.parseYearFile(Y22, 2022, app.parseHeaderFile(HDR, 'headers.txt'));
      assert.notOk(out.error, out.error);
      assert.equal(out.rows, 2170, 'every enrolment row');
      assert.equal(out.students.length, 280, 'folded into distinct students');
    });

    test('2023 reads too, and is a different cohort', function () {
      if (!hasDataDir()) return;
      const out = app.parseYearFile(dataDirFile('mcs-students-2023'), 2023,
        app.parseHeaderFile(HDR, 'headers.txt'));
      assert.notOk(out.error, out.error);
      assert.equal(out.rows, 1956);
      assert.ok(out.students.length > 0);
      out.students.forEach(s => assert.equal(s.year, 2023));
    });

    test('2024 reads too, and carries the third year of the archive', function () {
      if (!hasDataDir()) return;
      const out = app.parseYearFile(dataDirFile('mcs-students-2024'), 2024,
        app.parseHeaderFile(HDR, 'headers.txt'));
      assert.notOk(out.error, out.error);
      assert.equal(out.rows, 1927);
      assert.equal(out.students.length, 248);
      out.students.forEach(s => assert.equal(s.year, 2024));
      assert.deepEqual(out.warnings, [],
        'a year added later must not introduce a grade code the tool cannot read');
    });

    test('the archive\'s 33 dropped courses survive as ungraded enrolments', function () {
      if (!Y22) return;
      const out = app.parseYearFile(Y22, 2022, app.parseHeaderFile(HDR, 'headers.txt'));
      const ungraded = out.students.reduce((n, s) =>
        n + s.courses.filter(c => c.gradePoints === null).length, 0);
      assert.equal(ungraded, 33, 'the DD rows, kept as records and left out of every GPA');
    });

    test('no student comes out with a GPA the scale cannot produce', function () {
      if (!Y22) return;
      const out = app.parseYearFile(Y22, 2022, app.parseHeaderFile(HDR, 'headers.txt'));
      out.students.forEach(s => {
        if (s.gpa === null) return;
        assert.ok(s.gpa >= 0 && s.gpa <= 9, 'student ' + s.id + ' has a GPA of ' + s.gpa);
      });
    });

    test('the archive raises no unknown-grade warnings', function () {
      if (!Y22) return;
      const out = app.parseYearFile(Y22, 2022, app.parseHeaderFile(HDR, 'headers.txt'));
      assert.deepEqual(out.warnings, [],
        'every grade in the real file is on the university\'s scale');
    });

    test('the columns the tool does not need are not carried out of the parser', function () {
      if (!Y22) return;
      // Names, usernames, emails and ethnicity are in the file and must not be
      // in the model: the least exposed way to hold personal data is not to.
      const out = app.parseYearFile(Y22, 2022, app.parseHeaderFile(HDR, 'headers.txt'));
      const s = out.students[0];
      assert.deepEqual(Object.keys(s).sort(),
        ['courses', 'degree', 'gender', 'gpa', 'id', 'letterGrade',
         'specialisation', 'year'].sort());
      assert.excludes(JSON.stringify(out.students.slice(0, 20)), '@',
        'no email address should have reached the model');
      assert.excludes(JSON.stringify(out.students.slice(0, 20)), 'European',
        'nor any ethnicity');
    });

    test('a year file read as the wrong year is refused, using the real files', function () {
      if (!Y22) return;
      const out = app.parseYearFile(Y22, 2023, app.parseHeaderFile(HDR, 'headers.txt'));
      assert.ok(out.error, 'the 2022 export must not load as 2023');
      assert.includes(out.error, 'named for 2023');
    });
  });

  /* ══ 6. THE SHAPE THE REST OF THE TOOL RELIES ON ═══════════════════════════ */
  describe('what a parsed student is, and what a dataset is', () => {
    test('a parsed student is the same shape the generator produces', function () {
      if (!Y22) return;
      const real = app.parseYearFile(Y22, 2022, app.parseHeaderFile(HDR, 'headers.txt'))
        .students[0];
      const syn = app.syntheticDataset().students[0];
      assert.deepEqual(Object.keys(real).sort(), Object.keys(syn).sort(),
        'nothing downstream should be able to tell which path produced it');
      assert.deepEqual(Object.keys(real.courses[0]).sort(), Object.keys(syn.courses[0]).sort());
    });

    test('a dataset names its files, counts its rows, and orders its years', () => {
      const a = app.parseYearFile(row({}) + '\n', 2022, MINI());
      const b = app.parseYearFile(row({ year: '202301' }) + '\n', 2023, MINI());
      // Handed out of order on purpose: the dataset sorts.
      const d = app.buildDataset(MINI(), [b, a]);
      assert.deepEqual(d.years, [2022, 2023]);
      assert.deepEqual(d.files.map(f => f.name), ['mcs-students-2022', 'mcs-students-2023']);
      assert.equal(d.students.length, 2);
    });

    test('a student in two years is two rows, because a row is a student in a year', () => {
      const a = app.parseYearFile(row({ id: '300100001' }) + '\n', 2022, MINI());
      const b = app.parseYearFile(row({ id: '300100001', year: '202301' }) + '\n', 2023, MINI());
      const d = app.buildDataset(MINI(), [a, b]);
      assert.equal(d.students.length, 2, 'so "the 2022 cohort" stays countable');
      assert.deepEqual(d.students.map(s => s.year), [2022, 2023]);
    });

    test('warnings from every year file reach the dataset, deduplicated', () => {
      const a = app.parseYearFile(row({ grade: 'WD' }) + '\n', 2022, MINI());
      const b = app.parseYearFile(row({ grade: 'WD', year: '202301' }) + '\n', 2023, MINI());
      const d = app.buildDataset(MINI(), [a, b]);
      assert.equal(d.warnings.length, 1);
    });
  });
};
