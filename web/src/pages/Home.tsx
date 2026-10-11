import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import type { Task } from "../lib/types";
import { Composer, type StartPayload } from "../components/Composer";
import { StatusBadge } from "../components/StatusBadge";

export default function Home() {
  const { t, tr } = useI18n();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const projectId = sp.get("project") ?? undefined;
  const [recent, setRecent] = useState<Task[] | null>(null);
  const [preset, setPreset] = useState("");

  useEffect(() => {
    api<{ tasks: Task[] }>("/api/tasks").then((r) => setRecent(r.tasks.slice(0, 5))).catch(() => setRecent([]));
  }, []);

  const chips = [
    tr("Research the 10 best free AI tools, compare pricing and make a table", "ابحث عن أفضل 10 أدوات ذكاء اصطناعي مجانية وقارن أسعارها في جدول"),
    tr("Build a website for a small restaurant", "أنشئ لي موقعًا لمطعم صغير"),
    tr("Summarize this article: https://example.com", "لخّص هذا المقال: https://example.com"),
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col px-4 py-12 sm:py-20">
      <h1 className="mb-8 text-center text-3xl font-bold sm:text-4xl">{t("home.title")}</h1>
      <Composer key={preset} initialPrompt={preset} projectId={projectId} onSubmit={(p: StartPayload) => navigate("/task/new", { state: p })} />
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {chips.map((c) => (
          <button key={c} onClick={() => setPreset(c)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">{c}</button>
        ))}
      </div>
      {recent && recent.length > 0 && (
        <div className="mt-12">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{tr("Recent tasks", "المهام الأخيرة")}</h2>
          <ul className="space-y-2">
            {recent.map((r) => (
              <li key={r.id}>
                <Link to={`/task/${r.id}`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-brand-400 dark:border-slate-800 dark:bg-slate-900">
                  <span className="min-w-0 flex-1 truncate">{r.title}</span><StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
