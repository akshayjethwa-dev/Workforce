// src/contexts/AuthContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { signOut, onAuthStateChanged, Auth } from 'firebase/auth';
// ✅ Cast auth as Auth type explicitly to resolve namespace conflict
import { auth as firebaseAuth } from '../lib/firebase';
import { UserProfile, SubscriptionTier, PlanLimits } from '../types/index';
import { dbService } from '../services/db';

// ✅ Force the correct modular Auth type — prevents @react-native-firebase namespace bleed
const auth = firebaseAuth as unknown as Auth;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface AuthContextType {
  user:              any | null;
  profile:           UserProfile | null;
  tenantPlan:        SubscriptionTier;
  limits:            PlanLimits | null;
  trialDaysLeft:     number | null;
  loading:           boolean;
  isImpersonating:   boolean;
  logout:            () => Promise<void>;
  impersonateTenant: (tenantId: string, companyName: string) => Promise<void>;
  stopImpersonating: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextType>({
  user:              null,
  profile:           null,
  tenantPlan:        'STARTER',
  limits:            null,
  trialDaysLeft:     null,
  loading:           true,
  isImpersonating:   false,
  logout:            async () => {},
  impersonateTenant: async () => {},
  stopImpersonating: async () => {},
});

export const useAuth = () => useContext(AuthContext);

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user,            setUser]            = useState<any | null>(null);
  const [profile,         setProfile]         = useState<UserProfile | null>(null);
  const [originalProfile, setOriginalProfile] = useState<UserProfile | null>(null);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [tenantPlan,      setTenantPlan]      = useState<SubscriptionTier>('FREE');
  const [limits,          setLimits]          = useState<PlanLimits | null>(null);
  const [trialDaysLeft,   setTrialDaysLeft]   = useState<number | null>(null);
  const [loading,         setLoading]         = useState(true);

  // ── Load tenant plan + limits ────────────────────────────
  const loadTenantData = async (tenantId: string) => {
    try {
      const [tenantData, globalPlans] = await Promise.all([
        dbService.getTenant(tenantId),
        dbService.getGlobalPlanConfig(),
      ]);

      if (tenantData) {
        let currentPlan = (tenantData.plan as SubscriptionTier) || 'FREE';
        let daysLeft: number | null = null;

        if (currentPlan === 'TRIAL' && tenantData.trialEndsAt) {
          const endDate = new Date(tenantData.trialEndsAt);
          endDate.setHours(0, 0, 0, 0);
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          daysLeft = Math.round(
            (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );

          if (daysLeft <= 0) {
            currentPlan = 'FREE';
            daysLeft    = 0;
            try {
              await dbService.updateTenantPlan(tenantId, 'FREE');
            } catch (err) {
              console.error('Failed to auto-downgrade plan:', err);
            }
          }
        }

        setTenantPlan(currentPlan);
        const baseLimits = globalPlans[currentPlan];
        const overrides  = tenantData.overrides ?? {};
        setLimits({ ...baseLimits, ...overrides });
        setTrialDaysLeft(daysLeft);
      }
    } catch (err) {
      console.error('loadTenantData error:', err);
    }
  };

  // ── Load user profile ────────────────────────────────────
  const loadUserProfile = async (uid: string) => {
    try {
      const userData = await dbService.getUserProfile(uid);
      if (userData) {
        setProfile(userData);
        setOriginalProfile(userData);
        if (userData.tenantId) {
          await loadTenantData(userData.tenantId);
        }
      }
    } catch (err) {
      console.error('loadUserProfile error:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Auth state listener ──────────────────────────────────
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await loadUserProfile(firebaseUser.uid);
      } else {
        setProfile(null);
        setOriginalProfile(null);
        setIsImpersonating(false);
        setTenantPlan('FREE');
        setLimits(null);
        setTrialDaysLeft(null);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  // ── Logout ───────────────────────────────────────────────
  const logout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('logout error:', err);
    }
  };

  // ── Super Admin impersonation ────────────────────────────
  const impersonateTenant = async (tenantId: string, companyName: string) => {
    if (!originalProfile) return;
    setIsImpersonating(true);
    setProfile({ ...originalProfile, role: 'FACTORY_OWNER', tenantId, companyName });
    await loadTenantData(tenantId);
  };

  const stopImpersonating = async () => {
    setIsImpersonating(false);
    setProfile(originalProfile);
    if (originalProfile?.tenantId) {
      await loadTenantData(originalProfile.tenantId);
    } else {
      setTenantPlan('FREE');
      setLimits(null);
      setTrialDaysLeft(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user, profile, tenantPlan, limits, trialDaysLeft,
        loading, isImpersonating,
        logout,
        impersonateTenant,
        stopImpersonating,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
