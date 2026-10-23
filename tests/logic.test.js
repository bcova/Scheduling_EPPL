// Run with:  node tests/logic.test.js
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../src/Logic.gs'), 'utf8'));

// ---- parsers ----
assert.strictEqual(parseDateKey_('5/1/2026'), '2026-05-01');
assert.strictEqual(parseDateKey_('2026-05-01'), '2026-05-01');
assert.strictEqual(parseDateKey_(''), null);
assert.strictEqual(parseTime_('9:00 AM'), 540);
assert.strictEqual(parseTime_('12:30 AM'), 30);
assert.strictEqual(parseTime_('12:00 PM'), 720);
assert.strictEqual(parseTime_('9pm'), 1260);
assert.strictEqual(parseTime_('13:30'), 810);
assert.strictEqual(parseTime_('nonsense'), null);
assert.strictEqual(parseDuration_('0:15:00'), 15);
assert.strictEqual(parseDuration_('1:00'), 60);
assert.strictEqual(parseDuration_('1:00:00'), 60);
assert.strictEqual(parseDuration_('0:45:00'), 45);
assert.strictEqual(parseDuration_('12:30 AM'), 30);
assert.strictEqual(parseDuration_(''), 0);
assert.strictEqual(fmtTime_(540), '9:00 AM');
assert.strictEqual(fmtTime_(0), '12:00 AM');
assert.strictEqual(weekday_('2026-05-01'), 'Friday');
assert.strictEqual(weekStart_('2026-05-01'), '2026-04-26'); // Sunday
assert.deepStrictEqual(splitStaff_('Maddie , Teegan'), ['Maddie', 'Teegan']);
assert.strictEqual(normName_('Mary-Carol'), normName_('mary carol'));

// ---- staff + programs (rows copied from the real sheet) ----
const staffNames = ['Katie', 'Jess', 'Alex', 'Mary-Carol', 'Halle', 'Thomas', 'Maddie', 'Teegan'];
const map = {};
staffNames.forEach(n => (map[normName_(n)] = n));
map[normName_('Mary Carol')] = 'Mary-Carol';
const lookup = k => map[k] || null;

const base = { 'Approved': 'TRUE', 'Denied': '', 'cancelled': '', 'All Day Event?': 'No', 'Active/Passive': 'Active' };
const rows = [
  { ...base, ID: '1421', 'Program Name': 'Birthday Club', 'Start Date': '5/1/2026', 'End Date': '5/31/2026', 'AS/YS': 'YS', 'All Day Event?': 'TRUE', 'Active/Passive': 'Passive', 'Start Time': '9:00 AM', 'End Time': '9:00 PM', 'Staff Member(s)': 'Katie' },
  { ...base, ID: '1425', 'Program Name': 'Medicare 101', 'Start Date': '5/1/2026', 'End Date': '5/1/2026', 'AS/YS': 'AS', 'Setup Time': '0:30:00', 'Start Time': '10:00 AM', 'End Time': '11:30 AM', 'Teardown Time': '0:30:00', 'Staff Member(s)': 'Outside' },
  { ...base, ID: '1426', 'Program Name': 'Sensory Hour', 'Start Date': '5/1/2026', 'AS/YS': 'YS', 'Start Time': '10:30 AM', 'End Time': '11:30 AM', 'Staff Member(s)': 'Katie' },
  { ...base, ID: '1427', 'Program Name': 'Gaming Lounge', 'Start Date': '5/1/2026', 'AS/YS': 'YS', 'Start Time': '3:30 PM', 'End Time': '7:00 PM', 'Staff Member(s)': 'Jess' },
  { ...base, ID: '1436', 'Program Name': 'Paint and Sip', 'Start Date': '5/4/2026', 'AS/YS': 'AS', 'Setup Time': '1:00:00', 'Start Time': '6:30 PM', 'End Time': '8:00 PM', 'Teardown Time': '0:45:00', 'Staff Member(s)': 'Mary Carol & Sarah' },
  { ...base, ID: '1430', 'Program Name': 'Scavenger Hunt: Mythical Merfolk', 'Start Date': '5/3/2026', 'End Date': '5/9/2026', 'AS/YS': 'YS', 'Active/Passive': 'Passive', 'Start Time': '9:00 AM', 'End Time': '9:00 PM', 'Staff Member(s)': 'Courtney' },
  { ...base, ID: '9', 'Program Name': 'Cancelled Thing', 'cancelled': 'TRUE', 'Start Date': '5/5/2026', 'Start Time': '1:00 PM', 'End Time': '2:00 PM', 'Staff Member(s)': 'Katie' },
  { ...base, ID: '10', 'Program Name': 'Kid Take & Make: Glow canvas', 'Start Date': '5/5/2026', 'Start Time': '1:00 PM', 'End Time': '2:00 PM', 'Staff Member(s)': 'Katie' },
];
const res = buildProgramBlocks_(rows, { nonBlocking: { [normName_('Kid Take & Make')]: 1 }, lookup });
const names = res.blocks.map(b => b.name);
assert.deepStrictEqual(names, ['Medicare 101', 'Sensory Hour', 'Gaming Lounge', 'Paint and Sip']);
assert.deepStrictEqual(res.blocks[0].staff, []); // presenter is "Outside" -> nobody on staff is busy
assert.strictEqual(res.skipped.allDay, 1);
assert.strictEqual(res.skipped.passive, 1);
assert.strictEqual(res.skipped.cancelled, 1);
assert.strictEqual(res.skipped.nonBlocking, 1);
assert.deepStrictEqual(res.unmatched, { Sarah: 1 });
const paint = res.blocks[3];
assert.strictEqual(paint.busyStart, 18 * 60 + 30 - 60); // setup 1h
assert.strictEqual(paint.busyEnd, 20 * 60 + 45);        // teardown 45m
assert.deepStrictEqual(paint.staff, ['Mary-Carol']);

// ---- checker ----
const hours = {};
['Monday', 'Tuesday', 'Wednesday', 'Thursday'].forEach(d => (hours[d] = { open: 540, close: 1260 }));
hours.Friday = { open: 540, close: 1020 };
hours.Saturday = { open: 540, close: 1020 };
const cov = { AS: {}, YS: {} };
Object.keys(hours).forEach(d => { cov.AS[d] = 1; cov.YS[d] = 1; });

const sh = (dept, row, name, date, s, e) => ({ dept, row, name, date, start: parseTime_(s), end: parseTime_(e) });
const ctx = {
  shifts: [
    sh('YS', 2, 'Katie', '2026-05-01', '9:00 AM', '12:00 PM'),   // overlaps Sensory Hour 10:30-11:30 -> Problem
    sh('YS', 3, 'Jess', '2026-05-01', '12:00 PM', '1:00 PM'),    // gap 1pm-5pm in coverage
    sh('YS', 4, 'Jess', '2026-05-01', '3:30 PM', '5:00 PM'),     // overlaps Gaming Lounge 3:30-7 -> Problem
    sh('YS', 5, 'Katy', '2026-05-01', '5:00 PM', '5:00 PM'),     // end not after start -> Problem
    sh('AS', 6, 'Mary Carol', '2026-05-04', '5:00 PM', '6:00 PM'), // overlaps Paint and Sip setup (5:30) -> Problem
    sh('AS', 7, 'Thomas', '2026-05-05', '9:00 AM', '9:00 PM'),   // time off -> Problem, 12h
    sh('AS', 8, 'Zed', '2026-05-05', '9:00 AM', '10:00 AM'),     // unknown name -> Warning
    sh('AS', 9, 'Alex', '2026-05-03', '1:00 PM', '3:00 PM'),     // Sunday, library closed (no hours) -> Problem
  ],
  programs: res.blocks,
  staff: { Katie: { dept: 'YS', cap: 20 }, Jess: { dept: 'YS', cap: 0 }, 'Mary-Carol': { dept: 'AS', cap: 0 }, Thomas: { dept: 'AS', cap: 8 }, Alex: { dept: 'YS', cap: 0 } },
  lookup, timeOff: [{ name: 'Thomas', start: '2026-05-05', end: '2026-05-06' }],
  hours, coverage: cov, closures: {},
};
const w = runChecks_(ctx);
const has = (re) => w.some(x => re.test(x.message));
assert(has(/running "Sensory Hour"/), 'Sensory Hour conflict');
assert(has(/running "Gaming Lounge"/), 'Gaming Lounge conflict');
assert(has(/running "Paint and Sip"/), 'Paint and Sip setup conflict');
assert(has(/time off/), 'time off');
assert(has(/cap is 8/), 'hour cap');
assert(has(/"Zed" is not on the Staff tab/), 'unknown name');
assert(has(/closed on Sundays/), 'closed Sunday');
assert(has(/End time is not after start/), 'bad times');
assert(has(/Only 0 on YS desk \(need 1\) 1:00 PM-3:30 PM/), 'YS coverage gap: ' + JSON.stringify(w.filter(x => /Only/.test(x.message)).map(x => x.message)));
assert(has(/listed as YS but is on the AS/), 'dept mismatch note');
assert(!w.some(x => /Katie/.test(x.message) && /cap/.test(x.message)), 'no false cap');

// A clean schedule gives no problems.
const clean = runChecks_({ ...ctx, shifts: [sh('YS', 2, 'Katie', '2026-05-05', '9:00 AM', '9:00 PM'), sh('AS', 2, 'Thomas', '2026-05-06', '9:00 AM', '9:00 PM')], timeOff: [], staff: { Katie: { dept: 'YS', cap: 0 }, Thomas: { dept: 'AS', cap: 0 } } });
assert.deepStrictEqual(clean.filter(x => x.severity === 'Problem'), [], JSON.stringify(clean));

// ---- web app helpers ----
const v = validateShiftInput_({ dept: 'ys', date: '5/4/2026', name: 'mary carol', start: 540, end: '12:00 PM', notes: 'x' }, lookup);
assert.deepStrictEqual(v, { dept: 'YS', date: '2026-05-04', name: 'Mary-Carol', start: 540, end: 720, notes: 'x' });
assert(validateShiftInput_({ dept: 'ys', date: '5/4/2026', name: 'Nobody', start: 540, end: 600 }, lookup).error);
assert(validateShiftInput_({ dept: 'ys', date: '5/4/2026', name: 'Katie', start: 600, end: 540 }, lookup).error);
assert(validateShiftInput_({ dept: 'xx', date: '5/4/2026', name: 'Katie', start: 540, end: 600 }, lookup).error);

const wk = buildWeekPayload_({
  shifts: [{ id: 'a1', dept: 'YS', row: 2, name: 'Katie', date: '2026-05-01', start: 540, end: 720, notes: '' },
           { id: 'zz', dept: 'YS', row: 3, name: 'Katie', date: '2026-06-01', start: 540, end: 720 }],
  programs: res.blocks, timeOff: [], closures: { '2026-05-02': 1 }, staff: ctx.staff, lookup, hours, coverage: cov
}, '2026-05-01');
assert.strictEqual(wk.start, '2026-04-26');
assert.strictEqual(wk.days.length, 7);
assert.strictEqual(wk.shifts.length, 1);                       // June shift is outside this week
assert.deepStrictEqual(wk.closures, ['2026-05-02']);
const sensory = wk.warnings.find(x => /Sensory Hour/.test(x.message));
assert.strictEqual(sensory.shiftId, 'a1');                      // warning points at the shift
assert(wk.warnings.some(x => x.from != null && x.to != null));  // coverage bands carry minutes
assert.strictEqual(Object.keys(wk.shifts[0]).includes('canon'), false); // checker's scratch fields not leaked

console.log('All tests passed (' + w.length + ' warnings produced in the messy scenario).');
