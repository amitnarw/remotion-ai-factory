/**
 * lib/routes.ts, the dashboard's URL scheme in one place.
 *
 *   ?tab=create&step=idea|format|voice|captions|summary      choose (one decision per screen)
 *   ?tab=create&step=writing&plan=<jobId>                     the AI writes the plan
 *   ?tab=create&step=review&plan=<jobId>&view=story|scenes|sound|settings
 *   ?tab=create&step=rendering&job=<jobId>                    the video is being made
 *   ?tab=create&step=done&job=<jobId>                         watch, download, edit
 *   ?tab=library                     all videos
 *   ?tab=library&video=<id>          one video
 *   ?tab=assets                      the sources, the build requests, what was acquired
 *   ?tab=settings&section=models|channels|voice|checklist  (&view=providers|roles, &provider=<name>; &channel=<id>)
 *   ?tab=help
 *   ?tab=editor&film=<id>&from=library|plan(&plan=<jobId>)
 *
 * Old links keep working: ?tab=generate&step=1|review|3, ?tab=videos&selected=,
 * ?tab=providers&provider=, ?tab=setup are mapped onto the new screens.
 */

export type Section = "create" | "library" | "assets" | "settings" | "help" | "activity" | "editor";

export const SETUP_STEPS = ["idea", "format", "voice", "captions", "summary"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export type CreateStep = SetupStep | "writing" | "review" | "rendering" | "done";

export const SETTINGS_SECTIONS = ["models", "channels", "voice", "checklist"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const CREATE_STEPS: readonly string[] = [...SETUP_STEPS, "writing", "review", "rendering", "done"];

type Params = Record<string, string | undefined>;

const START: Params = { tab: "create", step: "idea" };

/** A create step that has what it needs (a plan id or a job id), else the start. */
function createParams(step: string | null, q: URLSearchParams): Params {
  const plan = q.get("plan") ?? undefined;
  const job = q.get("job") ?? undefined;
  if (step === "writing" || step === "review") {
    return plan ? { tab: "create", step, plan, view: step === "review" ? q.get("view") ?? undefined : undefined } : START;
  }
  if (step === "rendering" || step === "done") return job ? { tab: "create", step, job } : START;
  if (step && CREATE_STEPS.includes(step)) return { tab: "create", step };
  return START;
}

function same(q: URLSearchParams, next: Params): boolean {
  const entries = Object.entries(next).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length !== [...q.keys()].length) return false;
  return entries.every(([k, v]) => q.get(k) === v);
}

/**
 * The params the URL should have, or null when it is already right.
 * Unknown tabs and old tab names are mapped; a create step without the id it
 * needs falls back to the first step.
 */
export function normalizeQuery(q: URLSearchParams): Params | null {
  const tab = q.get("tab");
  let next: Params;
  switch (tab) {
    case "create":
      next = createParams(q.get("step"), q);
      break;
    case "generate": {
      // Old wizard: step 1 = idea, review = plan review, 3 = rendering.
      const step = q.get("step");
      if (step === "3") next = createParams("rendering", q);
      else if (step === "review" || step === "2") next = createParams("writing", q);
      else next = createParams(step === "1" ? "idea" : step, q);
      break;
    }
    case "library": {
      const video = q.get("video") ?? undefined;
      next = { tab: "library", video };
      break;
    }
    case "videos":
      next = { tab: "library", video: q.get("selected") ?? q.get("video") ?? undefined };
      break;
    case "assets":
      next = { tab: "assets" };
      break;
    case "settings": {
      const section = q.get("section");
      const valid = section && (SETTINGS_SECTIONS as readonly string[]).includes(section) ? section : "models";
      next = {
        tab: "settings",
        section: valid,
        view: valid === "models" ? q.get("view") ?? undefined : undefined,
        provider: valid === "models" ? q.get("provider") ?? undefined : undefined,
        channel: valid === "channels" ? q.get("channel") ?? undefined : undefined,
      };
      break;
    }
    case "providers":
      next = { tab: "settings", section: "models", provider: q.get("provider") ?? undefined };
      break;
    case "setup":
      next = { tab: "settings", section: "voice" };
      break;
    case "help":
      next = { tab: "help" };
      break;
    case "activity": {
      const job = q.get("job") ?? undefined;
      next = { tab: "activity", job };
      break;
    }
    case "editor":
      // The editor reads film/from/plan itself; leave it untouched.
      return null;
    default:
      next = START;
  }
  return same(q, next) ? null : next;
}

export function sectionOf(q: URLSearchParams): Section {
  const tab = q.get("tab");
  return tab === "library" || tab === "assets" || tab === "settings" || tab === "help" || tab === "editor" ? tab : "create";
}

/** The step the wizard is on (already normalized). */
export function createStepOf(q: URLSearchParams): CreateStep {
  const step = q.get("step");
  return step && CREATE_STEPS.includes(step) ? (step as CreateStep) : "idea";
}
