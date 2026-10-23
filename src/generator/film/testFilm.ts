/** A small valid film for tests (two beats, a character, a shot, a hit). */
import type { Film } from "./edits";

export function sampleFilm(): Film {
  return {
    story: {
      title: "Oceans Vanish",
      hook: "What if the oceans vanished?",
      mood: "eerie",
      characters: [{ name: "Mia", gender: "female", age: "adult", look: "red coat" }],
      beats: [
        { id: "b1", say: "The tide goes out.", lines: [], see: "beach", pace: "normal", stress: "tide" },
        { id: "b2", say: "And it never comes back.", lines: [{ who: "Mia", text: "Where did it go?" }], see: "empty sea bed", pace: "linger", stress: "never" },
      ],
    },
    direction: {
      scenes: [{ start: "b1", kit: "ocean", time: "noon", weather: "none", subject: "none", crowd: "none", camera: "orbit-drift", accent: "classic", cast: [] }],
      counter: null,
      timer: null,
      prop: null,
      world: [],
      shots: [{ beat: "b2", subject: "scene", size: "WS", angle: "high", side: "auto", move: "crane_up", place: "auto", energy: "calm", style: "smooth" }],
    } as unknown as Film["direction"],
    sound: { music: [{ start: "b1", mood: "eerie" }], beds: [], hits: [{ beat: "b2", at: "start", sound: "boom" }] },
    plan: { premise: "What if the oceans vanished?", settings: { format: "9:16" } as Film["plan"]["settings"], audio: {}, models: {} },
  };
}
