/**
 * Stand-alone Remotion entry for the CinematicLook test scene.
 * Not used by the main factory Root (src/index.ts).
 */
import { registerRoot } from "remotion";
import { LookRoot } from "./LookTest";

registerRoot(LookRoot);
