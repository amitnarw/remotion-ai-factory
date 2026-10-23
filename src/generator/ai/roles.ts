/**
 * src/generator/ai/roles.ts
 *
 * Pipeline roles: each step of the factory can use its own AI model. The user
 * picks a provider and model per role in the Providers tab; the choice is
 * stored in ai.config.json under "roles".
 *
 * Only the writer is wired today. The other roles are declared now so the
 * configuration is stable when the phases that use them land.
 */

export const ROLE_DEFS = [
  {
    name: "writer",
    label: "Writer",
    description: "Writes the story: hook, beats, narration and dialogue.",
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
    description: "Optional review pass: flags weak beats and the writer rewrites them (turn on 'AI review pass').",
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
