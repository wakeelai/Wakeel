/**
 * Small Supabase Auth REST client for this app. It uses the documented Auth API
 * directly, avoiding another runtime dependency while supporting password auth,
 * email confirmation, password reset, Google OAuth and refresh-token rotation.
 */
export interface SupabaseUser {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
}

interface Session {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
  expires_at: number;
  user: SupabaseUser;
}

type AuthEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED";
type AuthCallback = (event: AuthEvent, session: Session | null) => void;
const STORAGE_KEY = "wakeel.supabase.auth.session.v1";
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, "");
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const supabaseConfigured = Boolean(url && publishableKey);

function sessionFrom(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Session>;
  if (typeof item.access_token !== "string" || typeof item.refresh_token !== "string" || !item.user || typeof item.user.id !== "string") return null;
  const expiresAt = typeof item.expires_at === "number"
    ? item.expires_at
    : Math.floor(Date.now() / 1000) + (typeof item.expires_in === "number" ? item.expires_in : 3600);
  return { ...item, expires_at: expiresAt } as Session;
}

function readSession(): Session | null {
  try { return sessionFrom(window.localStorage.getItem(STORAGE_KEY) ? JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) : null); }
  catch { return null; }
}

export const passwordRecoveryRedirect = typeof window !== "undefined" && new URLSearchParams(window.location.hash.replace(/^#/, "")).get("type") === "recovery";

let currentSession: Session | null = null;
let initialized = false;
let refreshPromise: Promise<Session | null> | null = null;
const listeners = new Set<AuthCallback>();

function notify(event: AuthEvent) {
  for (const listener of listeners) {
    try { listener(event, currentSession); } catch { /* an app listener must not break auth */ }
  }
}

function persist(session: Session | null, event: AuthEvent) {
  currentSession = session;
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* browser storage can be disabled; in-memory auth still works for this tab */ }
  notify(event);
}

function authUrl(path: string, query?: Record<string, string>): string {
  if (!url) throw new Error("VITE_SUPABASE_URL is not configured");
  const u = new URL(`/auth/v1/${path.replace(/^\/+/, "")}`, url);
  for (const [key, value] of Object.entries(query ?? {})) u.searchParams.set(key, value);
  return u.toString();
}

async function request<T>(path: string, options: {
  method?: string; body?: unknown; token?: string; query?: Record<string, string>;
} = {}): Promise<{ data: T | null; error: { message: string; code?: string } | null; responseStatus: number }> {
  if (!url || !publishableKey) {
    return { data: null, error: { message: "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY." }, responseStatus: 503 };
  }
  let response: Response;
  try {
    response = await fetch(authUrl(path, options.query), {
      method: options.method ?? "GET",
      headers: {
        apikey: publishableKey,
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    return { data: null, error: { message: "Could not connect to Supabase Auth. Check the project URL and network." }, responseStatus: 503 };
  }
  const payload = await response.json().catch(() => null) as (T & { msg?: string; message?: string; error_description?: string; error?: string; code?: string }) | null;
  if (!response.ok) {
    const msg = payload?.msg ?? payload?.message ?? payload?.error_description ?? payload?.error ?? `Supabase Auth request failed (${response.status})`;
    return { data: null, error: { message: msg, code: payload?.code }, responseStatus: response.status };
  }
  return { data: payload as T, error: null, responseStatus: response.status };
}

function setSessionFromResponse(payload: unknown, event: AuthEvent): Session | null {
  const session = sessionFrom(payload);
  if (session) {
    persist(session, event);
    return session;
  }
  const body = payload as { user?: SupabaseUser } | null;
  if (body?.user) currentSession = null;
  return null;
}

async function refreshSession(): Promise<Session | null> {
  if (refreshPromise) return refreshPromise;
  const old = currentSession ?? readSession();
  if (!old?.refresh_token) return null;
  refreshPromise = (async () => {
    const result = await request<Session>("token", {
      method: "POST",
      query: { grant_type: "refresh_token" },
      body: { refresh_token: old.refresh_token },
    });
    if (result.error || !result.data) {
      persist(null, "SIGNED_OUT");
      return null;
    }
    return setSessionFromResponse(result.data, "TOKEN_REFRESHED");
  })();
  try { return await refreshPromise; }
  finally { refreshPromise = null; }
}

function initializeFromRedirect(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  currentSession = readSession();
  // Supabase's implicit-flow redirect carries the session in the URL fragment.
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    const expiresIn = Number(hash.get("expires_in") || "3600");
    const user = currentSession?.user ?? { id: "", email: undefined };
    // The redirect token is verified against the Auth endpoint before app APIs rely on it.
    const provisional: Session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: hash.get("token_type") ?? "bearer",
      expires_in: expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      user,
    };
    currentSession = provisional;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(provisional)); } catch { /* ignore */ }
    void request<SupabaseUser>("user", { token: accessToken }).then((result) => {
      if (!result.error && result.data) {
        const verifiedSession = { ...provisional, user: result.data };
        persist(verifiedSession, "SIGNED_IN");
      } else {
        persist(null, "SIGNED_OUT");
      }
    });
    const cleanUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }
}

initializeFromRedirect();

async function getCurrentSession(): Promise<{ data: { session: Session | null }; error: null }> {
  initializeFromRedirect();
  let session = currentSession ?? readSession();
  if (session && session.expires_at <= Math.floor(Date.now() / 1000) + 45) {
    session = await refreshSession();
  }
  if (session) currentSession = session;
  return { data: { session }, error: null };
}

async function getCurrentUser(): Promise<{ data: { user: SupabaseUser | null }; error: { message: string; code?: string } | null }> {
  const { data: { session } } = await getCurrentSession();
  if (!session) return { data: { user: null }, error: { message: "No active session" } };
  const result = await request<SupabaseUser>("user", { token: session.access_token });
  if (result.error || !result.data) return { data: { user: null }, error: result.error };
  const next = { ...session, user: result.data };
  persist(next, "USER_UPDATED");
  return { data: { user: result.data }, error: null };
}

export const supabase = supabaseConfigured ? {
  auth: {
    onAuthStateChange(callback: AuthCallback) {
      initializeFromRedirect();
      listeners.add(callback);
      queueMicrotask(() => callback("INITIAL_SESSION", currentSession ?? readSession()));
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    async getSession() {
      return getCurrentSession();
    },
    async getUser() {
      return getCurrentUser();
    },
    async signInWithPassword(credentials: { email: string; password: string }) {
      const result = await request<Session>("token", { method: "POST", query: { grant_type: "password" }, body: credentials });
      if (result.error || !result.data) return { data: null, error: result.error };
      const session = setSessionFromResponse(result.data, "SIGNED_IN");
      return { data: { session, user: session?.user ?? null }, error: null };
    },
    async signUp(credentials: { email: string; password: string; options?: { emailRedirectTo?: string } }) {
      const result = await request<Session | { user?: SupabaseUser }>("signup", {
        method: "POST",
        query: credentials.options?.emailRedirectTo ? { redirect_to: credentials.options.emailRedirectTo } : undefined,
        body: { email: credentials.email, password: credentials.password },
      });
      if (result.error || !result.data) return { data: null, error: result.error };
      const session = setSessionFromResponse(result.data, "SIGNED_IN");
      return { data: { session, user: session?.user ?? (result.data as { user?: SupabaseUser }).user ?? null }, error: null };
    },
    async signInWithOAuth(credentials: { provider: "google"; options?: { redirectTo?: string } }) {
      const providerUrl = authUrl("authorize", {
        provider: credentials.provider,
        ...(credentials.options?.redirectTo ? { redirect_to: credentials.options.redirectTo } : {}),
        apikey: publishableKey!,
      });
      window.location.assign(providerUrl);
      return { data: { provider: credentials.provider, url: providerUrl }, error: null };
    },
    async resetPasswordForEmail(email: string, options?: { redirectTo?: string }) {
      const result = await request<unknown>("recover", {
        method: "POST",
        query: options?.redirectTo ? { redirect_to: options.redirectTo } : undefined,
        body: { email },
      });
      return { data: result.data, error: result.error };
    },
    async updateUser(attributes: { password: string }) {
      const { data: { session } } = await getCurrentSession();
      if (!session) return { data: { user: null }, error: { message: "The password reset session has expired. Request a new reset email." } };
      const result = await request<SupabaseUser>("user", { method: "PUT", token: session.access_token, body: attributes });
      if (result.error || !result.data) return { data: { user: null }, error: result.error };
      persist({ ...session, user: result.data }, "USER_UPDATED");
      return { data: { user: result.data }, error: null };
    },
    async resend(credentials: { type: "signup"; email: string; options?: { emailRedirectTo?: string } }) {
      const result = await request<unknown>("resend", {
        method: "POST",
        query: credentials.options?.emailRedirectTo ? { redirect_to: credentials.options.emailRedirectTo } : undefined,
        body: { type: credentials.type, email: credentials.email },
      });
      return { data: result.data, error: result.error };
    },
    async signOut() {
      const session = currentSession ?? readSession();
      if (session?.access_token) {
        await request<unknown>("logout", { method: "POST", token: session.access_token });
      }
      persist(null, "SIGNED_OUT");
      return { error: null };
    },
  },
} : null;

export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}
