export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, changePassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const auth = checkAuth(request);
    if (!auth) return unauthorizedResponse();

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current and new passwords are required" },
        { status: 400 }
      );
    }

    const result = await changePassword(auth.userId, currentPassword, newPassword);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Change password error:", error);
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
