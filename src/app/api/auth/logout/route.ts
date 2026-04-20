export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const auth = checkAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "No token provided" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json({ error: "Logout failed" }, { status: 500 });
  }
}
