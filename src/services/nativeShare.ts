export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

// `url` is optional so a caller that has already embedded the link directly in
// `text` (e.g. "message\n\nhttps://...") can omit it - passing both would risk
// some share targets appending the url a second time after `text`. When `url`
// is omitted, the clipboard fallback copies `text` verbatim instead, so both
// paths always produce the exact same content.
type ShareData = { title: string; text: string; url?: string };

/** Tries the OS share sheet (WhatsApp/Email/Messages/Telegram/etc. wherever supported), falling back to a clipboard copy on unsupported browsers or non-cancel failures. */
export async function shareOrCopy(data: ShareData): Promise<ShareOutcome> {
  if (navigator.share) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(data.url ?? data.text);
    return "copied";
  } catch {
    return "failed";
  }
}
