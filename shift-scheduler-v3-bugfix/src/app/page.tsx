"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar, Users, Settings, Plus, Trash2, RefreshCw, TrendingUp,
  CalendarDays, Clock, Sun, Moon, X, ArrowLeftRight, AlertTriangle,
  CheckCircle, Info, ChevronDown, ChevronUp, FileSpreadsheet, BarChart3,
  Sparkles, Eye, EyeOff, LogOut, User, Shield, KeyRound, Lock, HeadphonesIcon,
  Pencil, Download, UserCog, Link2, MapPin, RotateCcw, ClipboardList, Search, LayoutGrid,
  Loader2, Activity
} from "lucide-react";
import { computeLocalStats, computeOffWeeks, recalcScheduleHours } from "@/lib/scheduler";

// ===== Types =====
interface Employee {
  id: number;
  name: string;
  hrid: string;
  active: boolean;
  region: string;
  teamType: string;
}

interface ShiftConfig {
  start: string;
  end: string;
  hours: number;
}

interface SettingsData {
  shifts: Record<string, ShiftConfig>;
  weekStart: string;
  monthStartMode: "weekStartAligned" | "monthDay1";
  holidays: string[];
  holidayHours: Record<string, number>; // Custom hours deduction for each holiday date
  summerTime: boolean;
  summerShifts: Record<string, ShiftConfig>;
  dayHours: Record<string, number>;
}

interface ScheduleEntry {
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
  region: string;
}

interface LocalStats {
  days: number;
  hours: number;
  weekend: number;
  sat: number;
  fri: number;
  offWeeks: number;
  lastDayIdx: number;
}

interface CumulativeStats {
  totalHours: number;
  totalDays: number;
  weekendDays: number;
  saturdays: number;
  fridays: number;
  offWeeks: number;
}

interface BalanceInfo {
  status: "green" | "yellow" | "red";
  variance: number;
  average: number;
  avgAbsDeviation: number;
  max: number;
  min: number;
}

interface UserInfo {
  id: string;
  username: string;
  role: string;
  email: string | null;
  region: string;
}

interface UserMgmt {
  id: string;
  username: string;
  email: string | null;
  role: string;
  region: string;
  createdAt: string;
  updatedAt: string;
}

interface ConnectionTeamEntry {
  id: number;
  weekStart: string;
  weekEnd: string;
  empIdx: number;
  empName: string;
  empHrid: string;
  monthKey: string;
  region: string;
}

interface RegionRotationEntry {
  id: number;
  region: string;
  targetArea: string;
  weekStart: string;
  weekEnd: string;
  monthKey: string;
  notes: string;
}

interface ConnectionAssignment {
  id: number;
  employeeId: number;
  date: string;
  weekStart: string;
  regionCovered: string;
  hours: number;
  overrideHours: number;
}

interface ConnectionAssignmentTotals {
  employeeId: number;
  weekly: { assignmentCount: number; totalHours: number } | null;
  monthly: { assignmentCount: number; totalHours: number } | null;
}

// ===== Region helpers =====
const REGIONS: Record<string, string> = {
  all: "All Regions",
  cairo: "Cairo",
  delta: "Delta",
  upper_egypt: "Upper Egypt",
};

// ===== Team Type helpers =====
const TEAM_TYPES: Record<string, string> = {
  helpdesk: "Helpdesk",
  connection: "Connection",
};

// ===== Helpers =====
function getDayTypeBadge(dayType: string, isHoliday?: boolean) {
  if (isHoliday) return { label: "HOL", color: "bg-red-500 text-white" };
  switch (dayType) {
    case "Saturday": return { label: "Sat", color: "bg-blue-500 text-white" };
    case "Friday": return { label: "Fri", color: "bg-amber-500 text-white" };
    case "Thursday": return { label: "Thu", color: "bg-cyan-500 text-white" };
    default: return { label: "WD", color: "bg-emerald-500 text-white" };
  }
}

function getWeekNumber(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const fri = new Date(d);
  while (fri.getDay() !== 5) fri.setDate(fri.getDate() - 1);
  const y = fri.getFullYear();
  const m = String(fri.getMonth() + 1).padStart(2, "0");
  const day = String(fri.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateDisplay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatHolidayDisplay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

// Get default holiday hours deduction based on weekday
function getDefaultHolidayHours(dateStr: string, settings: SettingsData | null): number {
  const d = new Date(dateStr + "T00:00:00");
  const dayName = d.toLocaleDateString("en-US", { weekday: "long" });

  // Use shift hours as default based on weekday
  if (settings?.shifts) {
    const shift = settings.shifts[dayName];
    if (shift) return shift.hours;
  }

  // Default fallback: 9 hours for Friday/Saturday, 5 hours for other days
  if (dayName === "Friday" || dayName === "Saturday") {
    return 9;
  }
  return 5;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ===== Login Component =====
function LoginScreen({
  onLogin,
  loginError,
  loginLoading,
  setLoginUsername,
  setLoginPassword,
  showPassword,
  setShowPassword,
  loginUsername,
  loginPassword,
}: {
  onLogin: () => void;
  loginError: string;
  loginLoading: boolean;
  setLoginUsername: (v: string) => void;
  setLoginPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  loginUsername: string;
  loginPassword: string;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-emerald-50 to-teal-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#0F172A] to-[#1D4ED8] shadow-lg mb-4">
            <HeadphonesIcon className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center justify-center gap-2">
            <Calendar className="h-8 w-8 text-emerald-600" />
            IT Helpdesk Shift Scheduler
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Sign in to access the scheduling system
          </p>
        </div>
        <Card className="shadow-lg border-slate-200 dark:border-slate-800 hover:shadow-lg hover:shadow-emerald-100 dark:hover:shadow-emerald-900/20 transition-all duration-300 animate-in fade-in-0 zoom-in-95 duration-500">
          <CardContent className="p-6">
            <form onSubmit={(e) => { e.preventDefault(); onLogin(); }} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium text-slate-700 dark:text-slate-300">Username</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input id="username" type="text" placeholder="Enter your username" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} className="pl-10 h-11 placeholder:text-slate-400 dark:placeholder:text-slate-500" autoComplete="username" required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium text-slate-700 dark:text-slate-300">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input id="password" type={showPassword ? "text" : "password"} placeholder="Enter your password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className="pl-10 pr-10 h-11 placeholder:text-slate-400 dark:placeholder:text-slate-500" autoComplete="current-password" required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors" tabIndex={-1}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {loginError && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
                  <span className="text-sm text-red-700 dark:text-red-300">{loginError}</span>
                </div>
              )}
              <Button type="submit" disabled={loginLoading} className="w-full h-11 bg-gradient-to-r from-[#0F172A] to-[#1D4ED8] hover:from-emerald-700 hover:to-emerald-600 hover:shadow-lg hover:shadow-emerald-200 dark:hover:shadow-emerald-900/30 transition-all duration-200 text-white font-semibold text-sm">
                {loginLoading ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Signing in...</span> : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-slate-400 mt-6">IT Helpdesk Shift Scheduler &copy; {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}

// ===== Main Component =====
export default function ShiftSchedulerPage() {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();

  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [recentActivity, setRecentActivity] = useState<Array<{action: string; time: string}>>([]);

  const addActivity = useCallback((action: string) => { setRecentActivity(prev => [{action, time: new Date().toLocaleTimeString()}, ...prev].slice(0, 5)); }, []);

  // Change password
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);

  // Data state (DB-backed)
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [generatedMonths, setGeneratedMonths] = useState<string[]>([]);
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  // UI state
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [generating, setGenerating] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<string>("cairo");
  // Connection team region is always 'all' - no selector needed

  // Modals
  const [showSettings, setShowSettings] = useState(false);
  const [showEmployees, setShowEmployees] = useState(false);
  const [empSearchQuery, setEmpSearchQuery] = useState("");
  const [showAddShift, setShowAddShift] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showUserMgmt, setShowUserMgmt] = useState(false);

  // Swap state
  const [swapMode, setSwapMode] = useState(false);
  const [swapFirst, setSwapFirst] = useState<{ idx: number; name: string } | null>(null);

  // Employee management
  const [newEmpName, setNewEmpName] = useState("");
  const [newEmpHrid, setNewEmpHrid] = useState("");
  const [editingEmpId, setEditingEmpId] = useState<number | null>(null);
  const [editEmpName, setEditEmpName] = useState("");
  const [editEmpHrid, setEditEmpHrid] = useState("");
  const [newEmpRegion, setNewEmpRegion] = useState("cairo");
  const [editEmpRegion, setEditEmpRegion] = useState("cairo");
  const [newEmpTeamType, setNewEmpTeamType] = useState("helpdesk");
  const [editEmpTeamType, setEditEmpTeamType] = useState("");

  // Add shift
  const [addShiftDate, setAddShiftDate] = useState("");
  const [addShiftEmp, setAddShiftEmp] = useState("");

  // Settings editing
  const [editSettings, setEditSettings] = useState<SettingsData | null>(null);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayHours, setNewHolidayHours] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [newDayHourDate, setNewDayHourDate] = useState("");
  const [newDayHourValue, setNewDayHourValue] = useState("");

  // Export
  const [exportSelectedIds, setExportSelectedIds] = useState<number[]>([]);
  const [exportDateFrom, setExportDateFrom] = useState("");
  const [exportDateTo, setExportDateTo] = useState("");
  const [exportRegions, setExportRegions] = useState<string[]>([]);
  const toggleExportRegion = (r: string) => setExportRegions(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  const [exportType, setExportType] = useState<"helpdesk" | "connection" | "hrid" | "matrix">("helpdesk");
  const [exportConnectionOnly, setExportConnectionOnly] = useState(false);
  const [exportHrid, setExportHrid] = useState("");
  const [exportHridMonthFrom, setExportHridMonthFrom] = useState("");
  const [exportHridMonthTo, setExportHridMonthTo] = useState("");
  const [exporting, setExporting] = useState(false);

  // User management
  const [users, setUsers] = useState<UserMgmt[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("viewer");
  const [newUserRegion, setNewUserRegion] = useState("cairo");
  const [editingUser, setEditingUser] = useState<UserMgmt | null>(null);
  const [editUserEmail, setEditUserEmail] = useState("");
  const [editUserRole, setEditUserRole] = useState("viewer");
  const [editUserRegion, setEditUserRegion] = useState("cairo");
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetPwUserId, setResetPwUserId] = useState("");
  const [resetPwNewPassword, setResetPwNewPassword] = useState("");
  const [deletingUser, setDeletingUser] = useState<UserMgmt | null>(null);

  // Connection team
  const [connectionTeam, setConnectionTeam] = useState<ConnectionTeamEntry[]>([]);
  const [showAddConnection, setShowAddConnection] = useState(false);
  const [connWeekStart, setConnWeekStart] = useState("");
  const [connWeekEnd, setConnWeekEnd] = useState("");
  const [connEmpIdx, setConnEmpIdx] = useState("");

  // Connection team replace/transfer
  const [showConnReplace, setShowConnReplace] = useState(false);
  const [connReplaceFrom, setConnReplaceFrom] = useState("");
  const [connReplaceTo, setConnReplaceTo] = useState("");
  const [connReplaceHours, setConnReplaceHours] = useState("");

  // Region rotation
  const [regionRotations, setRegionRotations] = useState<RegionRotationEntry[]>([]);
  const [showAddRotation, setShowAddRotation] = useState(false);
  const [rotRegion, setRotRegion] = useState("cairo");
  const [rotTargetArea, setRotTargetArea] = useState("");
  const [rotWeekIdx, setRotWeekIdx] = useState(0);
  const [rotNotes, setRotNotes] = useState("");

  // Connection assignments
  const [connAssignments, setConnAssignments] = useState<ConnectionAssignment[]>([]);
  const [connAssignmentTotals, setConnAssignmentTotals] = useState<ConnectionAssignmentTotals[]>([]);
  const [showConnectionSchedule, setShowConnectionSchedule] = useState(false);
  const [showAddAssignment, setShowAddAssignment] = useState(false);
  const [assignEmpId, setAssignEmpId] = useState("");
  const [assignRegionCovered, setAssignRegionCovered] = useState("");
  const [assignWeekIdx, setAssignWeekIdx] = useState(0);
  const [assignSplit, setAssignSplit] = useState<"full" | "first_half" | "second_half">("full");
  const [assignHours, setAssignHours] = useState("");
  const [assignOverrideHours, setAssignOverrideHours] = useState("");

  // Week collapse
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());

  // Inline hours editing
  const [editingHoursDate, setEditingHoursDate] = useState<string | null>(null);
  const [editingHoursValue, setEditingHoursValue] = useState<string>("");

  // Active tab: "helpdesk" or "connection"
  const [activeTab, setActiveTab] = useState<"helpdesk" | "connection">("helpdesk");

  // Auto-switch connection users to connection tab
  useEffect(() => {
    if (user?.role === "connection" && activeTab === "helpdesk") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab("connection");
    }
  }, [user?.role, activeTab]);

  // Role helpers
  const canEdit = user && (user.role === "admin" || user.role === "super_admin" || user.role === "editor" || user.role === "connection");
  const canAdmin = user && (user.role === "admin" || user.role === "super_admin");

  // Authenticated fetch wrapper
  const authFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {});
    if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
    if (!headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");
    return fetch(url, { ...options, headers });
  }, [authToken]);

  // ===== Data Fetching =====
  const fetchAllData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [empRes, settRes] = await Promise.all([
        authFetch("/api/employees").then((r) => r.json()),
        authFetch("/api/settings").then((r) => r.json()),
      ]);

      if (empRes.employees) setEmployees(empRes.employees);

      if (settRes.shifts) {
        setSettings({
          ...settRes,
          monthStartMode: settRes.monthStartMode || "weekStartAligned",
          dayHours: settRes.dayHours || {},
          holidayHours: settRes.holidayHours || {},
        });
      } else {
        setSettings({
          shifts: { Weekday: { start: "05:00 PM", end: "10:00 PM", hours: 5 }, Thursday: { start: "05:00 PM", end: "10:00 PM", hours: 5 }, Friday: { start: "01:00 PM", end: "10:00 PM", hours: 9 }, Saturday: { start: "01:00 PM", end: "10:00 PM", hours: 9 }, Holiday: { start: "10:00 AM", end: "10:00 PM", hours: 12 } },
          weekStart: "Friday", holidays: [], holidayHours: {}, summerTime: false,
          summerShifts: { Weekday: { start: "05:00 PM", end: "11:00 PM", hours: 6 }, Thursday: { start: "05:00 PM", end: "11:00 PM", hours: 6 }, Friday: { start: "01:00 PM", end: "11:00 PM", hours: 10 }, Saturday: { start: "01:00 PM", end: "11:00 PM", hours: 10 } },
          monthStartMode: "weekStartAligned",
          dayHours: {},
        });
      }
    } catch (e) {
      console.error("Error fetching data:", e);
    }
    setDataLoading(false);
  }, [authFetch]);

  const fetchBalance = useCallback(async () => {
    try {
      const res = await authFetch(`/api/reports?month=${selectedMonth}&region=${selectedRegion}`);
      const data = await res.json();
      if (data.balance) setBalance(data.balance);
    } catch {
      // ignore
    }
  }, [authFetch, selectedMonth, selectedRegion]);

  const fetchScheduleEntries = useCallback(async () => {
    try {
      const res = await authFetch(`/api/schedule?month=${selectedMonth}&region=${selectedRegion}`);
      if (res.ok) {
        const data = await res.json();
        console.log("[fetchScheduleEntries] Received data:", {
          entriesCount: data.entries?.length || 0,
          holidaysInEntries: data.entries?.filter(e => e.isHoliday).map(e => ({ date: e.date, isHoliday: e.isHoliday, hours: e.hours })),
          totalHours: data.entries?.reduce((sum: number, e: any) => sum + e.hours, 0).toFixed(1),
        });
        if (data.entries) setEntries(data.entries);
        if (data.generatedMonths) setGeneratedMonths(data.generatedMonths);
      }
    } catch {
      // Failed to fetch entries
    }
  }, [authFetch, selectedMonth, selectedRegion]);

  const fetchConnectionTeam = useCallback(async () => {
    try {
      // Connection team is global - fetch all entries without month filter
      const res = await authFetch("/api/connection-team");
      if (res.ok) {
        const data = await res.json();
        setConnectionTeam(data.entries || []);
      }
    } catch {
      // ignore
    }
  }, [authFetch]);

  const fetchRegionRotations = useCallback(async () => {
    try {
      const res = await authFetch(`/api/region-rotation?month=${selectedMonth}`);
      if (res.ok) {
        const data = await res.json();
        setRegionRotations(data.entries || []);
      }
    } catch {
      // ignore
    }
  }, [authFetch, selectedMonth]);

  // Check auth on mount
  useEffect(() => {
    const check = async () => {
      const savedToken = localStorage.getItem("auth_token");
      const savedUser = localStorage.getItem("auth_user");
      if (savedToken) {
        try {
          const res = await fetch("/api/auth/check", { headers: { Authorization: `Bearer ${savedToken}` } });
          const data = await res.json();
          if (data.authenticated && data.user) {
            setAuthToken(savedToken);
            setUser(data.user);
            setIsAuthenticated(true);
            // Auto-select region for non-admin users
            if (data.user.region && ["cairo", "delta", "upper_egypt"].includes(data.user.region)) {
              setSelectedRegion(data.user.region);
            }
          } else {
            localStorage.removeItem("auth_token");
            localStorage.removeItem("auth_user");
          }
        } catch { /* auth check failed */ }
      }
      setAuthChecking(false);
    };
    check();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchAllData();
    }
  }, [isAuthenticated, fetchAllData]);

  const fetchConnAssignments = useCallback(async () => {
    try {
      // Build week options inline
      const [y, m] = selectedMonth.split("-");
      const year = Number(y);
      const month = Number(m);
      const firstDay = new Date(year, month - 1, 1);
      const lastDay = new Date(year, month, 0);
      let d = new Date(firstDay);
      while (d.getDay() !== 5) d.setDate(d.getDate() - 1);
      const weeks: { weekStart: string }[] = [];
      while (d <= lastDay) {
        const ws = new Date(d);
        ws.setDate(ws.getDate());
        const wsStr = `${ws.getFullYear()}-${String(ws.getMonth() + 1).padStart(2, "0")}-${String(ws.getDate()).padStart(2, "0")}`;
        weeks.push({ weekStart: wsStr });
        d.setDate(d.getDate() + 7);
      }
      const weekParam = weeks.length > 0 ? `&week=${weeks[0].weekStart}` : "";
      const res = await authFetch(`/api/connection-assignments?month=${selectedMonth}${weekParam}`);
      if (res.ok) {
        const data = await res.json();
        setConnAssignments(data.entries || []);
        setConnAssignmentTotals(data.totals || []);
      }
    } catch {
      // ignore
    }
  }, [authFetch, selectedMonth]);

  useEffect(() => {
    if (isAuthenticated && !dataLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchScheduleEntries();
      fetchBalance();
      fetchConnectionTeam();
      fetchRegionRotations();
      fetchConnAssignments();
    }
  }, [isAuthenticated, dataLoading, selectedMonth, fetchScheduleEntries, fetchBalance, fetchConnectionTeam, fetchRegionRotations, fetchConnAssignments]);

  // ===== Auth Actions =====
  const handleLogin = async () => {
    setLoginError("");
    setLoginLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUsername, password: loginPassword }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const userData = { id: data.id, username: data.username, role: data.role, email: data.email, region: data.region || "cairo" };
        localStorage.setItem("auth_token", data.token);
        localStorage.setItem("auth_user", JSON.stringify(userData));
        setAuthToken(data.token);
        setUser(userData);
        setIsAuthenticated(true);
        if (data.region && ["cairo", "delta", "upper_egypt"].includes(data.region)) {
          setSelectedRegion(data.region);
        }
        setLoginUsername("");
        setLoginPassword("");
        toast({ title: "Welcome back!", description: `Signed in as ${data.username}` });
      } else {
        setLoginError(data.error || "Invalid credentials");
      }
    } catch {
      setLoginError("Connection error. Please try again.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      if (authToken) await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${authToken}` } });
    } catch { /* ignore */ }
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    setAuthToken(null);
    setUser(null);
    setIsAuthenticated(false);
    setEntries([]);
    setEmployees([]);
    setSettings(null);
    setBalance(null);
    setGeneratedMonths([]);
    setConnectionTeam([]);
    setRegionRotations([]);
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: "Error", description: "All fields are required", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "New passwords do not match", variant: "destructive" });
      return;
    }
    setChangePasswordLoading(true);
    try {
      const res = await authFetch("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Success", description: "Password changed successfully" });
        setShowChangePassword(false);
        setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      } else {
        toast({ title: "Error", description: data.error || "Failed to change password", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to change password", variant: "destructive" });
    } finally {
      setChangePasswordLoading(false);
    }
  };

  // ===== Schedule Actions =====
  const generateMonth = async () => {
    setGenerating(true);
    try {
      const [y, m] = selectedMonth.split("-");
      const res = await authFetch("/api/schedule", {
        method: "POST",
        body: JSON.stringify({ mode: "month", year: Number(y), month: Number(m), region: selectedRegion }),
      });
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Success", description: `Generated ${data.generated} shift entries for ${MONTHS[Number(m) - 1]} ${y}${selectedRegion !== "all" ? ` (${REGIONS[selectedRegion] || selectedRegion})` : ""}` });
        addActivity(`Generated schedule for ${MONTHS[Number(m) - 1]} ${y}`);
        await fetchAllData();
      } else {
        toast({ title: "Error", description: data.error || "Generation failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to generate schedule", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const generateWeek = async () => {
    const now = new Date();
    const fri = new Date(now);
    while (fri.getDay() !== 5) fri.setDate(fri.getDate() - 1);
    const y = fri.getFullYear();
    const m = String(fri.getMonth() + 1).padStart(2, "0");
    const d = String(fri.getDate()).padStart(2, "0");
    const weekStart = `${y}-${m}-${d}`;
    setGenerating(true);
    try {
      const res = await authFetch("/api/schedule", { method: "POST", body: JSON.stringify({ mode: "week", weekStart, region: selectedRegion }) });
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Success", description: `Generated ${data.generated} entries for this week` });
        await fetchAllData();
      } else {
        toast({ title: "Error", description: data.error || "Generation failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to generate week", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const clearSchedule = async () => {
    if (!canAdmin) return;
    setGenerating(true);
    try {
      const res = await authFetch(`/api/schedule?month=${selectedMonth}&region=${selectedRegion}`, { method: "DELETE" });
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      if (res.ok) {
        setEntries(entries.filter((e) => !e.date.startsWith(selectedMonth)));
        toast({ title: "Success", description: `Cleared ${data.deleted} entries for ${selectedMonth}` });
        await fetchScheduleEntries();
        await fetchBalance();
      } else {
        toast({ title: "Error", description: data.error || "Failed to clear", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to clear schedule", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const toggleHoliday = async (date: string, current: boolean) => {
    if (!canEdit || !settings) return;
    const newHoliday = !current;

    // When adding a holiday, add default hours deduction based on weekday
    let newHolidayHours = { ...(settings.holidayHours || {}) };
    if (newHoliday) {
      if (!newHolidayHours[date]) {
        const defaultHours = getDefaultHolidayHours(date, settings);
        newHolidayHours[date] = defaultHours;
        console.log("[toggleHoliday] Added holiday with default hours:", { date, defaultHours });
      }
    } else {
      delete newHolidayHours[date];
      console.log("[toggleHoliday] Removed holiday:", { date });
    }

    const newHolidays = newHoliday ? [...new Set([...settings.holidays, date])].sort() : settings.holidays.filter((h) => h !== date);
    const newSettings = { ...settings, holidays: newHolidays, holidayHours: newHolidayHours };

    console.log("[toggleHoliday] Sending to API:", { holidays: newHolidays, holidayHours: newHolidayHours });

    try {
      await authFetch("/api/settings", { method: "POST", body: JSON.stringify(newSettings) });

      // CRITICAL: Re-fetch settings from server to ensure client state matches DB exactly
      // The server recalculates schedule entries on settings save, so we need fresh data
      const settRes = await authFetch("/api/settings");
      if (settRes.ok) {
        const freshSettings = await settRes.json();
        setSettings({
          ...freshSettings,
          dayHours: freshSettings.dayHours || {},
          holidayHours: freshSettings.holidayHours || {},
        });
        console.log("[toggleHoliday] Re-fetched settings from server:", { holidays: freshSettings.holidays, holidayHours: freshSettings.holidayHours });
      } else {
        setSettings(newSettings);
      }

      // IMPORTANT: Fetch entries from DB to see updated isHoliday and hours
      console.log("[toggleHoliday] Fetching updated entries...");
      await fetchScheduleEntries();
      console.log("[toggleHoliday] Fetching connection team...");
      await fetchConnectionTeam();
      // Also refresh connection assignments and balance
      await fetchConnAssignments();
      await fetchBalance();

      toast({ title: "Updated", description: `${date} ${newHoliday ? "marked as holiday" : "unmarked as holiday"}` });
    } catch {
      toast({ title: "Error", description: "Failed to update holiday", variant: "destructive" });
    }
  };

  const deleteEntry = async (date: string) => {
    if (!canEdit) return;
    try {
      const res = await authFetch(`/api/schedule/${date}?region=${selectedRegion}`, { method: "DELETE" });
      if (res.ok) {
        setEntries(entries.filter((e) => e.date !== date));
        toast({ title: "Deleted", description: `Entry for ${date} removed` });
      }
    } catch {
      toast({ title: "Error", description: "Failed to delete entry", variant: "destructive" });
    }
  };

  // Inline hours editing: update a single entry's hours via dayHours override
  const updateEntryHours = async (date: string, newHours: number) => {
    if (!canEdit || !settings) return;
    const newDayHours = { ...settings.dayHours, [date]: newHours };
    const newSettings = { ...settings, dayHours: newDayHours };
    try {
      const res = await authFetch("/api/settings", { method: "POST", body: JSON.stringify(newSettings) });
      if (res.ok) {
        setSettings(newSettings);
        setEntries(entries.map((e) => e.date === date ? { ...e, hours: newHours } : e));
        setEditingHoursDate(null);
        setEditingHoursValue("");
        toast({ title: "Updated", description: `Hours for ${formatDateDisplay(date)} set to ${newHours}h` });
      } else {
        toast({ title: "Error", description: "Failed to update hours", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to update hours", variant: "destructive" });
    }
  };

  const swapEmployees = async (empIdxA: number, empIdxB: number) => {
    if (!canEdit) return;
    const activeEmps = employees.filter((e) => e.active);
    const empA = activeEmps[empIdxA];
    const empB = activeEmps[empIdxB];
    if (!empA || !empB) return;
    try {
      const res = await authFetch("/api/schedule/swap", {
        method: "POST",
        body: JSON.stringify({ empIdxA, empIdxB, monthKey: selectedMonth, region: selectedRegion }),
      });
      if (res.ok) {
        const data = await res.json();
        setSwapMode(false);
        setSwapFirst(null);
        toast({ title: "Swapped", description: `Swapped ${data.swapped} entries between ${empA.name} and ${empB.name}` });
        addActivity(`Swapped shifts: ${empA.name} ↔ ${empB.name}`);
        await fetchAllData();
      } else {
        toast({ title: "Error", description: "Failed to swap", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to swap employees", variant: "destructive" });
    }
  };

  const addManualShift = async () => {
    if (!addShiftDate || !addShiftEmp) {
      toast({ title: "Error", description: "Date and employee are required", variant: "destructive" });
      return;
    }
    const emp = employees.find((e) => e.id === Number(addShiftEmp));
    if (!emp) return;
    const dayDate = new Date(addShiftDate + "T00:00:00");
    const jsDay = dayDate.getDay();
    let dayType = "Weekday";
    if (jsDay === 6) dayType = "Saturday";
    else if (jsDay === 5) dayType = "Friday";
    else if (jsDay === 4) dayType = "Thursday";
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const shift = settings?.shifts?.[dayType] || settings?.shifts?.["Weekday"] || { start: "05:00 PM", end: "10:00 PM", hours: 5 };
    const activeEmps = employees.filter((e) => e.active);
    const empIdx = activeEmps.findIndex((e) => e.id === emp.id);
    const monthEntries = entries.filter((e) => e.date.startsWith(addShiftDate.substring(0, 7)));
    const existingWeekNums = new Set(monthEntries.map((e) => e.weekNum));
    const weekNum = existingWeekNums.size > 0 ? Math.max(...existingWeekNums) + 1 : 0;
    try {
      const res = await authFetch("/api/schedule/add-shift", {
        method: "POST",
        body: JSON.stringify({ date: addShiftDate, empIdx, empName: emp.name, empHrid: emp.hrid, dayName: dayNames[jsDay], dayType, start: shift.start, end: shift.end, hours: shift.hours, weekNum, region: selectedRegion }),
      });
      if (res.ok) {
        setShowAddShift(false);
        setAddShiftDate("");
        setAddShiftEmp("");
        toast({ title: "Added", description: "Manual shift added" });
        await fetchAllData();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to add shift", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to add manual shift", variant: "destructive" });
    }
  };

  // ===== Employee Actions =====
  const addEmployee = async () => {
    if (!newEmpName || !newEmpHrid) {
      toast({ title: "Error", description: "Name and HRID are required", variant: "destructive" });
      return;
    }
    try {
      const res = await authFetch("/api/employees", { method: "POST", body: JSON.stringify({ name: newEmpName, hrid: newEmpHrid, active: true, region: newEmpTeamType === "connection" ? "all" : newEmpRegion, teamType: newEmpTeamType }) });
      if (res.ok) {
        const data = await res.json();
        setEmployees([...employees, data.employee]);
        setNewEmpName(""); setNewEmpHrid(""); setNewEmpRegion("cairo"); setNewEmpTeamType("helpdesk");
        toast({ title: "Added", description: `${newEmpName} added` });
      }
    } catch {
      toast({ title: "Error", description: "Failed to add employee", variant: "destructive" });
    }
  };

  const editEmployee = async (id: number, name: string, hrid: string) => {
    if (!name || !hrid) return;
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    const isConnection = emp.teamType === "connection";
    try {
      const res = await authFetch("/api/employees", { method: "PUT", body: JSON.stringify({ id, name, hrid, region: isConnection ? "all" : editEmpRegion, teamType: editEmpTeamType }) });
      if (res.ok) {
        setEmployees(employees.map((e) => e.id === id ? { ...e, name: name.trim(), hrid: hrid.trim(), region: isConnection ? "all" : editEmpRegion, teamType: editEmpTeamType } : e));
        setEditingEmpId(null);
        setEditEmpName("");
        setEditEmpHrid("");
        setEditEmpRegion("cairo");
        setEditEmpTeamType("");
        toast({ title: "Updated", description: `${name} updated` });
      }
    } catch {
      toast({ title: "Error", description: "Failed to update employee", variant: "destructive" });
    }
  };

  const deleteEmployee = async (id: number, name: string) => {
    if (!canAdmin) return;
    try {
      const res = await authFetch("/api/employees", { method: "DELETE", body: JSON.stringify({ id }) });
      if (res.ok) {
        setEmployees(employees.filter((e) => e.id !== id));
        toast({ title: "Removed", description: `${name} removed` });
      }
    } catch {
      toast({ title: "Error", description: "Failed to delete employee", variant: "destructive" });
    }
  };

  const toggleEmployeeActive = async (id: number, active: boolean) => {
    try {
      const res = await authFetch("/api/employees", { method: "PUT", body: JSON.stringify({ id, active: !active }) });
      if (res.ok) {
        setEmployees(employees.map((e) => e.id === id ? { ...e, active: !active } : e));
        toast({ title: "Updated", description: `Employee ${!active ? "activated" : "deactivated"}` });
      }
    } catch {
      toast({ title: "Error", description: "Failed to toggle employee", variant: "destructive" });
    }
  };

  // ===== Settings Actions =====
  const saveSettings = async () => {
    if (!editSettings) return;
    setSavingSettings(true);
    try {
      const res = await authFetch("/api/settings", { method: "POST", body: JSON.stringify(editSettings) });
      if (res.ok) {
        setSettings(editSettings);
        setShowSettings(false);
        toast({ title: "Saved", description: "Settings updated and schedule recalculated" });
        await fetchScheduleEntries();
        await fetchBalance();
        await fetchConnectionTeam();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to save settings", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
    } finally {
      setSavingSettings(false);
    }
  };

  // ===== Export Connection Team =====
  const exportConnectionExcel = async () => {
    setExporting(true);
    try {
      const res = await authFetch("/api/export/connection-team", {
        method: "POST",
        body: JSON.stringify({
          monthKey: (!exportHridMonthFrom && !exportHridMonthTo) ? selectedMonth : undefined,
          monthFrom: exportHridMonthFrom || undefined,
          monthTo: exportHridMonthTo || undefined,
        }),
      });
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Export failed", variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Connection_Team_Schedule_${selectedMonth}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Exporting", description: "Connection Team Excel file downloaded" });
    } catch {
      toast({ title: "Error", description: "Failed to export Connection Team", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  // ===== Export Both Teams =====
  const exportBothExcel = async () => {
    if (exportRegions.length === 0) { toast({ title: "No region selected", description: "Please check at least one region to export", variant: "destructive" }); return; }
    setExporting(true);
    try {
      const res = await authFetch("/api/export/both", {
        method: "POST",
        body: JSON.stringify({
          month: selectedMonth,
          selectedEmployeeIds: exportSelectedIds.length > 0 ? exportSelectedIds : undefined,
          dateFrom: exportDateFrom || undefined,
          dateTo: exportDateTo || undefined,
          regions: exportRegions.length > 0 ? exportRegions : [selectedRegion],
        }),
      });
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Export failed", variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Full_Schedule_${selectedMonth}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Exporting", description: "Full Excel file with both teams downloaded" });
    } catch {
      toast({ title: "Error", description: "Failed to export", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  // ===== Export Helpdesk =====
  const exportHelpdeskExcel = async () => {
    if (exportRegions.length === 0) { toast({ title: "No region selected", description: "Please check at least one region to export", variant: "destructive" }); return; }
    setExporting(true);
    try {
      const res = await authFetch("/api/export/helpdesk", {
        method: "POST",
        body: JSON.stringify({ month: selectedMonth, selectedEmployeeIds: exportSelectedIds.length > 0 ? exportSelectedIds : undefined, dateFrom: exportDateFrom || undefined, dateTo: exportDateTo || undefined, regions: exportRegions.length > 0 ? exportRegions : [selectedRegion] }),
      });
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Export failed", variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Helpdesk_Schedule_${selectedMonth}_${selectedRegion.toUpperCase()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Exporting", description: "Helpdesk Excel file downloaded" });
    } catch {
      toast({ title: "Error", description: "Failed to export Helpdesk", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  // ===== Export Matrix View =====
  const exportMatrixExcel = async () => {
    if (exportRegions.length === 0) { toast({ title: "No region selected", description: "Please check at least one region to export", variant: "destructive" }); return; }
    setExporting(true);
    try {
      const res = await authFetch("/api/export-matrix", {
        method: "POST",
        body: JSON.stringify({ month: selectedMonth, regions: exportRegions.length > 0 ? exportRegions : [selectedRegion] }),
      });
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Export failed", variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Shift_Matrix_${selectedMonth}_${(exportRegions.length > 0 ? exportRegions.join("_") : selectedRegion).toUpperCase()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Exporting", description: "Matrix View Excel file downloaded" });
    } catch {
      toast({ title: "Error", description: "Failed to export Matrix View", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  // ===== Export by HRID =====
  const exportHridExcel = async () => {
    if (!exportHrid) {
      toast({ title: "Error", description: "Please select an employee HRID", variant: "destructive" });
      return;
    }
    setExporting(true);
    try {
      const emp = employees.find(e => e.hrid === exportHrid);
      if (!emp) {
        toast({ title: "Error", description: "Employee not found", variant: "destructive" });
        return;
      }
      const res = await authFetch("/api/export/hrid", {
        method: "POST",
        body: JSON.stringify({ 
          hrid: exportHrid,
          monthFrom: exportHridMonthFrom || undefined,
          monthTo: exportHridMonthTo || undefined,
        }),
      });
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Export failed", variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${emp.name}_${exportHrid}_Schedule.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Exporting", description: `Excel file downloaded for ${emp.name}` });
    } catch {
      toast({ title: "Error", description: "Failed to export employee", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  // ===== User Management =====
  const fetchUsers = async () => {
    if (!canAdmin) return;
    try {
      const res = await authFetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch { /* ignore */ }
  };

  const openUserMgmt = () => {
    setShowUserMgmt(true);
    fetchUsers();
  };

  const addUser = async () => {
    if (!newUsername || !newUserPassword) {
      toast({ title: "Error", description: "Username and password are required", variant: "destructive" });
      return;
    }
    try {
      const res = await authFetch("/api/users", { method: "POST", body: JSON.stringify({ username: newUsername, password: newUserPassword, email: newUserEmail, role: newUserRole, region: newUserRegion }) });
      if (res.ok) {
        toast({ title: "Success", description: `User ${newUsername} created` });
        setNewUsername(""); setNewUserPassword(""); setNewUserEmail(""); setNewUserRole("viewer"); setNewUserRegion("all");
        setShowAddUser(false);
        fetchUsers();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to create user", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to create user", variant: "destructive" });
    }
  };

  const saveUserEdit = async () => {
    if (!editingUser) return;
    try {
      const res = await authFetch(`/api/users/${editingUser.id}`, { method: "PUT", body: JSON.stringify({ email: editUserEmail, role: editUserRole, region: editUserRegion }) });
      if (res.ok) {
        toast({ title: "Success", description: "User updated" });
        setEditingUser(null);
        fetchUsers();
      }
    } catch {
      toast({ title: "Error", description: "Failed to update user", variant: "destructive" });
    }
  };

  const resetUserPassword = async () => {
    if (!resetPwUserId || !resetPwNewPassword) return;
    try {
      const res = await authFetch("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ userId: resetPwUserId, newPassword: resetPwNewPassword }) });
      if (res.ok) {
        toast({ title: "Success", description: "Password reset" });
        setShowResetPw(false);
        setResetPwUserId("");
        setResetPwNewPassword("");
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to reset password", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to reset password", variant: "destructive" });
    }
  };

  const removeUser = async (u: UserMgmt) => {
    try {
      const res = await authFetch(`/api/users/${u.id}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Deleted", description: `User ${u.username} deleted` });
        setDeletingUser(null);
        fetchUsers();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to delete user", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to delete user", variant: "destructive" });
    }
  };

  // ===== Regenerate Single Week =====
  const regenerateWeek = async (weekKey: string) => {
    if (!canEdit) return;
    setGenerating(true);
    try {
      const res = await authFetch("/api/schedule", {
        method: "POST",
        body: JSON.stringify({ mode: "week", weekStart: weekKey, region: selectedRegion }),
      });
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Week Regenerated", description: `Regenerated ${data.generated} entries for week starting ${weekKey}` });
        await fetchScheduleEntries();
        await fetchBalance();
      } else {
        toast({ title: "Error", description: data.error || "Failed to regenerate week", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to regenerate week", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  // ===== Connection Team Actions =====
  const addConnectionPerson = async () => {
    if (!connEmpIdx) {
      toast({ title: "Error", description: "Please select an employee", variant: "destructive" });
      return;
    }
    if (!connWeekStart || !connWeekEnd) {
      toast({ title: "Error", description: "Please select week start and end dates", variant: "destructive" });
      return;
    }
    try {
      // Use only connection team employees (teamType = "connection" or "both" or empty)
      const activeEmps = connectionTeamEmps;
      const emp = activeEmps[Number(connEmpIdx)];
      if (!emp) return;

      const weekStart = connWeekStart;
      const weekEnd = connWeekEnd;

      // Calculate monthKey from the selected weekStart date (YYYY-MM format)
      const [year, month] = weekStart.split("-");
      const monthKey = `${year}-${month}`;

      const res = await authFetch("/api/connection-team", {
        method: "POST",
        body: JSON.stringify({ weekStart, weekEnd, empIdx: Number(connEmpIdx), empName: emp.name, empHrid: emp.hrid, monthKey, region: "all" }),
      });
      if (res.ok) {
        toast({ title: "Added", description: `Connection Team member assigned for ${formatDateDisplay(weekStart)} to ${formatDateDisplay(weekEnd)}` });
        setShowAddConnection(false);
        setConnWeekStart("");
        setConnWeekEnd("");
        setConnEmpIdx("");
        fetchConnectionTeam();
      } else {
        toast({ title: "Error", description: "Failed to assign Connection Team member", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to assign Connection Team member", variant: "destructive" });
    }
  };

  const deleteConnectionEntry = async (id: number) => {
    try {
      const res = await authFetch(`/api/connection-team?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Deleted", description: "Connection Team entry removed" });
        fetchConnectionTeam();
      }
    } catch {
      toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
    }
  };

  // ===== Connection Team Auto Generation =====
  const generateConnectionMonth = async () => {
    if (!settings) return;
    const [y, m] = selectedMonth.split("-");
    const year = Number(y);
    const month = Number(m);

    // Build weeks for the selected month
    const weeks: { weekStart: string; weekEnd: string }[] = [];
    let d = new Date(year, month - 1, 1);
    // Find first Friday
    while (d.getDay() !== 5) d.setDate(d.getDate() - 1);
    // Get all weeks in month
    const lastDay = new Date(year, month, 0);
    while (d <= lastDay) {
      const weekEnd = new Date(d);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weeks.push({
        weekStart: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        weekEnd: `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, "0")}-${String(weekEnd.getDate()).padStart(2, "0")}`,
      });
      d.setDate(d.getDate() + 7);
    }

    if (weeks.length === 0) {
      toast({ title: "Error", description: "No weeks found for this month", variant: "destructive" });
      return;
    }

    setGenerating(true);
    try {
      const res = await authFetch("/api/connection-team/generate", {
        method: "POST",
        body: JSON.stringify({ monthKey: selectedMonth, weeks }),
      });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Success", description: `Generated ${data.generated || 0} Connection Team assignments for ${MONTHS[month - 1]} ${year}` });
        addActivity(`Generated Connection Team for ${MONTHS[month - 1]} ${year}`);
        await fetchConnectionTeam();
        await fetchConnAssignments();
      } else {
        const errorData = await res.json();
        toast({ title: "Error", description: errorData.error || "Generation failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to generate Connection Team schedule", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  // ===== Connection Team Clear with Save/Restore =====
  const clearConnectionTeam = async () => {
    setGenerating(true);
    try {
      // Save current configuration as template (only selected month)
      const currentConfig = connectionTeam
        .filter(ct => ct.monthKey === selectedMonth)
        .map(ct => ({
          empName: ct.empName,
          empHrid: ct.empHrid,
          weekStart: ct.weekStart,
          weekEnd: ct.weekEnd,
        }));

      // Save to localStorage as backup
      localStorage.setItem(`connection_team_backup_${selectedMonth}`, JSON.stringify({
        monthKey: selectedMonth,
        savedAt: new Date().toISOString(),
        config: currentConfig,
      }));

      toast({ title: "Template Saved", description: `Current Connection Team configuration saved for ${selectedMonth}.` });

      // Clear only the selected month's entries
      const res = await authFetch(`/api/connection-team?monthKey=${selectedMonth}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Cleared", description: `Removed ${data.deleted || 0} Connection Team entries for ${selectedMonth}.` });
        await fetchConnectionTeam();
        await fetchConnAssignments();
      } else {
        const errorData = await res.json();
        toast({ title: "Error", description: errorData.error || "Failed to clear", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to clear Connection Team", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  // ===== Connection Team Replace / Transfer =====
  const replaceConnectionPerson = async () => {
    if (!connReplaceTo || !connWeekStart) {
      toast({ title: "Error", description: "Please select a week and target employee", variant: "destructive" });
      return;
    }
    const existingEntry = connectionTeam.find(ct => ct.weekStart === connWeekStart);
    if (!existingEntry) return;

    try {
      // Delete existing entry for this week
      await authFetch(`/api/connection-team?id=${existingEntry.id}`, { method: "DELETE" });

      // Create new entry with target employee (connection team employees only)
      const activeEmps = connectionTeamEmps;
      const empIdx = activeEmps.findIndex(e => e.name === connReplaceTo);
      if (empIdx < 0) return;
      const targetEmp = activeEmps[empIdx];

      const res = await authFetch("/api/connection-team", {
        method: "POST",
        body: JSON.stringify({
          weekStart: existingEntry.weekStart,
          weekEnd: existingEntry.weekEnd,
          empIdx,
          empName: targetEmp.name,
          empHrid: targetEmp.hrid,
          monthKey: existingEntry.monthKey,
          region: "all",
        }),
      });

      if (res.ok) {
        toast({ title: "Replaced", description: `Connection Team member replaced for week ${formatDateDisplay(existingEntry.weekStart)} → ${formatDateDisplay(existingEntry.weekEnd)}` });
        setShowConnReplace(false);
        setConnReplaceFrom("");
        setConnReplaceTo("");
        setConnReplaceHours("");
        setConnWeekStart("");
        fetchConnectionTeam();
      } else {
        toast({ title: "Error", description: "Failed to replace Connection Team member", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to replace Connection Team member", variant: "destructive" });
    }
  };

  // ===== Connection Assignments Actions =====
  const addAssignment = async () => {
    if (!assignEmpId || !assignRegionCovered) {
      toast({ title: "Error", description: "Employee and region are required", variant: "destructive" });
      return;
    }
    try {
      const weeks = buildWeekOptions();
      if (assignWeekIdx >= weeks.length) {
        toast({ title: "Error", description: "Invalid week", variant: "destructive" });
        return;
      }
      const week = weeks[assignWeekIdx];

      if (assignSplit === "full") {
        // Single assignment for the whole week
        const ws = new Date(week.weekStart + "T00:00:00");
        const we = new Date(week.weekEnd + "T00:00:00");
        const daysInWeek: string[] = [];
        for (let d = new Date(ws); d <= we; d.setDate(d.getDate() + 1)) {
          daysInWeek.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
        }

        const entries = daysInWeek.map(date => ({
          employeeId: Number(assignEmpId),
          date,
          weekStart: week.weekStart,
          regionCovered: assignRegionCovered,
          hours: Number(assignHours) || 0,
          overrideHours: Number(assignOverrideHours) || 0,
        }));

        for (const entry of entries) {
          await authFetch("/api/connection-assignments", { method: "POST", body: JSON.stringify(entry) });
        }
        toast({ title: "Assigned", description: `Full week assigned: ${formatDateDisplay(week.weekStart)} → ${formatDateDisplay(week.weekEnd)}` });
      } else {
        // Split week: first 3 days or last 4 days
        const ws = new Date(week.weekStart + "T00:00:00");
        const splitDays = assignSplit === "first_half"
          ? [0, 1, 2]   // Fri, Sat, Sun
          : [3, 4, 5, 6]; // Mon, Tue, Wed, Thu

        const entries = splitDays.map(offset => {
          const d = new Date(ws);
          d.setDate(d.getDate() + offset);
          const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          return {
            employeeId: Number(assignEmpId),
            date,
            weekStart: week.weekStart,
            regionCovered: assignRegionCovered,
            hours: Number(assignHours) || 0,
            overrideHours: Number(assignOverrideHours) || 0,
          };
        });

        for (const entry of entries) {
          await authFetch("/api/connection-assignments", { method: "POST", body: JSON.stringify(entry) });
        }
        const label = assignSplit === "first_half" ? "First Half (Fri-Sun)" : "Second Half (Mon-Thu)";
        toast({ title: "Assigned", description: `${label} assigned for week ${formatDateDisplay(week.weekStart)}` });
      }

      setShowAddAssignment(false);
      setAssignEmpId("");
      setAssignRegionCovered("");
      setAssignWeekIdx(0);
      setAssignSplit("full");
      setAssignHours("");
      setAssignOverrideHours("");
      fetchConnAssignments();
    } catch {
      toast({ title: "Error", description: "Failed to create assignment", variant: "destructive" });
    }
  };

  const deleteAssignment = async (id: number) => {
    try {
      await authFetch(`/api/connection-assignments?id=${id}`, { method: "DELETE" });
      toast({ title: "Deleted", description: "Assignment removed" });
      fetchConnAssignments();
    } catch {
      toast({ title: "Error", description: "Failed to delete assignment", variant: "destructive" });
    }
  };

  // ===== Region Rotation Actions =====
  const addRotation = async () => {
    if (!rotTargetArea) {
      toast({ title: "Error", description: "Target area is required", variant: "destructive" });
      return;
    }
    try {
      const [y, m] = selectedMonth.split("-");
      const year = Number(y);
      const month = Number(m);
      const firstDay = new Date(year, month - 1, 1);
      const lastDay = new Date(year, month, 0);
      let d = new Date(firstDay);
      while (d.getDay() !== 5) d.setDate(d.getDate() - 1);
      const weeks: { weekStart: string; weekEnd: string }[] = [];
      while (d <= lastDay) {
        const ws = new Date(d);
        const we = new Date(d);
        we.setDate(we.getDate() + 6);
        const wsStr = `${ws.getFullYear()}-${String(ws.getMonth() + 1).padStart(2, "0")}-${String(ws.getDate()).padStart(2, "0")}`;
        const weStr = `${we.getFullYear()}-${String(we.getMonth() + 1).padStart(2, "0")}-${String(we.getDate()).padStart(2, "0")}`;
        if (weeks.length <= rotWeekIdx) weeks.push({ weekStart: wsStr, weekEnd: weStr });
        d.setDate(d.getDate() + 7);
      }
      if (rotWeekIdx >= weeks.length) {
        toast({ title: "Error", description: "Invalid week selected", variant: "destructive" });
        return;
      }
      const { weekStart, weekEnd } = weeks[rotWeekIdx];

      const res = await authFetch("/api/region-rotation", {
        method: "POST",
        body: JSON.stringify({ region: rotRegion, targetArea: rotTargetArea, weekStart, weekEnd, monthKey: selectedMonth, notes: rotNotes }),
      });
      if (res.ok) {
        toast({ title: "Added", description: "Region rotation entry added" });
        setShowAddRotation(false);
        setRotTargetArea("");
        setRotWeekIdx(0);
        setRotNotes("");
        fetchRegionRotations();
      } else {
        toast({ title: "Error", description: "Failed to add rotation", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to add rotation", variant: "destructive" });
    }
  };

  const deleteRotationEntry = async (id: number) => {
    try {
      const res = await authFetch(`/api/region-rotation?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Deleted", description: "Region rotation entry removed" });
        fetchRegionRotations();
      }
    } catch {
      toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
    }
  };

  // ===== Region-filtered entries — STRICT (use entry.region column directly) =====
  const monthEntries = entries.filter((e) => e.date.startsWith(selectedMonth));
  const filteredEntries = selectedRegion === "all" ? monthEntries : monthEntries.filter((e) => e.region === selectedRegion);
  const regionActiveEmps = employees.filter((e) => e.active && (selectedRegion === "all" || e.region === selectedRegion) && e.teamType === "helpdesk");

  // Connection team employees: must have teamType = "connection"
  const connectionTeamEmps = employees.filter((e) => e.active && e.teamType === "connection");
  // Connection team always shows all entries (region is "all")
  const filteredConnectionTeam = connectionTeam;
  const filteredConnectionAssignments = connAssignments;
  // Use same week key calculation as used in weekMap building
  const connectionEmpSet = new Set(filteredConnectionTeam.map((c) => {
    const weekKey = getWeekNumber(c.weekStart);
    return `${c.empName}-${weekKey}`;
  }));

  // Build connection team lookup by week key (using getWeekNumber for consistency)
  const connectionByWeek = new Map<string, ConnectionTeamEntry>();
  for (const ct of filteredConnectionTeam) {
    const weekKey = getWeekNumber(ct.weekStart);
    connectionByWeek.set(weekKey, ct);
  }

  // Calculate connection team hours for each entry (full week hours)
  const calcConnectionWeekHours = (weekStart: string, weekEnd: string): number => {
    if (!settings) return 0;
    let total = 0;
    const start = new Date(weekStart + "T00:00:00");
    const end = new Date(weekEnd + "T00:00:00");
    console.log("[calcConnectionWeekHours] Calculating for", { weekStart, weekEnd, holidays: settings.holidays, holidayHours: settings.holidayHours });

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      // Check if this is a holiday - holidays = 0 hours (not working)
      const isHol = settings.holidays?.includes(dateStr) || false;
      if (isHol) {
        // HOLIDAYS: 0 hours (not working)
        console.log(`[calcConnectionWeekHours] Holiday ${dateStr}: 0h (not working)`);
        // Skip (0 hours)
        continue;
      }
      // Check dayHours override first
      if (settings.dayHours && settings.dayHours[dateStr] !== undefined) {
        total += settings.dayHours[dateStr];
      } else {
        const jsDay = d.getDay();
        let dayType = "Weekday";
        if (jsDay === 6) dayType = "Saturday";
        else if (jsDay === 5) dayType = "Friday";
        else if (jsDay === 4) dayType = "Thursday";
        if (settings.summerTime && settings.summerShifts?.[dayType]) {
          total += settings.summerShifts[dayType].hours;
        } else {
          total += settings.shifts[dayType]?.hours || settings.shifts["Weekday"]?.hours || 5;
        }
      }
    }
    console.log(`[calcConnectionWeekHours] Total for ${weekStart} - ${weekEnd}: ${total}h`);
    return total;
  };

  const weekMap = new Map<string, ScheduleEntry[]>();
  for (const entry of filteredEntries) {
    const wk = getWeekNumber(entry.date);
    if (!weekMap.has(wk)) weekMap.set(wk, []);
    weekMap.get(wk)!.push(entry);
  }

  const weekGroups: { key: string; entries: ScheduleEntry[]; label: string }[] = [];
  let weekIndex = 0;
  for (const [key, weekEntries] of weekMap) {
    const sorted = weekEntries.sort((a, b) => a.date.localeCompare(b.date));
    const totalHrs = sorted.reduce((s, e) => s + e.hours, 0);
    const offPerson = sorted[0]?.offPerson || "N/A";
    weekGroups.push({
      key,
      entries: sorted,
      label: `Week ${weekIndex + 1}: ${formatDateDisplay(sorted[0].date)} → ${formatDateDisplay(sorted[sorted.length - 1].date)} | ${sorted.length} days | ${totalHrs.toFixed(1)}h | OFF: ${offPerson}`,
    });
    weekIndex++;
  }

  const totalHours = filteredEntries.reduce((s, e) => s + e.hours, 0);
  const totalDays = filteredEntries.filter(e => !e.isHoliday).length; // Work Days = non-holiday days

  // Calculate holiday deduction hours
  const holidayDeductionHours = settings
    ? filteredEntries
        .filter(e => e.isHoliday && settings.holidayHours?.[e.date])
        .reduce((sum, e) => sum + (settings.holidayHours?.[e.date] || 0), 0)
    : 0;

  // Log for debugging
  console.log("[Total Hours Calculation]", {
    selectedMonth,
    selectedRegion,
    totalEntries: entries.length,
    filteredEntries: filteredEntries.length,
    totalHours,
    totalDays, // Non-holiday days
    holidayDeductionHours,
    holidayEntriesInMonth: filteredEntries.filter(e => e.isHoliday).map(e => ({ date: e.date, hours: e.hours })),
  });
  const totalHolidays = filteredEntries.filter((e) => e.isHoliday).length;
  const totalWeeks = weekGroups.length;

  // ===== Connection Team Computed Stats =====
  const connectionMonthEntries = connectionTeam.filter((ct) => ct.monthKey === selectedMonth);
  const connectionTotalHours = connectionMonthEntries.reduce((sum, ct) => sum + calcConnectionWeekHours(ct.weekStart, ct.weekEnd), 0);
  const connectionUniqueMembers = connectionMonthEntries.length > 0
    ? new Set(connectionMonthEntries.map(ct => ct.empName)).size
    : connectionTeamEmps.length;
  const connectionAvgHours = connectionUniqueMembers > 0 ? connectionTotalHours / connectionUniqueMembers : 0;

  const roleColor = user?.role === "super_admin" ? "bg-purple-700" : user?.role === "admin" ? "bg-red-500" : user?.role === "editor" ? "bg-amber-500" : user?.role === "connection" ? "bg-teal-500" : "bg-slate-500";

  // ===== Build week options for dialogs =====
  const buildWeekOptions = () => {
    const [y, m] = selectedMonth.split("-");
    const year = Number(y);
    const month = Number(m);
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    let d = new Date(firstDay);
    while (d.getDay() !== 5) d.setDate(d.getDate() - 1);
    const weeks: { weekStart: string; weekEnd: string }[] = [];
    while (d <= lastDay) {
      const ws = new Date(d);
      const we = new Date(d);
      we.setDate(we.getDate() + 6);
      const wsStr = `${ws.getFullYear()}-${String(ws.getMonth() + 1).padStart(2, "0")}-${String(ws.getDate()).padStart(2, "0")}`;
      const weStr = `${we.getFullYear()}-${String(we.getMonth() + 1).padStart(2, "0")}-${String(we.getDate()).padStart(2, "0")}`;
      weeks.push({ weekStart: wsStr, weekEnd: weStr });
      d.setDate(d.getDate() + 7);
    }
    return weeks;
  };

  // ===== Auth Checking State =====
  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3"><RefreshCw className="h-8 w-8 text-slate-400 animate-spin" /><span className="text-slate-500 text-sm">Loading...</span></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        onLogin={handleLogin}
        loginError={loginError}
        loginLoading={loginLoading}
        setLoginUsername={setLoginUsername}
        setLoginPassword={setLoginPassword}
        showPassword={showPassword}
        setShowPassword={setShowPassword}
        loginUsername={loginUsername}
        loginPassword={loginPassword}
      />
    );
  }

  // ===== Authenticated Render =====
  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
        {/* HEADER */}
        <header className="bg-[#0F172A]/95 backdrop-blur-md text-white sticky top-0 z-50 shadow-lg border-b border-slate-700/50">
          <div className="max-w-7xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                {activeTab === "helpdesk" ? <CalendarDays className="h-6 w-6 text-blue-400" /> : <Link2 className="h-6 w-6 text-teal-400" />}
                <h1 className="text-lg sm:text-xl font-bold tracking-tight">
                  {activeTab === "helpdesk" ? "IT Helpdesk Shift Scheduler" : "Connection Team Weekly Assignments"}
                </h1>

                <div className="hidden md:flex items-center gap-2 ml-2">
                  <Badge variant="outline" className="border-slate-600 text-slate-300 bg-slate-800/50 text-[10px] px-2"><Users className="h-3 w-3 mr-1" />{employees.length} staff</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={selectedMonth} onValueChange={(v) => { const [y, m] = v.split("-"); setSelectedMonth(v); setSelectedYear(Number(y)); }}>
                  <SelectTrigger className="w-[140px] bg-slate-800 border-slate-600 text-white h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => { const m = String(i + 1).padStart(2, "0"); return (<SelectItem key={m} value={`${selectedYear}-${m}`}>{MONTHS[i]} {selectedYear}</SelectItem>); })}
                  </SelectContent>
                </Select>
                <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                  <SelectTrigger className="w-[90px] bg-slate-800 border-slate-600 text-white h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{[2025, 2026, 2027, 2028].map((y) => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}</SelectContent>
                </Select>

                {canEdit && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-slate-300 hover:text-white hover:bg-slate-700" onClick={() => { setEditSettings(settings ? JSON.parse(JSON.stringify(settings)) : undefined); setNewHolidayDate(""); setNewHolidayHours(""); setNewDayHourDate(""); setNewDayHourValue(""); setShowSettings(true); }}><Settings className="h-5 w-5" /></Button>
                    </TooltipTrigger>
                    <TooltipContent>Settings</TooltipContent>
                  </Tooltip>
                )}

                {canEdit && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-slate-300 hover:text-white hover:bg-slate-700" onClick={() => setShowEmployees(true)}><Users className="h-5 w-5" /></Button>
                    </TooltipTrigger>
                    <TooltipContent>Manage Employees</TooltipContent>
                  </Tooltip>
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-slate-300 hover:text-white hover:bg-slate-700" onClick={() => setShowStats(true)}><BarChart3 className="h-5 w-5" /></Button>
                  </TooltipTrigger>
                  <TooltipContent>Statistics & Reports</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-slate-300 hover:text-white hover:bg-slate-700" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</Button>
                  </TooltipTrigger>
                  <TooltipContent>Toggle Theme</TooltipContent>
                </Tooltip>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-slate-300 hover:text-white hover:bg-slate-700"><Shield className="h-5 w-5" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <div className="px-2 py-1.5">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">{user?.username} <span className={`text-[10px] px-1.5 py-0.5 rounded text-white ${roleColor}`}>{user?.role}</span></p>
                      {user?.email && <p className="text-xs text-slate-500 dark:text-slate-400">{user.email}</p>}
                      {user?.region && user.region !== "all" && <p className="text-xs text-slate-500 dark:text-slate-400">{REGIONS[user.region] || user.region}</p>}
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setShowChangePassword(true); }} className="cursor-pointer"><KeyRound className="h-4 w-4 mr-2" /> Change Password</DropdownMenuItem>
                    {canAdmin && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={openUserMgmt} className="cursor-pointer"><UserCog className="h-4 w-4 mr-2" /> User Management</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => window.open("/api/download", "_blank")} className="cursor-pointer"><Download className="h-4 w-4 mr-2" /> Download ZIP</DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-600 focus:text-red-600"><LogOut className="h-4 w-4 mr-2" /> Sign Out</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </header>

        {/* TOOLBAR */}
        <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-2">
            <div className="flex flex-wrap gap-2 items-center">
              {activeTab === "helpdesk" && canEdit && (
                <>
                  <Button onClick={generateMonth} disabled={generating || selectedRegion === "all"} className="bg-blue-600 hover:bg-blue-700 text-white"><Sparkles className="h-4 w-4 mr-1.5" />{generating ? "Generating..." : "Generate Month"}<kbd className="ml-1.5 text-[10px] bg-blue-800/50 px-1.5 py-0.5 rounded border border-blue-500/30 font-mono">G</kbd></Button>
                  <Button onClick={generateWeek} disabled={generating} variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50"><Calendar className="h-4 w-4 mr-1.5" />This Week</Button>
                  <Button onClick={() => { setAddShiftDate(""); setAddShiftEmp(""); setShowAddShift(true); }} variant="outline"><Plus className="h-4 w-4 mr-1.5" />Add Shift</Button>
                  <Button onClick={() => { setSwapMode(!swapMode); setSwapFirst(null); }} variant={swapMode ? "default" : "outline"} className={swapMode ? "bg-purple-600 text-white" : "border-purple-300 text-purple-700"}><ArrowLeftRight className="h-4 w-4 mr-1.5" />{swapMode ? "Cancel Swap" : "Swap Mode"}</Button>
                  <Button onClick={() => { setExportType("helpdesk"); setExportSelectedIds([]); setExportDateFrom(""); setExportDateTo(""); setExportRegions(selectedRegion === "all" ? ["cairo", "delta", "upper_egypt"] : [selectedRegion]); setShowExport(true); }} disabled={filteredEntries.length === 0} variant="outline" className="border-emerald-300 text-emerald-700"><FileSpreadsheet className="h-4 w-4 mr-1.5" />Export Excel<kbd className="ml-1.5 text-[10px] bg-emerald-100 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded border border-emerald-300 dark:border-emerald-700 font-mono text-emerald-600 dark:text-emerald-400">E</kbd></Button>
                </>
              )}
              {activeTab === "helpdesk" && canAdmin && (
                <Button onClick={clearSchedule} disabled={filteredEntries.length === 0 || generating} variant="outline" className="border-red-300 text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4 mr-1.5" />Clear</Button>
              )}
              {activeTab === "helpdesk" && (
              <div className="ml-auto">
                <Select value={selectedRegion} onValueChange={setSelectedRegion} disabled={user?.role !== "admin" && user?.role !== "super_admin" && user?.role !== "editor" && user?.role !== "connection" && user?.region !== "all"}>
                  <SelectTrigger className="w-[180px] h-9 text-xs"><MapPin className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(REGIONS).filter(([key]) => key !== "all").map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              )}
            </div>
          </div>
        </div>

        {/* TAB SWITCHER */}
        <div className="max-w-7xl mx-auto px-4 mt-4">
          <div className="flex gap-1 bg-slate-200 dark:bg-slate-800 p-1 rounded-lg w-fit">
            {user?.role !== "connection" && (
            <Button
              variant={activeTab === "helpdesk" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("helpdesk")}
              className={activeTab === "helpdesk" ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-sm" : "text-slate-600 dark:text-slate-400 transition-all duration-200 hover:shadow-sm"}
            >
              <HeadphonesIcon className="h-4 w-4 mr-2" />Helpdesk Schedule
            </Button>
            )}
            <Button
              variant={activeTab === "connection" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("connection")}
              className={activeTab === "connection" ? "bg-gradient-to-r from-teal-600 to-teal-700 text-white shadow-sm" : "text-slate-600 dark:text-slate-400 transition-all duration-200 hover:shadow-sm"}
            >
              <Link2 className="h-4 w-4 mr-2" />Connection Team
            </Button>
          </div>
        </div>

        {/* STATS ROW - Only show for Helpdesk */}
        {activeTab === "helpdesk" && (
        <div className="max-w-7xl mx-auto w-full px-4 mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 border-blue-200 dark:border-blue-800 shadow-sm hover:shadow-md transition-shadow"><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{totalWeeks}</div><div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">Weeks</div></CardContent></Card>
            <Card className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 border-emerald-200 dark:border-emerald-800 shadow-sm hover:shadow-md transition-shadow"><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{totalDays}</div><div className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">Work Days</div></CardContent></Card>
            <Card className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 border-amber-200 dark:border-amber-800 shadow-sm hover:shadow-md transition-shadow"><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-amber-700 dark:text-amber-300">{totalHolidays}</div><div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Holidays</div></CardContent></Card>
            <Card className="bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-950/40 dark:to-pink-950/40 border-rose-200 dark:border-rose-800 shadow-sm hover:shadow-md transition-shadow"><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-rose-700 dark:text-rose-300">{totalHours.toFixed(1)}h</div><div className="text-xs text-rose-600 dark:text-rose-400 mt-0.5">Total Hours</div></CardContent></Card>
          </div>
        </div>
        )}

        {/* ACTIVITY FEED */}
        {recentActivity.length > 0 && (
        <div className="max-w-7xl mx-auto w-full px-4 mt-4 mb-4">
          <Card className="shadow-sm border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Recent Activity</span>
            </div>
            <div className="p-3 space-y-1.5">
              {recentActivity.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-300">{item.action}</span>
                  <span className="text-slate-400 text-[10px] ml-2 whitespace-nowrap">{item.time}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        )}

        {/* SWAP BANNER - Only show for Helpdesk */}
        {activeTab === "helpdesk" && swapMode && canEdit && (
          <div className="max-w-7xl mx-auto w-full px-4 mt-3">
            <div className="bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-lg p-3 flex items-center gap-3">
              <ArrowLeftRight className="h-5 w-5 text-purple-600 flex-shrink-0" />
              <span className="text-sm text-purple-800 dark:text-purple-200">{swapFirst ? `Selected: ${swapFirst.name}. Click another employee to swap.` : "Click an employee name to start swapping."}</span>
              <Button size="sm" variant="ghost" onClick={() => { setSwapMode(false); setSwapFirst(null); }} className="ml-auto text-purple-600"><X className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        {/* CONNECTION TEAM TOOLBAR BUTTONS - Only show for Connection tab */}
        {activeTab === "connection" && canEdit && (
          <div className="max-w-7xl mx-auto w-full px-4 mt-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" className="border-teal-300 text-teal-700 hover:bg-teal-50 h-8" onClick={() => { setConnWeekStart(""); setConnWeekEnd(""); setConnEmpIdx(""); setShowAddConnection(true); }}><Plus className="h-3.5 w-3.5 mr-1" />Add Connection Member</Button>
              {filteredConnectionTeam.length > 0 && (
                <Button size="sm" variant="outline" className="border-teal-300 text-teal-700 hover:bg-teal-50 h-8" onClick={() => { setConnReplaceFrom(""); setConnReplaceTo(""); setConnReplaceHours(""); setConnWeekStart(""); setShowConnReplace(true); }}><ArrowLeftRight className="h-3.5 w-3.5 mr-1" />Replace Connection Member</Button>
              )}
            </div>
          </div>
        )}

        {/* CONNECTION TAB REGION SELECTOR - Fixed to 'all' for Connection Team */}
        {activeTab === "connection" && (
          <div className="max-w-7xl mx-auto w-full px-4 mt-4">
            <div className="bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-800 rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-violet-600" />
                <span className="font-semibold text-sm text-slate-700 dark:text-slate-200">Region:</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-violet-600 text-white border-violet-600">All Regions</Badge>
                <span className="text-xs text-slate-500 italic">Connection team works across all regions</span>
              </div>
            </div>
          </div>
        )}

        {/* REGION ROTATION SECTION - Only show for Connection tab */}
        {activeTab === "connection" && regionRotations.length > 0 && (
          <div className="max-w-7xl mx-auto w-full px-4 mt-4">
            <Card className="shadow-sm border-orange-200 dark:border-orange-800">
              <div className="bg-gradient-to-r from-orange-600 to-orange-500 text-white px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2"><RotateCcw className="h-4 w-4" /><span className="font-semibold text-sm">Region Rotation</span></div>
                {canAdmin && (
                  <Button size="sm" variant="ghost" className="text-white hover:bg-orange-700 h-7 text-xs" onClick={() => { setRotRegion("cairo"); setRotTargetArea(""); setRotWeekIdx(0); setRotNotes(""); setShowAddRotation(true); }}><Plus className="h-3.5 w-3.5 mr-1" />Add Rotation</Button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <th className="px-3 py-2 text-left text-xs text-slate-500">Region</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-500">Target Area</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-500">Week Period</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-500 hidden sm:table-cell">Notes</th>
                    {canAdmin && <th className="px-3 py-2 text-center text-xs text-slate-500">Actions</th>}
                  </tr></thead>
                  <tbody>
                    {regionRotations.map((rr) => (
                      <tr key={rr.id} className={`border-b border-slate-100 dark:border-slate-800 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/20 transition-colors ${rr.id % 2 === 0 ? "bg-slate-50/50 dark:bg-slate-900/30" : ""}`}>
                        <td className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"><Badge variant="outline" className="text-orange-700 border-orange-300 bg-orange-50 dark:bg-orange-950/20 text-xs">{REGIONS[rr.region] || rr.region}</Badge></td>
                        <td className="px-3 py-2 text-sm text-slate-700 dark:text-slate-200">{rr.targetArea}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{formatDateDisplay(rr.weekStart)} → {formatDateDisplay(rr.weekEnd)}</td>
                        <td className="px-3 py-2 text-xs text-slate-500 hidden sm:table-cell">{rr.notes || "-"}</td>
                        {canAdmin && <td className="px-3 py-2 text-center"><Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => deleteRotationEntry(rr.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* CONNECTION TEAM STATS DASHBOARD - Only show for Connection tab */}
        {activeTab === "connection" && (
          <div className="max-w-7xl mx-auto w-full px-4 mt-4">
            <Card className="shadow-sm bg-gradient-to-br from-teal-50 to-cyan-50 dark:from-teal-950/20 dark:to-cyan-950/20 border-teal-200 dark:border-teal-800">
              <div className="bg-gradient-to-r from-teal-600 to-teal-500 text-white px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /><span className="font-semibold text-sm">Connection Team Statistics</span></div>
              </div>
              <div className="p-4">
                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <Card className="shadow-sm"><CardContent className="p-3 text-center"><div className="text-xl font-bold text-teal-600">{connectionTeamEmps.length}</div><div className="text-xs text-slate-500">Total Members</div></CardContent></Card>
                  <Card className="shadow-sm"><CardContent className="p-3 text-center"><div className="text-xl font-bold text-teal-600">{connectionMonthEntries.length}</div><div className="text-xs text-slate-500">Weeks Assigned</div></CardContent></Card>
                  <Card className="shadow-sm"><CardContent className="p-3 text-center"><div className="text-xl font-bold text-teal-600">{connectionTotalHours.toFixed(0)}h</div><div className="text-xs text-slate-500">Total Hours</div></CardContent></Card>
                  <Card className="shadow-sm"><CardContent className="p-3 text-center"><div className="text-xl font-bold text-teal-600">{connectionAvgHours.toFixed(0)}h</div><div className="text-xs text-slate-500">Avg Hours/Member</div></CardContent></Card>
                </div>

                {/* Employee Distribution Table */}
                {connectionTeamEmps.length > 0 && (
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                      <th className="px-3 py-2 text-left text-xs text-slate-500">#</th>
                      <th className="px-3 py-2 text-left text-xs text-slate-500">Employee</th>
                      <th className="px-3 py-2 text-center text-xs text-slate-500">Weeks Assigned</th>
                      <th className="px-3 py-2 text-center text-xs text-slate-500">Total Hours</th>
                      <th className="px-3 py-2 text-center text-xs text-slate-500">Avg Hours/Week</th>
                    </tr></thead>
                    <tbody>
                      {connectionTeamEmps.map((emp, idx) => {
                        const empTeamEntries = connectionTeam.filter((ct) => ct.empName === emp.name);
                        const totalHrs = empTeamEntries.reduce((sum, ct) => sum + calcConnectionWeekHours(ct.weekStart, ct.weekEnd), 0);
                        const weeksCount = empTeamEntries.length;
                        const avgHrs = weeksCount > 0 ? totalHrs / weeksCount : 0;
                        return (
                          <tr key={emp.id} className={`border-b border-slate-100 dark:border-slate-800 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/20 transition-colors ${idx % 2 === 1 ? "bg-slate-50/50 dark:bg-slate-900/30" : ""}`}>
                            <td className="px-3 py-2 text-slate-400 text-xs">{idx + 1}</td>
                            <td className="px-3 py-2 font-medium text-sm">{emp.name}</td>
                            <td className="px-3 py-2 text-center text-xs">{weeksCount}</td>
                            <td className="px-3 py-2 text-center text-xs"><span className="font-bold text-teal-600">{totalHrs.toFixed(0)}h</span></td>
                            <td className="px-3 py-2 text-center text-xs">{avgHrs.toFixed(1)}h</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          </div>
        )}

        {/* Connection Team Action Buttons */}
        {activeTab === "connection" && canEdit && (
          <div className="max-w-7xl mx-auto w-full px-4 mt-4 flex gap-3 flex-wrap">
            <Button onClick={generateConnectionMonth} disabled={generating} className="bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-2">
              {generating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate Month
            </Button>
            <Button onClick={clearConnectionTeam} disabled={generating} variant="destructive" className="flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Clear Connection Team
            </Button>
            <Button onClick={() => { setExportType("connection"); setExportDateFrom(""); setExportDateTo(""); setShowExport(true); }} variant="outline" className="border-teal-300 text-teal-700 hover:bg-teal-50 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Export Connection Team
            </Button>
          </div>
        )}

        {/* CONNECTION TEAM ROSTER - Only show for Connection tab */}
        {activeTab === "connection" && connectionTeam.length > 0 && (
          <div className="max-w-7xl mx-auto w-full px-4 mt-4">
            <Card className="shadow-sm border-teal-200 dark:border-teal-800">
              <div className="bg-gradient-to-r from-teal-600 to-teal-500 text-white px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2"><Link2 className="h-4 w-4" /><span className="font-semibold text-sm">Connection Team Roster</span></div>
                <span className="text-xs text-teal-100">{connectionTeam.length} members</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <th className="px-3 py-2 text-left text-xs text-slate-500">Employee</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-500">HRID</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-500">Week Start</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-500">Week End</th>
                    <th className="px-3 py-2 text-center text-xs text-slate-500">Total Hours</th>
                    {canEdit && <th className="px-3 py-2 text-center text-xs text-slate-500">Actions</th>}
                  </tr></thead>
                  <tbody>
                    {connectionTeam.map((ct) => (
                      <tr key={ct.id} className={`border-b border-slate-100 dark:border-slate-800 hover:bg-teal-50/50 dark:hover:bg-teal-950/20 transition-colors ${ct.id % 2 === 0 ? "bg-slate-50/50 dark:bg-slate-900/30" : ""}`}>
                        <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{ct.empName}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{ct.empHrid}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{formatDateDisplay(ct.weekStart)}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{formatDateDisplay(ct.weekEnd)}</td>
                        <td className="px-3 py-2 text-center text-xs font-semibold text-teal-600">{calcConnectionWeekHours(ct.weekStart, ct.weekEnd).toFixed(1)}h</td>
                        {canEdit && (
                          <td className="px-3 py-2 text-center">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => deleteConnectionEntry(ct.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* CONNECTION ASSIGNMENTS SECTION - Only show for Connection tab */}
        {activeTab === "connection" && (
        <div className="max-w-7xl mx-auto w-full px-4 mt-4">
          <Card className="shadow-sm border-violet-200 dark:border-violet-800">
            <div className="bg-gradient-to-r from-violet-600 to-violet-500 text-white px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /><span className="font-semibold text-sm">Connection Assignments</span></div>
              {canEdit && (
                <Button size="sm" variant="ghost" className="text-white hover:bg-violet-700 h-7 text-xs" onClick={() => { setAssignEmpId(""); setAssignRegionCovered(""); setAssignWeekIdx(0); setAssignSplit("full"); setAssignHours(""); setAssignOverrideHours(""); setShowAddAssignment(true); }}><Plus className="h-3.5 w-3.5 mr-1" />New Assignment</Button>
              )}
            </div>

            {/* Totals summary */}
            {connAssignmentTotals.length > 0 && (
              <div className="px-4 pt-3 pb-2">
                <div className="flex flex-wrap gap-3">
                  {connAssignmentTotals.map((t) => {
                    const emp = employees.find(e => e.id === t.employeeId);
                    const name = emp?.name || `Emp #${t.employeeId}`;
                    return (
                      <div key={t.employeeId} className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-lg px-3 py-2 min-w-[140px]">
                        <div className="text-xs font-medium text-violet-700 dark:text-violet-300">{name}</div>
                        <div className="flex gap-3 mt-1">
                          {t.weekly && <div className="text-[10px] text-slate-500">Week: <span className="font-semibold text-slate-700 dark:text-slate-200">{t.weekly.totalHours.toFixed(1)}h</span> <span className="text-slate-400">({t.weekly.assignmentCount}d)</span></div>}
                          {t.monthly && <div className="text-[10px] text-slate-500">Month: <span className="font-semibold text-slate-700 dark:text-slate-200">{t.monthly.totalHours.toFixed(1)}h</span> <span className="text-slate-400">({t.monthly.assignmentCount}d)</span></div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Assignment rows grouped by week */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <th className="px-3 py-2 text-left text-xs text-slate-500">Employee</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-500">Week</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-500">Region</th>
                  <th className="px-3 py-2 text-center text-xs text-slate-500">Hours</th>
                  <th className="px-3 py-2 text-center text-xs text-slate-500">Override</th>
                  {canEdit && <th className="px-3 py-2 text-center text-xs text-slate-500">Actions</th>}
                </tr></thead>
                <tbody>
                  {filteredConnectionAssignments.length === 0 ? (
                    <tr><td colSpan={canEdit ? 7 : 6} className="px-3 py-6 text-center text-xs text-slate-400 italic">No connection assignments for this month</td></tr>
                  ) : filteredConnectionAssignments.map((a) => {
                    const emp = employees.find(e => e.id === a.employeeId);
                    return (
                      <tr key={a.id} className={`border-b border-slate-100 dark:border-slate-800 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/20 transition-colors ${a.id % 2 === 0 ? "bg-slate-50/50 dark:bg-slate-900/30" : ""}`}>
                        <td className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200">{emp?.name || `#${a.employeeId}`}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{formatDateDisplay(a.date)}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{a.weekStart ? formatDateDisplay(a.weekStart) : "-"}</td>
                        <td className="px-3 py-2"><Badge variant="outline" className="text-violet-700 border-violet-300 bg-violet-50 dark:bg-violet-950/20 text-[10px]">{REGIONS[a.regionCovered] || a.regionCovered}</Badge></td>
                        <td className="px-3 py-2 text-center text-xs font-medium text-slate-700 dark:text-slate-200">{a.hours > 0 ? a.hours.toFixed(1) : "-"}</td>
                        <td className="px-3 py-2 text-center text-xs">{a.overrideHours > 0 ? <span className="font-semibold text-amber-600">{a.overrideHours.toFixed(1)}h</span> : <span className="text-slate-300">-</span>}</td>
                        {canEdit && <td className="px-3 py-2 text-center"><Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => deleteAssignment(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        )}

        {/* SCHEDULE TABLE - Only show for Helpdesk tab */}
        {activeTab === "helpdesk" && (
        <main className="max-w-7xl mx-auto w-full px-4 mt-4 mb-8 flex-1">
          {dataLoading ? (
            <div className="flex items-center justify-center py-20"><div className="flex flex-col items-center gap-3"><RefreshCw className="h-8 w-8 text-slate-400 animate-spin" /><span className="text-slate-500 text-sm">Loading schedule...</span></div></div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-24 h-24 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-6">
                <CalendarDays className="h-12 w-12 text-slate-300 dark:text-slate-600" />
              </div>
              <h2 className="text-xl font-semibold text-slate-600 dark:text-slate-300 mb-2">No Schedule Generated</h2>
              <p className="text-slate-400 dark:text-slate-500 mb-8 max-w-md leading-relaxed">Click &quot;Generate Month&quot; to create a balanced shift schedule for {MONTHS[Number(selectedMonth.split("-")[1]) - 1]} {selectedYear}</p>
              {canEdit && <Button onClick={generateMonth} disabled={generating || selectedRegion === "all"} className="bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transition-shadow"><Sparkles className="h-4 w-4 mr-1.5" />Generate Schedule</Button>}
            </div>
          ) : (
            <div className="space-y-3">
              {weekGroups.map((week) => {
                const isCollapsed = collapsedWeeks.has(week.key);
                const offPerson = week.entries[0]?.offPerson || "N/A";
                const connPerson = connectionByWeek.get(week.key);
                return (
                  <Card key={week.key} className="shadow-sm overflow-hidden">
                    <div className="bg-gradient-to-r from-[#0F2847] to-[#1E50D8] text-white px-4 py-2.5 cursor-pointer flex items-center justify-between" onClick={() => { const next = new Set(collapsedWeeks); if (isCollapsed) next.delete(week.key); else next.add(week.key); setCollapsedWeeks(next); }}>
                      <div className="flex items-center gap-3 flex-wrap">{isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}<span className="font-semibold text-sm">{week.label}</span></div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {connPerson && (() => {
                          const connHrs = calcConnectionWeekHours(connPerson.weekStart, connPerson.weekEnd);
                          return <Badge className="bg-teal-500/90 text-white border-0 text-xs"><Link2 className="h-2.5 w-2.5 mr-0.5" />Connection: {connPerson.empName} ({connHrs.toFixed(1)}h)</Badge>;
                        })()}
                        <Badge className="bg-red-500/80 text-white border-0 text-xs">OFF: {offPerson}</Badge>
                        {canEdit && (
                          <Tooltip><TooltipTrigger asChild>
                            <button
                              className="p-1 rounded hover:bg-white/20 transition-colors"
                              onClick={(e) => { e.stopPropagation(); regenerateWeek(week.key); }}
                              disabled={generating}
                            >
                              <RefreshCw className={`h-3.5 w-3.5 text-white/80 ${generating ? "animate-spin" : ""}`} />
                            </button>
                          </TooltipTrigger><TooltipContent>Regenerate this week (reassign OFF + redistribute shifts)</TooltipContent></Tooltip>
                        )}
                      </div>
                    </div>
                    {!isCollapsed && (
                      <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                            <th className="px-3 py-2 text-left w-8 text-xs text-slate-500">#</th>
                            <th className="px-3 py-2 text-left w-28 text-xs text-slate-500">Date</th>
                            <th className="px-3 py-2 text-left w-24 text-xs text-slate-500">Day</th>
                            <th className="px-3 py-2 text-center w-14 text-xs text-slate-500">Type</th>
                            <th className="px-3 py-2 text-left text-xs text-slate-500">Employee</th>
                            <th className="px-3 py-2 text-left w-20 text-xs text-slate-500 hidden sm:table-cell">HRID</th>
                            <th className="px-3 py-2 text-center w-20 text-xs text-slate-500 hidden md:table-cell">Start</th>
                            <th className="px-3 py-2 text-center w-20 text-xs text-slate-500 hidden md:table-cell">End</th>
                            <th className="px-3 py-2 text-center w-16 text-xs text-slate-500">Hours</th>
                            <th className="px-3 py-2 text-center w-24 text-xs text-slate-500">Actions</th>
                          </tr></thead>
                          <tbody>
                            {week.entries.map((entry, idx) => {
                              const badge = getDayTypeBadge(entry.dayType, entry.isHoliday);
                              const isConnection = connectionEmpSet.has(`${entry.empName}-${getWeekNumber(entry.date)}`);
                              return (
                                <tr key={entry.date} className={`border-b border-slate-100 dark:border-slate-800 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors ${entry.isHoliday ? "bg-amber-50/50 dark:bg-amber-950/10" : ""} ${idx % 2 === 1 ? "bg-slate-50/50 dark:bg-slate-900/50" : ""}`}>
                                  <td className="px-3 py-2 text-slate-400 text-xs">{idx + 1}</td>
                                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200 text-xs">{formatDateDisplay(entry.date)}</td>
                                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300 text-xs">{entry.dayName}</td>
                                  <td className="px-3 py-2 text-center"><span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${badge.color}`}>{badge.label}</span></td>
                                  <td className="px-3 py-2">
                                    <button className={`font-semibold text-sm transition-colors ${swapMode && canEdit ? "text-purple-600 dark:text-purple-400 hover:text-purple-800 cursor-pointer underline decoration-dotted decoration-2 underline-offset-2" : "text-slate-800 dark:text-slate-100 cursor-default"} ${swapFirst && swapFirst.idx === entry.empIdx ? "ring-2 ring-purple-400 rounded px-1" : ""}`} onClick={(e) => { if (!swapMode || !canEdit) return; e.stopPropagation(); if (!swapFirst) { setSwapFirst({ idx: entry.empIdx, name: entry.empName }); } else if (swapFirst.idx !== entry.empIdx) { swapEmployees(swapFirst.idx, entry.empIdx); } }}>
                                      {entry.empName}
                                      {entry.isManual && <span className="ml-1.5 text-[9px] font-normal text-purple-500 border border-purple-300 rounded px-1">Manual</span>}
                                      {isConnection && <span className="ml-1.5 text-[9px] font-normal text-teal-600 border border-teal-300 rounded px-1">Connection</span>}
                                    </button>
                                  </td>
                                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 text-xs hidden sm:table-cell">{entry.empHrid}</td>
                                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 text-xs text-center hidden md:table-cell">{entry.start}</td>
                                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 text-xs text-center hidden md:table-cell">{entry.end}</td>
                                  <td className="px-3 py-2 text-center">
                                    {editingHoursDate === entry.date && canEdit ? (
                                      <div className="flex items-center justify-center gap-1">
                                        <Input type="number" value={editingHoursValue} onChange={(e) => setEditingHoursValue(e.target.value)} className="w-14 h-7 text-xs text-center p-0" min={1} max={24} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && editingHoursValue) { updateEntryHours(entry.date, Number(editingHoursValue)); } if (e.key === "Escape") { setEditingHoursDate(null); } }} />
                                        <Button size="icon" variant="ghost" className="h-6 w-6 text-emerald-500" onClick={() => { if (editingHoursValue) updateEntryHours(entry.date, Number(editingHoursValue)); }}><CheckCircle className="h-3 w-3" /></Button>
                                        <Button size="icon" variant="ghost" className="h-6 w-6 text-slate-400" onClick={() => setEditingHoursDate(null)}><X className="h-3 w-3" /></Button>
                                      </div>
                                    ) : (
                                      <button
                                        className={`font-bold ${canEdit ? "text-blue-600 dark:text-blue-400 hover:text-blue-800 cursor-pointer hover:underline decoration-dotted underline-offset-2" : "text-blue-600 dark:text-blue-400"}`}
                                        onClick={() => { if (canEdit) { setEditingHoursDate(entry.date); setEditingHoursValue(String(entry.hours)); } }}
                                        title={canEdit ? "Click to edit hours" : undefined}
                                      >
                                        {entry.hours}
                                        {settings?.dayHours?.[entry.date] !== undefined && canEdit && <span className="ml-0.5 text-[8px] text-violet-500">✱</span>}
                                      </button>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      {canEdit && (
                                        <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" className={`h-7 w-7 ${entry.isHoliday ? "text-amber-600 bg-amber-50" : "text-slate-400"}`} onClick={() => toggleHoliday(entry.date, entry.isHoliday)}><AlertTriangle className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>{entry.isHoliday ? "Remove holiday" : "Mark as holiday"}</TooltipContent></Tooltip>
                                      )}
                                      {canEdit && (
                                        <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => deleteEntry(entry.date)}><Trash2 className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Delete entry</TooltipContent></Tooltip>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {/* Connection Team info bar at bottom of week */}
                      {connPerson && (
                        <div className="bg-teal-50 dark:bg-teal-950/20 border-t border-teal-200 dark:border-teal-800 px-4 py-2.5 flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm text-teal-700 dark:text-teal-300">
                            <Link2 className="h-4 w-4" />
                            <span className="font-semibold text-teal-800 dark:text-teal-200">Connection: {connPerson.empName} ({connPerson.empHrid}) | {calcConnectionWeekHours(connPerson.weekStart, connPerson.weekEnd).toFixed(1)}h</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {canEdit && (
                              <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => deleteConnectionEntry(connPerson.id)}><Trash2 className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Remove Connection Team assignment</TooltipContent></Tooltip>
                            )}
                          </div>
                        </div>
                      )}
                      </>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </main>
        )}

        {/* ===== SETTINGS MODAL ===== */}
        <Dialog open={showSettings} onOpenChange={setShowSettings}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings className="h-5 w-5" /> Shift Settings</DialogTitle><DialogDescription>Configure shift times, holidays, and scheduling rules</DialogDescription></DialogHeader>
            {editSettings && (
              <div className="space-y-5 mt-2">
                <div className="space-y-3"><h3 className="font-semibold text-sm text-slate-700 dark:text-slate-200 flex items-center gap-1.5"><Clock className="h-4 w-4 text-emerald-500" />Shift Times</h3>
                  {Object.entries(editSettings.shifts).map(([key, shift]) => (
                    <div key={key} className="grid grid-cols-3 gap-2 items-center">
                      <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">{key === "Weekday" ? "Weekday (Sun-Wed)" : key === "Holiday" ? "Holiday (Official Off)" : key}</Label>
                      <Input
                        value={shift.start}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditSettings((prev) => {
                            if (!prev) return prev;
                            return { ...prev, shifts: { ...prev.shifts, [key]: { ...prev.shifts[key], start: v } } };
                          });
                        }}
                        className="h-8 text-xs"
                        placeholder="05:00 PM"
                      />
                      <Input
                        value={shift.end}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditSettings((prev) => {
                            if (!prev) return prev;
                            return { ...prev, shifts: { ...prev.shifts, [key]: { ...prev.shifts[key], end: v } } };
                          });
                        }}
                        className="h-8 text-xs"
                        placeholder="10:00 PM"
                      />
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="space-y-2"><h3 className="font-semibold text-sm text-slate-700 dark:text-slate-200">Shift Hours</h3>
                  {Object.entries(editSettings.shifts).map(([key, shift]) => (
                    <div key={key} className="flex items-center justify-between">
                      <Label className="text-xs text-slate-600 dark:text-slate-300">{key === "Weekday" ? "Weekday (Sun-Wed)" : key === "Holiday" ? "Holiday (Official Off)" : key}</Label>
                      <Input
                        type="number"
                        value={shift.hours}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setEditSettings((prev) => {
                            if (!prev) return prev;
                            return { ...prev, shifts: { ...prev.shifts, [key]: { ...prev.shifts[key], hours: v } } };
                          });
                        }}
                        className="w-20 h-8 text-xs text-center"
                        min={1}
                        max={12}
                      />
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 text-slate-500" />
                    Generation Week Rules
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-600 dark:text-slate-300">Week start day (Helpdesk)</Label>
                      <Select
                        value={editSettings.weekStart}
                        onValueChange={(v) => setEditSettings((prev) => prev ? ({ ...prev, weekStart: v }) : prev)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Friday" />
                        </SelectTrigger>
                        <SelectContent>
                          {["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"].map((d) => (
                            <SelectItem key={d} value={d}>{d}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-600 dark:text-slate-300">Month generation starts</Label>
                      <Select
                        value={editSettings.monthStartMode}
                        onValueChange={(v) => setEditSettings((prev) => prev ? ({ ...prev, monthStartMode: v as SettingsData["monthStartMode"] }) : prev)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Aligned to week start" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekStartAligned">Aligned to weekStart (may include days before 1st)</SelectItem>
                          <SelectItem value="monthDay1">Start from day 1 (every 7 days)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center justify-between"><div><h3 className="font-semibold text-sm text-slate-700 dark:text-slate-200">Summer Time</h3><p className="text-xs text-slate-400">Enable extended summer shift hours</p></div><Switch checked={editSettings.summerTime} onCheckedChange={(checked) => { setEditSettings({ ...editSettings, summerTime: checked }); }} /></div>
                  {editSettings.summerTime && editSettings.summerShifts && (
                    <div className="space-y-3 pl-0">
                      <h4 className="font-medium text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" />Summer Shift Times</h4>
                      {Object.entries(editSettings.summerShifts).map(([key, shift]) => (
                        <div key={key} className="grid grid-cols-3 gap-2 items-center">
                          <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">{key === "Weekday" ? "Weekday (Sun-Wed)" : key}</Label>
                          <Input
                            value={shift.start}
                            onChange={(e) => {
                              const v = e.target.value;
                              setEditSettings((prev) => {
                                if (!prev) return prev;
                                return { ...prev, summerShifts: { ...prev.summerShifts, [key]: { ...prev.summerShifts[key], start: v } } };
                              });
                            }}
                            className="h-8 text-xs"
                          />
                          <Input
                            value={shift.end}
                            onChange={(e) => {
                              const v = e.target.value;
                              setEditSettings((prev) => {
                                if (!prev) return prev;
                                return { ...prev, summerShifts: { ...prev.summerShifts, [key]: { ...prev.summerShifts[key], end: v } } };
                              });
                            }}
                            className="h-8 text-xs"
                          />
                        </div>
                      ))}
                      {Object.entries(editSettings.summerShifts).map(([key, shift]) => (
                        <div key={`hrs-${key}`} className="flex items-center justify-between">
                          <Label className="text-xs text-slate-600 dark:text-slate-300">{key === "Weekday" ? "Weekday (Sun-Wed)" : key} hours</Label>
                          <Input
                            type="number"
                            value={shift.hours}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setEditSettings((prev) => {
                                if (!prev) return prev;
                                return { ...prev, summerShifts: { ...prev.summerShifts, [key]: { ...prev.summerShifts[key], hours: v } } };
                              });
                            }}
                            className="w-20 h-8 text-xs text-center"
                            min={1}
                            max={12}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <Separator />
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-200 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-amber-500" />Holiday Dates</h3>
                  <div className="flex gap-2">
                    <Input type="date" value={newHolidayDate} onChange={(e) => {
                      setNewHolidayDate(e.target.value);
                      // Auto-fill default hours based on weekday
                      if (e.target.value) {
                        const defaultHours = getDefaultHolidayHours(e.target.value, editSettings);
                        setNewHolidayHours(defaultHours.toString());
                      }
                    }} className="h-8 text-xs flex-1" />
                    <Input type="number" value={newHolidayHours} onChange={(e) => setNewHolidayHours(e.target.value)} placeholder="Hours" className="h-8 text-xs w-20" min={0} max={12} />
                    <Button size="sm" className="h-8 bg-amber-600 hover:bg-amber-700 text-white" onClick={() => {
                      if (!newHolidayDate) return;
                      if (editSettings.holidays.includes(newHolidayDate)) return;
                      const hours = newHolidayHours ? Number(newHolidayHours) : getDefaultHolidayHours(newHolidayDate, editSettings);
                      setEditSettings({
                        ...editSettings,
                        holidays: [...editSettings.holidays, newHolidayDate].sort(),
                        holidayHours: { ...editSettings.holidayHours, [newHolidayDate]: hours }
                      });
                      setNewHolidayDate("");
                      setNewHolidayHours("");
                    }}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
                  </div>
                  {editSettings.holidays.length > 0 ? (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">{editSettings.holidays.map((hDate) => {
                      const holidayHours = editSettings.holidayHours?.[hDate] ?? getDefaultHolidayHours(hDate, editSettings);
                      return (
                        <div key={hDate} className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3.5 w-3.5 text-amber-500" />
                            <span className="text-xs font-medium text-amber-800 dark:text-amber-200">{formatHolidayDisplay(hDate)}</span>
                            <span className="text-[10px] text-amber-500">{hDate}</span>
                            <Badge variant="outline" className="h-5 text-[10px] px-1.5 py-0 border-amber-300 text-amber-700 dark:border-amber-600 dark:text-amber-300">-{holidayHours}h</Badge>
                          </div>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={editSettings.holidayHours?.[hDate] ?? ""}
                              onChange={(e) => {
                                const hrs = Number(e.target.value);
                                setEditSettings({
                                  ...editSettings,
                                  holidayHours: { ...editSettings.holidayHours, [hDate]: hrs }
                                });
                              }}
                              className="h-6 w-14 text-xs text-center"
                              min={0}
                              max={12}
                              placeholder={getDefaultHolidayHours(hDate, editSettings).toString()}
                            />
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => {
                              const newHolidays = editSettings.holidays.filter((d) => d !== hDate);
                              const newHolidayHours = { ...editSettings.holidayHours };
                              delete newHolidayHours[hDate];
                              setEditSettings({ ...editSettings, holidays: newHolidays, holidayHours: newHolidayHours });
                            }}><X className="h-3 w-3" /></Button>
                          </div>
                        </div>
                      );
                    })}</div>
                  ) : <p className="text-xs text-slate-400 italic">No holidays configured.</p>}
                </div>
                <Separator />
                {/* Custom Day Hours */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-200 flex items-center gap-1.5"><Clock className="h-4 w-4 text-violet-500" />Custom Day Hours</h3>
                  <p className="text-xs text-slate-400">Override shift hours for specific dates</p>
                  <div className="flex gap-2">
                    <Input type="date" value={newDayHourDate} onChange={(e) => setNewDayHourDate(e.target.value)} className="h-8 text-xs flex-1" />
                    <Input type="number" value={newDayHourValue} onChange={(e) => setNewDayHourValue(e.target.value)} placeholder="Hours" className="h-8 text-xs w-20" min={1} max={12} />
                    <Button size="sm" className="h-8 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => {
                      if (!newDayHourDate || !newDayHourValue) return;
                      const hrs = { ...editSettings.dayHours, [newDayHourDate]: Number(newDayHourValue) };
                      setEditSettings({ ...editSettings, dayHours: hrs });
                      setNewDayHourDate("");
                      setNewDayHourValue("");
                    }}><Plus className="h-3.5 w-3.5 mr-1" />Set</Button>
                  </div>
                  {Object.keys(editSettings.dayHours).length > 0 ? (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">{Object.entries(editSettings.dayHours).sort(([a], [b]) => a.localeCompare(b)).map(([dDate, hrs]) => (
                      <div key={dDate} className="flex items-center justify-between bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2"><Clock className="h-3.5 w-3.5 text-violet-500" /><span className="text-xs font-medium text-violet-800 dark:text-violet-200">{formatDateDisplay(dDate)}</span><span className="text-[10px] text-violet-500">{dDate}</span><span className="text-xs font-bold text-violet-700">{hrs}h</span></div>
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => {
                          const hrs = { ...editSettings.dayHours };
                          delete hrs[dDate];
                          setEditSettings({ ...editSettings, dayHours: hrs });
                        }}><X className="h-3 w-3" /></Button>
                      </div>
                    ))}</div>
                  ) : <p className="text-xs text-slate-400 italic">No custom hours set.</p>}
                </div>
              </div>
            )}
            <DialogFooter><Button variant="outline" onClick={() => setShowSettings(false)}>Cancel</Button><Button onClick={saveSettings} disabled={savingSettings} className="bg-blue-600 hover:bg-blue-700 text-white">{savingSettings ? "Saving..." : "Save Settings"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== EMPLOYEES MODAL ===== */}
        <Dialog open={showEmployees} onOpenChange={setShowEmployees}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Connection Team</DialogTitle><DialogDescription>Manage your Connection Team roster</DialogDescription></DialogHeader>
            <div className="space-y-4 mt-2">
              {canEdit && (
                <div className="flex gap-2 flex-wrap">
                  <Input value={newEmpName} onChange={(e) => setNewEmpName(e.target.value)} placeholder="Full Name" className="h-8 text-sm flex-1 min-w-[120px]" />
                  <Input value={newEmpHrid} onChange={(e) => setNewEmpHrid(e.target.value)} placeholder="HRID" className="h-8 w-24 text-sm" />
                  <Select value={newEmpTeamType} onValueChange={setNewEmpTeamType}>
                    <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(TEAM_TYPES).map(([key, label]) => (<SelectItem key={key} value={key}>{label}</SelectItem>))}</SelectContent>
                  </Select>
                  {newEmpTeamType !== "connection" && (
                    <Select value={newEmpRegion} onValueChange={setNewEmpRegion}>
                      <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(REGIONS).map(([key, label]) => (<SelectItem key={key} value={key}>{label}</SelectItem>))}</SelectContent>
                    </Select>
                  )}
                  {newEmpTeamType === "connection" && <div className="text-xs text-slate-400 italic ml-2">Region not applicable</div>}
                  <Button onClick={addEmployee} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white h-8"><Plus className="h-4 w-4" /></Button>
                </div>
              )}
              <Separator />
              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input value={empSearchQuery} onChange={(e) => setEmpSearchQuery(e.target.value)} placeholder="Search by name or HRID..." className="h-9 text-sm pl-9" />
              </div>
              {/* Region Summary Bar */}
              <div className="flex gap-2 flex-wrap mb-2">
                {["cairo", "delta", "upper_egypt"].map(r => {
                  const count = employees.filter((e: any) => e.region === r).length;
                  return (
                    <Badge key={r} variant="outline" className="px-2.5 py-1 text-xs border-slate-300 dark:border-slate-600">
                      {r.replace("_", " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}: <span className="font-bold">{count}</span>
                    </Badge>
                  );
                })}
                <Badge variant="outline" className="px-2.5 py-1 text-xs border-purple-300 text-purple-700 dark:text-purple-300 dark:border-purple-700">
                  Total: <span className="font-bold">{employees.length}</span>
                </Badge>
              </div>
              <div className="space-y-2">{employees.filter((emp: any) => empSearchQuery === "" || emp.name.toLowerCase().includes(empSearchQuery.toLowerCase()) || emp.hrid.toLowerCase().includes(empSearchQuery.toLowerCase())).map((emp, idx) => (
                <div key={emp.id} className={`flex items-center justify-between p-2.5 rounded-lg border transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${emp.active ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" : "border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 opacity-60"}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{emp.name}</span>
                    <span className="text-xs text-slate-400">({emp.hrid})</span>
                    {emp.teamType && (
                      <Badge variant={emp.teamType === "both" ? "default" : "outline"} className={`text-[10px] ml-2 ${emp.teamType === "connection" ? "bg-teal-100 text-teal-700 border-teal-300 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-700" : emp.teamType === "both" ? "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700" : "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700"}`}>
                        {emp.teamType === "connection" ? "Connection" : emp.teamType === "both" ? "Both" : "Helpdesk"}
                      </Badge>
                    )}
                  </div>
                  {editingEmpId === emp.id ? (
                    <>
                      <div className="flex gap-2">
                        <Input value={editEmpName} onChange={(e) => setEditEmpName(e.target.value)} placeholder="Name" className="h-7 w-32 text-sm" />
                        <Input value={editEmpHrid} onChange={(e) => setEditEmpHrid(e.target.value)} placeholder="HRID" className="h-7 w-20 text-sm" />
                        <Select value={editEmpTeamType || "helpdesk"} onValueChange={setEditEmpTeamType}>
                          <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(TEAM_TYPES).map(([key, label]) => (<SelectItem key={key} value={key}>{label}</SelectItem>))}</SelectContent>
                        </Select>
                        {editEmpTeamType !== "connection" && (
                          <Select value={editEmpRegion} onValueChange={setEditEmpRegion}>
                            <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{Object.entries(REGIONS).map(([key, label]) => (<SelectItem key={key} value={key}>{label}</SelectItem>))}</SelectContent>
                          </Select>
                        )}
                        {editEmpTeamType === "connection" && <div className="text-[10px] text-slate-400 italic self-center ml-1">Region: all</div>}
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white text-xs" onClick={() => editEmployee(emp.id, editEmpName, editEmpHrid)}><CheckCircle className="h-3 w-3 mr-1" />Save</Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400" onClick={() => { setEditingEmpId(null); }}><X className="h-3.5 w-3.5" /></Button>
                      </div>
                    </>
                  ) : canEdit ? (
                    <>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-400 hover:text-blue-600" onClick={() => { setEditingEmpId(emp.id); setEditEmpName(emp.name); setEditEmpHrid(emp.hrid); setEditEmpRegion(emp.region || "cairo"); setEditEmpTeamType(emp.teamType || "helpdesk"); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <div className="flex items-center gap-1.5"><Switch checked={emp.active} onCheckedChange={() => toggleEmployeeActive(emp.id, emp.active)} className="scale-75" /><span className="text-[10px] text-slate-400">{emp.active ? "Active" : "Inactive"}</span></div>
                      {canAdmin && <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => deleteEmployee(emp.id, emp.name)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                    </>
                  ) : null}
                </div>
              ))}</div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ===== ADD SHIFT MODAL ===== */}
        <Dialog open={showAddShift} onOpenChange={setShowAddShift}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Add Manual Shift</DialogTitle><DialogDescription>Add a one-time shift for a specific date</DialogDescription></DialogHeader>
            <div className="space-y-3 mt-2">
              <div><Label className="text-xs">Date</Label><Input type="date" value={addShiftDate} onChange={(e) => setAddShiftDate(e.target.value)} className="mt-1" /></div>
              <div><Label className="text-xs">Employee</Label><Select value={addShiftEmp} onValueChange={setAddShiftEmp}><SelectTrigger className="mt-1"><SelectValue placeholder="Select employee" /></SelectTrigger><SelectContent>{employees.filter((e) => e.active).map((emp) => (<SelectItem key={emp.id} value={String(emp.id)}>{emp.name} ({emp.hrid})</SelectItem>))}</SelectContent></Select></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setShowAddShift(false)}>Cancel</Button><Button onClick={addManualShift} className="bg-blue-600 hover:bg-blue-700 text-white">Add Shift</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== EXPORT MODAL ===== */}
        <Dialog open={showExport} onOpenChange={setShowExport}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Export to Excel</DialogTitle><DialogDescription>Customize your export</DialogDescription></DialogHeader>
            
            {/* Tab Selection */}
            <div className="flex gap-2 mb-4">
              <Button 
                size="sm" 
                variant={exportType === "helpdesk" ? "default" : "outline"}
                onClick={() => setExportType("helpdesk")}
                className={exportType === "helpdesk" ? "bg-emerald-600 text-white shadow-inner" : ""}
              >Helpdesk</Button>
              <Button 
                size="sm" 
                variant={exportType === "connection" ? "default" : "outline"}
                onClick={() => setExportType("connection")}
                className={exportType === "connection" ? "bg-teal-600 text-white shadow-inner" : ""}
              >Connection Team</Button>
              <Button 
                size="sm" 
                variant={exportType === "hrid" ? "default" : "outline"}
                onClick={() => setExportType("hrid")}
                className={exportType === "hrid" ? "bg-violet-600 text-white shadow-inner" : ""}
              >Search by HRID</Button>
              <Button 
                size="sm" 
                variant={exportType === "matrix" ? "default" : "outline"}
                onClick={() => setExportType("matrix")}
                className={exportType === "matrix" ? "bg-orange-600 text-white shadow-inner" : ""}
              >📊 Matrix View</Button>
            </div>

            {/* ===== HELPDESK CONTENT ===== */}
            {exportType === "helpdesk" && (
              <div className="space-y-4 mt-2">
                <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <Checkbox 
                    checked={exportConnectionOnly} 
                    onCheckedChange={(checked) => setExportConnectionOnly(!!checked)} 
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Export Connection Team</div>
                    <div className="text-xs text-slate-500">Check this box to export Connection Team assignments only</div>
                  </div>
                </div>
                
                <Separator />
                
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <Label className="text-xs font-medium"><MapPin className="h-3.5 w-3.5 inline mr-1" />Select Regions</Label>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {Object.entries(REGIONS).filter(([k]) => k !== "all").map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <Checkbox checked={exportRegions.includes(key)} onCheckedChange={() => toggleExportRegion(key)} />
                        <span className="text-sm">{label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Check the regions you want to export</p>
                </div>
                
                <Separator />
                
                <div>
                  <Label className="text-xs font-medium">Select Employees</Label>
                  <div className="mt-2 flex gap-2 mb-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { const regionEmps = employees.filter(e => exportRegions.includes(e.region)); setExportSelectedIds(regionEmps.map((e) => e.id)); }}>Select All</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setExportSelectedIds([])}>Deselect All</Button>
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {employees.filter(e => exportRegions.includes(e.region)).map((emp) => (
                      <div key={emp.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800">
                        <Checkbox checked={exportSelectedIds.includes(emp.id)} onCheckedChange={(checked) => { if (checked) setExportSelectedIds([...exportSelectedIds, emp.id]); else setExportSelectedIds(exportSelectedIds.filter((id) => id !== emp.id)); }} />
                        <span className="text-sm">{emp.name} <span className="text-xs text-slate-400">({emp.hrid})</span></span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Leave empty to export all employees</p>
                </div>
                
                <Separator />
                
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Date From</Label><Input type="date" value={exportDateFrom} onChange={(e) => setExportDateFrom(e.target.value)} className="mt-1 h-8 text-xs" /></div>
                  <div><Label className="text-xs">Date To</Label><Input type="date" value={exportDateTo} onChange={(e) => setExportDateTo(e.target.value)} className="mt-1 h-8 text-xs" /></div>
                </div>
                <p className="text-[10px] text-slate-400">Leave empty to use selected month: {selectedMonth}</p>
              </div>
            )}

            {/* ===== CONNECTION TEAM CONTENT ===== */}
            {exportType === "connection" && (
              <div className="space-y-4 mt-2">
                <div className="p-4 bg-teal-50 dark:bg-teal-950 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Link2 className="h-5 w-5 text-teal-600 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-teal-900 dark:text-teal-100">Connection Team Export</div>
                      <div className="text-xs text-teal-700 dark:text-teal-300">Exports all Connection Team weekly assignments</div>
                      <div className="text-xs text-teal-600 dark:text-teal-400 mt-1">No region selection needed - Connection Team covers all regions</div>
                    </div>
                  </div>
                </div>
                
                <Separator />
                
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Month From</Label><Input type="month" value={exportHridMonthFrom} onChange={(e) => setExportHridMonthFrom(e.target.value)} className="mt-1 h-8 text-xs" /></div>
                  <div><Label className="text-xs">Month To</Label><Input type="month" value={exportHridMonthTo} onChange={(e) => setExportHridMonthTo(e.target.value)} className="mt-1 h-8 text-xs" /></div>
                </div>
                <p className="text-[10px] text-slate-400">Leave empty to use selected month: {selectedMonth}</p>
              </div>
            )}

            {/* ===== SEARCH BY HRID CONTENT ===== */}
            {exportType === "hrid" && (
              <div className="space-y-4 mt-2">
                <div className="p-4 bg-violet-50 dark:bg-violet-950 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Search className="h-5 w-5 text-violet-600 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-violet-900 dark:text-violet-100">Search by Employee HRID</div>
                      <div className="text-xs text-violet-700 dark:text-violet-300">Export schedule for a single employee across multiple months/weeks</div>
                    </div>
                  </div>
                </div>
                
                <div>
                  <Label className="text-xs font-medium">Employee HRID</Label>
                  <Select value={exportHrid} onValueChange={setExportHrid}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select employee by HRID" /></SelectTrigger>
                    <SelectContent>
                      {employees.filter(e => e.active).map((emp) => (
                        <SelectItem key={emp.id} value={emp.hrid}>{emp.hrid} - {emp.name} ({emp.region})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <Separator />
                
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Month From</Label><Input type="month" value={exportHridMonthFrom} onChange={(e) => setExportHridMonthFrom(e.target.value)} className="mt-1 h-8 text-xs" /></div>
                  <div><Label className="text-xs">Month To</Label><Input type="month" value={exportHridMonthTo} onChange={(e) => setExportHridMonthTo(e.target.value)} className="mt-1 h-8 text-xs" /></div>
                </div>
                <p className="text-[10px] text-slate-400">Leave empty to export all available data</p>
              </div>
            )}

            {/* ===== MATRIX VIEW CONTENT ===== */}
            {exportType === "matrix" && (
              <div className="space-y-4 mt-2">
                <div className="p-4 bg-orange-50 dark:bg-orange-950 rounded-lg">
                  <div className="flex items-start gap-2">
                    <LayoutGrid className="h-5 w-5 text-orange-600 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-orange-900 dark:text-orange-100">Matrix View Export</div>
                      <div className="text-xs text-orange-700 dark:text-orange-300">Exports a professional matrix-style Excel with W/Off grid, conditional formatting, formulas, and smart recommendations</div>
                    </div>
                  </div>
                </div>
                
                <Separator />
                
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">📁 Includes:</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-2 text-xs p-2 bg-slate-50 dark:bg-slate-800 rounded"><FileSpreadsheet className="h-3.5 w-3.5 text-blue-500" /> Config sheet with dropdowns</div>
                    <div className="flex items-center gap-2 text-xs p-2 bg-slate-50 dark:bg-slate-800 rounded"><LayoutGrid className="h-3.5 w-3.5 text-emerald-500" /> Matrix per region</div>
                    <div className="flex items-center gap-2 text-xs p-2 bg-slate-50 dark:bg-slate-800 rounded"><Link2 className="h-3.5 w-3.5 text-teal-500" /> Connection Team sheet</div>
                    <div className="flex items-center gap-2 text-xs p-2 bg-slate-50 dark:bg-slate-800 rounded"><BarChart3 className="h-3.5 w-3.5 text-amber-500" /> Summary with formulas</div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">🎨 Features:</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-200 inline-block border border-red-300" /> Conditional formatting: consecutive work days highlighted in red</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-200 inline-block border border-green-300" /> W (green) = Working, Off (red) = Weekly Off</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-200 inline-block border border-amber-300" /> Variance alerts: Max-Min &gt; 1 triggers warning</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-200 inline-block border border-blue-300" /> COUNTIF formulas, MAX/MIN statistics</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-purple-200 inline-block border border-purple-300" /> Smart recommendations per team</div>
                  </div>
                </div>

                <Separator />

                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <Label className="text-xs font-medium"><MapPin className="h-3.5 w-3.5 inline mr-1" />Select Regions</Label>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {Object.entries(REGIONS).filter(([k]) => k !== "all").map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <Checkbox checked={exportRegions.includes(key)} onCheckedChange={() => toggleExportRegion(key)} />
                        <span className="text-sm">{label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Check the regions you want to export</p>
                </div>

                <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                  <div className="text-xs text-blue-700 dark:text-blue-300">📅 Month: <span className="font-bold">{selectedMonth}</span> — {buildWeekOptions().length} weeks in this period</div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowExport(false)}>Cancel</Button>
              {exportType === "hrid" ? (
                <Button onClick={exportHridExcel} disabled={exporting || !exportHrid} className="bg-violet-600 hover:bg-violet-700 text-white">{exporting ? "Exporting..." : "Export Employee"}</Button>
              ) : exportType === "connection" ? (
                <Button onClick={exportConnectionExcel} disabled={exporting} className="bg-teal-600 hover:bg-teal-700 text-white">{exporting ? "Exporting..." : "Export Connection Team"}</Button>
              ) : exportType === "matrix" ? (
                <Button onClick={exportMatrixExcel} disabled={exporting} className="bg-orange-600 hover:bg-orange-700 text-white">{exporting ? "Exporting..." : "📊 Export Matrix"}</Button>
              ) : (
                <Button onClick={exportHelpdeskExcel} disabled={exporting} className="bg-emerald-600 hover:bg-emerald-700 text-white">{exporting ? "Exporting..." : "Export Helpdesk"}</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== STATS MODAL ===== */}
        <Dialog open={showStats} onOpenChange={setShowStats}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Statistics & Reports</DialogTitle><DialogDescription>Per-employee stats for {MONTHS[Number(selectedMonth.split("-")[1]) - 1]} {selectedYear}</DialogDescription></DialogHeader>
            {balance && (
              <div className="space-y-4 mt-2">
                <div className="grid grid-cols-3 gap-3">
                  <Card className="shadow-sm"><CardContent className="p-3 text-center"><div className="text-lg font-bold text-slate-800 dark:text-slate-100">{balance.average.toFixed(1)}h</div><div className="text-xs text-slate-500">Avg Hours</div></CardContent></Card>
                  <Card className="shadow-sm"><CardContent className="p-3 text-center"><div className="text-lg font-bold text-blue-600">{balance.max.toFixed(1)}h</div><div className="text-xs text-slate-500">Max Hours</div></CardContent></Card>
                  <Card className="shadow-sm"><CardContent className="p-3 text-center"><div className="text-lg font-bold text-amber-600">{balance.min.toFixed(1)}h</div><div className="text-xs text-slate-500">Min Hours</div></CardContent></Card>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-100 dark:bg-slate-800">

                  <span className="text-xs text-slate-600 dark:text-slate-300">Variance: {balance.variance.toFixed(1)}h | Avg Deviation: {balance.avgAbsDeviation.toFixed(1)}h</span>
                </div>
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <th className="px-3 py-2 text-left text-xs text-slate-500">#</th>
                    <th className="px-3 py-2 text-left text-xs text-slate-500">Employee</th>
                    <th className="px-3 py-2 text-center text-xs text-slate-500">Days</th>
                    <th className="px-3 py-2 text-center text-xs text-slate-500">Hours</th>
                    <th className="px-3 py-2 text-center text-xs text-slate-500">Sat</th>
                    <th className="px-3 py-2 text-center text-xs text-slate-500">Fri</th>
                    <th className="px-3 py-2 text-center text-xs text-slate-500">Weekends</th>
                    <th className="px-3 py-2 text-center text-xs text-slate-500">OFF Weeks</th>
                    <th className="px-3 py-2 text-center text-xs text-slate-500">Conn Hrs</th>
                  </tr></thead>
                  <tbody>
                    {regionActiveEmps.map((emp, idx) => {
                      const empEntries = filteredEntries.filter((e2) => e2.empName === emp.name);
                      const hrs = empEntries.reduce((s, e2) => s + e2.hours, 0);
                      const allHrsList = regionActiveEmps.map((e) => filteredEntries.filter((e2) => e2.empName === e.name).reduce((s, e2) => s + e2.hours, 0));
                      const avgH = allHrsList.length > 0 ? allHrsList.reduce((a, b) => a + b, 0) / allHrsList.length : 0;
                      const diff = hrs - avgH;
                      const connHrs = filteredConnectionTeam
                        .filter((ct) => ct.empName === emp.name)
                        .reduce((sum, ct) => sum + calcConnectionWeekHours(ct.weekStart, ct.weekEnd), 0);
                      return (
                        <tr key={emp.id} className={`border-b border-slate-100 dark:border-slate-800 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/20 transition-colors ${idx % 2 === 1 ? "bg-slate-50/50 dark:bg-slate-900/30" : ""}`}>
                          <td className="px-3 py-2 text-slate-400 text-xs">{idx + 1}</td>
                          <td className="px-3 py-2 font-medium text-sm">{emp.name}</td>
                          <td className="px-3 py-2 text-center text-xs">{empEntries.length}</td>
                          <td className="px-3 py-2 text-center"><span className="font-bold text-blue-600">{hrs.toFixed(1)}</span>{connHrs > 0 && <span className="text-xs text-teal-600 ml-1">(+{connHrs.toFixed(1)} conn)</span>}<span className={`ml-1 text-[10px] ${diff > 0 ? "text-red-500" : diff < 0 ? "text-green-500" : "text-slate-400"}`}>({diff > 0 ? "+" : ""}{diff.toFixed(1)})</span></td>
                          <td className="px-3 py-2 text-center text-xs">{empEntries.filter((e) => e.dayType === "Saturday").length}</td>
                          <td className="px-3 py-2 text-center text-xs">{empEntries.filter((e) => e.dayType === "Friday").length}</td>
                          <td className="px-3 py-2 text-center text-xs">{empEntries.filter((e) => e.dayType === "Saturday" || e.dayType === "Friday").length}</td>
                          <td className="px-3 py-2 text-center text-xs text-red-600 font-medium"></td>
                          <td className="px-3 py-2 text-center">
                            {connHrs > 0 ? <span className="font-bold text-teal-600 text-xs">{connHrs.toFixed(1)}h</span> : <span className="text-xs text-slate-400">-</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* ===== CHANGE PASSWORD MODAL ===== */}
        <Dialog open={showChangePassword} onOpenChange={setShowChangePassword}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Change Password</DialogTitle><DialogDescription>Update your account password</DialogDescription></DialogHeader>
            <div className="space-y-3 mt-2">
              <div><Label className="text-xs">Current Password</Label><Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="mt-1" /></div>
              <div><Label className="text-xs">New Password</Label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="mt-1" /></div>
              <div><Label className="text-xs">Confirm New Password</Label><Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-1" /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setShowChangePassword(false)}>Cancel</Button><Button onClick={handleChangePassword} disabled={changePasswordLoading} className="bg-blue-600 hover:bg-blue-700 text-white">{changePasswordLoading ? "Changing..." : "Change Password"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== USER MANAGEMENT MODAL (ADMIN) ===== */}
        <Dialog open={showUserMgmt} onOpenChange={setShowUserMgmt}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><UserCog className="h-5 w-5" /> User Management</DialogTitle><DialogDescription>Manage system users (Admin only)</DialogDescription></DialogHeader>
            <div className="space-y-4 mt-2">
              <Button onClick={() => { setNewUsername(""); setNewUserPassword(""); setNewUserEmail(""); setNewUserRole("viewer"); setNewUserRegion("all"); setShowAddUser(true); }} className="bg-blue-600 hover:bg-blue-700 text-white"><Plus className="h-4 w-4 mr-1.5" />Add User</Button>
              <Separator />
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <th className="px-3 py-2 text-left text-xs text-slate-500">Username</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-500">Email</th>
                  <th className="px-3 py-2 text-center text-xs text-slate-500">Role</th>
                  <th className="px-3 py-2 text-center text-xs text-slate-500">Region</th>
                  <th className="px-3 py-2 text-center text-xs text-slate-500">Actions</th>
                </tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className={`border-b border-slate-100 dark:border-slate-800 hover:bg-emerald-50/80 dark:hover:bg-emerald-950/20 transition-colors ${u.id % 2 === 0 ? "bg-slate-50/50 dark:bg-slate-900/30" : ""}`}>
                      <td className="px-3 py-2 font-medium text-sm">{u.username}{u.id === user?.id && <span className="ml-1 text-[10px] text-blue-500">(you)</span>}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{u.email || "-"}</td>
                      <td className="px-3 py-2 text-center"><Badge className={`text-[10px] text-white border-0 ${u.role === "super_admin" ? "bg-purple-700" : u.role === "admin" ? "bg-red-500" : u.role === "editor" ? "bg-amber-500" : u.role === "connection" ? "bg-teal-500" : "bg-slate-500"}`}>{u.role}</Badge></td>
                      <td className="px-3 py-2 text-center"><span className="text-xs text-slate-600 dark:text-slate-300">{REGIONS[u.region] || u.region}</span></td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-blue-600 hover:text-blue-800" onClick={() => { setEditingUser(u); setEditUserEmail(u.email || ""); setEditUserRole(u.role); setEditUserRegion(u.region || "all"); }}>Edit</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-purple-600 hover:text-purple-800" onClick={() => { setResetPwUserId(u.id); setResetPwNewPassword(""); setShowResetPw(true); }}>Reset PW</Button>
                          {u.id !== user?.id && <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-800" onClick={() => setDeletingUser(u)}>Delete</Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ===== ADD USER MODAL ===== */}
        <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Add New User</DialogTitle></DialogHeader>
            <div className="space-y-3 mt-2">
              <div><Label className="text-xs">Username</Label><Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className="mt-1" /></div>
              <div><Label className="text-xs">Password</Label><Input type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} className="mt-1" /></div>
              <div><Label className="text-xs">Email (optional)</Label><Input type="email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} className="mt-1" /></div>
              <div><Label className="text-xs">Role</Label><Select value={newUserRole} onValueChange={setNewUserRole}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="editor">Editor</SelectItem><SelectItem value="viewer">Viewer</SelectItem><SelectItem value="connection">Connection Team</SelectItem></SelectContent></Select></div>
              <div><Label className="text-xs">Region</Label><Select value={newUserRegion} onValueChange={setNewUserRegion}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(REGIONS).map(([key, label]) => (<SelectItem key={key} value={key}>{label}</SelectItem>))}</SelectContent></Select></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setShowAddUser(false)}>Cancel</Button><Button onClick={addUser} className="bg-blue-600 hover:bg-blue-700 text-white">Create User</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== EDIT USER MODAL ===== */}
        <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Edit User: {editingUser?.username}</DialogTitle></DialogHeader>
            <div className="space-y-3 mt-2">
              <div><Label className="text-xs">Email</Label><Input value={editUserEmail} onChange={(e) => setEditUserEmail(e.target.value)} className="mt-1" /></div>
              <div><Label className="text-xs">Role</Label><Select value={editUserRole} onValueChange={setEditUserRole}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="editor">Editor</SelectItem><SelectItem value="viewer">Viewer</SelectItem><SelectItem value="connection">Connection Team</SelectItem></SelectContent></Select></div>
              <div><Label className="text-xs">Region</Label><Select value={editUserRegion} onValueChange={setEditUserRegion}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(REGIONS).map(([key, label]) => (<SelectItem key={key} value={key}>{label}</SelectItem>))}</SelectContent></Select></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button><Button onClick={saveUserEdit} className="bg-blue-600 hover:bg-blue-700 text-white">Save Changes</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== RESET PASSWORD MODAL ===== */}
        <Dialog open={showResetPw} onOpenChange={setShowResetPw}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Reset Password for {users.find((u) => u.id === resetPwUserId)?.username}</DialogTitle></DialogHeader>
            <div className="space-y-3 mt-2">
              <div><Label className="text-xs">New Password</Label><Input type="password" value={resetPwNewPassword} onChange={(e) => setResetPwNewPassword(e.target.value)} className="mt-1" /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setShowResetPw(false)}>Cancel</Button><Button onClick={resetUserPassword} className="bg-blue-600 hover:bg-blue-700 text-white">Reset Password</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== DELETE CONFIRM MODAL ===== */}
        <Dialog open={!!deletingUser} onOpenChange={() => setDeletingUser(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Delete User</DialogTitle></DialogHeader>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">Are you sure you want to delete <strong>{deletingUser?.username}</strong>? This action cannot be undone.</p>
            <DialogFooter><Button variant="outline" onClick={() => setDeletingUser(null)}>Cancel</Button><Button onClick={() => removeUser(deletingUser!)} className="bg-red-600 hover:bg-red-700 text-white">Delete User</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== ADD CONNECTION TEAM MODAL ===== */}
        <Dialog open={showAddConnection} onOpenChange={setShowAddConnection}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> Assign Connection Team</DialogTitle><DialogDescription>Assign a Connection Team member for a specific week</DialogDescription></DialogHeader>
            <div className="space-y-3 mt-2">
              <div><Label className="text-xs">Week Start</Label>
                <Input type="date" value={connWeekStart} onChange={(e) => setConnWeekStart(e.target.value)} className="mt-1" />
              </div>
              <div><Label className="text-xs">Week End</Label>
                <Input type="date" value={connWeekEnd} onChange={(e) => setConnWeekEnd(e.target.value)} className="mt-1" />
              </div>
              <div><Label className="text-xs">Employee</Label>
                <Select value={connEmpIdx} onValueChange={setConnEmpIdx}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{connectionTeamEmps.map((emp, idx) => (
                    <SelectItem key={emp.id} value={String(idx)}>{emp.name} ({emp.hrid})</SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>
              {connEmpIdx !== "" && connWeekStart && connWeekEnd && (() => {
                if (settings) {
                  const totalHrs = calcConnectionWeekHours(connWeekStart, connWeekEnd);
                  return (
                    <div className="bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-teal-700 dark:text-teal-300">
                        <Clock className="h-4 w-4" />
                        Total Week Hours: {totalHrs.toFixed(1)}h
                      </div>
                      <p className="text-xs text-teal-600 dark:text-teal-400 mt-1">
                        Working all 7 days: {formatDateDisplay(connWeekStart)} → {formatDateDisplay(connWeekEnd)}
                      </p>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddConnection(false)}>Cancel</Button>
              {connWeekStart && connWeekEnd && (() => {
                const existingConn = connectionTeam.find(ct => ct.weekStart === connWeekStart);
                return existingConn ? (
                  <Button onClick={() => { setConnReplaceFrom(existingConn.empName); setConnReplaceTo(""); setConnReplaceHours(""); setShowAddConnection(false); setShowConnReplace(true); }} className="bg-amber-600 hover:bg-amber-700 text-white">Replace (Current: {existingConn.empName})</Button>
                ) : (
                  <Button onClick={addConnectionPerson} className="bg-teal-600 hover:bg-teal-700 text-white">Assign</Button>
                );
              })()}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== TRANSFER CONNECTION HOURS MODAL ===== */}
        <Dialog open={showConnReplace} onOpenChange={setShowConnReplace}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowLeftRight className="h-5 w-5" /> Replace Connection Team</DialogTitle><DialogDescription>Replace a Connection Team member for a specific week</DialogDescription></DialogHeader>
            <div className="space-y-3 mt-2">
              <div><Label className="text-xs">Week Start (existing assignment)</Label>
                <Select value={connWeekStart} onValueChange={(v) => {
                  setConnWeekStart(v);
                  const existing = connectionTeam.find(ct => ct.weekStart === v);
                  if (existing) {
                    setConnReplaceFrom(existing.empName);
                    setConnReplaceHours(String(calcConnectionWeekHours(existing.weekStart, existing.weekEnd)));
                  } else {
                    setConnReplaceFrom("");
                    setConnReplaceHours("");
                  }
                  setConnReplaceTo("");
                }}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select week" /></SelectTrigger>
                  <SelectContent>
                    {filteredConnectionTeam.map((ct) => (
                      <SelectItem key={ct.id} value={ct.weekStart}>{formatDateDisplay(ct.weekStart)} → {formatDateDisplay(ct.weekEnd)} ({ct.empName})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filteredConnectionTeam.length === 0 && (
                  <p className="text-xs text-slate-400 mt-1 italic">No Connection Team assignments found.</p>
                )}
              </div>
              {connReplaceFrom && connWeekStart && (() => {
                const existing = connectionTeam.find(ct => ct.weekStart === connWeekStart);
                if (existing) {
                  return (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                      <div className="text-xs font-medium text-amber-700 dark:text-amber-300">Current Connection Team Member:</div>
                      <div className="text-sm font-semibold text-amber-800 dark:text-amber-200 mt-0.5">{existing.empName} <span className="text-xs font-normal text-amber-600">({Number(calcConnectionWeekHours(existing.weekStart, existing.weekEnd)).toFixed(1)}h)</span></div>
                    </div>
                  );
                }
                return null;
              })()}
              <div><Label className="text-xs">Transfer to Employee</Label>
                <Select value={connReplaceTo} onValueChange={setConnReplaceTo}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select target employee" /></SelectTrigger>
                  <SelectContent>{connectionTeamEmps.filter((e) => e.name !== connReplaceFrom).map((emp) => (
                    <SelectItem key={emp.id} value={emp.name}>{emp.name} ({emp.hrid})</SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>
              {connReplaceTo && connReplaceHours && (
                <div className="bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-teal-700 dark:text-teal-300">
                    <Clock className="h-4 w-4" />
                    Transfer: {Number(connReplaceHours).toFixed(1)}h from {connReplaceFrom} → {connReplaceTo}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter><Button variant="outline" onClick={() => { setShowConnReplace(false); setConnWeekStart(""); }}>Cancel</Button><Button onClick={replaceConnectionPerson} disabled={!connReplaceTo || !connReplaceFrom} className="bg-teal-600 hover:bg-teal-700 text-white">Transfer &amp; Replace</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== ADD REGION ROTATION MODAL ===== */}
        <Dialog open={showAddRotation} onOpenChange={setShowAddRotation}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5" /> Add Region Rotation</DialogTitle><DialogDescription>Add a region rotation entry</DialogDescription></DialogHeader>
            <div className="space-y-3 mt-2">
              <div><Label className="text-xs">Region</Label>
                <Select value={rotRegion} onValueChange={setRotRegion}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(REGIONS).filter(([k]) => k !== "all").map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Target Area</Label><Input value={rotTargetArea} onChange={(e) => setRotTargetArea(e.target.value)} className="mt-1" placeholder="e.g., New Branch" /></div>
              <div><Label className="text-xs">Week</Label>
                <Select value={String(rotWeekIdx)} onValueChange={(v) => setRotWeekIdx(Number(v))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {buildWeekOptions().map((w, i) => (
                      <SelectItem key={i} value={String(i)}>{formatDateDisplay(w.weekStart)} → {formatDateDisplay(w.weekEnd)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Notes (optional)</Label><Input value={rotNotes} onChange={(e) => setRotNotes(e.target.value)} className="mt-1" placeholder="Any notes..." /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setShowAddRotation(false)}>Cancel</Button><Button onClick={addRotation} className="bg-orange-600 hover:bg-orange-700 text-white">Add Rotation</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== ADD CONNECTION ASSIGNMENT MODAL ===== */}
        <Dialog open={showAddAssignment} onOpenChange={setShowAddAssignment}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> New Connection Assignment</DialogTitle><DialogDescription>Assign an employee to cover a region for a week</DialogDescription></DialogHeader>
            <div className="space-y-3 mt-2">
              <div><Label className="text-xs">Employee</Label>
                <Select value={assignEmpId} onValueChange={setAssignEmpId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{connectionTeamEmps.map((emp) => (
                    <SelectItem key={emp.id} value={String(emp.id)}>{emp.name} ({emp.hrid})</SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Region Covered</Label>
                <Select value={assignRegionCovered} onValueChange={setAssignRegionCovered}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select region" /></SelectTrigger>
                  <SelectContent>{Object.entries(REGIONS).filter(([k]) => k !== "all").map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Week</Label>
                <Select value={String(assignWeekIdx)} onValueChange={(v) => setAssignWeekIdx(Number(v))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{buildWeekOptions().map((w, i) => (
                    <SelectItem key={i} value={String(i)}>{formatDateDisplay(w.weekStart)} → {formatDateDisplay(w.weekEnd)}</SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Split</Label>
                <Select value={assignSplit} onValueChange={(v) => setAssignSplit(v as "full" | "first_half" | "second_half")}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full Week (7 days)</SelectItem>
                    <SelectItem value="first_half">First Half (Fri-Sun)</SelectItem>
                    <SelectItem value="second_half">Second Half (Mon-Thu)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-slate-400 mt-1">
                  {assignSplit === "full" && "Assigns employee for all 7 days of the week"}
                  {assignSplit === "first_half" && "Assigns for Friday, Saturday, Sunday only"}
                  {assignSplit === "second_half" && "Assigns for Monday, Tuesday, Wednesday, Thursday only"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Hours (daily)</Label><Input type="number" step="0.5" min="0" value={assignHours} onChange={(e) => setAssignHours(e.target.value)} className="mt-1" placeholder="e.g. 5" /></div>
                <div><Label className="text-xs">Override Hours</Label><Input type="number" step="0.5" min="0" value={assignOverrideHours} onChange={(e) => setAssignOverrideHours(e.target.value)} className="mt-1" placeholder="0 = use default" /></div>
              </div>
              <p className="text-[10px] text-slate-400">Override hours take priority over default hours if set.</p>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setShowAddAssignment(false)}>Cancel</Button><Button onClick={addAssignment} disabled={!assignEmpId || !assignRegionCovered} className="bg-violet-600 hover:bg-violet-700 text-white">Assign</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        {/* FOOTER */}
        <footer className="mt-auto">
          <div className="h-px bg-gradient-to-r from-transparent via-slate-300 dark:via-slate-700 to-transparent" />
          <div className="max-w-7xl mx-auto px-4 py-4 text-center">
            <p className="text-xs text-slate-400 dark:text-slate-500">IT Helpdesk Shift Scheduler &copy; {new Date().getFullYear()}</p>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
