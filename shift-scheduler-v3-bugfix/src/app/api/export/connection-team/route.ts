import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse } from "@/lib/auth";
import { db } from "@/lib/db";
import ExcelJS from "exceljs";

// POST: Export Connection Team schedule to Excel
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const body = await request.json();
    const { monthKey, monthFrom, monthTo } = body;

    console.log("[Export Connection Team] Request:", { monthKey, monthFrom, monthTo });

    // Fetch connection team entries
    const allEntries = await db.connectionTeam.findMany();
    let filteredEntries = allEntries;

    // Filter by month
    if (monthKey) {
      filteredEntries = filteredEntries.filter((e) => e.monthKey === monthKey);
    }

    // Filter by month range if provided
    if (monthFrom) {
      filteredEntries = filteredEntries.filter((e) => e.weekStart >= `${monthFrom}-01`);
    }
    if (monthTo) {
      const lastDay = new Date(parseInt(monthTo.split("-")[0]), parseInt(monthTo.split("-")[1]), 0).getDate();
      filteredEntries = filteredEntries.filter((e) => e.weekStart <= `${monthTo}-${String(lastDay).padStart(2, "0")}`);
    }

    console.log("[Export Connection Team] Found entries:", filteredEntries.length);

    // Create Excel workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = "IT Helpdesk Shift Scheduler";
    wb.created = new Date();

    const ws = wb.addWorksheet("Connection Team");
    ws.columns = [
      { header: "Weeks", key: "weeks", width: 40 },
      { header: "", key: "empty", width: 5 },
      { header: "Employee Name", key: "empName", width: 24 },
      { header: "Employee HRID", key: "empHrid", width: 15 },
      { header: "Weeks Count", key: "weeksCount", width: 12 },
      { header: "Total Hours", key: "hours", width: 12 },
    ];

    // Add title
    ws.mergeCells("A1:F1");
    const titleCell = ws.getCell("A1");
    titleCell.value = "Connection Team - Employee Summary";
    titleCell.font = { size: 16, bold: true, color: { argb: "0D9488" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 36;

    // Add period info
    let periodText = "All Available Data";
    if (monthKey) {
      const [y, m] = monthKey.split("-");
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      periodText = `${monthNames[Number(m) - 1]} ${y}`;
    }
    if (monthFrom && monthTo) {
      periodText = `${monthFrom} to ${monthTo}`;
    }
    ws.mergeCells("A2:F2");
    const periodCell = ws.getCell("A2");
    periodCell.value = periodText;
    periodCell.font = { size: 12, italic: true, color: { argb: "64748B" } };
    periodCell.alignment = { horizontal: "center" };
    ws.getRow(2).height = 24;

    // Style header
    const headerRow = 4;
    const headers = ["Weeks", "", "Employee Name", "Employee HRID", "Weeks Count", "Total Hours"];
    headers.forEach((h, i) => {
      const cell = ws.getCell(headerRow, i + 1);
      cell.value = h;
      cell.font = { size: 11, bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0D9488" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    ws.getRow(headerRow).height = 28;

    // Aggregate data by employee to calculate correct totals
    const employeeAggregates = new Map<string, { name: string; hrid: string; weeks: string[] }>();

    filteredEntries.forEach((e) => {
      const key = `${e.empHrid}_${e.empName}`;
      if (!employeeAggregates.has(key)) {
        employeeAggregates.set(key, { name: e.empName, hrid: e.empHrid, weeks: [] });
      }
      const agg = employeeAggregates.get(key)!;
      const weekKey = `${e.weekStart} >> ${e.weekEnd}`;
      if (!agg.weeks.includes(weekKey)) {
        agg.weeks.push(weekKey);
      }
    });

    // Add aggregated data
    let rowIndex = headerRow + 1;
    for (const [key, agg] of employeeAggregates) {
      const rowFill = (rowIndex - headerRow) % 2 === 0 ? "FFFFFF" : "CCFBF1";
      const totalHours = agg.weeks.length * 42;

      ws.getCell(rowIndex, 1).value = agg.weeks.join(", ");
      ws.getCell(rowIndex, 1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      ws.getCell(rowIndex, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws.getCell(rowIndex, 2).value = "";
      ws.getCell(rowIndex, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws.getCell(rowIndex, 3).value = agg.name;
      ws.getCell(rowIndex, 3).alignment = { horizontal: "left", vertical: "middle" };
      ws.getCell(rowIndex, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      ws.getCell(rowIndex, 3).font = { bold: true, color: { argb: "0D9488" } };

      ws.getCell(rowIndex, 4).value = agg.hrid;
      ws.getCell(rowIndex, 4).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(rowIndex, 4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws.getCell(rowIndex, 5).value = `${agg.weeks.length} week${agg.weeks.length > 1 ? "s" : ""}`;
      ws.getCell(rowIndex, 5).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(rowIndex, 5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws.getCell(rowIndex, 6).value = totalHours;
      ws.getCell(rowIndex, 6).numFmt = "0.0";
      ws.getCell(rowIndex, 6).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(rowIndex, 6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      ws.getCell(rowIndex, 6).font = { color: { argb: "0D9488" }, bold: true };

      rowIndex++;
    }

    // Add summary
    const summaryRow = rowIndex + 1;
    const totalEmployees = employeeAggregates.size;
    const totalWeeks = Array.from(employeeAggregates.values()).reduce((sum, agg) => sum + agg.weeks.length, 0);
    const totalHours = totalWeeks * 42;

    ws.mergeCells(summaryRow, 1, summaryRow, 6);
    const summaryCell = ws.getCell(summaryRow, 1);
    summaryCell.value = `SUMMARY: ${totalEmployees} employees | ${totalWeeks} total weeks assigned | ${totalHours} total hours`;
    summaryCell.font = { size: 11, bold: true, color: { argb: "0D9488" } };
    summaryCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "CCFBF1" } };
    summaryCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(summaryRow).height = 28;

    // Freeze header
    ws.views = [{ state: "frozen", ySplit: headerRow }];

    // Generate buffer
    const buffer = await wb.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Connection_Team_Schedule.xlsx"`,
      },
    });
  } catch (error) {
    console.error("[Export Connection Team] Error:", error);
    return NextResponse.json({ error: "Failed to export Connection Team schedule" }, { status: 500 });
  }
}
