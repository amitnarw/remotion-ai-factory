# Three Methods — in plain English (v3.1)

**Companion to:** `23-visual-methods.md` (the engineering plan). If they disagree, the plan wins.

> **Current state (2026-11-19):** the three methods exist as a seam. You can
> pick `Factory` on the Format step and it behaves exactly as before; the
> `Animation` and `Lemo` cards show "coming soon" until their phases are built.
> Everything is measured in `docs/factory/23-visual-methods.md` §15.

---

## 1. The idea in one paragraph

We make one video at a time, and we make it with **one of three methods**. The voice, music, sound effects, subtitles and timing already exist in the repo and are used by all three. Only the picture changes, and each method draws its picture its own way. Nothing is mixed, nothing is blended, and no video is ever made by two methods at once.

---

## 2. The three methods

| Method | What it is | Status |
|---|---|---|
| **Factory** (`factory`) | what we have today — the Remotion stage kits | **default**, untouched |
| **Animation** (`animation`) | a hand-coded 3D film with a real camera (that ocean/beach/boat prototype) | new, separate |
| **Lemo** (`lemo`) | 99 ready-made styles from a public library, auto-chosen per part of the story | new, separate |

You pick the method in the wizard when you start a video. That choice decides which branch runs. The other two are never touched.

---

## 3. What is shared, what is not

**Shared — because it already works and you asked for it:**

- voice
- background music
- sound effects
- subtitles (same caption system in all three, so your channel looks consistent)
- loudness mastering
- beat timings (the picture obeys the voice)
- length, format, frame rate (your choice in the wizard)

**Not shared — each method owns its own:**

- palette, typeface, grain, tempo
- renderer and scene code
- assets and textures
- transitions
- the style system (only Lemo has one)

One sentence: **the script and the sound are shared; the picture is not.**

---

## 4. Factory (default)

Exactly what you have now. Same scenes, same captions, same render. The only change is a label on the run saying "this one used the factory", so the pipeline knows which branch to run.

---

## 5. Animation

A separate renderer for hand-coded 3D. Real camera, real perspective, painted textures. It has its own stages and its own look — and **no styles**. It is one look, made well.

Two stages exist so far. One is a shoreline: sky, sun, water, one sailboat. The other is a data film, *How deep is the ocean?* — the camera dives from the surface to the Challenger Deep while a depth counter climbs beside it, stopping at real, cited comparisons: a diver's limit, the Burj Khalifa, the Titanic, Everest, the trench floor.

The numbers are not decoration. One small plan decides both what the counter says and where the camera is, so the figure on screen is the figure the camera is actually at, and it holds still while its caption is up. The depth axis is honest where it can be, and says so on screen where it cannot: below 1 000 m the scale is compressed, and the ruler is labelled that way.

It uses your voice, music, SFX and subtitles like everyone else. Captions are the shared words drawn in the shared look; only the picture belongs to this method. It never sees a Lemo style.

Because the animation skill folder has no licence, we rewrite its building blocks ourselves rather than copying them. Same techniques, our own code.

---

## 6. Lemo

### 6.1 What it is

99 "film styles" — watercolour, risograph, ink wash, Swiss graphic, maps, charts, globes, comics, newsreel — each one a text description of how a film should look. It does not render anything itself; it tells us how to draw.

### 6.2 Why 99 styles don't mean 99 renderers

A **medium** is what the picture is made of: a map, a chart, a globe, a diagram, ink on paper, a whiteboard sketch. There are twelve that cover everything Lemo does.

A **style** is how that medium is handled: the same map drawn as a risograph, or as ink, or as flat Swiss geometry.

So we build **twelve renderers**, and each of the 99 styles is a set of instructions on top — inks, texture, type, motion. That is the difference between a two-week job and a two-year job.

### 6.3 What the router does

You asked for videos where one part shows a map, another a graph, another a globe. That happens **inside a Lemo video**:

1. The story is already split into beats, timed to the voice.
2. For each beat, the router asks: what is this — a map? a chart? a globe? a quote?
3. It keeps only styles that suit that kind of picture, survive vertical 9:16, and don't need an image generator.
4. It scores them on fit and contrast with the previous shot.
5. Rules: at most a handful of styles per video, no shot under 1.2 seconds, changes only on story beats, every change written down with a reason.
6. A second pass may veto a choice and pick the next best.

You can leave it on **Auto**, or force one style for the whole video.

### 6.4 Why Lemo videos don't look like a patchwork

Inside a single Lemo video, one palette, one typeface, one grain and one tempo are held across every style used. The styles change *how* the picture is marked; the house look stays constant. That's the only way a map + a chart + a globe reads as one film instead of three clips.

This house look belongs to Lemo only. It never leaks into Factory or Animation.

### 6.5 The three styles we skip

Three styles draw characters with an AI image generator: **Manga Panels**, **Text Flash Cuts**, **Comic History Cartoon**. You said keep everything offline, so they are marked unavailable with the reason shown in the UI.

That leaves **96 usable styles**, with no image service, no extra cost and no network call. If you ever add an image model, turning them on is a setting, not a rewrite.

### 6.6 Honest quality levels

| Level | What it means |
|---|---|
| **f0** | our palette, grain and type on a generic drawing of the medium — usable but shallow |
| **f1** | a real medium renderer plus the style's texture, inks and motion — close to the original |
| **f2** | a bespoke drawing written for that one style — could pass as the original |

Day one: all 96 exist at f0. We promote styles to f1 and f2 in batches, based on what you actually use. A style that can't work is marked unavailable instead of producing a bad frame.

---

## 7. Length is your choice

The wizard's *Format & length* step already lets you set the length. Nothing changes there.

The only effect on Lemo is how many styles a video may use:

| Your length | Max styles |
|---|---|
| 10 s | 4 |
| 15 s | 5 |
| 30 s or more | 8 |

Short videos stay focused; long ones can show more kinds of picture.

---

## 8. How the work is split

| Phase | Days |
|---|---|
| Baseline + docs | 0.5 |
| Method field + factory passthrough | 0.5 |
| Wizard: method + Lemo style controls | 0.5 |
| Animation renderer + scenes | 3 |
| Lemo: ingest 96 styles | 2.5 |
| Lemo: 12 medium renderers + house look | 2.5 |
| Lemo: router + critic | 3 |
| Lemo: full render + showcase film | 1.5 |
| Options, comparison, verification | 1 |
| **Total** | **≈15 days** |

The animation work and the Lemo work don't depend on each other, so either can start first.

---

## 9. How we prove nothing is mixed

- A test fails the build if one method imports another method's code.
- A test fails the build if anything style-related ends up in the shared folder.
- At runtime, a Lemo video has no factory code loaded, and a factory video has no Lemo packs loaded.
- The same script run through all three must produce the **same audio** and the **same subtitles** — proving the shared parts really are shared.
- For a multi-style Lemo video: show it to 5 people, ask "is this one film or a compilation?" — at least 4 must say one film.

---

## 10. Glossary

| Term | Plain meaning |
|---|---|
| **method** | which of the three ways makes the video: factory / animation / lemo |
| **medium** | what the picture is made of: map, chart, globe, print, sketch… |
| **style** | how that medium is handled: risograph, ink wash, Swiss grid… |
| **pack** | one style, written as data we can use |
| **router** | the chooser that maps each beat to a medium and a style — Lemo only |
| **house look** | the constant palette/type/grain/tempo inside one Lemo video |
| **f0 / f1 / f2** | shallow / close / bespoke quality levels |
| **K** | maximum number of styles in one Lemo video |
| **subtitle system** | the repo's existing captions, used by all three methods |
| **isolation test** | the automated check that one method never imports another |
