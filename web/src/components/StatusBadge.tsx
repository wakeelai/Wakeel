import { useI18n } from "../i18n";

const styles: Record<string, string> = {
  queued: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  planning: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
  running: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  waiting: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  cancelled: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const label = t(`status.${status}`);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles.queued}`}>
      {label}
    </span>
  );
}
