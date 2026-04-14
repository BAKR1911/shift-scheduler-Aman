import fs from "fs";
import path from "path";

// Bundle path: data files that come with the build (read-only on Vercel)
const BUNDLE_DIR = path.join(process.cwd(), "data");
// Writable path: /tmp is writable on Vercel (per-instance)
const WRITE_DIR = path.join("/tmp", "shift-scheduler-data");

// In-memory cache for fast reads within same instance
const memoryCache = new Map<string, unknown>();

let dirsEnsured = false;

function ensureDirs() {
  if (dirsEnsured) return;
  try {
    if (!fs.existsSync(WRITE_DIR)) {
      fs.mkdirSync(WRITE_DIR, { recursive: true });
    }
  } catch {
    // Ignore if can't create on this platform
  }
  dirsEnsured = true;
}

export function readJson<T>(filename: string, fallback: T): T {
  // 1. Check memory cache first (fastest)
  if (memoryCache.has(filename)) {
    return memoryCache.get(filename) as T;
  }

  // 2. Try writable directory (has latest changes)
  try {
    ensureDirs();
    const writePath = path.join(WRITE_DIR, filename);
    if (fs.existsSync(writePath)) {
      const raw = fs.readFileSync(writePath, "utf-8");
      const data = JSON.parse(raw) as T;
      memoryCache.set(filename, data);
      return data;
    }
  } catch {
    // Ignore read errors
  }

  // 3. Try bundled data directory (initial/default data)
  try {
    const bundlePath = path.join(BUNDLE_DIR, filename);
    if (fs.existsSync(bundlePath)) {
      const raw = fs.readFileSync(bundlePath, "utf-8");
      const data = JSON.parse(raw) as T;
      memoryCache.set(filename, data);
      return data;
    }
  } catch {
    // Ignore read errors
  }

  // 4. Return fallback
  return fallback;
}

export function writeJson(filename: string, data: unknown): void {
  // Always update memory cache
  memoryCache.set(filename, data);

  // Try to write to writable directory
  try {
    ensureDirs();
    const writePath = path.join(WRITE_DIR, filename);
    fs.writeFileSync(writePath, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // File system might be read-only - data is in memory at least
  }
}
