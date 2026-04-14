import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse, resetUserPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const auth = checkAuth(request);
    if (!auth) return unauthorizedResponse();
    if (auth.role !== "admin") return forbiddenResponse();

    const body = await request.json();
    const { userId, newPassword } = body;

    if (!userId || !newPassword) {
      return NextResponse.json(
        { error: "UserId and new password are required" },
        { status: 400 }
      );
    }

    const result = await resetUserPassword(userId, newPassword);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
  }
}
