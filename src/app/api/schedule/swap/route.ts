export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse, isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

// POST: Swap two employees' shifts for a given month
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (!isAdmin(auth.role) && auth.role !== "editor") return forbiddenResponse();

  try {
    const body = await request.json();
    const { empIdxA, empIdxB, monthKey, region } = body;

    if (empIdxA === undefined || empIdxB === undefined || !monthKey) {
      return NextResponse.json({ error: "empIdxA, empIdxB, and monthKey are required" }, { status: 400 });
    }

    // Determine effective region
    let effectiveRegion = region || "all";
    if (auth.region && auth.region !== "all") {
      effectiveRegion = auth.region;
    }

    // Get all entries for the month
    const whereClause: Record<string, unknown> = { date: { startsWith: monthKey } };
    if (effectiveRegion !== "all") {
      whereClause.region = effectiveRegion;
    }
    const entries = await db.scheduleEntry.findMany({
      where: whereClause,
      orderBy: { date: "asc" },
    });

    // Find the employee info for both indices
    const firstA = entries.find((e) => e.empIdx === empIdxA);
    const firstB = entries.find((e) => e.empIdx === empIdxB);

    if (!firstA || !firstB) {
      return NextResponse.json({ error: "Could not find employee entries for swap" }, { status: 400 });
    }

    let swapCount = 0;

    for (const entry of entries) {
      let needsUpdate = false;
      let newEmpIdx = entry.empIdx;
      let newEmpName = entry.empName;
      let newEmpHrid = entry.empHrid;
      let newOffIdx = entry.offPersonIdx;
      let newOffName = entry.offPerson;
      let newOffHrid = entry.offPersonHrid;

      // Swap working employee
      if (entry.empIdx === empIdxA) {
        newEmpIdx = empIdxB;
        newEmpName = firstB.empName;
        newEmpHrid = firstB.empHrid;
        needsUpdate = true;
      } else if (entry.empIdx === empIdxB) {
        newEmpIdx = empIdxA;
        newEmpName = firstA.empName;
        newEmpHrid = firstA.empHrid;
        needsUpdate = true;
      }

      // Swap OFF person
      if (entry.offPersonIdx === empIdxA) {
        newOffIdx = empIdxB;
        newOffName = firstB.empName;
        newOffHrid = firstB.empHrid;
        needsUpdate = true;
      } else if (entry.offPersonIdx === empIdxB) {
        newOffIdx = empIdxA;
        newOffName = firstA.empName;
        newOffHrid = firstA.empHrid;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await db.scheduleEntry.update({
          where: { id: entry.id },
          data: {
            empIdx: newEmpIdx,
            empName: newEmpName,
            empHrid: newEmpHrid,
            offPersonIdx: newOffIdx,
            offPerson: newOffName,
            offPersonHrid: newOffHrid,
          },
        });
        swapCount++;
      }
    }

    return NextResponse.json({ success: true, swapped: swapCount });
  } catch (error) {
    console.error("Error swapping employees:", error);
    return NextResponse.json({ error: "Failed to swap employees" }, { status: 500 });
  }
}
