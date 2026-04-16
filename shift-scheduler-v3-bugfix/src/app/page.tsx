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
  Calendar, Users, Settings, Plus, Trash2, RefreshCw,
  CalendarDays, Clock, Sun, Moon, X, ArrowLeftRight, AlertTriangle,
  CheckCircle, Info, ChevronDown, ChevronUp, FileSpreadsheet, BarChart3,
  Sparkles, Eye, EyeOff, LogOut, User, Shield, KeyRound, Lock, HeadphonesIcon,
  Pencil, Download, UserCog, Link2, MapPin, RotateCcw, ClipboardList
} from "lucide-react";
import { computeLocalStats, computeOffWeeks, recalcScheduleHours } from "@/lib/scheduler";

// ===== Types =====
interface Employee {
  id: number;
  name: string;
  hrid: string;
  active: boolean;
  region: string;
}

interface ShiftConfig {
  start: string;
  end: string;
  hours: number;
}

interface SettingsData {
  shifts: Record<string, ShiftConfig>;
  weekStart: string;
  holidays: string[];
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
  cairo: "Cairo (القاهرة)",
  delta: "Delta (الدلتا)",
  upper_egypt: "Upper Egypt (الصعيد)",
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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#0F172A] to-[#1D4ED8] shadow-lg mb-4">
            <HeadphonesIcon className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            IT Helpdesk Shift Scheduler
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Sign in to access the scheduling system
          </p>
        </div>
        <Card className="shadow-lg border-slate-200 dark:border-slate-800">
          <CardContent className="p-6">
            <form onSubmit={(e) => { e.preventDefault(); onLogin(); }} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium text-slate-700 dark:text-slate-300">Username</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input id="username" type="text" placeholder="Enter your username" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} className="pl-10 h-11" autoComplete="username" required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium text-slate-700 dark:text-slate-300">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input id="password" type={showPassword ? "text" : "password"} placeholder="Enter your password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className="pl-10 pr-10 h-11" autoComplete="current-password" required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors" tabIndex={-1}>
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
              <Button type="submit" disabled={loginLoading} className="w-full h-11 bg-gradient-to-r from-[#0F172A] to-[#1D4ED8] hover:from-[#0F172A]/90 hover:to-[#1D4ED8]/90 text-white font-semibold text-sm">
                {loginLoading ? <span className="flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Signing in...</span> : "Sign In"}
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
  const [selectedRegion, setSelectedRegion] = useState<string>("all");

  // Modals
  const [showSettings, setShowSettings] = useState(false);
  const [showEmployees, setShowEmployees] = useState(false);
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
  const [newEmpRegion, setNewEmpRegion] = useState("all");
  const [editEmpRegion, setEditEmpRegion] = useState("all");

  // Add shift
  const [addShiftDate, setAddShiftDate] = useState("");
  const [addShiftEmp, setAddShiftEmp] = useState("");

  // Settings editing
  const [editSettings, setEditSettings] = useState<SettingsData | null>(null);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [newDayHourDate, setNewDayHourDate] = useState("");
  const [newDayHourValue, setNewDayHourValue] = useState("");

  // Export
  const [exportSelectedIds, setExportSelectedIds] = useState<number[]>([]);
  const [exportDateFrom, setExportDateFrom] = useState("");
  const [exportDateTo, setExportDateTo] = useState("");
  const [exportRegion, setExportRegion] = useState<string>("all");
  const [exporting, setExporting] = useState(false);

  // User management
  const [users, setUsers] = useState<UserMgmt[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("viewer");
  const [newUserRegion, setNewUserRegion] = useState("all");
  const [editingUser, setEditingUser] = useState<UserMgmt | null>(null);
  const [editUserEmail, setEditUserEmail] = useState("");
  const [editUserRole, setEditUserRole] = useState("viewer");
  const [editUserRegion, setEditUserRegion] = useState("all");
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetPwUserId, setResetPwUserId] = useState("");
  const [resetPwNewPassword, setResetPwNewPassword] = useState("");
  const [deletingUser, setDeletingUser] = useState<UserMgmt | null>(null);

  // Connection team
  const [connectionTeam, setConnectionTeam] = useState<ConnectionTeamEntry[]>([]);
  const [showAddConnection, setShowAddConnection] = useState(false);
  const [connWeekIdx, setConnWeekIdx] = useState(0);
  const [connEmpIdx, setConnEmpIdx] = useState("");

  // Connection team replace/transfer
  const [showConnReplace, setShowConnReplace] = useState(false);
  const [connReplaceFrom, setConnReplaceFrom] = useState("");
  const [connReplaceTo, setConnReplaceTo] = useState("");
  const [connReplaceWeekIdx, setConnReplaceWeekIdx] = useState(0);
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

  // Role helpers
  const canEdit = user && (user.role === "admin" || user.role === "editor");
  const canAdmin = user && user.role === "admin";

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
          dayHours: settRes.dayHours || {},
        });
      } else {
        setSettings({
          shifts: { Weekday: { start: "05:00 PM", end: "10:00 PM", hours: 5 }, Thursday: { start: "05:00 PM", end: "10:00 PM", hours: 5 }, Friday: { start: "01:00 PM", end: "10:00 PM", hours: 9 }, Saturday: { start: "01:00 PM", end: "10:00 PM", hours: 9 }, Holiday: { start: "10:00 AM", end: "10:00 PM", hours: 12 } },
          weekStart: "Friday", holidays: [], summerTime: false,
          summerShifts: { Weekday: { start: "05:00 PM", end: "11:00 PM", hours: 6 }, Thursday: { start: "05:00 PM", end: "11:00 PM", hours: 6 }, Friday: { start: "01:00 PM", end: "11:00 PM", hours: 10 }, Saturday: { start: "01:00 PM", end: "11:00 PM", hours: 10 } },
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
      const regionParam = selectedRegion !== "all" ? `&region=${selectedRegion}` : "";
      const res = await authFetch(`/api/reports?month=${selectedMonth}${regionParam}`);
      const data = await res.json();
      if (data.balance) setBalance(data.balance);
    } catch {
      // ignore
    }
  }, [authFetch, selectedMonth, selectedRegion]);

  const fetchScheduleEntries = useCallback(async () => {
    try {
      const res = await authFetch(`/api/schedule?month=${selectedMonth}`);
      if (res.ok) {
        const data = await res.json();
        if (data.entries) setEntries(data.entries);
        if (data.generatedMonths) setGeneratedMonths(data.generatedMonths);
      }
    } catch {
      // Failed to fetch entries
    }
  }, [authFetch, selectedMonth]);

  const fetchConnectionTeam = useCallback(async () => {
    try {
      const res = await authFetch(`/api/connection-team?month=${selectedMonth}`);
      if (res.ok) {
        const data = await res.json();
        setConnectionTeam(data.entries || []);
      }
    } catch {
      // ignore
    }
  }, [authFetch, selectedMonth]);

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

  const fetchConnAssignments = useCallback(async () => {
    try {
      const weekParam = buildWeekOptions().length > 0 ? `&week=${buildWeekOptions()[0].weekStart}` : "";
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
            if (data.user.region && data.user.region !== "all") {
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
      fetchAllData();
    }
  }, [isAuthenticated, fetchAllData]);

  useEffect(() => {
    if (isAuthenticated && !dataLoading) {
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
        const userData = { id: data.id, username: data.username, role: data.role, email: data.email, region: data.region || "all" };
        localStorage.setItem("auth_token", data.token);
        localStorage.setItem("auth_user", JSON.stringify(userData));
        setAuthToken(data.token);
        setUser(userData);
        setIsAuthenticated(true);
        if (data.region && data.region !== "all") {
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
      const regionParam = selectedRegion !== "all" ? `&region=${selectedRegion}` : "";
      const res = await authFetch(`/api/schedule?month=${selectedMonth}${regionParam}`, { method: "DELETE" });
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
    const newEntries = entries.map((e) => e.date === date ? { ...e, isHoliday: newHoliday } : e);
    setEntries(newEntries);
    const newHolidays = newHoliday ? [...new Set([...settings.holidays, date])].sort() : settings.holidays.filter((h) => h !== date);
    const newSettings = { ...settings, holidays: newHolidays };
    try {
      await authFetch("/api/settings", { method: "POST", body: JSON.stringify(newSettings) });
      setSettings(newSettings);
      toast({ title: "Updated", description: `${date} ${newHoliday ? "marked as holiday" : "unmarked as holiday"}` });
    } catch {
      toast({ title: "Error", description: "Failed to update holiday", variant: "destructive" });
    }
  };

  const deleteEntry = async (date: string) => {
    if (!canEdit) return;
    try {
      const regionParam = selectedRegion !== "all" ? `?region=${selectedRegion}` : "";
      const res = await authFetch(`/api/schedule/${date}${regionParam}`, { method: "DELETE" });
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
      const res = await authFetch("/api/employees", { method: "POST", body: JSON.stringify({ name: newEmpName, hrid: newEmpHrid, active: true, region: newEmpRegion }) });
      if (res.ok) {
        const data = await res.json();
        setEmployees([...employees, data.employee]);
        setNewEmpName(""); setNewEmpHrid(""); setNewEmpRegion("all");
        toast({ title: "Added", description: `${newEmpName} added to تيم الكونكشن` });
      }
    } catch {
      toast({ title: "Error", description: "Failed to add employee", variant: "destructive" });
    }
  };

  const editEmployee = async (id: number, name: string, hrid: string) => {
    if (!name || !hrid) return;
    try {
      const res = await authFetch("/api/employees", { method: "PUT", body: JSON.stringify({ id, name, hrid, region: editEmpRegion }) });
      if (res.ok) {
        setEmployees(employees.map((e) => e.id === id ? { ...e, name: name.trim(), hrid: hrid.trim(), region: editEmpRegion } : e));
        setEditingEmpId(null);
        setEditEmpName("");
        setEditEmpHrid("");
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

  // ===== Export =====
  const exportExcel = async () => {
    setExporting(true);
    try {
      const res = await authFetch("/api/export", {
        method: "POST",
        body: JSON.stringify({ month: selectedMonth, selectedEmployeeIds: exportSelectedIds.length > 0 ? exportSelectedIds : undefined, dateFrom: exportDateFrom || undefined, dateTo: exportDateTo || undefined, region: exportRegion || selectedRegion }),
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
      a.download = `IT_Helpdesk_Schedule_${selectedMonth}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Exporting", description: "Excel file downloaded" });
      setShowExport(false);
    } catch {
      toast({ title: "Error", description: "Failed to export", variant: "destructive" });
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
    try {
      // Use only region-filtered active employees for Connection Team
      const activeEmps = regionActiveEmps;
      const emp = activeEmps[Number(connEmpIdx)];
      if (!emp) return;

      // Build week dates for selected month
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
        if (weeks.length <= connWeekIdx) weeks.push({ weekStart: wsStr, weekEnd: weStr });
        d.setDate(d.getDate() + 7);
      }
      if (connWeekIdx >= weeks.length) {
        toast({ title: "Error", description: "Invalid week selected", variant: "destructive" });
        return;
      }
      const { weekStart, weekEnd } = weeks[connWeekIdx];

      const res = await authFetch("/api/connection-team", {
        method: "POST",
        body: JSON.stringify({ weekStart, weekEnd, empIdx: Number(connEmpIdx), empName: emp.name, empHrid: emp.hrid, monthKey: selectedMonth, region: selectedRegion }),
      });
      if (res.ok) {
        toast({ title: "Added", description: `Connection Team member assigned for ${weekStart} to ${weekEnd}` });
        setShowAddConnection(false);
        setConnWeekIdx(0);
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

  // ===== Connection Team Replace / Transfer =====
  const replaceConnectionPerson = async () => {
    if (!connReplaceTo) {
      toast({ title: "Error", description: "Please select a target employee", variant: "destructive" });
      return;
    }
    const weeks = buildWeekOptions();
    const week = weeks[connReplaceWeekIdx];
    if (!week) return;

    try {
      // Find and delete existing entry for this week
      const existingEntry = connectionTeam.find(ct => ct.weekStart === week.weekStart);
      if (existingEntry) {
        await authFetch(`/api/connection-team?id=${existingEntry.id}`, { method: "DELETE" });
      }

      // Create new entry with target employee (region-filtered)
      const activeEmps = regionActiveEmps;
      const empIdx = activeEmps.findIndex(e => e.name === connReplaceTo);
      if (empIdx < 0) return;
      const targetEmp = activeEmps[empIdx];

      const res = await authFetch("/api/connection-team", {
        method: "POST",
        body: JSON.stringify({
          weekStart: week.weekStart,
          weekEnd: week.weekEnd,
          empIdx,
          empName: targetEmp.name,
          empHrid: targetEmp.hrid,
          monthKey: selectedMonth,
          region: selectedRegion,
        }),
      });

      if (res.ok) {
        toast({ title: "Replaced", description: `Connection Team member replaced for week ${formatDateDisplay(week.weekStart)} → ${formatDateDisplay(week.weekEnd)}` });
        setShowConnReplace(false);
        setConnReplaceFrom("");
        setConnReplaceTo("");
        setConnReplaceWeekIdx(0);
        setConnReplaceHours("");
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
  const regionActiveEmps = employees.filter((e) => e.active && (selectedRegion === "all" || e.region === selectedRegion));
  const connectionEmpSet = new Set(connectionTeam.filter((ct) => {
    if (selectedRegion === "all") return true;
    return ct.region === selectedRegion;
  }).map((c) => `${c.empName}-${c.weekStart}`));

  // Build connection team lookup by week start date (STRICT region filter)
  const connectionByWeek = new Map<string, ConnectionTeamEntry>();
  for (const ct of connectionTeam) {
    if (selectedRegion === "all" || ct.region === selectedRegion) {
      connectionByWeek.set(ct.weekStart, ct);
    }
  }

  // Calculate connection team hours for each entry (full week hours)
  const calcConnectionWeekHours = (weekStart: string, weekEnd: string): number => {
    if (!settings) return 0;
    let total = 0;
    const start = new Date(weekStart + "T00:00:00");
    const end = new Date(weekEnd + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      // Check dayHours override first
      if (settings.dayHours && settings.dayHours[dateStr] !== undefined) {
        total += settings.dayHours[dateStr];
      } else {
        const jsDay = d.getDay();
        let dayType = "Weekday";
        if (jsDay === 6) dayType = "Saturday";
        else if (jsDay === 5) dayType = "Friday";
        else if (jsDay === 4) dayType = "Thursday";
        const isHol = settings.holidays?.includes(dateStr) || false;
        if (isHol && settings.shifts["Holiday"]) {
          total += settings.shifts["Holiday"].hours;
        } else if (settings.summerTime && settings.summerShifts?.[dayType]) {
          total += settings.summerShifts[dayType].hours;
        } else {
          total += settings.shifts[dayType]?.hours || settings.shifts["Weekday"]?.hours || 5;
        }
      }
    }
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
  const totalDays = filteredEntries.length;
  const totalHolidays = filteredEntries.filter((e) => e.isHoliday).length;
  const totalWeeks = weekGroups.length;

  const roleColor = user?.role === "admin" ? "bg-red-500" : user?.role === "editor" ? "bg-amber-500" : "bg-slate-500";

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
        <header className="bg-[#0F172A] text-white sticky top-0 z-50 shadow-lg">
          <div className="max-w-7xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <CalendarDays className="h-6 w-6 text-blue-400" />
                <h1 className="text-lg sm:text-xl font-bold tracking-tight">IT Helpdesk Shift Scheduler</h1>
                {balance && (
                  <Badge variant="outline" className={`ml-2 hidden sm:inline-flex ${balance.status === "green" ? "border-green-500 text-green-400 bg-green-500/10" : balance.status === "yellow" ? "border-yellow-500 text-yellow-400 bg-yellow-500/10" : "border-red-500 text-red-400 bg-red-500/10"}`}>
                    <CheckCircle className="h-3 w-3 mr-1" />{balance.variance.toFixed(1)}h variance
                  </Badge>
                )}
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
                      <Button variant="ghost" size="icon" className="text-slate-300 hover:text-white hover:bg-slate-700" onClick={() => { setEditSettings(settings ? JSON.parse(JSON.stringify(settings)) : undefined); setNewHolidayDate(""); setNewDayHourDate(""); setNewDayHourValue(""); setShowSettings(true); }}><Settings className="h-5 w-5" /></Button>
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
              {canEdit && (
                <>
                  <Button onClick={generateMonth} disabled={generating} className="bg-blue-600 hover:bg-blue-700 text-white"><Sparkles className="h-4 w-4 mr-1.5" />{generating ? "Generating..." : "Generate Month"}</Button>
                  <Button onClick={generateWeek} disabled={generating} variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50"><Calendar className="h-4 w-4 mr-1.5" />This Week</Button>
                  <Button onClick={() => { setAddShiftDate(""); setAddShiftEmp(""); setShowAddShift(true); }} variant="outline"><Plus className="h-4 w-4 mr-1.5" />Add Shift</Button>
                  <Button onClick={() => { setSwapMode(!swapMode); setSwapFirst(null); }} variant={swapMode ? "default" : "outline"} className={swapMode ? "bg-purple-600 text-white" : "border-purple-300 text-purple-700"}><ArrowLeftRight className="h-4 w-4 mr-1.5" />{swapMode ? "Cancel Swap" : "Swap Mode"}</Button>
                  <Button onClick={() => { setExportSelectedIds([]); setExportDateFrom(""); setExportDateTo(""); setExportRegion(selectedRegion); setShowExport(true); }} disabled={filteredEntries.length === 0} variant="outline" className="border-emerald-300 text-emerald-700"><FileSpreadsheet className="h-4 w-4 mr-1.5" />Export Excel</Button>
                </>
              )}
              {canAdmin && (
                <Button onClick={clearSchedule} disabled={filteredEntries.length === 0 || generating} variant="outline" className="border-red-300 text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4 mr-1.5" />Clear</Button>
              )}
              <div className="ml-auto">
                <Select value={selectedRegion} onValueChange={setSelectedRegion} disabled={user?.role !== "admin" && user?.region !== "all"}>
                  <SelectTrigger className="w-[180px] h-9 text-xs"><MapPin className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(REGIONS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* STATS ROW */}
        <div className="max-w-7xl mx-auto w-full px-4 mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="shadow-sm"><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{totalWeeks}</div><div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Weeks</div></CardContent></Card>
            <Card className="shadow-sm"><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{totalDays}</div><div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Work Days</div></CardContent></Card>
            <Card className="shadow-sm"><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-amber-600">{totalHolidays}</div><div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Holidays</div></CardContent></Card>
            <Card className="shadow-sm"><CardContent className="p-4 text-center"><div className="text-2xl font-bold text-blue-600">{totalHours.toFixed(1)}h</div><div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Total Hours</div></CardContent></Card>
          </div>
        </div>

        {/* SWAP BANNER */}
        {swapMode && canEdit && (
          <div className="max-w-7xl mx-auto w-full px-4 mt-3">
            <div className="bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-lg p-3 flex items-center gap-3">
              <ArrowLeftRight className="h-5 w-5 text-purple-600 flex-shrink-0" />
              <span className="text-sm text-purple-800 dark:text-purple-200">{swapFirst ? `Selected: ${swapFirst.name}. Click another employee to swap.` : "Click an employee name to start swapping."}</span>
              <Button size="sm" variant="ghost" onClick={() => { setSwapMode(false); setSwapFirst(null); }} className="ml-auto text-purple-600"><X className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        {/* CONNECTION TEAM TOOLBAR BUTTONS */}
        {canEdit && (
          <div className="max-w-7xl mx-auto w-full px-4 mt-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" className="border-teal-300 text-teal-700 hover:bg-teal-50 h-8" onClick={() => { setConnWeekIdx(0); setConnEmpIdx(""); setShowAddConnection(true); }}><Plus className="h-3.5 w-3.5 mr-1" />تيم الكونكشن</Button>
              {connectionTeam.length > 0 && (
                <Button size="sm" variant="outline" className="border-teal-300 text-teal-700 hover:bg-teal-50 h-8" onClick={() => { setConnReplaceFrom(""); setConnReplaceTo(""); setConnReplaceWeekIdx(0); setConnReplaceHours(""); setShowConnReplace(true); }}><ArrowLeftRight className="h-3.5 w-3.5 mr-1" />تبديل تيم الكونكشن</Button>
              )}
            </div>
          </div>
        )}

        {/* REGION ROTATION SECTION */}
        {regionRotations.length > 0 && (
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
                      <tr key={rr.id} className="border-b border-slate-100 dark:border-slate-800">
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

        {/* CONNECTION ASSIGNMENTS SECTION */}
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
                  {connAssignments.length === 0 ? (
                    <tr><td colSpan={canEdit ? 7 : 6} className="px-3 py-6 text-center text-xs text-slate-400 italic">No connection assignments for this month</td></tr>
                  ) : connAssignments.map((a) => {
                    const emp = employees.find(e => e.id === a.employeeId);
                    return (
                      <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800">
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

        {/* SCHEDULE TABLE */}
        <main className="max-w-7xl mx-auto w-full px-4 mt-4 mb-8 flex-1">
          {dataLoading ? (
            <div className="flex items-center justify-center py-20"><div className="flex flex-col items-center gap-3"><RefreshCw className="h-8 w-8 text-slate-400 animate-spin" /><span className="text-slate-500 text-sm">Loading schedule...</span></div></div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <CalendarDays className="h-16 w-16 text-slate-300 dark:text-slate-600 mb-4" />
              <h2 className="text-xl font-semibold text-slate-600 dark:text-slate-300 mb-2">No Schedule Generated</h2>
              <p className="text-slate-400 dark:text-slate-500 mb-6 max-w-md">Click &quot;Generate Month&quot; to create a balanced shift schedule for {MONTHS[Number(selectedMonth.split("-")[1]) - 1]} {selectedYear}</p>
              {canEdit && <Button onClick={generateMonth} disabled={generating} className="bg-blue-600 hover:bg-blue-700 text-white"><Sparkles className="h-4 w-4 mr-1.5" />Generate Schedule</Button>}
            </div>
          ) : (
            <div className="space-y-3">
              {weekGroups.map((week) => {
                const isCollapsed = collapsedWeeks.has(week.key);
                const offPerson = week.entries[0]?.offPerson || "N/A";
                const connPerson = connectionByWeek.get(week.key);
                return (
                  <Card key={week.key} className="shadow-sm overflow-hidden">
                    <div className="bg-gradient-to-r from-[#1B2A4A] to-[#1D4ED8] text-white px-4 py-2.5 cursor-pointer flex items-center justify-between" onClick={() => { const next = new Set(collapsedWeeks); if (isCollapsed) next.delete(week.key); else next.add(week.key); setCollapsedWeeks(next); }}>
                      <div className="flex items-center gap-3 flex-wrap">{isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}<span className="font-semibold text-sm">{week.label}</span></div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {connPerson && (() => {
                          const connHrs = calcConnectionWeekHours(connPerson.weekStart, connPerson.weekEnd);
                          return <Badge className="bg-teal-500/90 text-white border-0 text-xs"><Link2 className="h-2.5 w-2.5 mr-0.5" />تيم الكونكشن: {connPerson.empName} ({connHrs.toFixed(1)}h)</Badge>;
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
                            <span className="font-semibold text-teal-800 dark:text-teal-200">تيم الكونكشن: {connPerson.empName} ({connPerson.empHrid}) | {calcConnectionWeekHours(connPerson.weekStart, connPerson.weekEnd).toFixed(1)}h</span>
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

        {/* ===== SETTINGS MODAL ===== */}
        <Dialog open={showSettings} onOpenChange={setShowSettings}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings className="h-5 w-5" /> Shift Settings</DialogTitle><DialogDescription>Configure shift times, holidays, and scheduling rules</DialogDescription></DialogHeader>
            {editSettings && (
              <div className="space-y-5 mt-2">
                <div className="space-y-3"><h3 className="font-semibold text-sm text-slate-700 dark:text-slate-200">Shift Times</h3>
                  {Object.entries(editSettings.shifts).map(([key, shift]) => (
                    <div key={key} className="grid grid-cols-3 gap-2 items-center">
                      <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">{key === "Weekday" ? "Weekday (Sun-Wed)" : key === "Holiday" ? "Holiday (Official Off)" : key}</Label>
                      <Input value={shift.start} onChange={(e) => { editSettings.shifts[key].start = e.target.value; setEditSettings({ ...editSettings }); }} className="h-8 text-xs" placeholder="05:00 PM" />
                      <Input value={shift.end} onChange={(e) => { editSettings.shifts[key].end = e.target.value; setEditSettings({ ...editSettings }); }} className="h-8 text-xs" placeholder="10:00 PM" />
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="space-y-2"><h3 className="font-semibold text-sm text-slate-700 dark:text-slate-200">Shift Hours</h3>
                  {Object.entries(editSettings.shifts).map(([key, shift]) => (
                    <div key={key} className="flex items-center justify-between">
                      <Label className="text-xs text-slate-600 dark:text-slate-300">{key === "Weekday" ? "Weekday (Sun-Wed)" : key === "Holiday" ? "Holiday (Official Off)" : key}</Label>
                      <Input type="number" value={shift.hours} onChange={(e) => { editSettings.shifts[key].hours = Number(e.target.value); setEditSettings({ ...editSettings }); }} className="w-20 h-8 text-xs text-center" min={1} max={12} />
                    </div>
                  ))}
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
                          <Input value={shift.start} onChange={(e) => { editSettings.summerShifts[key].start = e.target.value; setEditSettings({ ...editSettings }); }} className="h-8 text-xs" />
                          <Input value={shift.end} onChange={(e) => { editSettings.summerShifts[key].end = e.target.value; setEditSettings({ ...editSettings }); }} className="h-8 text-xs" />
                        </div>
                      ))}
                      {Object.entries(editSettings.summerShifts).map(([key, shift]) => (
                        <div key={`hrs-${key}`} className="flex items-center justify-between">
                          <Label className="text-xs text-slate-600 dark:text-slate-300">{key === "Weekday" ? "Weekday (Sun-Wed)" : key} hours</Label>
                          <Input type="number" value={shift.hours} onChange={(e) => { editSettings.summerShifts[key].hours = Number(e.target.value); setEditSettings({ ...editSettings }); }} className="w-20 h-8 text-xs text-center" min={1} max={12} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <Separator />
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-200 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-amber-500" />Holiday Dates</h3>
                  <div className="flex gap-2">
                    <Input type="date" value={newHolidayDate} onChange={(e) => setNewHolidayDate(e.target.value)} className="h-8 text-xs flex-1" />
                    <Button size="sm" className="h-8 bg-amber-600 hover:bg-amber-700 text-white" onClick={() => { if (!newHolidayDate) return; if (editSettings.holidays.includes(newHolidayDate)) return; setEditSettings({ ...editSettings, holidays: [...editSettings.holidays, newHolidayDate].sort() }); setNewHolidayDate(""); }}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
                  </div>
                  {editSettings.holidays.length > 0 ? (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">{editSettings.holidays.map((hDate) => (
                      <div key={hDate} className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5 text-amber-500" /><span className="text-xs font-medium text-amber-800 dark:text-amber-200">{formatHolidayDisplay(hDate)}</span><span className="text-[10px] text-amber-500">{hDate}</span></div>
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => { setEditSettings({ ...editSettings, holidays: editSettings.holidays.filter((d) => d !== hDate) }); }}><X className="h-3 w-3" /></Button>
                      </div>
                    ))}</div>
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
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> تيم الكونكشن / Connection Team</DialogTitle><DialogDescription>Manage your Connection Team roster</DialogDescription></DialogHeader>
            <div className="space-y-4 mt-2">
              {canEdit && (
                <div className="flex gap-2">
                  <Input value={newEmpName} onChange={(e) => setNewEmpName(e.target.value)} placeholder="Full Name" className="h-8 text-sm" />
                  <Input value={newEmpHrid} onChange={(e) => setNewEmpHrid(e.target.value)} placeholder="HRID" className="h-8 w-24 text-sm" />
                  <Select value={newEmpRegion} onValueChange={setNewEmpRegion}>
                    <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(REGIONS).map(([key, label]) => (<SelectItem key={key} value={key}>{label}</SelectItem>))}</SelectContent>
                  </Select>
                  <Button onClick={addEmployee} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white h-8"><Plus className="h-4 w-4" /></Button>
                </div>
              )}
              <Separator />
              <div className="space-y-2">{employees.map((emp, idx) => (
                <div key={emp.id} className={`flex items-center justify-between p-2 rounded-lg border ${emp.active ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" : "border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 opacity-60"}`}>
                  {editingEmpId === emp.id ? (
                    <div className="flex items-center gap-2 flex-1"><span className="text-xs text-slate-400 w-5">{idx + 1}</span><div className="flex flex-col gap-1 flex-1"><Input value={editEmpName} onChange={(e) => setEditEmpName(e.target.value)} className="h-7 text-xs" placeholder="Name" /><div className="flex gap-2"><Input value={editEmpHrid} onChange={(e) => setEditEmpHrid(e.target.value)} className="h-7 text-xs w-32" placeholder="HRID" /><Select value={editEmpRegion} onValueChange={setEditEmpRegion}><SelectTrigger className="h-7 w-[130px] text-xs"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(REGIONS).map(([key, label]) => (<SelectItem key={key} value={key}>{label}</SelectItem>))}</SelectContent></Select></div></div></div>
                  ) : (
                    <div className="flex items-center gap-3"><span className="text-xs text-slate-400 w-5">{idx + 1}</span><div><div className="font-medium text-sm">{emp.name}</div><div className="text-xs text-slate-500">HRID: {emp.hrid} | <Badge variant="outline" className="text-[9px]">{REGIONS[emp.region] || emp.region}</Badge></div></div></div>
                  )}
                  <div className="flex items-center gap-2">
                    {editingEmpId === emp.id ? (
                      <><Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white text-xs" onClick={() => editEmployee(emp.id, editEmpName, editEmpHrid)}><CheckCircle className="h-3 w-3 mr-1" />Save</Button><Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400" onClick={() => { setEditingEmpId(null); }}><X className="h-3.5 w-3.5" /></Button></>
                    ) : canEdit ? (
                      <><Button size="icon" variant="ghost" className="h-7 w-7 text-blue-400 hover:text-blue-600" onClick={() => { setEditingEmpId(emp.id); setEditEmpName(emp.name); setEditEmpHrid(emp.hrid); setEditEmpRegion(emp.region || "all"); }}><Pencil className="h-3.5 w-3.5" /></Button><div className="flex items-center gap-1.5"><Switch checked={emp.active} onCheckedChange={() => toggleEmployeeActive(emp.id, emp.active)} className="scale-75" /><span className="text-[10px] text-slate-400">{emp.active ? "Active" : "Inactive"}</span></div>{canAdmin && <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => deleteEmployee(emp.id, emp.name)}><Trash2 className="h-3.5 w-3.5" /></Button>}</>
                    ) : null}
                  </div>
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
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Export to Excel</DialogTitle><DialogDescription>Customize your export</DialogDescription></DialogHeader>
            <div className="space-y-4 mt-2">
              <div><Label className="text-xs font-medium">Select Region</Label>
                <Select value={exportRegion} onValueChange={setExportRegion}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><MapPin className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(REGIONS).map(([key, label]) => (<SelectItem key={key} value={key}>{label}</SelectItem>))}</SelectContent>
                </Select>
                <p className="text-[10px] text-slate-400 mt-1">Export schedule for the selected region</p>
              </div>
              <Separator />
              <div><Label className="text-xs font-medium">Select Employees</Label>
                <div className="mt-2 flex gap-2 mb-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { const regionEmps = exportRegion !== "all" ? employees.filter(e => e.region === exportRegion) : employees; setExportSelectedIds(regionEmps.map((e) => e.id)); }}>Select All</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setExportSelectedIds([])}>Deselect All</Button>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {(exportRegion !== "all" ? employees.filter(e => e.region === exportRegion) : employees).map((emp) => (
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
            <DialogFooter><Button variant="outline" onClick={() => setShowExport(false)}>Cancel</Button><Button onClick={exportExcel} disabled={exporting} className="bg-emerald-600 hover:bg-emerald-700 text-white">{exporting ? "Exporting..." : "Export Excel"}</Button></DialogFooter>
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
                  <Badge className={`text-white border-0 ${balance.status === "green" ? "bg-green-500" : balance.status === "yellow" ? "bg-yellow-500" : "bg-red-500"}`}>Balance: {balance.status.toUpperCase()}</Badge>
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
                      const connHrs = connectionTeam
                        .filter((ct) => ct.empName === emp.name)
                        .reduce((sum, ct) => sum + calcConnectionWeekHours(ct.weekStart, ct.weekEnd), 0);
                      return (
                        <tr key={emp.id} className="border-b border-slate-100 dark:border-slate-800">
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
                    <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 font-medium text-sm">{u.username}{u.id === user?.id && <span className="ml-1 text-[10px] text-blue-500">(you)</span>}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{u.email || "-"}</td>
                      <td className="px-3 py-2 text-center"><Badge className={`text-[10px] text-white border-0 ${u.role === "admin" ? "bg-red-500" : u.role === "editor" ? "bg-amber-500" : "bg-slate-500"}`}>{u.role}</Badge></td>
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
              <div><Label className="text-xs">Role</Label><Select value={newUserRole} onValueChange={setNewUserRole}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="editor">Editor</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent></Select></div>
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
              <div><Label className="text-xs">Role</Label><Select value={editUserRole} onValueChange={setEditUserRole}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="editor">Editor</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent></Select></div>
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
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> تعيين تيم الكونكشن</DialogTitle><DialogDescription>Assign a Connection Team member for a specific week</DialogDescription></DialogHeader>
            <div className="space-y-3 mt-2">
              <div><Label className="text-xs">Week</Label>
                <Select value={String(connWeekIdx)} onValueChange={(v) => setConnWeekIdx(Number(v))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {buildWeekOptions().map((w, i) => (
                      <SelectItem key={i} value={String(i)}>{formatDateDisplay(w.weekStart)} → {formatDateDisplay(w.weekEnd)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Employee</Label>
                <Select value={connEmpIdx} onValueChange={setConnEmpIdx}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{regionActiveEmps.map((emp, idx) => (
                    <SelectItem key={emp.id} value={String(idx)}>{emp.name} ({emp.hrid})</SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>
              {connEmpIdx !== "" && (() => {
                const weeks = buildWeekOptions();
                const week = weeks[connWeekIdx];
                if (week && settings) {
                  const totalHrs = calcConnectionWeekHours(week.weekStart, week.weekEnd);
                  return (
                    <div className="bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-teal-700 dark:text-teal-300">
                        <Clock className="h-4 w-4" />
                        Total Week Hours: {totalHrs.toFixed(1)}h
                      </div>
                      <p className="text-xs text-teal-600 dark:text-teal-400 mt-1">
                        Working all 7 days: {formatDateDisplay(week.weekStart)} → {formatDateDisplay(week.weekEnd)}
                      </p>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddConnection(false)}>Cancel</Button>
              {(() => {
                const weeks = buildWeekOptions();
                const week = weeks[connWeekIdx];
                const existingConn = week ? connectionTeam.find(ct => ct.weekStart === week.weekStart) : null;
                return existingConn ? (
                  <Button onClick={() => { setConnReplaceFrom(existingConn.empName); setConnReplaceTo(""); setConnReplaceWeekIdx(connWeekIdx); setConnReplaceHours(""); setShowAddConnection(false); setShowConnReplace(true); }} className="bg-amber-600 hover:bg-amber-700 text-white">Replace (Current: {existingConn.empName})</Button>
                ) : (
                  <Button onClick={addConnectionPerson} className="bg-teal-600 hover:bg-teal-700 text-white">Assign</Button>
                );
              })()}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== TRANSFER CONNECTION HOURS MODAL ===== */}
        <Dialog open={showConnReplace} onOpenChange={setShowConnReplace}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowLeftRight className="h-5 w-5" /> تبديل تيم الكونكشن</DialogTitle><DialogDescription>Replace a Connection Team member for a specific week</DialogDescription></DialogHeader>
            <div className="space-y-3 mt-2">
              <div><Label className="text-xs">Week (with existing Connection Team assignment)</Label>
                <Select value={String(connReplaceWeekIdx)} onValueChange={(v) => {
                  const newIdx = Number(v);
                  setConnReplaceWeekIdx(newIdx);
                  const weeks = buildWeekOptions();
                  const week = weeks[newIdx];
                  const existing = week ? connectionTeam.find(ct => ct.weekStart === week.weekStart) : undefined;
                  if (existing) {
                    setConnReplaceFrom(existing.empName);
                    setConnReplaceHours(String(calcConnectionWeekHours(existing.weekStart, existing.weekEnd)));
                  } else {
                    setConnReplaceFrom("");
                    setConnReplaceHours("");
                  }
                  setConnReplaceTo("");
                }}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {buildWeekOptions().filter((w) => connectionTeam.some(ct => ct.weekStart === w.weekStart)).map((w, i) => {
                      const actualIdx = buildWeekOptions().findIndex(wo => wo.weekStart === w.weekStart);
                      const ct = connectionTeam.find(c => c.weekStart === w.weekStart);
                      return (<SelectItem key={actualIdx} value={String(actualIdx)}>{formatDateDisplay(w.weekStart)} → {formatDateDisplay(w.weekEnd)} ({ct?.empName})</SelectItem>);
                    })}
                  </SelectContent>
                </Select>
                {buildWeekOptions().filter((w) => connectionTeam.some(ct => ct.weekStart === w.weekStart)).length === 0 && (
                  <p className="text-xs text-slate-400 mt-1 italic">No Connection Team assignments found for this month.</p>
                )}
              </div>
              {connReplaceFrom && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                  <div className="text-xs font-medium text-amber-700 dark:text-amber-300">Current Connection Team Member:</div>
                  <div className="text-sm font-semibold text-amber-800 dark:text-amber-200 mt-0.5">{connReplaceFrom} {connReplaceHours && <span className="text-xs font-normal text-amber-600">({Number(connReplaceHours).toFixed(1)}h)</span>}</div>
                </div>
              )}
              <div><Label className="text-xs">Transfer to Employee</Label>
                <Select value={connReplaceTo} onValueChange={setConnReplaceTo}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select target employee" /></SelectTrigger>
                  <SelectContent>{regionActiveEmps.filter((e) => e.name !== connReplaceFrom).map((emp) => (
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
            <DialogFooter><Button variant="outline" onClick={() => setShowConnReplace(false)}>Cancel</Button><Button onClick={replaceConnectionPerson} disabled={!connReplaceTo || !connReplaceFrom} className="bg-teal-600 hover:bg-teal-700 text-white">Transfer &amp; Replace</Button></DialogFooter>
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
                  <SelectContent>{regionActiveEmps.map((emp) => (
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
      </div>
    </TooltipProvider>
  );
}
