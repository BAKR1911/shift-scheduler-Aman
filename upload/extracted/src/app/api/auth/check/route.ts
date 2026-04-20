import { NextRequest, NextResponse } from "next/server";
import { checkAuth, checkToken } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ authenticated: false });
    }

    const token = authHeader.replace("Bearer ", "");
    const result = checkToken(token);

    if (!result.authenticated || !result.user) {
      return NextResponse.json({ authenticated: false });
    }

    // Optionally fetch email from store
    try {
      const user = await db.user.findUnique({
        where: { id: result.user.id },
        select: { email: true },
      });
      result.user.email = user?.email || null;
    } catch {
      // Store not available — token is still valid
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Auth check error:", error);
    return NextResponse.json({ authenticated: false });
  }
}
