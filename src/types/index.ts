// src/types/index.ts
export type Role = 
  | 'SUPER_ADMIN'   // You (SaaS Owner)
  | 'FACTORY_OWNER' // Tenant Admin
  | 'SUPERVISOR'    // Manager (Changed from MANAGER to match your DB logic)
  | 'WORKER';

export type SaturdayOffType = 'NONE' | 'ALL' | 'ALTERNATE' | 'FIRST_THIRD' | 'SECOND_FOURTH';

export interface WeeklyOffConfig {
  defaultDays: number[]; // e.g., [0] for Sunday, [0, 6] for Sat/Sun
  saturdayRule: SaturdayOffType;
}

export interface Holiday {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  isPaid: boolean;
}

export interface LeavePolicy {
  cl: number; // Casual Leaves
  sl: number; // Sick Leaves
  pl: number; // Privilege/Earned Leaves
  allowNegativeBalance: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  role: Role;
  tenantId: string;
  companyName?: string;
}

export interface TenantProfile {
  id: string;
  name: string;
  ownerId: string;
  shifts: ShiftConfig[]; 
  plan: SubscriptionTier;
  trialEndsAt?: string; 
  overrides?: Partial<PlanLimits>; 
}

export interface ShiftConfig {
  id: string;
  name: string;      
  startTime: string; 
  endTime: string;   
  gracePeriodMins: number; 
  maxGraceAllowed: number; 
  breakDurationMins: number; 
  minHalfDayHours: number; 
  minOvertimeMins: number;
}

export interface Branch {
  id: string;
  name: string;
  location?: { lat: number; lng: number; radius: number; address?: string };
}

export interface OrgSettings {
  shifts: ShiftConfig[];
  enableBreakTracking: boolean; 
  strictLiveness?: boolean;
  baseLocation?: { lat: number; lng: number; radius: number; address?: string }; 
  branches?: Branch[]; 
  departments?: string[]; 
  compliance?: {
    pfRegistrationNumber?: string;
    esicCode?: string;
    capPfDeduction?: boolean; 
    dailyWagePfPercentage?: number; 
    pfContributionRate?: number; 
    epsContributionRate?: number; 
    epfWageCeiling?: number; 
  };
  weeklyOffs?: WeeklyOffConfig;
  holidays?: Holiday[];
  enableSandwichRule?: boolean;
  holidayPayMultiplier?: number; 
  leavePolicy?: LeavePolicy;
}

export interface Punch {
  timestamp: string; 
  type: 'IN' | 'OUT';
  device: string;
  location?: { lat: number; lng: number };
  isOutOfGeofence?: boolean;
}

export interface WageConfig {
  type: 'DAILY' | 'MONTHLY';
  amount: number;
  basicPercentage?: number; 
  monthlyBreakdown?: {
    basic: number;
    hra: number;
    others: number;
  };
  overtimeEligible: boolean;
  overtimeRatePerHour?: number;
  workingDaysPerMonth?: number;
  allowances: {
    travel: number;
    food: number;
    nightShift: number;
  };
}

export interface Worker {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  aadhar?: string;
  dob: string;
  gender: 'Male' | 'Female' | 'Other' | 'MALE' | 'FEMALE'; 
  category: 'Daily Wage' | 'Monthly' | 'Contract' | 'Permanent';
  department: string;
  designation: string;
  joinedDate: string;
  shiftId: string;
  branchId?: string; 
  wageConfig: WageConfig;
  photoUrl?: string;
  faceDescriptor?: number[];
  status: 'ACTIVE' | 'INACTIVE';
  uan?: string; 
  esicIp?: string; 
  pan?: string; 
  fatherName?: string; 
  dateOfBirth?: string; 
  dateOfJoining?: string; 
  dateOfExit?: string; 
  weeklyOffOverride?: number[];
  leaveBalances?: {
    cl: number;
    sl: number;
    pl: number;
  }; 
}

export interface TimeRecord {
  timestamp: string;
  geoLocation: { lat: number; lng: number };
  facePhotoUrl?: string;
  deviceInfo: string;
  markedBy: 'self' | 'supervisor';
}

export interface AttendanceCalculations {
  grossHours: number;
  breakDeduction: number;
  netWorkingHours: number;
  regularHours: number;
  overtimeHours: number;
  isLate: boolean;
  lateByMinutes: number;
}

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  workerId: string;
  workerName: string;
  date: string;
  shiftId: string; 
  timeline: Punch[]; 
  status: 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'ON_LEAVE' | 'WEEKLY_OFF' | 'PUBLIC_HOLIDAY' | 'HOLIDAY_WORKED' | 'UNPAID_HOLIDAY';
  lateStatus: {
    isLate: boolean;
    lateByMins: number;
    penaltyApplied: boolean;
  };
  hours: {
    gross: number;
    net: number; 
    overtime: number;
  };
  leaveInfo?: {
    type: 'CL' | 'SL' | 'PL' | 'LWP';
    isPaid: boolean;
    reason: string;
  };
  inTime?: TimeRecord;
  outTime?: TimeRecord;
  calculatedHours?: AttendanceCalculations;
}

export interface DailyWageRecord {
  id: string;
  tenantId: string;
  workerId: string;
  date: string;
  attendanceId: string;
  breakdown: {
    baseWage: number;
    overtimeWage: number;
    allowances: number;
    total: number;
  };
  meta: {
    rateUsed: number;
    hoursWorked: number;
    overtimeHours: number;
    isOvertimeLimitExceeded: boolean;
  };
}

export interface MonthlyPayroll {
  id: string;
  tenantId: string;
  workerId: string;
  workerName: string;
  workerDesignation: string;
  workerDepartment: string;
  month: string;
  attendanceSummary: {
    totalDays: number;
    presentDays: number;
    absentDays: number;
    halfDays: number;
    weeklyOffs: number;
    publicHolidays: number;
    holidayWorkedDays: number;
    payableDays: number;
    totalRegularHours: number;
    totalOvertimeHours: number;
    paidLeaves: number;
    unpaidLeaves: number;
  };
  earnings: {
    basic: number;
    overtime: number;
    allowances: {
      travel: number;
      food: number;
      other: number;
    };
    gross: number;
  };
  deductions: {
    advances: number;
    processingFee: number;
    canteen: number;
    total: number;
    details: { description: string; amount: number }[];
  };
  netPayable: number;
  carriedForwardAdvance?: number;
  status: 'DRAFT' | 'LOCKED' | 'PAID';
}

export interface Advance {
  id: string;
  tenantId: string;
  workerId: string;
  amount: number;
  date: string;
  reason: string;
  status: 'APPROVED' | 'PENDING' | 'REPAID';
}

export interface AppNotification {
  id: string;
  tenantId: string;
  title: string;
  message: string;
  imageUrl?: string;
  type: 'INFO' | 'WARNING' | 'ALERT';
  createdAt: string;
  read: boolean;
}

export type SubscriptionTier = 'FREE' | 'TRIAL' | 'STARTER' | 'PRO' | 'ENTERPRISE';

export interface PlanLimits {
  maxWorkers: number;
  maxManagers: number;
  maxShifts: number;
  kioskEnabled: boolean;
  geofencingEnabled: boolean;
  multiBranchEnabled: boolean;
  livenessDetectionEnabled: boolean; 
  advancedLeavesEnabled: boolean; 
  allowancesAndDeductionsEnabled: boolean; 
  statutoryComplianceEnabled: boolean; 
  bulkImportEnabled: boolean;
  idCardEnabled: boolean; // NEW
  payslipEnabled: boolean; // NEW
  regulatePunchEnabled: boolean; // NEW
  publicHolidaysEnabled: boolean;
}

export interface KioskTerminal {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  pairingCode: string;
  adminPin: string;
  createdAt: string;
}

export const DEFAULT_PLAN_CONFIG: Record<SubscriptionTier, PlanLimits> = {
  FREE: { 
    maxWorkers: 15, maxManagers: 0, maxShifts: 1, // Max managers 0 for Free
    kioskEnabled: false, geofencingEnabled: false, multiBranchEnabled: false,
    livenessDetectionEnabled: false, advancedLeavesEnabled: false, allowancesAndDeductionsEnabled: false, statutoryComplianceEnabled: false, bulkImportEnabled: false,
    idCardEnabled: false, payslipEnabled: false, regulatePunchEnabled: false, publicHolidaysEnabled: false
  },
  TRIAL: { 
    maxWorkers: 9999, maxManagers: 9999, maxShifts: 9999, 
    kioskEnabled: true, geofencingEnabled: true, multiBranchEnabled: true,
    livenessDetectionEnabled: true, advancedLeavesEnabled: true, allowancesAndDeductionsEnabled: true, statutoryComplianceEnabled: true, bulkImportEnabled: true,
    idCardEnabled: true, payslipEnabled: true, regulatePunchEnabled: true, publicHolidaysEnabled: true,
  },
  STARTER: { 
    maxWorkers: 50, maxManagers: 3, maxShifts: 3, 
    kioskEnabled: true, geofencingEnabled: true, multiBranchEnabled: false,
    livenessDetectionEnabled: false, advancedLeavesEnabled: false, allowancesAndDeductionsEnabled: true, statutoryComplianceEnabled: false, bulkImportEnabled: false,
    idCardEnabled: true, payslipEnabled: true, regulatePunchEnabled: true, publicHolidaysEnabled: true,
  },
  PRO: { 
    maxWorkers: 200, maxManagers: 10, maxShifts: 10, 
    kioskEnabled: true, geofencingEnabled: true, multiBranchEnabled: true,
    livenessDetectionEnabled: true, advancedLeavesEnabled: true, allowancesAndDeductionsEnabled: true, statutoryComplianceEnabled: false, bulkImportEnabled: false,
    idCardEnabled: true, payslipEnabled: true, regulatePunchEnabled: true, publicHolidaysEnabled: true,
  },
  ENTERPRISE: { 
    maxWorkers: 9999, maxManagers: 9999, maxShifts: 9999, 
    kioskEnabled: true, geofencingEnabled: true, multiBranchEnabled: true,
    livenessDetectionEnabled: true, advancedLeavesEnabled: true, allowancesAndDeductionsEnabled: true, statutoryComplianceEnabled: true, bulkImportEnabled: true,
    idCardEnabled: true, payslipEnabled: true, regulatePunchEnabled: true, publicHolidaysEnabled: true,
  }
};

export type ScreenName = 'LOGIN' | 'DASHBOARD' | 'WORKERS' | 'ADD_WORKER' | 'ATTENDANCE_KIOSK' | 'PAYROLL' | 'ATTENDANCE' | 'DAILY_LOGS' | 'TEAM' | 'SETTINGS' | 'WORKER_HISTORY' | 'SUPER_ADMIN_DASHBOARD' | 'REPORTS' | 'BILLING' | 'ID_CARDS' ;