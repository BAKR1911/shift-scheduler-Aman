export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse, isAdmin } from "@/lib/auth";
import { computeLocalStats, computeOffWeeks, getHoursForDate } from "@/lib/scheduler";
import type { Employee, Settings, ScheduleEntry } from "@/lib/scheduler";
import { db } from "@/lib/db";
import ExcelJS from "exceljs";

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const TEAL = "0D9488";
const LIGHT_TEAL = "CCFBF1";

// POST: Export schedule as Excel with region filtering + Connection Team separate sheet
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (!isAdmin(auth.role) && auth.role !== "editor") return forbiddenResponse();

  try {
    const body = await request.json();
    const { month, selectedEmployeeIds, dateFrom, dateTo, regions } = body;

    // Parse regions array from checkboxes
    let regionList: string[] = Array.isArray(regions) && regions.length > 0
      ? regions
      : ["cairo", "delta", "upper_egypt"];

    // If user has a specific region permission, restrict to that region
    if (auth.region && auth.region !== "all") {
      regionList = [auth.region];
    }

    // Fetch data from store
    const dbEmployees = await db.employee.findMany({ orderBy: { order: "asc" } });
    const dbSettings = await db.settings.findUnique();
    const genMonths = regionList.length < 3
      ? await db.generatedMonth.findMany({ where: { region: { in: regionList } }, orderBy: { monthKey: "asc" } })
      : await db.generatedMonth.findMany({ orderBy: { monthKey: "asc" } });

    // Filter employees by region
    let employees = dbEmployees.map((e) => ({
      id: e.id,
      name: e.name,
      hrid: e.hrid,
      active: e.active,
    }));

    if (regionList.length < 3) {
      employees = employees.filter((e) => {
        const dbEmp = dbEmployees.find(de => de.id === e.id);
        return dbEmp && regionList.includes(dbEmp.region);
      });
    }

    // Further filter if specific selection provided
    if (selectedEmployeeIds && Array.isArray(selectedEmployeeIds) && selectedEmployeeIds.length > 0) {
      employees = employees.filter((e) => selectedEmployeeIds.includes(e.id));
    }

    const settings: Settings = {
      shifts: dbSettings ? JSON.parse(dbSettings.shifts) : {},
      weekStart: dbSettings?.weekStart || "Friday",
      holidays: dbSettings ? JSON.parse(dbSettings.holidays) : [],
      summerTime: !!dbSettings?.summerTime,
      summerShifts: dbSettings ? JSON.parse(dbSettings.summerShifts || "{}") : {},
      dayHours: dbSettings ? JSON.parse(dbSettings.dayHours || "{}") : {},
      holidayHours: dbSettings ? JSON.parse(dbSettings.holidayHours || "{}") : {},
    };

    // Fetch connection team entries
    const connMonthKey = month || "";
    const connectionTeam = connMonthKey
      ? await db.connectionTeam.findMany({ where: { monthKey: connMonthKey } })
      : await db.connectionTeam.findMany();

    // Build connection lookup by weekStart
    const connByWeek = new Map<string, { empName: string; empHrid: string; weekStart: string; weekEnd: string }>();
    for (const ct of connectionTeam) {
      connByWeek.set(ct.weekStart, { empName: ct.empName, empHrid: ct.empHrid, weekStart: ct.weekStart, weekEnd: ct.weekEnd });
    }

    // Calculate connection team hours for a week
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

    // Build per-employee connection hours map
    const connHoursByEmp = new Map<string, number>();
    const connWeeksByEmp = new Map<string, string[]>();
    for (const ct of connectionTeam) {
      const hrs = calcConnWeekHours(ct.weekStart, ct.weekEnd);
      connHoursByEmp.set(ct.empName, (connHoursByEmp.get(ct.empName) || 0) + hrs);
      if (!connWeeksByEmp.has(ct.empName)) connWeeksByEmp.set(ct.empName, []);
      connWeeksByEmp.get(ct.empName)!.push(`${ct.weekStart} >> ${ct.weekEnd}`);
    }

    // Fetch schedule entries filtered by region
    const whereClause: Record<string, unknown> = {};
    if (month) whereClause.date = { startsWith: month };
    if (dateFrom && dateTo) whereClause.date = { gte: dateFrom, lte: dateTo };
    if (dateFrom && !dateTo) whereClause.date = { gte: dateFrom };
    if (!dateFrom && dateTo) whereClause.date = { lte: dateTo };
    if (regionList.length < 3) whereClause.region = { in: regionList };

    const dbEntries = await db.scheduleEntry.findMany({
      where: whereClause,
      orderBy: { date: "asc" },
    });

    // Map entries
    let entriesList: ScheduleEntry[] = dbEntries.map((e) => ({
      date: e.date,
      dayName: e.dayName,
      dayType: e.dayType,
      empIdx: e.empIdx,
      empName: e.empName,
      empHrid: e.empHrid,
      start: e.start,
      end: e.end,
      hours: e.hours,
      offPerson: e.offPerson,
      offPersonIdx: e.offPersonIdx,
      offPersonHrid: e.offPersonHrid,
      weekNum: e.weekNum,
      isHoliday: Boolean(e.isHoliday),
      isManual: Boolean(e.isManual),
    }));

    // If specific employees selected, filter entries to only those employees
    if (selectedEmployeeIds && Array.isArray(selectedEmployeeIds) && selectedEmployeeIds.length > 0) {
      const selectedEmpNames = new Set(employees.map((e) => e.name));
      entriesList = entriesList.filter((e) => selectedEmpNames.has(e.empName));
    }

    if (entriesList.length === 0) {
      return NextResponse.json({ error: "No entries to export" }, { status: 404 });
    }

    const n = employees.length;
    const localStats = computeLocalStats(entriesList, n);
    const offWeeksMap = computeOffWeeks(entriesList, n);

    let period = "All Months";
    const regionLabel = regionList.length < 3 ? ` [${regionList.join(", ")}]` : "";
    if (month) {
      const [y, m] = month.split("-");
      period = `${MONTH_NAMES[Number(m)]} ${y}${regionLabel}`;
    }
    if (dateFrom && dateTo) period = `${dateFrom} to ${dateTo}${regionLabel}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = "IT Helpdesk Shift Scheduler";
    wb.created = new Date();

    const PRIMARY = "1B2A4A";
    const BLUE = "1D4ED8";
    const GREEN = "059669";
    const RED = "DC2626";
    const LIGHT_BLUE = "D6E4F0";
    const LIGHT_GREEN = "E8F5E9";
    const LIGHT_RED = "FEE2E2";
    const LIGHT_AMBER = "FEF3C7";
    const LIGHT_CYAN = "E0F2FE";
    const LIGHT_GRAY = "F1F5F9";
    const LIGHT_PURPLE = "F3E8FF";
    const N600 = "64748B";

    // SHEET 1: DAILY SCHEDULE (no Connection Team inline — moved to separate sheet)
    const ws1 = wb.addWorksheet("Schedule", { properties: { tabColor: { argb: BLUE } } });
    [5, 14, 14, 12, 24, 12, 14, 14, 10, 20, 12].forEach((w, i) => ws1.getColumn(i + 1).width = w);

    ws1.mergeCells("A1:K1");
    const titleCell = ws1.getCell("A1");
    titleCell.value = `IT Helpdesk - Shift Schedule (${period})`;
    titleCell.font = { size: 16, bold: true, color: { argb: PRIMARY } };
    titleCell.alignment = { vertical: "middle" };
    ws1.getRow(1).height = 36;

    const totalHrs = entriesList.reduce((sum, e) => sum + e.hours, 0);
    const nWeeks = new Set(entriesList.map((e) => `${e.date.substring(0, 7)}-W${e.weekNum}`)).size;
    const holidays = entriesList.filter((e) => e.isHoliday).length;

    const kpis = [
      { label: "Weeks", value: nWeeks },
      { label: "Work Days", value: entriesList.length },
      { label: "Holidays", value: holidays },
      { label: "Total Hours", value: `${totalHrs.toFixed(1)}h` },
    ];

    const kpiRow = ws1.getRow(3);
    kpiRow.height = 36;
    kpis.forEach((kpi, i) => {
      const col = i * 3 + 1;
      ws1.mergeCells(3, col, 3, col + 1);
      const valCell = ws1.getCell(3, col);
      valCell.value = String(kpi.value);
      valCell.font = { size: 20, bold: true, color: { argb: PRIMARY } };
      valCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
      valCell.alignment = { horizontal: "center", vertical: "middle" };
      valCell.border = { top: { style: "thin", color: { argb: "E2E8F0" } }, left: { style: "thin", color: { argb: "E2E8F0" } }, bottom: { style: "thin", color: { argb: "E2E8F0" } }, right: { style: "thin", color: { argb: "E2E8F0" } } };
      ws1.mergeCells(4, col, 4, col + 1);
      const lblCell = ws1.getCell(4, col);
      lblCell.value = kpi.label;
      lblCell.font = { size: 9, color: { argb: N600 } };
      lblCell.alignment = { horizontal: "center" };
    });

    const headerRow = 6;
    const headers = ["#", "Date", "Day", "Type", "Employee", "HRID", "Start", "End", "Hours", "OFF Person", "OFF HRID"];
    const hdrRow = ws1.getRow(headerRow);
    hdrRow.height = 28;
    headers.forEach((h, ci) => {
      const cell = hdrRow.getCell(ci + 1);
      cell.value = h;
      cell.font = { size: 11, bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = { top: { style: "thin", color: { argb: PRIMARY } }, left: { style: "thin", color: { argb: PRIMARY } }, bottom: { style: "medium", color: { argb: PRIMARY } }, right: { style: "thin", color: { argb: PRIMARY } } };
    });

    let row = headerRow + 1;
    let entryNum = 0;
    const weekGroups: Record<string, ScheduleEntry[]> = {};
    for (const e of entriesList) {
      const wk = `${e.date.substring(0, 7)}-W${e.weekNum}`;
      if (!weekGroups[wk]) weekGroups[wk] = [];
      weekGroups[wk].push(e);
    }

    let weekIndex = 0;
    for (const wk of Object.keys(weekGroups).sort()) {
      const weekEntries = weekGroups[wk];
      weekEntries.sort((a, b) => a.date.localeCompare(b.date));
      const wh = weekEntries.reduce((s, e) => s + e.hours, 0);
      const offPerson = weekEntries[0].offPerson;
      // IMPORTANT: Connection Team weeks are keyed by their actual generated weekStart.
      // With monthStartMode="monthDay1", week start is NOT guaranteed to be Friday.
      const connPerson = connByWeek.get(weekEntries[0].date);

      // Build week header text
      let weekHeaderText = `Week ${weekIndex + 1}: ${weekEntries[0].date} >> ${weekEntries[weekEntries.length - 1].date}  |  ${weekEntries.length} days  |  ${wh.toFixed(1)}h  |  OFF: ${offPerson}`;
      if (connPerson) {
        const connWeekHrs = calcConnWeekHours(connPerson.weekStart, connPerson.weekEnd);
        weekHeaderText += `  |  Connection Team: ${connPerson.empName} (${connWeekHrs.toFixed(1)}h)`;
      }

      ws1.mergeCells(row, 1, row, 11);
      const weekCell = ws1.getCell(row, 1);
      weekCell.value = weekHeaderText;
      weekCell.font = { size: 11, bold: true, color: { argb: "FFFFFF" } };
      weekCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
      weekCell.alignment = { vertical: "middle" };
      ws1.getRow(row).height = 26;
      row++;
      weekIndex++;

      for (const e of weekEntries) {
        entryNum++;
        const dt = e.dayType;
        const isHol = e.isHoliday;
        const typeColor = isHol ? LIGHT_RED : dt === "Saturday" ? LIGHT_BLUE : dt === "Friday" ? LIGHT_AMBER : dt === "Thursday" ? LIGHT_CYAN : LIGHT_GREEN;
        const rowFill = weekIndex % 2 === 0 ? "FFFFFF" : LIGHT_GRAY;
        const typeLabel = isHol ? "Holiday" : dt;
        const vals = [entryNum, e.date, e.dayName, typeLabel, e.empName, e.empHrid, e.start, e.end, e.hours, e.offPerson, e.offPersonHrid];
        const dataRow = ws1.getRow(row);
        dataRow.height = 22;
        vals.forEach((val, ci) => {
          const cell = dataRow.getCell(ci + 1);
          cell.value = val;
          cell.border = { top: { style: "thin", color: { argb: "E2E8F0" } }, left: { style: "thin", color: { argb: "E2E8F0" } }, bottom: { style: "thin", color: { argb: "E2E8F0" } }, right: { style: "thin", color: { argb: "E2E8F0" } } };
          cell.alignment = { horizontal: "center", vertical: "middle" };
          if (ci === 3) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: typeColor } };
            if (isHol) cell.font = { color: { argb: RED }, bold: true };
          } else if (ci === 9) {
            cell.font = { color: { argb: RED }, bold: true };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_PURPLE } };
            cell.alignment = { horizontal: "left", vertical: "middle" };
          } else if (ci === 4) {
            cell.font = { bold: true };
            cell.alignment = { horizontal: "left", vertical: "middle" };
          } else {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
          }
          if (ci === 8 && typeof val === "number") cell.numFmt = "0.0";
        });
        row++;
      }
    }
    ws1.views = [{ state: "frozen", ySplit: headerRow }];

    // SHEET 2: EMPLOYEE SUMMARY (without Connection hours — they have their own sheet)
    const ws2 = wb.addWorksheet("Employee Summary", { properties: { tabColor: { argb: GREEN } } });
    [5, 24, 12, 14, 14, 14, 14, 14, 16, 14].forEach((w, i) => ws2.getColumn(i + 1).width = w);

    ws2.mergeCells("A1:J1");
    ws2.getCell("A1").value = `IT Helpdesk - Employee Summary (${period})`;
    ws2.getCell("A1").font = { size: 16, bold: true, color: { argb: PRIMARY } };
    ws2.getRow(1).height = 36;

    const summaryHeaders = ["#", "Employee Name", "HRID", "Work Days", "Schedule Hours", "Sat Days", "Fri Days", "Weekend Days", "Total Hours", "OFF Weeks"];
    const shRow = ws2.getRow(4);
    shRow.height = 28;
    summaryHeaders.forEach((h, ci) => {
      const cell = shRow.getCell(ci + 1);
      cell.value = h;
      cell.font = { size: 11, bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });

    employees.forEach((emp, i) => {
      const r = 5 + i;
      const ls = localStats[i] || { days: 0, hours: 0, weekend: 0, sat: 0, fri: 0, offWeeks: 0 };
      const offW = offWeeksMap[i] || 0;
      const fill = i % 2 === 0 ? "FFFFFF" : LIGHT_GRAY;
      const vals = [i + 1, emp.name, emp.hrid, ls.days, Math.round(ls.hours * 10) / 10, ls.sat, ls.fri, ls.weekend, Math.round(ls.hours * 10) / 10, offW];
      const dataRow = ws2.getRow(r);
      dataRow.height = 22;
      vals.forEach((val, ci) => {
        const cell = dataRow.getCell(ci + 1);
        cell.value = val;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: { style: "thin", color: { argb: "E2E8F0" } }, left: { style: "thin", color: { argb: "E2E8F0" } }, bottom: { style: "thin", color: { argb: "E2E8F0" } }, right: { style: "thin", color: { argb: "E2E8F0" } } };
        if (ci === 1) cell.alignment = { horizontal: "left", vertical: "middle" };
        if (ci === 4) { cell.numFmt = "0.0"; cell.font = { color: { argb: BLUE }, bold: true }; }
        if (ci === 8) {
          cell.numFmt = "0.0";
          cell.font = { color: { argb: PRIMARY }, bold: true };
        }
        if (ci === 9) cell.font = { color: { argb: RED }, bold: true };
      });
    });

    const allHrs = employees.map((_, i) => localStats[i]?.hours || 0);
    const variance = allHrs.length > 0 ? Math.max(...allHrs) - Math.min(...allHrs) : 0;
    const avgHrs = allHrs.length > 0 ? allHrs.reduce((a, b) => a + b, 0) / allHrs.length : 0;
    const vr = 5 + employees.length + 1;

    ws2.getCell(vr, 2).value = "Average Hours / Person";
    ws2.getCell(vr, 2).font = { bold: true };
    ws2.getCell(vr, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
    ws2.getCell(vr, 5).value = Math.round(avgHrs * 10) / 10;
    ws2.getCell(vr, 5).font = { color: { argb: BLUE }, bold: true };
    ws2.getCell(vr, 5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
    ws2.getCell(vr, 5).numFmt = "0.0";
    ws2.getCell(vr, 5).alignment = { horizontal: "center" };

    ws2.getCell(vr + 1, 2).value = "Hours Variance (Max-Min)";
    ws2.getCell(vr + 1, 2).font = { bold: true };
    ws2.getCell(vr + 1, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
    ws2.getCell(vr + 1, 5).value = Math.round(variance * 10) / 10;
    ws2.getCell(vr + 1, 5).font = { color: { argb: RED }, bold: true };
    ws2.getCell(vr + 1, 5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
    ws2.getCell(vr + 1, 5).numFmt = "0.0";
    ws2.getCell(vr + 1, 5).alignment = { horizontal: "center" };

    // SHEET 3: CONNECTION TEAM (Separate dedicated sheet)
    const ws3 = wb.addWorksheet("Connection Team", { properties: { tabColor: { argb: TEAL } } });
    [5, 24, 12, 14, 30, 14, 14].forEach((w, i) => ws3.getColumn(i + 1).width = w);

    ws3.mergeCells("A1:G1");
    ws3.getCell("A1").value = `Connection Team (${period})`;
    ws3.getCell("A1").font = { size: 16, bold: true, color: { argb: TEAL } };
    ws3.getRow(1).height = 36;

    // Connection Team summary header
    const ctHeaders = ["#", "Employee Name", "HRID", "Total Hours", "Weeks Assigned", "Week Details", "Avg Hours/Week"];
    const ctHdrRow = ws3.getRow(3);
    ctHdrRow.height = 28;
    ctHeaders.forEach((h, ci) => {
      const cell = ctHdrRow.getCell(ci + 1);
      cell.value = h;
      cell.font = { size: 11, bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });

    // Get unique connection team members
    const connMembers = new Map<string, { name: string; hrid: string }>();
    for (const ct of connectionTeam) {
      if (!connMembers.has(ct.empName)) {
        connMembers.set(ct.empName, { name: ct.empName, hrid: ct.empHrid });
      }
    }

    let ctIdx = 0;
    for (const [, member] of connMembers) {
      const r = 4 + ctIdx;
      const totalConnHrs = connHoursByEmp.get(member.name) || 0;
      const weeks = connWeeksByEmp.get(member.name) || [];
      const avgHrsPerWeek = weeks.length > 0 ? totalConnHrs / weeks.length : 0;
      const fill = ctIdx % 2 === 0 ? "FFFFFF" : LIGHT_TEAL;

      ws3.getCell(r, 1).value = ctIdx + 1;
      ws3.getCell(r, 1).alignment = { horizontal: "center", vertical: "middle" };
      ws3.getCell(r, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };

      ws3.getCell(r, 2).value = member.name;
      ws3.getCell(r, 2).font = { bold: true, color: { argb: TEAL } };
      ws3.getCell(r, 2).alignment = { horizontal: "left", vertical: "middle" };
      ws3.getCell(r, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };

      ws3.getCell(r, 3).value = member.hrid;
      ws3.getCell(r, 3).alignment = { horizontal: "center", vertical: "middle" };
      ws3.getCell(r, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };

      ws3.getCell(r, 4).value = Math.round(totalConnHrs * 10) / 10;
      ws3.getCell(r, 4).numFmt = "0.0";
      ws3.getCell(r, 4).font = { bold: true, color: { argb: TEAL } };
      ws3.getCell(r, 4).alignment = { horizontal: "center", vertical: "middle" };
      ws3.getCell(r, 4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };

      ws3.getCell(r, 5).value = weeks.length;
      ws3.getCell(r, 5).alignment = { horizontal: "center", vertical: "middle" };
      ws3.getCell(r, 5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };

      ws3.getCell(r, 6).value = weeks.join("\n");
      ws3.getCell(r, 6).font = { size: 9 };
      ws3.getCell(r, 6).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      ws3.getCell(r, 6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };

      ws3.getCell(r, 7).value = Math.round(avgHrsPerWeek * 10) / 10;
      ws3.getCell(r, 7).numFmt = "0.0";
      ws3.getCell(r, 7).alignment = { horizontal: "center", vertical: "middle" };
      ws3.getCell(r, 7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };

      // Add borders
      for (let c = 1; c <= 7; c++) {
        ws3.getCell(r, c).border = { top: { style: "thin", color: { argb: "E2E8F0" } }, left: { style: "thin", color: { argb: "E2E8F0" } }, bottom: { style: "thin", color: { argb: "E2E8F0" } }, right: { style: "thin", color: { argb: "E2E8F0" } } };
      }
      ws3.getRow(r).height = Math.max(22, weeks.length * 14);
      ctIdx++;
    }

    if (connMembers.size === 0) {
      const r = 4;
      ws3.mergeCells(r, 1, r, 7);
      ws3.getCell(r, 1).value = "No Connection Team assignments for this period.";
      ws3.getCell(r, 1).font = { italic: true, color: { argb: N600 } };
      ws3.getCell(r, 1).alignment = { horizontal: "center" };
    }

    // Connection Team totals
    const totalConnHrsAll = Array.from(connHoursByEmp.values()).reduce((a, b) => a + b, 0);
    const totalConnWeeks = connectionTeam.length;
    const connTotalRow = 4 + connMembers.size + 1;
    ws3.mergeCells(connTotalRow, 1, connTotalRow, 3);
    ws3.getCell(connTotalRow, 1).value = "Total Connection Team";
    ws3.getCell(connTotalRow, 1).font = { bold: true };
    ws3.getCell(connTotalRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_TEAL } };
    ws3.getCell(connTotalRow, 4).value = Math.round(totalConnHrsAll * 10) / 10;
    ws3.getCell(connTotalRow, 4).numFmt = "0.0";
    ws3.getCell(connTotalRow, 4).font = { bold: true, color: { argb: TEAL } };
    ws3.getCell(connTotalRow, 4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_TEAL } };
    ws3.getCell(connTotalRow, 4).alignment = { horizontal: "center" };
    ws3.getCell(connTotalRow, 5).value = totalConnWeeks;
    ws3.getCell(connTotalRow, 5).font = { bold: true };
    ws3.getCell(connTotalRow, 5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_TEAL } };
    ws3.getCell(connTotalRow, 5).alignment = { horizontal: "center" };

    // Weekly detail breakdown
    const detailStartRow = connTotalRow + 2;
    ws3.mergeCells(detailStartRow, 1, detailStartRow, 7);
    ws3.getCell(detailStartRow, 1).value = "Weekly Breakdown";
    ws3.getCell(detailStartRow, 1).font = { size: 13, bold: true, color: { argb: TEAL } };

    const detailHeaders = ["Week Period", "Employee", "HRID", "Week Hours", ""];
    const dhRow = ws3.getRow(detailStartRow + 1);
    dhRow.height = 24;
    ["Week Period", "Employee", "HRID", "Week Hours"].forEach((h, ci) => {
      const cell = dhRow.getCell(ci + 1);
      cell.value = h;
      cell.font = { size: 10, bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });

    const sortedCT = [...connectionTeam].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    sortedCT.forEach((ct, idx) => {
      const r = detailStartRow + 2 + idx;
      const hrs = calcConnWeekHours(ct.weekStart, ct.weekEnd);
      const fill = idx % 2 === 0 ? "FFFFFF" : LIGHT_TEAL;
      [`${ct.weekStart} >> ${ct.weekEnd}`, ct.empName, ct.empHrid, Math.round(hrs * 10) / 10].forEach((val, ci) => {
        const cell = ws3.getCell(r, ci + 1);
        cell.value = val;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: { style: "thin", color: { argb: "E2E8F0" } }, left: { style: "thin", color: { argb: "E2E8F0" } }, bottom: { style: "thin", color: { argb: "E2E8F0" } }, right: { style: "thin", color: { argb: "E2E8F0" } } };
        if (ci === 1) cell.font = { bold: true, color: { argb: TEAL } };
        if (ci === 3) { cell.numFmt = "0.0"; cell.font = { bold: true }; }
      });
    });

    // SHEET 4: CUMULATIVE BALANCE
    const ws4 = wb.addWorksheet("Cumulative Balance", { properties: { tabColor: { argb: "D97706" } } });
    [5, 24, 12, 14, 14, 14, 14, 14].forEach((w, i) => ws4.getColumn(i + 1).width = w);

    ws4.mergeCells("A1:H1");
    ws4.getCell("A1").value = `IT Helpdesk - Cumulative Balance${regionLabel ? ` (${regionList.join(", ")})` : " (All Months)"}`;
    ws4.getCell("A1").font = { size: 16, bold: true, color: { argb: PRIMARY } };
    ws4.getRow(1).height = 36;

    let row4 = 3;
    const allMonths = genMonths.map((g) => g.monthKey);
    for (const monthKey of allMonths.sort()) {
      const [y, m] = monthKey.split("-");
      const monthLabel = `${MONTH_NAMES[Number(m)]} ${y}`;
      const monthEntries = entriesList.filter((e) => e.date.startsWith(monthKey));
      const mLocalStats = computeLocalStats(monthEntries, n);
      const mOffWeeks = computeOffWeeks(monthEntries, n);

      ws4.mergeCells(row4, 1, row4, 8);
      ws4.getCell(row4, 1).value = `${monthLabel} - Summary`;
      ws4.getCell(row4, 1).font = { size: 13, bold: true, color: { argb: PRIMARY } };
      row4++;

      ["#", "Employee", "HRID", "Work Days", "Total Hours", "Weekends", "Sat Days", "OFF Weeks"].forEach((h, ci) => {
        const cell = ws4.getCell(row4, ci + 1);
        cell.value = h;
        cell.font = { size: 11, bold: true, color: { argb: "FFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });
      row4++;

      const cumHrs: number[] = [];
      employees.forEach((emp, i) => {
        const hrs = mLocalStats[i]?.hours || 0;
        cumHrs.push(hrs);
        const offW = mOffWeeks[i] || 0;
        const fill = i % 2 === 0 ? "FFFFFF" : LIGHT_GRAY;
        [i + 1, emp.name, emp.hrid, mLocalStats[i]?.days || 0, Math.round(hrs * 10) / 10, mLocalStats[i]?.weekend || 0, mLocalStats[i]?.sat || 0, offW].forEach((val, ci) => {
          const cell = ws4.getCell(row4, ci + 1);
          cell.value = val;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = { top: { style: "thin", color: { argb: "E2E8F0" } }, left: { style: "thin", color: { argb: "E2E8F0" } }, bottom: { style: "thin", color: { argb: "E2E8F0" } }, right: { style: "thin", color: { argb: "E2E8F0" } } };
          if (ci === 4) cell.numFmt = "0.0";
          if (ci === 7) cell.font = { color: { argb: RED } };
        });
        row4++;
      });

      const cVar = cumHrs.length > 0 ? Math.max(...cumHrs) - Math.min(...cumHrs) : 0;
      const cAvg = cumHrs.length > 0 ? cumHrs.reduce((a, b) => a + b, 0) / cumHrs.length : 0;
      ws4.mergeCells(row4, 1, row4, 8);
      ws4.getCell(row4, 1).value = `Variance: ${cVar.toFixed(1)}h | Avg: ${cAvg.toFixed(1)}h`;
      ws4.getCell(row4, 1).font = { size: 10, color: { argb: N600 } };
      for (let c = 1; c <= 8; c++) {
        ws4.getCell(row4, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
      }
      row4 += 2;
    }

    const buffer = await wb.xlsx.writeBuffer();

    const regionSuffix = regionList.length < 3 ? `_${regionList.join("_")}` : "";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="IT_Helpdesk_Schedule_${month || "All"}${regionSuffix}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Error exporting Excel:", error);
    return NextResponse.json({ error: "Failed to export Excel file" }, { status: 500 });
  }
}
