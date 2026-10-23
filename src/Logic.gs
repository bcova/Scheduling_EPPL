/**
 * Logic.gs  --  the "brain" of the EPPL Desk Scheduler.
 *
 * Nothing in this file touches Google Sheets or Calendar. It only takes plain
 * data in and gives plain data back, so it can be tested on a laptop.
 * (Code.gs is the "hands" that read/write the sheets and calendar.)
 *
 * Conventions:
 *  - Dates are text keys like "2026-05-01" (sorts correctly as text).
 *  - Times are whole minutes after midnight (9:00 AM = 540).
 */

var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Words in the "Staff Member(s)" column that are not real desk staff.
var IGNORED_STAFF = { '': 1, outside: 1, allstaff: 1, na: 1, none: 1, tbd: 1 };

/* ---------- small helpers ---------- */

/** "Mary-Carol" and "mary carol" both become "marycarol". */
function normName_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pad2_(n) { return n < 10 ? '0' + n : '' + n; }

function dateKey_(y, m, d) { return y + '-' + pad2_(m) + '-' + pad2_(d); }

/** Accepts "5/1/2026", "2026-05-01", or a Date object. Returns "2026-05-01" or null. */
function parseDateKey_(v) {
  if (v == null || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return null;
    return dateKey_(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate_(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    var y = +m[3];
    if (y < 100) y += 2000;
    return validDate_(y, +m[1], +m[2]);
  }
  return null;
}

function validDate_(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return dateKey_(y, m, d);
}

function utcDate_(key) {
  var p = key.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
}

function addDays_(key, n) {
  var p = key.split('-');
  var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return dateKey_(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function weekday_(key) { return DAY_NAMES[utcDate_(key).getUTCDay()]; }

/** The Sunday that starts the week containing this date. */
function weekStart_(key) { return addDays_(key, -utcDate_(key).getUTCDay()); }

/** Local Date object for a date key plus minutes after midnight. */
function dateFromKey_(key, minutes) {
  var p = key.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2], 0, minutes || 0);
}

/** "9:00 AM", "9am", "13:30", "12:30 AM"  ->  minutes after midnight, or null. */
function parseTime_(v) {
  if (v == null || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return null;
    return v.getHours() * 60 + v.getMinutes();
  }
  var s = String(v).trim().toLowerCase();
  var m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([ap])?\.?m?\.?$/);
  if (!m) return null;
  var h = +m[1];
  var min = m[2] ? +m[2] : 0;
  if (min > 59) return null;
  if (m[4]) {
    if (h < 1 || h > 12) return null;
    if (h === 12) h = 0;
    if (m[4] === 'p') h += 12;
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

/** "0:15:00" -> 15, "1:00" -> 60, "0:45:00" -> 45, blank -> 0. */
function parseDuration_(v) {
  if (v == null || v === '') return 0;
  var s = String(v).replace(/<[^>]*>/g, '').trim();
  if (!s) return 0;
  // Some cells hold a clock time like "12:30 AM" meaning 30 minutes.
  if (/[ap]\.?m?\.?$/i.test(s)) {
    var t = parseTime_(s);
    return t == null ? 0 : t;
  }
  var parts = s.split(':');
  var nums = parts.map(function (x) { return parseInt(x, 10); });
  if (nums.some(isNaN)) return 0;
  if (nums.length === 1) return nums[0];
  return nums[0] * 60 + nums[1];
}

/** 540 -> "9:00 AM". */
function fmtTime_(min) {
  var h = Math.floor(min / 60) % 24;
  var m = min % 60;
  var ap = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + pad2_(m) + ' ' + ap;
}

/** TRUE / Yes / y / 1  ->  true. Everything else false. */
function truthy_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}

/** Explicit FALSE / No (blank does NOT count). */
function explicitFalse_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'false' || s === 'no' || s === 'n' || s === '0';
}

/** "Maddie , Teegan" -> ["Maddie","Teegan"]. */
function splitStaff_(s) {
  return String(s == null ? '' : s)
    .split(/\s*(?:,|&|\/|;|\+|\band\b)\s*/i)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x; });
}

function overlap_(a1, a2, b1, b2) { return a1 < b2 && a2 > b1; }

/* ---------- programs -> busy blocks ---------- */

/**
 * Turns program rows into "busy blocks": one per program per day, showing who is
 * tied up and when (setup + program + teardown; prep time is ignored).
 *
 * rows: array of objects keyed by the programs-sheet column headers.
 * opts.nonBlocking: { normalizedName: 1 }  programs that never keep staff busy
 * opts.lookup: function(normalizedName) -> real staff name or null
 */
function buildProgramBlocks_(rows, opts) {
  var blocks = [];
  var skipped = { notApproved: 0, denied: 0, cancelled: 0, nonBlocking: 0, allDay: 0, passive: 0, badDate: 0, noTimes: 0 };
  var unmatched = {};
  var nbList = Object.keys(opts.nonBlocking || {}).filter(function (k) { return k.length >= 4; });

  rows.forEach(function (r) {
    var name = String(r['Program Name'] || '').trim();
    if (!name && !r['Start Date']) return; // empty row

    if (explicitFalse_(r['Approved'])) { skipped.notApproved++; return; }
    if (truthy_(r['Denied'])) { skipped.denied++; return; }
    if (truthy_(r['cancelled'])) { skipped.cancelled++; return; }

    var n = normName_(name);
    var isNonBlocking = nbList.some(function (k) { return n.indexOf(k) === 0; });
    if (isNonBlocking) { skipped.nonBlocking++; return; }
    if (truthy_(r['All Day Event?'])) { skipped.allDay++; return; }
    if (String(r['Active/Passive'] || '').trim().toLowerCase() === 'passive') { skipped.passive++; return; }

    var startKey = parseDateKey_(r['Start Date']);
    if (!startKey) { skipped.badDate++; return; }
    var endKey = parseDateKey_(r['End Date']) || startKey; // blank end = one day
    if (endKey < startKey) endKey = startKey;

    var s = parseTime_(r['Start Time']);
    var e = parseTime_(r['End Time']);
    if (s == null || e == null || e <= s) { skipped.noTimes++; return; }

    var busyStart = Math.max(0, s - parseDuration_(r['Setup Time']));
    var busyEnd = Math.min(1439, e + parseDuration_(r['Teardown Time']));

    var staff = [];
    splitStaff_(r['Staff Member(s)']).forEach(function (tok) {
      var nk = normName_(tok);
      if (IGNORED_STAFF[nk]) return;
      var canon = opts.lookup(nk);
      if (canon) {
        if (staff.indexOf(canon) < 0) staff.push(canon);
      } else {
        unmatched[tok] = (unmatched[tok] || 0) + 1;
      }
    });

    var dept = String(r['AS/YS'] || '').trim().toUpperCase();
    var d = startKey;
    for (var i = 0; i < 62 && d <= endKey; i++) {
      blocks.push({
        date: d, dept: dept, name: name, id: r['ID'] || '', room: r['Program Room'] || '',
        start: s, end: e, busyStart: busyStart, busyEnd: busyEnd,
        staff: staff, rawStaff: r['Staff Member(s)'] || ''
      });
      d = addDays_(d, 1);
    }
  });

  return { blocks: blocks, skipped: skipped, unmatched: unmatched };
}

/* ---------- the schedule checker ---------- */

/**
 * ctx.shifts   [{dept,row,date,name,start,end}]   (date key, minutes; null if blank/bad)
 * ctx.programs [{date,name,busyStart,busyEnd,staff:[...]}]
 * ctx.staff    { realName: {dept:'AS'|'YS'|'Both'|'', cap:number} }
 * ctx.lookup   function(normalizedName) -> real name or null
 * ctx.timeOff  [{name,start,end}]  (real names, date keys)
 * ctx.hours    { Monday: {open,close}, ... }   (missing day = closed)
 * ctx.coverage { AS: {Monday: 1, ...}, YS: {...} }
 * ctx.closures { dateKey: 1 }
 *
 * Returns [{severity, dept, date, person, message, sheet, row}] where severity is
 * "Problem" (fix it), "Warning" (look at it) or "Note" (FYI).
 */
function runChecks_(ctx) {
  var W = [];
  function add(severity, s, message, extra) {
    var w = {
      severity: severity, dept: s.dept || '', date: s.date || '', person: s.person || s.name || '',
      message: message, sheet: s.dept ? s.dept + ' Shifts' : '', row: s.row || 0
    };
    if (extra) for (var k in extra) w[k] = extra[k];
    W.push(w);
  }

  var valid = [];
  ctx.shifts.forEach(function (s) {
    s.person = s.name;
    if (!s.name && s.date == null && s.start == null && s.end == null) return; // blank row
    if (!s.name) { add('Problem', s, 'No name on this shift'); return; }
    if (!s.date) { add('Problem', s, 'Missing or unreadable date'); return; }
    if (s.start == null || s.end == null) { add('Problem', s, 'Missing or unreadable start/end time'); return; }
    if (s.end <= s.start) { add('Problem', s, 'End time is not after start time'); return; }
    s.canon = ctx.lookup(normName_(s.name));
    if (!s.canon) { add('Warning', s, 'Name "' + s.name + '" is not on the Staff tab (typo?)'); }
    else s.person = s.canon;
    valid.push(s);
  });

  valid.forEach(function (s) {
    var wd = weekday_(s.date);
    var when = fmtTime_(s.start) + '-' + fmtTime_(s.end);

    if (ctx.closures[s.date]) add('Problem', s, 'Library is closed on this date');
    else {
      var h = ctx.hours[wd];
      if (!h) add('Problem', s, 'Library is closed on ' + wd + 's');
      else if (s.start < h.open || s.end > h.close) {
        add('Warning', s, 'Outside open hours (' + fmtTime_(h.open) + '-' + fmtTime_(h.close) + ')');
      }
    }
    if (!s.canon) return;

    var info = ctx.staff[s.canon] || {};
    if (info.dept && info.dept !== 'Both' && info.dept !== s.dept) {
      add('Note', s, s.canon + ' is listed as ' + info.dept + ' but is on the ' + s.dept + ' schedule');
    }
    ctx.timeOff.forEach(function (t) {
      if (t.name === s.canon && s.date >= t.start && s.date <= t.end) {
        add('Problem', s, s.canon + ' has time off (' + t.start + ' to ' + t.end + ')');
      }
    });
    ctx.programs.forEach(function (p) {
      if (p.date === s.date && p.staff.indexOf(s.canon) >= 0 && overlap_(s.start, s.end, p.busyStart, p.busyEnd)) {
        add('Problem', s, s.canon + ' is running "' + p.name + '" (' + fmtTime_(p.busyStart) + '-' + fmtTime_(p.busyEnd) +
          ' incl. setup/teardown) while on desk ' + when);
      }
    });
  });

  // Double-booked: same person, overlapping shifts.
  var byPerson = {};
  valid.forEach(function (s) {
    if (!s.canon) return;
    (byPerson[s.canon + '|' + s.date] = byPerson[s.canon + '|' + s.date] || []).push(s);
  });
  Object.keys(byPerson).forEach(function (k) {
    var list = byPerson[k].sort(function (a, b) { return a.start - b.start; });
    for (var i = 1; i < list.length; i++) {
      if (list[i].start < list[i - 1].end) add('Problem', list[i], list[i].canon + ' is double-booked (' + list[i - 1].dept + ' row ' + list[i - 1].row + ' overlaps)');
    }
  });

  // Weekly hour caps (weeks run Sunday-Saturday).
  var weekly = {};
  valid.forEach(function (s) {
    if (!s.canon) return;
    var k = s.canon + '|' + weekStart_(s.date);
    var w = weekly[k] = weekly[k] || { hours: 0, first: s };
    w.hours += (s.end - s.start) / 60;
  });
  Object.keys(weekly).forEach(function (k) {
    var who = k.split('|')[0];
    var cap = (ctx.staff[who] || {}).cap;
    var w = weekly[k];
    if (cap > 0 && w.hours > cap) {
      add('Warning', w.first, who + ' has ' + w.hours + ' desk hours the week of ' + k.split('|')[1] + ' (cap is ' + cap + ')');
    }
  });

  // Coverage: every 30-minute slot of every open day, per desk.
  ['AS', 'YS'].forEach(function (dept) {
    var ds = valid.filter(function (s) { return s.dept === dept; });
    if (!ds.length) {
      W.push({ severity: 'Note', dept: dept, date: '', person: '', message: 'No ' + dept + ' shifts entered yet, so coverage was not checked', sheet: '', row: 0 });
      return;
    }
    var dates = ds.map(function (s) { return s.date; }).sort();
    var minD = dates[0], maxD = dates[dates.length - 1];
    var d = minD;
    for (var guard = 0; guard < 400 && d <= maxD; guard++, d = addDays_(d, 1)) {
      if (ctx.closures[d]) continue;
      var wd = weekday_(d);
      var h = ctx.hours[wd];
      var need = ((ctx.coverage[dept] || {})[wd]) || 0;
      if (!h || !need) continue;
      var dayShifts = ds.filter(function (s) { return s.date === d; });
      var run = null;
      var flush = function () {
        if (run) {
          W.push({
            severity: 'Problem', dept: dept, date: d, person: '', sheet: '', row: 0,
            message: 'Only ' + run.n + ' on ' + dept + ' desk (need ' + need + ') ' + fmtTime_(run.start) + '-' + fmtTime_(run.end)
          });
        }
        run = null;
      };
      for (var t = h.open; t < h.close; t += 30) {
        var n = 0;
        for (var i = 0; i < dayShifts.length; i++) if (overlap_(dayShifts[i].start, dayShifts[i].end, t, t + 30)) n++;
        if (n < need) {
          if (run && run.n === n) run.end = t + 30;
          else { flush(); run = { start: t, end: t + 30, n: n }; }
        } else flush();
      }
      flush();
    }
  });

  var order = { Problem: 0, Warning: 1, Note: 2 };
  W.sort(function (a, b) {
    return (order[a.severity] - order[b.severity]) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  });
  return W;
}
