import type { EconomyStore } from "./store.js";

export const CURRENCY_IMAGE_SETTING_KEY = "currency_image_url";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_URL_LENGTH = 500;
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_MS = 30_000;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export type ImageSource = "admin" | "environment" | "none";

export type ValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

type FetchLike = (
  url: string,
  init?: { redirect?: "error" | "follow" | "manual"; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null;
}>;

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return host.includes(":");
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return false;
}

/** Checks the URL text only (no network). */
export function checkImageUrlSyntax(raw: string): ValidationResult {
  const text = raw.trim();
  if (!text || text.length > MAX_URL_LENGTH) {
    return { ok: false, error: `The image URL must be 1-${MAX_URL_LENGTH} characters.` };
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "The image URL must start with https://" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "The image URL must not contain a username or password." };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { ok: false, error: "The image URL must point to a public website." };
  }
  return { ok: true, url: parsed.toString() };
}

function matchesImageSignature(bytes: Uint8Array): boolean {
  const startsWith = (...sig: number[]) => sig.every((value, index) => bytes[index] === value);
  return (
    startsWith(0x89, 0x50, 0x4e, 0x47) || // PNG
    startsWith(0xff, 0xd8, 0xff) || // JPEG
    startsWith(0x47, 0x49, 0x46, 0x38) || // GIF
    (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) // WEBP
  );
}

export class CurrencyImageService {
  private cache: { url: string | null; source: ImageSource; at: number } | null = null;

  constructor(
    private readonly store: EconomyStore,
    private readonly envUrl: string | undefined,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The image to use right now: admin-saved first, then CURRENCY_IMAGE_URL. */
  async resolve(): Promise<{ url: string | null; source: ImageSource }> {
    if (this.cache && this.now() - this.cache.at < CACHE_MS) {
      return { url: this.cache.url, source: this.cache.source };
    }
    let result: { url: string | null; source: ImageSource };
    try {
      const saved = await this.store.getSetting(CURRENCY_IMAGE_SETTING_KEY);
      const envCheck = this.envUrl ? checkImageUrlSyntax(this.envUrl) : null;
      if (saved) {
        result = { url: saved, source: "admin" };
      } else if (envCheck?.ok) {
        result = { url: envCheck.url, source: "environment" };
      } else {
        result = { url: null, source: "none" };
      }
    } catch {
      // The economy keeps working without the picture.
      return { url: null, source: "none" };
    }
    this.cache = { ...result, at: this.now() };
    return result;
  }

  async getUrl(): Promise<string | null> {
    return (await this.resolve()).url;
  }

  /** Full check: URL text, then downloads the file to verify type and size. */
  async validate(raw: string): Promise<ValidationResult> {
    const syntax = checkImageUrlSyntax(raw);
    if (!syntax.ok) {
      return syntax;
    }
    try {
      const response = await this.fetchImpl(syntax.url, {
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { ok: false, error: `The image could not be downloaded (HTTP ${response.status}).` };
      }
      const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (!ALLOWED_TYPES.includes(type)) {
        return { ok: false, error: "The URL must serve a PNG, JPEG, GIF or WebP image." };
      }
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > MAX_IMAGE_BYTES) {
        return { ok: false, error: "The image is larger than 5 MB." };
      }
      if (!response.body) {
        return { ok: false, error: "The image could not be read." };
      }
      const reader = response.body.getReader();
      let received = 0;
      let head: Uint8Array | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          head ??= value.slice(0, 16);
          received += value.byteLength;
          if (received > MAX_IMAGE_BYTES) {
            await reader.cancel();
            return { ok: false, error: "The image is larger than 5 MB." };
          }
        }
      }
      if (!head || !matchesImageSignature(head)) {
        return { ok: false, error: "The file is not a real PNG, JPEG, GIF or WebP image." };
      }
      return { ok: true, url: syntax.url };
    } catch {
      return { ok: false, error: "The image could not be downloaded. Check the link and try again." };
    }
  }

  async set(raw: string, adminId: string): Promise<ValidationResult> {
    const checked = await this.validate(raw);
    if (!checked.ok) {
      return checked;
    }
    await this.store.setSetting(CURRENCY_IMAGE_SETTING_KEY, checked.url, adminId);
    this.cache = null;
    return checked;
  }

  async clear(adminId: string): Promise<void> {
    await this.store.setSetting(CURRENCY_IMAGE_SETTING_KEY, null, adminId);
    this.cache = null;
  }
}
