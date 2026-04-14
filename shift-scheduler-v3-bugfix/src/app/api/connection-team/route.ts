import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: List connection team entries (region-filtered)
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const monthKey = searchParams.get("month") || "";
    const region = searchParams.get("region") || "";

    // Determine effective region
    let effectiveRegion = region;
    if (!effectiveRegion && auth.region && auth.region !== "all") {
      effectiveRegion = auth.region;
    }

    const where: { monthKey?: string; region?: string } = {};
    if (monthKey) where.monthKey = monthKey;
    if (effectiveRegion && effectiveRegion !== "all") where.region = effectiveRegion;

    const entries = await db.connectionTeam.findMany(
      Object.keys(where).length > 0 ? { where } : undefined
    );

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Error fetching connection team:", error);
    return NextResponse.json({ error: "Failed to fetch connection team" }, { status: 500 });
  }
}

// POST: Create connection team entry (admin/editor only) — with region
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") return forbiddenResponse();

  try {
    const body = await request.json();
    const { weekStart, weekEnd, empIdx, empName, empHrid, monthKey, region } = body;

    if (!weekStart || !weekEnd || empName === undefined) {
      return NextResponse.json({ error: "weekStart, weekEnd, and empName are required" }, { status: 400 });
    }

    // Determine effective region
    let effectiveRegion = region || "all";
    if (auth.region && auth.region !== "all") {
      effectiveRegion = auth.region;
    }

    const entry = await db.connectionTeam.create({
      data: {
        weekStart,
        weekEnd,
        empIdx: empIdx || 0,
        empName: empName || "",
        empHrid: empHrid || "",
        monthKey: monthKey || "",
        region: effectiveRegion,
      },
    });

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Error creating connection team entry:", error);
    return NextResponse.json({ error: "Failed to create connection team entry" }, { status: 500 });
  }
}

// DELETE: Remove connection team entry (admin only)
export async function DELETE(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin") return forbiddenResponse();

  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get("id"));

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await db.connectionTeam.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting connection team entry:", error);
    return NextResponse.json({ error: "Failed to delete connection team entry" }, { status: 500 });
  }
}
