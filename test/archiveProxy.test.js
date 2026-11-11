import { describe, it, expect } from "vitest";
import { proxyArchive } from "../src/lib/archiveProxy.js";

const opts = { prefix: "/2026/", origin: "https://old.example" };
const req = (path, init) => new Request(`https://elections.example${path}`, init);
const recorder = (response) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response();
  };
  return { calls, fetchImpl };
};

describe("proxyArchive", () => {
  it("redirects the bare prefix to a trailing slash, keeping the query", async () => {
    const { calls, fetchImpl } = recorder(() => new Response("x"));
    const res = await proxyArchive(req("/2026?simulate=1"), opts, fetchImpl);
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://elections.example/2026/?simulate=1");
    expect(calls).toHaveLength(0);
  });

  it("strips the prefix for pages, assets and API calls", async () => {
    const { calls, fetchImpl } = recorder(() => new Response("ok"));
    await proxyArchive(req("/2026/"), opts, fetchImpl);
    await proxyArchive(req("/2026/assets/index-abc.js"), opts, fetchImpl);
    await proxyArchive(req("/2026/api/race?state=TX"), opts, fetchImpl);
    expect(calls.map((c) => c.url)).toEqual([
      "https://old.example/",
      "https://old.example/assets/index-abc.js",
      "https://old.example/api/race?state=TX",
    ]);
  });

  it("passes the upstream status, body and headers through", async () => {
    const { fetchImpl } = recorder(
      () => new Response("body", { status: 404, headers: { "cache-control": "max-age=60" } })
    );
    const res = await proxyArchive(req("/2026/missing"), opts, fetchImpl);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("max-age=60");
    expect(await res.text()).toBe("body");
  });

  it("keeps same-origin upstream redirects inside the prefix", async () => {
    const { fetchImpl } = recorder(() => new Response(null, { status: 301, headers: { location: "/" } }));
    const res = await proxyArchive(req("/2026/index.html"), opts, fetchImpl);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/2026/");
  });

  it("refuses anything but GET and HEAD", async () => {
    const { calls, fetchImpl } = recorder(() => new Response("x"));
    const res = await proxyArchive(req("/2026/api/refresh", { method: "POST" }), opts, fetchImpl);
    expect(res.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it("returns 502 when the origin cannot be reached", async () => {
    const res = await proxyArchive(req("/2026/"), opts, async () => {
      throw new Error("down");
    });
    expect(res.status).toBe(502);
  });
});
