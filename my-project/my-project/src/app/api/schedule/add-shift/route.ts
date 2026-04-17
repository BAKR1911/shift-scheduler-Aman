import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/auth";
import { db } from "@/lib/db";

// POST: Add a manual shift entry
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") return forbiddenResponse();

  try {
    const body = await request.json();
    const { date, empIdx, empName, empHrid, dayName, dayType, start, end, hours, weekNum, region } = body;

    // Determine effective region
    let effectiveRegion = region || "all";
    if (auth.region && auth.region !== "all") {
      effectiveRegion = auth.region;
    }

    if (!date || empIdx === undefined || !empName) {
      return NextResponse.json({ error: "date, empIdx, and empName are required" }, { status: 400 });
    }

    // Check if entry already exists for this region
    const existWhere: Record<string, unknown> = { date };
    if (effectiveRegion && effectiveRegion !== "all") {
      existWhere.region = effectiveRegion;
    }
    const existing = await db.scheduleEntry.findFirst({ where: existWhere });
    if (existing) {
      return NextResponse.json({ error: `An entry already exists for this date${effectiveRegion && effectiveRegion !== "all" ? ` in ${effectiveRegion}` : ""}` }, { status: 400 });
    }

    const entry = await db.scheduleEntry.create({
      data: {
        date,
        dayName: dayName || "",
        dayType: dayType || "Weekday",
        empIdx,
        empName,
        empHrid: empHrid || "",
        start: start || "",
        end: end || "",
        hours: hours || 0,
        offPerson: "Manual",
        offPersonIdx: -1,
        offPersonHrid: "",
        weekNum: weekNum || 0,
        isHoliday: false,
        isManual: true,
        monthKey: date.substring(0, 7),
        region: effectiveRegion,
      },
    });

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Error adding manual shift:", error);
    return NextResponse.json({ error: "Failed to add manual shift" }, { status: 500 });
  }
}
