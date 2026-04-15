import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: Fetch connection assignments and optional totals
//   ?month=2026-04          → monthly totals per employee
//   ?week=2026-04-04        → weekly totals per employee
//   ?month=2026-04&totals   → entries + monthly totals
//   (no params)             → all entries
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const monthKey = searchParams.get("month") || "";
    const weekStart = searchParams.get("week") || "";
    const employeeId = searchParams.get("employeeId");
    const totalsOnly = searchParams.get("totals") === "true";

    // Fetch entries
    const where: { weekStart?: string; employeeId?: number; regionCovered?: string; date?: string } = {};
    if (weekStart) where.weekStart = weekStart;
    if (employeeId) where.employeeId = Number(employeeId);
    if (monthKey && !weekStart) where.date = monthKey;

    let entries = await db.connectionAssignment.findMany(
      Object.keys(where).length > 0 ? { where } : undefined
    );

    // Non-admin with a region: filter entries by their region assignment
    if (auth.role !== "admin" && auth.region && auth.region !== "all") {
      entries = entries.filter((e) => e.regionCovered === auth.region);
    }

    // If totalsOnly or both month/week requested, compute per-employee totals
    if (totalsOnly || monthKey || weekStart) {
      // Get distinct employee IDs from the filtered entries
      const empIds = [...new Set(entries.map((e) => e.employeeId))];

      // Compute totals for each employee
      const perEmployee = await Promise.all(
        empIds.map(async (eid) => {
          const weekly = weekStart
            ? await db.connectionAssignment.getTotals({ employeeId: eid, weekStart })
            : null;
          const monthly = monthKey
            ? await db.connectionAssignment.getTotals({ employeeId: eid, monthKey })
            : null;
          return { employeeId: eid, weekly, monthly };
        })
      );

      if (totalsOnly) {
        return NextResponse.json({ totals: perEmployee });
      }

      return NextResponse.json({ entries, totals: perEmployee });
    }

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Error fetching connection assignments:", error);
    return NextResponse.json({ error: "Failed to fetch connection assignments" }, { status: 500 });
  }
}

// POST: Create a connection assignment (admin/editor only)
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { employeeId, date, weekStart, regionCovered, hours, overrideHours } = body;

    if (!employeeId || !date) {
      return NextResponse.json({ error: "employeeId and date are required" }, { status: 400 });
    }

    const entry = await db.connectionAssignment.create({
      data: {
        employeeId,
        date,
        weekStart: weekStart || "",
        regionCovered: regionCovered || "",
        hours: hours || 0,
        overrideHours: overrideHours || 0,
      },
    });

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Error creating connection assignment:", error);
    return NextResponse.json({ error: "Failed to create connection assignment" }, { status: 500 });
  }
}

// PUT: Update a connection assignment (admin/editor only)
export async function PUT(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, ...data } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await db.connectionAssignment.update({
      where: { id },
      data,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating connection assignment:", error);
    return NextResponse.json({ error: "Failed to update connection assignment" }, { status: 500 });
  }
}

// DELETE: Remove a connection assignment (admin only)
export async function DELETE(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get("id"));

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await db.connectionAssignment.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting connection assignment:", error);
    return NextResponse.json({ error: "Failed to delete connection assignment" }, { status: 500 });
  }
}
