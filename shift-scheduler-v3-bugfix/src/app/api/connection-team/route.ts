import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/auth";
import { db } from "@/lib/db";

// GET: List connection team entries (region-aware)
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const monthKey = searchParams.get("month") || "";
    const region = searchParams.get("region") || "";

    let effectiveRegion = region;
    if (!effectiveRegion && auth.region && auth.region !== "all") {
      effectiveRegion = auth.region;
    }

    const entries = await db.connectionTeam.findMany({
      where: {
        ...(monthKey ? { monthKey } : {}),
        ...(effectiveRegion && effectiveRegion !== "all" ? { region: effectiveRegion } : {}),
      },
    });

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Error fetching connection team:", error);
    return NextResponse.json({ error: "Failed to fetch connection team" }, { status: 500 });
  }
}

// POST: Create connection team entry or handle replacement (admin/editor only)
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") return forbiddenResponse();

  try {
    const body = await request.json();
    const { action, ...data } = body;

    // Handle replacement action
    if (action === "replace") {
      const { sourceId, targetEmpName, targetEmpHrid, targetEmpIdx } = data;

      if (!sourceId || !targetEmpName) {
        return NextResponse.json({ error: "sourceId and targetEmpName are required for replacement" }, { status: 400 });
      }

      // Get the source entry
      const sourceEntry = await db.connectionTeam.findMany({});
      const source = sourceEntry.find(e => e.id === sourceId);
      if (!source) {
        return NextResponse.json({ error: "Source entry not found" }, { status: 404 });
      }

      // Update the source entry with the new employee (replacement)
      // We update in-place: the new person takes over the connection shift
      const client = getClient();
      await client.execute({
        sql: "UPDATE connection_team SET emp_idx = ?, emp_name = ?, emp_hrid = ? WHERE id = ?",
        args: [targetEmpIdx || 0, targetEmpName, targetEmpHrid || "", sourceId],
      });

      return NextResponse.json({ 
        success: true, 
        message: `Connection shift replaced: ${source.empName} -> ${targetEmpName}`,
        entry: {
          ...source,
          empName: targetEmpName,
          empHrid: targetEmpHrid,
          empIdx: targetEmpIdx || 0,
        }
      });
    }

    // Normal creation
    const { weekStart, weekEnd, empIdx, empName, empHrid, monthKey, region } = data;

    if (!weekStart || !weekEnd || empName === undefined) {
      return NextResponse.json({ error: "weekStart, weekEnd, and empName are required" }, { status: 400 });
    }

    const entry = await db.connectionTeam.create({
      data: {
        weekStart,
        weekEnd,
        empIdx: empIdx || 0,
        empName: empName || "",
        empHrid: empHrid || "",
        monthKey: monthKey || "",
        region: region || "all",
      },
    });

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Error creating connection team entry:", error);
    return NextResponse.json({ error: "Failed to create connection team entry" }, { status: 500 });
  }
}

// DELETE: Remove connection team entry (admin only)
export async function DELETE(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin") return forbiddenResponse();

  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get("id"));

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await db.connectionTeam.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting connection team entry:", error);
    return NextResponse.json({ error: "Failed to delete connection team entry" }, { status: 500 });
  }
}

// Helper to get DB client for raw queries
import { createClient, type Client } from "@libsql/client";

function getClient(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (url && url.startsWith("libsql://")) {
    return createClient({ url, authToken: authToken || "" });
  } else if (url && url.startsWith("file:")) {
    return createClient({ url });
  }
  return createClient({ url: "file::memory:" });
}
