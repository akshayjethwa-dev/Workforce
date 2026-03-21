// src/services/db.ts
import { db } from "../lib/firebase";
import { 
  Worker, AttendanceRecord, Advance, ShiftConfig, OrgSettings, 
  AppNotification, MonthlyPayroll, SubscriptionTier, PlanLimits, 
  DEFAULT_PLAN_CONFIG, UserProfile 
} from "../types/index";

// Helper refs
const col = (path: string) => (db as any).collection(path);
const docRef = (path: string, id: string) => (db as any).collection(path).doc(id);

export const dbService = {

  // --- SUPER ADMIN METHODS ---

  getGlobalPlanConfig: async (): Promise<Record<SubscriptionTier, PlanLimits>> => {
    try {
      const snap = await docRef("system_settings", "plan_config").get();
      if (snap.exists()) return snap.data() as Record<SubscriptionTier, PlanLimits>;
      return DEFAULT_PLAN_CONFIG;
    } catch (error) {
      console.error("Failed to fetch global plans, falling back to default", error);
      return DEFAULT_PLAN_CONFIG;
    }
  },

  updateGlobalPlanConfig: async (config: Record<SubscriptionTier, PlanLimits>) => {
    await docRef("system_settings", "plan_config").set(config, { merge: true });
  },

  getAllTenants: async () => {
    try {
      const snapshot = await col('users').where('role', '==', 'FACTORY_OWNER').get();
      const tenants = await Promise.all(snapshot.docs.map(async (docSnap: any) => {
        const data = docSnap.data();
        const workersSnap = await col("workers").where("tenantId", "==", data.tenantId).get();
        let plan = 'FREE';
        let overrides = {};
        if (data.tenantId) {
          const tenantDoc = await docRef('tenants', data.tenantId).get();
          if (tenantDoc.exists()) {
            plan = tenantDoc.data().plan || 'FREE';
            overrides = tenantDoc.data().overrides || {};
          }
        }
        return {
          id: docSnap.id,
          ...data,
          workerCount: workersSnap.size,
          isActive: data.isActive !== false,
          joinedAt: data.createdAt || new Date().toISOString(),
          plan,
          overrides
        };
      }));
      return tenants;
    } catch (error) {
      console.error("Error fetching tenants:", error);
      return [];
    }
  },

  toggleTenantStatus: async (userId: string, currentStatus: boolean) => {
    await docRef('users', userId).update({ isActive: !currentStatus });
  },

  makeSuperAdmin: async (userId: string) => {
    await docRef('users', userId).update({ role: 'SUPER_ADMIN' });
    return true;
  },

  updateTenantPlan: async (tenantId: string, plan: SubscriptionTier) => {
    await docRef('tenants', tenantId).update({ plan });
  },

  updateTenantOverrides: async (tenantId: string, overrides: Partial<PlanLimits>) => {
    await docRef('tenants', tenantId).update({ overrides });
  },

  // NEW: Used by AuthContext
  getUserProfile: async (uid: string): Promise<UserProfile | null> => {
    try {
      const snap = await docRef('users', uid).get();
      return snap.exists() ? (snap.data() as UserProfile) : null;
    } catch (e) {
      console.error('getUserProfile error', e);
      return null;
    }
  },

  // NEW: Used by AuthContext
  getTenant: async (tenantId: string) => {
    try {
      const snap = await docRef('tenants', tenantId).get();
      return snap.exists() ? snap.data() : null;
    } catch (e) {
      console.error('getTenant error', e);
      return null;
    }
  },

  updateTenant: async (tenantId: string, data: { name: string }) => {
    await docRef('tenants', tenantId).update(data);
  },

  // --- WORKER MANAGEMENT ---

  getWorkers: async (tenantId: string): Promise<Worker[]> => {
    if (!tenantId) return [];
    const snapshot = await col("workers").where("tenantId", "==", tenantId).get();
    return snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() } as Worker));
  },

  getWorker: async (tenantId: string, workerId: string): Promise<Worker | null> => {
  const snap = await docRef("workers", workerId).get();
  if (!snap.exists()) return null;
  const data = snap.data() as Worker;
  if (data.tenantId !== tenantId) return null;
  return { ...data, id: snap.id } as Worker;
},


  addWorker: async (worker: Omit<Worker, 'id'>) => {
    const workerData = {
      ...worker,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const ref = await col("workers").add(workerData);
    return ref.id;
  },

  updateWorker: async (workerId: string, data: Partial<Worker>) => {
    await docRef("workers", workerId).update({
      ...data,
      updatedAt: new Date().toISOString(),
    });
  },

  deleteWorker: async (tenantId: string, workerId: string) => {
    const attendanceSnap = await col("attendance").where("tenantId", "==", tenantId).get();
    const advancesSnap = await col("advances").where("tenantId", "==", tenantId).get();
    const payrollsSnap = await col("payrolls").where("tenantId", "==", tenantId).get();

    const deletes = [
      ...attendanceSnap.docs.filter((d: any) => d.data().workerId === workerId)
        .map((d: any) => docRef("attendance", d.id).delete()),
      ...advancesSnap.docs.filter((d: any) => d.data().workerId === workerId)
        .map((d: any) => docRef("advances", d.id).delete()),
      ...payrollsSnap.docs.filter((d: any) => d.data().workerId === workerId)
        .map((d: any) => docRef("payrolls", d.id).delete()),
    ];

    await Promise.all(deletes);
    await docRef("workers", workerId).delete();
  },

  // --- NOTIFICATIONS ---

  addNotification: async (notification: Omit<AppNotification, 'id'>) => {
    await col("notifications").add(notification);
  },

  getNotifications: async (tenantId: string): Promise<AppNotification[]> => {
    if (!tenantId) return [];
    const snapshot = await col("notifications").where("tenantId", "==", tenantId).get();
    return snapshot.docs
      .map((d: any) => ({ id: d.id, ...d.data() } as AppNotification))
      .sort((a: AppNotification, b: AppNotification) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  markNotificationRead: async (notificationId: string) => {
    await docRef("notifications", notificationId).update({ read: true });
  },

  deleteAllNotifications: async (tenantId: string) => {
    if (!tenantId) return;
    const snapshot = await col("notifications").where("tenantId", "==", tenantId).get();
    await Promise.all(snapshot.docs.map((d: any) => docRef("notifications", d.id).delete()));
  },

  // --- ATTENDANCE ---

  getTodayAttendance: async (tenantId: string) => {
    if (!tenantId) return [];
    const today = new Date().toISOString().split('T')[0];
    const snapshot = await col("attendance")
      .where("tenantId", "==", tenantId)
      .where("date", "==", today)
      .get();
    return snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() } as AttendanceRecord));
  },

  getAttendanceByDate: async (tenantId: string, date: string) => {
  if (!tenantId) return [];
  const snapshot = await col("attendance")
    .where("tenantId", "==", tenantId)
    .where("date", "==", date)
    .get();
  return snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() } as AttendanceRecord));
},

  getTodayAttendanceForWorker: async (tenantId: string, workerId: string): Promise<AttendanceRecord | null> => {
  const today = new Date().toISOString().split('T')[0];
  const snapshot = await col("attendance")
    .where("tenantId", "==", tenantId)
    .where("workerId", "==", workerId)
    .where("date", "==", today)
    .get();
  if (snapshot.empty) return null;
  const d = snapshot.docs[0];
  return { id: d.id, ...d.data() } as AttendanceRecord;
},

  getAttendanceHistory: async (tenantId: string) => {
    if (!tenantId) return [];
    const snapshot = await col("attendance").where("tenantId", "==", tenantId).get();
    return snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() } as AttendanceRecord));
  },

  getAttendanceByWorkerAndMonth: async (
  tenantId: string,
  workerId: string,
  monthPrefix: string   // e.g. "2026-03"
): Promise<AttendanceRecord[]> => {
  if (!tenantId || !workerId) return [];
  const startDate = `${monthPrefix}-01`;
  const endDate   = `${monthPrefix}-31`;
  const snapshot  = await col("attendance")
    .where("tenantId", "==", tenantId)
    .where("workerId", "==", workerId)
    .where("date", ">=", startDate)
    .where("date", "<=", endDate)
    .get();
  return snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() } as AttendanceRecord));
},

  markAttendanceOnline: async (record: AttendanceRecord) => {
    const recordId = `${record.tenantId}_${record.workerId}_${record.date}`;
    await docRef("attendance", recordId).set({ ...record, id: recordId }, { merge: true });
  },

  markAttendance: async (record: AttendanceRecord) => {
    const recordId = `${record.tenantId}_${record.workerId}_${record.date}`;
    try {
      await docRef("attendance", recordId).set({ ...record, id: recordId }, { merge: true });
    } catch (e) {
      console.error("Failed to write attendance", e);
    }
  },

  // --- ADVANCES ---

  getAdvances: async (tenantId: string): Promise<Advance[]> => {
    if (!tenantId) return [];
    const snapshot = await col("advances").where("tenantId", "==", tenantId).get();
    return snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() } as Advance));
  },

  addAdvance: async (advance: Omit<Advance, 'id'>) => {
    const ref = await col("advances").add(advance);
    return ref.id;
  },

  // --- SETTINGS ---

  getOrgSettings: async (tenantId: string): Promise<OrgSettings> => {
    const snap = await docRef("settings", tenantId).get();
    const defaultShifts: ShiftConfig[] = [{
      id: 'default', name: 'General Shift', startTime: '09:00', endTime: '18:00',
      gracePeriodMins: 15, maxGraceAllowed: 3, breakDurationMins: 60,
      minOvertimeMins: 60, minHalfDayHours: 4
    }];
    const defaultDepartments = ['Production', 'Packaging', 'Maintenance', 'Loading', 'Quality'];
    const defaultBranch = { id: 'default', name: 'Main Branch' };
    const defaultWeeklyOffs: OrgSettings['weeklyOffs'] = { defaultDays: [0], saturdayRule: 'NONE' };
    const defaultCompliance = {
      pfRegistrationNumber: '', esicCode: '', capPfDeduction: true,
      dailyWagePfPercentage: 100, pfContributionRate: 12,
      epsContributionRate: 8.33, epfWageCeiling: 15000
    };
    if (snap.exists()) {
      const data = snap.data();
      return {
        shifts: data.shifts || defaultShifts,
        enableBreakTracking: data.enableBreakTracking ?? false,
        strictLiveness: data.strictLiveness ?? false,
        baseLocation: data.baseLocation,
        branches: data.branches?.length ? data.branches : [{ ...defaultBranch, location: data.baseLocation }],
        departments: data.departments?.length ? data.departments : defaultDepartments,
        weeklyOffs: data.weeklyOffs || defaultWeeklyOffs,
        holidays: data.holidays || [],
        enableSandwichRule: data.enableSandwichRule ?? false,
        holidayPayMultiplier: data.holidayPayMultiplier ?? 2.0,
        compliance: { ...defaultCompliance, ...(data.compliance || {}) }
      };
    }
    return {
      shifts: defaultShifts, enableBreakTracking: false, strictLiveness: false,
      branches: [defaultBranch], departments: defaultDepartments,
      weeklyOffs: defaultWeeklyOffs, holidays: [], enableSandwichRule: false,
      holidayPayMultiplier: 2.0, compliance: defaultCompliance
    };
  },

  saveOrgSettings: async (tenantId: string, settings: OrgSettings) => {
    await docRef("settings", tenantId).set({
      ...settings,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  },

  getShifts: async (tenantId: string): Promise<ShiftConfig[]> => {
    const settings = await dbService.getOrgSettings(tenantId);
    return settings.shifts;
  },

  saveShifts: async (tenantId: string, shifts: ShiftConfig[]) => {
    await docRef("settings", tenantId).set({ shifts }, { merge: true });
  },

  getMonthlyLateCount: async (tenantId: string, workerId: string): Promise<number> => {
    const startOfMonth = new Date().toISOString().slice(0, 7);
    const snapshot = await col("attendance")
      .where("tenantId", "==", tenantId)
      .where("workerId", "==", workerId)
      .get();
    return snapshot.docs.filter((d: any) => {
      const data = d.data();
      return data.date >= `${startOfMonth}-01` && data.lateStatus?.isLate === true;
    }).length;
  },

  // --- TEAM ---

  getTeam: async (tenantId: string) => {
    const snapshot = await col("users")
      .where("tenantId", "==", tenantId)
      .where("role", "==", "SUPERVISOR")
      .get();
    return snapshot.docs.map((d: any) => d.data());
  },

  getTeamInvites: async (tenantId: string): Promise<any[]> => {
  if (!tenantId) return [];
  const snapshot = await col('invites').where('tenantId', '==', tenantId).get();
  return snapshot.docs.map((d: any) => ({ id: d.id, email: d.id, ...d.data() }));
},

  inviteManager: async (adminTenantId: string, managerEmail: string, managerName: string) => {
    await docRef("invites", managerEmail).set({
      email: managerEmail, name: managerName, tenantId: adminTenantId,
      role: 'SUPERVISOR', createdAt: new Date().toISOString()
    });
  },

  checkInvite: async (email: string) => {
    const snap = await docRef("invites", email).get();
    return snap.exists() ? snap.data() : null;
  },

  deleteInvite: async (email: string) => {
    await docRef("invites", email).delete();
  },

  removeManager: async (uid: string) => {
    await docRef("users", uid).update({ tenantId: null, role: null });
  },

  // --- KIOSK TERMINALS ---

  getKioskTerminals: async (tenantId: string): Promise<any[]> => {
    if (!tenantId) return [];
    const snapshot = await col("kiosks").where("tenantId", "==", tenantId).get();
    return snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  },

  addKioskTerminal: async (terminal: any) => {
    await col("kiosks").add(terminal);
  },

  deleteKioskTerminal: async (id: string) => {
    await docRef("kiosks", id).delete();
  },

  verifyKioskPairingCode: async (code: string): Promise<any | null> => {
    const snapshot = await col("kiosks").where("pairingCode", "==", code).get();
    if (snapshot.empty) return null;
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
  },

  // --- PAYROLL ---

  getPayrollsByMonth: async (tenantId: string, month: string): Promise<MonthlyPayroll[]> => {
    if (!tenantId) return [];
    const snapshot = await col("payrolls")
      .where("tenantId", "==", tenantId)
      .where("month", "==", month)
      .get();
    return snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() } as MonthlyPayroll));
  },

  savePayroll: async (payroll: MonthlyPayroll) => {
    await docRef("payrolls", payroll.id).set(payroll, { merge: true });
  }
};
