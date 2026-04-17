import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";

const TOKEN_SECRET = process.env.JWT_SECRET || "shift-scheduler-hmac-secret-2026";

/**
 * Create a self-validating token that contains userId.username.role.region + HMAC signature.
 * NO server storage needed for verification.
 */
export function createToken(userId: string, username: string, role: string, region: string = "all"): string {
  const payload = JSON.stringify({ userId, username, role, region });
  const encoded = Buffer.from(payload).toString("base64url");
  const sig = createHash("sha256")
    .update(`${payload}:${TOKEN_SECRET}`)
    .digest("hex")
    .substring(0, 24);
  return `${encoded}.${sig}`;
}

/**
 * Verify token and return user info.
 * 100% self-contained — NO file reads, NO database, NO memory store.
 */
export function verifyToken(token: string): { userId: string; username: string; role: string; region: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const payloadStr = Buffer.from(parts[0], "base64url").toString("utf-8");
    if (!payloadStr) return null;

    const expectedSig = createHash("sha256")
      .update(`${payloadStr}:${TOKEN_SECRET}`)
      .digest("hex")
      .substring(0, 24);

    if (parts[1] !== expectedSig) return null;

    const data = JSON.parse(payloadStr);
    if (!data.userId || !data.username || !data.role) return null;

    return { userId: data.userId, username: data.username, role: data.role, region: data.region || "all" };
  } catch {
    return null;
  }
}

/**
 * Check auth from request headers. Returns user info or null.
 */
export function checkAuth(request: NextRequest): { userId: string; username: string; role: string; region: string } | null {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return null;
    const token = authHeader.replace("Bearer ", "");
    if (!token) return null;
    return verifyToken(token);
  } catch {
    return null;
  }
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * Authenticate user with username and password (in-memory store + bcrypt).
 */
export async function authenticateUser(username: string, password: string): Promise<
  | { success: true; token: string; id: string; username: string; role: string; email: string | null; region: string }
  | { error: string }
> {
  const user = await db.user.findUnique({ where: { username } });

  if (!user) {
    return { error: "Invalid credentials" };
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return { error: "Invalid credentials" };
  }

  const token = createToken(user.id, user.username, user.role, user.region);

  return {
    success: true,
    token,
    id: user.id,
    username: user.username,
    role: user.role,
    email: user.email,
    region: user.region,
  };
}

/**
 * Check token and return auth status.
 */
export function checkToken(token: string): { authenticated: boolean; user?: { id: string; username: string; role: string; email: string | null; region: string } } {
  const info = verifyToken(token);

  if (info) {
    return {
      authenticated: true,
      user: {
        id: info.userId,
        username: info.username,
        role: info.role,
        email: null,
        region: info.region,
      },
    };
  }

  return { authenticated: false };
}

/**
 * Change password — verifies current password, then saves new one (hashed).
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ success: true } | { error: string }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "User not found" };

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) return { error: "Current password is incorrect" };

  if (!newPassword || newPassword.length < 4) {
    return { error: "New password must be at least 4 characters" };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await db.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });

  return { success: true };
}

/**
 * Create user (ADMIN only).
 */
export async function createUser(username: string, password: string, email: string | null, role: string, region: string = "all"): Promise<
  | { success: true; id: string; username: string; email: string | null; role: string; region: string }
  | { error: string }
> {
  const existing = await db.user.findUnique({ where: { username } });
  if (existing) return { error: "Username already exists" };

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await db.user.create({
    data: {
      username,
      password: hashedPassword,
      email: email || null,
      role: role || "viewer",
      region: region || "all",
    },
  });

  return { success: true, id: user.id, username: user.username, email: user.email, role: user.role, region: user.region };
}

/**
 * Update user (ADMIN only).
 */
export async function updateUser(userId: string, email: string | null, role: string, region?: string): Promise<
  | { success: true }
  | { error: string }
> {
  const data: Partial<import("./db").StoreUser> = { email: email ?? undefined, role };
  if (region !== undefined) data.region = region;
  await db.user.update({
    where: { id: userId },
    data,
  });
  return { success: true };
}

/**
 * Delete user (ADMIN only).
 */
export async function deleteUser(userId: string): Promise<{ success: true } | { error: string }> {
  await db.user.delete({ where: { id: userId } });
  return { success: true };
}

/**
 * List all users (ADMIN only). Returns id, username, email, role, region (NO passwords).
 */
export async function listUsers(): Promise<{ id: string; username: string; email: string | null; role: string; region: string; createdAt: string; updatedAt: string }[]> {
  const allUsers = await db.user.findMany({
    orderBy: { createdAt: "asc" },
  });
  // Strip passwords from response
  return allUsers.map(({ password: _pw, ...rest }) => rest);
}

/**
 * Reset user password (ADMIN only).
 */
export async function resetUserPassword(userId: string, newPassword: string): Promise<{ success: true } | { error: string }> {
  if (!newPassword || newPassword.length < 4) {
    return { error: "New password must be at least 4 characters" };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await db.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });

  return { success: true };
}
