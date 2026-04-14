/**
 * IT Helpdesk Shift Scheduler Algorithm v3
 * Ported from Python — improved balanced scheduling with long-term fairness tracking.
 *
 * Key features:
 * 1. Week starts on Friday (Egyptian work week: Fri→Thu)
 * 2. One employee OFF per week (all 7 days, Fri-Thu)
 * 3. Consecutive OFF week prevention — same person never gets 2 weeks OFF in a row
 * 4. Holiday shift support — specific dates use "Holiday" shift config
 * 5. Summer time support — toggle between normal and summer shift times
 * 6. Per-day custom hours — override hours for specific dates
 * 7. Multi-factor scoring for OFF selection and daily assignments
 * 8. Post-generation swap optimization to reduce hour variance
 * 9. Cumulative stats carry forward across months for long-term balance
 */

export interface Employee {
  id: number;
  name: string;
  hrid: string;
  active: boolean;
}

export interface ShiftConfig {
  start: string;
  end: string;
  hours: number;
}

export interface Settings {
  shifts: Record<string, ShiftConfig>;
  weekStart: string;
  holidays: string[];
  summerTime?: boolean;
  summerShifts?: Record<string, ShiftConfig>;
  dayHours?: Record<string, number>;
}

export interface ScheduleEntry {
  date: string;       // YYYY-MM-DD
  dayName: string;    // Friday, Saturday, Sunday, etc.
  dayType: string;    // Weekday, Thursday, Friday, Saturday
  empIdx: number;
  empName: string;
  empHrid: string;
  start: string;
  end: string;
  hours: number;
  offPerson: string;
  offPersonIdx: number;
  offPersonHrid: string;
  weekNum: number;
  isHoliday: boolean;
  isManual: boolean;
}

export interface LocalStats {
  days: number;
  hours: number;
  weekend: number;
  sat: number;
  fri: number;
  offWeeks: number;
  lastDayIdx: number;
}

export interface CumulativeStats {
  totalHours: number;
  totalDays: number;
  weekendDays: number;
  saturdays: number;
  fridays: number;
  offWeeks: number;
}

// JS getDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
const DAYS_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getDayType(d: Date): string {
  const jsDay = d.getDay();
  if (jsDay === 6) return "Saturday"; // Saturday
  if (jsDay === 5) return "Friday";    // Friday
  if (jsDay === 4) return "Thursday";  // Thursday
  return "Weekday";                     // Sun, Mon, Tue, Wed
}

function shiftForType(dayType: string, settings: Settings, isHoliday: boolean): ShiftConfig {
  // Holiday dates use the "Holiday" shift config if available
  if (isHoliday && settings.shifts["Holiday"]) {
    return settings.shifts["Holiday"];
  }

  // Summer time override
  if (settings.summerTime && settings.summerShifts && settings.summerShifts[dayType]) {
    return settings.summerShifts[dayType];
  }

  return settings.shifts[dayType] || settings.shifts["Weekday"];
}

/**
 * Get hours for a specific date. Checks dayHours first, then falls back to shift config.
 */
export function getHoursForDate(dateStr: string, settings: Settings, isHoliday: boolean): number {
  if (settings.dayHours && settings.dayHours[dateStr] !== undefined) {
    return settings.dayHours[dateStr];
  }
  const shift = shiftForType(getDayType(new Date(dateStr + "T00:00:00")), settings, isHoliday);
  return shift.hours;
}

function getWeeksInMonth(year: number, month: number): Date[][] {
  const weeks: Date[][] = [];
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  // Find the first Friday on or before the first day (jsDay === 5)
  let d = new Date(firstDay);
  while (d.getDay() !== 5) {
    d.setDate(d.getDate() - 1);
  }

  while (d <= lastDay) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(d));
      d = new Date(d);
      d.setDate(d.getDate() + 1);
    }
    // Include week if any day is in the target month
    if (week.some((day) => day.getMonth() === month - 1 && day.getFullYear() === year)) {
      weeks.push(week);
    }
  }
  return weeks;
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function initializeCumStats(n: number, existing?: Record<number, CumulativeStats>): Record<number, CumulativeStats> {
  const stats: Record<number, CumulativeStats> = {};
  for (let i = 0; i < n; i++) {
    if (existing && existing[i]) {
      stats[i] = { ...existing[i] };
    } else {
      stats[i] = {
        totalHours: 0,
        totalDays: 0,
        weekendDays: 0,
        saturdays: 0,
        fridays: 0,
        offWeeks: 0,
      };
    }
  }
  return stats;
}

/**
 * Get the last OFF person index from existing entries (before the current month).
 * Used to prevent the same person from getting OFF in consecutive weeks.
 */
function getLastOffPerson(entries: ScheduleEntry[], currentMonthPrefix: string): number {
  // Find entries from before the current month, get the latest week's OFF person
  const prevEntries = entries.filter((e) => !e.date.startsWith(currentMonthPrefix));
  if (prevEntries.length === 0) return -1;

  // Group by week key
  const weekOffMap: Record<string, number> = {};
  for (const e of prevEntries) {
    const wk = `${e.date.substring(0, 7)}-W${e.weekNum}`;
    if (!weekOffMap[wk]) {
      weekOffMap[wk] = e.offPersonIdx;
    }
  }

  // Get the last week's OFF person
  const weekKeys = Object.keys(weekOffMap).sort();
  if (weekKeys.length === 0) return -1;
  return weekOffMap[weekKeys.length - 1];
}

export function generateScheduleForMonth(
  year: number,
  month: number,
  employees: Employee[],
  settings: Settings,
  existingCumStats?: Record<number, CumulativeStats>,
  existingEntries?: ScheduleEntry[]
): { entries: ScheduleEntry[]; localStats: Record<number, LocalStats>; cumulativeStats: Record<number, CumulativeStats>; weekOffMap: Record<number, number> } {
  const activeEmployees = employees.filter((e) => e.active);
  const n = activeEmployees.length;

  if (n < 2) {
    throw new Error("Need at least 2 active employees to generate a schedule");
  }

  const cumStats = initializeCumStats(n, existingCumStats);

  const weeks = getWeeksInMonth(year, month);
  if (weeks.length === 0) {
    return { entries: [], localStats: {}, cumulativeStats: cumStats, weekOffMap: {} };
  }

  // Initialize local stats for this month
  const localStats: Record<number, LocalStats> = {};
  for (let i = 0; i < n; i++) {
    localStats[i] = {
      days: 0,
      hours: 0,
      weekend: 0,
      sat: 0,
      fri: 0,
      offWeeks: 0,
      lastDayIdx: -999,
    };
  }

  // Build holiday set
  const holidaySet = new Set(settings.holidays || []);

  const entries: ScheduleEntry[] = [];
  let globalDayCounter = 0;

  // Determine last OFF person from existing entries to prevent consecutive
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const lastOffPerson = getLastOffPerson(existingEntries || [], monthPrefix);

  // === STEP 1: Determine OFF person for each week ===
  const weekOffMap: Record<number, number> = {};
  const offCountThisMonth: Record<number, number> = {};
  const recentlyOff = new Set<number>();

  // Track who was off in the last week from previous month

  for (let wn = 0; wn < weeks.length; wn++) {
    // Reset recentlyOff — only keep the previous week's off person
    recentlyOff.clear();
    if (wn > 0) {
      recentlyOff.add(weekOffMap[wn - 1]);
    } else if (lastOffPerson >= 0 && lastOffPerson < n) {
      recentlyOff.add(lastOffPerson);
    }

    // Score: lower = more deserving of OFF
    const scores = activeEmployees.map((_, ei) => {
      const cs = cumStats[ei];
      const ls = localStats[ei];
      let sc = 0;

      // Cumulative OFF weeks — fewer OFF weeks means higher priority for OFF
      sc += (cs?.offWeeks || 0) * 100;
      sc += (ls?.offWeeks || 0) * 50;

      // More hours worked = more deserving of OFF
      sc -= (cs?.totalHours || 0) * 2;
      sc -= (ls?.hours || 0) * 3;

      // STRONG penalty for recently off (prevents consecutive weeks)
      if (recentlyOff.has(ei)) {
        sc += 10000; // Very strong penalty
      }

      // If this person already got OFF this month, penalize
      if ((offCountThisMonth[ei] || 0) > 0) {
        sc += 5000;
      }

      // Small random tiebreaker
      sc += Math.random() * 5;
      return { ei, score: sc };
    });

    scores.sort((a, b) => a.score - b.score);
    const offPerson = scores[0].ei;
    weekOffMap[wn] = offPerson;
    offCountThisMonth[offPerson] = (offCountThisMonth[offPerson] || 0) + 1;
    localStats[offPerson].offWeeks += 1;
  }

  // === STEP 2: Assign employees to each day ===
  for (let wn = 0; wn < weeks.length; wn++) {
    const weekDays = weeks[wn];
    const offPerson = weekOffMap[wn];
    const workers = Array.from({ length: n }, (_, i) => i).filter((i) => i !== offPerson);

    for (const day of weekDays) {
      if (day.getMonth() !== month - 1 || day.getFullYear() !== year) continue;

      const dt = getDayType(day);
      const dateStr = formatDate(day);
      const isHoliday = holidaySet.has(dateStr);
      const shift = shiftForType(dt, settings, isHoliday);
      const hrs = getHoursForDate(dateStr, settings, isHoliday);

      // Build eligible list with rest constraint
      let eligible = workers.filter((ei) => {
        const gap = globalDayCounter - localStats[ei].lastDayIdx;
        return gap >= 1;
      });
      if (eligible.length === 0) eligible = [...workers];

      // Multi-factor scoring (lower = better candidate)
      const scored = eligible.map((ei) => {
        const cs = cumStats[ei];
        const ls = localStats[ei];
        let sc = 0;
        // Cumulative factors
        sc += (cs?.totalHours || 0) * 8;
        sc += (cs?.totalDays || 0) * 4;
        // Weekend fairness
        if (dt === "Saturday") {
          sc += (cs?.saturdays || 0) * 25;
          sc += (cs?.weekendDays || 0) * 8;
          sc += (ls?.sat || 0) * 15;
        } else if (dt === "Friday") {
          sc += (cs?.fridays || 0) * 25;
          sc += (cs?.weekendDays || 0) * 8;
          sc += (ls?.fri || 0) * 15;
        } else if (dt === "Thursday") {
          sc += (cs?.weekendDays || 0) * 3;
        }
        // Local month balance
        sc += (ls?.hours || 0) * 6;
        sc += (ls?.days || 0) * 3;
        // OFF weeks fairness
        sc -= (cs?.offWeeks || 0) * 2;
        // Random tiebreaker
        sc += Math.random() * 3;
        return { ei, score: sc };
      });

      scored.sort((a, b) => a.score - b.score);
      const chosen = scored[0].ei;

      // Update local stats
      localStats[chosen].days += 1;
      localStats[chosen].hours += hrs;
      localStats[chosen].lastDayIdx = globalDayCounter;
      if (dt === "Saturday" || dt === "Friday") {
        localStats[chosen].weekend += 1;
      }
      if (dt === "Saturday") localStats[chosen].sat += 1;
      if (dt === "Friday") localStats[chosen].fri += 1;

      const offEmp = activeEmployees[offPerson];

      entries.push({
        date: dateStr,
        dayName: DAYS_NAMES[day.getDay()],
        dayType: dt,
        empIdx: chosen,
        empName: activeEmployees[chosen].name,
        empHrid: activeEmployees[chosen].hrid,
        start: shift.start,
        end: shift.end,
        hours: hrs,
        offPerson: offEmp.name,
        offPersonIdx: offPerson,
        offPersonHrid: offEmp.hrid,
        weekNum: wn,
        isHoliday,
        isManual: false,
      });

      globalDayCounter += 1;
    }
  }

  // === STEP 3: Post-generation swap optimization ===
  let optimized = true;
  const maxIterations = 15;
  let iteration = 0;

  while (optimized && iteration < maxIterations) {
    optimized = false;
    iteration += 1;

    for (let i = 0; i < n && !optimized; i++) {
      for (let j = i + 1; j < n && !optimized; j++) {
        const iDays = entries.filter((r) => r.empIdx === i && !r.isManual);
        const jDays = entries.filter((r) => r.empIdx === j && !r.isManual);

        for (const di of iDays) {
          for (const dj of jDays) {
            // Skip if same week
            if (di.weekNum === dj.weekNum) continue;
            // Skip if either is the OFF person for that week
            if (weekOffMap[di.weekNum] === i || weekOffMap[dj.weekNum] === j) continue;
            // Skip if swap would make someone the OFF person's worker
            if (weekOffMap[di.weekNum] === j || weekOffMap[dj.weekNum] === i) continue;

            const hrsI = di.hours;
            const hrsJ = dj.hours;

            const newIHrs = localStats[i].hours - hrsI + hrsJ;
            const newJHrs = localStats[j].hours - hrsJ + hrsI;

            // Weekend balance check
            let newIWeekend = localStats[i].weekend;
            let newJWeekend = localStats[j].weekend;
            if (di.dayType === "Saturday" || di.dayType === "Friday") newIWeekend -= 1;
            if (dj.dayType === "Saturday" || dj.dayType === "Friday") newIWeekend += 1;
            if (dj.dayType === "Saturday" || dj.dayType === "Friday") newJWeekend -= 1;
            if (di.dayType === "Saturday" || di.dayType === "Friday") newJWeekend += 1;

            const oldVar = Math.abs(localStats[i].hours - localStats[j].hours);
            const newVar = Math.abs(newIHrs - newJHrs);
            const oldWkendVar = Math.abs(localStats[i].weekend - localStats[j].weekend);
            const newWkendVar = Math.abs(newIWeekend - newJWeekend);

            if (newVar < oldVar || (newVar === oldVar && newWkendVar < oldWkendVar)) {
              // Do the swap
              di.empIdx = j;
              di.empName = activeEmployees[j].name;
              di.empHrid = activeEmployees[j].hrid;
              dj.empIdx = i;
              dj.empName = activeEmployees[i].name;
              dj.empHrid = activeEmployees[i].hrid;

              localStats[i].hours = newIHrs;
              localStats[j].hours = newJHrs;
              localStats[i].weekend = newIWeekend;
              localStats[j].weekend = newJWeekend;

              // Update sat/fri counts
              if (di.dayType === "Saturday") {
                localStats[i].sat -= 1;
                localStats[j].sat += 1;
              } else if (di.dayType === "Friday") {
                localStats[i].fri -= 1;
                localStats[j].fri += 1;
              }
              if (dj.dayType === "Saturday") {
                localStats[j].sat -= 1;
                localStats[i].sat += 1;
              } else if (dj.dayType === "Friday") {
                localStats[j].fri -= 1;
                localStats[i].fri += 1;
              }

              optimized = true;
              break;
            }
          }
          if (optimized) break;
        }
      }
    }
  }

  // === STEP 4: Update cumulative stats ===
  for (const r of entries) {
    if (r.isManual) continue;
    const ei = r.empIdx;
    cumStats[ei].totalHours += r.hours;
    cumStats[ei].totalDays += 1;
    if (r.dayType === "Saturday" || r.dayType === "Friday") {
      cumStats[ei].weekendDays += 1;
    }
    if (r.dayType === "Saturday") cumStats[ei].saturdays += 1;
    if (r.dayType === "Friday") cumStats[ei].fridays += 1;
  }

  for (const [ei, count] of Object.entries(offCountThisMonth)) {
    cumStats[Number(ei)].offWeeks += count;
  }

  return { entries, localStats, cumulativeStats: cumStats, weekOffMap };
}

/**
 * Generate schedule for a single week starting from a given date.
 */
export function generateScheduleForWeek(
  startDate: string,
  employees: Employee[],
  settings: Settings,
  existingCumStats?: Record<number, CumulativeStats>,
  existingEntries?: ScheduleEntry[]
): { entries: ScheduleEntry[]; localStats: Record<number, LocalStats>; cumulativeStats: Record<number, CumulativeStats> } {
  const start = new Date(startDate + "T00:00:00");

  // Determine which month this week belongs to (majority of days)
  const weekDates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    weekDates.push(d);
  }

  // Use the month that has the most days in this week
  const monthCounts: Record<string, number> = {};
  for (const d of weekDates) {
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    monthCounts[key] = (monthCounts[key] || 0) + 1;
  }
  const [bestMonth] = Object.entries(monthCounts).sort(([, a], [, b]) => b - a)[0];
  const [yearStr, monthStr] = bestMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  // Generate the full month but only return this week's entries
  const result = generateScheduleForMonth(year, month, employees, settings, existingCumStats, existingEntries);

  // Filter to only this week's entries
  const weekStartStr = formatDate(start);
  const weekEnd = new Date(start);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = formatDate(weekEnd);

  const weekEntries = result.entries.filter(
    (e) => e.date >= weekStartStr && e.date <= weekEndStr
  );

  return {
    entries: weekEntries,
    localStats: result.localStats,
    cumulativeStats: result.cumulativeStats,
  };
}

/**
 * Recalculate hours for existing schedule entries (e.g., after settings change).
 */
export function recalcScheduleHours(
  entries: ScheduleEntry[],
  settings: Settings
): ScheduleEntry[] {
  return entries.map((entry) => {
    if (entry.isManual) return entry;
    const shift = shiftForType(entry.dayType, settings, entry.isHoliday);
    const hrs = getHoursForDate(entry.date, settings, entry.isHoliday);
    return {
      ...entry,
      start: shift.start,
      end: shift.end,
      hours: hrs,
    };
  });
}

/**
 * Get local stats from entries.
 */
export function computeLocalStats(entries: ScheduleEntry[], employeeCount: number): Record<number, LocalStats> {
  const stats: Record<number, LocalStats> = {};
  for (let i = 0; i < employeeCount; i++) {
    stats[i] = { days: 0, hours: 0, weekend: 0, sat: 0, fri: 0, offWeeks: 0, lastDayIdx: -999 };
  }
  for (const r of entries) {
    if (!stats[r.empIdx]) {
      stats[r.empIdx] = { days: 0, hours: 0, weekend: 0, sat: 0, fri: 0, offWeeks: 0, lastDayIdx: -999 };
    }
    stats[r.empIdx].days += 1;
    stats[r.empIdx].hours += r.hours;
    if (r.dayType === "Saturday" || r.dayType === "Friday") stats[r.empIdx].weekend += 1;
    if (r.dayType === "Saturday") stats[r.empIdx].sat += 1;
    if (r.dayType === "Friday") stats[r.empIdx].fri += 1;
  }
  return stats;
}

/**
 * Compute OFF weeks from entries.
 */
export function computeOffWeeks(entries: ScheduleEntry[], employeeCount: number): Record<number, number> {
  const offWeeks: Record<number, number> = {};
  for (let i = 0; i < employeeCount; i++) offWeeks[i] = 0;
  
  const seen = new Set<string>();
  for (const e of entries) {
    const key = `${e.date.substring(0, 7)}-W${e.weekNum}`;
    const fullKey = `${key}-${e.offPersonIdx}`;
    if (!seen.has(fullKey)) {
      seen.add(fullKey);
      if (offWeeks[e.offPersonIdx] !== undefined) {
        offWeeks[e.offPersonIdx]++;
      }
    }
  }
  return offWeeks;
}

/**
 * Get week number key (Friday-based).
 */
export function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const fri = new Date(d);
  while (fri.getDay() !== 5) fri.setDate(fri.getDate() - 1);
  return fri.toISOString().substring(0, 10);
}

/**
 * Get weeks in a specific month (Friday-based).
 */
export function getMonthWeeks(year: number, month: number): { weekStart: string; weekEnd: string }[] {
  const weeks = getWeeksInMonth(year, month);
  return weeks.map((weekDays) => ({
    weekStart: formatDate(weekDays[0]),
    weekEnd: formatDate(weekDays[6]),
  }));
}
