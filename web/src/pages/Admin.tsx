import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";

type Row = Record<string, string | number | null>;
type Tab = "dashboard" | "users" | "payments" | "providers" | "settings";

interface Dash { totalUsers: number; totalTasks: number; failedTasks: number; totalRevenueUsd: number; totalPayments: number; providerUsageToday: { provider: string; calls: number }[] }
interface SettingsResp {
  settings: Record<string, number | boolean>;
  plans: Row[];
  providers: Record<string, boolean>;
}

const LIMIT_FIELDS: [string, string, string][] = [
  ["maxFreeAiCallsPerDay", "MAX_FREE_AI_CALLS_PER_DAY", "Max free AI calls / user / day"],
  ["maxBrowserTasksPerDay", "MAX_BROWSER_TASKS_PER_DAY", "Max browser tasks / user / day"],
  ["maxTaskRuntimeMs", "MAX_TASK_RUNTIME", "Max runtime per invocation (ms)"],
  ["maxStepsPerInvocation", "MAX_STEPS", "Agent steps per request (raise only on a paid Workers plan)"],
  ["maxFileSizeMb", "MAX_FILE_SIZE", "Max file size (MB)"],
  ["maxProjectsPerUser", "MAX_PROJECTS", "Max projects / user"],
  ["maxStorageMbPerUser", "MAX_STORAGE", "Max storage / user (MB)"],
];

function Table({ rows, cols }: { rows: Row[]; cols: { key: string; label: string; render?: (r: Row) => React.ReactNode }[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-xs text-slate-500 dark:bg-slate-800"><tr>{cols.map((c) => <th key={c.key} className="p-2 text-start">{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.id ?? i)} className="border-t border-slate-200 dark:border-slate-800">
              {cols.map((c) => <td key={c.key} className="max-w-[16rem] truncate p-2">{c.render ? c.render(r) : String(r[c.key] ?? "—")}</td>)}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={cols.length} className="p-4 text-center text-slate-400">—</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function Admin() {
  const { tr } = useI18n();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dash, setDash] = useState<Dash | null>(null);
  const [users, setUsers] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [payments, setPayments] = useState<Row[]>([]);
  const [cfg, setCfg] = useState<SettingsResp | null>(null);
  const [draft, setDraft] = useState<Record<string, number | boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const loadUsers = useCallback(() => api<{ users: Row[] }>(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => setUsers(r.users)), [q]);
  const loadPayments = useCallback(() => api<{ payments: Row[] }>("/api/admin/payments").then((r) => setPayments(r.payments)), []);
  const loadSettings = useCallback(() => api<SettingsResp>("/api/admin/settings").then((r) => { setCfg(r); setDraft(r.settings); }), []);

  useEffect(() => {
    if (tab === "dashboard") void api<Dash>("/api/admin/dashboard").then(setDash);
    if (tab === "users") void loadUsers();
    if (tab === "payments") void loadPayments();
    if (tab === "providers" || tab === "settings") void loadSettings();
  }, [tab, loadUsers, loadPayments, loadSettings]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2500); };
  const tabs: Tab[] = ["dashboard", "users", "payments", "providers", "settings"];
  const btn = "rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800";

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">{tr("Admin", "لوحة الإدارة")}</h1>
      <div className="flex flex-wrap gap-1">
        {tabs.map((k) => <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${tab === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{k}</button>)}
      </div>
      {msg && <p className="text-sm text-emerald-600">{msg}</p>}

      {tab === "dashboard" && dash && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[["Users", dash.totalUsers], ["Tasks", dash.totalTasks], ["Failed tasks", dash.failedTasks], ["Revenue (USD)", dash.totalRevenueUsd], ["Paid orders", dash.totalPayments]].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="text-xs text-slate-500">{k}</div><div className="text-2xl font-bold">{v}</div></div>
            ))}
          </div>
          <h2 className="font-semibold">{tr("AI provider calls today (all users)", "طلبات مزوّدي الذكاء الاصطناعي اليوم (لجميع المستخدمين)")}</h2>
          <Table rows={dash.providerUsageToday as Row[]} cols={[{ key: "provider", label: "Provider" }, { key: "calls", label: "Calls" }]} />
        </div>
      )}

      {tab === "users" && (
        <div className="space-y-3">
          <div className="flex gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void loadUsers()} placeholder="Search email…" className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" /><button className={btn} onClick={() => void loadUsers()}>Search</button></div>
          <Table rows={users} cols={[
            { key: "email", label: "Email" }, { key: "role", label: "Role" }, { key: "status", label: "Status" },
            { key: "created_at", label: "Joined", render: (r) => fmtDateTime(Number(r.created_at)) },
            { key: "actions", label: "", render: (r) => (
              <div className="flex gap-1">
                <button className={btn} onClick={async () => { await api(`/api/admin/users/${r.id}/suspend`, { body: { suspended: r.status !== "suspended" } }); await loadUsers(); }}>{r.status === "suspended" ? "Unsuspend" : "Suspend"}</button>
                <button className={btn} onClick={async () => { const v = window.prompt("Credits to add (negative to remove):", "100"); if (v && !Number.isNaN(Number(v))) { await api(`/api/admin/users/${r.id}/credits`, { body: { amount: Number(v), reason: "admin" } }); flash("Credits updated"); } }}>Credits</button>
              </div>) },
          ]} />
        </div>
      )}

      {tab === "payments" && (
        <Table rows={payments} cols={[
          { key: "id", label: "Payment ID" }, { key: "user_email", label: "User" }, { key: "amount_usd", label: "Amount" },
          { key: "pay_currency", label: "Token" }, { key: "network", label: "Network" }, { key: "status", label: "Status" },
          { key: "tx_hash", label: "Transaction" }, { key: "created_at", label: "Date", render: (r) => fmtDateTime(Number(r.created_at)) },
          { key: "actions", label: "", render: (r) => r.provider === "direct_wallet" && r.status === "pending_review" ? (
            <div className="flex gap-1">
              <button className="rounded-lg bg-emerald-600 px-2 py-1 text-xs text-white" onClick={async () => { if (window.confirm(`Verify tx ${r.tx_hash} on the block explorer first. Approve and add credits?`)) { await api(`/api/admin/payments/${r.id}/approve`, { method: "POST" }); await loadPayments(); flash("Approved"); } }}>Approve</button>
              <button className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={async () => { if (window.confirm("Reject this payment? No credits will be added.")) { await api(`/api/admin/payments/${r.id}/reject`, { method: "POST" }); await loadPayments(); flash("Rejected"); } }}>Reject</button>
            </div>) : null },
        ]} />
      )}

      {tab === "providers" && cfg && (
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
          {Object.entries(cfg.providers).map(([k, on]) => (
            <div key={k} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"><span className="font-medium">{k}</span><span className={`rounded-full px-2 py-0.5 text-xs ${on ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{on ? "configured" : "not configured"}</span></div>
          ))}
          <p className="col-span-full text-xs text-slate-500">{tr("API credentials are Cloudflare secrets. The receiving wallet is public configuration in wrangler.toml; neither is stored in the application database or editable here.", "مفاتيح API محفوظة كأسرار في Cloudflare. أما عنوان المحفظة المستلِمة فهو إعداد عام في wrangler.toml. لا تُخزَّن هذه البيانات في قاعدة بيانات التطبيق، ولا يمكن تعديلها من هنا.")}</p>
        </div>
      )}

      {tab === "settings" && cfg && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            {LIMIT_FIELDS.map(([key, , label]) => (
              <label key={key} className="text-sm"><span className="mb-1 block text-slate-500">{label}</span>
                <input type="number" min={1} value={Number(draft[key] ?? 0)} onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900" /></label>
            ))}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft.maintenanceMode)} onChange={(e) => setDraft({ ...draft, maintenanceMode: e.target.checked })} />{tr("Maintenance mode (blocks new tasks & uploads for non-admins)", "وضع الصيانة (يمنع غير المشرفين من إنشاء مهام جديدة ورفع الملفات)")}</label>
          </div>
          <button className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white" onClick={async () => { await api("/api/admin/settings", { body: draft }); await loadSettings(); flash("Saved"); }}>Save limits</button>
          <h2 className="font-semibold">{tr("Plans", "الخطط")}</h2>
          <Table rows={cfg.plans} cols={[
            { key: "name", label: "Plan" }, { key: "price_usd", label: "Price (USD)" }, { key: "credits_included", label: "Credits" }, { key: "is_active", label: "Active" },
            { key: "actions", label: "", render: (r) => (
              <button className={btn} onClick={async () => { const p = window.prompt("New price (USD):", String(r.price_usd)); const c = window.prompt("Credits included:", String(r.credits_included)); if (p !== null && c !== null && !Number.isNaN(Number(p)) && !Number.isNaN(Number(c))) { await api(`/api/admin/plans/${r.id}`, { method: "PATCH", body: { priceUsd: Number(p), creditsIncluded: Number(c) } }); await loadSettings(); flash("Plan updated"); } }}>Edit</button>) },
          ]} />
        </div>
      )}
    </div>
  );
}
