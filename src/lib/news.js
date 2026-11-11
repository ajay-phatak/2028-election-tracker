// Syndicated stories (one wire piece republished by several outlets, e.g. the
// USA Today network's Florida papers) arrive as separate articles with the same
// headline. Keep only the first of each headline, comparing case- and
// punctuation-insensitively and ignoring a trailing " - Outlet" suffix. Shared by
// the GNews proxy (api/_news.js) and the drawer, so news already cached in KV is
// cleaned up too.
const titleKey = (title) =>
  String(title || "")
    .toLowerCase()
    .replace(/\s+[-|–—]\s+[^-|–—]+$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function dedupeArticles(articles) {
  const seen = new Set();
  return (articles || []).filter((a) => {
    const key = titleKey(a.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
