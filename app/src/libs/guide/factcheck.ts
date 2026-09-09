export interface GuideFactCheckIssue {
  field: string;
  message: string;
}

/**
 * Flag leftover Core 3 rank names and village names the wiki still uses as
 * if they were current. Used by seed and unit-tested so a stale rewrite
 * cannot ship as published without reviewNotes.
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

  // "Current" and "Shine" are common English words; only flag the wiki village titles.
  if (/\bvillage of (current|shine)\b/.test(lower)) {
    issues.push({
      field: "content",
      message:
        "Mentions a redirected wiki village (Current / Shine) — use the live village name",
    });
  }

  return issues;
};
