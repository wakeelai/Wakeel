import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "ar" | "en";

const dict: Record<Lang, Record<string, string>> = {
  en: {
    "nav.newTask": "New Task", "nav.projects": "Projects", "nav.tasks": "Tasks", "nav.artifacts": "Artifacts",
    "nav.files": "Files", "nav.usage": "Usage", "nav.billing": "Billing", "nav.settings": "Settings",
    "nav.admin": "Admin", "nav.logout": "Sign out", "nav.credits": "credits",
    "home.title": "What can I help you accomplish?",
    "home.placeholder": "Describe your task — research, analyze, build, write…",
    "composer.web": "Web research", "composer.browser": "Browser mode", "composer.code": "Code mode",
    "composer.attach": "Attach files", "composer.run": "Run Task",
    "common.loading": "Loading…", "common.cancel": "Cancel", "common.confirm": "Confirm",
    "common.download": "Download", "common.preview": "Preview", "common.copy": "Copy",
    "common.copied": "Copied", "common.none": "Nothing here yet", "common.save": "Save",
    "status.queued": "Queued", "status.planning": "Planning", "status.running": "Running",
    "status.waiting": "Waiting", "status.completed": "Completed", "status.failed": "Failed",
    "status.cancelled": "Cancelled",
    "phase.planning": "Planning", "phase.searching": "Searching", "phase.reading": "Reading sources",
    "phase.analyzing": "Analyzing", "phase.generating": "Generating", "phase.verifying": "Verifying",
    "phase.completed": "Completed",
    "landing.title": "Your AI Agent for Real Work",
    "landing.sub": "Research. Build. Analyze. Automate. Create.",
    "landing.start": "Start for Free", "landing.how": "See How It Works",
  },
  ar: {
    "nav.newTask": "مهمة جديدة", "nav.projects": "المشاريع", "nav.tasks": "المهام", "nav.artifacts": "المخرجات",
    "nav.files": "الملفات", "nav.usage": "الاستخدام", "nav.billing": "الفوترة", "nav.settings": "الإعدادات",
    "nav.admin": "الإدارة", "nav.logout": "تسجيل الخروج", "nav.credits": "اعتماد",
    "home.title": "ما الذي تريد إنجازه؟",
    "home.placeholder": "صف مهمتك — بحث، تحليل، بناء، كتابة…",
    "composer.web": "بحث على الويب", "composer.browser": "وضع المتصفح", "composer.code": "وضع الكود",
    "composer.attach": "إرفاق ملفات", "composer.run": "تشغيل المهمة",
    "common.loading": "جارٍ التحميل…", "common.cancel": "إلغاء", "common.confirm": "تأكيد",
    "common.download": "تنزيل", "common.preview": "معاينة", "common.copy": "نسخ",
    "common.copied": "تم النسخ", "common.none": "لا يوجد شيء بعد", "common.save": "حفظ",
    "status.queued": "في الانتظار", "status.planning": "تخطيط", "status.running": "قيد التنفيذ",
    "status.waiting": "بانتظار التأكيد", "status.completed": "مكتملة", "status.failed": "فشلت",
    "status.cancelled": "أُلغيت",
    "phase.planning": "التخطيط", "phase.searching": "البحث", "phase.reading": "قراءة المصادر",
    "phase.analyzing": "التحليل", "phase.generating": "الإنشاء", "phase.verifying": "التحقق",
    "phase.completed": "اكتمل",
    "landing.title": "وكيلك الذكي للعمل الحقيقي",
    "landing.sub": "ابحث، وابنِ، وحلّل، وأتمت أعمالك، وأبدع.",
    "landing.start": "ابدأ مجانًا", "landing.how": "شاهد كيف يعمل",
  },
};

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Shared dictionary lookup (falls back to English, then the key). */
  t: (key: string) => string;
  /** Inline bilingual helper for page-specific copy. */
  tr: (en: string, ar: string) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

function detectLang(): Lang {
  const saved = localStorage.getItem("lang");
  if (saved === "ar" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem("lang", l);
    setLangState(l);
  }, []);

  const value = useMemo<I18nCtx>(
    () => ({
      lang,
      setLang,
      t: (key) => dict[lang][key] ?? dict.en[key] ?? key,
      tr: (en, ar) => (lang === "ar" ? ar : en),
    }),
    [lang, setLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}
