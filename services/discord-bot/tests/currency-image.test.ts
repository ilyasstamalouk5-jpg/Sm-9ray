import assert from "node:assert/strict";
import test from "node:test";
import {
  CurrencyImageService,
  checkImageUrlSyntax,
  CURRENCY_IMAGE_SETTING_KEY,
} from "../src/economy/currency-image.js";
import { MemoryEconomyStore } from "./helpers/memory-economy-store.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

function fakeFetch(options: {
  status?: number;
  type?: string;
  length?: string;
  chunks?: Uint8Array[];
  fail?: boolean;
}) {
  return async () => {
    if (options.fail) {
      throw new Error("network down");
    }
    const chunks = options.chunks ?? [PNG];
    let index = 0;
    return {
      ok: (options.status ?? 200) < 400,
      status: options.status ?? 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type"
            ? (options.type ?? "image/png")
            : name.toLowerCase() === "content-length"
              ? (options.length ?? null)
              : null,
      },
      body: {
        getReader: () => ({
          read: async () =>
            index < chunks.length
              ? { done: false, value: chunks[index++] }
              : { done: true, value: undefined },
          cancel: async () => {},
        }),
      },
    };
  };
}

const URL_OK = "https://raw.githubusercontent.com/owner/repo/main/assets/dirham.png";

test("image URL syntax: only public https URLs are accepted", () => {
  assert.equal(checkImageUrlSyntax(URL_OK).ok, true);
  for (const bad of [
    "http://example.com/a.png",
    "ftp://example.com/a.png",
    "not a url",
    "",
    "https://localhost/a.png",
    "https://127.0.0.1/a.png",
    "https://192.168.1.5/a.png",
    "https://10.0.0.2/a.png",
    "https://user:pass@example.com/a.png",
    `https://example.com/${"a".repeat(600)}.png`,
  ]) {
    assert.equal(checkImageUrlSyntax(bad).ok, false, bad);
  }
});

test("set stores a validated image, and replace/clear work", async () => {
  const store = new MemoryEconomyStore();
  const images = new CurrencyImageService(store, undefined, fakeFetch({}));
  assert.deepEqual(await images.resolve(), { url: null, source: "none" });

  assert.equal((await images.set(URL_OK, "admin1")).ok, true);
  assert.equal(store.settings.get(CURRENCY_IMAGE_SETTING_KEY), URL_OK);
  assert.deepEqual(await images.resolve(), { url: URL_OK, source: "admin" });

  const replacement = "https://example.com/new.png";
  assert.equal((await images.set(replacement, "admin1")).ok, true);
  assert.equal((await images.resolve()).url, replacement);

  await images.clear("admin1");
  assert.deepEqual(await images.resolve(), { url: null, source: "none" });
});

test("invalid images are rejected and the saved image is left unchanged", async () => {
  const store = new MemoryEconomyStore();
  const good = new CurrencyImageService(store, undefined, fakeFetch({}));
  await good.set(URL_OK, "a");

  const cases = [
    fakeFetch({ type: "text/html" }),
    fakeFetch({ status: 404 }),
    fakeFetch({ length: String(6 * 1024 * 1024) }),
    fakeFetch({ chunks: [Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])] }),
    fakeFetch({ chunks: [new Uint8Array(3 * 1024 * 1024), new Uint8Array(3 * 1024 * 1024)] }),
    fakeFetch({ fail: true }),
  ];
  for (const fetchImpl of cases) {
    const images = new CurrencyImageService(store, undefined, fetchImpl);
    const result = await images.set("https://example.com/x.png", "a");
    assert.equal(result.ok, false);
  }
  assert.equal(store.settings.get(CURRENCY_IMAGE_SETTING_KEY), URL_OK);
  assert.equal((await new CurrencyImageService(store, undefined, fakeFetch({})).set("http://example.com/x.png", "a")).ok, false);
});

test("CURRENCY_IMAGE_URL is the fallback and an admin-saved image wins", async () => {
  const store = new MemoryEconomyStore();
  const images = new CurrencyImageService(store, "https://example.com/env.png", fakeFetch({}));
  assert.deepEqual(await images.resolve(), { url: "https://example.com/env.png", source: "environment" });
  await images.set(URL_OK, "a");
  assert.equal((await images.resolve()).source, "admin");
  await images.clear("a");
  assert.equal((await images.resolve()).source, "environment");
});

test("an invalid environment image is ignored and the economy still works", async () => {
  const images = new CurrencyImageService(new MemoryEconomyStore(), "http://bad", fakeFetch({}));
  assert.deepEqual(await images.resolve(), { url: null, source: "none" });
});

test("if storage fails, the image is simply missing (DH text still shows)", async () => {
  const store = new MemoryEconomyStore();
  store.getSetting = async () => {
    throw new Error("db down");
  };
  const images = new CurrencyImageService(store, undefined, fakeFetch({}));
  assert.deepEqual(await images.resolve(), { url: null, source: "none" });
});
