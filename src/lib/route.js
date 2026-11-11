// Minimal path router: two pages don't justify a routing dependency. Deep links work
// because public/_redirects (and Vite in dev) serve index.html for any path.
import { useEffect, useState } from "react";

const normalize = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p) || "/";

export function usePath() {
  const [path, setPath] = useState(() => normalize(window.location.pathname));
  useEffect(() => {
    const onPop = () => setPath(normalize(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

export function navigate(to) {
  if (normalize(window.location.pathname) === normalize(to)) return;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

// In-app link: client-side navigation on a plain left click, normal browser behaviour
// (new tab, copy link) otherwise.
export function onLinkClick(to) {
  return (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
}
