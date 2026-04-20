export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const version = query.get("v") || "turso";

  const fileMap: Record<string, { path: string; name: string }> = {
    turso: { path: "public/Shift_Turso_v1.zip", name: "Shift_Turso_v1.zip" },
    turso2: { path: "public/Shift_Turso_v2.zip", name: "Shift_Turso_v2.zip" },
    vercel: { path: "public/Shift_Vercel_Fix_v2.zip", name: "Shift_Vercel_Fix_v2.zip" },
  };

  const file = fileMap[version];
  if (!file) {
    return NextResponse.json({ error: "Invalid version. Use ?v=turso or ?v=vercel" }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), file.path);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const fileBuffer = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${file.name}"`,
      "Content-Length": stat.size.toString(),
      "Cache-Control": "public, max-age=3600",
    },
  });
}
