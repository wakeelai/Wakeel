import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { useAuth } from "../lib/auth";
import { Icon, type IconName } from "../components/Icon";
import { LangSwitch, ThemeButton } from "../components/Layout";
import { PricingSection } from "../components/PricingSection";

export default function Landing() {
  const { t, tr } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const start = () => navigate(user ? "/" : "/login");

  const features: { icon: IconName; title: string; body: string; soon?: boolean }[] = [
    { icon: "play", title: tr("AI Agent", "وكيل ذكي"), body: tr("Plans your task into steps, picks tools, executes, and verifies.", "يحوّل مهمتك إلى خطوات، ويختار الأدوات المناسبة، ثم ينفّذها ويتحقق من النتائج.") },
    { icon: "globe", title: tr("Web Research", "بحث على الويب"), body: tr("Reads real pages and cites every source with title, URL and retrieval time.", "يقرأ صفحات الويب الفعلية، ويوثّق كل مصدر بعنوانه ورابطه ووقت الاطلاع عليه.") },
    { icon: "monitor", title: tr("Browser Automation", "أتمتة المتصفح"), body: tr("Optional browser agent. Anything risky pauses for your confirmation.", "وكيل متصفح اختياري. تتوقف الإجراءات الحساسة حتى تؤكدها."), soon: true },
    { icon: "code", title: tr("Code Interpreter", "مفسّر الشيفرات البرمجية"), body: tr("Python & JavaScript run sandboxed in your browser — never on our server.", "تُشغَّل برامج Python وJavaScript في بيئة معزولة داخل متصفحك، لا على خادمنا."), soon: true },
    { icon: "file", title: tr("File Generation", "إنشاء الملفات"), body: tr("Reports, tables and data saved as downloadable artifacts.", "تقارير وجداول وبيانات تُحفظ كمخرجات قابلة للتنزيل.") },
    { icon: "layout", title: tr("Website Builder", "منشئ المواقع"), body: tr("Describe a site, get a live sandboxed preview you can download.", "صف موقعًا واحصل على معاينة حية معزولة يمكنك تنزيلها.") },
    { icon: "card", title: tr("Crypto Payments", "الدفع بالعملات الرقمية"), body: tr("USDT via NOWPayments or direct wallet. We never ask for a seed phrase.", "ادفع بعملة USDT عبر NOWPayments أو مباشرةً إلى محفظة. لا نطلب منك أبدًا عبارة الاسترداد.") },
  ];

  const faq = [
    [tr("Is it really free to start?", "هل البداية مجانية فعلًا؟"), tr("Yes. The free tier runs on free-tier AI providers with daily limits. If they run out, your task is saved and can be resumed — we never switch to a paid API automatically.", "نعم. تتيح الخطة المجانية استخدام مزوّدي الذكاء الاصطناعي ضمن حدود يومية. إذا نفدت الحصة، تُحفَظ مهمتك لتستأنفها لاحقًا، ولا ننتقل تلقائيًا إلى خدمة مدفوعة.")],
    [tr("Can the agent buy things or delete data?", "هل يستطيع الوكيل الشراء أو الحذف؟"), tr("Never on its own. Purchases, deletions, publishing and other sensitive actions always stop and ask you to confirm.", "لا، لا ينفّذ الوكيل هذه الإجراءات من تلقاء نفسه. تتوقف عمليات الشراء والحذف والنشر وغيرها من الإجراءات الحساسة، ولا تُنفّذ إلا بعد تأكيدك.")],
    [tr("How do crypto payments work?", "كيف يعمل الدفع بالعملات الرقمية؟"), tr("Pay USDT through NOWPayments, or send USDT to our wallet. Transfers are monitored automatically; you can enter the transaction hash for an immediate check.", "ادفع بعملة USDT عبر NOWPayments أو أرسل المبلغ إلى محفظتنا مباشرةً. تُراقَب التحويلات تلقائيًا، ويمكنك إدخال معرّف المعاملة للتحقق الفوري.")],
    [tr("Which languages are supported?", "ما اللغات المدعومة؟"), tr("Arabic and English, with full RTL/LTR support.", "العربية والإنجليزية، مع دعم الكتابة من اليمين إلى اليسار (RTL) ومن اليسار إلى اليمين (LTR).")],
  ];

  return (
    <div className="h-full overflow-y-auto bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-500 font-bold text-white">W</div>
          <span className="text-lg font-bold">Wakeel</span>
          <div className="ms-auto flex items-center gap-2"><LangSwitch /><ThemeButton />
            <button onClick={start} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">{user ? tr("Open app", "افتح التطبيق") : tr("Sign in", "تسجيل الدخول")}</button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-4 py-20 text-center">
        <h1 className="bg-gradient-to-br from-brand-600 to-accent-500 bg-clip-text text-4xl font-extrabold leading-tight text-transparent sm:text-6xl">{t("landing.title")}</h1>
        <p className="mt-5 text-lg text-slate-500 dark:text-slate-400">{t("landing.sub")}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button onClick={start} className="rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700">{t("landing.start")}</button>
          <a href="#how" className="rounded-xl border border-slate-300 px-6 py-3 font-semibold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">{t("landing.how")}</a>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-8 grid gap-4 md:grid-cols-4">
          {[[tr("Describe", "صف"), tr("Write the task in plain language.", "اكتب المهمة بلغة بسيطة.")], [tr("Plan", "خطّط"), tr("The agent breaks it into steps.", "يقسّمها الوكيل إلى خطوات.")], [tr("Execute", "نفّذ"), tr("Tools run live; you watch every step.", "تعمل الأدوات مباشرة وترى كل خطوة.")], [tr("Deliver", "سلّم"), tr("Results and files land in one workspace.", "النتائج والملفات في مساحة عمل واحدة.")]].map(([h, b], i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-2 text-sm font-bold text-brand-600">0{i + 1}</div><div className="font-semibold">{h}</div><div className="text-sm text-slate-500">{b}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"><Icon name={f.icon} /></div>
                <h3 className="font-semibold">{f.title}</h3>
                {f.soon && <span className="ms-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">{tr("Coming soon", "قريبًا")}</span>}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="mb-6 text-center text-3xl font-bold">{tr("Pricing", "الأسعار")}</h2>
        <PricingSection onSelect={() => navigate(user ? "/billing" : "/login")} />
      </section>

      <section className="mx-auto max-w-3xl px-4 py-12">
        <h2 className="mb-6 text-center text-3xl font-bold">FAQ</h2>
        {faq.map(([q, a]) => (
          <details key={q} className="mb-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <summary className="cursor-pointer font-medium">{q}</summary><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{a}</p>
          </details>
        ))}
      </section>
      <footer className="border-t border-slate-200 py-8 text-center text-sm text-slate-400 dark:border-slate-800">© Wakeel</footer>
    </div>
  );
}
