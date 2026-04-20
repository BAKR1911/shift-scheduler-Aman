# IT Helpdesk Shift Scheduler - Worklog

---

## Current Project Status

### Assessment
The project is a fully functional **IT Helpdesk Shift Scheduler** built on Next.js 16 with App Router, libSQL (local SQLite), custom HMAC token authentication, Tailwind CSS 4, and shadcn/ui. The system manages employee shift scheduling across multiple regions (Cairo, Delta, Upper Egypt) with fairness tracking, Excel export, connection team management, and real-time admin controls.

### Architecture
- **Frontend**: Single-page application (~180KB page.tsx) with Login, Schedule Calendar, Employee Management, Settings, Export, Connection Team, Region Rotation, and User Management views
- **Backend**: RESTful API routes with role-based access control (super_admin, admin, editor, viewer)
- **Database**: SQLite via @libsql/client with custom ORM layer (no Prisma used)
- **Auth**: Custom HMAC token-based authentication with bcrypt password hashing

### Infrastructure Note
- The ~180KB monolithic page.tsx is near the memory limit of the sandbox environment
- `NODE_OPTIONS='--max-old-space-size=2048'` is configured in dev script for stability
- `agent-browser` processes cannot run simultaneously with the dev server due to memory constraints
- Server is stable for API testing via curl; browser-based QA requires server restart between sessions
- `next-themes` v0.4.6 is installed for dark mode support

---

## Session History

### Phase 1: RBAC Admin Panel (Previous Session - REVERTED)
- In a previous session, the original project was accidentally replaced with a completely different RBAC Admin Panel application
- The original IT Helpdesk Shift Scheduler was lost from the working directory
- Only survived in the backup zip file

### Phase 2: Project Restoration
- User reported the original project was missing/changed
- Verified backup exists at `upload/my-project.zip`
- Extracted all original files from backup
- Restored original `package.json` with correct dependencies (@libsql/client, exceljs, etc.)
- Removed all RBAC-only files (NextAuth, Prisma schema, etc.)

### Phase 3: Super Admin RBAC Enhancement
The original project already had `abubakr.ahmed` seeded as `super_admin` in the database, but the role checks only looked for `admin`. Fixed this:

#### Added `isAdmin()` helper to auth.ts
```typescript
export function isAdmin(role: string): boolean {
  return role === "admin" || role === "super_admin";
}
```

#### Updated 16 files with super_admin support:

**Backend API Routes (14 files):**
1. `src/app/api/users/route.ts` - GET/POST user management
2. `src/app/api/users/[id]/route.ts` - PUT/DELETE user operations
3. `src/app/api/auth/reset-password/route.ts` - Password reset
4. `src/app/api/region-rotation/route.ts` - Region rotation CRUD
5. `src/app/api/employees/route.ts` - Employee CRUD
6. `src/app/api/connection-assignments/route.ts` - Connection assignments
7. `src/app/api/connection-team/generate/route.ts` - Team generation
8. `src/app/api/connection-team/route.ts` - Team CRUD
9. `src/app/api/settings/route.ts` - Settings management
10. `src/app/api/schedule/route.ts` - Schedule generation
11. `src/app/api/schedule/[date]/route.ts` - Date schedule
12. `src/app/api/schedule/add-shift/route.ts` - Manual shift add
13. `src/app/api/schedule/swap/route.ts` - Employee swap
14. `src/app/api/export/route.ts` - Excel export

**Frontend (page.tsx - 4 targeted changes):**
- `canEdit` now includes `super_admin`
- `canAdmin` now includes `super_admin`
- Role badge: `super_admin` → purple (`bg-purple-700`)
- Region selector unlocked for `super_admin`

### Phase 4: Stability Fixes
- Reverted agent-added bloat that increased page.tsx from 172KB to 189KB (causing OOM)
- Added `NODE_OPTIONS='--max-old-space-size=1024'` to dev script
- Discovered that `agent-browser` processes consume significant memory
- Server is now stable when agent-browser is not running concurrently

---

## Login Credentials
- **Username**: `abubakr.ahmed`
- **Password**: `Admin@123`
- **Role**: `super_admin` (full access to all features)
- **Region**: `all` (access to all regions)

---

## Role Hierarchy
| Role | Permissions |
|------|------------|
| `super_admin` | Full access: manage users, all regions, all settings, delete employees |
| `admin` | Full access: manage users, all regions, all settings, delete employees |
| `editor` | Edit schedules, employees, connection team, settings |
| `viewer` | View-only access |

---

### Phase 5: Scheduler Algorithm Rewrite (Target-Based Balancing v4.1)

Complete rewrite of `src/lib/scheduler.ts` with a new algorithm based on user requirements.

#### Key Changes:

**1. OFF Weeks Logic — Only when n > 7**
- OFF weeks only apply when employees > 7 (more people than days in a week)
- When n ≤ 7: ALL employees are available every day, no weekly off person
- When n > 7: one person off per week, rotating fairly using cumulative offWeeks

**2. Target-Based Daily Assignment**
- `idealTotal = (sumCumHours + monthHours) / n` — equal target for all
- Each day: pick worker with highest deficit (most deserving of work)
- Weekend penalty: workers with more Fri/Sat days get penalized
- Days balance: slight penalty for more total days
- Deterministic: NO Math.random() — reproducible results

**3. No Consecutive Days Constraint**
- Hard constraint: same person can't work two days in a row
- Tracks `lastWorker` across days AND across month boundaries
- Soft fallback only when n=2 and unavoidable

**4. Post-Optimization Swaps**
- Up to 30 iterations of cross-week employee swaps
- Only swaps that reduce hour variance (or same variance + better weekend balance)
- Consecutive day constraint checked before allowing swap

**5. Schedule Generation Protection**
- Added `force` parameter to POST /api/schedule
- If month already generated and `force` is not true → returns `alreadyGenerated: true`
- Prevents accidental overwriting of existing schedules
- Cross-month cumulative stats carry forward

**6. Connection Team — Target-Based**
- Uses `generateConnectionTeamSchedule()` from scheduler.ts
- Considers cumulative connection weeks + HelpDesk hours
- No consecutive week assignments when possible

#### Results (April 2026):
| Region | Employees | Before (v3) | After (v4.1) | Consecutive |
|--------|-----------|-------------|--------------|-------------|
| Cairo | 3 | 67/48/67h (Δ19h) | **62/61/59h (Δ3h)** | ✅ None |
| Delta | 3 | 67/48/67h (Δ19h) | **62/61/59h (Δ3h)** | ✅ None |
| Upper Egypt | 2 | 96/86h (Δ10h) | **91/91h (Δ0h!)** | ✅ None |

---

## Verification Results
- ✅ Login API: `abubakr.ahmed` authenticates successfully as `super_admin`
- ✅ All APIs: employees, settings, schedule, reports, connection-team, region-rotation all return 200
- ✅ Auto-schedule generation: Successfully generated 30 entries per region per month
- ✅ Fairness: Hour variance ≤ 3h across all regions (was 19h before)
- ✅ No consecutive days: 0 violations across all regions
- ✅ Weekend fairness: Fri/Sat distributed evenly with penalty scoring
- ✅ Already-generated protection: months can't be accidentally overwritten
- ✅ Deterministic: same inputs produce same outputs
- ✅ Frontend compiles and serves pages (200 OK)

---

### Phase 6: Professional Matrix Excel Export

Added a new "📊 Matrix View" export tab in the Export dialog that generates a comprehensive Excel file with multiple sheets:

#### New API Route: `POST /api/export-matrix`
**Sheets generated:**

1. **Config (Settings)** — Blue header, region & team dropdowns via Data Validation, bilingual legend (Arabic/English), generation timestamp

2. **Per-Region HelpDesk Matrix** (e.g., "Cairo - HelpDesk", "Delta - HelpDesk", "Upper Egypt - HelpDesk"):
   - Rows = employees, Columns = days grouped by week (Fri→Thu)
   - Values: **W** (green) = Working, **Off** (red) = Weekly Off, blank = not assigned
   - Stats columns with Excel formulas: `COUNTIF` for work/off days, MAX/MIN, Fri/Sat counts, consecutive violation count
   - Summary rows: Totals, MIN, Variance (Max-Min) with alert if > 1
   - **Conditional formatting**: Red highlight for consecutive work days
   - **Smart recommendations**: Per-employee advice (reduce pressure, redistribute, etc.)
   - Frozen panes (header + employee name column)

3. **Connection Team Sheet** — Weekly assignment matrix per employee with total weeks and hours

4. **Summary Sheet** — Comprehensive dashboard:
   - Per-region stats: MAX, MIN, Avg, Variance, Off Days, Consecutive violations
   - Overall metrics with color-coded status (✅/⚠️/🔴)
   - Detailed per-employee breakdown with smart notes
   - Status formula: variance > 2 or consecutive > 0 → 🔴 needs review

#### Frontend Changes (page.tsx):
- Added "📊 Matrix View" tab in Export dialog (orange theme)
- `exportMatrixExcel()` function calling `/api/export-matrix`
- Feature showcase section: Config, Matrix, Connection Team, Summary cards
- Feature legend: conditional formatting, W/Off colors, variance alerts, formulas, recommendations
- Region selector for matrix export

#### Technical Notes:
- ExcelJS `addTable()` removed — requires programmatic row definitions incompatible with direct cell population; custom styling is used instead
- ExcelJS conditional formatting uses `type: "expression"` (not `"formula"`) per ExcelJS type definitions
- TypeScript strict compatibility: `(ws as any).addConditionalFormatting()` for type workaround
- All formulas are live Excel formulas (COUNTIF, MAX, MIN, AND)

#### Files Created/Modified:
- `src/app/api/export-matrix/route.ts` — New API route (~960 lines)
- `src/app/page.tsx` — Added Matrix View tab, export function, LayoutGrid import

---

### Phase 7: Export Region Selection - Checkboxes Instead of Dropdown

Changed the region selection in the Export dialog from a `Select` dropdown to **checkboxes** per user request.

#### Changes:

**Frontend (`page.tsx`):**
- Changed `exportRegion` state from `string` to `exportRegions: string[]` (array)
- Added `toggleExportRegion()` helper for checkbox toggle
- Replaced `Select` dropdowns with `Checkbox` groups in both **Helpdesk** and **Matrix** export tabs
- Each region (Cairo, Delta, Upper Egypt) shown as a bordered checkbox item
- Removed "All Regions" option entirely
- Employee filtering now shows employees from all checked regions
- Added validation: if no region checked, toast error shown before export
- All 3 export functions now send `regions: exportRegions` array to backend

**Backend APIs:**
- `POST /api/export/helpdesk` — Accepts `regions: string[]`, filters entries by `regionList.includes()`
- `POST /api/export-matrix` — Accepts `regions: string[]`, derives `regionsToExport` from array
- `POST /api/export` (both) — Accepts `regions: string[]`, uses `{ in: regionList }` for DB queries
- All APIs still respect `auth.region` permission restriction

#### Files Modified:
- `src/app/page.tsx` — State, UI checkboxes, export functions, validation
- `src/app/api/export/helpdesk/route.ts` — `regions` array support
- `src/app/api/export-matrix/route.ts` — `regions` array support
- `src/app/api/export/route.ts` — `regions` array support

---

### Phase 8: Export Bug Fixes

#### Bug 1: Export API returning "Failed to export Helpdesk"
**Root cause**: The custom ORM in `db.ts` only supported simple equality (`region = ?`) for the `where.region` filter, but the export routes after Phase 7 were passing `{ in: regionList }` which is not handled, causing `SQLite3 can only bind numbers, strings, bigints, buffers, and null`.

**Fix**: Added `{ in: [...] }` support for the `region` field in both `scheduleEntry.findMany()` and `generatedMonth.findMany()` in `db.ts`. The ORM now detects when `where.region` is an object with an `in` property and generates `AND region IN (?, ?, ...)` SQL with proper parameter binding.

**Files modified**: `src/lib/db.ts` (lines 819-828, 1114-1123)

#### Bug 2: Dev server OOM during export route compilation
**Root cause**: The dev script had `NODE_OPTIONS='--max-old-space-size=1024'` which was insufficient for compiling the 172KB page.tsx + export route handlers simultaneously.

**Fix**: Increased memory limit to `2048` in `package.json` dev script.

**Files modified**: `src/package.json` (dev script)

---

## Unresolved Issues / Risks

### Infrastructure
- **Memory pressure**: The 172KB monolithic page.tsx is at the limit of sandbox memory. Adding significant code risks OOM crashes.
- **agent-browser conflict**: Running agent-browser alongside the dev server causes OOM. Must kill browser before starting server.
- **No hot reload on some changes**: Some file changes may cause recompilation that exceeds memory.

### Priority Recommendations for Next Phase
1. **Split page.tsx**: Break the 172KB monolithic component into separate files (login, schedule, employees, settings, connection-team) to reduce memory per compilation
2. **Audit logging**: Add audit trail for admin actions (user creation, role changes, etc.)
3. **Password reset flow**: Add forgot password functionality
4. **Rate limiting**: Add rate limiting on login attempts
5. **UI improvements**: Add loading skeletons, enhance mobile responsiveness
6. **Toast notifications**: Add success/error feedback for all user actions

---

### Phase 9: QA Bug Fixes & UI/UX Enhancements

#### Bug Verification
1. **Bug 1 (Connection Team Clear)**: ✅ Verified — `src/app/api/connection-team/route.ts` DELETE endpoint supports `?id=X`, `?monthKey=X`, and no-param (clear all). `clearConnectionTeam()` in page.tsx correctly passes `?monthKey=${selectedMonth}`.
2. **Bug 2 (Helpdesk Export)**: ✅ Verified — `src/app/api/export/helpdesk/route.ts` already includes Region column (col 6), fills missing days, sorts by date then region.

#### Bug 3 Fix: Export Summary Counts Include Placeholder Rows
**File**: `src/app/api/export/helpdesk/route.ts`
**Problem**: Employee Summary (Sheet 2) and Helpdesk Summary counted placeholder "—" rows (generated for missing days).
**Fix**: 
- Line 273: Added `if (e.empName === "—") return;` guard in employee stats forEach loop
- Lines 220-222: Summary counts (totalHours, workDays, holidays) now filter out `empName === "—"` before computing

#### Style 1: Login Page Enhancement
**File**: `src/app/page.tsx`
- Line 247: Login background changed to `bg-gradient-to-br from-slate-50 to-emerald-50 dark:from-slate-900 dark:to-slate-800`
- Line 253: Added `<Calendar>` icon next to heading with emerald color
- Line 261: Card gets `hover:shadow-lg hover:shadow-emerald-100 dark:hover:shadow-emerald-900/20 transition-all duration-300`
- Line 287: Sign In button gets emerald hover + shadow transition

#### Style 2: Tab Navigation Enhancement
**File**: `src/app/page.tsx`
- Lines 1910, 1918: Active tabs get gradient backgrounds (`bg-gradient-to-r from-blue-600 to-blue-700` / `from-teal-600 to-teal-700`)
- Both active and inactive tabs get `transition-all duration-200 hover:shadow-sm`

#### Style 3: Employee Cards Enhancement
**File**: `src/app/page.tsx`
- Line 2555: Employee cards get `p-2.5`, `transition-all duration-200 hover:shadow-md hover:-translate-y-0.5`
- Line 2510: Team type badges get colored styling — helpdesk=green, connection=teal, both=purple

#### Style 4: Stats Dashboard Enhancement
**File**: `src/app/page.tsx`
- Lines 1929-1932: Existing stats row cards upgraded with colored gradient backgrounds, matching border colors, and `hover:shadow-md transition-shadow`

#### Style 5: Footer Enhancement
**File**: `src/app/page.tsx`
- Lines 3144-3150: Added `<footer>` with `mt-auto` for sticky positioning, gradient separator line, and centered copyright text

#### Feature 1: Schedule Statistics Dashboard Card
**File**: `src/app/page.tsx`
- Lines 1948-1982: New 4-card grid dashboard above schedule content showing Total Hours, Work Days, Avg Hours/Person, and Holidays with colored gradient cards and icons (TrendingUp, CalendarDays, Users, Sun)

#### Feature 2: Quick Employee Count by Region
**File**: `src/app/page.tsx`
- Lines 2540-2553: Added region summary bar in Employees dialog showing Cairo/Delta/Upper Egypt counts and total, with purple-styled total badge

#### Import Addition
- Line 20: Added `TrendingUp` to lucide-react imports for stats dashboard icon

#### Lint Results
- 0 errors, 2 warnings (pre-existing in `export-matrix/route.ts`, unrelated to changes)
- Dev server compiles successfully (200 OK)

---

### Phase 10: UI Polish & Activity Feed

#### TASK 1: Login Page Polish
**File**: `src/app/page.tsx`
- **Loader2 spinner**: Replaced `RefreshCw` with `Loader2` icon on Sign In button for proper loading spinner visual; added `Loader2` and `Activity` to lucide-react imports
- **Placeholder contrast**: Added `placeholder:text-slate-400 dark:placeholder:text-slate-500` to both username and password inputs
- **Password toggle accessibility**: Added dynamic `aria-label` ("Show password" / "Hide password") to the password visibility toggle button
- **Login card animation**: Added `animate-in fade-in-0 zoom-in-95 duration-500` to the login Card for entrance animation
- **Powered-by text**: Added `<p className="text-center text-xs text-slate-400 mt-3">Powered by Z.ai Shift Scheduler</p>` below the Sign In button

#### TASK 2: Schedule Table Styling
**File**: `src/app/page.tsx`
- Added `hover:bg-emerald-50/80 dark:hover:bg-emerald-950/20 transition-colors` to 5 tables:
  - Region Rotation table rows (with alternating via `rr.id % 2 === 0`)
  - Connection Team Distribution table rows (with alternating via `idx % 2 === 1`)
  - Connection Assignments table rows (with alternating via `a.id % 2 === 0`)
  - Stats employee table rows (with alternating via `idx % 2 === 1`)
  - User Management table rows (with alternating via `u.id % 2 === 0`)
- Added alternating row colors `bg-slate-50/50 dark:bg-slate-900/30` to Connection Team Roster table (already had teal hover)

#### TASK 3: Activity Feed (New Feature)
**File**: `src/app/page.tsx`
- **State**: Added `recentActivity` state array (`Array<{action: string; time: string}>`) after authChecking state
- **Helper**: Added `addActivity` useCallback that prepends new entries with timestamp and caps at 5 items
- **UI Card**: Added Activity Feed card between Schedule Statistics Dashboard and Swap Banner, showing recent actions with `Activity` icon header and timestamps
- **Integration**: Added `addActivity()` calls after successful:
  - Schedule generation (`generateMonth`)
  - Connection Team generation (`generateConnectionMonth`)
  - Employee swap operations (`swapEmployees`)

#### TASK 4: Export Dialog Polish
**File**: `src/app/page.tsx`
- Added `shadow-inner` to all 4 active export type tab buttons (Helpdesk, Connection, HRID, Matrix)
- Added `border border-slate-200 dark:border-slate-700 rounded-lg p-3` wrapper around region checkboxes groups in both Helpdesk and Matrix export tabs

#### TASK 5: Settings Enhancement
**File**: `src/app/page.tsx`
- Added `Clock` icon with emerald color to the "Shift Times" section header for better visual hierarchy and section identification

#### TASK 6: Dark Mode Toggle
**Verified**: `next-themes` (v0.4.6) is installed and `useTheme` hook is already active at line 301. A Sun/Moon toggle button already exists in the header (line 1842) with tooltip. No additional changes needed.

#### Lint Results
- 0 errors, 2 warnings (pre-existing in `export-matrix/route.ts`, unrelated to changes)
- All changes are minimal and targeted — no new files created

---

### Phase 11: Bug Fixes, Style Improvements & Feature Enhancements

#### Bug Fix 1: "All Regions" View Added to Region Selector
**File**: `src/app/page.tsx`
- Line 1900: Removed `.filter(([k]) => k !== "all")` from region selector so "All Regions" option appears as first choice
- Lines 1635-1636: `filteredEntries` and `regionActiveEmps` already correctly handle `selectedRegion === "all"` (verified pre-existing)
- Line 1889: `setExportRegions` already maps "all" to `["cairo", "delta", "upper_egypt"]` (verified pre-existing)
- Line 1885: Added `|| selectedRegion === "all"` to Generate Month button's `disabled` condition to prevent generating with "all" selected
- Line 2275: Also updated the empty state Generate button with same `selectedRegion === "all"` disabled condition

#### Bug Fix 2: Export Accuracy — Regions Always Shown
**File**: `src/app/api/export/helpdesk/route.ts`
- Line 49: Simplified `regionsToShow` to always use `regionList` directly, ensuring placeholder rows are generated for all requested regions even when no entries exist

#### Style 1: Header Enhancement — Backdrop Blur
**File**: `src/app/page.tsx`
- Line 1793: Changed header from solid `bg-[#0F172A]` to `bg-[#0F172A]/95 backdrop-blur-md` with subtle `border-b border-slate-700/50` bottom border

#### Style 2: Login Page Gradient Enhancement
**File**: `src/app/page.tsx`
- Line 248: Enhanced login background from 2-stop to 3-stop gradient: `from-slate-50 via-emerald-50 to-teal-50` (dark mode: `from-slate-900 via-slate-800 to-slate-900`)

#### Style 3: Empty State Visual Enhancement
**File**: `src/app/page.tsx`
- Lines 2269-2276: Wrapped CalendarDays icon in a large circular container (`w-24 h-24 rounded-full bg-slate-100`), increased icon size to `h-12 w-12`, increased vertical padding to `py-24`, added `leading-relaxed` to description, added `shadow-md hover:shadow-lg transition-shadow` to Generate button

#### Style 4: Week Card Headers — More Vibrant Gradient
**File**: `src/app/page.tsx`
- Line 2285: Changed gradient from `from-[#1B2A4A] to-[#1D4ED8]` to `from-[#0F2847] to-[#1E50D8]` for deeper, more vibrant colors

#### Style 5: Footer Sticky Bottom
**File**: `src/app/page.tsx`
- Verified: Footer already has `mt-auto` in flex column layout (line 3223). No changes needed — confirmed working.

#### Feature 1: Employee Search/Filter
**File**: `src/app/page.tsx`
- Line 348: Added `empSearchQuery` state variable
- Lines 2571-2575: Added search input with Search icon above the Region Summary Bar in Employees dialog
- Line 2590: Employee list now filters by `empSearchQuery` matching name or HRID (case-insensitive)

#### Feature 2: Quick Stats Bar in Header
**File**: `src/app/page.tsx`
- Lines 1807-1810: Added two small Badge indicators in header showing `{generatedMonths.length} months` and `{employees.length} staff`, visible on `md:` screens and above

#### Feature 3: Keyboard Shortcut Hints
**File**: `src/app/page.tsx`
- Line 1890: Added `<kbd>G</kbd>` badge to Generate Month button
- Line 1894: Added `<kbd>E</kbd>` badge to Export Excel button
- Both kbd elements styled with `font-mono`, `text-[10px]`, subtle background, and matching border colors

#### Lint Results
- 0 errors, 2 warnings (pre-existing in `export-matrix/route.ts`, unrelated to changes)
- Dev server compiles and runs successfully

---

## Handover Document (Current Status)

### 1. Current Project Status Assessment

**Overall Health**: ✅ Stable and functional. The application compiles successfully, all API routes return 200, and the frontend renders correctly in the preview panel.

**Active Issues**:
- **Server stability**: The ~3232-line monolithic page.tsx causes OOM during Turbopack compilation in the sandbox environment. The server needs a keep-alive loop (`start-server.sh`) to auto-restart. `NODE_OPTIONS='--max-old-space-size=4096'` is recommended.
- **No curl API testing possible**: The server dies during heavy compilation cycles when the preview panel loads simultaneously. API testing must be done via the preview panel or with careful timing.

### 2. Current Goals / Completed Modifications / Verification Results

#### Bugs Fixed This Session:
1. ✅ **"All Regions" view** — Region selector now includes "All Regions" as first option. Generate button disabled when "all" selected. `filteredEntries` and `regionActiveEmps` correctly handle "all" to show entries from all regions.
2. ✅ **Export accuracy (partial days)** — `regionsToShow` in helpdesk export now always uses `regionList` directly, ensuring all requested regions get placeholder rows for all days of the month, even when no schedule entries exist.
3. ✅ **Connection Team DELETE** — Previously fixed (from prior session) to use `?monthKey=X` filter instead of deleting all entries.

#### Styling Improvements:
1. ✅ Header: `backdrop-blur-md` with semi-transparent bg and subtle bottom border for modern glass effect
2. ✅ Login page: Enhanced to 3-stop gradient (slate → emerald → teal)
3. ✅ Empty state: Larger icon in circular container, better spacing
4. ✅ Week card headers: More vibrant gradient (`#0F2847 → #1E50D8`)
5. ✅ Footer: Verified sticky bottom with `mt-auto`

#### New Features:
1. ✅ **Employee Search/Filter** — Search input in Employees dialog filters by name or HRID (case-insensitive)
2. ✅ **Quick Stats Bar** — Header badges showing generated months count and total staff count
3. ✅ **Keyboard Shortcut Hints** — `<kbd>G</kbd>` on Generate button, `<kbd>E</kbd>` on Export button

#### Verification:
- ✅ `bun run lint` — 0 errors, 2 pre-existing warnings
- ✅ Server compiles page.tsx successfully (200 OK, ~1.5-2s compile time)
- ✅ All API routes return 200 after compilation (auth, employees, settings, schedule, reports, connection-team, region-rotation, connection-assignments)

### 3. Unresolved Issues or Risks

#### High Priority:
1. **Server memory instability** — The 3232-line page.tsx is at the limit of sandbox memory (8GB total, but Turbopack uses ~1.2GB per compilation). Keep-alive loop mitigates but doesn't solve.
2. **Cannot run agent-browser simultaneously** — Memory conflict prevents browser-based QA testing alongside the dev server.

#### Medium Priority:
1. **page.tsx should be split** — Breaking into separate files (login, schedule, employees, settings, connection-team, export) would dramatically improve stability and compilation speed.
2. **No schedule generated for current data** — The database has seed employees but no schedule entries. User needs to click "Generate Month" for each region.

#### Low Priority:
1. **Keyboard shortcuts are visual only** — The `<kbd>` hints are displayed but not wired to actual keyboard handlers (intentional, to minimize code size).
2. **Export HRID route** — Untested in this session but was working in prior sessions.

### Priority Recommendations for Next Phase:
1. **🔴 Split page.tsx** — Break into 5-6 separate component files to reduce memory pressure
2. **🟡 Generate test data** — Auto-generate schedule for April 2026 for all 3 regions so the app has visible data
3. **🟡 Add audit logging** — Track admin actions (schedule generation, employee changes, etc.)
4. **🟡 Mobile responsiveness audit** — Test all views on mobile viewport sizes
5. **🟢 Add notification system** — In-app notifications for schedule changes, approaching deadlines
6. **🟢 Dashboard charts** — Use recharts (already installed) to add hour distribution charts per employee/region
