import { VOXCPM_VOICE_DESCRIPTIONS, KNOWN_VOICES } from "../src/generator/voices";
import { voicePreviewKey, voicePreviewLine, synthesizeLines } from "../src/generator/tts";
const engines = ["kitten2", "voxcpm2"] as const;
async function main() {
  for (const engine of engines) {
    const voices = engine === "voxcpm2" ? VOXCPM_VOICE_DESCRIPTIONS.map((v) => v.id) : KNOWN_VOICES.map((v) => v.id);
    console.log(`== ${engine}: ${voices.length} voices ==`);
    for (const voice of voices) {
      const key = voicePreviewKey(engine, voice);
      if (!key) { console.log(`skip ${voice} (no key)`); continue; }
      const t0 = Date.now();
      try {
        const line = voicePreviewLine(engine, voice);
        if (!line) throw new Error("unknown voice");
        const m = await synthesizeLines([line], `_warm-${engine}-${voice}`, { publish: false });
        const file = m.lines[0]?.file;
        console.log(`ok ${engine}/${voice} ${((Date.now()-t0)/1000).toFixed(1)}s -> ${file}`);
      } catch (e) {
        console.log(`FAIL ${engine}/${voice}: ${(e as Error).message}`);
      }
    }
  }
  console.log("ALL DONE");
}
main().catch((e) => { console.error(e); process.exit(1); });
