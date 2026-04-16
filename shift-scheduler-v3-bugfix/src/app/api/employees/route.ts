import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: List employees (non-admin users only see their region)
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const allEmployees = await db.employee.findMany({
      orderBy: { order: "asc" },
    });

    // Non-admin users with a specific region only see their region's employees (STRICT)
    if (auth.role !== "admin" && auth.region && auth.region !== "all") {
      const filtered = allEmployees.filter((e) => e.region === auth.region);
      return NextResponse.json({ employees: filtered });
    }

    return NextResponse.json({ employees: allEmployees });
  } catch (error) {
    console.error("Error fetching employees:", error);
    return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 });
  }
}

// POST: Add employee (ADMIN/EDITOR only)
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") return forbiddenResponse();

  try {
    const body = await request.json();
    const { name, hrid, active, region, teamType } = body;

    if (!name || !hrid) {
      return NextResponse.json({ error: "Name and HRID are required" }, { status: 400 });
    }

    const maxOrderEmp = await db.employee.findFirst({
      orderBy: { order: "desc" },
    });
    const order = (maxOrderEmp?.order || 0) + 1;

    const employee = await db.employee.create({
      data: {
        name: name.trim(),
        hrid: hrid.trim(),
        active: active !== false ? 1 : 0,
        region: region || "all",
        teamType: teamType || "",
        order,
      },
    });

    return NextResponse.json({ employee });
  } catch (error) {
    console.error("Error creating employee:", error);
    return NextResponse.json({ error: "Failed to create employee" }, { status: 500 });
  }
}

// PUT: Edit employee (ADMIN/EDITOR only)
export async function PUT(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") return forbiddenResponse();

  try {
    const body = await request.json();
    const { id, name, hrid, active, order, region, teamType } = body;

    if (!id) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
    }

    const employee = await db.employee.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(hrid !== undefined && { hrid: hrid.trim() }),
        ...(active !== undefined && { active: active ? 1 : 0 }),
        ...(order !== undefined && { order }),
        ...(region !== undefined && { region }),
        ...(teamType !== undefined && { teamType }),
      },
    });

    return NextResponse.json({ employee });
  } catch (error) {
    console.error("Error updating employee:", error);
    return NextResponse.json({ error: "Failed to update employee" }, { status: 500 });
  }
}

// DELETE: Remove employee (ADMIN only)
export async function DELETE(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin") return forbiddenResponse();

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
    }

    await db.employee.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting employee:", error);
    return NextResponse.json({ error: "Failed to delete employee" }, { status: 500 });
  }
}
