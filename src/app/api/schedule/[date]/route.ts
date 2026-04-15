import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse } from "@/lib/auth";
import { db } from "@/lib/db";

// DELETE: Delete schedule entry for a date
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (auth.role !== "admin" && auth.role !== "editor") return forbiddenResponse();

  try {
    const { date } = await params;

    const region = request.nextUrl.searchParams.get("region") || "";
    let effectiveRegion = region;
    if (!effectiveRegion && auth.region && auth.region !== "all") {
      effectiveRegion = auth.region;
    }

    const deleteWhere: Record<string, unknown> = { date };
    if (effectiveRegion && effectiveRegion !== "all") {
      deleteWhere.region = effectiveRegion;
    }
    const deleted = await db.scheduleEntry.deleteMany({ where: deleteWhere });

    return NextResponse.json({ success: true, deleted: deleted.count });
  } catch (error) {
    console.error("Error deleting schedule entry:", error);
    return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 });
  }
}
