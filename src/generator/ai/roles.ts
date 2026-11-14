/**
 * src/generator/ai/roles.ts
 *
 * Pipeline roles: each step of the factory can use its own AI model. The user
 * picks a provider and model per role in Settings → AI models; the choice is
 * stored in ai.config.json under "roles".
 *
 * Every role is wired: the plan uses writer, director, sound and critic
 * (pipeline/run.ts), the photographer script uses vision, and Ask AI in the
 * editor uses editor. A role with no model of its own uses the writer's.
 */

export const ROLE_DEFS = [
  {
    name: "producer",
    label: "Producer",
    description:
      "The one you talk to about a run: it reads each note (\"scene 2 at night\", \"no music in the intro\") and sends it to the role that does the work. It changes nothing until you confirm.",
    usedFrom: "now",
  },
  {
    name: "writer",
    label: "Writer",
    description: "Writes the story: hook, beats, narration and dialogue.",
    usedFrom: "now",
  },
  {
    name: "reader",
    label: "Script reader",
    description: "For a script you wrote yourself: fills in what each beat shows and who the characters are. It never changes your words.",
    usedFrom: "now",
  },
  {
    name: "checker",
    label: "Story checker",
    description:
      "Reads the story before you do: notes on what would lose the viewer, the facts it claims, and for a story rewritten from yours, any part of your plot it lost. It never changes a word.",
    usedFrom: "now",
  },
  {
    name: "director",
    label: "Director",
    description: "Chooses the worlds, time of day, weather, camera style and on-screen devices. (Shot-by-shot camera comes in Phase 3.)",
    usedFrom: "now",
  },
  {
    name: "sound",
    label: "Sound designer",
    description: "Picks music, sound effects and ambience for each beat.",
    usedFrom: "now",
  },
  {
    name: "critic",
    label: "Critic",
    description:
      "Optional review pass: flags weak beats and the writer rewrites them (turn on 'AI review pass'). A story you approved is kept; its notes are listed instead. It also checks the story's facts before the story gate: each number, date, record or named person is known, speculative, or needs a source.",
    usedFrom: "now",
  },
  {
    name: "breakdown",
    label: "Breakdown",
    description: "Lists everything the story needs: places, characters, props, actions, effects, sounds and music.",
    usedFrom: "now",
  },
  {
    name: "matcher",
    label: "Matcher",
    description: "Judges whether the library's closest items are what each need asks for. Many small calls: a small model is enough.",
    usedFrom: "now",
  },
  {
    name: "vision",
    label: "Photographer (vision)",
    description: "Looks at draft stills and sends back shots with bad framing.",
    usedFrom: "Phase 3",
  },
  {
    name: "editor",
    label: "Editor",
    description: "Applies your 'Ask AI' edits to one beat or the whole video.",
    usedFrom: "Phase 4",
  },
] as const;

export type RoleName = (typeof ROLE_DEFS)[number]["name"];

export const ROLE_NAMES: readonly string[] = ROLE_DEFS.map((r) => r.name);

export interface RoleAssignment {
  provider?: string;
  model?: string;
}

export type RoleMap = Partial<Record<RoleName, RoleAssignment>>;

/** The provider/model chosen for a role, or an empty assignment (use the default). */
export function roleAssignment(roles: RoleMap | undefined, role: RoleName): RoleAssignment {
  return roles?.[role] ?? {};
}

/**
 * Decide the provider and model for one role's job without mixing providers.
 * - Explicit provider and model: used as given.
 * - Explicit provider only: the role's model is borrowed only when the role
 *   names that same provider. Otherwise the model is left for the provider's default.
 * - Explicit model only: the default provider is used with that model, so a
 *   model is never sent to a provider it doesn't belong to.
 * - Nothing explicit: the role's provider and model.
 */
export function pickRoleModel(
  roles: RoleMap | undefined,
  role: RoleName,
  provider?: string,
  model?: string,
): RoleAssignment {
  const assigned = roleAssignment(roles, role);
  if (provider) {
    if (model) return { provider, model };
    return { provider, model: assigned.provider === provider ? assigned.model : undefined };
  }
  if (model) return { provider: undefined, model };
  return assigned;
}
