import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse } from "@/lib/auth";
import { db } from "@/lib/db";
import ExcelJS from "exceljs";

// POST: Export employee schedule by HRID
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const body = await request.json();
    const { hrid, monthFrom, monthTo } = body;

    console.log("[Export HRID] Request:", { hrid, monthFrom, monthTo });

    if (!hrid) {
      return NextResponse.json({ error: "hrid is required" }, { status: 400 });
    }

    // Find employee
    const employees = await db.employee.findMany();
    const employee = employees.find((e) => e.hrid === hrid);
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // Fetch schedule entries for this employee
    const allEntries = await db.scheduleEntry.findMany();
    let filteredEntries = allEntries.filter((e) => e.empHrid === hrid);

    // Filter by month range if provided
    if (monthFrom) {
      filteredEntries = filteredEntries.filter((e) => e.date >= `${monthFrom}-01`);
    }
    if (monthTo) {
      const lastDay = new Date(parseInt(monthTo.split("-")[0]), parseInt(monthTo.split("-")[1]), 0).getDate();
      filteredEntries = filteredEntries.filter((e) => e.date <= `${monthTo}-${String(lastDay).padStart(2, "0")}`);
    }

    console.log("[Export HRID] Found entries:", filteredEntries.length);

    // Create Excel workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = "IT Helpdesk Shift Scheduler";
    wb.created = new Date();

    const ws = wb.addWorksheet("Schedule");
    ws.columns = [
      { header: "Date", key: "date", width: 15 },
      { header: "Day", key: "day", width: 12 },
      { header: "Type", key: "type", width: 15 },
      { header: "Start", key: "start", width: 12 },
      { header: "End", key: "end", width: 12 },
      { header: "Hours", key: "hours", width: 10 },
      { header: "OFF Person", key: "offPerson", width: 20 },
      { header: "Holiday", key: "holiday", width: 10 },
    ];

    // Add title
    ws.mergeCells("A1:H1");
    const titleCell = ws.getCell("A1");
    titleCell.value = `${employee.name} (${employee.hrid}) - Schedule`;
    titleCell.font = { size: 16, bold: true, color: { argb: "1B2A4A" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 36;

    // Add period info
    let periodText = "All Available Data";
    if (monthFrom && monthTo) {
      periodText = `${monthFrom} to ${monthTo}`;
    } else if (monthFrom) {
      periodText = `From ${monthFrom}`;
    } else if (monthTo) {
      periodText = `Until ${monthTo}`;
    }
    ws.mergeCells("A2:H2");
    const periodCell = ws.getCell("A2");
    periodCell.value = periodText;
    periodCell.font = { size: 12, italic: true, color: { argb: "64748B" } };
    periodCell.alignment = { horizontal: "center" };
    ws.getRow(2).height = 24;

    // Style header
    const headerRow = 4;
    const headers = ["Date", "Day", "Type", "Start", "End", "Hours", "OFF Person", "Holiday"];
    headers.forEach((h, i) => {
      const cell = ws.getCell(headerRow, i + 1);
      cell.value = h;
      cell.font = { size: 11, bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1B2A4A" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    ws.getRow(headerRow).height = 28;

    // Add data
    filteredEntries.forEach((e, idx) => {
      const row = headerRow + 1 + idx;
      const isHoliday = Boolean(e.isHoliday);
      const rowFill = idx % 2 === 0 ? "FFFFFF" : "F1F5F9";

      ws.getCell(row, 1).value = e.date;
      ws.getCell(row, 1).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(row, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws.getCell(row, 2).value = e.dayName;
      ws.getCell(row, 2).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(row, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      const typeLabel = isHoliday ? "Holiday" : e.dayType;
      const typeColor = isHoliday ? "FEE2E2" : e.dayType === "Saturday" ? "D6E4F0" : e.dayType === "Friday" ? "FEF3C7" : "E8F5E9";

      ws.getCell(row, 3).value = typeLabel;
      ws.getCell(row, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: typeColor } };
      ws.getCell(row, 3).alignment = { horizontal: "center", vertical: "middle" };
      if (isHoliday) {
        ws.getCell(row, 3).font = { color: { argb: "DC2626" }, bold: true };
      }

      ws.getCell(row, 4).value = e.start;
      ws.getCell(row, 4).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(row, 4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws.getCell(row, 5).value = e.end;
      ws.getCell(row, 5).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(row, 5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws.getCell(row, 6).value = e.hours;
      ws.getCell(row, 6).numFmt = "0.0";
      ws.getCell(row, 6).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(row, 6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

      ws.getCell(row, 7).value = e.offPerson || "";
      ws.getCell(row, 7).alignment = { horizontal: "left", vertical: "middle" };
      ws.getCell(row, 7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      if (e.offPerson) {
        ws.getCell(row, 7).font = { color: { argb: "DC2626" }, bold: true };
      }

      ws.getCell(row, 8).value = isHoliday ? "Yes" : "No";
      ws.getCell(row, 8).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(row, 8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
    });

    // Add summary row
    const summaryRow = headerRow + filteredEntries.length + 2;
    const totalHours = filteredEntries.reduce((sum, e) => sum + e.hours, 0);
    const workDays = filteredEntries.filter(e => e.hours > 0).length;
    const holidays = filteredEntries.filter(e => e.isHoliday).length;
    const offDays = filteredEntries.filter(e => e.dayType === "Weekend" && !e.isHoliday).length;

    ws.mergeCells(summaryRow, 1, summaryRow, 8);
    const summaryCell = ws.getCell(summaryRow, 1);
    summaryCell.value = `Summary: ${workDays} work days | ${totalHours.toFixed(1)} total hours | ${holidays} holidays | ${offDays} off days`;
    summaryCell.font = { size: 11, bold: true, color: { argb: "1B2A4A" } };
    summaryCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E0F2FE" } };
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
        "Content-Disposition": `attachment; filename="${employee.name}_${hrid}_Schedule.xlsx"`,
      },
    });
  } catch (error) {
    console.error("[Export HRID] Error:", error);
    return NextResponse.json({ error: "Failed to export employee schedule" }, { status: 500 });
  }
}
