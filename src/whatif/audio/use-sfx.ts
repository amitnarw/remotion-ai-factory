/**
 * src/whatif/audio/use-sfx.ts — client-side sound-design file resolution.
 *
 * The sound designer's per-role variant choice is resolved server-side (Node,
 * catalog + design map) into a plain role → file map, passed to the render as
 * inputProps { sfxFileMap }. This hook picks the file for one role at render
 * time. In Remotion Studio / Player previews (no inputProps) it falls back to
 * the synth default file `sfx/<role>.wav`, which ships with the repo.
 */
import { getInputProps } from "remotion";

export interface SfxInputProps {
  /** role (tag) → public/-relative asset file resolved by the render script. */
  sfxFileMap?: Record<string, string>;
  /** Raw design choices echoed for reference — not used by components. */
  sfxDesign?: Record<string, string>;
}

export function useSfxFile(role: string): string {
  const props = getInputProps() as unknown as SfxInputProps;
  return props?.sfxFileMap?.[role] ?? `sfx/${role}.wav`;
}
