import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { api, downloadFile } from "../lib/api";
import type { ArtifactRow } from "../lib/types";
import { Icon } from "./Icon";

export function ArtifactCard({ a, onPreview }: { a: ArtifactRow; onPreview: (a: ArtifactRow) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-800 dark:bg-slate-900">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
        <Icon name={a.type === "website" ? "layout" : "file"} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-slate-900 dark:text-slate-100">{a.title}</div>
        <div className="text-xs uppercase text-slate-500">{a.type}{a.task_title ? ` · ${a.task_title}` : ""}</div>
      </div>
      <button onClick={() => onPreview(a)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
        {t("common.preview")}
      </button>
      {a.file_id && (
        <button onClick={() => void downloadFile(a.file_id as string, a.title)} className="rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
          {t("common.download")}
        </button>
      )}
    </div>
  );
}

interface Content { content: string; type: string; title: string; mime: string }

export function ArtifactModal({ artifact, onClose }: { artifact: ArtifactRow; onClose: () => void }) {
  const { t, tr } = useI18n();
  const [data, setData] = useState<Content | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Content>(`/api/artifacts/${artifact.id}/content`).then(setData).catch((e: Error) => setError(e.message));
  }, [artifact.id]);

  const isWeb = artifact.type === "website" || artifact.type === "html";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0 flex-1 truncate font-semibold">{artifact.title}</div>
          {isWeb && <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">{tr("Live preview (sandboxed)", "معاينة حية (معزولة)")}</span>}
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"><Icon name="x" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error && <p className="text-red-600">{error}</p>}
          {!data && !error && <div className="skeleton h-64 w-full" />}
          {data && isWeb && (
            // allow-scripts WITHOUT allow-same-origin: generated pages can run JS but can never touch our cookies/storage/API.
            <iframe title={artifact.title} sandbox="allow-scripts" srcDoc={data.content} className="h-[65vh] w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700" />
          )}
          {data && !isWeb && (
            <pre className="whitespace-pre-wrap break-words font-mono text-sm text-slate-800 dark:text-slate-200">{data.content}</pre>
          )}
        </div>
        {artifact.file_id && (
          <div className="border-t border-slate-200 p-3 text-end dark:border-slate-800">
            <button onClick={() => void downloadFile(artifact.file_id as string, artifact.title)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              {t("common.download")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
