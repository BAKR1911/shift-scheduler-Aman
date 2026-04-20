import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse, isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: List region rotation entries
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const monthKey = searchParams.get("month") || "";

    const entries = await db.regionRotation.findMany(
      monthKey ? { where: { monthKey } } : undefined
    );

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Error fetching region rotation:", error);
    return NextResponse.json({ error: "Failed to fetch region rotation" }, { status: 500 });
  }
}

// POST: Create region rotation entry (admin only)
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (!isAdmin(auth.role)) return forbiddenResponse();

  try {
    const body = await request.json();
    const { region, targetArea, weekStart, weekEnd, monthKey, notes } = body;

    if (!region || !targetArea || !weekStart || !weekEnd) {
      return NextResponse.json({ error: "region, targetArea, weekStart, and weekEnd are required" }, { status: 400 });
    }

    const entry = await db.regionRotation.create({
      data: {
        region,
        targetArea,
        weekStart,
        weekEnd,
        monthKey: monthKey || "",
        notes: notes || "",
      },
    });

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Error creating region rotation entry:", error);
    return NextResponse.json({ error: "Failed to create region rotation entry" }, { status: 500 });
  }
}

// PUT: Update region rotation entry (admin only)
export async function PUT(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (!isAdmin(auth.role)) return forbiddenResponse();

  try {
    const body = await request.json();
    const { id, region, targetArea, weekStart, weekEnd, notes } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const data: Record<string, string> = {};
    if (region !== undefined) data.region = region;
    if (targetArea !== undefined) data.targetArea = targetArea;
    if (weekStart !== undefined) data.weekStart = weekStart;
    if (weekEnd !== undefined) data.weekEnd = weekEnd;
    if (notes !== undefined) data.notes = notes;

    await db.regionRotation.update({ where: { id }, data });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating region rotation entry:", error);
    return NextResponse.json({ error: "Failed to update region rotation entry" }, { status: 500 });
  }
}

// DELETE: Delete region rotation entry (admin only)
export async function DELETE(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (!isAdmin(auth.role)) return forbiddenResponse();

  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get("id"));

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await db.regionRotation.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting region rotation entry:", error);
    return NextResponse.json({ error: "Failed to delete region rotation entry" }, { status: 500 });
  }
}
