export interface TaskAnalysis {
  needsWebResearch: boolean;
  needsBrowser: boolean;
  needsCode: boolean;
  needsFileOutput: boolean;
  complexity: "simple" | "moderate" | "complex";
}

const RESEARCH_HINTS = /(ابحث|search|find|قارن|compare|best|أفضل|latest|أحدث)/i;
const CODE_HINTS = /(csv|excel|كود|code|python|javascript|حلل|analyze|رسم بياني|chart)/i;
const FILE_HINTS = /(pdf|docx|xlsx|تقرير|report|جدول|table|ملف|file|document)/i;
const BROWSER_HINTS = /(افتح موقع|browser|انقر|click|سجل دخول|login|تصفح)/i;

/**
 * Deliberately heuristic-first rather than an extra LLM call: classification
 * doesn't need model reasoning, and every free-tier AI call is a scarce,
 * rate-limited resource we'd rather spend on planning/execution.
 */
export function analyzeTask(
  prompt: string,
  modeFlags: { webResearch: boolean; browser: boolean; code: boolean },
): TaskAnalysis {
  const needsWebResearch = modeFlags.webResearch || RESEARCH_HINTS.test(prompt);
  const needsBrowser = modeFlags.browser || BROWSER_HINTS.test(prompt);
  const needsCode = modeFlags.code || CODE_HINTS.test(prompt);
  const needsFileOutput = FILE_HINTS.test(prompt);

  const signalCount = [needsWebResearch, needsBrowser, needsCode, needsFileOutput].filter(
    Boolean,
  ).length;
  const complexity: TaskAnalysis["complexity"] =
    signalCount >= 3 ? "complex" : signalCount >= 1 ? "moderate" : "simple";

  return { needsWebResearch, needsBrowser, needsCode, needsFileOutput, complexity };
}
