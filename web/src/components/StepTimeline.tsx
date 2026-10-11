import { useState } from "react";
import { useI18n } from "../i18n";
import { fmtDuration, fmtTime } from "../lib/format";
import { useNow } from "../lib/hooks";
import { Icon } from "./Icon";

export interface StepView {
  index: number;
  phase: string;
  title: string;
  description: string | null;
  tool: string | null;
  status: string;
  startedAt: number | null;
  durationMs: number | null;
  details: Record<string, unknown> | null;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white"><Icon name="check" className="h-3.5 w-3.5" /></span>;
  if (status === "failed") return <span className="grid h-6 w-6 place-items-center rounded-full bg-red-500 text-white"><Icon name="x" className="h-3.5 w-3.5" /></span>;
  if (status === "running") return <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-500 text-white"><Icon name="spinner" className="h-3.5 w-3.5 animate-spin" /></span>;
  if (status === "waiting") return <span className="grid h-6 w-6 place-items-center rounded-full bg-amber-500 text-white"><Icon name="alert" className="h-3.5 w-3.5" /></span>;
  return <span className="grid h-6 w-6 place-items-center rounded-full border-2 border-slate-300 dark:border-slate-600" />;
}

export function StepTimeline({ steps }: { steps: StepView[] }) {
  const { t, tr } = useI18n();
  const [open, setOpen] = useState<number | null>(null);
  const now = useNow(steps.some((s) => s.status === "running"));

  if (steps.length === 0) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton h-14 w-full" />)}
      </div>
    );
  }

  return (
    <ol className="relative space-y-1">
      {steps.map((s, i) => {
        const duration = s.status === "running" && s.startedAt ? now - s.startedAt : s.durationMs;
        const expanded = open === s.index;
        return (
          <li key={s.index} className="relative ps-9">
            {i < steps.length - 1 && (
              <span className="absolute start-3 top-7 h-[calc(100%-1rem)] w-px bg-slate-200 dark:bg-slate-700" />
            )}
            <span className="absolute start-0 top-2"><StatusIcon status={s.status} /></span>
            <button
              onClick={() => setOpen(expanded ? null : s.index)}
              className="w-full rounded-lg px-3 py-2 text-start transition hover:bg-slate-100 dark:hover:bg-slate-800/60"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-brand-600 dark:text-brand-300">
                  {t(`phase.${s.phase}`)}
                </span>
                {s.tool && (
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {s.tool}
                  </span>
                )}
                <span className="ms-auto flex items-center gap-1 text-xs text-slate-500">
                  <Icon name="clock" className="h-3 w-3" />
                  {fmtDuration(duration)}
                </span>
              </div>
              <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{s.title}</div>
              {s.description && <div className="text-sm text-slate-500 dark:text-slate-400">{s.description}</div>}
            </button>
            {expanded && (
              <div className="mx-3 mb-2 rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-800/70">
                <div className="mb-1 text-slate-500">
                  {tr("Started", "بدأت")}: {fmtTime(s.startedAt)} · {tr("Status", "الحالة")}: {t(`status.${s.status}`)}
                </div>
                <pre className="whitespace-pre-wrap break-words font-mono text-slate-700 dark:text-slate-300">
                  {s.details ? JSON.stringify(s.details, null, 2) : tr("No details yet.", "لا توجد تفاصيل بعد.")}
                </pre>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
