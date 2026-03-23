// src/services/db.ts
import { db } from "../lib/firebase";
import { 
  collection, doc, getDoc, getDocs, setDoc, updateDoc, 
  deleteDoc, addDoc, query, where, writeBatch 
} from "firebase/firestore";
import { 
  Worker, AttendanceRecord, Advance, ShiftConfig, OrgSettings, 
  AppNotification, MonthlyPayroll, SubscriptionTier, PlanLimits, 
  DEFAULT_PLAN_CONFIG, UserProfile 
} from "../types/index";

export const dbService = {

  // --- SUPER ADMIN METHODS ---

  getGlobalPlanConfig: async (): Promise<Record<SubscriptionTier, PlanLimits>> => {
    try {
      const snap = await getDoc(doc(db, "system_settings", "plan_config"));
      if (snap.exists()) return snap.data() as Record<SubscriptionTier, PlanLimits>;
      return DEFAULT_PLAN_CONFIG;
    } catch (error) {
      console.error("Failed to fetch global plans, falling back to default", error);
      return DEFAULT_PLAN_CONFIG;
    }
  },

  updateGlobalPlanConfig: async (config: Record<SubscriptionTier, PlanLimits>) => {
    await setDoc(doc(db, "system_settings", "plan_config"), config, { merge: true });
  },

  getAllTenants: async () => {
    try {
      const q = query(collection(db, 'users'), where('role', '==', 'FACTORY_OWNER'));
      const snapshot = await getDocs(q);
      
      const tenants = await Promise.all(snapshot.docs.map(async (docSnap) => {
        const data = docSnap.data();
        const workersQ = query(collection(db, "workers"), where("tenantId", "==", data.tenantId));
        const workersSnap = await getDocs(workersQ);
        
        let plan = 'FREE';
        let overrides = {};
        if (data.tenantId) {
          const tenantDoc = await getDoc(doc(db, 'tenants', data.tenantId));
          if (tenantDoc.exists()) {
            const tenantData = tenantDoc.data();
            plan = tenantData.plan || 'FREE';
            overrides = tenantData.overrides || {};
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
    await updateDoc(doc(db, 'users', userId), { isActive: !currentStatus });
  },

  makeSuperAdmin: async (userId: string) => {
    await updateDoc(doc(db, 'users', userId), { role: 'SUPER_ADMIN' });
    return true;
  },

  updateTenantPlan: async (tenantId: string, plan: SubscriptionTier) => {
    await updateDoc(doc(db, 'tenants', tenantId), { plan });
  },

  updateTenantOverrides: async (tenantId: string, overrides: Partial<PlanLimits>) => {
    await updateDoc(doc(db, 'tenants', tenantId), { overrides });
  },

  // USED BY AUTH CONTEXT
  getUserProfile: async (uid: string): Promise<UserProfile | null> => {
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      return snap.exists() ? (snap.data() as UserProfile) : null;
    } catch (e) {
      console.error('getUserProfile error', e);
      return null;
    }
  },

  getTenant: async (tenantId: string) => {
    try {
      const snap = await getDoc(doc(db, 'tenants', tenantId));
      return snap.exists() ? snap.data() : null;
    } catch (e) {
      console.error('getTenant error', e);
      return null;
    }
  },

  updateTenant: async (tenantId: string, data: { name: string }) => {
    await updateDoc(doc(db, 'tenants', tenantId), data);
  },

  // --- WORKER MANAGEMENT ---

  getWorkers: async (tenantId: string): Promise<Worker[]> => {
    if (!tenantId) return [];
    const q = query(collection(db, "workers"), where("tenantId", "==", tenantId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Worker));
  },

  getWorker: async (tenantId: string, workerId: string): Promise<Worker | null> => {
    const snap = await getDoc(doc(db, "workers", workerId));
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
    const ref = await addDoc(collection(db, "workers"), workerData);
    return ref.id;
  },

  updateWorker: async (workerId: string, data: Partial<Worker>) => {
    await updateDoc(doc(db, "workers", workerId), {
      ...data,
      updatedAt: new Date().toISOString(),
    });
  },

  deleteWorker: async (tenantId: string, workerId: string) => {
    // Instead of looping individual deletes which is slow, we use writeBatch for safety and speed.
    const batch = writeBatch(db);
    
    const attQ = query(collection(db, "attendance"), where("tenantId", "==", tenantId), where("workerId", "==", workerId));
    const attSnap = await getDocs(attQ);
    attSnap.docs.forEach(d => batch.delete(doc(db, "attendance", d.id)));

    const advQ = query(collection(db, "advances"), where("tenantId", "==", tenantId), where("workerId", "==", workerId));
    const advSnap = await getDocs(advQ);
    advSnap.docs.forEach(d => batch.delete(doc(db, "advances", d.id)));

    const payQ = query(collection(db, "payrolls"), where("tenantId", "==", tenantId), where("workerId", "==", workerId));
    const paySnap = await getDocs(payQ);
    paySnap.docs.forEach(d => batch.delete(doc(db, "payrolls", d.id)));

    batch.delete(doc(db, "workers", workerId));
    await batch.commit();
  },

  // --- NOTIFICATIONS ---

  addNotification: async (notification: Omit<AppNotification, 'id'>) => {
    await addDoc(collection(db, "notifications"), notification);
  },

  getNotifications: async (tenantId: string): Promise<AppNotification[]> => {
    if (!tenantId) return [];
    const q = query(collection(db, "notifications"), where("tenantId", "==", tenantId));
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map(d => ({ id: d.id, ...d.data() } as AppNotification))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  markNotificationRead: async (notificationId: string) => {
    await updateDoc(doc(db, "notifications", notificationId), { read: true });
  },

  deleteAllNotifications: async (tenantId: string) => {
    if (!tenantId) return;
    const q = query(collection(db, "notifications"), where("tenantId", "==", tenantId));
    const snapshot = await getDocs(q);
    const batch = writeBatch(db);
    snapshot.docs.forEach(d => batch.delete(doc(db, "notifications", d.id)));
    await batch.commit();
  },

  // --- ATTENDANCE ---

  getTodayAttendance: async (tenantId: string) => {
    if (!tenantId) return [];
    const today = new Date().toISOString().split('T')[0];
    const q = query(collection(db, "attendance"), where("tenantId", "==", tenantId), where("date", "==", today));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord));
  },

  getAttendanceByDate: async (tenantId: string, date: string) => {
    if (!tenantId) return [];
    const q = query(collection(db, "attendance"), where("tenantId", "==", tenantId), where("date", "==", date));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord));
  },

  getTodayAttendanceForWorker: async (tenantId: string, workerId: string): Promise<AttendanceRecord | null> => {
    const today = new Date().toISOString().split('T')[0];
    const q = query(collection(db, "attendance"), where("tenantId", "==", tenantId), where("workerId", "==", workerId), where("date", "==", today));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    const d = snapshot.docs[0];
    return { id: d.id, ...d.data() } as AttendanceRecord;
  },

  getAttendanceHistory: async (tenantId: string) => {
    if (!tenantId) return [];
    const q = query(collection(db, "attendance"), where("tenantId", "==", tenantId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord));
  },

  getAttendanceByWorkerAndMonth: async (tenantId: string, workerId: string, monthPrefix: string): Promise<AttendanceRecord[]> => {
    if (!tenantId || !workerId) return [];
    const startDate = `${monthPrefix}-01`;
    const endDate   = `${monthPrefix}-31`;
    const q = query(collection(db, "attendance"), 
      where("tenantId", "==", tenantId), 
      where("workerId", "==", workerId), 
      where("date", ">=", startDate), 
      where("date", "<=", endDate)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord));
  },

  markAttendanceOnline: async (record: AttendanceRecord) => {
    const recordId = `${record.tenantId}_${record.workerId}_${record.date}`;
    await setDoc(doc(db, "attendance", recordId), { ...record, id: recordId }, { merge: true });
  },

  markAttendance: async (record: AttendanceRecord) => {
    const recordId = `${record.tenantId}_${record.workerId}_${record.date}`;
    try {
      await setDoc(doc(db, "attendance", recordId), { ...record, id: recordId }, { merge: true });
    } catch (e) {
      console.error("Failed to write attendance", e);
    }
  },

  // --- ADVANCES ---

  getAdvances: async (tenantId: string): Promise<Advance[]> => {
    if (!tenantId) return [];
    const q = query(collection(db, "advances"), where("tenantId", "==", tenantId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Advance));
  },

  addAdvance: async (advance: Omit<Advance, 'id'>) => {
    const ref = await addDoc(collection(db, "advances"), advance);
    return ref.id;
  },

  // --- SETTINGS ---

  getOrgSettings: async (tenantId: string): Promise<OrgSettings> => {
    const snap = await getDoc(doc(db, "settings", tenantId));
    
    // Default objects exactly as you had them
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
    await setDoc(doc(db, "settings", tenantId), {
      ...settings,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  },

  getShifts: async (tenantId: string): Promise<ShiftConfig[]> => {
    const settings = await dbService.getOrgSettings(tenantId);
    return settings.shifts;
  },

  saveShifts: async (tenantId: string, shifts: ShiftConfig[]) => {
    await setDoc(doc(db, "settings", tenantId), { shifts }, { merge: true });
  },

  getMonthlyLateCount: async (tenantId: string, workerId: string): Promise<number> => {
    const startOfMonth = new Date().toISOString().slice(0, 7);
    const q = query(collection(db, "attendance"), where("tenantId", "==", tenantId), where("workerId", "==", workerId));
    const snapshot = await getDocs(q);
    return snapshot.docs.filter((d) => {
      const data = d.data();
      return data.date >= `${startOfMonth}-01` && data.lateStatus?.isLate === true;
    }).length;
  },

  // --- TEAM ---

  getTeam: async (tenantId: string) => {
    const q = query(collection(db, "users"), where("tenantId", "==", tenantId), where("role", "==", "SUPERVISOR"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data());
  },

  getTeamInvites: async (tenantId: string): Promise<any[]> => {
    if (!tenantId) return [];
    const q = query(collection(db, 'invites'), where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, email: d.id, ...d.data() }));
  },

  inviteManager: async (adminTenantId: string, managerEmail: string, managerName: string) => {
    await setDoc(doc(db, "invites", managerEmail), {
      email: managerEmail, name: managerName, tenantId: adminTenantId,
      role: 'SUPERVISOR', createdAt: new Date().toISOString()
    });
  },

  checkInvite: async (email: string) => {
    const snap = await getDoc(doc(db, "invites", email));
    return snap.exists() ? snap.data() : null;
  },

  deleteInvite: async (email: string) => {
    await deleteDoc(doc(db, "invites", email));
  },

  removeManager: async (uid: string) => {
    await updateDoc(doc(db, "users", uid), { tenantId: null, role: null });
  },

  // --- KIOSK TERMINALS ---

  getKioskTerminals: async (tenantId: string): Promise<any[]> => {
    if (!tenantId) return [];
    const q = query(collection(db, "kiosks"), where("tenantId", "==", tenantId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  addKioskTerminal: async (terminal: any) => {
    await addDoc(collection(db, "kiosks"), terminal);
  },

  deleteKioskTerminal: async (id: string) => {
    await deleteDoc(doc(db, "kiosks", id));
  },

  verifyKioskPairingCode: async (code: string): Promise<any | null> => {
    const q = query(collection(db, "kiosks"), where("pairingCode", "==", code));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
  },

  // --- PAYROLL ---

  getPayrollsByMonth: async (tenantId: string, month: string): Promise<MonthlyPayroll[]> => {
    if (!tenantId) return [];
    const q = query(collection(db, "payrolls"), where("tenantId", "==", tenantId), where("month", "==", month));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as MonthlyPayroll));
  },

  savePayroll: async (payroll: MonthlyPayroll) => {
    await setDoc(doc(db, "payrolls", payroll.id), payroll, { merge: true });
  }
};