import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/auth";
import { generateScheduleForMonth, generateScheduleForWeek, computeLocalStats, computeOffWeeks } from "@/lib/scheduler";
import type { Employee, Settings, ScheduleEntry, CumulativeStats } from "@/lib/scheduler";
import { db } from "@/lib/db";

// GET: Fetch schedule entries filtered by month and region
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month") || "";
    const region = searchParams.get("region") || "";

    // Determine effective region filter
    let effectiveRegion = region;
    if (!effectiveRegion && auth.region && auth.region !== "all") {
      effectiveRegion = auth.region;
    }

    // Build WHERE clause — filter by region column directly for bulletproof isolation
    const whereClause: Record<string, unknown> = {};
    if (month) whereClause.date = { startsWith: month };
    if (effectiveRegion && effectiveRegion !== "all") {
      whereClause.region = effectiveRegion;
    }

    const dbEntries = await db.scheduleEntry.findMany({
      where: whereClause,
      orderBy: { date: "asc" },
    });

    const genMonthsWhere: Record<string, unknown> = {};
    if (effectiveRegion && effectiveRegion !== "all") {
      genMonthsWhere.region = effectiveRegion;
    }
    const genMonths = await db.generatedMonth.findMany({ where: genMonthsWhere, orderBy: { monthKey: "asc" } });

    const filteredEntries = dbEntries.map((e) => ({
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
      region: e.region,
    }));

    return NextResponse.json({
      entries: filteredEntries,
      generatedMonths: genMonths.map((g) => g.monthKey),
    });
  } catch (error) {
    console.error("Error fetching schedule entries:", error);
    return NextResponse.json({ error: "Failed to fetch entries" }, { status: 500 });
  }
}

// POST: Generate schedule — fully region-isolated
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") return forbiddenResponse();

  try {
    const body = await request.json();
    const { mode, year, month, weekStart, region } = body;

    if (!mode) {
      return NextResponse.json({ error: "Mode is required (week or month)" }, { status: 400 });
    }

    // Determine effective region
    let effectiveRegion = region || "all";
    if (auth.region && auth.region !== "all") {
      effectiveRegion = auth.region;
    }

    // Fetch employees and settings from store
    const dbEmployees = await db.employee.findMany({ orderBy: { order: "asc" } });
    const dbSettings = await db.settings.findUnique();

    // STRICT region filter — employees must match the selected region exactly
    let regionDbEmployees = dbEmployees;
    if (effectiveRegion !== "all") {
      regionDbEmployees = dbEmployees.filter((e) => e.region === effectiveRegion);
      if (regionDbEmployees.length === 0) {
        return NextResponse.json({ error: `No employees found for region: ${effectiveRegion}. Please assign employees to this region first.` }, { status: 400 });
      }
    }

    const employees: Employee[] = regionDbEmployees.map((e) => ({
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
      return NextResponse.json({ error: "Need at least 2 active employees in this region" }, { status: 400 });
    }

    // Build name-to-index map for the region's active employees
    const nameToRegionIdx = new Map<string, number>();
    activeEmployees.forEach((e, i) => nameToRegionIdx.set(e.name, i));

    // Fetch ONLY this region's existing entries for cumulative stats — fully isolated
    const regionWhereClause: Record<string, unknown> = {};
    if (effectiveRegion !== "all") {
      regionWhereClause.region = effectiveRegion;
    }
    const genMonthsWhere: Record<string, unknown> = {};
    if (effectiveRegion !== "all") {
      genMonthsWhere.region = effectiveRegion;
    }
    const [existingDbEntries, genMonths] = await Promise.all([
      db.scheduleEntry.findMany({ where: regionWhereClause, orderBy: { date: "asc" } }),
      db.generatedMonth.findMany({ where: genMonthsWhere, orderBy: { monthKey: "asc" } }),
    ]);
    const existingGenMonths = genMonths.map((g) => g.monthKey);

    // Helper: convert DB entry to ScheduleEntry
    const toEntry = (e: typeof existingDbEntries[0]): ScheduleEntry => ({
      date: e.date, dayName: e.dayName, dayType: e.dayType,
      empIdx: e.empIdx, empName: e.empName, empHrid: e.empHrid,
      start: e.start, end: e.end, hours: e.hours,
      offPerson: e.offPerson, offPersonIdx: e.offPersonIdx, offPersonHrid: e.offPersonHrid,
      weekNum: e.weekNum, isHoliday: Boolean(e.isHoliday), isManual: Boolean(e.isManual),
    });

    // Helper: compute cumulative stats from entries (name-based, region-scoped)
    function computeCumStats(entries: ScheduleEntry[]): Record<number, CumulativeStats> {
      const stats: Record<number, CumulativeStats> = {};
      for (let i = 0; i < activeEmployees.length; i++) {
        stats[i] = { totalHours: 0, totalDays: 0, weekendDays: 0, saturdays: 0, fridays: 0, offWeeks: 0 };
      }
      const seen = new Set<string>();
      for (const e of entries) {
        if (e.isManual) continue;
        const idx = nameToRegionIdx.get(e.empName);
        if (idx === undefined) continue;
        stats[idx].totalHours += e.hours;
        stats[idx].totalDays += 1;
        if (e.dayType === "Saturday" || e.dayType === "Friday") stats[idx].weekendDays += 1;
        if (e.dayType === "Saturday") stats[idx].saturdays += 1;
        if (e.dayType === "Friday") stats[idx].fridays += 1;
        // Off weeks
        const key = `${e.date.substring(0, 7)}-W${e.weekNum}`;
        const offIdx = nameToRegionIdx.get(e.offPerson);
        if (offIdx !== undefined) {
          const fullKey = `${key}-${offIdx}`;
          if (!seen.has(fullKey)) { seen.add(fullKey); stats[offIdx].offWeeks += 1; }
        }
      }
      return stats;
    }

    // Helper: convert entries to use region's employee indices
    function convertEntries(entries: ScheduleEntry[]): ScheduleEntry[] {
      return entries.filter((e) => {
        const ei = nameToRegionIdx.get(e.empName);
        const oi = nameToRegionIdx.get(e.offPerson);
        return ei !== undefined && oi !== undefined;
      }).map((e) => ({
        ...e,
        empIdx: nameToRegionIdx.get(e.empName)!,
        offPersonIdx: nameToRegionIdx.get(e.offPerson)!,
      }));
    }

    // Compute cumulative stats from ONLY this region's existing entries
    const allConverted = convertEntries(existingDbEntries.map(toEntry));
    const tempCumStats = computeCumStats(allConverted);

    let newEntries: ScheduleEntry[] = [];

    if (mode === "month") {
      if (!year || !month) {
        return NextResponse.json({ error: "Year and month are required" }, { status: 400 });
      }

      const monthKey = `${year}-${String(month).padStart(2, "0")}`;

      // Delete existing non-manual entries for this month + region using DB region column
      const deleteWhere: Record<string, unknown> = {
        date: { startsWith: monthKey },
        isManual: false,
      };
      if (effectiveRegion !== "all") {
        deleteWhere.region = effectiveRegion;
      }
      await db.scheduleEntry.deleteMany({ where: deleteWhere });

      // Compute remaining stats WITHOUT re-fetching from DB
      const remainingEntries = existingDbEntries
        .filter((e) => !(e.date.startsWith(monthKey) && !e.isManual))
        .map(toEntry);
      const cleanCumStats = computeCumStats(convertEntries(remainingEntries));

      const result = generateScheduleForMonth(year, month, activeEmployees, settings, cleanCumStats, convertEntries(remainingEntries));
      newEntries = result.entries;

      // Insert new entries into store with region tag
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
          region: effectiveRegion,
        })),
      });

      // Record generated month
      if (!existingGenMonths.includes(monthKey)) {
        await db.generatedMonth.create({ data: { monthKey, region: effectiveRegion } });
      }

      return NextResponse.json({
        generated: newEntries.length,
        monthKey,
        region: effectiveRegion,
      });

    } else if (mode === "week") {
      if (!weekStart) {
        return NextResponse.json({ error: "weekStart date is required" }, { status: 400 });
      }

      const result = generateScheduleForWeek(weekStart, activeEmployees, settings, tempCumStats, allConverted);
      newEntries = result.entries;

      const newDates = new Set(newEntries.map((e) => e.date));
      const newMonthKeys = new Set(newEntries.map((e) => e.date.substring(0, 7)));

      // Delete overlapping entries using DB region column
      const overlapDeleteWhere: Record<string, unknown> = {
        date: { in: Array.from(newDates) },
        isManual: false,
      };
      if (effectiveRegion !== "all") {
        overlapDeleteWhere.region = effectiveRegion;
      }
      await db.scheduleEntry.deleteMany({ where: overlapDeleteWhere });

      // Insert new entries with region tag
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
          region: effectiveRegion,
        })),
      });

      // Record generated months
      for (const mk of newMonthKeys) {
        if (!existingGenMonths.includes(mk)) {
          await db.generatedMonth.create({ data: { monthKey: mk, region: effectiveRegion } });
        }
      }

      return NextResponse.json({
        generated: newEntries.length,
        region: effectiveRegion,
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

// DELETE: Clear schedule entries for a month (respects region)
export async function DELETE(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") return forbiddenResponse();

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month") || "";
    const region = searchParams.get("region") || "";

    if (!month) {
      return NextResponse.json({ error: "month parameter is required" }, { status: 400 });
    }

    // Determine effective region for deletion
    let deleteRegion = region || "";
    if (!deleteRegion && auth.region && auth.region !== "all") {
      deleteRegion = auth.region;
    }

    // ALWAYS delete by region — strict isolation
    if (deleteRegion && deleteRegion !== "all") {
      const entries = await db.scheduleEntry.findMany({
        where: { date: { startsWith: month }, region: deleteRegion },
      });
      const ids = entries.map((e) => e.id);
      if (ids.length > 0) {
        await db.scheduleEntry.deleteByIds(ids);
      }
      await db.generatedMonth.deleteByMonthAndRegion(month, deleteRegion);
      return NextResponse.json({ success: true, deleted: ids.length });
    }

    // Admin with region=all can clear all regions
    const deleted = await db.scheduleEntry.deleteByMonth(month);
    await db.generatedMonth.deleteByMonth(month);
    return NextResponse.json({ success: true, deleted: deleted.count });
  } catch (error) {
    console.error("Error clearing schedule:", error);
    return NextResponse.json({ error: "Failed to clear schedule" }, { status: 500 });
  }
}
