/**
 * Code.gs  --  the "hands" of the EPPL Desk Scheduler.
 * Reads/writes Google Sheets and Google Calendar. All the thinking is in Logic.gs.
 *
 * SAFETY: the programs sheet is only ever READ (openById + getDisplayValues).
 * This script never writes to it.
 */

var TAB = {
  SETTINGS: 'Settings', STAFF: 'Staff', HOURS: 'Hours', COVERAGE: 'Coverage',
  TIMEOFF: 'Time Off', AS: 'AS Shifts', YS: 'YS Shifts',
  PROGRAMS: 'Programs (auto)', WARNINGS: 'Warnings'
};
// The COPY of the programs sheet. Swap for the real one on the Settings tab later.
var DEFAULT_PROGRAMS_SHEET_ID = '1PE4KjFfihsKoLKs8BckYSh302_1ml40ShsMXZMBd7Wo';
var SHIFT_HEADERS = ['Date', 'Name', 'Start', 'End', 'Notes', 'Event ID (auto - leave alone)'];
var EVENT_TAG = 'eppl-desk-shift';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('📅 Scheduler')
    .addItem('1. Set up / repair tabs', 'setupAll')
    .addItem('2. Refresh programs', 'refreshPrograms')
    .addItem('3. Check schedule', 'checkSchedule')
    .addItem('4. Publish week to calendar', 'publishWeek')
    .addSeparator()
    .addItem('Import staff names from programs sheet', 'importStaffNames')
    .addToUi();
}

/* ====================== small sheet helpers ====================== */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function ui_() { return SpreadsheetApp.getUi(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" is missing. Use 📅 Scheduler > 1. Set up / repair tabs.');
  return sh;
}

function getOrCreate_(name) {
  return ss_().getSheetByName(name) || ss_().insertSheet(name);
}

function writeHeader_(sh, headers) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#d9e2f3');
  sh.setFrozenRows(1);
}

function dataRows_(sh, numCols) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, numCols).getDisplayValues();
}

function getSetting_(key) {
  var rows = dataRows_(sheet_(TAB.SETTINGS), 2);
  for (var i = 0; i < rows.length; i++) if (rows[i][0] === key) return String(rows[i][1]).trim();
  return '';
}

function setSetting_(key, value) {
  var sh = sheet_(TAB.SETTINGS);
  var rows = dataRows_(sh, 2);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === key) { sh.getRange(i + 2, 2).setValue(value); return; }
  }
}

/* ====================== setup ====================== */

function setupAll() {
  var ss = ss_();

  // Settings
  var st = getOrCreate_(TAB.SETTINGS);
  if (st.getLastRow() < 2) {
    writeHeader_(st, ['Setting', 'Value', 'What it means']);
    st.getRange(2, 1, 6, 3).setValues([
      ['Programs Sheet ID', DEFAULT_PROGRAMS_SHEET_ID, 'The programs Google Sheet. This is the COPY. To switch to the real one, paste its ID here (the long code in its web address between /d/ and /edit).'],
      ['Programs Tab', 'Programs_26', 'Name of the tab in that sheet with the programs.'],
      ['Lists Tab', 'Lists', 'Tab with Holidays/Closures.'],
      ['Core Programs Tab', 'Core Programs', 'Tab with the "Non Date Blocking Programs" list.'],
      ['Calendar ID', '', 'Which Google Calendar to publish desk shifts to. START WITH A TEST CALENDAR. Find the ID in Google Calendar > calendar settings > Integrate calendar.'],
      ['Last Refresh', '', '(filled in automatically)']
    ]);
    st.getRange('E1:F1').setValues([['Extra Closures (type dates here)', 'Closures (auto from programs sheet)']]).setFontWeight('bold').setBackground('#d9e2f3');
    st.setColumnWidth(1, 160); st.setColumnWidth(2, 300); st.setColumnWidth(3, 520);
    st.getRange('C2:C7').setWrapText(true);
  }

  // Staff
  var staff = getOrCreate_(TAB.STAFF);
  if (staff.getLastRow() < 1) writeHeader_(staff, ['Name', 'Dept (AS / YS / Both)', 'Email', 'Weekly Desk Hour Cap (blank = none)', 'Also Known As (comma separated)']);
  staff.getRange('B2:B200').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['AS', 'YS', 'Both'], true).setAllowInvalid(true).build());
  staff.setColumnWidth(1, 140); staff.setColumnWidth(2, 150); staff.setColumnWidth(3, 240); staff.setColumnWidth(4, 200); staff.setColumnWidth(5, 240);

  // Hours
  var hrs = getOrCreate_(TAB.HOURS);
  if (hrs.getLastRow() < 2) {
    writeHeader_(hrs, ['Day', 'Opens', 'Closes']);
    hrs.getRange(2, 1, 7, 3).setValues([
      ['Sunday', '1:00 PM', '5:00 PM'], ['Monday', '9:00 AM', '9:00 PM'], ['Tuesday', '9:00 AM', '9:00 PM'],
      ['Wednesday', '9:00 AM', '9:00 PM'], ['Thursday', '9:00 AM', '9:00 PM'],
      ['Friday', '9:00 AM', '5:00 PM'], ['Saturday', '9:00 AM', '5:00 PM']
    ]);
    hrs.getRange('A10').setValue('These are GUESSES - please correct them. Leave Opens/Closes blank for a day the library is closed.');
  }
  hrs.getRange('B2:C8').setNumberFormat('h:mm AM/PM');

  // Coverage
  var cov = getOrCreate_(TAB.COVERAGE);
  if (cov.getLastRow() < 2) {
    writeHeader_(cov, ['Desk', 'Day', 'Minimum people on desk']);
    var cr = [];
    ['AS', 'YS'].forEach(function (d) { DAY_NAMES.forEach(function (day) { cr.push([d, day, 1]); }); });
    cov.getRange(2, 1, cr.length, 3).setValues(cr);
    cov.getRange('A17').setValue('Applies during open hours (see Hours tab). Set 0 to skip checking a day.');
  }

  // Time off
  var to = getOrCreate_(TAB.TIMEOFF);
  if (to.getLastRow() < 1) writeHeader_(to, ['Name', 'First Day Off', 'Last Day Off', 'Reason (optional)']);
  to.getRange('B2:C500').setNumberFormat('m/d/yyyy');

  // Shift tabs
  [TAB.AS, TAB.YS].forEach(function (name) {
    var sh = getOrCreate_(name);
    if (sh.getLastRow() < 1) writeHeader_(sh, SHIFT_HEADERS);
    sh.getRange('A2:A1000').setNumberFormat('m/d/yyyy');
    sh.getRange('C2:D1000').setNumberFormat('h:mm AM/PM');
    sh.getRange('B2:B1000').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInRange(staff.getRange('A2:A200'), true).setAllowInvalid(true).build());
    sh.setColumnWidth(2, 140); sh.setColumnWidth(5, 220); sh.setColumnWidth(6, 200);
    sh.getRange('F:F').setFontColor('#999999');
  });

  // Auto tabs
  var pr = getOrCreate_(TAB.PROGRAMS);
  writeHeader_(pr, ['Date', 'Day', 'Dept', 'Program', 'Staff (matched)', 'Busy From', 'Busy Until', 'Room', 'Program ID']);
  pr.getRange('A:A').setNumberFormat('@');
  var wr = getOrCreate_(TAB.WARNINGS);
  writeHeader_(wr, ['Severity', 'Desk', 'Date', 'Person', 'What is wrong', 'Where']);

  // Remove the blank default tab if it is still empty.
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  // Pre-fill staff names (only if the Staff tab is still empty).
  var imported = 0;
  if (staff.getLastRow() < 2) {
    try { imported = importStaffNames_(true); } catch (e) { /* not fatal */ }
  }
  ui_().alert('Setup done ✅',
    'All tabs are ready.' + (imported ? '\n\nI copied ' + imported + ' staff names onto the Staff tab. Next: mark each person AS, YS or Both.' : '') +
    '\n\nNext steps:\n1. Staff tab: set each person\'s Dept\n2. Hours tab: fix the open hours\n3. Settings tab: add a TEST Calendar ID\n4. 📅 Scheduler > 2. Refresh programs',
    ui_().ButtonSet.OK);
}

/* ====================== reading the programs sheet (read-only) ====================== */

function progSS_() {
  var id = getSetting_('Programs Sheet ID');
  if (!id) throw new Error('No Programs Sheet ID on the Settings tab.');
  try { return SpreadsheetApp.openById(id); }
  catch (e) { throw new Error('Could not open the programs sheet. Check the ID on the Settings tab and that you have access.'); }
}

function tableObjects_(sh) {
  var vals = sh.getDataRange().getDisplayValues();
  var head = vals[0].map(function (h) { return String(h).trim(); });
  return vals.slice(1).map(function (row) {
    var o = {};
    head.forEach(function (h, i) { if (h) o[h] = row[i]; });
    return o;
  });
}

function columnByHeader_(sh, header) {
  var vals = sh.getDataRange().getDisplayValues();
  var idx = vals[0].map(function (h) { return String(h).trim(); }).indexOf(header);
  if (idx < 0) return [];
  return vals.slice(1).map(function (r) { return r[idx]; }).filter(function (x) { return String(x).trim() !== ''; });
}

function importStaffNames() { importStaffNames_(false); }

function importStaffNames_(quiet) {
  var staff = sheet_(TAB.STAFF);
  var lists = progSS_().getSheetByName(getSetting_('Lists Tab'));
  if (!lists) throw new Error('Could not find the Lists tab in the programs sheet.');
  var names = columnByHeader_(lists, 'All Staff').filter(function (n) { return !IGNORED_STAFF[normName_(n)]; });
  var existing = {};
  dataRows_(staff, 1).forEach(function (r) { existing[normName_(r[0])] = 1; });
  var add = names.filter(function (n) { return !existing[normName_(n)]; }).map(function (n) { return [n]; });
  if (add.length) staff.getRange(staff.getLastRow() + 1, 1, add.length, 1).setValues(add);
  if (!quiet) ui_().alert('Added ' + add.length + ' staff names to the Staff tab. Now set each person\'s Dept.');
  return add.length;
}

/* ====================== staff / settings readers ====================== */

function readStaff_() {
  var info = {}, map = {};
  dataRows_(sheet_(TAB.STAFF), 5).forEach(function (r) {
    var name = String(r[0]).trim();
    if (!name) return;
    var d = String(r[1]).trim().toUpperCase();
    info[name] = { dept: d === 'BOTH' ? 'Both' : (d === 'AS' || d === 'YS' ? d : ''), cap: parseFloat(r[3]) || 0 };
    map[normName_(name)] = name;
    String(r[4]).split(',').forEach(function (a) { if (a.trim()) map[normName_(a)] = name; });
  });
  return { info: info, lookup: function (k) { return map[k] || null; } };
}

function readHours_() {
  var h = {};
  dataRows_(sheet_(TAB.HOURS), 3).forEach(function (r) {
    var o = parseTime_(r[1]), c = parseTime_(r[2]);
    if (DAY_NAMES.indexOf(r[0]) >= 0 && o != null && c != null && c > o) h[r[0]] = { open: o, close: c };
  });
  return h;
}

function readCoverage_() {
  var c = { AS: {}, YS: {} };
  dataRows_(sheet_(TAB.COVERAGE), 3).forEach(function (r) {
    if (c[r[0]] && DAY_NAMES.indexOf(r[1]) >= 0) c[r[0]][r[1]] = parseInt(r[2], 10) || 0;
  });
  return c;
}

function readClosures_() {
  var c = {};
  var st = sheet_(TAB.SETTINGS);
  var last = st.getLastRow();
  if (last >= 2) {
    st.getRange(2, 5, last - 1, 2).getDisplayValues().forEach(function (r) {
      [r[0], r[1]].forEach(function (v) { var k = parseDateKey_(v); if (k) c[k] = 1; });
    });
  }
  return c;
}

function readTimeOff_(lookup) {
  var out = [];
  dataRows_(sheet_(TAB.TIMEOFF), 3).forEach(function (r) {
    var who = lookup(normName_(r[0])), a = parseDateKey_(r[1]), b = parseDateKey_(r[2]) || a;
    if (who && a) out.push({ name: who, start: a, end: b < a ? a : b });
  });
  return out;
}

function readShifts_() {
  var out = [];
  [TAB.AS, TAB.YS].forEach(function (tab) {
    var dept = tab === TAB.AS ? 'AS' : 'YS';
    dataRows_(sheet_(tab), 6).forEach(function (r, i) {
      out.push({
        dept: dept, row: i + 2, name: String(r[1]).trim(), date: parseDateKey_(r[0]),
        start: parseTime_(r[2]), end: parseTime_(r[3]), eventId: String(r[5]).trim()
      });
    });
  });
  return out;
}

/* ====================== 2. refresh programs ====================== */

function refreshPrograms() {
  var src = progSS_();
  var tab = src.getSheetByName(getSetting_('Programs Tab'));
  if (!tab) { ui_().alert('Could not find the tab "' + getSetting_('Programs Tab') + '" in the programs sheet.'); return; }

  var staff = readStaff_();
  if (!Object.keys(staff.info).length) { ui_().alert('The Staff tab is empty. Run "Import staff names" first.'); return; }

  var nonBlocking = {};
  var core = src.getSheetByName(getSetting_('Core Programs Tab'));
  if (core) columnByHeader_(core, 'Non Date Blocking Programs').forEach(function (n) { nonBlocking[normName_(n)] = 1; });

  var res = buildProgramBlocks_(tableObjects_(tab), { nonBlocking: nonBlocking, lookup: staff.lookup });

  // Write the cleaned-up programs.
  var out = sheet_(TAB.PROGRAMS);
  var last = out.getLastRow();
  if (last > 1) out.getRange(2, 1, last - 1, 9).clearContent();
  if (res.blocks.length) {
    var rows = res.blocks.map(function (b) {
      return [b.date, weekday_(b.date), b.dept, b.name, b.staff.join('; '), fmtTime_(b.busyStart), fmtTime_(b.busyEnd), b.room, b.id];
    });
    out.getRange(2, 1, rows.length, 9).setValues(rows);
  }

  // Closures from the programs sheet's Lists tab.
  var lists = src.getSheetByName(getSetting_('Lists Tab'));
  var st = sheet_(TAB.SETTINGS);
  if (st.getLastRow() >= 2) st.getRange(2, 6, st.getLastRow() - 1, 1).clearContent();
  var closureCount = 0;
  if (lists) {
    var cl = columnByHeader_(lists, 'Holidays/Closures').map(parseDateKey_).filter(function (k) { return k; });
    closureCount = cl.length;
    if (cl.length) st.getRange(2, 6, cl.length, 1).setNumberFormat('@').setValues(cl.map(function (k) { return [k]; }));
  }
  setSetting_('Last Refresh', new Date().toLocaleString());

  var sk = res.skipped;
  var un = Object.keys(res.unmatched).slice(0, 12).map(function (n) { return n + ' (' + res.unmatched[n] + ')'; }).join(', ');
  ui_().alert('Programs refreshed ✅',
    res.blocks.length + ' program-days that keep staff busy were loaded.\n' + closureCount + ' closure dates loaded.\n\n' +
    'Skipped (on purpose):\n' +
    ' • ' + sk.passive + ' passive (self-serve)\n' +
    ' • ' + sk.nonBlocking + ' on the "Non Date Blocking" list\n' +
    ' • ' + sk.allDay + ' all-day events\n' +
    ' • ' + (sk.cancelled + sk.denied + sk.notApproved) + ' cancelled / denied / not approved\n' +
    ' • ' + (sk.badDate + sk.noTimes) + ' with unreadable dates or times\n\n' +
    (un ? 'Names in the programs sheet that are NOT on your Staff tab (they will not block anyone):\n' + un + '\n\nIf any are real staff, add them to the Staff tab (or as an "Also Known As").' : 'Every staff name matched. 👍'),
    ui_().ButtonSet.OK);
}

/* ====================== 3. check schedule ====================== */

function buildCtx_() {
  var staff = readStaff_();
  var programs = dataRows_(sheet_(TAB.PROGRAMS), 7).filter(function (r) { return r[0]; }).map(function (r) {
    return {
      date: parseDateKey_(r[0]), name: r[3], busyStart: parseTime_(r[5]), busyEnd: parseTime_(r[6]),
      staff: String(r[4]).split(';').map(function (x) { return x.trim(); }).filter(function (x) { return x; })
    };
  }).filter(function (p) { return p.date && p.busyStart != null && p.busyEnd != null; });

  return {
    shifts: readShifts_(), programs: programs, staff: staff.info, lookup: staff.lookup,
    timeOff: readTimeOff_(staff.lookup), hours: readHours_(), coverage: readCoverage_(), closures: readClosures_()
  };
}

function checkSchedule() {
  if (!getSetting_('Last Refresh')) {
    ui_().alert('Run "2. Refresh programs" first so I know who is busy running programs.');
    return;
  }
  var warnings = runChecks_(buildCtx_());

  // Colour the shift rows that have problems.
  [TAB.AS, TAB.YS].forEach(function (tab) {
    var sh = sheet_(tab);
    sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 6).setBackground(null);
  });
  var color = { Problem: '#f4c7c3', Warning: '#fce8b2' };
  var painted = {};
  warnings.forEach(function (w) {
    if (!w.row || !color[w.severity]) return;
    var key = w.sheet + '|' + w.row;
    if (painted[key] === 'Problem') return;
    painted[key] = w.severity;
    sheet_(w.sheet).getRange(w.row, 1, 1, 6).setBackground(color[w.severity]);
  });

  var wr = sheet_(TAB.WARNINGS);
  var last = wr.getLastRow();
  if (last > 1) wr.getRange(2, 1, last - 1, 6).clearContent();
  if (warnings.length) {
    wr.getRange(2, 1, warnings.length, 6).setValues(warnings.map(function (w) {
      return [w.severity, w.dept, w.date, w.person, w.message, w.row ? w.sheet + ' row ' + w.row : ''];
    }));
  }
  wr.getRange('A:A').setFontWeight('bold');
  wr.setColumnWidth(5, 600);

  var n = { Problem: 0, Warning: 0, Note: 0 };
  warnings.forEach(function (w) { n[w.severity]++; });
  ss_().setActiveSheet(wr);
  ui_().alert(n.Problem + n.Warning === 0 ? 'All clear ✅' : 'Check finished',
    n.Problem + ' problems, ' + n.Warning + ' warnings, ' + n.Note + ' notes.\nSee the Warnings tab. Problem rows are red and warnings yellow on the shift tabs.',
    ui_().ButtonSet.OK);
}

/* ====================== 4. publish to calendar ====================== */

function publishWeek() {
  var calId = getSetting_('Calendar ID');
  if (!calId) { ui_().alert('Put a Calendar ID on the Settings tab first. Use a TEST calendar to start.'); return; }
  var cal = CalendarApp.getCalendarById(calId);
  if (!cal) { ui_().alert('I could not open that calendar. Check the Calendar ID and that you can edit it.'); return; }

  var resp = ui_().prompt('Which week?', 'Type any date in the week (like 5/4/2026). I will publish Sunday to Saturday of that week.', ui_().ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui_().Button.OK) return;
  var anyDay = parseDateKey_(resp.getResponseText());
  if (!anyDay) { ui_().alert('I could not read that date.'); return; }
  var from = weekStart_(anyDay), to = addDays_(from, 6);

  var shifts = readShifts_().filter(function (s) {
    return s.name && s.date && s.start != null && s.end != null && s.end > s.start && s.date >= from && s.date <= to;
  });

  var ok = ui_().alert('Publish?',
    'Calendar: "' + cal.getName() + '"\nWeek: ' + from + ' to ' + to + '\nShifts to publish: ' + shifts.length +
    '\n\nThis will create/update desk-shift events and delete earlier desk-shift events from this week that are no longer on the sheet. ' +
    'Events you added by hand are never touched.\n\nContinue?', ui_().ButtonSet.YES_NO);
  if (ok !== ui_().Button.YES) return;

  var created = 0, updated = 0, deleted = 0;
  var seen = {};
  var idUpdates = []; // {tab,row,id}

  shifts.forEach(function (s) {
    var title = s.name + ' - ' + s.dept + ' Desk';
    var start = dateFromKey_(s.date, s.start), end = dateFromKey_(s.date, s.end);
    var ev = null;
    if (s.eventId && !seen[s.eventId]) {
      try { ev = cal.getEventById(s.eventId); } catch (e) { ev = null; }
      if (ev && ev.getTag(EVENT_TAG) !== '1') ev = null; // never adopt someone else's event
    }
    if (ev) {
      ev.setTitle(title); ev.setTime(start, end); updated++;
    } else {
      ev = cal.createEvent(title, start, end, { description: 'Desk shift from the EPPL Desk Scheduler. Edit it on the scheduling sheet, not here.' });
      ev.setTag(EVENT_TAG, '1');
      created++;
      idUpdates.push({ tab: s.dept === 'AS' ? TAB.AS : TAB.YS, row: s.row, id: ev.getId() });
    }
    seen[ev.getId()] = 1;
  });

  // Remove desk-shift events (made by this tool) in this week that no longer have a row.
  cal.getEvents(dateFromKey_(from, 0), dateFromKey_(addDays_(to, 1), 0)).forEach(function (ev) {
    if (ev.getTag(EVENT_TAG) === '1' && !seen[ev.getId()]) { ev.deleteEvent(); deleted++; }
  });

  idUpdates.forEach(function (u) { sheet_(u.tab).getRange(u.row, 6).setValue(u.id); });
  ui_().alert('Published ✅', created + ' created, ' + updated + ' updated, ' + deleted + ' removed.', ui_().ButtonSet.OK);
}
