import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseUser } from "./supabase";
import { supabase, supabaseConfigured } from "./supabase";
import { api } from "./api";

export interface Profile {
  id: string; email: string; display_name: string | null;
  locale: string; theme: string; role: "user" | "admin";
}

interface AuthCtx {
  user: SupabaseUser | null;
  profile: Profile | null;
  credits: number;
  loading: boolean;
  configured: boolean;
  emailVerified: boolean;
  refreshProfile: () => Promise<void>;
  refreshVerification: () => Promise<void>;
  resendVerification: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  google: () => Promise<void>;
  reset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

function requireSupabase() {
  if (!supabase) throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
  return supabase;
}

function throwIfError(error: { message: string } | null | undefined): void {
  if (error) throw new Error(error.message);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(supabaseConfigured);
  const [emailVerified, setEmailVerified] = useState(false);

  const refreshProfile = useCallback(async () => {
    try {
      const r = await api<{ user: Profile; creditsBalance: number }>("/api/auth/me");
      setProfile(r.user);
      setCredits(r.creditsBalance);
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      return;
    }

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      setEmailVerified(Boolean(nextUser?.email_confirmed_at));
      setLoading(false);
      // Defer API calls until the Supabase auth callback releases its internal lock.
      setTimeout(() => {
        if (nextUser) void refreshProfile();
        else { setProfile(null); setCredits(0); }
      }, 0);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [refreshProfile]);

  const value = useMemo<AuthCtx>(
    () => ({
      user, profile, credits, loading, emailVerified,
      configured: supabaseConfigured,
      refreshProfile,
      refreshVerification: async () => {
        const { data, error } = await requireSupabase().auth.getUser();
        throwIfError(error);
        if (!data.user) throw new Error("No active Supabase session.");
        setUser(data.user);
        setEmailVerified(Boolean(data.user.email_confirmed_at));
      },
      resendVerification: async () => {
        const current = user?.email;
        if (!current) return;
        const { error } = await requireSupabase().auth.resend({ type: "signup", email: current, options: { emailRedirectTo: window.location.origin } });
        throwIfError(error);
      },
      signIn: async (email, password) => {
        const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
        throwIfError(error);
      },
      signUp: async (email, password) => {
        const { error } = await requireSupabase().auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        throwIfError(error);
      },
      google: async () => {
        const { error } = await requireSupabase().auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.origin },
        });
        throwIfError(error);
      },
      reset: async (email) => {
        const { error } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` });
        throwIfError(error);
      },
      updatePassword: async (password) => {
        const { error } = await requireSupabase().auth.updateUser({ password });
        throwIfError(error);
      },
      logout: async () => {
        const { error } = await requireSupabase().auth.signOut();
        throwIfError(error);
      },
    }),
    [user, profile, credits, loading, emailVerified, refreshProfile],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
