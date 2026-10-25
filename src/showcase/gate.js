// TEMPORARY_PAGES_SHOWCASE: remove with docs/temporary-showcase.md.
// A URL/storage value alone never enables this in a normal production build.
export function permitsShowcase(mode, apiBase, location) {
  return (
    mode === "pages" &&
    !apiBase &&
    ((location.hostname === "crystalclear9.github.io" &&
      /^\/OutdoorsWeb(?:\/|$)/.test(location.pathname)) ||
      (["127.0.0.1", "localhost"].includes(location.hostname) &&
        new URLSearchParams(location.search).get("showcase") === "1"))
  );
}
export const showcaseEnabled =
  typeof window !== "undefined" &&
  import.meta.env.MODE === "pages" &&
  permitsShowcase(
    import.meta.env.MODE,
    import.meta.env.VITE_API_BASE_URL,
    window.location,
  );
