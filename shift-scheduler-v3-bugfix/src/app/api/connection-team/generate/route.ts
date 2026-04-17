import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/auth";
import { db } from "@/lib/db";

// POST: Generate Connection Team schedule for a month (auto-balanced rotation)
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { monthKey, weeks } = body;

    if (!monthKey || !weeks || !Array.isArray(weeks)) {
      return NextResponse.json({ error: "monthKey and weeks are required" }, { status: 400 });
    }

    // Fetch all connection team employees
    const allEmployees = await db.employee.findMany({ orderBy: { order: "asc" } });
    const connectionEmps = allEmployees.filter((e) => e.teamType === "connection" && e.active);

    if (connectionEmps.length === 0) {
      return NextResponse.json({ error: "No active Connection Team employees found" }, { status: 400 });
    }

    // Clear existing connection team entries for this month
    const existingEntries = await db.connectionTeam.findMany();
    const entriesToDelete = existingEntries.filter((e) => e.monthKey === monthKey);

    if (entriesToDelete.length > 0) {
      for (const entry of entriesToDelete) {
        await db.connectionTeam.delete({ where: { id: entry.id } });
      }
    }

    // Generate balanced rotation algorithm
    // Each employee gets approximately equal number of weeks
    const empAssignments: Record<string, number> = {};
    connectionEmps.forEach((e) => { empAssignments[e.name] = 0; });

    const newEntries: {
      empIdx: number;
      empName: string;
      empHrid: string;
      weekStart: string;
      weekEnd: string;
      monthKey: string;
    }[] = [];

    // Assign employees to weeks using round-robin with balance consideration
    weeks.forEach((week) => {
      // Find employee with minimum assignments
      const minAssignments = Math.min(...Object.values(empAssignments));
      const candidates = connectionEmps.filter((e) => empAssignments[e.name] === minAssignments);

      // Pick random from candidates (or first if only one)
      const selectedEmp = candidates[Math.floor(Math.random() * candidates.length)];

      newEntries.push({
        empIdx: connectionEmps.indexOf(selectedEmp),
        empName: selectedEmp.name,
        empHrid: selectedEmp.hrid,
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        monthKey,
      });

      // Increment assignment count
      empAssignments[selectedEmp.name]++;
    });

    // Insert new entries
    let created = 0;
    for (const entry of newEntries) {
      try {
        await db.connectionTeam.create({ data: entry });
        created++;
      } catch (e) {
        console.error(`[Connection Team Gen] Failed to create entry for week ${entry.weekStart}:`, e);
      }
    }

    console.log(`[Connection Team Gen] Generated ${created} entries for month ${monthKey}`);
    console.log(`[Connection Team Gen] Assignments:`, empAssignments);

    return NextResponse.json({
      success: true,
      generated: created,
      assignments: empAssignments,
    });
  } catch (error) {
    console.error("Error generating Connection Team schedule:", error);
    return NextResponse.json({ error: "Failed to generate schedule" }, { status: 500 });
  }
}
