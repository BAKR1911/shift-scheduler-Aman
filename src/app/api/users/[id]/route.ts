export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse, isAdmin, updateUser, deleteUser } from "@/lib/auth";

// PUT: Update user (ADMIN only)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (!isAdmin(auth.role)) return forbiddenResponse();

  try {
    const { id } = await params;
    const body = await request.json();
    const { email, role, region } = body;

    // Admin can't change own role
    if (id === auth.userId && role && role !== auth.role) {
      return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
    }

    const result = await updateUser(id, email || null, role || "viewer", region);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

// DELETE: Delete user (ADMIN only - can't delete self)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (!isAdmin(auth.role)) return forbiddenResponse();

  try {
    const { id } = await params;

    if (id === auth.userId) {
      return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
    }

    const result = await deleteUser(id);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
