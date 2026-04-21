/**
 * IT Helpdesk Shift Scheduler Algorithm v4.1 — Target-Based Balancing (Improved)
 *
 * Key improvements:
 * 1. OFF weeks distributed with MAXIMUM fairness: spread as evenly as possible
 * 2. Target-Based daily: idealTotal = (cumHours + monthHours) / n, pick highest deficit
 * 3. Deterministic: No Math.random() — reproducible results
 * 4. Friday/Saturday fairness: Weekend penalty in scoring
 * 5. No consecutive days: Hard constraint with soft fallback
 * 6. Post-optimization swaps to minimize variance
 * 7. Cross-month cumulative stats carry forward
 */

// ===== Type Definitions =====

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
  holidayHours?: Record<string, number>;
  summerTime?: boolean;
  summerShifts?: Record<string, ShiftConfig>;
  dayHours?: Record<string, number>;
}

export interface ScheduleEntry {
  date: string;
  dayName: string;
  dayType: string;
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

// ===== Utility Functions =====

const DAYS_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DAY_NAME_TO_JS_DAY: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

function getDayType(d: Date): string {
  const jsDay = d.getDay();
  if (jsDay === 6) return "Saturday";
  if (jsDay === 5) return "Friday";
  if (jsDay === 4) return "Thursday";
  return "Weekday";
}

function isWeekendDay(dayType: string): boolean {
  return dayType === "Saturday" || dayType === "Friday";
}

function shiftForType(dayType: string, settings: Settings, isHoliday: boolean): ShiftConfig {
  if (isHoliday && settings.shifts["Holiday"]) {
    return settings.shifts["Holiday"];
  }
  if (settings.summerTime && settings.summerShifts && settings.summerShifts[dayType]) {
    return settings.summerShifts[dayType];
  }
  return settings.shifts[dayType] || settings.shifts["Weekday"];
}

export function getHoursForDate(dateStr: string, settings: Settings, isHoliday: boolean): number {
  // Holidays are always OFF (0 hours), regardless of any holidayHours overrides.
  if (isHoliday) return 0;
  if (settings.dayHours && settings.dayHours[dateStr] !== undefined) {
    return settings.dayHours[dateStr];
  }
  const shift = shiftForType(getDayType(new Date(dateStr + "T00:00:00")), settings, false);
  return shift.hours;
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getWeeksInMonth(year: number, month: number, weekStart: string = "Friday"): Date[][] {
  const weeks: Date[][] = [];
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const targetDay = DAY_NAME_TO_JS_DAY[weekStart] ?? 5;
  let d = new Date(firstDay);
  while (d.getDay() !== targetDay) d.setDate(d.getDate() - 1);

  while (d <= lastDay) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(d));
      d = new Date(d);
      d.setDate(d.getDate() + 1);
    }
    if (week.some((day) => day.getMonth() === month - 1 && day.getFullYear() === year)) {
      weeks.push(week);
    }
  }
  return weeks;
}

function initializeCumStats(n: number, existing?: Record<number, CumulativeStats>): Record<number, CumulativeStats> {
  const stats: Record<number, CumulativeStats> = {};
  for (let i = 0; i < n; i++) {
    if (existing && existing[i]) {
      stats[i] = { ...existing[i] };
    } else {
      stats[i] = { totalHours: 0, totalDays: 0, weekendDays: 0, saturdays: 0, fridays: 0, offWeeks: 0 };
    }
  }
  return stats;
}

function getLastOffPerson(entries: ScheduleEntry[], currentMonthPrefix: string): number {
  const prevEntries = entries.filter((e) => !e.date.startsWith(currentMonthPrefix));
  if (prevEntries.length === 0) return -1;

  const weekOffMap: Record<string, number> = {};
  for (const e of prevEntries) {
    const wk = `${e.date.substring(0, 7)}-W${e.weekNum}`;
    if (!weekOffMap[wk]) weekOffMap[wk] = e.offPersonIdx;
  }

  const weekKeys = Object.keys(weekOffMap).sort();
  if (weekKeys.length === 0) return -1;
  return weekOffMap[weekKeys.length - 1];
}

function getLastWorkedEmployeeName(entries: ScheduleEntry[], firstDateOfThisMonth: string): string | null {
  const prevEntries = entries.filter((e) => e.date < firstDateOfThisMonth && !e.isHoliday && e.hours > 0);
  if (prevEntries.length === 0) return null;
  return prevEntries[prevEntries.length - 1].empName;
}

// ===== Core Algorithm =====

/**
 * Distribute OFF weeks as evenly as possible among employees.
 * 
 * Strategy:
 * 1. Calculate ideal OFF weeks per person = totalWeeks / n
 * 2. Each person gets either floor or ceil of ideal
 * 3. Spread them out: no consecutive OFF weeks for same person
 * 4. Consider cumulative OFF weeks from previous months
 * 
 * Returns weekOffMap: weekNum → employeeIndex
 */
function distributeOffWeeks(
  totalWeeks: number,
  n: number,
  cumStats: Record<number, CumulativeStats>,
  lastOffIdx: number
): Record<number, number> {
  const weekOffMap: Record<number, number> = {};

  // Calculate how many OFF weeks each person should get this month
  // idealOffPerPerson = totalWeeks / n
  // Some get floor, some get ceil
  const idealOff = totalWeeks / n;
  const baseOff = Math.floor(idealOff);
  const extraOffCount = Math.round((idealOff - baseOff) * n); // how many get +1

  // Determine target offWeeks per employee this month (including cumulative consideration)
  // Employees with fewer cumulative offWeeks should get more this month
  const empTargets: Array<{ idx: number; cumOff: number; targetOff: number }> = [];
  for (let i = 0; i < n; i++) {
    empTargets.push({
      idx: i,
      cumOff: cumStats[i]?.offWeeks || 0,
      targetOff: 0,
    });
  }

  // Sort by cumulative offWeeks (ascending) — those with fewer get priority
  empTargets.sort((a, b) => a.cumOff - b.cumOff);

  // Assign target offWeeks: extraOffCount people get baseOff+1, rest get baseOff
  for (let i = 0; i < n; i++) {
    empTargets[i].targetOff = i < extraOffCount ? baseOff + 1 : baseOff;
  }

  // Build a map: idx → target offWeeks
  const targetMap: Record<number, number> = {};
  for (const e of empTargets) {
    targetMap[e.idx] = e.targetOff;
  }

  // Greedily assign OFF weeks
  const currentOffCount: Record<number, number> = {};
  for (let i = 0; i < n; i++) currentOffCount[i] = 0;

  let prevOff = lastOffIdx;

  for (let w = 0; w < totalWeeks; w++) {
    // Find candidates: not the previous week's OFF, hasn't reached their target
    let candidates = Array.from({ length: n }, (_, i) => i)
      .filter((i) => i !== prevOff && currentOffCount[i] < targetMap[i]);

    // If no one needs more OFF weeks but we still have weeks to fill
    if (candidates.length === 0) {
      candidates = Array.from({ length: n }, (_, i) => i)
        .filter((i) => i !== prevOff);
    }

    // Among candidates, pick the one with most hours (needs rest most)
    // Tie-break: least current offWeeks this month
    candidates.sort((a, b) => {
      const aHours = (cumStats[a]?.totalHours || 0);
      const bHours = (cumStats[b]?.totalHours || 0);
      if (aHours !== bHours) return bHours - aHours;
      return currentOffCount[a] - currentOffCount[b];
    });

    const chosen = candidates[0];
    weekOffMap[w] = chosen;
    currentOffCount[chosen]++;
    prevOff = chosen;
  }

  return weekOffMap;
}

/**
 * Generate schedule for a month using Target-Based Balancing v4.1.
 *
 * Key rule: OFF weeks only apply when n > 7 (employees > days in a week).
 * When n <= 7: no off person, all employees are available every day.
 * When n > 7: one person off per week, rotating fairly.
 *
 * Algorithm:
 * 1. Determine if OFF weeks apply (n > 7)
 * 2. If yes: distribute OFF weeks evenly (no consecutive for same person)
 * 3. Calculate idealTotal = (cumHours + monthWorkingHours) / n
 * 4. Each day: pick worker with highest deficit, no consecutive days, weekend fairness
 * 5. Post-optimize with swaps to minimize variance
 */
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
  const weeks = getWeeksInMonth(year, month, settings.weekStart);
  if (weeks.length === 0) {
    return { entries: [], localStats: {}, cumulativeStats: cumStats, weekOffMap: {} };
  }

  const holidaySet = new Set(settings.holidays || []);
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;

  // Initialize local stats
  const localStats: Record<number, LocalStats> = {};
  for (let i = 0; i < n; i++) {
    localStats[i] = { days: 0, hours: 0, weekend: 0, sat: 0, fri: 0, offWeeks: 0, lastDayIdx: -999 };
  }

  // === CALCULATE TOTAL MONTH HOURS ===
  let totalMonthHours = 0;
  for (const week of weeks) {
    for (const day of week) {
      if (day.getMonth() !== month - 1 || day.getFullYear() !== year) continue;
      const dateStr = formatDate(day);
      const isHoliday = holidaySet.has(dateStr);
      totalMonthHours += getHoursForDate(dateStr, settings, isHoliday);
    }
  }

  // === STEP 1: DETERMINE OFF WEEKS ===
  // OFF weeks only when employees > 7 (more people than days in a week)
  const hasOffWeeks = n > 7;
  const weekOffMap: Record<number, number> = {};

  if (hasOffWeeks) {
    const lastOffPerson = getLastOffPerson(existingEntries || [], monthPrefix);
    let lastOffIdx = -1;
    if (lastOffPerson >= 0 && lastOffPerson < n) {
      lastOffIdx = lastOffPerson;
    } else if (lastOffPerson >= 0 && existingEntries && existingEntries.length > 0) {
      const prevOffName = existingEntries[existingEntries.length - 1]?.offPerson;
      if (prevOffName) {
        const idx = activeEmployees.findIndex((e) => e.name === prevOffName);
        if (idx >= 0) lastOffIdx = idx;
      }
    }
    const offMap = distributeOffWeeks(weeks.length, n, cumStats, lastOffIdx);
    for (const [k, v] of Object.entries(offMap)) weekOffMap[Number(k)] = v;
    for (let w = 0; w < weeks.length; w++) {
      localStats[weekOffMap[w]].offWeeks++;
    }
  }

  // === STEP 2: CALCULATE TARGET ===
  const totalCumHours = Object.values(cumStats).reduce((sum, c) => sum + c.totalHours, 0);
  const idealTotalPerEmployee = (totalCumHours + totalMonthHours) / n;

  // === STEP 3: ASSIGN DAILY WORKERS ===
  const entries: ScheduleEntry[] = [];

  // Find last worked person from previous month (for consecutive prevention)
  const firstDateOfThisMonth = formatDate(weeks[0][0]);
  const lastWorkedName = getLastWorkedEmployeeName(existingEntries || [], firstDateOfThisMonth);
  let lastWorker = -1;
  if (lastWorkedName) {
    const idx = activeEmployees.findIndex((e) => e.name === lastWorkedName);
    if (idx >= 0) lastWorker = idx;
  }

  for (let wn = 0; wn < weeks.length; wn++) {
    // Determine who's available this day
    const offIdx = hasOffWeeks ? weekOffMap[wn] : -1;
    const workers = Array.from({ length: n }, (_, i) => i).filter((i) => i !== offIdx);

    for (const day of weeks[wn]) {
      if (day.getMonth() !== month - 1 || day.getFullYear() !== year) continue;

      const dateStr = formatDate(day);
      const isHoliday = holidaySet.has(dateStr);
      const dayType = getDayType(day);
      const shift = shiftForType(dayType, settings, isHoliday);
      const hrs = getHoursForDate(dateStr, settings, isHoliday);

      // Holidays with 0 hours
      if (isHoliday || hrs === 0) {
        let eligible = workers.filter((i) => i !== lastWorker);
        if (eligible.length === 0) eligible = workers;

        const scored = eligible.map((i) => ({
          idx: i,
          days: (cumStats[i]?.totalDays || 0) + (localStats[i]?.days || 0),
        }));
        scored.sort((a, b) => a.days - b.days);
        const chosen = scored[0].idx;

        // When no off person (n <= 7): offPerson = empty string
        const offEmpName = offIdx >= 0 ? activeEmployees[offIdx].name : "";
        const offEmpIdx = offIdx >= 0 ? offIdx : 0;
        const offEmpHrid = offIdx >= 0 ? activeEmployees[offIdx].hrid : "";
        entries.push({
          date: dateStr, dayName: DAYS_NAMES[day.getDay()], dayType,
          empIdx: chosen, empName: activeEmployees[chosen].name, empHrid: activeEmployees[chosen].hrid,
          start: shift.start, end: shift.end, hours: hrs,
          offPerson: offEmpName, offPersonIdx: offEmpIdx,
          offPersonHrid: offEmpHrid,
          weekNum: wn, isHoliday, isManual: false,
        });
        continue;
      }

      // === Normal working day ===
      // CONSTRAINT: No consecutive days
      let eligible = workers.filter((i) => i !== lastWorker);
      if (eligible.length === 0) eligible = [...workers];

      // SCORE: deficit from ideal total (higher = more deserving of work)
      const scored = eligible.map((i) => {
        const combinedHours = (cumStats[i]?.totalHours || 0) + (localStats[i]?.hours || 0);
        let deficit = idealTotalPerEmployee - combinedHours;

        // WEEKEND FAIRNESS: penalize workers with many weekend days
        if (isWeekendDay(dayType)) {
          const combinedWeekends = (cumStats[i]?.weekendDays || 0) + (localStats[i]?.weekend || 0);
          deficit -= combinedWeekends * (hrs * 0.5);

          if (dayType === "Saturday") {
            deficit -= ((cumStats[i]?.saturdays || 0) + (localStats[i]?.sat || 0)) * (hrs * 0.3);
          } else if (dayType === "Friday") {
            deficit -= ((cumStats[i]?.fridays || 0) + (localStats[i]?.fri || 0)) * (hrs * 0.3);
          }
        }

        // DAYS BALANCE: slight penalty for more total days
        deficit -= ((cumStats[i]?.totalDays || 0) + (localStats[i]?.days || 0)) * 0.3;

        return { idx: i, score: deficit };
      });

      scored.sort((a, b) => b.score - a.score);
      const chosen = scored[0].idx;

      // Update local stats
      localStats[chosen].days += 1;
      localStats[chosen].hours += hrs;
      if (isWeekendDay(dayType)) localStats[chosen].weekend += 1;
      if (dayType === "Saturday") localStats[chosen].sat += 1;
      if (dayType === "Friday") localStats[chosen].fri += 1;
      lastWorker = chosen;

      const offEmpName = offIdx >= 0 ? activeEmployees[offIdx].name : "";
      const offEmpIdx = offIdx >= 0 ? offIdx : 0;
      const offEmpHrid = offIdx >= 0 ? activeEmployees[offIdx].hrid : "";
      entries.push({
        date: dateStr, dayName: DAYS_NAMES[day.getDay()], dayType,
        empIdx: chosen, empName: activeEmployees[chosen].name, empHrid: activeEmployees[chosen].hrid,
        start: shift.start, end: shift.end, hours: hrs,
        offPerson: offEmpName, offPersonIdx: offEmpIdx,
        offPersonHrid: offEmpHrid,
        weekNum: wn, isHoliday, isManual: false,
      });
    }
  }

  // === STEP 4: POST-OPTIMIZATION SWAPS ===
  let optimized = true;
  const maxIterations = 30;
  let iteration = 0;

  while (optimized && iteration < maxIterations) {
    optimized = false;
    iteration += 1;

    for (let i = 0; i < n && !optimized; i++) {
      for (let j = i + 1; j < n && !optimized; j++) {
        const iEntries = entries.filter((r) => r.empIdx === i && !r.isManual && r.hours > 0);
        const jEntries = entries.filter((r) => r.empIdx === j && !r.isManual && r.hours > 0);

        for (const di of iEntries) {
          for (const dj of jEntries) {
            if (di.weekNum === dj.weekNum) continue;
            if (weekOffMap[di.weekNum] === i || weekOffMap[dj.weekNum] === j) continue;
            if (weekOffMap[di.weekNum] === j || weekOffMap[dj.weekNum] === i) continue;
            if (wouldBeConsecutive(entries, di, dj, i, j)) continue;

            const hrsI = di.hours;
            const hrsJ = dj.hours;

            const newIHrs = localStats[i].hours - hrsI + hrsJ;
            const newJHrs = localStats[j].hours - hrsJ + hrsI;

            let newIWeekend = localStats[i].weekend;
            let newJWeekend = localStats[j].weekend;
            if (isWeekendDay(di.dayType)) newIWeekend -= 1;
            if (isWeekendDay(dj.dayType)) newIWeekend += 1;
            if (isWeekendDay(dj.dayType)) newJWeekend -= 1;
            if (isWeekendDay(di.dayType)) newJWeekend += 1;

            const oldVar = Math.abs(localStats[i].hours - localStats[j].hours);
            const newVar = Math.abs(newIHrs - newJHrs);
            const oldWkendVar = Math.abs(localStats[i].weekend - localStats[j].weekend);
            const newWkendVar = Math.abs(newIWeekend - newJWeekend);

            if (newVar < oldVar || (newVar === oldVar && newWkendVar < oldWkendVar)) {
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

              if (di.dayType === "Saturday") {
                localStats[i].sat -= 1; localStats[j].sat += 1;
              } else if (di.dayType === "Friday") {
                localStats[i].fri -= 1; localStats[j].fri += 1;
              }
              if (dj.dayType === "Saturday") {
                localStats[j].sat -= 1; localStats[i].sat += 1;
              } else if (dj.dayType === "Friday") {
                localStats[j].fri -= 1; localStats[i].fri += 1;
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

  // === STEP 5: UPDATE CUMULATIVE STATS ===
  for (const r of entries) {
    if (r.isManual) continue;
    const ei = r.empIdx;
    cumStats[ei].totalHours += r.hours;
    cumStats[ei].totalDays += 1;
    if (isWeekendDay(r.dayType)) cumStats[ei].weekendDays += 1;
    if (r.dayType === "Saturday") cumStats[ei].saturdays += 1;
    if (r.dayType === "Friday") cumStats[ei].fridays += 1;
  }
  for (let i = 0; i < n; i++) {
    cumStats[i].offWeeks += localStats[i].offWeeks;
  }

  return { entries, localStats, cumulativeStats: cumStats, weekOffMap };
}

function wouldBeConsecutive(
  allEntries: ScheduleEntry[],
  entryA: ScheduleEntry,
  entryB: ScheduleEntry,
  newOwnerA: number,
  newOwnerB: number
): boolean {
  const dateA = entryA.date;
  const dateB = entryB.date;

  const newOwnerADates = allEntries
    .filter((e) => e.empIdx === newOwnerA && e.date !== dateA && e.date !== dateB && e.hours > 0 && !e.isHoliday)
    .map((e) => e.date);

  for (const d of newOwnerADates) {
    const diff = Math.abs(new Date(dateB).getTime() - new Date(d).getTime()) / (1000 * 60 * 60 * 24);
    if (diff <= 1) return true;
  }

  const newOwnerBDates = allEntries
    .filter((e) => e.empIdx === newOwnerB && e.date !== dateA && e.date !== dateB && e.hours > 0 && !e.isHoliday)
    .map((e) => e.date);

  for (const d of newOwnerBDates) {
    const diff = Math.abs(new Date(dateA).getTime() - new Date(d).getTime()) / (1000 * 60 * 60 * 24);
    if (diff <= 1) return true;
  }

  return false;
}

// ===== Week Generation =====

export function generateScheduleForWeek(
  startDate: string,
  employees: Employee[],
  settings: Settings,
  existingCumStats?: Record<number, CumulativeStats>,
  existingEntries?: ScheduleEntry[]
): { entries: ScheduleEntry[]; localStats: Record<number, LocalStats>; cumulativeStats: Record<number, CumulativeStats> } {
  const start = new Date(startDate + "T00:00:00");

  const weekDates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    weekDates.push(d);
  }

  const monthCounts: Record<string, number> = {};
  for (const d of weekDates) {
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    monthCounts[key] = (monthCounts[key] || 0) + 1;
  }
  const [bestMonth] = Object.entries(monthCounts).sort(([, a], [, b]) => b - a)[0];
  const [yearStr, monthStr] = bestMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  const result = generateScheduleForMonth(year, month, employees, settings, existingCumStats, existingEntries);

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

// ===== Utility: Recalculate Hours =====

export function recalcScheduleHours(
  entries: ScheduleEntry[],
  settings: Settings
): ScheduleEntry[] {
  const holidaySet = new Set(settings.holidays || []);
  return entries.map((entry) => {
    if (entry.isManual) return entry;
    const isHolidayDynamic = holidaySet.has(entry.date);
    if (isHolidayDynamic) {
      return { ...entry, start: "00:00 AM", end: "00:00 AM", hours: 0, isHoliday: true };
    }
    const shift = shiftForType(entry.dayType, settings, false);
    const hrs = getHoursForDate(entry.date, settings, false);
    return { ...entry, start: shift.start, end: shift.end, hours: hrs, isHoliday: false };
  });
}

// ===== Stats Computation =====

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
    if (isWeekendDay(r.dayType)) stats[r.empIdx].weekend += 1;
    if (r.dayType === "Saturday") stats[r.empIdx].sat += 1;
    if (r.dayType === "Friday") stats[r.empIdx].fri += 1;
  }
  return stats;
}

export function computeOffWeeks(entries: ScheduleEntry[], employeeCount: number): Record<number, number> {
  const offWeeks: Record<number, number> = {};
  for (let i = 0; i < employeeCount; i++) offWeeks[i] = 0;
  const seen = new Set<string>();
  for (const e of entries) {
    const key = `${e.date.substring(0, 7)}-W${e.weekNum}`;
    const fullKey = `${key}-${e.offPersonIdx}`;
    if (!seen.has(fullKey)) {
      seen.add(fullKey);
      if (offWeeks[e.offPersonIdx] !== undefined) offWeeks[e.offPersonIdx]++;
    }
  }
  return offWeeks;
}

export function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const fri = new Date(d);
  while (fri.getDay() !== 5) fri.setDate(fri.getDate() - 1);
  return fri.toISOString().substring(0, 10);
}

export function getMonthWeeks(year: number, month: number, weekStart: string = "Friday"): { weekStart: string; weekEnd: string }[] {
  const weeks = getWeeksInMonth(year, month, weekStart);
  return weeks.map((weekDays) => ({
    weekStart: formatDate(weekDays[0]),
    weekEnd: formatDate(weekDays[6]),
  }));
}

// ===== Connection Team =====

export function generateConnectionTeamSchedule(
  weeks: Array<{ weekStart: string; weekEnd: string }>,
  employees: Employee[],
  existingCumWeeks?: Record<string, number>,
  existingHelpDeskHours?: Record<string, number>
): Array<{ weekStart: string; weekEnd: string; empIdx: number; empName: string; empHrid: string }> {
  const connectionEmps = employees.filter((e) => e.active);
  const n = connectionEmps.length;
  if (n === 0) return [];

  const assignments: Record<number, number> = {};
  connectionEmps.forEach((_, i) => { assignments[i] = 0; });

  const result: Array<{ weekStart: string; weekEnd: string; empIdx: number; empName: string; empHrid: string }> = [];
  let lastAssigned = -1;

  for (const week of weeks) {
    const scored = connectionEmps.map((emp, i) => {
      let score = 0;
      const cumWeeks = (existingCumWeeks?.[emp.name] || 0) + assignments[i];
      score += cumWeeks * 100;
      const hdHours = existingHelpDeskHours?.[emp.name] || 0;
      score -= hdHours * 0.5;
      // Don't assign same person consecutively if possible
      if (i === lastAssigned && n > 1) score += 50;
      score += i * 0.01;
      return { idx: i, score };
    });

    scored.sort((a, b) => a.score - b.score);
    const chosen = scored[0].idx;
    assignments[chosen]++;
    lastAssigned = chosen;

    result.push({
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      empIdx: chosen,
      empName: connectionEmps[chosen].name,
      empHrid: connectionEmps[chosen].hrid,
    });
  }

  return result;
}
