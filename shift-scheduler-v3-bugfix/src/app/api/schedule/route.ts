import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/auth";
import { generateScheduleForMonth, generateScheduleForWeek, computeLocalStats, computeOffWeeks } from "@/lib/scheduler";
import type { Employee, Settings, ScheduleEntry, CumulativeStats } from "@/lib/scheduler";
import { db } from "@/lib/db";

// GET: Fetch schedule entries (optionally filtered by month and region)
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month") || "";
    const region = searchParams.get("region") || "";

    const whereClause: Record<string, unknown> = {};
    if (month) whereClause.date = { startsWith: month };

    const dbEntries = await db.scheduleEntry.findMany({
      where: whereClause,
      orderBy: { date: "asc" },
    });

    const genMonths = await db.generatedMonth.findMany({ orderBy: { monthKey: "asc" } });

    // Determine effective region filter
    let effectiveRegion = region;
    if (!effectiveRegion && auth.region && auth.region !== "all") {
      effectiveRegion = auth.region;
    }

    let filteredEntries = dbEntries.map((e) => ({
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
    }));

    // Auto-filter entries for non-admin users or when a specific region is requested
    if (effectiveRegion && effectiveRegion !== "all") {
      const allDbEmployees = await db.employee.findMany({ orderBy: { order: "asc" } });
      const regionEmpNames = new Set(allDbEmployees.filter((e) => e.region === effectiveRegion || e.region === "all").map((e) => e.name));
      filteredEntries = filteredEntries.filter((e) => regionEmpNames.has(e.empName));
    }

    return NextResponse.json({
      entries: filteredEntries,
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
    const { mode, year, month, weekStart, region } = body;

    if (!mode) {
      return NextResponse.json({ error: "Mode is required (week or month)" }, { status: 400 });
    }

    // Fetch employees and settings from store
    const dbEmployees = await db.employee.findMany({ orderBy: { order: "asc" } });
    const dbSettings = await db.settings.findUnique();

    // Filter employees by region if specified (include 'all' region employees everywhere)
    let regionDbEmployees = dbEmployees;
    if (region && region !== "all") {
      regionDbEmployees = dbEmployees.filter((e) => e.region === region || e.region === "all");
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
      return NextResponse.json({ error: "Need at least 2 active employees" }, { status: 400 });
    }

    // Build name-to-index map for the region's active employees
    const nameToRegionIdx = new Map<string, number>();
    activeEmployees.forEach((e, i) => nameToRegionIdx.set(e.name, i));

    // Fetch existing entries and generated months in parallel
    const [existingDbEntries, genMonths] = await Promise.all([
      db.scheduleEntry.findMany({ orderBy: { date: "asc" } }),
      db.generatedMonth.findMany({ orderBy: { monthKey: "asc" } }),
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

    // Helper: compute cumulative stats from entries (name-based)
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

    // Compute cumulative stats from ALL existing entries
    const allConverted = convertEntries(existingDbEntries.map(toEntry));
    const tempCumStats = computeCumStats(allConverted);

    let newEntries: ScheduleEntry[] = [];

    if (mode === "month") {
      if (!year || !month) {
        return NextResponse.json({ error: "Year and month are required" }, { status: 400 });
      }

      const monthKey = `${year}-${String(month).padStart(2, "0")}`;
      const regionEmpNames = new Set(activeEmployees.map((e) => e.name));

      // Delete existing non-manual entries for this month + region (batch operation)
      if (region && region !== "all") {
        const toDeleteIds = existingDbEntries
          .filter((e) => e.date.startsWith(monthKey) && !e.isManual && regionEmpNames.has(e.empName))
          .map((e) => e.id);
        if (toDeleteIds.length > 0) {
          await db.scheduleEntry.deleteByIds(toDeleteIds);
        }
      } else {
        await db.scheduleEntry.deleteMany({
          where: { date: { startsWith: monthKey }, isManual: false },
        });
      }

      // Compute remaining stats WITHOUT re-fetching from DB
      const remainingEntries = existingDbEntries
        .filter((e) => {
          if (region && region !== "all") {
            return !(e.date.startsWith(monthKey) && !e.isManual && regionEmpNames.has(e.empName));
          }
          return !(e.date.startsWith(monthKey) && !e.isManual);
        })
        .map(toEntry);
      const cleanCumStats = computeCumStats(convertEntries(remainingEntries));

      const result = generateScheduleForMonth(year, month, activeEmployees, settings, cleanCumStats, convertEntries(remainingEntries));
      newEntries = result.entries;

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

      const result = generateScheduleForWeek(weekStart, activeEmployees, settings, tempCumStats, allConverted);
      newEntries = result.entries;

      const newDates = new Set(newEntries.map((e) => e.date));
      const newMonthKeys = new Set(newEntries.map((e) => e.date.substring(0, 7)));

      // Delete overlapping entries — if region is specified, only delete for that region's employees (batch)
      if (region && region !== "all") {
        const regionEmpNames = new Set(activeEmployees.map((e) => e.name));
        const overlappingEntries = await db.scheduleEntry.findMany({
          where: { date: { in: Array.from(newDates) } },
        });
        const toDeleteIds = overlappingEntries
          .filter((entry) => !entry.isManual && regionEmpNames.has(entry.empName))
          .map((entry) => entry.id);
        if (toDeleteIds.length > 0) {
          await db.scheduleEntry.deleteByIds(toDeleteIds);
        }
      } else {
        await db.scheduleEntry.deleteMany({
          where: {
            date: { in: Array.from(newDates) },
            isManual: false,
          },
        });
      }

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
