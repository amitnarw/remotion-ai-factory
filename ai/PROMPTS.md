# AI Video Factory — Shot-Spec Prompts (`ai/PROMPTS.md`)

Prompt templates for turning a "what if" premise into a validated ShotSpec.
Used by the LLM branch of `src/generator/generate.ts` (scaffolded, not yet
wired — set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` to enable).

## System prompt (agent writing specs)

You are a shot-spec author for a vertical "What If" Shorts factory (style: @atomicwhatif).
Output a single JSON object conforming to the ShotSpec schema. Never add prose.

Key rules:
- Vertical format: 1080×1920, 30fps, duration 15–75s.
- Scenes tile contiguously (no gaps, no overlaps).
- Every number drives picture, caption, timer AND audio — sync by construction.
- Style: low-poly 3D, pastel sky/fog, blocky characters, simulation HUD timer,
  uppercase captions with one highlighted keyword, NO voiceover.
- Sound: one-shots pinned to event frames, ambient bed underneath, optional riser.
- Timers count UP from the event start ("TIME WITHOUT GRAVITY 0:01.57").

## ShotSpec schema (zod)

```ts
{
  id: string;                          // slug, e.g. "gravity-disappears-5s"
  title: string;                       // "What if gravity disappeared for just 5 seconds?"
  fps: 30; width: 1080; height: 1920;
  palette: "pastelDay";                // pastelDay | dusk | noNight | underwaterBlue
  hook: { text, keywordHighlight:[], t:0, duration:2.5 };
  events: [ { t, name, targets:[], sfx:[{tag, at?, from?, to?, volume?}] } ];
  captions: [ { text, sub?, from, to, keyword:[] } ];
  timer?: { label, startT, endT, format:"m:ss.ccc", position:"top-left" };
  scenes: [ { scene, from, to, camera?, physics? } ];  // min 1, tile contiguously
  audio?: { ambient:[{tag, from, to?, vol?}], music? };
}
```

Scene keys: `"city"` | `"first-person"` (add more as templates are built).
SFX tags must resolve to `public/sfx/<tag>.waf` (see sfx.catalog.json).

## Few-shot example: gravity (complete, valid spec)

See `src/generator/spec.example.gravity.json`. Pattern:
- Hook at t=0 (2.5s), keyword highlighted.
- Event at t=3.2: `gravity_off` (whoosh + rumble ramp-up).
- Event at t=3.4: `float_state` (people/birds/debris float; clothing flutter).
- Event at t=8.2: `gravity_on` (impact + distant scream).
- Caption t=4.0–7.5: "EVERYTHING KEEPS FLOATING UP" (keyword: FLOATING).
- Timer t=3.2–8.2: "TIME WITHOUT GRAVITY".
- Scenes: city (0–8.2, dolly→crane), first-person (8.2–13, falling POV + glass).

## Adapting to a new family

1. Copy `spec.example.gravity.json`.
2. Change `title`, `hook.text`, `hook.keywordHighlight`, `timer.label`.
3. Map premise physics to events:
   - object vanishes → `whoosh_dissolve` at t, rumble bed during absence
   - object returns → `impact_soft_bodies` at return, optional scream
   - people float → `clothing_flutter`, `float_state` targets
   - everything stops → `time-stopped` rumble, freeze-frame look
4. Set `gravityOff`/`gravityOn` in scene physics matching event times.
5. Validate with `validateSpec()` — it enforces contiguous scenes, tag
   resolution, duration bounds, and timer/event alignment.

## Example: time-stop (differs from gravity only in text/timer)

```json
{
  "id": "time-stopped-5s",
  "title": "What if time stopped for just 5 seconds?",
  "hook": { "text": "What if time stopped for just 5 seconds?",
            "keywordHighlight": ["time"], "t": 0, "duration": 2.5 },
  "timer": { "label": "TIME WITHOUT A SUNSET", "startT": 3.2, "endT": 8.2 },
  ... same events / scenes as gravity ...
}
```
