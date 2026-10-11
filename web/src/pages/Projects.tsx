import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { Project, Task } from "../lib/types";
import { StatusBadge } from "../components/StatusBadge";
import { Icon } from "../components/Icon";

export default function Projects() {
  const { t, tr } = useI18n();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ projects: Project[] }>("/api/projects").then((r) => setProjects(r.projects)).catch(() => setProjects([]));
  useEffect(() => { void load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try { await api("/api/projects", { body: { name } }); setName(""); await load(); } catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-bold">{t("nav.projects")}</h1>
      <form onSubmit={create} className="mb-6 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("New project name (e.g. My Marketing Agency)", "اسم مشروع جديد (مثال: وكالتي التسويقية)")}
          className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900" />
        <button className="flex items-center gap-1 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"><Icon name="plus" className="h-4 w-4" />{tr("Create", "إنشاء")}</button>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {!projects && <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <div key={i} className="skeleton h-24" />)}</div>}
      {projects && projects.length === 0 && <p className="text-slate-500">{t("common.none")}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {projects?.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card hover:border-brand-400 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 font-semibold"><Icon name="folder" className="h-4 w-4 text-brand-600" />{p.name}</div>
            <div className="mt-1 text-xs text-slate-500">{fmtDateTime(p.updated_at)}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ProjectDetail() {
  const { id = "" } = useParams();
  const { tr } = useI18n();
  const navigate = useNavigate();
  const [data, setData] = useState<{ project: Project; tasks: Task[] } | null>(null);
  useEffect(() => { api<{ project: Project; tasks: Task[] }>(`/api/projects/${id}`).then(setData).catch(() => setData(null)); }, [id]);
  if (!data) return <div className="p-6"><div className="skeleton h-24" /></div>;
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">{data.project.name}</h1>
        <button onClick={() => navigate(`/?project=${id}`)} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">{tr("New task in project", "مهمة جديدة في المشروع")}</button>
      </div>
      <ul className="space-y-2">
        {data.tasks.map((r) => (
          <li key={r.id}><Link to={`/task/${r.id}`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-brand-400 dark:border-slate-800 dark:bg-slate-900"><span className="min-w-0 flex-1 truncate">{r.title}</span><StatusBadge status={r.status} /></Link></li>
        ))}
        {data.tasks.length === 0 && <p className="text-slate-500">—</p>}
      </ul>
    </div>
  );
}
