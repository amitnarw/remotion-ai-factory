/**
 * src/generator/library/acquire/policy.ts — the licence policy
 * (docs/factory/15-producer.md §5, "The licence policy", with §10's
 * recommended defaults):
 *
 *   free    CC0 1.0, public-domain dedications (FreePD), the Quaternius Asset
 *           License 1.0 (the files never leave this machine except inside a
 *           rendered video). Everything, no credit.
 *   credit  CC-BY 3.0 and 4.0, OGA-BY 3.0: models (on by default, with an
 *           automatic credit line), music only when the user turns it on,
 *           sounds never.
 *   never   NC, ND, SA, GPL and LGPL, Sampling+, custom terms that ban AI use,
 *           editorial-only, a missing or unknown licence, anything its source
 *           marks as AI-generated.
 *
 * The text read is the item's own: a licence file from the archive, the
 * licence section of the item's page, or the API record's field. A whole web
 * page is never classified (Kenney's pages carry a "noai" robots tag that is
 * not the assets' licence). Unclear means refused.
 */
import type { AssetType, LicenceDecision, LicenceId, LicencePolicy, Tier } from "./types";

export const DEFAULT_POLICY: LicencePolicy = { ccByModels: true, ccByMusic: false };

/** Terms that put a licence in the never tier, checked before anything else. */
const NEVER: ReadonlyArray<[RegExp, string]> = [
  [/non[- ]?commercial|\bBY-NC\b|\bCC[- ]?NC\b|not for commercial|no commercial use|personal use only/i, "non-commercial"],
  [/no[- ]?deriv|\bBY-ND\b|\bBY-NC-ND\b/i, "no derivatives"],
  [/share[- ]?alike|\bBY-SA\b|\bCC[- ]?SA\b/i, "share-alike (an adapted work must carry the same licence)"],
  [/\bL?GPL\b|GNU (lesser |library )?general public licen[cs]e/i, "GPL or LGPL"],
  [/sampling ?(\+|plus)/i, "Sampling+"],
  [/editorial use only|editorial only/i, "editorial use only"],
  [
    /(artificial intelligence|\bA\.?I\.?\b|machine learning|neural network)[^.]{0,80}(prohibit|not (be )?permitted|may not|must not|forbidden|not allowed)|(prohibit|not (be )?permitted|may not|must not|forbidden|not allowed)[^.]{0,80}(artificial intelligence|\bA\.?I\.?\b|machine learning|neural network)/i,
    "custom terms that ban AI use",
  ],
];

const KNOWN: ReadonlyArray<[RegExp, LicenceId]> = [
  [/Quaternius Asset Licen[cs]e|\bQAL\b/i, "Quaternius-Asset-License-1.0"],
  [/\bCC0\b|CC-?Zero|publicdomain\/zero|Creative Commons Zero|Public Domain Dedication|creative commons 0\b/i, "CC0-1.0"],
  [/\bOGA[- ]?BY\b/i, "OGA-BY-3.0"],
  [/\bCC[- ]?BY[- ]?4(\.0)?\b|creativecommons\.org\/licenses\/by\/4\.0|Attribution 4\.0/i, "CC-BY-4.0"],
  [/\bCC[- ]?BY[- ]?3(\.0)?\b|creativecommons\.org\/licenses\/by\/3\.0|Attribution 3\.0/i, "CC-BY-3.0"],
  [/\bpublic domain\b/i, "Public-Domain"],
];

export const TIER_OF: Record<LicenceId, Tier> = {
  "CC0-1.0": "free",
  "Public-Domain": "free",
  "Quaternius-Asset-License-1.0": "free",
  "CC-BY-3.0": "credit",
  "CC-BY-4.0": "credit",
  "OGA-BY-3.0": "credit",
};

/** A licence text, label or API value -> what it is: a known licence, a never reason, or unknown. */
export function classifyLicence(text: string): { licence: LicenceId | null; never?: string } {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return { licence: null };
  for (const [re, why] of NEVER) if (re.test(t)) return { licence: null, never: why };
  for (const [re, id] of KNOWN) if (re.test(t)) return { licence: id };
  return { licence: null };
}

/** A source's own mark that the item was made by an AI model (title, description, tags). */
export function aiMarked(text: string | undefined): boolean {
  if (!text) return false;
  return /\bai[- ]generated\b|\bgenerated (with|by) (an? )?(ai|artificial intelligence)\b|\bmade (with|by) (an? )?(ai|artificial intelligence)\b|\btext[- ]to[- ]3d\b|\b(meshy|tripo|hyper3d|rodin|luma genie|csm\.ai|kaedim|suno|udio)\b|\bai[- ](model|art|music|voice|sound)\b/i.test(
    text,
  );
}

const LABEL: Record<LicenceId, string> = {
  "CC0-1.0": "CC0 1.0",
  "Public-Domain": "public domain",
  "Quaternius-Asset-License-1.0": "Quaternius Asset License 1.0",
  "CC-BY-3.0": "CC-BY 3.0",
  "CC-BY-4.0": "CC-BY 4.0",
  "OGA-BY-3.0": "OGA-BY 3.0",
};

export const licenceLabel = (id: LicenceId) => LABEL[id];

/** The credit line for the video description, in the landmarks' form: '"Title" by Author (page), CC-BY 3.0'. */
export function creditLine(title: string, author: string, page: string, licence: LicenceId): string {
  return `"${title}" by ${author || "unknown author"} (${page}), ${LABEL[licence]}`;
}

/**
 * Decides one item by the policy. `text` is what the item states; `also`, a
 * second statement that must agree (a pack page and its zip's licence file).
 */
export function decideLicence(
  item: { text: string; also?: string; type: AssetType; title: string; author: string; page: string; ai?: boolean },
  policy: LicencePolicy = DEFAULT_POLICY,
): LicenceDecision {
  if (item.ai) return { allow: false, tier: "never", licence: null, reason: "its source marks it as AI-generated" };
  const got = classifyLicence(item.text);
  if (got.never) return { allow: false, tier: "never", licence: null, reason: `the licence is ${got.never}` };
  if (!got.licence) return { allow: false, tier: "unclear", licence: null, reason: `the licence is unclear (${quote(item.text)}): refused` };
  if (item.also !== undefined) {
    const other = classifyLicence(item.also);
    if (other.never) return { allow: false, tier: "never", licence: null, reason: `the second statement says ${other.never}` };
    if (other.licence && TIER_OF[other.licence] !== TIER_OF[got.licence]) {
      return { allow: false, tier: "unclear", licence: null, reason: `the two statements disagree (${LABEL[got.licence]} and ${LABEL[other.licence]}): refused` };
    }
    if (!other.licence) return { allow: false, tier: "unclear", licence: null, reason: `the second statement is unclear (${quote(item.also)}): refused` };
  }
  const id = got.licence;
  const tier = TIER_OF[id];
  if (tier === "free") return { allow: true, tier, licence: id, reason: `${LABEL[id]}: free for any use, no credit needed` };
  const credit = creditLine(item.title, item.author, item.page, id);
  if (item.type === "sound" || item.type === "ambience") return { allow: false, tier, licence: id, reason: `${LABEL[id]}: sounds are never taken under a credit licence` };
  if (item.type === "music" && !policy.ccByMusic) return { allow: false, tier, licence: id, reason: `${LABEL[id]}: CC-BY music is off (turn it on for the channel)` };
  if (item.type === "model" && !policy.ccByModels) return { allow: false, tier, licence: id, reason: `${LABEL[id]}: CC-BY models are off for this channel` };
  return { allow: true, tier, licence: id, reason: `${LABEL[id]}: allowed with a credit line in the video description`, credit };
}

/** The tier a stated licence reads as before download (the offer's badge); "unknown" when unclear. */
export function statedTier(text: string): Tier | "unknown" {
  const got = classifyLicence(text);
  if (got.never) return "never";
  return got.licence ? TIER_OF[got.licence] : "unknown";
}

function quote(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t ? `"${t.length > 80 ? `${t.slice(0, 77)}...` : t}"` : "nothing stated";
}
