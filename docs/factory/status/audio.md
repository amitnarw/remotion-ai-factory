# Done. Audio agent: status (2026-11-05)

Room and distance are on `dev` (`63aca43`), on by default; `FACTORY_ROOM=off` is byte-identical to before (4 of 4 fixtures). With the room on, the four fixture masters stay at -14.03 to -14.17 LUFS and -1.21 to -1.36 dBTP. Both check worktrees are removed. Left: the three findings below (in others' files) and the user's listening pass.

## Task
Room and distance in the mix: effects and ambience play dry today.
1. Room reverb by the scene's space (interior a small room; street and plaza a city slap and short echo; forest, countryside and ocean open air, almost dry; pier and river open), from the scene's kit or world place, by convolution with an impulse response.
2. Distance: an effect far away gets a low-pass and a lower level, a near one stays dry; from the plan, else from the shot size (EWS far, CU near).
3. Deterministic: the same inputs give byte-identical WAVs, named by a hash of what made them (as `audio-warp.ts`).
4. The master stays at -14 LUFS and at most -1 dBTP: measured before and after on the fixture videos' mixes.
5. A switch: off gives output byte-identical to today; the default decided and explained in 03.

Files owned: `src/generator/audio-master.ts`, `audio-resolve.ts`, `audio-library.ts`, `audio-warp.ts`, `ffmpeg.ts` and their tests, a new `src/generator/audio-room.ts` and its test, `src/compositions/WhatIfVideo/audio.tsx`; docs `03-audio-sources.md`, this file.

## Found so far
- **Remotion's bundled ffmpeg has 50 filters and no `afir`, `lowpass`, `aecho` or `anoisesrc`** (`ffmpeg -filters`). No other full ffmpeg is on this machine (Playwright's is video-only), and downloads are not allowed. So the convolution runs in TypeScript, the way `audio-warp.ts` does its varispeed: ffmpeg only decodes, the code does the arithmetic. No new dependency.
- **No impulse response on disk:** `public/library/` (775 files) has none, and no CC0 source in 03 lists one. The rooms use generated impulse responses (seeded, decaying filtered noise plus discrete reflections): a processing kernel, not a sound in the mix.
- **The sound plan holds no distance:** `SoundPlan.hits` is `{beat, at, sound}`. Distance comes from the shot on screen at the cue's time (`spec.shots[].size`).

## Committed
- `bc1ee2b` this status file.
- `63aca43` the room and distance (the files below). Checked on `wt-audio` (dev `5a9d25a` + these four files): `npx tsc --noEmit` clean, `npx eslint src server` clean, `npm test` 852 tests, 851 pass, 0 fail, 1 skipped.
- (this commit) 03's section with the measurements, this file.

## Built
- `src/generator/audio-room.ts` (new): `ROOMS` (room, street, field, open), `DISTANCES` (near, mid, far), `spaceOf` (kit or world place), `distanceOf` (shot size), generated stereo impulse responses (`impulse`, seeded), FFT convolution (`fft`, `convolve`, linear or wrapped for looped beds), `inRoom`, the pass `roomAudio` (files `public/whatif-audio/room/room-<space>-<distance>-<hash>.wav`, hash of the room, distance, source bytes and `VERSION`), the switch `roomEnabled` (`FACTORY_ROOM`).
- `audio-resolve.ts`: `resolveAudio(spec, seed, { room })` runs the room before bullet time's pass; `AudioReport.room`.
- `audio-warp.ts`: exports `LowPass`, `clearDecoded`; `decode(rel, base)` (cache keyed by the absolute path). No change in behaviour.
- `audio-room.test.ts` (new, 8 tests): the mappings, the switch, FFT against the direct sum, the impulse responses seeded, far darker and quieter, the pass (dry hook, designed sounds and space; byte-identical files from two runs; reuse), room off.
- `03-audio-sources.md`: "Room and distance in the mix (2026-11-05)", with the measurements to fill in.

## Measured (master, room off -> on; 03 has the full table)
- money-doubles: -14.16 LUFS, -1.36 dBTP -> -14.17, -1.32 (2 room cues).
- oceans-vanish: -14.09, -1.24 -> -14.10, -1.24 (3; the two splashes under the EWS are far).
- forest-walks: -14.03, -1.45 -> -14.03, -1.36 (4; the thunder under a WS is mid).
- the bullet test: -14.15, -1.21 -> -14.15, -1.21 (2; its `bt_*` cues stay dry).
- Off: the resolved spec and report of all four fixtures are identical to the code before the room (sha256, 4 of 4).
- A far splash: 7 dB down under 4 kHz, 15 dB more above it.

## Uncommitted
- Nothing.

## Next (for others or later)
1. The three findings below.
2. The user's listening pass (HANDOFF §4), with and without `FACTORY_ROOM=off`. If the dry mix wins, flip `roomEnabled`'s default in audio-room.ts.
3. A recorded CC0 impulse response, if one is ever found, can replace a generated room (`impulse()`, bump `VERSION`).
4. Small, mine: bullet time's report gives a reused slowed file no peak (`peakDb: NaN`), so its report differs between a first run and a later one (the spec does not).

## Worktree and outputs
- Check worktrees `wt-audio` and `wt-audio-orig` (the code before the room, for the identity check): removed, junctions first.
- Scratch: the session scratchpad's `audio/` (`measure.ts`, the mixes `<fixture>-{off,on}.wav|mp4`, `measure.log`).
- The processed sounds: `public/whatif-audio/room/` (git-ignored, a cache any run remakes).

## Findings for others (exact edits; not applied)
1. **Code map (`16-code-map-pipeline.md`, the coordinator):** after the `audio-master.ts` line add: "[audio-room.ts](../../src/generator/audio-room.ts): room and distance. Exports `ROOMS`, `DISTANCES`, `spaceOf`, `distanceOf`, `impulse`, `convolve`, `inRoom`, `roomAudio`, `roomEnabled` (`FACTORY_ROOM`). Caller: resolveAudio, before warpAudio. Files in `public/whatif-audio/room/`. Test: `audio-room.test.ts`. Doc: 03 'Room and distance'." And in the env table: `FACTORY_ROOM` | audio-room.ts | `off` leaves every sound dry (byte-identical to before).
2. **A per-video switch (`spec.schema.ts`, `generate.ts`, `film/prepare.ts`):** `SettingsSchema` gets `room: z.boolean().optional()`; both callers pass `resolveAudio(spec, id, { room: spec.settings?.room })` (undefined falls back to the environment). Then the dashboard can offer it.
3. **A distance from the sound designer (`pipeline/sound.ts`, `pipeline/assemble.ts`, `spec.schema.ts`):** `SoundPlan.hits[]` gets `distance?: "near" | "mid" | "far"` (the prompt explains it); the assembler copies it onto the cue (`SfxCueSchema.distance`); `roomAudio` would read `cue.distance` before the shot size (one line in audio-room.ts, mine, once the field exists).
