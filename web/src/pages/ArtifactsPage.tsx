import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import type { ArtifactRow } from "../lib/types";
import { ArtifactCard, ArtifactModal } from "../components/Artifacts";

export default function ArtifactsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<ArtifactRow[] | null>(null);
  const [preview, setPreview] = useState<ArtifactRow | null>(null);
  useEffect(() => { api<{ artifacts: ArtifactRow[] }>("/api/artifacts").then((r) => setItems(r.artifacts)).catch(() => setItems([])); }, []);
  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-bold">{t("nav.artifacts")}</h1>
      {!items && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-16" />)}</div>}
      {items && items.length === 0 && <p className="text-slate-500">{t("common.none")}</p>}
      <div className="space-y-2">{items?.map((a) => <ArtifactCard key={a.id} a={a} onPreview={setPreview} />)}</div>
      {preview && <ArtifactModal artifact={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
