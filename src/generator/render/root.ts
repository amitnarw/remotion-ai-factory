/**
 * src/generator/render/root.ts — the project root with one spelling.
 *
 * Windows paths are case-insensitive, but the bundler is not: a bundle made
 * from a working directory that starts `c:\` instead of `C:\` can resolve a
 * module twice and render whole frames differently (found 2026-11-12; VS Code
 * starts the process with either). Every bundle takes its paths from here.
 */

/** A path with a Windows drive letter upper-cased; any other path as it is. */
export function canonicalPath(p: string): string {
  return p.replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`);
}

/** The working directory, as the bundler must see it. */
export function projectRoot(): string {
  return canonicalPath(process.cwd());
}
