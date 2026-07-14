// Copy-to-clipboard with a safe fallback for environments where the async
// Clipboard API is unavailable or blocked (older browsers, some Android WebView
// configurations, non-secure contexts). Dependencies are injectable so the
// decision logic is unit-testable without a real DOM.

export type CopyDeps = {
  /** navigator.clipboard.writeText, when available. */
  clipboardWrite?: (text: string) => Promise<void>;
  /** Synchronous DOM fallback (textarea + execCommand). Returns whether it copied. */
  fallbackCopy?: (text: string) => boolean;
};

/** Builds the real browser dependencies. Only touches navigator/document when called. */
export function defaultCopyDeps(): CopyDeps {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const clipboardWrite =
    nav && nav.clipboard && typeof nav.clipboard.writeText === "function"
      ? (text: string) => nav.clipboard.writeText(text)
      : undefined;

  const fallbackCopy =
    typeof document !== "undefined"
      ? (text: string): boolean => {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          // Keep it off-screen and non-disruptive.
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.top = "-1000px";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          try {
            textarea.select();
            // execCommand is deprecated but remains the only sync fallback that
            // works where the async Clipboard API is unavailable.
            return document.execCommand("copy");
          } catch {
            return false;
          } finally {
            document.body.removeChild(textarea);
          }
        }
      : undefined;

  return { clipboardWrite, fallbackCopy };
}

/**
 * Attempts to copy `text`, preferring the async Clipboard API and falling back to
 * the synchronous DOM method. Never throws; resolves true only if a copy actually
 * succeeded, so callers can show a "copy manually" hint on false.
 */
export async function copyTextToClipboard(text: string, deps: CopyDeps = defaultCopyDeps()): Promise<boolean> {
  if (deps.clipboardWrite) {
    try {
      await deps.clipboardWrite(text);
      return true;
    } catch {
      // Fall through to the synchronous fallback below.
    }
  }
  if (deps.fallbackCopy) {
    try {
      return deps.fallbackCopy(text);
    } catch {
      return false;
    }
  }
  return false;
}
