/**
 * scene/overlay.ts — method B's captions.
 *
 * The picture belongs to the method; the words do not. Captions are shared
 * content: the same spec.captions, the same resolved CaptionLook and the same
 * layout helpers the factory's hud/Captions.tsx uses (docs/factory/23-visual-
 * methods.md §2). Drawing them in a DOM layer above the canvas is what lets
 * Chrome screenshot canvas + text in one frame — no second renderer, no
 * ffmpeg drawtext, no font guessing.
 *
 * Everything is a function of t, like the scene, so a frame is reproducible.
 */
import { FONT_STACKS, hexToRgba, type CaptionLook } from "../../../generator/caption-style";
import { captionCentrePct, captionScale, centredTextMargin, textOutline } from "../../../generator/layout";

export interface SceneCaption {
  text: string;
  sub?: string;
  /** Seconds. */
  from: number;
  to: number;
  keyword?: string[];
  style?: "bold" | "serif-italic";
}

/** Ease-out with a small overshoot: a caption "pops" into place. */
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function markKeywords(text: string, keywords: string[] | undefined): Array<{ word: string; hit: boolean }> {
  const keys = (keywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({
      word,
      hit: keys.some((k) => word.toLowerCase().replace(/[^a-z0-9]/g, "").includes(k.replace(/[^a-z0-9]/g, ""))),
    }));
}

export interface CaptionLayer {
  update(t: number): void;
}

/**
 * Mount the caption layer. `look` is the spec's resolved CaptionLook; the
 * narration plate always keeps its own serif-italic look, as in the factory.
 */
export function mountCaptions(
  captions: SceneCaption[],
  look: CaptionLook,
  plateFont: CaptionLook["font"] = "serif",
): CaptionLayer {
  const root = document.createElement("div");
  root.id = "captions";
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "20",
  });
  const outer = document.createElement("div");
  Object.assign(outer.style, { position: "absolute", display: "flex", justifyContent: "center" });
  const block = document.createElement("div");
  Object.assign(block.style, { maxWidth: "100%", textAlign: "center" });
  outer.appendChild(block);
  root.appendChild(outer);
  document.body.appendChild(root);

  const width = () => window.innerWidth;
  const height = () => window.innerHeight;

  let activeIndex = -1;
  let active: SceneCaption | null = null;
  let words: HTMLSpanElement[] = [];
  let blockLook: CaptionLook = look;
  let scale = 1;

  function layoutFor(c: SceneCaption) {
    const w = width();
    const h = height();
    scale = captionScale(w, h);
    const margin = centredTextMargin(w, h) * 100;
    const l: CaptionLook =
      c.style === "serif-italic"
        ? { ...look, font: plateFont, italic: true, uppercase: false, weight: 400 }
        : look;
    blockLook = l;

    Object.assign(outer.style, {
      top: `calc(${captionCentrePct(l.position, w, h) + l.offsetPct}%)`,
      left: `${margin}%`,
      right: `${margin}%`,
    });

    const shadow = l.shadow ? textOutline(scale, l.weight >= 700 && l.background === "none" ? "outline" : "soft") : "";
    Object.assign(block.style, {
      fontFamily: FONT_STACKS[l.font],
      fontWeight: l.font === "archivo-black" ? "400" : String(l.weight),
      fontStyle: l.italic ? "italic" : "normal",
      fontSize: `${l.size * scale}px`,
      lineHeight: "1.2",
      color: l.color,
      letterSpacing: l.uppercase ? "0.5px" : "0",
      textShadow: shadow || "none",
      background: l.background === "none" ? "transparent" : hexToRgba(l.backgroundColor, l.backgroundOpacity),
      padding: l.background === "none" ? "0" : `${10 * scale}px ${24 * scale}px`,
      borderRadius: l.background === "pill" ? "999px" : `${12 * scale}px`,
    });
  }

  function build(c: SceneCaption) {
    layoutFor(c);
    block.textContent = "";
    words = [];
    const text = blockLook.uppercase ? c.text.toUpperCase() : c.text;
    for (const [i, w] of markKeywords(text, c.keyword).entries()) {
      if (i > 0) block.appendChild(document.createTextNode(" "));
      const span = document.createElement("span");
      span.textContent = w.word;
      span.style.color = w.hit ? blockLook.highlight : blockLook.color;
      if (w.hit) span.style.fontWeight = "900";
      block.appendChild(span);
      words.push(span);
    }
    if (c.sub) {
      const sub = document.createElement("div");
      sub.textContent = c.sub;
      Object.assign(sub.style, {
        marginTop: `${8 * scale}px`,
        fontSize: `${20 * scale}px`,
        color: blockLook.color,
        opacity: "0.85",
        textTransform: blockLook.uppercase ? "uppercase" : "none",
        letterSpacing: "0.3px",
        fontWeight: "600",
      });
      block.appendChild(sub);
    }
  }

  return {
    update(t: number) {
      const index = captions.findIndex((c) => t >= c.from && t <= c.to);
      if (index !== activeIndex) {
        activeIndex = index;
        active = index < 0 ? null : captions[index];
        block.textContent = "";
        words = [];
        if (active) build(active);
        root.style.display = active ? "block" : "none";
        if (!active) return;
      }
      if (!active) return;

      const local = Math.max(0, t - active.from);
      const enter = Math.min(1, local / 0.25);
      const duration = Math.max(0.01, active.to - active.from);

      let opacity = enter;
      let transform = "translateY(-50%)";
      if (blockLook.animation === "none") opacity = 1;
      if (blockLook.animation === "pop") transform = `translateY(-50%) scale(${0.7 + 0.3 * easeOutBack(enter)})`;
      if (blockLook.animation === "slide-up") transform = `translateY(calc(-50% + ${(1 - enter) * 40 * scale}px))`;
      block.style.opacity = String(opacity);
      block.style.transform = transform;

      if (blockLook.animation === "word-reveal") {
        const n = Math.max(1, words.length);
        for (const [i, span] of words.entries()) {
          span.style.opacity = local >= (i / n) * duration * 0.8 ? "1" : "0";
        }
      }
    },
  };
}

