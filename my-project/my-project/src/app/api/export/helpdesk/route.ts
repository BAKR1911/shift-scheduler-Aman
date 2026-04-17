import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse } from "@/lib/auth";
import { db } from "@/lib/db";
import ExcelJS from "exceljs";

// POST: Export Helpdesk schedule to Excel
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const body = await request.json();
    const { month, selectedEmployeeIds, dateFrom, dateTo, region } = body;

    console.log("[Export Helpdesk] Request:", { month, selectedEmployeeIds, dateFrom, dateTo, region });

    // Fetch all schedule entries and employees
    const allEntries = await db.scheduleEntry.findMany();
    const allEmployees = await db.employee.findMany();

    // Filter by region
    let helpdeskEntries = allEntries.filter((e) => {
      const inMonth = month ? e.date.startsWith(month) : true;
      const inDateRange = dateFrom && dateTo
        ? e.date >= dateFrom && e.date <= dateTo
        : true;
      const inRegion = region && region !== "all" ? e.region === region : true;
      return inMonth && inDateRange && inRegion;
    });

    let helpdeskData = helpdeskEntries;

    // Filter by selected employees if specified
    if (selectedEmployeeIds && selectedEmployeeIds.length > 0) {
      helpdeskData = helpdeskData.filter((e) => {
        const emp = allEmployees.find((emp) => emp.id === e.empIdx);
        return emp && selectedEmployeeIds.includes(emp.id);
      });
    }

    console.log("[Export Helpdesk] Found entries:", helpdeskData.length);

    // Create Excel workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = "IT Helpdesk Shift Scheduler";
    wb.created = new Date();

    // ===== SHEET 1: DAILY SCHEDULE =====
    const ws1 = wb.addWorksheet("Helpdesk Schedule");
    ws1.columns = [
      { header: "Date", key: "date", width: 15 },
      { header: "Day", key: "day", width: 12 },
      { header: "Type", key: "type", width: 15 },
      { header: "Employee", key: "employee", width: 24 },
      { header: "HRID", key: "hrid", width: 12 },
      { header: "Start", key: "start", width: 12 },
      { header: "End", key: "end", width: 12 },
      { header: "Hours", key: "hours", width: 10 },
      { header: "OFF Person", key: "offPerson", width: 20 },
      { header: "Holiday", key: "holiday", width: 10 },
    ];

    // Add title
    ws1.mergeCells("A1:J1");
    const titleCell1 = ws1.getCell("A1");
    const regionLabel = region && region !== "all" ? ` [${region.toUpperCase()}]` : " [ALL REGIONS]";
    titleCell1.value = `IT Helpdesk Schedule${regionLabel}`;
    titleCell1.font = { size: 16, bold: true, color: { argb: "059669" } };
    titleCell1.alignment = { horizontal: "center", vertical: "middle" };
    ws1.getRow(1).height = 36;

    // Add period info
    let periodText = "All Data";
    if (month) {
      const [y, m] = month.split("-");
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      periodText = `${monthNames[Number(m) - 1]} ${y}`;
    }
    if (dateFrom && dateTo) {
      periodText = `${dateFrom} to ${dateTo}`;
    }
    ws1.mergeCells("A2:J2");
    const periodCell1 = ws1.getCell("A2");
    periodCell1.value = periodText;
    periodCell1.font = { size: 12, italic: true, color: { argb: "64748B" } };
    periodCell1.alignment = { horizontal: "center" };
    ws1.getRow(2).height = 24;

    // Style header
    const headerRow1 = 4;
    const headers1 = ["Date", "Day", "Type", "Employee", "HRID", "Start", "End", "Hours", "OFF Person", "Holiday"];
    headers1.forEach((h, i) => {
      const cell = ws1.getCell(headerRow1, i + 1);
      cell.value = h;
      cell.font = { size: 11, bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "059669" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    ws1.getRow(headerRow1).height = 28;

    // Add data
    helpdeskData.forEach((e, idx) => {
      const row = headerRow1 + 1 + idx;
      const isHoliday = Boolean(e.isHoliday);
      const rowFill = idx % 2 === 0 ? "FFFFFF" : "F0FDF4";

      ws1.getCell(row, 1).value = e.date;
      ws1.getCell(row, 1).alignment = { horizontal: "center", vertical: "middle" };
      ws1.getCell(row, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws1.getCell(row, 2).value = e.dayName;
      ws1.getCell(row, 2).alignment = { horizontal: "center", vertical: "middle" };
      ws1.getCell(row, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      const typeLabel = isHoliday ? "Holiday" : e.dayType;
      const typeColor = isHoliday ? "FEE2E2" : e.dayType === "Saturday" ? "DBEAFE" : e.dayType === "Friday" ? "FEF3C7" : "DCFCE7";

      ws1.getCell(row, 3).value = typeLabel;
      ws1.getCell(row, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: typeColor } };
      ws1.getCell(row, 3).alignment = { horizontal: "center", vertical: "middle" };
      if (isHoliday) {
        ws1.getCell(row, 3).font = { color: { argb: "DC2626" }, bold: true };
      }

      ws1.getCell(row, 4).value = e.empName;
      ws1.getCell(row, 4).alignment = { horizontal: "left", vertical: "middle" };
      ws1.getCell(row, 4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      ws1.getCell(row, 4).font = { bold: true };

      ws1.getCell(row, 5).value = e.empHrid;
      ws1.getCell(row, 5).alignment = { horizontal: "center", vertical: "middle" };
      ws1.getCell(row, 5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws1.getCell(row, 6).value = e.start;
      ws1.getCell(row, 6).alignment = { horizontal: "center", vertical: "middle" };
      ws1.getCell(row, 6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws1.getCell(row, 7).value = e.end;
      ws1.getCell(row, 7).alignment = { horizontal: "center", vertical: "middle" };
      ws1.getCell(row, 7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws1.getCell(row, 8).value = e.hours;
      ws1.getCell(row, 8).numFmt = "0.0";
      ws1.getCell(row, 8).alignment = { horizontal: "center", vertical: "middle" };
      ws1.getCell(row, 8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      ws1.getCell(row, 8).font = { color: { argb: "059669" }, bold: true };

      ws1.getCell(row, 9).value = e.offPerson || "";
      ws1.getCell(row, 9).alignment = { horizontal: "left", vertical: "middle" };
      ws1.getCell(row, 9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      if (e.offPerson) {
        ws1.getCell(row, 9).font = { color: { argb: "DC2626" }, bold: true };
      }

      ws1.getCell(row, 10).value = isHoliday ? "Yes" : "No";
      ws1.getCell(row, 10).alignment = { horizontal: "center", vertical: "middle" };
      ws1.getCell(row, 10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
    });

    // Add Helpdesk summary
    const helpdeskSummaryRow = headerRow1 + helpdeskData.length + 2;
    const totalHours1 = helpdeskData.reduce((sum, e) => sum + e.hours, 0);
    const workDays1 = helpdeskData.filter(e => e.hours > 0).length;
    const holidays1 = helpdeskData.filter(e => e.isHoliday).length;

    ws1.mergeCells(helpdeskSummaryRow, 1, helpdeskSummaryRow, 10);
    const summaryCell1 = ws1.getCell(helpdeskSummaryRow, 1);
    summaryCell1.value = `HELPDESK SUMMARY: ${helpdeskData.length} entries | ${workDays1} work days | ${totalHours1.toFixed(1)} total hours | ${holidays1} holidays`;
    summaryCell1.font = { size: 11, bold: true, color: { argb: "059669" } };
    summaryCell1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "DCFCE7" } };
    summaryCell1.alignment = { horizontal: "center", vertical: "middle" };
    ws1.getRow(helpdeskSummaryRow).height = 28;

    ws1.views = [{ state: "frozen", ySplit: headerRow1 }];

    // ===== SHEET 2: EMPLOYEE SUMMARY =====
    const ws2 = wb.addWorksheet("Employee Summary");
    ws2.columns = [
      { header: "Employee", key: "name", width: 24 },
      { header: "HRID", key: "hrid", width: 12 },
      { header: "Work Days", key: "workDays", width: 12 },
      { header: "Total Hours", key: "totalHours", width: 12 },
    ];

    // Add title
    ws2.mergeCells("A1:D1");
    const titleCell2 = ws2.getCell("A1");
    titleCell2.value = `Employee Summary${regionLabel}`;
    titleCell2.font = { size: 16, bold: true, color: { argb: "059669" } };
    titleCell2.alignment = { horizontal: "center", vertical: "middle" };
    ws2.getRow(1).height = 36;

    ws2.mergeCells("A2:D2");
    ws2.getCell("A2").value = periodText;
    ws2.getCell("A2").font = { size: 12, italic: true, color: { argb: "64748B" } };
    ws2.getCell("A2").alignment = { horizontal: "center" };
    ws2.getRow(2).height = 24;

    // Style header
    const headerRow2 = 4;
    const headers2 = ["Employee", "HRID", "Work Days", "Total Hours"];
    headers2.forEach((h, i) => {
      const cell = ws2.getCell(headerRow2, i + 1);
      cell.value = h;
      cell.font = { size: 11, bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "059669" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    ws2.getRow(headerRow2).height = 28;

    // Calculate employee stats
    const employeeStats = new Map<string, { name: string; hrid: string; workDays: number; totalHours: number }>();
    
    helpdeskData.forEach((e) => {
      const key = `${e.empHrid}_${e.empName}`;
      if (!employeeStats.has(key)) {
        employeeStats.set(key, { name: e.empName, hrid: e.empHrid, workDays: 0, totalHours: 0 });
      }
      const stats = employeeStats.get(key)!;
      if (e.hours > 0) {
        stats.workDays++;
        stats.totalHours += e.hours;
      }
    });

    // Add employee data
    let empRow = headerRow2 + 1;
    for (const [, stats] of employeeStats) {
      const rowFill = (empRow - headerRow2) % 2 === 0 ? "FFFFFF" : "F0FDF4";

      ws2.getCell(empRow, 1).value = stats.name;
      ws2.getCell(empRow, 1).alignment = { horizontal: "left", vertical: "middle" };
      ws2.getCell(empRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      ws2.getCell(empRow, 1).font = { bold: true };

      ws2.getCell(empRow, 2).value = stats.hrid;
      ws2.getCell(empRow, 2).alignment = { horizontal: "center", vertical: "middle" };
      ws2.getCell(empRow, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws2.getCell(empRow, 3).value = stats.workDays;
      ws2.getCell(empRow, 3).alignment = { horizontal: "center", vertical: "middle" };
      ws2.getCell(empRow, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws2.getCell(empRow, 4).value = stats.totalHours.toFixed(1);
      ws2.getCell(empRow, 4).numFmt = "0.0";
      ws2.getCell(empRow, 4).alignment = { horizontal: "center", vertical: "middle" };
      ws2.getCell(empRow, 4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      ws2.getCell(empRow, 4).font = { color: { argb: "059669" }, bold: true };

      empRow++;
    }

    // Add total summary for all employees
    const allEmpSummaryRow = empRow + 1;
    const allEmps = Array.from(employeeStats.values());
    const totalWorkDays = allEmps.reduce((sum, e) => sum + e.workDays, 0);
    const totalEmpHours = allEmps.reduce((sum, e) => sum + e.totalHours, 0);

    ws2.mergeCells(allEmpSummaryRow, 1, allEmpSummaryRow, 4);
    const summaryCell2 = ws2.getCell(allEmpSummaryRow, 1);
    summaryCell2.value = `TOTAL: ${allEmps.length} employees | ${totalWorkDays} work days | ${totalEmpHours.toFixed(1)} total hours`;
    summaryCell2.font = { size: 12, bold: true, color: { argb: "FFFFFF" } };
    summaryCell2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "059669" } };
    summaryCell2.alignment = { horizontal: "center", vertical: "middle" };
    ws2.getRow(allEmpSummaryRow).height = 30;

    ws2.views = [{ state: "frozen", ySplit: headerRow2 }];

    // ===== SHEET 3: CONNECTION TEAM SUMMARY =====
    const monthKey = month || (dateFrom ? dateFrom.substring(0, 7) : "");
    const connectionEntries = monthKey ? await db.connectionTeam.findMany({ where: { monthKey } }) : await db.connectionTeam.findMany();
    
    // Filter by date range
    let filteredConnection = connectionEntries;
    if (dateFrom) {
      filteredConnection = filteredConnection.filter((e) => e.weekStart >= dateFrom);
    }
    if (dateTo) {
      filteredConnection = filteredConnection.filter((e) => e.weekStart <= dateTo);
    }

    const ws3 = wb.addWorksheet("Connection Team Summary");
    ws3.columns = [
      { header: "Employee", key: "empName", width: 24 },
      { header: "HRID", key: "empHrid", width: 15 },
      { header: "Weeks Assigned", key: "weeks", width: 15 },
      { header: "Total Hours", key: "hours", width: 12 },
    ];

    // Add title
    ws3.mergeCells("A1:D1");
    const titleCell3 = ws3.getCell("A1");
    titleCell3.value = "Connection Team Summary";
    titleCell3.font = { size: 16, bold: true, color: { argb: "0D9488" } };
    titleCell3.alignment = { horizontal: "center", vertical: "middle" };
    ws3.getRow(1).height = 36;

    ws3.mergeCells("A2:D2");
    ws3.getCell("A2").value = periodText;
    ws3.getCell("A2").font = { size: 12, italic: true, color: { argb: "64748B" } };
    ws3.getCell("A2").alignment = { horizontal: "center" };
    ws3.getRow(2).height = 24;

    // Style header
    const headerRow3 = 4;
    const headers3 = ["Employee", "HRID", "Weeks Assigned", "Total Hours"];
    headers3.forEach((h, i) => {
      const cell = ws3.getCell(headerRow3, i + 1);
      cell.value = h;
      cell.font = { size: 11, bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0D9488" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    ws3.getRow(headerRow3).height = 28;

    // Calculate connection team stats
    const connStats = new Map<string, { name: string; hrid: string; weeks: string[] }>();
    filteredConnection.forEach((ct) => {
      const key = `${ct.empHrid}_${ct.empName}`;
      if (!connStats.has(key)) {
        connStats.set(key, { name: ct.empName, hrid: ct.empHrid, weeks: [] });
      }
      const weekKey = `${ct.weekStart} >> ${ct.weekEnd}`;
      const stats = connStats.get(key)!;
      if (!stats.weeks.includes(weekKey)) {
        stats.weeks.push(weekKey);
      }
    });

    // Add connection team data
    let connRow = headerRow3 + 1;
    for (const [, stats] of connStats) {
      const rowFill = (connRow - headerRow3) % 2 === 0 ? "FFFFFF" : "CCFBF1";
      const totalConnHours = stats.weeks.length * 42; // 42 hours per week (7 days * 6 hours)

      ws3.getCell(connRow, 1).value = stats.name;
      ws3.getCell(connRow, 1).alignment = { horizontal: "left", vertical: "middle" };
      ws3.getCell(connRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      ws3.getCell(connRow, 1).font = { bold: true, color: { argb: "0D9488" } };

      ws3.getCell(connRow, 2).value = stats.hrid;
      ws3.getCell(connRow, 2).alignment = { horizontal: "center", vertical: "middle" };
      ws3.getCell(connRow, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws3.getCell(connRow, 3).value = stats.weeks.length;
      ws3.getCell(connRow, 3).alignment = { horizontal: "center", vertical: "middle" };
      ws3.getCell(connRow, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws3.getCell(connRow, 4).value = totalConnHours;
      ws3.getCell(connRow, 4).numFmt = "0.0";
      ws3.getCell(connRow, 4).alignment = { horizontal: "center", vertical: "middle" };
      ws3.getCell(connRow, 4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      ws3.getCell(connRow, 4).font = { color: { argb: "0D9488" }, bold: true };

      connRow++;
    }

    // Add total summary for connection team
    const totalConnSummaryRow = connRow + 1;
    const totalConnEmployees = connStats.size;
    const totalConnWeeks = Array.from(connStats.values()).reduce((sum, stats) => sum + stats.weeks.length, 0);
    const totalConnHoursAll = totalConnWeeks * 42;

    ws3.mergeCells(totalConnSummaryRow, 1, totalConnSummaryRow, 4);
    const summaryCell3 = ws3.getCell(totalConnSummaryRow, 1);
    summaryCell3.value = `TOTAL: ${totalConnEmployees} employees | ${totalConnWeeks} total weeks assigned | ${totalConnHoursAll} total hours`;
    summaryCell3.font = { size: 12, bold: true, color: { argb: "FFFFFF" } };
    summaryCell3.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0D9488" } };
    summaryCell3.alignment = { horizontal: "center", vertical: "middle" };
    ws3.getRow(totalConnSummaryRow).height = 30;

    ws3.views = [{ state: "frozen", ySplit: headerRow3 }];

    // Generate buffer
    const buffer = await wb.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Helpdesk_Schedule_${region || "all"}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("[Export Helpdesk] Error:", error);
    return NextResponse.json({ error: "Failed to export Helpdesk schedule" }, { status: 500 });
  }
}
