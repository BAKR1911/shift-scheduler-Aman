export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth, isAdmin } from "@/lib/auth";
import { generateConnectionTeamSchedule } from "@/lib/scheduler";
import { db } from "@/lib/db";

// POST: Generate Connection Team schedule for a month (Target-Based Balancing)
// Supports `force: true` to regenerate already-generated months
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(auth.role) && auth.role !== "editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { monthKey, weeks, force } = body;

    if (!monthKey || !weeks || !Array.isArray(weeks)) {
      return NextResponse.json({ error: "monthKey and weeks are required" }, { status: 400 });
    }

    // === PROTECTION: Don't regenerate already-generated months ===
    const existingEntries = await db.connectionTeam.findMany();
    const existingForMonth = existingEntries.filter((e) => e.monthKey === monthKey);

    if (!force && existingForMonth.length > 0) {
      console.log(`[ConnectionTeamGen] Month "${monthKey}" already has ${existingForMonth.length} entries. Use force=true to regenerate.`);
      return NextResponse.json({
        alreadyGenerated: true,
        message: `Connection Team schedule for ${monthKey} already exists. Use "Regenerate" to overwrite.`,
        generated: 0,
        assignments: {},
      });
    }

    // Fetch all connection team employees
    const allEmployees = await db.employee.findMany({ orderBy: { order: "asc" } });
    const connectionEmps = allEmployees.filter((e) => e.teamType === "connection" && e.active);

    if (connectionEmps.length === 0) {
      return NextResponse.json({ error: "No active Connection Team employees found" }, { status: 400 });
    }

    // Clear existing connection team entries for this month (only when force=true or first time)
    if (existingForMonth.length > 0) {
      for (const entry of existingForMonth) {
        await db.connectionTeam.delete({ where: { id: entry.id } });
      }
    }

    // Calculate cumulative connection weeks for each employee (from previous months)
    const cumWeeks: Record<string, number> = {};
    connectionEmps.forEach((e) => { cumWeeks[e.name] = 0; });
    const prevMonthEntries = existingEntries.filter((e) => e.monthKey !== monthKey);
    for (const entry of prevMonthEntries) {
      if (cumWeeks[entry.empName] !== undefined) {
        cumWeeks[entry.empName]++;
      }
    }

    // Calculate HelpDesk hours for each connection employee (for load balancing)
    const hdHours: Record<string, number> = {};
    connectionEmps.forEach((e) => { hdHours[e.name] = 0; });
    const allScheduleEntries = await db.scheduleEntry.findMany();
    for (const entry of allScheduleEntries) {
      if (hdHours[entry.empName] !== undefined) {
        hdHours[entry.empName] += entry.hours;
      }
    }

    // Use the new Target-Based scheduler
    const employees = connectionEmps.map((e) => ({
      id: e.id,
      name: e.name,
      hrid: e.hrid,
      active: true,
    }));

    const newEntries = generateConnectionTeamSchedule(weeks, employees, cumWeeks, hdHours);

    // Insert new entries
    let created = 0;
    for (const entry of newEntries) {
      try {
        await db.connectionTeam.create({
          data: {
            empIdx: entry.empIdx,
            empName: entry.empName,
            empHrid: entry.empHrid,
            weekStart: entry.weekStart,
            weekEnd: entry.weekEnd,
            monthKey,
          },
        });
        created++;
      } catch (e) {
        console.error(`[ConnectionTeamGen] Failed to create entry for week ${entry.weekStart}:`, e);
      }
    }

    // Compute assignments summary
    const assignments: Record<string, number> = {};
    connectionEmps.forEach((e) => { assignments[e.name] = 0; });
    for (const entry of newEntries) {
      assignments[entry.empName]++;
    }

    console.log(`[ConnectionTeamGen] Generated ${created} entries for month ${monthKey}`);
    console.log(`[ConnectionTeamGen] Assignments:`, assignments);
    console.log(`[ConnectionTeamGen] HelpDesk hours considered:`, hdHours);

    return NextResponse.json({
      success: true,
      generated: created,
      assignments,
    });
  } catch (error) {
    console.error("Error generating Connection Team schedule:", error);
    return NextResponse.json({ error: "Failed to generate schedule" }, { status: 500 });
  }
}
