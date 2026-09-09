export interface GuideFactCheckIssue {
  field: string;
  message: string;
}

/**
 * Reject guide copy that still uses retired village names or rank spellings.
 * Seed and tests both run this so those leftovers cannot ship without reviewNotes.
 */
export const factCheckGuideProse = (text: string): GuideFactCheckIssue[] => {
  const issues: GuideFactCheckIssue[] = [];
  const lower = text.toLowerCase();

  if (/\b(konoha|konoki|suna|kiri|iwa|kumo|oto)\b/.test(lower)) {
    issues.push({
      field: "content",
      message: "Mentions a legacy village name that is not used in Core 4",
    });
  }

  if (/\b(jounin|chuunin|academy student)\b/.test(lower)) {
    issues.push({
      field: "content",
      message: "Uses a legacy rank spelling; prefer STUDENT / CHUNIN / JONIN",
    });
  }

  // "current" and "shine" are ordinary English words; only flag the village titles.
  if (/\bvillage of (current|shine)\b/.test(lower)) {
    issues.push({
      field: "content",
      message:
        "Mentions a retired village title (Current / Shine); use the live village name",
    });
  }

  return issues;
};
