/**
 * WebApp.gs  --  the server side of the web interface.
 *
 * The browser page (Index.html) calls the api_* functions below.
 * Rules of the house:
 *  - EVERYONE in the library can look (view-only).
 *  - Only Admins and the matching Scheduler (AS Scheduler / YS Scheduler, set on the
 *    Staff tab's Role column) can change shifts for a desk.
 *  - Every change is checked here on the server, not just in the browser.
 *  - The programs sheet is still read-only.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('EPPL Desk Scheduler')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ---------- who is asking? ---------- */

function whoAmI_() {
  var email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { /* not available */ }
  var me = { email: email, name: '', role: 'Staff', edit: { AS: false, YS: false } };
  if (email) {
    readStaff_().list.forEach(function (p) {
      if (p.email && p.email === email) { me.name = p.name; me.role = p.role; }
    });
  }
  me.edit.AS = canEdit_(me.role, 'AS');
  me.edit.YS = canEdit_(me.role, 'YS');
  return me;
}

function requireEdit_(dept) {
  var me = whoAmI_();
  if (!canEdit_(me.role, dept)) {
    throw new Error('You do not have permission to change the ' + dept + ' schedule. Ask an Admin to set your Role on the Staff tab.');
  }
  return me;
}

function todayKey_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ---------- read ---------- */

function api_boot() {
  var staff = readStaff_();
  return {
    today: todayKey_(),
    me: whoAmI_(),
    staff: staff.list.map(function (p) { return { name: p.name, dept: p.dept, cap: p.cap }; }),
    hours: readHours_(),
    coverage: readCoverage_(),
    lastRefresh: getSetting_('Last Refresh'),
    calendarSet: !!getSetting_('Calendar ID')
  };
}

function api_week(anyDay) {
  ensureShiftIds_();
  var key = parseDateKey_(anyDay) || todayKey_();
  var ctx = buildCtx_();
  return buildWeekPayload_({
    shifts: ctx.shifts.filter(function (s) { return s.date && s.name; }),
    programs: ctx.programs, timeOff: ctx.timeOff, closures: ctx.closures,
    staff: ctx.staff, lookup: ctx.lookup, hours: ctx.hours, coverage: ctx.coverage
  }, key);
}

/** Gives every shift typed straight into the sheet an ID so the web app can find it again. */
function ensureShiftIds_() {
  [TAB.AS, TAB.YS].forEach(function (tab) {
    var sh = sheet_(tab), last = sh.getLastRow();
    if (last < 2) return;
    var vals = sh.getRange(2, 1, last - 1, 7).getValues();
    vals.forEach(function (r, i) {
      var hasData = r[0] !== '' || r[1] !== '' || r[2] !== '' || r[3] !== '';
      if (hasData && !String(r[6]).trim()) sh.getRange(i + 2, 7).setValue(newId_());
    });
  });
}

function newId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); }

/* ---------- write ---------- */

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function findShiftRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2 || !id) return 0;
  var ids = sh.getRange(2, 7, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return 0;
}

function api_saveShift(input, viewWeek) {
  var v = validateShiftInput_(input, readStaff_().lookup);
  if (v.error) throw new Error(v.error);
  requireEdit_(v.dept);
  withLock_(function () {
    var sh = sheet_(v.dept === 'AS' ? TAB.AS : TAB.YS);
    var row = findShiftRow_(sh, String(input.id || ''));
    var cells = [[v.date, v.name, fmtTime_(v.start), fmtTime_(v.end), v.notes]];
    if (row) {
      sh.getRange(row, 1, 1, 5).setValues(cells);
    } else {
      row = Math.max(sh.getLastRow(), 1) + 1;
      sh.getRange(row, 1, 1, 5).setValues(cells);
      sh.getRange(row, 7).setValue(newId_());
    }
  });
  return api_week(viewWeek || v.date);
}

function api_deleteShift(id, dept, viewWeek) {
  dept = dept === 'AS' ? 'AS' : 'YS';
  requireEdit_(dept);
  withLock_(function () {
    var sh = sheet_(dept === 'AS' ? TAB.AS : TAB.YS);
    var row = findShiftRow_(sh, String(id || ''));
    if (row) sh.deleteRow(row);
  });
  return api_week(viewWeek);
}

/* ---------- actions ---------- */

function api_refreshPrograms() {
  var me = whoAmI_();
  if (!me.edit.AS && !me.edit.YS) throw new Error('Only schedulers and admins can refresh programs.');
  return withLock_(refreshProgramsCore_);
}

function api_publishWeek(anyDay, dept) {
  dept = dept === 'AS' ? 'AS' : 'YS';
  requireEdit_(dept);
  var from = weekStart_(parseDateKey_(anyDay) || todayKey_());
  return withLock_(function () { return publishWeekCore_(from, [dept]); });
}
