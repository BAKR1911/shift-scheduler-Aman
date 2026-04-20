export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse, isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: List connection team entries (NO region filtering - global workforce)
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const monthKey = searchParams.get("month") || "";
    const region = searchParams.get("region") || "";

    // NO region filtering for connection team - it's global
    const where: { monthKey?: string } = {};
    if (monthKey) where.monthKey = monthKey;

    const entries = await db.connectionTeam.findMany(
      Object.keys(where).length > 0 ? { where } : undefined
    );

    return NextResponse.json({ entries }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (error) {
    console.error("Error fetching connection team:", error);
    return NextResponse.json({ error: "Failed to fetch connection team" }, { status: 500 });
  }
}

// POST: Create connection team entry (admin/editor only)
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (!isAdmin(auth.role) && auth.role !== "editor") return forbiddenResponse();

  try {
    const body = await request.json();
    const { weekStart, weekEnd, empIdx, empName, empHrid, monthKey, region } = body;

    if (!weekStart || !weekEnd || empName === undefined) {
      return NextResponse.json({ error: "weekStart, weekEnd, and empName are required" }, { status: 400 });
    }

    // NO region override - connection team is global
    const entry = await db.connectionTeam.create({
      data: {
        weekStart,
        weekEnd,
        empIdx: empIdx || 0,
        empName: empName || "",
        empHrid: empHrid || "",
        monthKey: monthKey || "",
        region: region || "all",
      },
    });

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Error creating connection team entry:", error);
    return NextResponse.json({ error: "Failed to create connection team entry" }, { status: 500 });
  }
}

// DELETE: Clear connection team entries (admin/editor only)
// - ?id=X       → delete single entry by ID
// - ?monthKey=X  → delete all entries for a specific month
// - no params    → delete ALL entries (admin clear action)
export async function DELETE(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (!isAdmin(auth.role) && auth.role !== "editor") return forbiddenResponse();

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const monthKey = searchParams.get("monthKey");

    // Delete single entry by ID
    if (id) {
      await db.connectionTeam.delete({ where: { id: Number(id) } });
      return NextResponse.json({ success: true, deleted: 1 });
    }

    // Delete entries for a specific month
    if (monthKey) {
      const entries = await db.connectionTeam.findMany();
      const monthEntries = entries.filter(e => e.monthKey === monthKey);
      if (monthEntries.length > 0) {
        await db.connectionTeam.deleteByMonth(monthKey);
      }
      return NextResponse.json({ success: true, deleted: monthEntries.length });
    }

    // Delete ALL entries (admin clear action)
    const allEntries = await db.connectionTeam.findMany();
    const deletedCount = allEntries.length;
    for (const entry of allEntries) {
      await db.connectionTeam.delete({ where: { id: entry.id } });
    }
    return NextResponse.json({ success: true, deleted: deletedCount });
  } catch (error) {
    console.error("Error clearing connection team:", error);
    return NextResponse.json({ error: "Failed to clear connection team" }, { status: 500 });
  }
}
