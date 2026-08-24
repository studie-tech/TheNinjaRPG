/**
 * Shared helpers for TNR reviewer CI scripts.
 *
 * Provides authenticated GitHub API requests and GitHub Actions output helpers
 * so each script doesn't need its own copy.
 */
import { appendFileSync } from "node:fs";

/**
 * Write a key=value pair to $GITHUB_OUTPUT.
 * Uses heredoc format for multiline values to prevent corruption.
 */
export const setOutput = (key, value) => {
  if (!process.env.GITHUB_OUTPUT) return;
  const str = String(value ?? "");
  if (str.includes("\n")) {
    const delimiter = `ghadelimiter_${Date.now()}`;
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${key}<<${delimiter}\n${str}\n${delimiter}\n`,
    );
  } else {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${str}\n`);
  }
};

/**
 * Validate that a URL is a trusted Vercel deployment (*.vercel.app over HTTPS).
 * Returns the origin only, or an empty string when the URL is untrusted.
 *
 * @param {string} raw
 * @returns {string}
 */
export const toTrustedPreviewUrl = (raw) => {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return "";
    if (!parsed.hostname.endsWith(".vercel.app")) return "";
    return parsed.origin;
  } catch {
    return "";
  }
};

/**
 * Create an authenticated GitHub REST API request function.
 * Supports GET (default) and any method via options.method / options.body.
 *
 * @param {string} token - GitHub token for Authorization header
 * @returns {(path: string, options?: RequestInit) => Promise<any>}
 */
export const createGithubClient = (token) => {
  if (!token) throw new Error("Missing GitHub token for API client");

  return async (path, options = {}) => {
    const response = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(
        `GitHub API ${path} failed (${response.status}): ${body}`,
      );
      // Callers branch on the HTTP status (e.g. 404 = ref missing); expose it
      // directly instead of forcing them to parse the message.
      error.status = response.status;
      throw error;
    }

    return response.json();
  };
};
