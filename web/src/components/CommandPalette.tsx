import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { Icon, type IconName } from "./Icon";

export interface PaletteItem { label: string; to: string; icon: IconName }

export function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const { tr } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQ(""); setTimeout(() => ref.current?.focus(), 0); } }, [open]);
  const filtered = useMemo(() => items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())), [items, q]);

  if (!open) return null;
  const go = (to: string) => { navigate(to); onClose(); };

  return (
    <div className="fixed inset-0 z-50 grid place-items-start bg-slate-950/50 p-4 pt-[15vh]" onClick={onClose}>
      <div className="mx-auto w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 dark:border-slate-800">
          <Icon name="search" className="h-4 w-4 text-slate-400" />
          <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && filtered[0]) go(filtered[0].to); }}
            placeholder={tr("Go to…", "انتقل إلى…")} className="w-full bg-transparent py-3 outline-none" />
        </div>
        <ul className="max-h-72 overflow-auto p-2">
          {filtered.map((i) => (
            <li key={i.to}>
              <button onClick={() => go(i.to)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start hover:bg-slate-100 dark:hover:bg-slate-800">
                <Icon name={i.icon} className="h-4 w-4 text-slate-500" />{i.label}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">—</li>}
        </ul>
      </div>
    </div>
  );
}
