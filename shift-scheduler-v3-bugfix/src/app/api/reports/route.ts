import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse } from "@/lib/auth";
import { computeLocalStats, computeOffWeeks } from "@/lib/scheduler";
import type { ScheduleEntry } from "@/lib/scheduler";
import { db } from "@/lib/db";

// GET: Get stats/report data (in-memory store backed)
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month") || "";
    const regionParam = searchParams.get("region") || "";

    // Determine effective region for filtering
    let effectiveRegion = regionParam;
    if (!effectiveRegion && auth.region && auth.region !== "all") {
      effectiveRegion = auth.region;
    }

    // Fetch employees (filter by region for non-admin users)
    let dbEmployees = await db.employee.findMany({ orderBy: { order: "asc" } });
    if (effectiveRegion && effectiveRegion !== "all") {
      dbEmployees = dbEmployees.filter((e) => e.region === effectiveRegion || e.region === "all");
    }
    const employees = dbEmployees.filter((e) => e.active);

    // Fetch entries
    const whereClause: Record<string, unknown> = {};
    if (month) whereClause.date = { startsWith: month };

    let dbEntries = await db.scheduleEntry.findMany({
      where: whereClause,
      orderBy: { date: "asc" },
    });

    // Filter entries by region if needed
    if (effectiveRegion && effectiveRegion !== "all") {
      const regionEmpNames = new Set(dbEmployees.map((e) => e.name));
      dbEntries = dbEntries.filter((e) => regionEmpNames.has(e.empName));
    }

    const entries: ScheduleEntry[] = dbEntries.map((e) => ({
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

    const n = employees.length;
    const localStats = computeLocalStats(entries, n);
    const offWeeksMap = computeOffWeeks(entries, n);

    // Compute balance
    const allHours = employees.map((_, i) => localStats[i]?.hours || 0);
    const maxH = Math.max(...allHours, 0);
    const minH = Math.min(...allHours, 0);
    const avg = n > 0 ? allHours.reduce((a, b) => a + b, 0) / n : 0;
    const variance = maxH - minH;
    const avgAbsDeviation = n > 0
      ? Math.round(allHours.reduce((sum, h) => sum + Math.abs(h - avg), 0) / n * 10) / 10
      : 0;

    // Per-employee stats
    const employeeStats = employees.map((emp, i) => ({
      id: emp.id,
      name: emp.name,
      hrid: emp.hrid,
      days: localStats[i]?.days || 0,
      hours: Math.round((localStats[i]?.hours || 0) * 10) / 10,
      weekend: localStats[i]?.weekend || 0,
      sat: localStats[i]?.sat || 0,
      fri: localStats[i]?.fri || 0,
      offWeeks: offWeeksMap[i] || 0,
    }));

    return NextResponse.json({
      localStats: employeeStats,
      balance: {
        status: variance <= 10 ? "green" : variance <= 25 ? "yellow" : "red",
        variance: Math.round(variance * 10) / 10,
        average: Math.round(avg * 10) / 10,
        avgAbsDeviation,
        max: Math.round(maxH * 10) / 10,
        min: Math.round(minH * 10) / 10,
      },
      totalHours: entries.reduce((s, e) => s + e.hours, 0),
      totalDays: entries.length,
      totalHolidays: entries.filter((e) => e.isHoliday).length,
    });
  } catch (error) {
    console.error("Error fetching reports:", error);
    return NextResponse.json({ error: "Failed to fetch reports" }, { status: 500 });
  }
}
