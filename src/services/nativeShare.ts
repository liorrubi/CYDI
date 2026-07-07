export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

type ShareData = { title: string; text: string; url: string };

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
    await navigator.clipboard.writeText(data.url);
    return "copied";
  } catch {
    return "failed";
  }
}
