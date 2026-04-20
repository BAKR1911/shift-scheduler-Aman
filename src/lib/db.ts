/**
 * Database layer — uses Turso (libSQL cloud) in production, local SQLite in dev.
 * Falls back to in-memory if no database is configured.
 * Works perfectly on Vercel serverless.
 */

import { createClient, type Client } from "@libsql/client";
import { createId } from "@/lib/utils";
import bcrypt from "bcryptjs";

// ===== Types =====
export interface StoreUser {
  id: string;
  username: string;
  password: string;
  email: string | null;
  role: string;
  region: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreEmployee {
  id: number;
  name: string;
  hrid: string;
  active: boolean;
  order: number;
  region: string;
  teamType: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreScheduleEntry {
  id: number;
  date: string;
  dayName: string;
  dayType: string;
  empIdx: number;
  empName: string;
  empHrid: string;
  start: string;
  end: string;
  hours: number;
  offPerson: string;
  offPersonIdx: number;
  offPersonHrid: string;
  weekNum: number;
  isHoliday: boolean;
  isManual: boolean;
  monthKey: string;
  region: string;
  createdAt: string;
}

export interface StoreSettings {
  id: number;
  shifts: string;
  weekStart: string;
  holidays: string;
  holidayHours: string;
  summerTime: boolean;
  summerShifts: string;
  dayHours: string;
  updatedAt: string;
}

export interface StoreGeneratedMonth {
  id: number;
  monthKey: string;
  region: string;
  createdAt: string;
}

export interface StoreConnectionEntry {
  id: number;
  weekStart: string;
  weekEnd: string;
  empIdx: number;
  empName: string;
  empHrid: string;
  monthKey: string;
  region: string;
  createdAt: string;
}

export interface StoreRegionRotation {
  id: number;
  region: string;
  targetArea: string;
  weekStart: string;
  weekEnd: string;
  monthKey: string;
  notes: string;
  createdAt: string;
}

export interface StoreConnectionAssignment {
  id: number;
  employeeId: number;
  date: string;
  weekStart: string;
  regionCovered: string;
  hours: number;
  overrideHours: number;
  createdAt: string;
  updatedAt: string;
}

// ===== Client Singleton =====
let _client: Client | null = null;
let _initialized = false;
let _dbMode: "turso" | "local" | "memory" = "memory";

function getClient(): Client {
  if (_client) return _client;

  const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (url && url.startsWith("libsql://")) {
    _client = createClient({ url, authToken: authToken || "" });
    _dbMode = "turso";
    console.log("[DB] Using Turso cloud database");
  } else if (url && url.startsWith("file:")) {
    _client = createClient({ url });
    _dbMode = "local";
    console.log("[DB] Using local SQLite file:", url);
  } else {
    _client = createClient({ url: "file::memory:" });
    _dbMode = "memory";
    console.log("[DB] Using in-memory database (no TURSO_DATABASE_URL or DATABASE_URL set)");
  }

  return _client;
}

// ===== Schema Creation =====
async function initSchema() {
  if (_initialized) return;
  _initialized = true;

  const client = getClient();

  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'viewer',
      region TEXT NOT NULL DEFAULT 'all',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hrid TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      "order" INTEGER NOT NULL DEFAULT 0,
      region TEXT NOT NULL DEFAULT 'all',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS schedule_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      day_name TEXT NOT NULL DEFAULT '',
      day_type TEXT NOT NULL DEFAULT 'Weekday',
      emp_idx INTEGER NOT NULL DEFAULT 0,
      emp_name TEXT NOT NULL DEFAULT '',
      emp_hrid TEXT NOT NULL DEFAULT '',
      start TEXT NOT NULL DEFAULT '',
      "end" TEXT NOT NULL DEFAULT '',
      hours REAL NOT NULL DEFAULT 0,
      off_person TEXT NOT NULL DEFAULT '',
      off_person_idx INTEGER NOT NULL DEFAULT 0,
      off_person_hrid TEXT NOT NULL DEFAULT '',
      week_num INTEGER NOT NULL DEFAULT 0,
      is_holiday INTEGER NOT NULL DEFAULT 0,
      is_manual INTEGER NOT NULL DEFAULT 0,
      month_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      shifts TEXT NOT NULL DEFAULT '{}',
      week_start TEXT NOT NULL DEFAULT 'Friday',
      holidays TEXT NOT NULL DEFAULT '[]',
      holiday_hours TEXT NOT NULL DEFAULT '{}',
      summer_time INTEGER NOT NULL DEFAULT 0,
      summer_shifts TEXT NOT NULL DEFAULT '{}',
      day_hours TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS generated_months (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_key TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT 'all',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(month_key, region)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS connection_team (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      emp_idx INTEGER NOT NULL DEFAULT 0,
      emp_name TEXT NOT NULL DEFAULT '',
      emp_hrid TEXT NOT NULL DEFAULT '',
      month_key TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT 'all',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS region_rotation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      region TEXT NOT NULL DEFAULT '',
      target_area TEXT NOT NULL DEFAULT '',
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      month_key TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS connection_assignments (
      assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      week_start TEXT NOT NULL DEFAULT '',
      region_covered TEXT NOT NULL DEFAULT '',
      hours REAL NOT NULL DEFAULT 0,
      override_hours REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migration: add region column to users if it doesn't exist
  try {
    await client.execute("SELECT region FROM users LIMIT 0");
  } catch {
    try { await client.execute("ALTER TABLE users ADD COLUMN region TEXT NOT NULL DEFAULT 'all'"); } catch { /* ignore */ }
  }

  // Migration: add region column to employees if it doesn't exist
  try {
    await client.execute("SELECT region FROM employees LIMIT 0");
  } catch {
    try { await client.execute("ALTER TABLE employees ADD COLUMN region TEXT NOT NULL DEFAULT 'all'"); } catch { /* ignore */ }
  }

  // Migration: add team_type column to employees if it doesn't exist
  try {
    await client.execute("SELECT team_type FROM employees LIMIT 0");
  } catch {
    try { await client.execute("ALTER TABLE employees ADD COLUMN team_type TEXT NOT NULL DEFAULT 'helpdesk'"); } catch { /* ignore */ }
  }

  // Migration: assign regions to employees if all are 'all'
  // This migration is now handled in seeding - no need to run here

  // Migration: add day_hours column to settings if it doesn't exist
  try {
    await client.execute("SELECT day_hours FROM settings LIMIT 0");
  } catch {
    try { await client.execute("ALTER TABLE settings ADD COLUMN day_hours TEXT NOT NULL DEFAULT '{}'"); } catch { /* ignore */ }
  }

  // Migration: add holiday_hours column to settings if it doesn't exist
  try {
    await client.execute("SELECT holiday_hours FROM settings LIMIT 0");
  } catch {
    try { await client.execute("ALTER TABLE settings ADD COLUMN holiday_hours TEXT NOT NULL DEFAULT '{}'"); } catch { /* ignore */ }
  }

  // Migration: add region column to schedule_entries if it doesn't exist
  try {
    await client.execute("SELECT region FROM schedule_entries LIMIT 0");
  } catch {
    try { await client.execute("ALTER TABLE schedule_entries ADD COLUMN region TEXT NOT NULL DEFAULT 'all'"); } catch { /* ignore */ }
    // Backfill region from employees
    try {
      const allEmps = await client.execute("SELECT name, region FROM employees");
      const empRegionMap: Record<string, string> = {};
      for (const r of allEmps.rows) {
        empRegionMap[String(r.name)] = String(r.region);
      }
      const allEntries = await client.execute("SELECT id, emp_name FROM schedule_entries WHERE region = 'all'");
      for (const entry of allEntries.rows) {
        const empName = String(entry.emp_name);
        const empRegion = empRegionMap[empName];
        if (empRegion && empRegion !== "all") {
          await client.execute({ sql: "UPDATE schedule_entries SET region = ? WHERE id = ?", args: [empRegion, entry.id] });
        }
      }
      console.log("[DB] Backfilled region for schedule_entries");
    } catch (e) {
      console.log("[DB] Region backfill skipped:", e);
    }
  }

  // Migration: change generated_months UNIQUE from (month_key) to (month_key, region)
  try {
    await client.execute("SELECT region FROM generated_months LIMIT 0");
    // Column already exists — ensure composite index is present
    try { await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_gen_months_key_region ON generated_months(month_key, region)"); } catch { /* ignore */ }
  } catch {
    // Column missing — use SQLite table recreation pattern (safe for production)
    try {
      await client.execute("CREATE TABLE IF NOT EXISTS _gen_months_new (id INTEGER PRIMARY KEY AUTOINCREMENT, month_key TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT 'all', created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(month_key, region))");
      const existing = await client.execute("SELECT month_key, created_at FROM generated_months");
      for (const row of existing.rows) {
        await client.execute({ sql: "INSERT OR IGNORE INTO _gen_months_new (month_key, region, created_at) VALUES (?, 'all', ?)", args: [String(row.month_key), String(row.created_at)] });
      }
      await client.execute("DROP TABLE generated_months");
      await client.execute("ALTER TABLE _gen_months_new RENAME TO generated_months");
      console.log("[DB] Migrated generated_months to include region column");
    } catch (e) {
      console.log("[DB] generated_months migration failed:", e);
    }
  }

  // Migration: add region column to connection_team if it doesn't exist
  try {
    await client.execute("SELECT region FROM connection_team LIMIT 0");
  } catch {
    try { await client.execute("ALTER TABLE connection_team ADD COLUMN region TEXT NOT NULL DEFAULT 'all'"); } catch { /* ignore */ }
  }

  // Migration: add region column to region_rotation if it doesn't exist
  try {
    await client.execute("SELECT region FROM region_rotation LIMIT 0");
  } catch {
    try { await client.execute("ALTER TABLE region_rotation ADD COLUMN region TEXT NOT NULL DEFAULT ''"); } catch { /* ignore */ }
  }

  // Seed default admin if no users exist
  const adminResult = await client.execute("SELECT COUNT(*) as cnt FROM users");
  if (adminResult.rows[0]?.cnt === 0) {
    const adminHash = "$2b$10$nnr8NI0xFq9UhBgizrMHr.tZtGEPUKBklBwkiPu2e4WgeJAFHnjpq";
    await client.execute({
      sql: "INSERT INTO users (id, username, password, email, role, region) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["admin-001", "abubakr.ahmed", adminHash, "abubakr.ahmed@helpdesk.com", "super_admin", "all"],
    });
    console.log("[DB] Seeded default super admin user");
  }

  // Seed default employees if none exist
  const empResult = await client.execute("SELECT COUNT(*) as cnt FROM employees");
  if (empResult.rows[0]?.cnt === 0) {
    const defaultEmployees = [
      ["Islam Rabia", "102843", 0, "cairo", "helpdesk"],
      ["Mustafa Ali", "114831", 1, "cairo", "helpdesk"],
      ["Mohamed Rashwan", "147956", 2, "delta", "helpdesk"],
      ["Mahmoud Rabia", "102054", 3, "delta", "helpdesk"],
      ["Mohamed Aahrar", "137254", 4, "upper_egypt", "helpdesk"],
      ["Abo Bakr", "141866", 5, "upper_egypt", "helpdesk"],
      ["Ahmed Khyr", "113319", 6, "cairo", "helpdesk"],
      ["Ahmed Hisham", "92458", 7, "delta", "helpdesk"],
    ];
    for (const [name, hrid, order, region, teamType] of defaultEmployees) {
      await client.execute({
        sql: `INSERT INTO employees (name, hrid, active, "order", region, team_type) VALUES (?, ?, 1, ?, ?, ?)`,
        args: [name, hrid, order, region, teamType],
      });
    }
    console.log("[DB] Seeded 8 default employees with regions and team types");
  }

  // Seed default settings if none exist
  const settResult = await client.execute("SELECT COUNT(*) as cnt FROM settings");
  if (settResult.rows[0]?.cnt === 0) {
    const defaultShifts = JSON.stringify({
      Weekday: { start: "05:00 PM", end: "10:00 PM", hours: 5 },
      Thursday: { start: "05:00 PM", end: "10:00 PM", hours: 5 },
      Friday: { start: "01:00 PM", end: "10:00 PM", hours: 9 },
      Saturday: { start: "01:00 PM", end: "10:00 PM", hours: 9 },
      Holiday: { start: "10:00 AM", end: "10:00 PM", hours: 12 },
    });
    const defaultSummerShifts = JSON.stringify({
      Weekday: { start: "05:00 PM", end: "11:00 PM", hours: 6 },
      Thursday: { start: "05:00 PM", end: "11:00 PM", hours: 6 },
      Friday: { start: "01:00 PM", end: "11:00 PM", hours: 10 },
      Saturday: { start: "01:00 PM", end: "11:00 PM", hours: 10 },
    });
    await client.execute({
      sql: "INSERT INTO settings (id, shifts, week_start, holidays, summer_time, summer_shifts, day_hours) VALUES (1, ?, 'Friday', '[]', 0, ?, '{}')",
      args: [defaultShifts, defaultSummerShifts],
    });
    console.log("[DB] Seeded default settings");
  }
}

async function ensureInit() {
  await initSchema();
}

// ===== Helper: Convert row to typed object =====
function rowToUser(row: Record<string, unknown>): StoreUser {
  return {
    id: String(row.id),
    username: String(row.username),
    password: String(row.password),
    email: row.email ? String(row.email) : null,
    role: String(row.role),
    region: row.region ? String(row.region) : "all",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToEmployee(row: Record<string, unknown>): StoreEmployee {
  return {
    id: Number(row.id),
    name: String(row.name),
    hrid: String(row.hrid),
    active: Number(row.active) === 1,
    order: Number(row.order),
    region: row.region ? String(row.region) : "all",
    teamType: row.team_type ? String(row.team_type) : "",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToEntry(row: Record<string, unknown>): StoreScheduleEntry {
  return {
    id: Number(row.id),
    date: String(row.date),
    dayName: String(row.day_name),
    dayType: String(row.day_type),
    empIdx: Number(row.emp_idx),
    empName: String(row.emp_name),
    empHrid: String(row.emp_hrid),
    start: String(row.start),
    end: String(row.end),
    hours: Number(row.hours),
    offPerson: String(row.off_person),
    offPersonIdx: Number(row.off_person_idx),
    offPersonHrid: String(row.off_person_hrid),
    weekNum: Number(row.week_num),
    isHoliday: Number(row.is_holiday) === 1,
    isManual: Number(row.is_manual) === 1,
    monthKey: String(row.month_key),
    region: row.region ? String(row.region) : "all",
    createdAt: String(row.created_at),
  };
}

function rowToSettings(row: Record<string, unknown>): StoreSettings {
  return {
    id: Number(row.id),
    shifts: String(row.shifts),
    weekStart: String(row.week_start),
    holidays: String(row.holidays),
    holidayHours: row.holiday_hours ? String(row.holiday_hours) : "{}",
    summerTime: Number(row.summer_time) === 1,
    summerShifts: String(row.summer_shifts),
    dayHours: row.day_hours ? String(row.day_hours) : "{}",
    updatedAt: String(row.updated_at),
  };
}

function rowToGenMonth(row: Record<string, unknown>): StoreGeneratedMonth {
  return {
    id: Number(row.id),
    monthKey: String(row.month_key),
    region: row.region ? String(row.region) : "all",
    createdAt: String(row.created_at),
  };
}

function rowToConnectionEntry(row: Record<string, unknown>): StoreConnectionEntry {
  return {
    id: Number(row.id),
    weekStart: String(row.week_start),
    weekEnd: String(row.week_end),
    empIdx: Number(row.emp_idx),
    empName: String(row.emp_name),
    empHrid: String(row.emp_hrid),
    monthKey: String(row.month_key),
    region: row.region ? String(row.region) : "all",
    createdAt: String(row.created_at),
  };
}

function rowToRegionRotation(row: Record<string, unknown>): StoreRegionRotation {
  return {
    id: Number(row.id),
    region: String(row.region),
    targetArea: String(row.target_area),
    weekStart: String(row.week_start),
    weekEnd: String(row.week_end),
    monthKey: String(row.month_key),
    notes: String(row.notes),
    createdAt: String(row.created_at),
  };
}

function rowToConnectionAssignment(row: Record<string, unknown>): StoreConnectionAssignment {
  return {
    id: Number(row.assignment_id),
    employeeId: Number(row.employee_id),
    date: String(row.date),
    weekStart: String(row.week_start),
    regionCovered: String(row.region_covered),
    hours: Number(row.hours),
    overrideHours: Number(row.override_hours),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ===== Database Object =====
export const db = {
  // ===== User Model =====
  user: {
    async findUnique(args?: { where?: Record<string, unknown>; select?: Record<string, boolean> }) {
      await ensureInit();
      const client = getClient();
      const where = args?.where || {};

      let sql = "SELECT * FROM users WHERE 1=1";
      const values: unknown[] = [];
      if (where.id) { sql += " AND id = ?"; values.push(where.id); }
      if (where.username) { sql += " AND username = ?"; values.push(where.username); }

      const result = await client.execute({ sql, args: values as (string | number | boolean | null)[] });
      if (result.rows.length === 0) return null;

      const user = rowToUser(result.rows[0]);
      if (args?.select) {
        const picked: Record<string, unknown> = {};
        for (const [key, include] of Object.entries(args.select)) {
          if (include) picked[key] = user[key as keyof StoreUser];
        }
        return picked as unknown as StoreUser;
      }
      return user;
    },

    async findMany(args?: { orderBy?: Record<string, "asc" | "desc">; select?: Record<string, boolean> }) {
      await ensureInit();
      const client = getClient();

      let sql = "SELECT * FROM users";
      if (args?.orderBy) {
        const [key, dir] = Object.entries(args.orderBy)[0];
        const col = key === "createdAt" ? "created_at" : key;
        sql += ` ORDER BY ${col} ${dir === "desc" ? "DESC" : "ASC"}`;
      }

      const result = await client.execute(sql);
      const users = result.rows.map((r) => rowToUser(r as Record<string, unknown>));

      if (args?.select) {
        return users.map((u) => {
          const picked: Record<string, unknown> = {};
          for (const [key, include] of Object.entries(args.select!)) {
            if (include) picked[key] = u[key as keyof StoreUser];
          }
          return picked as unknown as StoreUser;
        });
      }
      return users;
    },

    async create(args: { data: Omit<StoreUser, "id" | "createdAt" | "updatedAt"> & { id?: string } }) {
      await ensureInit();
      const client = getClient();
      const now = new Date().toISOString();
      const id = args.data.id || createId();

      await client.execute({
        sql: `INSERT INTO users (id, username, password, email, role, region, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, args.data.username, args.data.password, args.data.email || null, args.data.role || "viewer", args.data.region || "all", now, now],
      });

      return {
        id,
        username: args.data.username,
        password: args.data.password,
        email: args.data.email || null,
        role: args.data.role || "viewer",
        region: args.data.region || "all",
        createdAt: now,
        updatedAt: now,
      };
    },

    async update(args: { where: Record<string, unknown>; data: Partial<StoreUser> }) {
      await ensureInit();
      const client = getClient();
      const now = new Date().toISOString();

      const sets: string[] = [];
      const values: unknown[] = [];
      if (args.data.password !== undefined) { sets.push("password = ?"); values.push(args.data.password); }
      if (args.data.email !== undefined) { sets.push("email = ?"); values.push(args.data.email); }
      if (args.data.role !== undefined) { sets.push("role = ?"); values.push(args.data.role); }
      if (args.data.region !== undefined) { sets.push("region = ?"); values.push(args.data.region); }
      sets.push("updated_at = ?");
      values.push(now);

      const whereKey = args.where.id ? "id" : "username";
      values.push(args.where[whereKey]);

      await client.execute({
        sql: `UPDATE users SET ${sets.join(", ")} WHERE ${whereKey} = ?`,
        args: values as (string | number | boolean | null)[],
      });

      return await db.user.findUnique(args) as StoreUser;
    },

    async delete(args: { where: Record<string, unknown> }) {
      await ensureInit();
      const client = getClient();

      const whereKey = args.where.id ? "id" : "username";
      await client.execute({
        sql: `DELETE FROM users WHERE ${whereKey} = ?`,
        args: [args.where[whereKey]] as (string | number | boolean | null)[],
      });

      return { success: true };
    },
  },

  // ===== Employee Model =====
  employee: {
    async findMany(args?: { orderBy?: Record<string, "asc" | "desc"> }) {
      await ensureInit();
      const client = getClient();

      let sql = "SELECT * FROM employees";
      if (args?.orderBy) {
        const [key, dir] = Object.entries(args.orderBy)[0];
        const col = key === "order" ? '"order"' : key;
        sql += ` ORDER BY ${col} ${dir === "desc" ? "DESC" : "ASC"}`;
      }

      const result = await client.execute(sql);
      return result.rows.map((r) => rowToEmployee(r as Record<string, unknown>));
    },

    async findFirst(args?: { where?: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; select?: Record<string, boolean> }) {
      await ensureInit();
      const client = getClient();
      const where = args?.where || {};

      let sql = "SELECT * FROM employees WHERE 1=1";
      const values: unknown[] = [];
      if (where.id) { sql += " AND id = ?"; values.push(where.id); }
      if (where.active !== undefined) { sql += " AND active = ?"; values.push(where.active ? 1 : 0); }

      if (args?.orderBy) {
        const [key, dir] = Object.entries(args.orderBy)[0];
        const col = key === "order" ? '"order"' : key;
        sql += ` ORDER BY ${col} ${dir === "desc" ? "DESC" : "ASC"}`;
      }
      sql += " LIMIT 1";

      const result = await client.execute({ sql, args: values as (string | number | boolean | null)[] });
      if (result.rows.length === 0) return null;

      const emp = rowToEmployee(result.rows[0] as Record<string, unknown>);
      if (args?.select) {
        const picked: Record<string, unknown> = {};
        for (const [key, include] of Object.entries(args.select)) {
          if (include) picked[key] = emp[key as keyof StoreEmployee];
        }
        return picked as unknown as StoreEmployee;
      }
      return emp;
    },

    async create(args: { data: Omit<StoreEmployee, "id" | "createdAt" | "updatedAt"> }) {
      await ensureInit();
      const client = getClient();
      const now = new Date().toISOString();

      const result = await client.execute({
        sql: `INSERT INTO employees (name, hrid, active, "order", region, team_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [args.data.name, args.data.hrid, args.data.active ? 1 : 0, args.data.order || 0, args.data.region || "all", args.data.teamType || "", now, now],
      });

      return {
        id: Number(result.lastInsertRowid),
        name: args.data.name,
        hrid: args.data.hrid,
        active: args.data.active,
        order: args.data.order || 0,
        region: args.data.region || "all",
        teamType: args.data.teamType || "",
        createdAt: now,
        updatedAt: now,
      };
    },

    async update(args: { where: Record<string, unknown>; data: Partial<StoreEmployee> }) {
      await ensureInit();
      const client = getClient();
      const now = new Date().toISOString();

      const sets: string[] = [];
      const values: unknown[] = [];
      if (args.data.name !== undefined) { sets.push("name = ?"); values.push(args.data.name); }
      if (args.data.hrid !== undefined) { sets.push("hrid = ?"); values.push(args.data.hrid); }
      if (args.data.active !== undefined) { sets.push("active = ?"); values.push(args.data.active ? 1 : 0); }
      if (args.data.order !== undefined) { sets.push('"order" = ?'); values.push(args.data.order); }
      if (args.data.region !== undefined) { sets.push("region = ?"); values.push(args.data.region); }
      if (args.data.teamType !== undefined) { sets.push("team_type = ?"); values.push(args.data.teamType); }
      sets.push("updated_at = ?");
      values.push(now);

      values.push(args.where.id);
      await client.execute({
        sql: `UPDATE employees SET ${sets.join(", ")} WHERE id = ?`,
        args: values as (string | number | boolean | null)[],
      });

      return await db.employee.findUnique(args) as StoreEmployee;
    },

    async delete(args: { where: Record<string, unknown> }) {
      await ensureInit();
      const client = getClient();

      await client.execute({
        sql: "DELETE FROM employees WHERE id = ?",
        args: [args.where.id] as (string | number | boolean | null)[],
      });

      return { success: true };
    },

    async findUnique(args: { where: Record<string, unknown> }) {
      await ensureInit();
      const client = getClient();

      const result = await client.execute({
        sql: "SELECT * FROM employees WHERE id = ?",
        args: [args.where.id] as (string | number | boolean | null)[],
      });
      if (result.rows.length === 0) return null;
      return rowToEmployee(result.rows[0] as Record<string, unknown>);
    },
  },

  // ===== ScheduleEntry Model =====
  scheduleEntry: {
    async findMany(args?: { where?: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc"> }) {
      await ensureInit();
      const client = getClient();
      const where = args?.where || {};

      let sql = "SELECT * FROM schedule_entries WHERE 1=1";
      const values: unknown[] = [];
      if (where.date) {
        if (typeof where.date === "object") {
          const dateOps = where.date as Record<string, unknown>;
          if (dateOps.startsWith) {
            sql += " AND date LIKE ?";
            values.push(`${dateOps.startsWith}%`);
          } else if (dateOps.in) {
            const dates = dateOps.in as string[];
            sql += ` AND date IN (${dates.map(() => "?").join(", ")})`;
            values.push(...dates);
          }
          if (dateOps.gte) {
            sql += " AND date >= ?";
            values.push(dateOps.gte);
          }
          if (dateOps.lte) {
            sql += " AND date <= ?";
            values.push(dateOps.lte);
          }
        } else {
          sql += " AND date = ?";
          values.push(where.date);
        }
      }
      if (where.monthKey) {
        if (typeof where.monthKey === "object" && (where.monthKey as Record<string, unknown>).startsWith) {
          sql += " AND month_key LIKE ?";
          values.push(`${(where.monthKey as Record<string, unknown>).startsWith}%`);
        } else {
          sql += " AND month_key = ?";
          values.push(where.monthKey);
        }
      }
      if (where.isManual !== undefined) {
        sql += " AND is_manual = ?";
        values.push(where.isManual ? 1 : 0);
      }
      if (where.region) {
        if (typeof where.region === "object" && (where.region as Record<string, unknown>).in) {
          const regions = (where.region as Record<string, unknown>).in as string[];
          sql += ` AND region IN (${regions.map(() => "?").join(", ")})`;
          values.push(...regions);
        } else {
          sql += " AND region = ?";
          values.push(where.region);
        }
      }

      if (args?.orderBy) {
        const [key, dir] = Object.entries(args.orderBy)[0];
        const col = key === "date" ? "date" : key;
        sql += ` ORDER BY ${col} ${dir === "desc" ? "DESC" : "ASC"}`;
      }

      const result = await client.execute({ sql, args: values as (string | number | boolean | null)[] });
      return result.rows.map((r) => rowToEntry(r as Record<string, unknown>));
    },

    async findFirst(args?: { where?: Record<string, unknown> }) {
      await ensureInit();
      const client = getClient();
      const where = args?.where || {};

      let sql = "SELECT * FROM schedule_entries WHERE 1=1";
      const values: unknown[] = [];
      if (where.date) { sql += " AND date = ?"; values.push(where.date); }
      sql += " LIMIT 1";

      const result = await client.execute({ sql, args: values as (string | number | boolean | null)[] });
      if (result.rows.length === 0) return null;
      return rowToEntry(result.rows[0] as Record<string, unknown>);
    },

    async create(args: { data: Omit<StoreScheduleEntry, "id" | "createdAt"> }) {
      await ensureInit();
      const client = getClient();
      const now = new Date().toISOString();

      const result = await client.execute({
        sql: `INSERT INTO schedule_entries (date, day_name, day_type, emp_idx, emp_name, emp_hrid, start, "end", hours, off_person, off_person_idx, off_person_hrid, week_num, is_holiday, is_manual, month_key, region, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          args.data.date, args.data.dayName, args.data.dayType,
          args.data.empIdx, args.data.empName, args.data.empHrid,
          args.data.start, args.data.end, args.data.hours,
          args.data.offPerson, args.data.offPersonIdx, args.data.offPersonHrid,
          args.data.weekNum, args.data.isHoliday ? 1 : 0, args.data.isManual ? 1 : 0,
          args.data.monthKey, args.data.region || "all", now,
        ],
      });

      return {
        ...args.data,
        id: Number(result.lastInsertRowid),
        region: args.data.region || "all",
        createdAt: now,
      };
    },

    async createMany(args: { data: Omit<StoreScheduleEntry, "id" | "createdAt">[] }) {
      await ensureInit();
      const client = getClient();
      if (args.data.length === 0) return { count: 0 };

      const now = new Date().toISOString();
      const rowPlaceholders = args.data
        .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .join(", ");

      const sql = `INSERT INTO schedule_entries (date, day_name, day_type, emp_idx, emp_name, emp_hrid, start, "end", hours, off_person, off_person_idx, off_person_hrid, week_num, is_holiday, is_manual, month_key, region, created_at) VALUES ${rowPlaceholders}`;

      const values: unknown[] = [];
      for (const d of args.data) {
        values.push(
          d.date, d.dayName, d.dayType,
          d.empIdx, d.empName, d.empHrid,
          d.start, d.end, d.hours,
          d.offPerson, d.offPersonIdx, d.offPersonHrid,
          d.weekNum, d.isHoliday ? 1 : 0, d.isManual ? 1 : 0,
          d.monthKey, d.region || "all", now,
        );
      }

      const result = await client.execute({ sql, args: values as (string | number | boolean | null)[] });
      return { count: result.rowsAffected };
    },

    async update(args: { where: Record<string, unknown>; data: Partial<StoreScheduleEntry> }) {
      await ensureInit();
      const client = getClient();

      const sets: string[] = [];
      const values: unknown[] = [];
      if (args.data.empIdx !== undefined) { sets.push("emp_idx = ?"); values.push(args.data.empIdx); }
      if (args.data.empName !== undefined) { sets.push("emp_name = ?"); values.push(args.data.empName); }
      if (args.data.empHrid !== undefined) { sets.push("emp_hrid = ?"); values.push(args.data.empHrid); }
      if (args.data.offPersonIdx !== undefined) { sets.push("off_person_idx = ?"); values.push(args.data.offPersonIdx); }
      if (args.data.offPerson !== undefined) { sets.push("off_person = ?"); values.push(args.data.offPerson); }
      if (args.data.offPersonHrid !== undefined) { sets.push("off_person_hrid = ?"); values.push(args.data.offPersonHrid); }

      values.push(args.where.id);
      await client.execute({
        sql: `UPDATE schedule_entries SET ${sets.join(", ")} WHERE id = ?`,
        args: values as (string | number | boolean | null)[],
      });

      return { success: true };
    },

    async delete(args: { where: Record<string, unknown> }) {
      await ensureInit();
      const client = getClient();

      if (args.where.date) {
        await client.execute({
          sql: "DELETE FROM schedule_entries WHERE date = ?",
          args: [args.where.date] as (string | number | boolean | null)[],
        });
      } else if (args.where.id) {
        await client.execute({
          sql: "DELETE FROM schedule_entries WHERE id = ?",
          args: [args.where.id] as (string | number | boolean | null)[],
        });
      }

      return { success: true };
    },

    async deleteByMonth(monthKey: string) {
      await ensureInit();
      const client = getClient();
      const result = await client.execute({
        sql: "DELETE FROM schedule_entries WHERE month_key LIKE ?",
        args: [`${monthKey}%`],
      });
      return { count: result.rowsAffected };
    },

    async findAll() {
      await ensureInit();
      const client = getClient();
      const result = await client.execute("SELECT * FROM schedule_entries ORDER BY date ASC");
      return result.rows.map((r) => rowToEntry(r as Record<string, unknown>));
    },

    async updateHoursBatch(updates: Array<{id: number, start: string, end: string, hours: number, isHoliday?: boolean}>) {
      await ensureInit();
      const client = getClient();
      console.log("[updateHoursBatch] Processing", updates.length, "updates");

      let updatedCount = 0;
      for (const u of updates) {
        if (u.isHoliday !== undefined) {
          console.log(`[updateHoursBatch] Updating entry ${u.id}:`, {
            start: u.start,
            end: u.end,
            hours: u.hours,
            isHoliday: u.isHoliday,
          });
          await client.execute({
            sql: 'UPDATE schedule_entries SET start = ?, "end" = ?, hours = ?, is_holiday = ? WHERE id = ?',
            args: [u.start, u.end, u.hours, u.isHoliday ? 1 : 0, u.id],
          });
          updatedCount++;
        } else {
          await client.execute({
            sql: 'UPDATE schedule_entries SET start = ?, "end" = ?, hours = ? WHERE id = ?',
            args: [u.start, u.end, u.hours, u.id],
          });
          updatedCount++;
        }
      }
      console.log(`[updateHoursBatch] Updated ${updatedCount} entries`);
      return { count: updates.length };
    },

    async deleteByIds(ids: number[]) {
      await ensureInit();
      const client = getClient();
      if (ids.length === 0) return { count: 0 };
      const placeholders = ids.map(() => "?").join(", ");
      const result = await client.execute({
        sql: `DELETE FROM schedule_entries WHERE id IN (${placeholders})`,
        args: ids,
      });
      return { count: result.rowsAffected };
    },

    async deleteMany(args: { where: Record<string, unknown> }) {
      await ensureInit();
      const client = getClient();
      const where = args.where;

      let sql = "DELETE FROM schedule_entries WHERE 1=1";
      const values: unknown[] = [];

      if (where.date) {
        if (typeof where.date === "object") {
          const dateWhere = where.date as Record<string, unknown>;
          if (dateWhere.startsWith) {
            sql = "DELETE FROM schedule_entries WHERE date LIKE ?";
            values.push(`${dateWhere.startsWith}%`);
          } else if (dateWhere.in) {
            const dates = dateWhere.in as string[];
            sql = `DELETE FROM schedule_entries WHERE date IN (${dates.map(() => "?").join(", ")})`;
            values.push(...dates);
          }
        } else {
          sql = "DELETE FROM schedule_entries WHERE date = ?";
          values.push(where.date);
        }
      }

      if (where.isManual !== undefined) {
        sql += " AND is_manual = ?";
        values.push(where.isManual ? 1 : 0);
      }

      if (where.region) {
        sql += " AND region = ?";
        values.push(where.region);
      }

      if (values.length === 0) return { count: 0 };

      const result = await client.execute({ sql, args: values as (string | number | boolean | null)[] });
      return { count: result.rowsAffected };
    },
  },

  // ===== Settings Model =====
  settings: {
    async findUnique() {
      await ensureInit();
      const client = getClient();

      const result = await client.execute("SELECT * FROM settings WHERE id = 1");
      if (result.rows.length === 0) return null;
      return rowToSettings(result.rows[0] as Record<string, unknown>);
    },

    async upsert(args: {
      where: Record<string, unknown>;
      update: Partial<StoreSettings>;
      create: Omit<StoreSettings, "updatedAt">;
    }) {
      await ensureInit();
      const client = getClient();
      const now = new Date().toISOString();

      const existing = await client.execute("SELECT COUNT(*) as cnt FROM settings WHERE id = 1");
      if (Number(existing.rows[0]?.cnt) > 0) {
        await client.execute({
          sql: "UPDATE settings SET shifts = ?, week_start = ?, holidays = ?, holiday_hours = ?, summer_time = ?, summer_shifts = ?, day_hours = ?, updated_at = ? WHERE id = 1",
          args: [
            args.update.shifts || args.create.shifts,
            args.update.weekStart || args.create.weekStart,
            args.update.holidays || args.create.holidays,
            args.update.holidayHours || args.create.holidayHours || "{}",
            (args.update.summerTime ?? args.create.summerTime) ? 1 : 0,
            args.update.summerShifts || args.create.summerShifts,
            args.update.dayHours || args.create.dayHours || "{}",
            now,
          ],
        });
      } else {
        await client.execute({
          sql: "INSERT INTO settings (id, shifts, week_start, holidays, holiday_hours, summer_time, summer_shifts, day_hours, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)",
          args: [
            args.create.shifts, args.create.weekStart, args.create.holidays,
            args.create.holidayHours || "{}",
            args.create.summerTime ? 1 : 0, args.create.summerShifts, args.create.dayHours || "{}", now,
          ],
        });
      }

      const result = await client.execute("SELECT * FROM settings WHERE id = 1");
      return rowToSettings(result.rows[0] as Record<string, unknown>);
    },
  },

  // ===== GeneratedMonth Model =====
  generatedMonth: {
    async findMany(args?: { orderBy?: Record<string, "asc" | "desc">; where?: Record<string, unknown> }) {
      await ensureInit();
      const client = getClient();

      let sql = "SELECT * FROM generated_months WHERE 1=1";
      const values: unknown[] = [];
      if (args?.where?.monthKey) {
        sql += " AND month_key = ?";
        values.push(args.where.monthKey);
      }
      if (args?.where?.region) {
        if (typeof args.where.region === "object" && (args.where.region as Record<string, unknown>).in) {
          const regions = (args.where.region as Record<string, unknown>).in as string[];
          sql += ` AND region IN (${regions.map(() => "?").join(", ")})`;
          values.push(...regions);
        } else {
          sql += " AND region = ?";
          values.push(args.where.region);
        }
      }
      if (args?.orderBy) {
        const [key, dir] = Object.entries(args.orderBy)[0];
        const col = key === "monthKey" ? "month_key" : key;
        sql += ` ORDER BY ${col} ${dir === "desc" ? "DESC" : "ASC"}`;
      }

      const result = await client.execute({ sql, args: values as (string | number | boolean | null)[] });
      return result.rows.map((r) => rowToGenMonth(r as Record<string, unknown>));
    },

    async create(args: { data: { monthKey: string; region?: string } }) {
      await ensureInit();
      const client = getClient();
      const now = new Date().toISOString();
      const region = args.data.region || "all";

      await client.execute({
        sql: "INSERT INTO generated_months (month_key, region, created_at) VALUES (?, ?, ?)",
        args: [args.data.monthKey, region, now],
      });

      const result = await client.execute({ sql: "SELECT * FROM generated_months WHERE month_key = ? AND region = ?", args: [args.data.monthKey, region] });
      return result.rows.length > 0 ? rowToGenMonth(result.rows[0] as Record<string, unknown>) : { id: 0, monthKey: args.data.monthKey, region, createdAt: now };
    },

    async deleteByMonthAndRegion(monthKey: string, region: string) {
      await ensureInit();
      const client = getClient();
      const result = await client.execute({
        sql: "DELETE FROM generated_months WHERE month_key = ? AND region = ?",
        args: [monthKey, region],
      });
      return { count: result.rowsAffected };
    },

    async deleteByMonth(monthKey: string) {
      await ensureInit();
      const client = getClient();
      const result = await client.execute({
        sql: "DELETE FROM generated_months WHERE month_key = ?",
        args: [monthKey],
      });
      return { count: result.rowsAffected };
    },
  },

  // ===== ConnectionTeam Model =====
  connectionTeam: {
    async findMany(args?: { where?: { monthKey?: string; region?: string | { in: string[] } } }) {
      await ensureInit();
      const client = getClient();

      let sql = "SELECT * FROM connection_team WHERE 1=1";
      const values: unknown[] = [];
      if (args?.where?.monthKey) {
        sql += " AND month_key = ?";
        values.push(args.where.monthKey);
      }
      if (args?.where?.region) {
        if (typeof args.where.region === "object" && (args.where.region as Record<string, unknown>).in) {
          const regions = (args.where.region as Record<string, unknown>).in as string[];
          sql += ` AND region IN (${regions.map(() => "?").join(", ")})`;
          values.push(...regions);
        } else {
          sql += " AND region = ?";
          values.push(args.where.region);
        }
      }
      sql += " ORDER BY week_start ASC";

      const result = await client.execute({ sql, args: values as (string | number | boolean | null)[] });
      return result.rows.map((r) => rowToConnectionEntry(r as Record<string, unknown>));
    },

    async create(args: { data: Omit<StoreConnectionEntry, "id" | "createdAt"> }) {
      await ensureInit();
      const client = getClient();
      const now = new Date().toISOString();

      const result = await client.execute({
        sql: `INSERT INTO connection_team (week_start, week_end, emp_idx, emp_name, emp_hrid, month_key, region, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [args.data.weekStart, args.data.weekEnd, args.data.empIdx, args.data.empName, args.data.empHrid, args.data.monthKey, args.data.region || "all", now],
      });

      return {
        ...args.data,
        id: Number(result.lastInsertRowid),
        region: args.data.region || "all",
        createdAt: now,
      };
    },

    async delete(args: { where: { id: number } }) {
      await ensureInit();
      const client = getClient();

      await client.execute({
        sql: "DELETE FROM connection_team WHERE id = ?",
        args: [args.where.id],
      });

      return { success: true };
    },

    async deleteByMonth(monthKey: string) {
      await ensureInit();
      const client = getClient();
      const result = await client.execute({
        sql: "DELETE FROM connection_team WHERE month_key = ?",
        args: [monthKey],
      });
      return { count: result.rowsAffected };
    },
  },

  // ===== RegionRotation Model =====
  regionRotation: {
    async findMany(args?: { where?: { monthKey?: string } }) {
      await ensureInit();
      const client = getClient();

      let sql = "SELECT * FROM region_rotation WHERE 1=1";
      const values: unknown[] = [];
      if (args?.where?.monthKey) {
        sql += " AND month_key = ?";
        values.push(args.where.monthKey);
      }
      sql += " ORDER BY week_start ASC";

      const result = await client.execute({ sql, args: values as (string | number | boolean | null)[] });
      return result.rows.map((r) => rowToRegionRotation(r as Record<string, unknown>));
    },

    async create(args: { data: Omit<StoreRegionRotation, "id" | "createdAt"> }) {
      await ensureInit();
      const client = getClient();
      const now = new Date().toISOString();

      const result = await client.execute({
        sql: `INSERT INTO region_rotation (region, target_area, week_start, week_end, month_key, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [args.data.region, args.data.targetArea, args.data.weekStart, args.data.weekEnd, args.data.monthKey, args.data.notes, now],
      });

      return {
        ...args.data,
        id: Number(result.lastInsertRowid),
        createdAt: now,
      };
    },

    async update(args: { where: { id: number }; data: Partial<StoreRegionRotation> }) {
      await ensureInit();
      const client = getClient();

      const sets: string[] = [];
      const values: unknown[] = [];
      if (args.data.region !== undefined) { sets.push("region = ?"); values.push(args.data.region); }
      if (args.data.targetArea !== undefined) { sets.push("target_area = ?"); values.push(args.data.targetArea); }
      if (args.data.weekStart !== undefined) { sets.push("week_start = ?"); values.push(args.data.weekStart); }
      if (args.data.weekEnd !== undefined) { sets.push("week_end = ?"); values.push(args.data.weekEnd); }
      if (args.data.notes !== undefined) { sets.push("notes = ?"); values.push(args.data.notes); }

      values.push(args.where.id);
      await client.execute({
        sql: `UPDATE region_rotation SET ${sets.join(", ")} WHERE id = ?`,
        args: values as (string | number | boolean | null)[],
      });

      return { success: true };
    },

    async delete(args: { where: { id: number } }) {
      await ensureInit();
      const client = getClient();

      await client.execute({
        sql: "DELETE FROM region_rotation WHERE id = ?",
        args: [args.where.id],
      });

      return { success: true };
    },
  },

  // ===== ConnectionAssignment Model =====
  connectionAssignment: {
    async findMany(args?: { where?: { weekStart?: string; employeeId?: number; regionCovered?: string; date?: string } }) {
      await ensureInit();
      const client = getClient();

      let sql = "SELECT * FROM connection_assignments WHERE 1=1";
      const values: unknown[] = [];
      if (args?.where?.weekStart) { sql += " AND week_start = ?"; values.push(args.where.weekStart); }
      if (args?.where?.employeeId) { sql += " AND employee_id = ?"; values.push(args.where.employeeId); }
      if (args?.where?.regionCovered) { sql += " AND region_covered = ?"; values.push(args.where.regionCovered); }
      if (args?.where?.date) { sql += " AND date = ?"; values.push(args.where.date); }
      sql += " ORDER BY date ASC";

      const result = await client.execute({ sql, args: values as (string | number | boolean | null)[] });
      return result.rows.map((r) => rowToConnectionAssignment(r as Record<string, unknown>));
    },

    async create(args: { data: Omit<StoreConnectionAssignment, "id" | "createdAt" | "updatedAt"> }) {
      await ensureInit();
      const client = getClient();
      const now = new Date().toISOString();

      const result = await client.execute({
        sql: `INSERT INTO connection_assignments (employee_id, date, week_start, region_covered, hours, override_hours, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [args.data.employeeId, args.data.date, args.data.weekStart, args.data.regionCovered, args.data.hours, args.data.overrideHours, now, now],
      });

      return {
        ...args.data,
        id: Number(result.lastInsertRowid),
        createdAt: now,
        updatedAt: now,
      };
    },

    async update(args: { where: { id: number }; data: Partial<StoreConnectionAssignment> }) {
      await ensureInit();
      const client = getClient();
      const now = new Date().toISOString();

      const sets: string[] = [];
      const values: unknown[] = [];
      if (args.data.employeeId !== undefined) { sets.push("employee_id = ?"); values.push(args.data.employeeId); }
      if (args.data.date !== undefined) { sets.push("date = ?"); values.push(args.data.date); }
      if (args.data.weekStart !== undefined) { sets.push("week_start = ?"); values.push(args.data.weekStart); }
      if (args.data.regionCovered !== undefined) { sets.push("region_covered = ?"); values.push(args.data.regionCovered); }
      if (args.data.hours !== undefined) { sets.push("hours = ?"); values.push(args.data.hours); }
      if (args.data.overrideHours !== undefined) { sets.push("override_hours = ?"); values.push(args.data.overrideHours); }
      sets.push("updated_at = ?");
      values.push(now);

      values.push(args.where.id);
      await client.execute({
        sql: `UPDATE connection_assignments SET ${sets.join(", ")} WHERE assignment_id = ?`,
        args: values as (string | number | boolean | null)[],
      });

      return { success: true };
    },

    async delete(args: { where: { id: number } }) {
      await ensureInit();
      const client = getClient();

      await client.execute({
        sql: "DELETE FROM connection_assignments WHERE assignment_id = ?",
        args: [args.where.id],
      });

      return { success: true };
    },

    async getTotals(args: { employeeId: number; monthKey?: string; weekStart?: string }) {
      await ensureInit();
      const client = getClient();

      let dateFilter = "";
      const values: unknown[] = [args.employeeId];

      if (args.weekStart) {
        // Weekly: only entries in that week
        dateFilter = " AND week_start = ?";
        values.push(args.weekStart);
      } else if (args.monthKey) {
        // Monthly: entries whose date starts with the month key
        dateFilter = " AND date LIKE ?";
        values.push(`${args.monthKey}%`);
      }

      const sql = `
        SELECT
          employee_id,
          COUNT(*) as assignment_count,
          SUM(CASE WHEN override_hours > 0 THEN override_hours ELSE hours END) as total_hours
        FROM connection_assignments
        WHERE employee_id = ?${dateFilter}
      `;

      const result = await client.execute({ sql, args: values as (string | number | boolean | null)[] });

      if (result.rows.length === 0) {
        return { employeeId: args.employeeId, assignmentCount: 0, totalHours: 0 };
      }

      const row = result.rows[0] as Record<string, unknown>;
      return {
        employeeId: Number(row.employee_id),
        assignmentCount: Number(row.assignment_count),
        totalHours: Number(row.total_hours) || 0,
      };
    },
  },
};

// Export db mode for diagnostics
export function getDbMode() {
  return _dbMode;
}
