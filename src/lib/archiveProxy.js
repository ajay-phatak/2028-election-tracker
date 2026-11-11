// Serves a past tracker under /<year>/ by proxying to the project it is deployed on.
// Runs in a Pages Function; kept here (no Cloudflare APIs) so it can be unit tested.
//
// Read-only on purpose: the archive path only needs pages, assets and the tracker's
// GET API, so anything else (e.g. its token-protected POST warmer) is refused.
export async function proxyArchive(request, { prefix, origin }, fetchImpl = fetch) {
  const url = new URL(request.url);
  const base = prefix.replace(/\/+$/, ""); // "/2026"

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  // The archived app uses relative URLs, which only resolve under a trailing slash.
  if (url.pathname === base) {
    url.pathname = `${base}/`;
    return Response.redirect(url.toString(), 308);
  }

  const target = new URL(url.pathname.slice(base.length) + url.search, origin);
  const headers = new Headers(request.headers);
  headers.delete("host");

  let upstream;
  try {
    upstream = await fetchImpl(target.toString(), { method: request.method, headers, redirect: "manual" });
  } catch {
    return new Response("The archived tracker is unavailable right now.", { status: 502 });
  }

  const res = new Response(upstream.body, upstream);
  // Keep the origin's own redirects (e.g. /index.html -> /) inside the prefix.
  const location = res.headers.get("location");
  if (location) {
    const to = new URL(location, target);
    if (to.origin === target.origin) res.headers.set("location", `${base}${to.pathname}${to.search}`);
  }
  return res;
}
