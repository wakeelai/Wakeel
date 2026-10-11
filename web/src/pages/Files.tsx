import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { api, downloadFile } from "../lib/api";
import { fmtBytes, fmtDateTime } from "../lib/format";
import type { FileRow } from "../lib/types";
import { Icon } from "../components/Icon";

export default function Files() {
  const { t, tr } = useI18n();
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = () => api<{ files: FileRow[] }>("/api/files").then((r) => setFiles(r.files)).catch(() => setFiles([]));
  useEffect(() => { void load(); }, []);

  async function upload(list: FileList | null) {
    if (!list) return;
    setBusy(true); setError(null);
    try {
      for (const f of Array.from(list)) { const form = new FormData(); form.set("file", f); await api("/api/files", { form }); }
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  }

  async function removeFile(file: FileRow) {
    if (!window.confirm(tr(`Delete ${file.filename}?`, `هل تريد حذف الملف ${file.filename}؟`))) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/files/${file.id}`, { method: "DELETE" });
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center">
        <h1 className="flex-1 text-2xl font-bold">{t("nav.files")}</h1>
        <input ref={input} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
        <button onClick={() => input.current?.click()} disabled={busy} className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          <Icon name={busy ? "spinner" : "paperclip"} className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />{tr("Upload", "رفع")}
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">PDF, DOCX, XLSX, CSV, TXT, JSON, PNG, JPG, ZIP</p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {!files && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12" />)}</div>}
      {files && files.length === 0 && <p className="text-slate-500">{t("common.none")}</p>}
      <ul className="space-y-2">
        {files?.map((f) => (
          <li key={f.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <Icon name="file" className="h-4 w-4 text-slate-400" />
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{f.filename}</div><div className="text-xs text-slate-500">{fmtBytes(f.size_bytes)} · {f.kind} · {fmtDateTime(f.created_at)}</div></div>
            <button onClick={() => void downloadFile(f.id, f.filename)} className="rounded-lg p-2 text-brand-600 hover:bg-slate-100 dark:hover:bg-slate-800"><Icon name="download" className="h-4 w-4" /></button>
            <button onClick={() => void removeFile(f)} disabled={busy} className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950">{tr("Delete", "حذف")}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
