export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildWeeksForMonth } from "@/lib/weeks";

// GET /api/weeks?monthKey=YYYY-MM
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const monthKey = searchParams.get("monthKey") || "";
    if (!monthKey) {
      return NextResponse.json({ error: "monthKey is required (YYYY-MM)" }, { status: 400 });
    }

    const dbSettings = await db.settings.findUnique();
    const settings = {
      weekStart: dbSettings?.weekStart || "Friday",
      monthStartMode: (dbSettings as any)?.monthStartMode || "weekStartAligned",
    };

    const weeks = buildWeeksForMonth(monthKey, settings);
    return NextResponse.json({ monthKey, settings, weeks }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[Weeks API] Error:", e);
    return NextResponse.json({ error: "Failed to compute weeks" }, { status: 500 });
  }
}

