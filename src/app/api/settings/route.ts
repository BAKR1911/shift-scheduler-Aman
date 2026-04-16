import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/auth";
import { db } from "@/lib/db";
import { recalcScheduleHours } from "@/lib/scheduler";

// GET: Get current settings
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const settings = await db.settings.findUnique();

    if (!settings) {
      const defaultShifts = {
        Weekday: { start: "05:00 PM", end: "10:00 PM", hours: 5 },
        Thursday: { start: "05:00 PM", end: "10:00 PM", hours: 5 },
        Friday: { start: "01:00 PM", end: "10:00 PM", hours: 9 },
        Saturday: { start: "01:00 PM", end: "10:00 PM", hours: 9 },
        Holiday: { start: "10:00 AM", end: "10:00 PM", hours: 12 },
      };

      return NextResponse.json({
        shifts: defaultShifts,
        weekStart: "Friday",
        holidays: [],
        summerTime: false,
        summerShifts: {
          Weekday: { start: "05:00 PM", end: "11:00 PM", hours: 6 },
          Thursday: { start: "05:00 PM", end: "11:00 PM", hours: 6 },
          Friday: { start: "01:00 PM", end: "11:00 PM", hours: 10 },
          Saturday: { start: "01:00 PM", end: "11:00 PM", hours: 10 },
        },
        dayHours: {},
      });
    }

    return NextResponse.json({
      shifts: JSON.parse(settings.shifts),
      weekStart: settings.weekStart,
      holidays: JSON.parse(settings.holidays),
      summerTime: settings.summerTime,
      summerShifts: JSON.parse(settings.summerShifts),
      dayHours: JSON.parse(settings.dayHours || "{}"),
    });
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

// POST: Update settings (ADMIN/EDITOR only)
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") return forbiddenResponse();

  try {
    const body = await request.json();
    const { shifts, weekStart, holidays, summerTime, summerShifts, dayHours } = body;

    const result = await db.settings.upsert({
      where: { id: 1 },
      update: {
        shifts: JSON.stringify(shifts),
        weekStart: weekStart || "Friday",
        holidays: JSON.stringify(holidays || []),
        summerTime: summerTime || false,
        summerShifts: JSON.stringify(summerShifts || {}),
        dayHours: JSON.stringify(dayHours || {}),
      },
      create: {
        id: 1,
        shifts: JSON.stringify(shifts),
        weekStart: weekStart || "Friday",
        holidays: JSON.stringify(holidays || []),
        summerTime: summerTime || false,
        summerShifts: JSON.stringify(summerShifts || {}),
        dayHours: JSON.stringify(dayHours || {}),
      },
    });

    // Recalculate all schedule entries with new settings
    const allDbEntries = await db.scheduleEntry.findAll();
    if (allDbEntries.length > 0) {
      const settingsObj: import("@/lib/scheduler").Settings = {
        shifts: JSON.parse(result.shifts),
        weekStart: result.weekStart,
        holidays: JSON.parse(result.holidays),
        summerTime: result.summerTime,
        summerShifts: JSON.parse(result.summerShifts),
        dayHours: JSON.parse(result.dayHours || "{}"),
      };

      const schedulerEntries: import("@/lib/scheduler").ScheduleEntry[] = allDbEntries.map(e => ({
        date: e.date, dayName: e.dayName, dayType: e.dayType,
        empIdx: e.empIdx, empName: e.empName, empHrid: e.empHrid,
        start: e.start, end: e.end, hours: e.hours,
        offPerson: e.offPerson, offPersonIdx: e.offPersonIdx, offPersonHrid: e.offPersonHrid,
        weekNum: e.weekNum, isHoliday: e.isHoliday, isManual: e.isManual,
      }));

      const recalced = recalcScheduleHours(schedulerEntries, settingsObj);

      const batchUpdates: Array<{id: number, start: string, end: string, hours: number}> = [];
      for (let i = 0; i < recalced.length; i++) {
        const re = recalced[i];
        const orig = allDbEntries[i];
        if (re.start !== orig.start || re.end !== orig.end || re.hours !== orig.hours) {
          batchUpdates.push({ id: orig.id, start: re.start, end: re.end, hours: re.hours });
        }
      }

      if (batchUpdates.length > 0) {
        await db.scheduleEntry.updateHoursBatch(batchUpdates);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
