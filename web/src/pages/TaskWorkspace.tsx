import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../i18n";
import { useAuth } from "../lib/auth";
import { api, downloadFile, parseJson, streamSSE, type SSEEvent } from "../lib/api";
import { executePython } from "../lib/python";
import { fmtBytes, fmtDateTime, fmtDuration, fmtTime } from "../lib/format";
import type { ArtifactRow, FileRow, LogRow, Message, Source, Step, Task } from "../lib/types";
import { ArtifactCard, ArtifactModal } from "../components/Artifacts";
import type { StartPayload } from "../components/Composer";
import { Icon } from "../components/Icon";
import { StatusBadge } from "../components/StatusBadge";
import { StepTimeline, type StepView } from "../components/StepTimeline";

interface Detail { task: Task; steps: Step[]; sources: Source[]; artifacts: ArtifactRow[]; messages: Message[] }
interface PlannedStep { phase: string; title: string; description: string; tool: string | null }
type Tab = "overview" | "steps" | "sources" | "files" | "artifacts" | "logs";
const TABS: Tab[] = ["overview", "steps", "sources", "files", "artifacts", "logs"];
const ACTIVE = ["queued", "planning", "running", "waiting"];

export default function TaskWorkspace() {
  const { id = "new" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, tr } = useI18n();
  const { refreshProfile } = useAuth();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [planned, setPlanned] = useState<PlannedStep[]>([]);
  const [feed, setFeed] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [preview, setPreview] = useState<ArtifactRow | null>(null);
  const [followUp, setFollowUp] = useState("");

  const taskIdRef = useRef<string | null>(id === "new" ? null : id);
  const startedKeyRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const pendingClientToolRef = useRef<{ stepIndex: number; code: string } | null>(null);

  const reload = useCallback(async (taskId: string) => {
    try {
      const [d, f, l] = await Promise.all([
        api<Detail>(`/api/tasks/${taskId}`),
        api<{ files: FileRow[] }>(`/api/files?taskId=${taskId}`),
        api<{ logs: LogRow[] }>(`/api/tasks/${taskId}/logs`),
      ]);
      setDetail(d);
      setFiles(f.files);
      setLogs(l.logs);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const refresh = useCallback(() => {
    if (taskIdRef.current) void reload(taskIdRef.current);
  }, [reload]);

  const push = (line: string) => setFeed((f) => [...f, line]);

  function reasonText(reason: unknown): string {
    if (reason === "providers_exhausted")
      return tr("All free AI providers are out of quota for now. Your task is saved — resume it later.", "نفدت حصة جميع مزوّدي الذكاء الاصطناعي المجانيين حاليًا. حُفظت مهمتك، ويمكنك استئنافها لاحقًا.");
    if (reason === "cancelled") return tr("Task cancelled.", "أُلغيت المهمة.");
    if (reason === "already_running") return tr("This task is already running (another tab or request). Refresh in a moment.", "هذه المهمة قيد التنفيذ بالفعل (تبويب أو طلب آخر). حدّث الصفحة بعد لحظات.");
    return String(reason ?? "error");
  }

  const handleEvent = useCallback((e: SSEEvent) => {
    const data = parseJson<Record<string, unknown>>(e.data, {});
    switch (e.event) {
      case "task_id":
        taskIdRef.current = e.data;
        navigate(`/task/${e.data}`, { replace: true });
        void refreshProfile();
        break;
      case "plan_created": {
        const steps = (data.steps as PlannedStep[]) ?? [];
        setPlanned(steps);
        push(tr(`Plan ready — ${steps.length} steps`, `الخطة جاهزة، وعدد خطواتها ${steps.length}`));
        break;
      }
      case "plan_revised": {
        const steps = (data.steps as PlannedStep[]) ?? [];
        push(tr(`Recovery plan revised — ${steps.length} replacement steps`, `أُعيد تخطيط المهمة، وأصبح عدد الخطوات البديلة ${steps.length}`));
        refresh();
        break;
      }
      case "client_tool_required":
        pendingClientToolRef.current = { stepIndex: Number(data.index), code: String(data.code ?? "") };
        pausedRef.current = true;
        push(tr("Running Python in your browser…", "جارٍ تشغيل بايثون في متصفحك…"));
        break;
      case "step_started":
        push(`${t(`phase.${String(data.phase)}`)}… ${String(data.title ?? "")}`);
        refresh();
        break;
      case "step_completed":
        push(`✓ ${String(data.summary ?? "")}`);
        refresh();
        break;
      case "step_failed":
        push(`✗ ${String(data.error ?? "")}`);
        refresh();
        break;
      case "waiting_confirmation":
        push(tr("Waiting for your confirmation…", "بانتظار تأكيدك…"));
        refresh();
        break;
      case "task_paused":
        pausedRef.current = true; // server hit its per-invocation budget; we auto-resume
        break;
      case "task_completed":
        push(tr("Done.", "تم."));
        refresh();
        void refreshProfile();
        break;
      case "task_failed":
        if (data.reason === "timeout_will_resume") pausedRef.current = true;
        else setError(reasonText(data.reason));
        refresh();
        break;
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, refresh, refreshProfile]);

  const run = useCallback(async (path: string, body: unknown) => {
    setStreaming(true);
    setError(null);
    try {
      let p = path;
      let b = body;
      for (;;) {
        pausedRef.current = false;
        await streamSSE(p, b, handleEvent);
        if (!pausedRef.current || !taskIdRef.current) break;
        const pending = pendingClientToolRef.current;
        if (pending) {
          pendingClientToolRef.current = null;
          const result = await executePython(pending.code);
          p = `/api/tasks/${taskIdRef.current}/client-result`;
          b = { stepIndex: pending.stepIndex, ok: result.ok, output: result.output, error: result.error };
        } else {
          p = `/api/tasks/${taskIdRef.current}/resume`; // bounded execution continues from persisted state
          b = {};
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStreaming(false);
      refresh();
    }
  }, [handleEvent, refresh]);

  useEffect(() => {
    if (id === "new") {
      const st = location.state as StartPayload | null;
      if (!st?.prompt) { navigate("/", { replace: true }); return; }
      if (startedKeyRef.current === location.key) return; // StrictMode double-effect guard
      startedKeyRef.current = location.key;
      taskIdRef.current = null;
      setDetail(null); setPlanned([]); setFeed([]); setError(null); setFiles([]); setLogs([]);
      void run("/api/tasks", st);
      return;
    }
    taskIdRef.current = id;
    void reload(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, location.key]);

  const task = detail?.task;
  const status = task?.status ?? (streaming ? "planning" : "queued");
  const waitingStep = detail?.steps.find((s) => s.status === "waiting");
  const canResume = !streaming && !!task && ["planning", "running", "waiting", "failed"].includes(task.status) && !waitingStep;
  const active = ACTIVE.includes(status) && streaming;

  const steps: StepView[] = detail && detail.steps.length
    ? detail.steps.map((s) => ({
        index: s.step_index, phase: s.phase, title: s.title, description: s.description, tool: s.tool_used,
        status: s.status, startedAt: s.started_at, durationMs: s.duration_ms, details: parseJson<Record<string, unknown> | null>(s.details_json, null),
      }))
    : planned.map((p, i) => ({ index: i, phase: p.phase, title: p.title, description: p.description, tool: p.tool, status: "queued", startedAt: null, durationMs: null, details: null }));

  async function answer(approve: boolean) {
    const tid = taskIdRef.current;
    if (!tid || !waitingStep) return;
    if (!approve) {
      await api(`/api/tasks/${tid}/confirm`, { body: { stepIndex: waitingStep.step_index, approve: false } });
      await reload(tid);
      return;
    }
    await run(`/api/tasks/${tid}/confirm`, { stepIndex: waitingStep.step_index, approve: true });
  }

  async function cancel() {
    const tid = taskIdRef.current;
    if (!tid) return;
    await api(`/api/tasks/${tid}/cancel`, { method: "POST" });
    await reload(tid);
  }

  function sendFollowUp() {
    const text = followUp.trim();
    if (!text || !task) return;
    const context = task.result_summary ? `Previous task: ${task.prompt}\n\nPrevious result:\n${task.result_summary.slice(0, 3000)}\n\n` : "";
    navigate("/task/new", { state: { prompt: `${context}Follow-up instruction: ${text}`, webResearch: true, browser: false, code: false, projectId: task.project_id ?? undefined } satisfies StartPayload });
    setFollowUp("");
  }

  const agentMessages = detail?.messages.filter((m) => m.role === "agent") ?? [];
  const tabLabel: Record<Tab, string> = {
    overview: tr("Overview", "نظرة عامة"), steps: tr("Steps", "الخطوات"), sources: tr("Sources", "المصادر"),
    files: tr("Files", "الملفات"), artifacts: tr("Artifacts", "المخرجات"), logs: tr("Logs", "السجلات"),
  };

  return (
    <div className="grid min-h-full gap-0 lg:h-full lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(300px,400px)]">
      {/* LEFT — instructions & live feed */}
      <section className="flex flex-col gap-4 border-slate-200 p-4 dark:border-slate-800 lg:overflow-y-auto lg:border-e">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold">{task?.title ?? tr("New task", "مهمة جديدة")}</h2>
          <StatusBadge status={status} />
        </div>
        {task && <div className="rounded-2xl rounded-ss-sm bg-brand-600 p-3 text-sm text-white"><p className="whitespace-pre-wrap break-words">{task.prompt}</p></div>}
        {feed.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            {feed.slice(-12).map((l, i) => <li key={i} className="break-words">{l}</li>)}
            {active && <li className="flex items-center gap-1 text-brand-600"><Icon name="spinner" className="h-3 w-3 animate-spin" />{tr("Working…", "جارٍ العمل…")}</li>}
          </ul>
        )}
        {agentMessages.map((m) => (
          <div key={m.id} className="rounded-2xl rounded-se-sm border border-slate-200 bg-white p-3 text-sm shadow-card dark:border-slate-800 dark:bg-slate-900">
            <p className="whitespace-pre-wrap break-words">{m.content}</p>
          </div>
        ))}
        {task && ACTIVE.includes(task.status) && (
          <button onClick={() => void cancel()} className="self-start rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">{t("common.cancel")}</button>
        )}
        {task?.status === "completed" && (
          <div className="mt-auto flex gap-2">
            <input value={followUp} onChange={(e) => setFollowUp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendFollowUp()}
              placeholder={tr("Follow-up instruction…", "تعليمات إضافية…")} className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900" />
            <button onClick={sendFollowUp} className="rounded-xl bg-brand-600 px-3 text-white hover:bg-brand-700"><Icon name="send" className="h-4 w-4" /></button>
          </div>
        )}
      </section>

      {/* CENTER — live execution */}
      <section className="space-y-4 p-4 lg:overflow-y-auto">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tr("Live execution", "التنفيذ المباشر")}</h3>
        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{error}</span>
          </div>
        )}
        {waitingStep && !streaming && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
            <p className="mb-1 font-semibold text-amber-900 dark:text-amber-200">{tr("Confirmation required", "التأكيد مطلوب")}</p>
            <p className="mb-3 text-sm text-amber-800 dark:text-amber-300">
              {tr("The agent is ready to run a sensitive action:", "الوكيل جاهز لتنفيذ إجراء حساس:")} <b>{waitingStep.title}</b>{waitingStep.tool_used ? ` (${waitingStep.tool_used})` : ""}. {tr("Do you want to continue?", "هل تريد المتابعة؟")}
            </p>
            <div className="flex gap-2">
              <button onClick={() => void answer(true)} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">{t("common.confirm")}</button>
              <button onClick={() => void answer(false)} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm hover:bg-white dark:border-slate-600">{t("common.cancel")}</button>
            </div>
          </div>
        )}
        {canResume && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-900">
            <span>{tr("This task isn't running. Progress is saved.", "هذه المهمة متوقفة. التقدم محفوظ.")}</span>
            <button onClick={() => taskIdRef.current && void run(`/api/tasks/${taskIdRef.current}/resume`, {})} className="rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700">
              {tr("Resume task", "استئناف المهمة")}
            </button>
          </div>
        )}
        <StepTimeline steps={steps} />
      </section>

      {/* RIGHT — tabs */}
      <section className="flex flex-col border-slate-200 dark:border-slate-800 lg:min-h-0 lg:border-s">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2 pt-2 dark:border-slate-800">
          {TABS.map((k) => (
            <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap rounded-t-lg px-3 py-2 text-xs font-medium ${tab === k ? "bg-white text-brand-700 dark:bg-slate-900 dark:text-brand-200" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>{tabLabel[k]}</button>
          ))}
        </div>
        <div className="space-y-3 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {tab === "overview" && (
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-2 gap-2">
                {[
                  [tr("Status", "الحالة"), t(`status.${status}`)],
                  [tr("Created", "أُنشئت"), fmtDateTime(task?.created_at)],
                  [tr("Steps done", "خطوات منجزة"), `${detail?.steps.filter((s) => s.status === "completed").length ?? 0}/${steps.length}`],
                  [tr("Sources", "المصادر"), String(detail?.sources.length ?? 0)],
                  [tr("Artifacts", "المخرجات"), String(detail?.artifacts.length ?? 0)],
                  [tr("Duration", "المدة"), task?.completed_at ? fmtDuration(task.completed_at - task.created_at) : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-slate-100 p-2 dark:bg-slate-900"><dt className="text-[11px] text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>
                ))}
              </dl>
              {task?.result_summary && (<><h4 className="font-semibold">{tr("Result", "النتيجة")}</h4><p className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">{task.result_summary}</p></>)}
            </div>
          )}
          {tab === "steps" && (
            <ul className="space-y-1 text-sm">
              {steps.map((s) => (
                <li key={s.index} className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-900">
                  <span className="min-w-0 flex-1 truncate">{s.index + 1}. {s.title}</span>
                  <span className="text-xs text-slate-500">{fmtDuration(s.durationMs)}</span><StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
          {tab === "sources" && (
            detail?.sources.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs">
                  <thead className="text-slate-500"><tr><th className="p-1 text-start">{tr("Title", "العنوان")}</th><th className="p-1 text-start">URL</th><th className="p-1 text-start">{tr("Retrieved At", "وقت الجلب")}</th></tr></thead>
                  <tbody>
                    {detail.sources.map((s) => (
                      <tr key={s.id} className="border-t border-slate-200 align-top dark:border-slate-800">
                        <td className="p-1">{s.title ?? "—"}</td>
                        <td className="max-w-[10rem] break-all p-1"><a className="text-brand-600 underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a></td>
                        <td className="whitespace-nowrap p-1">{fmtTime(s.retrieved_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-slate-500">{t("common.none")}</p>
          )}
          {tab === "files" && (
            files.length ? (
              <ul className="space-y-2">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-slate-900">
                    <Icon name="file" className="h-4 w-4" /><span className="min-w-0 flex-1 truncate">{f.filename}</span>
                    <span className="text-xs text-slate-500">{fmtBytes(f.size_bytes)}</span>
                    <button onClick={() => void downloadFile(f.id, f.filename)} title={t("common.download")}><Icon name="download" className="h-4 w-4 text-brand-600" /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">{t("common.none")}</p>
          )}
          {tab === "artifacts" && (
            detail?.artifacts.length ? <div className="space-y-2">{detail.artifacts.map((a) => <ArtifactCard key={a.id} a={a} onPreview={setPreview} />)}</div>
              : <p className="text-sm text-slate-500">{t("common.none")}</p>
          )}
          {tab === "logs" && (
            logs.length ? (
              <ul className="space-y-1 font-mono text-[11px]">
                {logs.map((l) => (
                  <li key={l.id} className="rounded bg-slate-100 p-2 dark:bg-slate-900"><span className="text-slate-500">{fmtTime(l.created_at)}</span> <b>{l.event}</b>
                    <div className="mt-0.5 break-all text-slate-500">{(l.data_json ?? "").slice(0, 200)}</div></li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">{t("common.none")}</p>
          )}
        </div>
      </section>
      {preview && <ArtifactModal artifact={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
