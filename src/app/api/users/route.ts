import { NextRequest, NextResponse } from "next/server";
import { checkAuth, unauthorizedResponse, forbiddenResponse, isAdmin, listUsers, createUser } from "@/lib/auth";

// GET: List all users (ADMIN only)
export async function GET(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (!isAdmin(auth.role)) return forbiddenResponse();

  try {
    const users = await listUsers();
    return NextResponse.json({ users });
  } catch (error) {
    console.error("Error listing users:", error);
    return NextResponse.json({ error: "Failed to list users" }, { status: 500 });
  }
}

// POST: Create new user (ADMIN only)
export async function POST(request: NextRequest) {
  const auth = checkAuth(request);
  if (!auth) return unauthorizedResponse();
  if (!isAdmin(auth.role)) return forbiddenResponse();

  try {
    const body = await request.json();
    const { username, password, email, role, region } = body;

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }

    const result = await createUser(username, password, email || null, role || "viewer", region || "all");

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      id: result.id,
      username: result.username,
      email: result.email,
      role: result.role,
      region: result.region,
    });
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
