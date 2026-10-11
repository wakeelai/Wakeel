import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { useAuth } from "../lib/auth";
import { passwordRecoveryRedirect } from "../lib/supabase";
import { LangSwitch, ThemeButton } from "../components/Layout";

export default function Login() {
  const { tr } = useI18n();
  const { signIn, signUp, google, reset, updatePassword, user, configured } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "reset" | "newpassword">(() => passwordRecoveryRedirect ? "newpassword" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => { if (user && mode !== "newpassword") navigate("/", { replace: true }); }, [user, mode, navigate]);

  function explain(e: unknown): string | null {
    const code = (e as { code?: string }).code ?? "";
    if (code === "popup_closed_by_user") return null;
    if (["invalid_credentials", "invalid_grant", "user_not_found"].includes(code)) return tr("Wrong email or password.", "البريد أو كلمة المرور غير صحيحة.");
    if (["user_already_exists", "email_exists"].includes(code)) return tr("This email is already registered.", "هذا البريد مسجّل مسبقًا.");
    if (code === "weak_password") return tr("Password must be at least 6 characters.", "يجب ألا تقل كلمة المرور عن 6 أحرف.");
    if (["over_request_rate_limit", "too_many_requests"].includes(code)) return tr("Too many attempts. Try again later.", "محاولات كثيرة. حاول لاحقًا.");
    return (e as Error).message;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      if (mode === "signin") await signIn(email, password);
      else if (mode === "signup") { await signUp(email, password); setInfo(tr("Account created. We sent you a verification email.", "تم إنشاء الحساب. أرسلنا لك رسالة تفعيل.")); }
      else if (mode === "newpassword") { await updatePassword(password); navigate("/", { replace: true }); }
      else { await reset(email); setInfo(tr("Password reset email sent.", "تم إرسال رسالة استعادة كلمة المرور.")); }
    } catch (e) { setError(explain(e)); } finally { setBusy(false); }
  }

  const input = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900";

  return (
    <div className="grid h-full place-items-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="absolute end-4 top-4 flex gap-2"><LangSwitch /><ThemeButton /></div>
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-500 font-bold text-white">W</div>
          <h1 className="text-xl font-bold">{mode === "signin" ? tr("Sign in", "تسجيل الدخول") : mode === "signup" ? tr("Create account", "إنشاء حساب") : mode === "newpassword" ? tr("Choose a new password", "اختر كلمة مرور جديدة") : tr("Reset password", "استعادة كلمة المرور")}</h1>
        </div>
        {!configured && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{tr("Supabase isn't configured yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see README) and rebuild.", "لم يتم إعداد Supabase بعد. عيّن VITE_SUPABASE_URL وVITE_SUPABASE_PUBLISHABLE_KEY (راجع README) ثم أعد البناء.")}</p>}
        <form onSubmit={submit} className="space-y-3">
          {mode !== "newpassword" && <input className={input} type="email" required placeholder={tr("Email", "البريد الإلكتروني")} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
          {mode !== "reset" && <input className={input} type="password" required minLength={6} placeholder={tr("Password", "كلمة المرور")} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} />}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-emerald-600">{info}</p>}
          <button disabled={busy || !configured} className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {mode === "signin" ? tr("Sign in", "دخول") : mode === "signup" ? tr("Sign up", "تسجيل") : mode === "newpassword" ? tr("Update password", "تحديث كلمة المرور") : tr("Send reset link", "إرسال الرابط")}
          </button>
        </form>
        {(mode === "signin" || mode === "signup") && (
          <button disabled={!configured} onClick={async () => { setError(null); try { await google(); } catch (e) { setError(explain(e)); } }} className="mt-3 w-full rounded-xl border border-slate-300 py-2.5 font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">
            {tr("Continue with Google", "المتابعة عبر Google")}
          </button>
        )}
        {(mode === "signin" || mode === "signup") && <div className="mt-4 flex justify-between text-sm text-brand-600">
          <button onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setInfo(null); }}>{mode === "signin" ? tr("Create account", "إنشاء حساب") : tr("Have an account? Sign in", "لديك حساب؟ سجّل الدخول")}</button>
          {mode === "signin" && <button onClick={() => { setMode("reset"); setError(null); }}>{tr("Forgot password?", "نسيت كلمة المرور؟")}</button>}
        </div>}
      </div>
    </div>
  );
}
