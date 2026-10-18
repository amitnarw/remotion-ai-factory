/** Slug helper for storyboard titles — safe for file paths + URLs. */
export function premiseSlugSafe(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  // Short unique suffix so two similar topics never collide.
  return `${base || "story"}-${Date.now().toString(36).slice(-4)}`;
}