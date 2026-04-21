import type { Settings } from "@/lib/scheduler";

export type MonthWeek = { weekStart: string; weekEnd: string };

const DAY_NAME_TO_JS_DAY: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Backend source of truth for month weeks.
 * Respects:
 * - settings.weekStart
 * - settings.monthStartMode ("weekStartAligned" | "monthDay1")
 */
export function buildWeeksForMonth(monthKey: string, settings: Pick<Settings, "weekStart" | "monthStartMode">): MonthWeek[] {
  const [yStr, mStr] = monthKey.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  if (!year || !month || month < 1 || month > 12) return [];

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  let d = new Date(firstDay);
  const mode = settings.monthStartMode || "weekStartAligned";
  if (mode === "weekStartAligned") {
    const target = DAY_NAME_TO_JS_DAY[settings.weekStart] ?? 5;
    while (d.getDay() !== target) d.setDate(d.getDate() - 1);
  }

  const weeks: MonthWeek[] = [];
  while (d <= lastDay) {
    const start = new Date(d);
    const end = new Date(d);
    end.setDate(end.getDate() + 6);

    // Include only if week overlaps the month at least 1 day
    const overlaps =
      (start.getFullYear() === year && start.getMonth() === month - 1) ||
      (end.getFullYear() === year && end.getMonth() === month - 1) ||
      (start < firstDay && end >= firstDay);

    if (overlaps) {
      weeks.push({ weekStart: formatDate(start), weekEnd: formatDate(end) });
    }

    d = new Date(d);
    d.setDate(d.getDate() + 7);
  }

  return weeks;
}

