import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse, isAdmin } from "@/lib/auth";
import { computeLocalStats, computeOffWeeks, getHoursForDate } from "@/lib/scheduler";
import type { Settings, ScheduleEntry } from "@/lib/scheduler";
import { db } from "@/lib/db";
import ExcelJS from "exceljs";

// ===== Color Palette =====
const PRIMARY = "1B2A4A";
const BLUE = "1D4ED8";
const GREEN = "059669";
const RED = "DC2626";
const AMBER = "D97706";
const LIGHT_BLUE = "DBEAFE";
const LIGHT_GREEN = "D1FAE5";
const LIGHT_RED = "FEE2E2";
const LIGHT_AMBER = "FEF3C7";
const LIGHT_GRAY = "F1F5F9";
const WHITE = "FFFFFF";
const N600 = "64748B";

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const AR_DAY_NAMES = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const AR_SHORT_DAYS = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
const EN_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const REGIONS = [
  { key: "cairo", label: "Cairo" },
  { key: "delta", label: "Delta" },
  { key: "upper_egypt", label: "Upper Egypt" },
];

interface RegionEmployee {
  id: number;
  name: string;
  hrid: string;
  region: string;
}

interface WeekDay {
  date: string;
  jsDay: number; // 0=Sun, 1=Mon, ..., 6=Sat
  dayName: string;
  isFriday: boolean;
  isSaturday: boolean;
  isWeekend: boolean;
}

interface WeekGroup {
  weekNum: number;
  label: string;
  days: WeekDay[];
}

// ===== Helper: Build week groups for a month =====
function buildWeekGroups(year: number, month: number): WeekGroup[] {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const allDays: WeekDay[] = [];

  for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
    const jsDay = d.getDay();
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    allDays.push({
      date: dateStr,
      jsDay,
      dayName: EN_DAY_NAMES[jsDay],
      isFriday: jsDay === 5,
      isSaturday: jsDay === 6,
      isWeekend: jsDay === 5 || jsDay === 6,
    });
  }

  // Group by week (Friday-based, matching the app's weekStart)
  const weeks: WeekGroup[] = [];
  let currentWeek: WeekDay[] = [];
  let weekNum = 0;

  // Find first Friday on or before first day
  const first = new Date(firstDay);
  while (first.getDay() !== 5) first.setDate(first.getDate() - 1);

  for (let d = new Date(first); d <= lastDay; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 5 && currentWeek.length > 0) {
      weeks.push({ weekNum: weekNum++, label: `W${weekNum + 1}`, days: [...currentWeek] });
      currentWeek = [];
    }
    if (d >= firstDay) {
      const jsDay = d.getDay();
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      currentWeek.push({
        date: dateStr,
        jsDay,
        dayName: EN_DAY_NAMES[jsDay],
        isFriday: jsDay === 5,
        isSaturday: jsDay === 6,
        isWeekend: jsDay === 5 || jsDay === 6,
      });
    }
  }
  if (currentWeek.length > 0) {
    weeks.push({ weekNum: weekNum, label: `W${weekNum + 1}`, days: currentWeek });
  }

  return weeks;
}

// ===== Helper: Apply blue header style =====
function applyHeaderStyle(cell: ExcelJS.Cell, width?: number) {
  cell.font = { size: 11, bold: true, color: { argb: "FFFFFF" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = {
    top: { style: "thin", color: { argb: "93C5FD" } },
    left: { style: "thin", color: { argb: "93C5FD" } },
    bottom: { style: "medium", color: { argb: BLUE } },
    right: { style: "thin", color: { argb: "93C5FD" } },
  };
}

// ===== Helper: Apply data cell style =====
function applyDataStyle(cell: ExcelJS.Cell, rowIdx: number) {
  const fill = rowIdx % 2 === 0 ? WHITE : LIGHT_GRAY;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.border = {
    top: { style: "thin", color: { argb: "E2E8F0" } },
    left: { style: "thin", color: { argb: "E2E8F0" } },
    bottom: { style: "thin", color: { argb: "E2E8F0" } },
    right: { style: "thin", color: { argb: "E2E8F0" } },
  };
}

// ===== POST: Export Matrix Excel =====
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (!isAdmin(auth.role) && auth.role !== "editor") return forbiddenResponse();

  try {
    const body = await request.json();
    const { month, regions: requestRegions } = body;

    const selectedMonth = month || "";

    // Get regions to export - accept array from frontend checkboxes
    const regionsToExport: string[] = Array.isArray(requestRegions) && requestRegions.length > 0
      ? requestRegions
      : ["cairo", "delta", "upper_egypt"];

    // Fetch all data
    const dbEmployees = await db.employee.findMany({ orderBy: { order: "asc" } });
    const dbSettings = await db.settings.findUnique();

    // Fetch schedule entries - filter by selected regions
    const whereClause: Record<string, unknown> = {};
    if (selectedMonth) whereClause.date = { startsWith: selectedMonth };
    if (regionsToExport.length < 3) {
      whereClause.region = { in: regionsToExport };
    }

    const dbEntries = await db.scheduleEntry.findMany({
      where: whereClause,
      orderBy: { date: "asc" },
    });

    // Fetch connection team entries
    const connWhere: Record<string, unknown> = {};
    if (selectedMonth) connWhere.monthKey = selectedMonth;

    const connectionTeam = selectedMonth
      ? await db.connectionTeam.findMany({ where: connWhere })
      : await db.connectionTeam.findMany();

    const settings: Settings = {
      shifts: dbSettings ? JSON.parse(dbSettings.shifts) : {},
      weekStart: dbSettings?.weekStart || "Friday",
      holidays: dbSettings ? JSON.parse(dbSettings.holidays) : [],
      summerTime: !!dbSettings?.summerTime,
      summerShifts: dbSettings ? JSON.parse(dbSettings.summerShifts) : {},
      dayHours: dbSettings ? JSON.parse(dbSettings.dayHours || "{}") : {},
    };

    // Parse month for week grouping
    let year = 2026, monthNum = 4;
    if (selectedMonth) {
      const parts = selectedMonth.split("-");
      year = Number(parts[0]);
      monthNum = Number(parts[1]);
    }

    const weeks = buildWeekGroups(year, monthNum);
    if (weeks.length === 0) {
      return NextResponse.json({ error: "No weeks found for the given month" }, { status: 404 });
    }

    // Create workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = "IT Helpdesk Shift Scheduler";
    wb.created = new Date();

    const periodLabel = selectedMonth
      ? `${MONTH_NAMES[monthNum]} ${year}`
      : "All Months";

    // ========================================
    // SHEET 1: CONFIG / SETTINGS
    // ========================================
    const wsConfig = wb.addWorksheet("Config", {
      properties: { tabColor: { argb: BLUE } },
    });
    wsConfig.getColumn(1).width = 22;
    wsConfig.getColumn(2).width = 28;
    wsConfig.getColumn(3).width = 50;

    // Title row
    wsConfig.mergeCells("A1:C1");
    const titleCell = wsConfig.getCell("A1");
    titleCell.value = "⚙️  إعدادات التصدير — Export Settings";
    titleCell.font = { size: 16, bold: true, color: { argb: "FFFFFF" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    wsConfig.getRow(1).height = 40;

    // Blue sub-header
    wsConfig.mergeCells("A2:C2");
    const subCell = wsConfig.getCell("A2");
    subCell.value = `الفترة: ${periodLabel} | عدد المناطق: ${regionsToExport.length} | عدد الأسابيع: ${weeks.length}`;
    subCell.font = { size: 11, color: { argb: "FFFFFF" } };
    subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY } };
    subCell.alignment = { horizontal: "center", vertical: "middle" };
    wsConfig.getRow(2).height = 28;

    // Region dropdown
    const regionRow = 4;
    wsConfig.getCell(regionRow, 1).value = "المنطقة / Region";
    wsConfig.getCell(regionRow, 1).font = { bold: true, size: 12 };
    wsConfig.getCell(regionRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };

    const regionDvCell = wsConfig.getCell(regionRow, 2);
    regionDvCell.value = regionsToExport.length === 1
      ? REGIONS.find(r => r.key === regionsToExport[0])?.label || regionsToExport[0]
      : "All Regions";
    regionDvCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
    regionDvCell.border = { bottom: { style: "medium", color: { argb: BLUE } } };

    if (regionsToExport.length > 1) {
      regionDvCell.dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"All Regions,Cairo,Delta,Upper Egypt"'],
        showErrorMessage: true,
        errorTitle: "Invalid Region",
        error: "Please select a valid region from the list",
      };
    }

    wsConfig.getCell(regionRow, 3).value = "اختر المنطقة للعرض";
    wsConfig.getCell(regionRow, 3).font = { italic: true, color: { argb: N600 }, size: 10 };

    // Team dropdown
    const teamRow = 6;
    wsConfig.getCell(teamRow, 1).value = "الفريق / Team";
    wsConfig.getCell(teamRow, 1).font = { bold: true, size: 12 };
    wsConfig.getCell(teamRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GREEN } };

    const teamDvCell = wsConfig.getCell(teamRow, 2);
    teamDvCell.value = "HelpDesk";
    teamDvCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GREEN } };
    teamDvCell.border = { bottom: { style: "medium", color: { argb: GREEN } } };

    teamDvCell.dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"HelpDesk,Connection Team"'],
      showErrorMessage: true,
      errorTitle: "Invalid Team",
      error: "Please select HelpDesk or Connection Team",
    };

    wsConfig.getCell(teamRow, 3).value = "اختر الفريق (HelpDesk أو Connection Team)";
    wsConfig.getCell(teamRow, 3).font = { italic: true, color: { argb: N600 }, size: 10 };

    // Legend
    const legendRow = 8;
    wsConfig.mergeCells(legendRow, 1, legendRow, 3);
    wsConfig.getCell(legendRow, 1).value = "📋  دليل الرموز / Legend";
    wsConfig.getCell(legendRow, 1).font = { size: 13, bold: true, color: { argb: PRIMARY } };
    wsConfig.getCell(legendRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "EFF6FF" } };

    const legends = [
      { sym: "W", meaning: "عمل / Working — موظف معين للوردية", color: "059669" },
      { sym: "Off", meaning: "إجازة أسبوعية / Weekly Off — إجازة كاملة الأسبوع", color: "DC2626" },
      { sym: "(blank)", meaning: "غير معين / Not Assigned — لا وردية في هذا اليوم", color: N600 },
      { sym: "🔴", meaning: "تنبيه: عمل يومين متتاليين / Alert: Consecutive work days", color: RED },
      { sym: "🟡", meaning: "تنبيه: عدم توازن الشفتات / Alert: Shift imbalance (Max-Min > 1)", color: AMBER },
    ];

    legends.forEach((l, i) => {
      const r = legendRow + 1 + i;
      wsConfig.getCell(r, 1).value = l.sym;
      wsConfig.getCell(r, 1).font = { bold: true, color: { argb: l.color }, size: 12 };
      wsConfig.getCell(r, 1).alignment = { horizontal: "center" };
      wsConfig.getCell(r, 2).value = l.meaning;
      wsConfig.getCell(r, 2).font = { size: 10 };
      wsConfig.mergeCells(r, 2, r, 3);
    });

    // Generated timestamp
    const tsRow = legendRow + legends.length + 2;
    wsConfig.mergeCells(tsRow, 1, tsRow, 3);
    wsConfig.getCell(tsRow, 1).value = `Generated: ${new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}`;
    wsConfig.getCell(tsRow, 1).font = { size: 9, italic: true, color: { argb: N600 } };

    // ========================================
    // HELPDESK MATRIX SHEETS (one per region)
    // ========================================
    const allHelpDeskStats: Array<{
      region: string;
      regionLabel: string;
      maxShifts: number;
      minShifts: number;
      avgShifts: number;
      variance: number;
      totalOffDays: number;
      consecutiveViolations: number;
      employees: Array<{ name: string; hrid: string; workDays: number; offDays: number; friDays: number; satDays: number; consecutive: number }>;
    }> = [];

    for (const regionKey of regionsToExport) {
      const regionLabel = REGIONS.find(r => r.key === regionKey)?.label || regionKey;
      const sheetName = `${regionLabel} - HelpDesk`;

      // Filter employees for this region
      const regionEmps: RegionEmployee[] = dbEmployees
        .filter(e => e.region === regionKey && e.active)
        .map(e => ({ id: e.id, name: e.name, hrid: e.hrid, region: e.region }));

      if (regionEmps.length === 0) continue;

      // Filter entries for this region
      const regionEntries = dbEntries.filter(e => {
        const emp = dbEmployees.find(de => de.name === e.empName);
        return emp && emp.region === regionKey;
      });

      // Build date → entry map
      const dateEntryMap = new Map<string, ScheduleEntry>();
      for (const entry of regionEntries) {
        dateEntryMap.set(entry.date, entry);
      }

      // Track off persons per week
      const weekOffMap = new Map<number, string>(); // weekNum → offPersonName
      for (const entry of regionEntries) {
        if (entry.offPerson && entry.offPerson !== "") {
          weekOffMap.set(entry.weekNum, entry.offPerson);
        }
      }

      // Create worksheet
      const ws = wb.addWorksheet(sheetName, {
        properties: { tabColor: { argb: GREEN } },
      });

      // Column layout:
      // A: # (row number)
      // B: Employee Name
      // C: HRID
      // Then 7 columns per week (Mon-Sun) — Fri start
      // After all weeks: Work Days, Off Days, Fri Count, Sat Count, Consecutive

      ws.getColumn(1).width = 4;
      ws.getColumn(2).width = 22;
      ws.getColumn(3).width = 12;

      // Total columns: 3 fixed + (7 * numWeeks) + 5 stats = 8 + 7*numWeeks
      const totalWeekCols = 7 * weeks.length;
      for (let c = 4; c < 4 + totalWeekCols; c++) {
        ws.getColumn(c).width = 5;
      }
      // Stats columns
      const statsStartCol = 4 + totalWeekCols;
      ws.getColumn(statsStartCol).width = 9; // Work Days
      ws.getColumn(statsStartCol + 1).width = 9; // Off Days
      ws.getColumn(statsStartCol + 2).width = 6; // Fri
      ws.getColumn(statsStartCol + 3).width = 6; // Sat
      ws.getColumn(statsStartCol + 4).width = 10; // Consecutive

      // ---- Title ----
      const totalCols = statsStartCol + 5;
      ws.mergeCells(1, 1, 1, totalCols);
      const tCell = ws.getCell(1, 1);
      tCell.value = `🏢  ${regionLabel} — HelpDesk Shift Schedule (${periodLabel})`;
      tCell.font = { size: 14, bold: true, color: { argb: "FFFFFF" } };
      tCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
      tCell.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 36;

      // ---- Week Headers ----
      // Row 2: Week labels (merged across 7 columns)
      // Row 3: Day names (Mon-Sun)
      const headerRow1 = 2;
      const headerRow2 = 3;
      const headerRow3 = 4; // sub-headers for stats

      // Fixed headers in row 2
      ws.mergeCells(headerRow1, 1, headerRow2, 1); // #
      applyHeaderStyle(ws.getCell(headerRow1, 1));
      ws.getCell(headerRow1, 1).value = "#";

      ws.mergeCells(headerRow1, 2, headerRow2, 2); // Employee
      applyHeaderStyle(ws.getCell(headerRow1, 2));
      ws.getCell(headerRow1, 2).value = "الموظف\nEmployee";

      ws.mergeCells(headerRow1, 3, headerRow2, 3); // HRID
      applyHeaderStyle(ws.getCell(headerRow1, 3));
      ws.getCell(headerRow1, 3).value = "HRID";

      // Week headers
      for (let wi = 0; wi < weeks.length; wi++) {
        const week = weeks[wi];
        const colStart = 4 + wi * 7;
        const colEnd = colStart + 6;

        // Merge week label across 7 columns
        ws.mergeCells(headerRow1, colStart, headerRow1, colEnd);
        const weekLabelCell = ws.getCell(headerRow1, colStart);
        weekLabelCell.value = `${week.label} (${week.days[0]?.date || ""} — ${week.days[week.days.length - 1]?.date || ""})`;
        weekLabelCell.font = { size: 9, bold: true, color: { argb: "FFFFFF" } };
        weekLabelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY } };
        weekLabelCell.alignment = { horizontal: "center", vertical: "middle" };

        // Day names
        const dayOrder = [5, 6, 0, 1, 2, 3, 4]; // Fri, Sat, Sun, Mon, Tue, Wed, Thu
        const dayLabels = ["Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"];
        const dayColors = ["FEF3C7", "DBEAFE", "F1F5F9", "F1F5F9", "F1F5F9", "F1F5F9", "E0F2FE"];

        for (let di = 0; di < 7; di++) {
          const col = colStart + di;
          const dayCell = ws.getCell(headerRow2, col);
          dayCell.value = dayLabels[di];
          dayCell.font = { size: 9, bold: true, color: { argb: di <= 1 ? PRIMARY : N600 } };
          dayCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: dayColors[di] } };
          dayCell.alignment = { horizontal: "center", vertical: "middle" };
          dayCell.border = {
            top: { style: "thin", color: { argb: "E2E8F0" } },
            left: { style: "thin", color: { argb: "E2E8F0" } },
            bottom: { style: "thin", color: { argb: "E2E8F0" } },
            right: { style: "thin", color: { argb: "E2E8F0" } },
          };
        }
      }

      // Stats sub-headers (merged across row 2 and 3)
      const statLabels = ["Working\nأيام العمل", "Off\nإجازة", "Fri\nجمعة", "Sat\nسبت", "Consec.\nمتتالي"];
      for (let si = 0; si < statLabels.length; si++) {
        const col = statsStartCol + si;
        ws.mergeCells(headerRow1, col, headerRow2, col);
        applyHeaderStyle(ws.getCell(headerRow1, col));
        ws.getCell(headerRow1, col).value = statLabels[si];
        ws.getColumn(col).width = si === 4 ? 10 : 8;
      }

      // ---- Data Rows ----
      const dataStartRow = 5;
      const empStats: Array<{
        name: string;
        hrid: string;
        workDays: number;
        offDays: number;
        friDays: number;
        satDays: number;
        consecutive: number;
        dayValues: string[]; // all values for the row (for formula reference)
      }> = [];

      for (let ei = 0; ei < regionEmps.length; ei++) {
        const emp = regionEmps[ei];
        const row = dataStartRow + ei;
        const dataRow = ws.getRow(row);
        dataRow.height = 24;

        let workDays = 0;
        let offDays = 0;
        let friDays = 0;
        let satDays = 0;
        let consecutive = 0;

        // Row number
        const numCell = ws.getCell(row, 1);
        numCell.value = ei + 1;
        applyDataStyle(numCell, ei);

        // Employee name
        const nameCell = ws.getCell(row, 2);
        nameCell.value = emp.name;
        nameCell.font = { bold: true, size: 10 };
        applyDataStyle(nameCell, ei);
        nameCell.alignment = { horizontal: "left", vertical: "middle" };

        // HRID
        const hridCell = ws.getCell(row, 3);
        hridCell.value = emp.hrid;
        hridCell.font = { size: 9, color: { argb: N600 } };
        applyDataStyle(hridCell, ei);

        // For consecutive detection
        const prevDayWasWork = new Map<number, boolean>(); // jsDay → wasWork

        for (let wi = 0; wi < weeks.length; wi++) {
          const week = weeks[wi];
          const dayOrder = [5, 6, 0, 1, 2, 3, 4]; // Fri, Sat, Sun, Mon, Tue, Wed, Thu

          for (let di = 0; di < 7; di++) {
            const col = 4 + wi * 7 + di;
            const targetJsDay = dayOrder[di];

            // Find matching day in the week
            const matchingDay = week.days.find(d => d.jsDay === targetJsDay);
            const cell = ws.getCell(row, col);

            if (!matchingDay) {
              cell.value = "";
              applyDataStyle(cell, ei);
              continue;
            }

            const dateStr = matchingDay.date;
            const entry = dateEntryMap.get(dateStr);
            const offPerson = weekOffMap.get(wi);

            let cellValue = "";
            let cellColor = WHITE;

            if (offPerson === emp.name) {
              // This employee is off for the whole week
              cellValue = "Off";
              offDays++;
              cellColor = LIGHT_RED;
              cell.font = { bold: true, color: { argb: RED }, size: 9 };
            } else if (entry && entry.empName === emp.name) {
              // This employee is working this day
              cellValue = "W";
              workDays++;

              if (matchingDay.isFriday) friDays++;
              if (matchingDay.isSaturday) satDays++;

              // Check consecutive: if the previous day (jsDay - 1 or 6 if 0) was also W
              const prevJsDay = targetJsDay === 5 ? 4 : targetJsDay - 1; // Previous day
              const prevDayEntry = week.days.find(d => d.jsDay === prevJsDay);
              if (prevDayEntry) {
                const prevEntry = dateEntryMap.get(prevDayEntry.date);
                if (prevEntry && prevEntry.empName === emp.name) {
                  consecutive++;
                  cellColor = "FECACA"; // Red-200
                } else {
                  cellColor = matchingDay.isWeekend ? LIGHT_AMBER : LIGHT_GREEN;
                }
              } else {
                cellColor = matchingDay.isWeekend ? LIGHT_AMBER : LIGHT_GREEN;
              }
              cell.font = { bold: true, color: { argb: GREEN }, size: 10 };
            } else {
              // Not assigned
              cellValue = "";
              cell.font = { size: 9 };
            }

            cell.value = cellValue;
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cellColor } };
            cell.alignment = { horizontal: "center", vertical: "middle" };
            cell.border = {
              top: { style: "thin", color: { argb: "E2E8F0" } },
              left: { style: "thin", color: { argb: "E2E8F0" } },
              bottom: { style: "thin", color: { argb: "E2E8F0" } },
              right: { style: "thin", color: { argb: "E2E8F0" } },
            };
          }
        }

        // Stats columns with formulas
        const firstDataCol = 4;
        const lastDataCol = 3 + totalWeekCols;
        const rowLetter = String.fromCharCode(64 + row); // Excel row letter approximation
        const rangeStr = `${getColLetter(firstDataCol)}${row}:${getColLetter(lastDataCol)}${row}`;

        // Work Days = COUNTIF
        const workCell = ws.getCell(row, statsStartCol);
        workCell.value = { formula: `COUNTIF(${rangeStr},"W")` };
        workCell.font = { bold: true, color: { argb: GREEN }, size: 11 };
        applyDataStyle(workCell, ei);

        // Off Days = COUNTIF
        const offCell = ws.getCell(row, statsStartCol + 1);
        offCell.value = { formula: `COUNTIF(${rangeStr},"Off")` };
        offCell.font = { bold: true, color: { argb: RED }, size: 11 };
        applyDataStyle(offCell, ei);

        // Fri count
        const friCol = 4; // First column of first week is always Friday
        const friCountParts: string[] = [];
        for (let wi = 0; wi < weeks.length; wi++) {
          const fc = 4 + wi * 7; // Friday column in each week block
          friCountParts.push(`${getColLetter(fc)}${row}`);
        }
        const friCell = ws.getCell(row, statsStartCol + 2);
        friCell.value = { formula: `COUNTIF(${getColLetter(4)}${row}:${getColLetter(4 + (weeks.length - 1) * 7)}${row},"W")` };
        // Actually, we need every 7th column. Let's use SUMPRODUCT approach
        // But that's complex. Let's compute and set a value instead.
        friCell.value = friDays;
        friCell.font = { color: { argb: AMBER }, bold: true, size: 10 };
        applyDataStyle(friCell, ei);

        // Sat count
        const satCell = ws.getCell(row, statsStartCol + 3);
        satCell.value = satDays;
        satCell.font = { color: { argb: BLUE }, bold: true, size: 10 };
        applyDataStyle(satCell, ei);

        // Consecutive violations
        const consCell = ws.getCell(row, statsStartCol + 4);
        consCell.value = consecutive;
        consCell.font = {
          bold: true,
          color: { argb: consecutive > 0 ? RED : GREEN },
          size: consecutive > 0 ? 12 : 10,
        };
        applyDataStyle(consCell, ei);
        if (consecutive > 0) {
          consCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_RED } };
        }

        empStats.push({
          name: emp.name,
          hrid: emp.hrid,
          workDays,
          offDays,
          friDays,
          satDays,
          consecutive,
          dayValues: [],
        });
      }

      // ---- Summary Row (bottom) ----
      const summaryRow = dataStartRow + regionEmps.length + 1;
      ws.mergeCells(summaryRow, 1, summaryRow, 3);
      ws.getCell(summaryRow, 1).value = "📊  المجموع / Totals";
      ws.getCell(summaryRow, 1).font = { bold: true, color: { argb: PRIMARY }, size: 11 };
      ws.getCell(summaryRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };

      const empRange = `${dataStartRow}:${dataStartRow + regionEmps.length - 1}`;

      // Work days total per day column
      for (let wi = 0; wi < weeks.length; wi++) {
        for (let di = 0; di < 7; di++) {
          const col = 4 + wi * 7 + di;
          const colLetter = getColLetter(col);
          const cell = ws.getCell(summaryRow, col);
          cell.value = { formula: `COUNTIF(${colLetter}${empRange},"W")` };
          cell.font = { bold: true, size: 9, color: { argb: PRIMARY } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
          cell.alignment = { horizontal: "center" };
          cell.border = {
            top: { style: "medium", color: { argb: PRIMARY } },
            bottom: { style: "thin", color: { argb: "E2E8F0" } },
            left: { style: "thin", color: { argb: "E2E8F0" } },
            right: { style: "thin", color: { argb: "E2E8F0" } },
          };
        }
      }

      // Stats summary formulas
      const wsColLetter = getColLetter(statsStartCol);
      const offColLetter = getColLetter(statsStartCol + 1);
      const consColLetter = getColLetter(statsStartCol + 4);

      // MAX work days
      const maxCell = ws.getCell(summaryRow, statsStartCol);
      maxCell.value = { formula: `MAX(${wsColLetter}${empRange})` };
      maxCell.font = { bold: true, color: { argb: BLUE }, size: 11 };
      maxCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };

      // Total off
      const offTotalCell = ws.getCell(summaryRow, statsStartCol + 1);
      offTotalCell.value = { formula: `SUM(${offColLetter}${empRange})` };
      offTotalCell.font = { bold: true, color: { argb: RED }, size: 11 };
      offTotalCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };

      // Fri total
      const friTotalCell = ws.getCell(summaryRow, statsStartCol + 2);
      const allFri = empStats.reduce((s, e) => s + e.friDays, 0);
      friTotalCell.value = allFri;
      friTotalCell.font = { bold: true, size: 10 };
      friTotalCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };

      // Sat total
      const satTotalCell = ws.getCell(summaryRow, statsStartCol + 3);
      const allSat = empStats.reduce((s, e) => s + e.satDays, 0);
      satTotalCell.value = allSat;
      satTotalCell.font = { bold: true, size: 10 };
      satTotalCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };

      // Total consecutive violations
      const consTotalCell = ws.getCell(summaryRow, statsStartCol + 4);
      const totalCons = empStats.reduce((s, e) => s + e.consecutive, 0);
      consTotalCell.value = totalCons;
      consTotalCell.font = { bold: true, color: { argb: totalCons > 0 ? RED : GREEN }, size: totalCons > 0 ? 12 : 10 };
      consTotalCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: totalCons > 0 ? LIGHT_RED : LIGHT_BLUE } };

      // MIN row
      const minRow = summaryRow + 1;
      ws.mergeCells(minRow, 1, minRow, 3);
      ws.getCell(minRow, 1).value = "📉  MIN / الأقل";
      ws.getCell(minRow, 1).font = { bold: true, color: { argb: AMBER }, size: 11 };
      ws.getCell(minRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_AMBER } };

      const minCell = ws.getCell(minRow, statsStartCol);
      minCell.value = { formula: `MIN(${wsColLetter}${empRange})` };
      minCell.font = { bold: true, color: { argb: AMBER }, size: 11 };
      minCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_AMBER } };

      // Variance row
      const varRow = minRow + 1;
      ws.mergeCells(varRow, 1, varRow, 3);
      ws.getCell(varRow, 1).value = "⚖️  Variance (Max-Min) / الفرق";
      const workDaysArr = empStats.map(e => e.workDays);
      const maxW = Math.max(...workDaysArr);
      const minW = Math.min(...workDaysArr);
      const variance = maxW - minW;

      ws.getCell(varRow, 1).font = {
        bold: true,
        color: { argb: variance > 1 ? RED : GREEN },
        size: 11,
      };
      ws.getCell(varRow, 1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: variance > 1 ? LIGHT_RED : LIGHT_GREEN },
      };

      const varCell = ws.getCell(varRow, statsStartCol);
      varCell.value = variance;
      varCell.font = { bold: true, color: { argb: variance > 1 ? RED : GREEN }, size: 14 };
      varCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: variance > 1 ? LIGHT_RED : LIGHT_GREEN },
      };
      varCell.alignment = { horizontal: "center" };

      // Variance alert
      if (variance > 1) {
        ws.mergeCells(varRow, statsStartCol + 1, varRow, statsStartCol + 4);
        const alertCell = ws.getCell(varRow, statsStartCol + 1);
        alertCell.value = `⚠️ تنبيه! الفرق ${variance} يوم — يُفضل إعادة التوزيع`;
        alertCell.font = { bold: true, color: { argb: RED }, size: 10 };
        alertCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_RED } };
      }

      // Recommendations section
      const recRow = varRow + 2;
      ws.mergeCells(recRow, 1, recRow, totalCols);
      ws.getCell(recRow, 1).value = "💡  التوصيات / Recommendations";
      ws.getCell(recRow, 1).font = { size: 12, bold: true, color: { argb: PRIMARY } };
      ws.getCell(recRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "EFF6FF" } };

      const recommendations: string[] = [];

      if (variance > 1) {
        const maxEmp = empStats.find(e => e.workDays === maxW);
        const minEmp = empStats.find(e => e.workDays === minW);
        if (maxEmp && minEmp) {
          recommendations.push(
            `⚠️ يُفضل إعادة توزيع الشفتات — الفرق ${variance} يوم بين ${maxEmp.name} (${maxW}) و ${minEmp.name} (${minW})`
          );
        }
      }

      if (totalCons > 0) {
        const consEmps = empStats.filter(e => e.consecutive > 0).map(e => `${e.name} (${e.consecutive})`);
        recommendations.push(
          `🔴 تقليل الضغط على: ${consEmps.join("، ")} — يوجد عمل متتالي`
        );
      }

      if (recommendations.length === 0) {
        recommendations.push("✅ التوزيع متوازن — لا توجد مخالفات");
      }

      recommendations.forEach((rec, i) => {
        const r = recRow + 1 + i;
        ws.mergeCells(r, 1, r, totalCols);
        ws.getCell(r, 1).value = rec;
        ws.getCell(r, 1).font = { size: 10, color: { argb: rec.includes("⚠️") || rec.includes("🔴") ? RED : GREEN } };
      });

      // Note: ExcelJS tables require programmatic row definitions.
      // Since we populate cells directly, we skip addTable and rely on our custom styling.

      // Conditional formatting: consecutive W detection across days
      // For each pair of adjacent columns within each week
      for (let wi = 0; wi < weeks.length; wi++) {
        for (let di = 0; di < 6; di++) {
          const col1 = 4 + wi * 7 + di;
          const col2 = col1 + 1;
          const col1L = getColLetter(col1);
          const col2L = getColLetter(col2);

          // Red fill when both cells = "W"
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ws as any).addConditionalFormatting({
              ref: `${col1L}${dataStartRow}:${col2L}${dataStartRow + regionEmps.length - 1}`,
              rules: [
                {
                  type: "expression",
                  formulae: [`AND(${col1L}${dataStartRow}="W",${col2L}${dataStartRow}="W")`],
                  style: {
                    font: { color: { argb: "FFFFFF" }, bold: true },
                    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "DC2626" } },
                  },
                },
              ],
            });
          } catch {
            // Conditional formatting may not work in all scenarios
          }
        }

        // Cross-week boundary: last day of week and first day of next week
        if (wi < weeks.length - 1) {
          const crossCol1 = 4 + wi * 7 + 6; // Last day of week
          const crossCol2 = 4 + (wi + 1) * 7; // First day of next week
          const crossCol1L = getColLetter(crossCol1);
          const crossCol2L = getColLetter(crossCol2);

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ws as any).addConditionalFormatting({
              ref: `${crossCol1L}${dataStartRow}:${crossCol2L}${dataStartRow + regionEmps.length - 1}`,
              rules: [
                {
                  type: "expression",
                  formulae: [`AND(${crossCol1L}${dataStartRow}="W",${crossCol2L}${dataStartRow}="W")`],
                  style: {
                    font: { color: { argb: "FFFFFF" }, bold: true },
                    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "DC2626" } },
                  },
                },
              ],
            });
          } catch {
            // Ignore
          }
        }
      }

      // Store stats for summary sheet
      const avgShifts = workDaysArr.length > 0 ? workDaysArr.reduce((a, b) => a + b, 0) / workDaysArr.length : 0;
      allHelpDeskStats.push({
        region: regionKey,
        regionLabel,
        maxShifts: maxW,
        minShifts: minW,
        avgShifts: Math.round(avgShifts * 10) / 10,
        variance,
        totalOffDays: empStats.reduce((s, e) => s + e.offDays, 0),
        consecutiveViolations: totalCons,
        employees: empStats,
      });

      // Freeze panes
      ws.views = [{ state: "frozen", xSplit: 3, ySplit: headerRow2 }];
    }

    // ========================================
    // CONNECTION TEAM SHEET
    // ========================================
    if (connectionTeam.length > 0) {
      const wsConn = wb.addWorksheet("Connection Team", {
        properties: { tabColor: { argb: "0D9488" } },
      });
      wsConn.getColumn(1).width = 6;
      wsConn.getColumn(2).width = 24;
      wsConn.getColumn(3).width = 12;

      // Week columns
      for (let wi = 0; wi < weeks.length; wi++) {
        wsConn.getColumn(4 + wi).width = 6;
      }
      wsConn.getColumn(4 + weeks.length).width = 10; // Total weeks
      wsConn.getColumn(5 + weeks.length).width = 12; // Total hours

      // Title
      const connTotalCols = 5 + weeks.length;
      wsConn.mergeCells(1, 1, 1, connTotalCols);
      const connTitle = wsConn.getCell(1, 1);
      connTitle.value = `🔗  Connection Team — Weekly Assignments (${periodLabel})`;
      connTitle.font = { size: 14, bold: true, color: { argb: "FFFFFF" } };
      connTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0D9488" } };
      connTitle.alignment = { horizontal: "center", vertical: "middle" };
      wsConn.getRow(1).height = 36;

      // Headers
      const connHeaders = ["#", "Employee", "HRID", ...weeks.map(w => w.label), "Total", "Hours"];
      connHeaders.forEach((h, ci) => {
        const cell = wsConn.getCell(3, ci + 1);
        cell.value = h;
        applyHeaderStyle(cell);
        // Override color for connection team
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0D9488" } };
      });
      wsConn.getRow(3).height = 28;

      // Get all unique connection team members
      const connMembers = new Map<string, { name: string; hrid: string; weeks: number; hours: number }>();
      for (const ct of connectionTeam) {
        if (!connMembers.has(ct.empName)) {
          connMembers.set(ct.empName, { name: ct.empName, hrid: ct.empHrid, weeks: 0, hours: 0 });
        }
      }

      // Build connection map by week
      const connByWeek = new Map<string, string>(); // weekStart → empName
      for (const ct of connectionTeam) {
        connByWeek.set(ct.weekStart, ct.empName);
      }

      // Calculate week hours
      const calcConnWeekHours = (weekStart: string, weekEnd: string): number => {
        let total = 0;
        const start = new Date(weekStart + "T00:00:00");
        const end = new Date(weekEnd + "T00:00:00");
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          total += getHoursForDate(ds, settings, settings.holidays?.includes(ds) || false);
        }
        return total;
      };

      // Data rows
      let connIdx = 0;
      for (const [, member] of connMembers) {
        const row = 4 + connIdx;
        const dataRow = wsConn.getRow(row);
        dataRow.height = 24;

        wsConn.getCell(row, 1).value = connIdx + 1;
        applyDataStyle(wsConn.getCell(row, 1), connIdx);

        wsConn.getCell(row, 2).value = member.name;
        wsConn.getCell(row, 2).font = { bold: true, size: 10 };
        applyDataStyle(wsConn.getCell(row, 2), connIdx);
        wsConn.getCell(row, 2).alignment = { horizontal: "left" };

        wsConn.getCell(row, 3).value = member.hrid;
        wsConn.getCell(row, 3).font = { size: 9, color: { argb: N600 } };
        applyDataStyle(wsConn.getCell(row, 3), connIdx);

        let totalWeeks = 0;
        let totalHrs = 0;

        for (let wi = 0; wi < weeks.length; wi++) {
          const week = weeks[wi];
          const cell = wsConn.getCell(row, 4 + wi);

          // Find if this member is assigned to any day in this week
          let isAssigned = false;
          for (const day of week.days) {
            // Check if any connection team entry matches this day
            const matchingCt = connectionTeam.find(ct => {
              const cs = new Date(ct.weekStart + "T00:00:00");
              const ce = new Date(ct.weekEnd + "T00:00:00");
              const dd = new Date(day.date + "T00:00:00");
              return ct.empName === member.name && dd >= cs && dd <= ce;
            });
            if (matchingCt) {
              isAssigned = true;
              totalHrs += calcConnWeekHours(matchingCt.weekStart, matchingCt.weekEnd);
              break;
            }
          }

          if (isAssigned) {
            cell.value = "C";
            totalWeeks++;
            cell.font = { bold: true, color: { argb: "FFFFFF" }, size: 10 };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0D9488" } };
          } else {
            cell.value = "";
            applyDataStyle(cell, connIdx);
          }
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = {
            top: { style: "thin", color: { argb: "E2E8F0" } },
            left: { style: "thin", color: { argb: "E2E8F0" } },
            bottom: { style: "thin", color: { argb: "E2E8F0" } },
            right: { style: "thin", color: { argb: "E2E8F0" } },
          };
        }

        // Total weeks
        wsConn.getCell(row, 4 + weeks.length).value = totalWeeks;
        wsConn.getCell(row, 4 + weeks.length).font = { bold: true, color: { argb: "0D9488" }, size: 11 };
        applyDataStyle(wsConn.getCell(row, 4 + weeks.length), connIdx);

        // Total hours
        wsConn.getCell(row, 5 + weeks.length).value = Math.round(totalHrs * 10) / 10;
        wsConn.getCell(row, 5 + weeks.length).font = { bold: true, color: { argb: "0D9488" }, size: 11 };
        wsConn.getCell(row, 5 + weeks.length).numFmt = "0.0";
        applyDataStyle(wsConn.getCell(row, 5 + weeks.length), connIdx);

        connIdx++;
      }
    }

    // ========================================
    // SUMMARY SHEET
    // ========================================
    const wsSummary = wb.addWorksheet("Summary", {
      properties: { tabColor: { argb: AMBER } },
    });
    wsSummary.getColumn(1).width = 4;
    wsSummary.getColumn(2).width = 18;
    wsSummary.getColumn(3).width = 22;
    wsSummary.getColumn(4).width = 14;
    wsSummary.getColumn(5).width = 14;
    wsSummary.getColumn(6).width = 14;
    wsSummary.getColumn(7).width = 14;
    wsSummary.getColumn(8).width = 14;
    wsSummary.getColumn(9).width = 14;
    wsSummary.getColumn(10).width = 40;

    // Title
    wsSummary.mergeCells("A1:J1");
    const sumTitle = wsSummary.getCell("A1");
    sumTitle.value = `📊  ملخص شامل — Comprehensive Summary (${periodLabel})`;
    sumTitle.font = { size: 16, bold: true, color: { argb: "FFFFFF" } };
    sumTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    sumTitle.alignment = { horizontal: "center", vertical: "middle" };
    wsSummary.getRow(1).height = 40;

    // HelpDesk section
    let sRow = 3;
    wsSummary.mergeCells(sRow, 1, sRow, 10);
    wsSummary.getCell(sRow, 1).value = "🏢  HelpDesk Team — ملخص";
    wsSummary.getCell(sRow, 1).font = { size: 13, bold: true, color: { argb: "FFFFFF" } };
    wsSummary.getCell(sRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    wsSummary.getRow(sRow).height = 30;
    sRow++;

    // Per-region summary headers
    const sumHeaders = ["#", "Region", "المنطقة", "MAX Shifts", "MIN Shifts", "Avg Shifts", "Variance", "Off Days", "Consecutive", "Status / الحالة"];
    sumHeaders.forEach((h, ci) => {
      const cell = wsSummary.getCell(sRow, ci + 1);
      cell.value = h;
      applyHeaderStyle(cell);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY } };
    });
    wsSummary.getRow(sRow).height = 28;
    sRow++;

    // Per-region data
    allHelpDeskStats.forEach((stat, i) => {
      const row = sRow + i;
      const dataRow = wsSummary.getRow(row);
      dataRow.height = 24;

      const vals = [
        i + 1,
        stat.regionLabel,
        stat.regionLabel,
        stat.maxShifts,
        stat.minShifts,
        stat.avgShifts,
        stat.variance,
        stat.totalOffDays,
        stat.consecutiveViolations,
        "",
      ];

      vals.forEach((val, ci) => {
        const cell = dataRow.getCell(ci + 1);
        cell.value = val;
        applyDataStyle(cell, i);
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });

      // Status
      const statusCell = dataRow.getCell(10);
      let status = "✅ متوازن";
      let statusColor = GREEN;
      if (stat.variance > 1) {
        status = "⚠️ عدم توازن";
        statusColor = AMBER;
      }
      if (stat.variance > 2 || stat.consecutiveViolations > 0) {
        status = "🔴 يحتاج مراجعة";
        statusColor = RED;
      }
      statusCell.value = status;
      statusCell.font = { bold: true, color: { argb: statusColor }, size: 10 };

      // Highlight variance
      const varCell = dataRow.getCell(7);
      if (stat.variance > 1) {
        varCell.font = { bold: true, color: { argb: RED }, size: 12 };
        varCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_RED } };
      }
    });

    sRow += allHelpDeskStats.length + 2;

    // Overall metrics
    wsSummary.mergeCells(sRow, 1, sRow, 10);
    wsSummary.getCell(sRow, 1).value = "📈  Overall Metrics — المؤشرات العامة";
    wsSummary.getCell(sRow, 1).font = { size: 13, bold: true, color: { argb: "FFFFFF" } };
    wsSummary.getCell(sRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY } };
    wsSummary.getRow(sRow).height = 30;
    sRow++;

    const overallMax = allHelpDeskStats.length > 0 ? Math.max(...allHelpDeskStats.map(s => s.maxShifts)) : 0;
    const overallMin = allHelpDeskStats.length > 0 ? Math.min(...allHelpDeskStats.map(s => s.minShifts)) : 0;
    const overallVariance = overallMax - overallMin;
    const totalConsecutive = allHelpDeskStats.reduce((s, r) => s + r.consecutiveViolations, 0);

    const metrics = [
      { label: "Overall MAX Shifts", value: overallMax, color: BLUE },
      { label: "Overall MIN Shifts", value: overallMin, color: AMBER },
      { label: "Overall Variance", value: overallVariance, color: overallVariance > 1 ? RED : GREEN },
      { label: "Total Consecutive Violations", value: totalConsecutive, color: totalConsecutive > 0 ? RED : GREEN },
      { label: "Regions Analyzed", value: allHelpDeskStats.length, color: N600 },
    ];

    metrics.forEach((m, i) => {
      const row = sRow + i;
      wsSummary.getCell(row, 2).value = m.label;
      wsSummary.getCell(row, 2).font = { bold: true, size: 11 };
      wsSummary.getCell(row, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };

      wsSummary.getCell(row, 4).value = m.value;
      wsSummary.getCell(row, 4).font = { bold: true, color: { argb: m.color }, size: 14 };
      wsSummary.getCell(row, 4).alignment = { horizontal: "center" };
      wsSummary.getCell(row, 4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
    });

    sRow += metrics.length + 2;

    // Per-employee detailed breakdown
    wsSummary.mergeCells(sRow, 1, sRow, 10);
    wsSummary.getCell(sRow, 1).value = "👤  Detailed Employee Breakdown — تفصيل الموظفين";
    wsSummary.getCell(sRow, 1).font = { size: 13, bold: true, color: { argb: "FFFFFF" } };
    wsSummary.getCell(sRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY } };
    wsSummary.getRow(sRow).height = 30;
    sRow++;

    const detHeaders = ["#", "Region", "Employee", "HRID", "Work Days", "Off Days", "Fri Days", "Sat Days", "Consecutive", "Notes"];
    detHeaders.forEach((h, ci) => {
      const cell = wsSummary.getCell(sRow, ci + 1);
      cell.value = h;
      applyHeaderStyle(cell);
    });
    wsSummary.getRow(sRow).height = 26;
    sRow++;

    let detIdx = 0;
    for (const regionStat of allHelpDeskStats) {
      for (const emp of regionStat.employees) {
        const row = sRow + detIdx;
        const vals = [
          detIdx + 1,
          regionStat.regionLabel,
          emp.name,
          emp.hrid,
          emp.workDays,
          emp.offDays,
          emp.friDays,
          emp.satDays,
          emp.consecutive,
        ];
        vals.forEach((val, ci) => {
          const cell = wsSummary.getCell(row, ci + 1);
          cell.value = val;
          applyDataStyle(cell, detIdx);
          cell.alignment = { horizontal: "center", vertical: "middle" };
        });
        wsSummary.getCell(row, 2).alignment = { horizontal: "left" };
        wsSummary.getCell(row, 3).alignment = { horizontal: "left" };
        wsSummary.getCell(row, 3).font = { bold: true, size: 10 };

        // Highlight consecutive violations
        if (emp.consecutive > 0) {
          wsSummary.getCell(row, 9).font = { bold: true, color: { argb: RED }, size: 11 };
          wsSummary.getCell(row, 9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_RED } };
        }

        // Smart notes
        const notesCell = wsSummary.getCell(row, 10);
        let notes = "";
        if (emp.consecutive > 0) {
          notes = `🔴 ${emp.consecutive} consecutive violations`;
        }
        if (emp.workDays === regionStat.maxShifts && regionStat.variance > 1) {
          notes += notes ? " | " : "";
          notes += "⚠️ Has max shifts";
        }
        if (emp.workDays === regionStat.minShifts && regionStat.variance > 1) {
          notes += notes ? " | " : "";
          notes += "💡 Can take more shifts";
        }
        if (emp.friDays > emp.satDays + 1) {
          notes += notes ? " | " : "";
          notes += "📊 More Fri than Sat";
        }
        notesCell.value = notes || "✅";
        notesCell.font = { size: 9, italic: true, color: { argb: notes.includes("🔴") ? RED : N600 } };

        detIdx++;
      }
    }

    // Freeze header
    wsSummary.views = [{ state: "frozen", ySplit: 2 }];

    // ========================================
    // GENERATE AND RETURN
    // ========================================
    const buffer = await wb.xlsx.writeBuffer();

    const regionSuffix = regionsToExport.length < 3 ? `_${regionsToExport.join("_")}` : "";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Shift_Matrix_${selectedMonth || "All"}${regionSuffix}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("[export-matrix] Error:", error);
    return NextResponse.json({ error: "Failed to export matrix Excel file" }, { status: 500 });
  }
}

// ===== Helper: Get Excel column letter from index (1-based) =====
function getColLetter(col: number): string {
  let letter = "";
  let temp = col;
  while (temp > 0) {
    temp--;
    letter = String.fromCharCode(65 + (temp % 26)) + letter;
    temp = Math.floor(temp / 26);
  }
  return letter;
}
