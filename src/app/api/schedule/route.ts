import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/auth";
import { generateScheduleForMonth, generateScheduleForWeek, computeLocalStats, computeOffWeeks } from "@/lib/scheduler";
import type { Employee, Settings, ScheduleEntry, CumulativeStats } from "@/lib/scheduler";
import { db } from "@/lib/db";

// GET: Fetch schedule entries (optionally filtered by month)
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month") || "";

    const whereClause: Record<string, unknown> = {};
    if (month) whereClause.date = { startsWith: month };

    const dbEntries = await db.scheduleEntry.findMany({
      where: whereClause,
      orderBy: { date: "asc" },
    });

    const genMonths = await db.generatedMonth.findMany({ orderBy: { monthKey: "asc" } });

    return NextResponse.json({
      entries: dbEntries.map((e) => ({
        date: e.date,
        dayName: e.dayName,
        dayType: e.dayType,
        empIdx: e.empIdx,
        empName: e.empName,
        empHrid: e.empHrid,
        start: e.start,
        end: e.end,
        hours: e.hours,
        offPerson: e.offPerson,
        offPersonIdx: e.offPersonIdx,
        offPersonHrid: e.offPersonHrid,
        weekNum: e.weekNum,
        isHoliday: e.isHoliday,
        isManual: e.isManual,
      })),
      generatedMonths: genMonths.map((g) => g.monthKey),
    });
  } catch (error) {
    console.error("Error fetching schedule entries:", error);
    return NextResponse.json({ error: "Failed to fetch entries" }, { status: 500 });
  }
}

// POST: Generate schedule (in-memory store backed)
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") return forbiddenResponse();

  try {
    const body = await request.json();
    const { mode, year, month, weekStart } = body;

    if (!mode) {
      return NextResponse.json({ error: "Mode is required (week or month)" }, { status: 400 });
    }

    // Fetch employees and settings from store
    const dbEmployees = await db.employee.findMany({ orderBy: { order: "asc" } });
    const dbSettings = await db.settings.findUnique();

    const employees: Employee[] = dbEmployees.map((e) => ({
      id: e.id,
      name: e.name,
      hrid: e.hrid,
      active: Boolean(e.active),
    }));

    const settings: Settings = {
      shifts: dbSettings ? JSON.parse(dbSettings.shifts) : {},
      weekStart: dbSettings?.weekStart || "Friday",
      holidays: dbSettings ? JSON.parse(dbSettings.holidays) : [],
      summerTime: !!dbSettings?.summerTime,
      summerShifts: dbSettings ? JSON.parse(dbSettings.summerShifts) : {},
      dayHours: dbSettings ? JSON.parse(dbSettings.dayHours || "{}") : {},
    };

    const activeEmployees = employees.filter((e) => e.active);

    if (activeEmployees.length < 2) {
      return NextResponse.json({ error: "Need at least 2 active employees" }, { status: 400 });
    }

    // Fetch existing entries from store for cumulative stats
    const existingDbEntries = await db.scheduleEntry.findMany({ orderBy: { date: "asc" } });
    const existingEntries: ScheduleEntry[] = existingDbEntries.map((e) => ({
      date: e.date,
      dayName: e.dayName,
      dayType: e.dayType,
      empIdx: e.empIdx,
      empName: e.empName,
      empHrid: e.empHrid,
      start: e.start,
      end: e.end,
      hours: e.hours,
      offPerson: e.offPerson,
      offPersonIdx: e.offPersonIdx,
      offPersonHrid: e.offPersonHrid,
      weekNum: e.weekNum,
      isHoliday: Boolean(e.isHoliday),
      isManual: Boolean(e.isManual),
    }));

    // Fetch existing generated months
    const genMonths = await db.generatedMonth.findMany({ orderBy: { monthKey: "asc" } });
    const existingGenMonths = genMonths.map((g) => g.monthKey);

    // Recompute cumulative stats from existing entries
    const tempCumStats: Record<number, CumulativeStats> = {};
    for (let i = 0; i < activeEmployees.length; i++) {
      tempCumStats[i] = { totalHours: 0, totalDays: 0, weekendDays: 0, saturdays: 0, fridays: 0, offWeeks: 0 };
    }
    for (const e of existingEntries) {
      if (e.isManual || !tempCumStats[e.empIdx]) continue;
      tempCumStats[e.empIdx].totalHours += e.hours;
      tempCumStats[e.empIdx].totalDays += 1;
      if (e.dayType === "Saturday" || e.dayType === "Friday") tempCumStats[e.empIdx].weekendDays += 1;
      if (e.dayType === "Saturday") tempCumStats[e.empIdx].saturdays += 1;
      if (e.dayType === "Friday") tempCumStats[e.empIdx].fridays += 1;
    }
    const offWeeks = computeOffWeeks(existingEntries, activeEmployees.length);
    for (const [ei, count] of Object.entries(offWeeks)) {
      tempCumStats[Number(ei)].offWeeks = count;
    }

    let newEntries: ScheduleEntry[] = [];
    let newCumStats: Record<number, CumulativeStats> = {};

    if (mode === "month") {
      if (!year || !month) {
        return NextResponse.json({ error: "Year and month are required" }, { status: 400 });
      }

      const monthKey = `${year}-${String(month).padStart(2, "0")}`;

      // Remove existing non-manual entries for this month
      await db.scheduleEntry.deleteMany({
        where: { date: { startsWith: monthKey }, isManual: false },
      });

      // Recompute cumulative stats from remaining entries
      const remainingDbEntries = await db.scheduleEntry.findMany({ orderBy: { date: "asc" } });
      const cleanCumStats: Record<number, CumulativeStats> = {};
      for (let i = 0; i < activeEmployees.length; i++) {
        cleanCumStats[i] = { totalHours: 0, totalDays: 0, weekendDays: 0, saturdays: 0, fridays: 0, offWeeks: 0 };
      }
      const remainingEntries: ScheduleEntry[] = remainingDbEntries.map((e) => ({
        date: e.date, dayName: e.dayName, dayType: e.dayType,
        empIdx: e.empIdx, empName: e.empName, empHrid: e.empHrid,
        start: e.start, end: e.end, hours: e.hours,
        offPerson: e.offPerson, offPersonIdx: e.offPersonIdx, offPersonHrid: e.offPersonHrid,
        weekNum: e.weekNum, isHoliday: Boolean(e.isHoliday), isManual: Boolean(e.isManual),
      }));
      for (const e of remainingEntries) {
        if (e.isManual || !cleanCumStats[e.empIdx]) continue;
        cleanCumStats[e.empIdx].totalHours += e.hours;
        cleanCumStats[e.empIdx].totalDays += 1;
        if (e.dayType === "Saturday" || e.dayType === "Friday") cleanCumStats[e.empIdx].weekendDays += 1;
        if (e.dayType === "Saturday") cleanCumStats[e.empIdx].saturdays += 1;
        if (e.dayType === "Friday") cleanCumStats[e.empIdx].fridays += 1;
      }
      const offW = computeOffWeeks(remainingEntries, activeEmployees.length);
      for (const [ei, count] of Object.entries(offW)) {
        cleanCumStats[Number(ei)].offWeeks = count;
      }

      const result = generateScheduleForMonth(year, month, activeEmployees, settings, cleanCumStats, remainingEntries);
      newEntries = result.entries;
      newCumStats = result.cumulativeStats;

      // Insert new entries into store (batch)
      await db.scheduleEntry.createMany({
        data: newEntries.map((entry) => ({
          date: entry.date,
          dayName: entry.dayName,
          dayType: entry.dayType,
          empIdx: entry.empIdx,
          empName: entry.empName,
          empHrid: entry.empHrid,
          start: entry.start,
          end: entry.end,
          hours: entry.hours,
          offPerson: entry.offPerson,
          offPersonIdx: entry.offPersonIdx,
          offPersonHrid: entry.offPersonHrid,
          weekNum: entry.weekNum,
          isHoliday: entry.isHoliday ? 1 : 0,
          isManual: 0,
          monthKey,
        })),
      });

      // Record generated month
      if (!existingGenMonths.includes(monthKey)) {
        await db.generatedMonth.create({ data: { monthKey } });
      }

      return NextResponse.json({
        generated: newEntries.length,
        monthKey,
      });

    } else if (mode === "week") {
      if (!weekStart) {
        return NextResponse.json({ error: "weekStart date is required" }, { status: 400 });
      }

      const result = generateScheduleForWeek(weekStart, activeEmployees, settings, tempCumStats, existingEntries);
      newEntries = result.entries;
      newCumStats = result.cumulativeStats;

      const newDates = new Set(newEntries.map((e) => e.date));
      const newMonthKeys = new Set(newEntries.map((e) => e.date.substring(0, 7)));

      // Delete overlapping entries
      await db.scheduleEntry.deleteMany({
        where: {
          date: { in: Array.from(newDates) },
          isManual: false,
        },
      });

      // Insert new entries (batch)
      await db.scheduleEntry.createMany({
        data: newEntries.map((entry) => ({
          date: entry.date,
          dayName: entry.dayName,
          dayType: entry.dayType,
          empIdx: entry.empIdx,
          empName: entry.empName,
          empHrid: entry.empHrid,
          start: entry.start,
          end: entry.end,
          hours: entry.hours,
          offPerson: entry.offPerson,
          offPersonIdx: entry.offPersonIdx,
          offPersonHrid: entry.offPersonHrid,
          weekNum: entry.weekNum,
          isHoliday: entry.isHoliday ? 1 : 0,
          isManual: 0,
          monthKey: entry.date.substring(0, 7),
        })),
      });

      // Record generated months
      for (const mk of newMonthKeys) {
        if (!existingGenMonths.includes(mk)) {
          await db.generatedMonth.create({ data: { monthKey: mk } });
        }
      }

      return NextResponse.json({
        generated: newEntries.length,
      });
    } else {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
  } catch (error) {
    console.error("Error generating schedule:", error);
    const message = error instanceof Error ? error.message : "Failed to generate schedule";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: Clear all schedule entries for a month (ADMIN/EDITOR only)
export async function DELETE(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") return forbiddenResponse();

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month") || "";

    if (!month) {
      return NextResponse.json({ error: "month parameter is required" }, { status: 400 });
    }

    const deleted = await db.scheduleEntry.deleteByMonth(month);
    return NextResponse.json({ success: true, deleted: deleted.count });
  } catch (error) {
    console.error("Error clearing schedule:", error);
    return NextResponse.json({ error: "Failed to clear schedule" }, { status: 500 });
  }
}
