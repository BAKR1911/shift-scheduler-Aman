export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: Return recent activity from schedule_entries (last 20 entries ordered by created_at desc)
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const client = (db as unknown as { _getClient?: () => { execute: (q: unknown) => Promise<unknown> } })._getClient?.();
    
    // Query recent entries from generated_months as generation events and recent schedule_entries
    const genMonthsResult = await (db as unknown as { _rawQuery: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }).scheduleEntry?.findMany?.({
      orderBy: { date: "desc" },
    });

    // Use the db layer to get recent schedule entries
    // We'll fetch from both generated_months and schedule_entries
    type GenMonth = { id: number; monthKey: string; region: string; createdAt: string };
    type ScheduleEntry = { id: number; date: string; empName: string; empHrid: string; isManual: boolean; monthKey: string; region: string; createdAt: string; isHoliday: boolean; dayName: string };

    const recentEntries = await db.scheduleEntry.findMany({
      orderBy: { createdAt: "desc" },
    });

    const generatedMonths = await db.generatedMonth.findMany({
      orderBy: { createdAt: "desc" },
    });

    // Build activity feed from generated months, manual entries, and holidays
    interface ActivityItem {
      id: string;
      type: "generated" | "manual" | "holiday_toggled" | "holiday_added";
      description: string;
      employeeName: string;
      date: string;
      region: string;
      createdAt: string;
    }

    const activities: ActivityItem[] = [];

    // Add generation events (richer description with region)
    for (const gm of generatedMonths.slice(0, 10)) {
      activities.push({
        id: `gen-${gm.id}`,
        type: "generated",
        description: `📅 Schedule generated for ${formatMonth(gm.monthKey)}${gm.region && gm.region !== "all" ? ` (${gm.region})` : ""}`,
        employeeName: "System",
        date: gm.monthKey,
        region: gm.region,
        createdAt: gm.createdAt,
      });
    }

    // Add manual entry events (with date context)
    for (const entry of recentEntries) {
      if (entry.isManual) {
        activities.push({
          id: `manual-${entry.id}`,
          type: "manual",
          description: `➕ Manual shift assigned to ${entry.empName} on ${formatDate(entry.date)}`,
          employeeName: entry.empName,
          date: entry.date,
          region: entry.region,
          createdAt: entry.createdAt,
        });
      }
    }

    // Add holiday toggle events (entries marked as holiday)
    for (const entry of recentEntries) {
      if (entry.isHoliday && !entry.isManual) {
        activities.push({
          id: `holiday-${entry.id}`,
          type: "holiday_toggled",
          description: `🏖️ Holiday marked for ${entry.empName} on ${formatDate(entry.date)}`,
          employeeName: entry.empName,
          date: entry.date,
          region: entry.region,
          createdAt: entry.createdAt,
        });
      }
    }

    // Add recently added holiday entries from settings
    try {
      const settings = await db.settings.findUnique();
      if (settings) {
        const holidays = settings.holidays as Array<{ date: string; name: string; hours?: number }>;
        if (holidays && holidays.length > 0) {
          // Show the 5 most recently added holidays
          const sortedHolidays = [...holidays].reverse().slice(0, 5);
          for (const h of sortedHolidays) {
            activities.push({
              id: `holiday-setting-${h.date}`,
              type: "holiday_added",
              description: `Holiday "${h.name || h.date}" added (${h.hours ? `${h.hours}h deduction` : "all day"})`,
              employeeName: "System",
              date: h.date,
              region: "all",
              createdAt: settings.updatedAt,
            });
          }
        }
      }
    } catch {
      // Settings table may not have holiday data, skip silently
    }

    // Sort by createdAt descending and take top 20
    activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const limited = activities.slice(0, 20);

    // Deduplicate by id
    const seen = new Set<string>();
    const deduped = limited.filter(a => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });

    return NextResponse.json({ activities: deduped });
  } catch (error) {
    console.error("Error fetching activity feed:", error);
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
  }
}

function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthIndex = parseInt(month, 10) - 1;
  return `${monthNames[monthIndex]} ${year}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
