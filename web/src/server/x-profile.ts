import "server-only";

/**
 * X profile data acquisition (blueprint §13/§50): a swappable provider
 * that returns a normalized profile object from FREE public sources.
 * The rest of the app never talks to X directly — swap this module to
 * change providers.
 *
 * MVP provider: public profile HTML (og-meta), which reliably exposes
 * display name, handle, bio and avatar for existing accounts, and an
 * explicit "could not be found" marker otherwise. Fields that are not
 * publicly available (follower counts, recent posts) are simply absent —
 * callers must never invent them.
 */

export interface XProfile {
  found: boolean;
  /** "not_found" = account doesn't exist; "unavailable" = X didn't serve us. */
  status: "found" | "not_found" | "unavailable";
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  sourceUrl: string;
  /** Which fields actually carried data in this fetch — evidence honesty. */
  dataAvailable: string[];
  fetchedAt: string;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Normalizes URL / @handle / plain handle input to a canonical handle. */
export function normalizeHandle(raw: string): string | null {
  let text = raw.trim();
  if (text.length === 0) return null;
  text = text.replace(/^https?:\/\//i, "");
  text = text.replace(/^(www\.)?(x|twitter)\.com\//i, "");
  text = text.replace(/^@+/, "");
  text = text.split(/[/?]/)[0];
  if (!/^[A-Za-z0-9_]{1,15}$/.test(text)) return null;
  return text.toLowerCase();
}

function extractMeta(html: string, marker: string): string {
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const from = start + marker.length;
  const end = html.indexOf('"', from);
  if (end < 0) return "";
  return decodeHtmlEntities(html.slice(from, end));
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    );
}

/**
 * Fetches the public profile page. Returns:
 *   200  -> html body
 *   404  -> null (account does not exist)
 *   other/exception -> "unreachable" (X down, rate limit, network)
 */
async function fetchProfileHtml(
  handle: string,
): Promise<{ kind: "ok"; html: string } | { kind: "not_found" } | { kind: "unreachable" }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://x.com/${handle}`, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (response.status === 404) return { kind: "not_found" };
    if (!response.ok) return { kind: "unreachable" };
    return { kind: "ok", html: await response.text() };
  } catch {
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

function unavailableProfile(handle: string): XProfile {
  return {
    found: false,
    status: "unavailable",
    handle,
    displayName: "",
    bio: "",
    avatarUrl: "",
    sourceUrl: `https://x.com/${handle}`,
    dataAvailable: [],
    fetchedAt: new Date().toISOString(),
  };
}

function notFoundProfile(handle: string): XProfile {
  return {
    found: false,
    status: "not_found",
    handle,
    displayName: "",
    bio: "",
    avatarUrl: "",
    sourceUrl: `https://x.com/${handle}`,
    dataAvailable: [],
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchXProfile(handle: string): Promise<XProfile> {
  const normalized = normalizeHandle(handle);
  if (!normalized) {
    return {
      found: false,
      status: "not_found",
      handle: "",
      displayName: "",
      bio: "",
      avatarUrl: "",
      sourceUrl: "",
      dataAvailable: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  const sourceUrl = `https://x.com/${normalized}`;
  const page = await fetchProfileHtml(normalized);

  if (page.kind === "not_found") return notFoundProfile(normalized);
  if (page.kind === "unreachable") return unavailableProfile(normalized);

  const html = page.html;
  if (html.includes("could not be found")) return notFoundProfile(normalized);

  let title = extractMeta(html, '<meta property="og:title" content="');
  if (title === "") title = extractMeta(html, '<meta name="title" content="');
  let bio = extractMeta(html, '<meta property="og:description" content="');
  if (bio === "") bio = extractMeta(html, '<meta name="description" content="');
  const avatar = extractMeta(html, '<meta property="og:image" content="');

  if (title === "" && bio === "") return unavailableProfile(normalized);

  const suffix = " on X";
  if (title.endsWith(suffix)) title = title.slice(0, -suffix.length);

  const dataAvailable = ["username", "display_name"];
  if (bio !== "") dataAvailable.push("bio");
  if (avatar !== "") dataAvailable.push("avatar_image_url");

  return {
    found: true,
    status: "found",
    handle: normalized,
    displayName: title.trim(),
    bio: bio.trim(),
    avatarUrl: avatar.trim(),
    sourceUrl,
    dataAvailable,
    fetchedAt: new Date().toISOString(),
  };
}
