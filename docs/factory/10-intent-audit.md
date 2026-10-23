# 10 — Intent audit: every element must be AI-chosen (2026-10-23)

**The rule (user decision, 2026-10-23):** nothing renders, sounds, or appears
unless the AI put it there on purpose — or code put it there for a defined
reason the AI controls (derived from the story). Anything unchosen is deleted.
It was already the Phase 2 design ("the 3 fixed families go away; statPanel,
timer, heroProp become optional devices the director may use"). This audit
applies that rule to everything the composition still shows or plays.

## Finding 1 — the PULSE/BPM row and the fabricated heartbeat (DELETE — approved)

Origin: the old "your eyesight 1×→16×" reference demo (a pulse rising with
escalation was part of that one video's act). Nobody re-evaluated it when the
pipeline replaced the templates.

What is unauthored today:

| Where | What | Why it violates the rule |
|---|---|---|
| `src/compositions/hud/StatHud.tsx` | The red EKG sweep, blinking dot and BPM number are rendered on **every** counter card | The director's counter device has no bpm field — no AI ever chose it |
| `src/generator/pipeline/assemble.ts` ~L199 | The assembler **invents** a BPM: `76 + 76·i/(n-1)` (76→152) | Fabricated data pretending to be escalation |
| `src/generator/pipeline/assemble.ts` ~L206 | An **auto-added heartbeat sound bed** (`heartbeat_bpm70…150`, `restart: true`) under the whole video | An unauthored audio loop on every counting video |
| `src/generator/spec.schema.ts` | `bpm` is a **required** field of every counter beat | Forces the lie into every spec |
| `build-family-spec.ts` L61–65 | Template bpm 76/88/104/128/152 | Same theater, hardcoded |
| `statPanel.ts` `statBpmAt` + `statPanel.test.ts` bpm cases | Support code and tests for the above | — |
| `ai/knowledge.ts` L229 | Prompt text mentioning `bpm` beats | Teaches the model a field it shouldn't use |

**Fix (executed 2026-10-23):** delete the PULSE row + `statBpmAt`, drop the fabricated-bpm step and
the heartbeat bed from the assembler, make `bpm` optional in `StatBeatSchema`
(then delete it with the family templates) and update the tests. The counter
device itself (title, big value, subline, zoom pair) stays — the director
chooses it; `ZoomVignette` stays (it is derived from the counter's own zoom).

**Amendment (2026-10-23, later — same evening):** the user's reference
channels (see [quality-refs/](quality-refs/) and Phase 7 in the plan) **choose
the pulse deliberately** — on "What If Fun facts" the raised BPM row is part of
that channel's grammar for panic premises. So under the same intent rule, the
EKG row returns as an **optional device**: `bpm` may come back into
`StatBeatSchema` as an *optional* field the director sets for fear/urgency
premises; the row renders only when it is present, and the heartbeat sound is
a sound-designer cue *derived from* the chosen bpm. What stays deleted
forever: the assembler's invented bpm values and the always-on heartbeat bed
on every counting video — those had no author behind them.

## Inventory — everything else in `WhatIfVideo/index.tsx` (checked 2026-10-23)

| Element | Shown/played when | Who chose it | Verdict |
|---|---|---|---|
| 3D scene (kit stage: street/space/ocean/countryside/forest/river/interior/asset) | per scene | **Director** (kit, time, weather, accent, cast, crowd) per beat | kept — AI-chosen |
| Physics events (`gravity_off/on`) | from spec events/scenes | Writer/director per premise | kept — AI-chosen |
| `CinematicLook` grade (bloom, ACeS, grain, vignette) | per scene | **Derived by rule** from the scene's time of day + story mood (`look-choice.ts`); presets defined; tuning pending (Phase 3 §3.3) | kept — derived; tuning separate |
| `TransitionOverlay` (dip/flash/whip) | at scene changes | **Derived by rule** from scene-to-scene facts (`transitions.ts`) | kept — derived |
| Whip-pan blur filter | during whip transitions | derived (same) | kept |
| `ZoomVignette` | while the counter device is on | derived from the counter's `zoom` (the director chose the counter) | kept |
| Counter card (title, big value, sub) | wherever the director placed the **counter** device | Director | kept |
| **PULSE/BPM/EKG row inside it** | always on any counter card | **Nobody** | **deleted** (Finding 1) |
| Timer HUD | wherever the director placed the **timer** device | Director (label, start/end beats) | kept |
| Hook card | first 2 s, text + keyword from the **writer** | Writer | kept |
| Captions (+ style) | always | Writer/timeline per word; style = user settings | kept |
| SFX cues | from `sound.json` | **Sound designer** role | kept (library picks by tags — listening pass pending, Phase 2 carry-forward) |
| Music bed | from `sound.json` mood, else seeded | Sound designer; seed fallback documented | kept;_User to judge on milestone videos_ |
| Ducking/fades/mastering | engineering | defined audio rule (Phase 1 step 7) | kept |
| `demo.tsx` / `WhatIfDemo` | Studio preview only; never in a plan | Test rig for the base render path | kept as a test rig (not part of videos) |
| Offline family templates | only when no provider key exists | Explicit fallback, documented | kept as fallback (PULSE data inside them goes inert with the deletion) |

## Standing rule for future work

Any new HUD/overlay/sound element ships only with (a) a schema field the
director/designer explicitly answers, or (b) derivation from a field the AI
answers — never "always render X". The reviewer pass (Phase 2 step 10) and the
photographer QA (Phase 3) check that captions/events match intent; this audit
extends that to *existence*.
