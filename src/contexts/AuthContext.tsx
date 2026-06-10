import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/db/supabase';
import type { Profile } from '@/types/types';

export interface MfaFactor {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: 'verified' | 'unverified';
}

interface AuthContextType {
  user: Profile | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{
    error: string | null;
    user?: Profile | null;
    mfaRequired?: boolean;
    factorId?: string;
  }>;
  verifyMfa: (factorId: string, code: string) => Promise<{ error: string | null; user?: Profile | null }>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isClerk: boolean;
  isDataEntryClerk: boolean;
  isShippingAgent: boolean;
  canManageContainers: boolean;
  isAdminOrManager: boolean;
  requiresMfaSetup: boolean;
  sessionTimeoutMinutes: number;
  refreshSessionTimeout: () => Promise<void>;
  refreshMfaStatus: () => Promise<void>;
  listMfaFactors: () => Promise<MfaFactor[]>;
  enrollMfa: () => Promise<{ qrCode: string; secret: string; factorId: string; error: string | null }>;
  verifyMfaEnrollment: (factorId: string, code: string) => Promise<{ error: string | null }>;
  unenrollMfa: (factorId: string) => Promise<{ error: string | null }>;
  disableMfa: (factorId: string, code: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => ({ error: 'Not initialized' }),
  verifyMfa: async () => ({ error: null }),
  logout: async () => {},
  isAdmin: false,
  isClerk: false,
  isDataEntryClerk: false,
  isShippingAgent: false,
  canManageContainers: false,
  isAdminOrManager: false,
  requiresMfaSetup: false,
  sessionTimeoutMinutes: 30,
  refreshSessionTimeout: async () => {},
  refreshMfaStatus: async () => {},
  listMfaFactors: async () => [],
  enrollMfa: async () => ({ qrCode: '', secret: '', factorId: '', error: null }),
  verifyMfaEnrollment: async () => ({ error: null }),
  unenrollMfa: async () => ({ error: null }),
  disableMfa: async () => ({ error: null }),
});

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id,username,full_name,role,created_at')
    .eq('id', userId)
    .maybeSingle();
  return data as Profile | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        const profile = await fetchProfile(session.user.id);
        if (mounted) setUser(profile);
      }
      if (mounted) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_IN' && session?.user) {
        const profile = await fetchProfile(session.user.id);
        setUser(profile);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // username + password login (username stored as username@miaoda.com in auth)
  const login = async (username: string, password: string) => {
    const email = `${username.trim().toLowerCase()}@miaoda.com`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return { error: 'Invalid username or password.' };
    }

    // Check for MFA challenge
    if (data.session === null && (data as any).mfa_challenge) {
      const factors = await listMfaFactors();
      const totpFactor = factors.find((f) => f.factor_type === 'totp' && f.status === 'verified');
      if (totpFactor) {
        return { error: null, mfaRequired: true, factorId: totpFactor.id };
      }
    }

    const profile = data.user ? await fetchProfile(data.user.id) : null;
    setUser(profile);

    // Log successful login
    if (profile) {
      try {
        await supabase.rpc('record_login_event', {
          p_username: profile.username,
          p_user_id: profile.id,
          p_role: profile.role,
          p_success: true,
          p_failure_reason: null,
          p_user_agent: navigator.userAgent,
        });
      } catch { /* non-critical */ }
    }

    return { error: null, user: profile };
  };

  const verifyMfa = async (factorId: string, code: string) => {
    const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeErr || !challengeData) return { error: challengeErr?.message ?? 'MFA challenge failed' };

    const { data, error: verifyErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code,
    });
    if (verifyErr) return { error: 'Invalid MFA code.' };

    const profile = data.user ? await fetchProfile(data.user.id) : null;
    setUser(profile);
    return { error: null, user: profile };
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const refreshSessionTimeout = async () => {};
  const refreshMfaStatus = async () => {};

  const listMfaFactors = async (): Promise<MfaFactor[]> => {
    const { data } = await supabase.auth.mfa.listFactors();
    return (data?.all ?? []) as MfaFactor[];
  };

  const enrollMfa = async () => {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (error || !data) return { qrCode: '', secret: '', factorId: '', error: error?.message ?? 'Failed' };
    const totp = (data as any).totp;
    return { qrCode: totp?.qr_code ?? '', secret: totp?.secret ?? '', factorId: data.id, error: null };
  };

  const verifyMfaEnrollment = async (factorId: string, code: string) => {
    const { data: challengeData, error: err1 } = await supabase.auth.mfa.challenge({ factorId });
    if (err1 || !challengeData) return { error: err1?.message ?? 'Challenge failed' };
    const { error: err2 } = await supabase.auth.mfa.verify({ factorId, challengeId: challengeData.id, code });
    return { error: err2?.message ?? null };
  };

  const unenrollMfa = async (factorId: string) => {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    return { error: error?.message ?? null };
  };

  const disableMfa = async (_factorId: string, _code: string) => {
    return { error: null };
  };

  const role = user?.role ?? '';
  const isAdmin          = role === 'Admin';
  const isClerk          = role === 'Clerk';
  const isDataEntryClerk = role === 'Data Entry Clerk';
  const isShippingAgent  = role === 'Shipping Agent';
  const isAdminOrManager = role === 'Admin' || role === 'Manager';
  const canManageContainers = ['Admin', 'Manager', 'Supervisor'].includes(role);

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      verifyMfa,
      logout,
      isAdmin,
      isClerk,
      isDataEntryClerk,
      isShippingAgent,
      canManageContainers,
      isAdminOrManager,
      requiresMfaSetup: false,
      sessionTimeoutMinutes: 30,
      refreshSessionTimeout,
      refreshMfaStatus,
      listMfaFactors,
      enrollMfa,
      verifyMfaEnrollment,
      unenrollMfa,
      disableMfa,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
