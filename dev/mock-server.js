// Fake "server" for previewing the web app in a normal browser (NOT used in Google).
// Uses the REAL Logic.gs functions, so warnings behave exactly like production.
(function () {
  var q = new URLSearchParams(location.search);
  var role = { admin: 'Admin', as: 'AS Scheduler', ys: 'YS Scheduler', staff: 'Staff' }[q.get('role') || 'ys'] || 'Staff';
  var who = q.get('as') || 'Katie';

  var staffRows = [
    ['Katie', 'YS', 20], ['Jess', 'YS', 25], ['Alex', 'Both', 0], ['Halle', 'YS', 20], ['Arantza', 'YS', 12], ['Sid', 'YS', 0], ['Courtney', 'YS', 0],
    ['Mary-Carol', 'AS', 0], ['Thomas', 'AS', 8], ['John', 'AS', 0], ['Marta', 'Both', 0], ['Maddie', 'YS', 0]
  ];
  var staff = {}, map = {};
  staffRows.forEach(function (r) { staff[r[0]] = { dept: r[1], cap: r[2] }; map[normName_(r[0])] = r[0]; });
  map[normName_('Mary Carol')] = 'Mary-Carol';
  var lookup = function (k) { return map[k] || null; };

  var hours = {};
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday'].forEach(function (d) { hours[d] = { open: 540, close: 1260 }; });
  hours.Friday = { open: 540, close: 1020 }; hours.Saturday = { open: 540, close: 1020 }; hours.Sunday = { open: 780, close: 1020 };
  var coverage = { AS: {}, YS: {} };
  Object.keys(hours).forEach(function (d) { coverage.AS[d] = 1; coverage.YS[d] = 1; });

  // Programs: real rows from the sheet copy (May 3-6) plus a few made-up ones for Thu-Sat.
  var B = { Approved: 'TRUE', 'All Day Event?': 'No', 'Active/Passive': 'Active', 'Setup Time': '', 'Teardown Time': '' };
  function P(date, name, dept, s, e, staffNames, extra) { return Object.assign({}, B, { 'Program Name': name, 'Start Date': date, 'AS/YS': dept, 'Start Time': s, 'End Time': e, 'Staff Member(s)': staffNames, 'Program Room': '' }, extra || {}); }
  var rows = [
    P('5/3/2026', 'Mommy & Me Ukrainian Storytime', 'YS', '2:00 PM', '3:00 PM', 'Maddie', { 'Setup Time': '0:30:00', 'Teardown Time': '0:30:00', 'Program Room': 'Ferrentino' }),
    P('5/3/2026', 'Gaming Lounge', 'YS', '1:00 PM', '4:00 PM', 'Jess', { 'Program Room': 'Gaming Lounge' }),
    P('5/4/2026', 'Gentle Hybrid Mat Yoga', 'AS', '1:00 PM', '2:00 PM', 'Outside', { 'Program Room': 'Ferrentino' }),
    P('5/4/2026', 'Gaming Lounge', 'YS', '3:30 PM', '8:30 PM', 'Jess', { 'Program Room': 'Gaming Lounge' }),
    P('5/4/2026', 'May The 4th Party', 'YS', '4:00 PM', '6:00 PM', 'Alex', { 'Setup Time': '1:00:00', 'Teardown Time': '1:00' }),
    P('5/4/2026', 'Paint and Sip', 'AS', '6:30 PM', '8:00 PM', 'Mary-Carol', { 'Setup Time': '1:00:00', 'Teardown Time': '0:45:00', 'Program Room': 'Ferrentino' }),
    P('5/5/2026', 'Gaming Lounge', 'YS', '3:30 PM', '8:30 PM', 'Jess', { 'Program Room': 'Gaming Lounge' }),
    P('5/5/2026', 'Open Lab', 'YS', '4:00 PM', '5:00 PM', 'Sid', { 'Setup Time': '0:15:00', 'Teardown Time': '0:15:00', 'Program Room': 'PNG' }),
    P('5/5/2026', 'Cardboard Construction Kids', 'YS', '4:45 PM', '5:45 PM', 'Halle', { 'Setup Time': '0:45:00', 'Teardown Time': '1:00', 'Program Room': 'Imaginarium' }),
    P('5/6/2026', 'Storytime Sprouts', 'YS', '10:30 AM', '11:00 AM', 'Katie', { 'Program Room': 'Ferrentino' }),
    P('5/6/2026', 'Little Process Artists', 'YS', '11:30 AM', '12:00 PM', 'Arantza', { 'Program Room': 'Imaginarium' }),
    P('5/6/2026', 'Wednesday Hits Matinee', 'AS', '1:30 PM', '4:00 PM', 'John', { 'Setup Time': '0:15:00', 'Teardown Time': '0:15:00', 'Program Room': 'Ferrentino' }),
    P('5/6/2026', 'Gaming Lounge', 'YS', '3:30 PM', '8:30 PM', 'Jess', { 'Program Room': 'Gaming Lounge' }),
    P('5/7/2026', 'Sample: Teen Book Club', 'YS', '4:00 PM', '5:00 PM', 'Halle', { 'Program Room': 'Imaginarium' }),
    P('5/7/2026', 'Sample: Tech Help', 'AS', '10:00 AM', '12:00 PM', 'Thomas', { 'Program Room': 'Korbel' }),
    P('5/8/2026', 'Sample: Family Movie', 'YS', '2:00 PM', '4:00 PM', 'Katie, Alex', { 'Program Room': 'Ferrentino' }),
    P('5/9/2026', 'Sample: Crafternoon', 'AS', '11:00 AM', '1:00 PM', 'Marta', { 'Program Room': 'Ferrentino' })
  ];
  var programs = buildProgramBlocks_(rows, { nonBlocking: {}, lookup: lookup }).blocks;

  var seq = 0;
  function S(dept, date, name, s, e, notes) { return { id: 'm' + (++seq), dept: dept, row: seq + 1, date: date, name: name, start: parseTime_(s), end: parseTime_(e), notes: notes || '' }; }
  var shifts = [
    S('YS', '2026-05-04', 'Katie', '9:00 AM', '1:00 PM'), S('YS', '2026-05-04', 'Halle', '1:00 PM', '5:00 PM'), S('YS', '2026-05-04', 'Jess', '2:30 PM', '6:30 PM', 'Conflict demo: runs Gaming Lounge'),
    S('YS', '2026-05-05', 'Katie', '9:00 AM', '3:00 PM'), S('YS', '2026-05-05', 'Arantza', '3:00 PM', '9:00 PM'),
    S('YS', '2026-05-06', 'Katie', '9:00 AM', '1:00 PM'), S('YS', '2026-05-06', 'Halle', '12:00 PM', '5:00 PM'),
    S('YS', '2026-05-07', 'Arantza', '9:00 AM', '3:00 PM'),
    S('AS', '2026-05-04', 'Thomas', '9:00 AM', '3:00 PM'), S('AS', '2026-05-04', 'John', '3:00 PM', '9:00 PM'),
    S('AS', '2026-05-05', 'Thomas', '9:00 AM', '9:00 PM', 'Over the 8-hour cap'), S('AS', '2026-05-06', 'Mary-Carol', '9:00 AM', '3:00 PM'), S('AS', '2026-05-06', 'John', '1:30 PM', '5:00 PM')
  ];
  var timeOff = [{ name: 'Sid', start: '2026-05-05', end: '2026-05-06' }];
  var closures = {};

  function me() {
    var m = { email: who.toLowerCase() + '@elmwoodparklibrary.org', name: who, role: role, edit: { AS: false, YS: false } };
    m.edit.AS = role === 'Admin' || role === 'AS Scheduler'; m.edit.YS = role === 'Admin' || role === 'YS Scheduler';
    return m;
  }
  function need(dept) { if (!me().edit[dept]) throw new Error('You do not have permission to change the ' + dept + ' schedule.'); }
  function wait(v, ms) { return new Promise(function (res, rej) { setTimeout(function () { try { res(typeof v === 'function' ? v() : v); } catch (e) { rej(e); } }, ms == null ? 120 : ms); }); }
  function week(anyDay) {
    return buildWeekPayload_({ shifts: shifts, programs: programs, timeOff: timeOff, closures: closures, staff: staff, lookup: lookup, hours: hours, coverage: coverage }, parseDateKey_(anyDay) || '2026-05-04');
  }

  window.__mock = {
    api_boot: function () { return wait({ today: '2026-05-04', me: me(), staff: staffRows.map(function (r) { return { name: r[0], dept: r[1], cap: r[2] }; }), hours: hours, coverage: coverage, lastRefresh: 'mock', calendarSet: true }); },
    api_week: function (d) { return wait(function () { return week(d); }); },
    api_saveShift: function (input, vw) {
      return wait(function () {
        var v = validateShiftInput_(input, lookup); if (v.error) throw new Error(v.error); need(v.dept);
        var ex = shifts.filter(function (s) { return s.id === input.id; })[0];
        if (ex) Object.assign(ex, v); else shifts.push(Object.assign({ id: 'm' + (++seq), row: seq + 1 }, v));
        return week(vw || v.date);
      });
    },
    api_deleteShift: function (id, dept, vw) { return wait(function () { need(dept); shifts = shifts.filter(function (s) { return s.id !== id; }); return week(vw); }); },
    api_refreshPrograms: function () { return wait({ blocks: programs.length, closures: 0, skipped: {}, unmatched: {} }, 400); },
    api_publishWeek: function () { return wait({ created: 5, updated: 0, deleted: 0, calendar: 'EPPL Scheduler TEST (mock)' }, 400); }
  };
})();
