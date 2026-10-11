import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { Task } from "../lib/types";
import { StatusBadge } from "../components/StatusBadge";

export default function Tasks() {
  const { t, tr } = useI18n();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  useEffect(() => { api<{ tasks: Task[] }>("/api/tasks").then((r) => setTasks(r.tasks)).catch(() => setTasks([])); }, []);
  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-bold">{t("nav.tasks")}</h1>
      {!tasks && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>}
      {tasks && tasks.length === 0 && <p className="text-slate-500">{t("common.none")}</p>}
      <ul className="space-y-2">
        {tasks?.map((r) => (
          <li key={r.id}>
            <Link to={`/task/${r.id}`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-brand-400 dark:border-slate-800 dark:bg-slate-900">
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.title}</div><div className="text-xs text-slate-500">{tr("Created", "أُنشئت")} {fmtDateTime(r.created_at)}</div></div>
              <StatusBadge status={r.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
