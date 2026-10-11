import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import { Icon, type IconName } from "./Icon";

export interface StartPayload {
  prompt: string;
  webResearch: boolean;
  browser: boolean;
  code: boolean;
  projectId?: string;
}

interface Attached { id: string; name: string; key: string }

function Toggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: IconName; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        on ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
           : "border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"}`}>
      <Icon name={icon} className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export function Composer({ onSubmit, initialPrompt = "", projectId, busy = false }: {
  onSubmit: (p: StartPayload) => void; initialPrompt?: string; projectId?: string; busy?: boolean;
}) {
  const { t, tr } = useI18n();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [web, setWeb] = useState(true);
  const [browser, setBrowser] = useState(false);
  const [code, setCode] = useState(false);
  const [files, setFiles] = useState<Attached[]>([]);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function onFiles(list: FileList | null) {
    if (!list) return;
    setUploading(true);
    setErr(null);
    try {
      for (const f of Array.from(list)) {
        const form = new FormData();
        form.set("file", f);
        if (projectId) form.set("projectId", projectId);
        const r = await api<{ id: string; key: string }>("/api/files", { form });
        setFiles((prev) => [...prev, { id: r.id, name: f.name, key: r.key }]);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  function submit() {
    const text = prompt.trim();
    if (!text || busy) return;
    const attachments = files.length
      ? `\n\n[Attached files — read them with the file_read tool using these storage keys]\n${files.map((f) => `- ${f.name}: ${f.key}`).join("\n")}`
      : "";
    onSubmit({ prompt: text + attachments, webResearch: web, browser, code, projectId });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-card focus-within:border-brand-400 dark:border-slate-800 dark:bg-slate-900">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(); }}
        placeholder={t("home.placeholder")}
        rows={4}
        className="w-full resize-none bg-transparent p-2 text-base outline-none placeholder:text-slate-400"
      />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-2 pb-2">
          {files.map((f) => (
            <span key={f.id} className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
              <Icon name="file" className="h-3 w-3" />{f.name}
              <button onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))}><Icon name="x" className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      {err && <p className="px-2 pb-2 text-xs text-red-600">{err}</p>}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <input ref={input} type="file" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
        <button type="button" onClick={() => input.current?.click()} disabled={uploading}
          className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
          <Icon name={uploading ? "spinner" : "paperclip"} className={`h-3.5 w-3.5 ${uploading ? "animate-spin" : ""}`} />
          {t("composer.attach")}
        </button>
        <Toggle on={web} onClick={() => setWeb(!web)} icon="globe" label={t("composer.web")} />
        <Toggle on={browser} onClick={() => setBrowser(!browser)} icon="monitor" label={t("composer.browser")} />
        <Toggle on={code} onClick={() => setCode(!code)} icon="code" label={t("composer.code")} />
        <button type="button" onClick={submit} disabled={!prompt.trim() || busy}
          className="ms-auto flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40">
          <Icon name={busy ? "spinner" : "send"} className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          {t("composer.run")}
        </button>
      </div>
      <p className="px-2 pt-2 text-[11px] text-slate-400">{tr("Ctrl/⌘ + Enter to run", "Ctrl/⌘ + Enter للتشغيل")}</p>
    </div>
  );
}
