/**
 * scene/depth-hud.ts — the data readout of the dive.
 *
 * A depth counter, a vertical rail of the stops, the current stop's label and
 * a closing source card. Drawn in the DOM so the numbers stay crisp at any
 * render scale, and driven by the same pure depthPlan as the 3D stage, so the
 * counter and the camera can never disagree.
 *
 * This is method B's own HUD (its own type and layout). The caption line is
 * separate shared content, drawn by overlay.ts.
 */
import { depthPlan, toWorld, type DepthBlock } from "./depth";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function mountDepthHud(block: DepthBlock, duration: number): { update: (t: number) => void } {
  const plan = depthPlan(block, duration);
  const max = Math.max(1, ...plan.stops.map((s) => s.item.value));
  const unit = block.unit ?? plan.stops[0]?.item.unit ?? "m";

  const root = document.createElement("div");
  root.id = "depth-hud";
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "15",
    fontFamily: "'Inter', system-ui, sans-serif",
    color: "#eaf6f8",
  });

  const pad = () => Math.min(window.innerWidth, window.innerHeight) / 1080;

  // ---- the counter --------------------------------------------------------
  const counter = document.createElement("div");
  Object.assign(counter.style, { position: "absolute", left: "6%", top: "8%" });
  const kicker = document.createElement("div");
  kicker.textContent = "DEPTH";
  const unitEl = document.createElement("span");
  unitEl.textContent = ` ${unit}`;
  const numWrap = document.createElement("div");
  numWrap.append(document.createTextNode("0"), unitEl);
  counter.append(kicker, numWrap);
  root.appendChild(counter);

  // ---- the rail -----------------------------------------------------------
  const rail = document.createElement("div");
  const railTop = 0.24;
  const railH = 0.5;
  Object.assign(rail.style, {
    position: "absolute",
    left: "93.6%",
    top: `${railTop * 100}%`,
    height: `${railH * 100}%`,
    borderLeft: "1px solid rgba(214,240,246,0.22)",
  });
  const marker = document.createElement("div");
  Object.assign(marker.style, {
    position: "absolute",
    left: "-14px",
    width: "28px",
    height: "1px",
    background: "rgba(240,252,255,0.85)",
  });
  const dot = document.createElement("div");
  Object.assign(dot.style, {
    position: "absolute",
    left: "-3px",
    top: "-3px",
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    background: "#eaf6f8",
  });
  marker.appendChild(dot);
  rail.appendChild(marker);

  const ticks: HTMLDivElement[] = [];
  for (const stop of plan.stops) {
    const tick = document.createElement("div");
    Object.assign(tick.style, {
      position: "absolute",
      left: "-6px",
      width: "7px",
      height: "1px",
      background: "rgba(214,240,246,0.45)",
      opacity: "0.7",
    });
    tick.title = stop.item.label;
    rail.appendChild(tick);
    ticks.push(tick);
  }
  const elbow = document.createElement("div");
  elbow.textContent = "scale compressed below 1 000 m";
  Object.assign(elbow.style, {
    position: "absolute",
    right: "12px",
    transform: "translateY(-50%)",
    fontSize: "12px",
    letterSpacing: "0.04em",
    whiteSpace: "nowrap",
    textAlign: "center",
    color: "rgba(220,242,246,0.74)",
    background: "rgba(4,26,34,0.55)",
    padding: "3px 7px",
    borderRadius: "9px",
  });
  rail.appendChild(elbow);
  root.appendChild(rail);

  // ---- the current stop ---------------------------------------------------
  const stopLabel = document.createElement("div");
  Object.assign(stopLabel.style, {
    position: "absolute",
    left: "6%",
    top: "84%",
    right: "12%",
    borderLeft: "2px solid rgba(190,240,255,0.6)",
    paddingLeft: "14px",
  });
  const stopName = document.createElement("div");
  const stopNote = document.createElement("div");
  stopLabel.append(stopName, stopNote);
  root.appendChild(stopLabel);

  // ---- the closing card ---------------------------------------------------
  const close = document.createElement("div");
  Object.assign(close.style, {
    position: "absolute",
    left: "8%",
    right: "8%",
    top: "30%",
    textAlign: "center",
    opacity: "0",
  });
  const closeTitle = document.createElement("div");
  closeTitle.textContent = block.title ?? "How deep is the ocean?";
  const closeSrc = document.createElement("div");
  closeSrc.textContent = block.source ? `Source: ${block.source}` : "";
  close.append(closeTitle, closeSrc);
  root.appendChild(close);

  document.body.appendChild(root);

  const place = (el: HTMLElement, top: number) => {
    el.style.top = `${top * 100}%`;
  };

  // Size everything once per frame; the scale only changes with the viewport.
  let lastScale = 0;
  function size(): void {
    const s = pad();
    if (s === lastScale) return;
    lastScale = s;
    kicker.style.cssText = `font-size:${20 * s}px;letter-spacing:0.3em;color:rgba(214,240,246,0.62);margin-bottom:${10 * s}px;`;
    numWrap.style.cssText = `font-size:${92 * s}px;font-weight:200;line-height:1;letter-spacing:-0.02em;`;
    unitEl.style.cssText = `font-size:${30 * s}px;font-weight:400;color:rgba(214,240,246,0.7);letter-spacing:0.02em;`;
    stopName.style.cssText = `font-size:${30 * s}px;font-weight:600;letter-spacing:0.01em;text-shadow:0 ${2 * s}px ${8 * s}px rgba(0,0,0,0.6);`;
    stopNote.style.cssText = `font-size:${20 * s}px;font-weight:400;color:rgba(226,246,250,0.78);margin-top:${6 * s}px;text-shadow:0 ${1 * s}px ${6 * s}px rgba(0,0,0,0.55);`;
    closeTitle.style.cssText = `font-size:${46 * s}px;font-weight:600;line-height:1.15;text-shadow:0 ${2 * s}px ${10 * s}px rgba(0,0,0,0.55);`;
    closeSrc.style.cssText = `font-size:${19 * s}px;color:rgba(214,240,246,0.6);margin-top:${14 * s}px;letter-spacing:0.03em;`;
    elbow.style.fontSize = `${11 * s}px`;
  }

  let lastStop = -1;
  return {
    update(t: number) {
      size();
      const depth = plan.depthAt(t);
      numWrap.firstChild!.nodeValue = fmt(depth);

      const f = toWorld(depth) / toWorld(max);
      marker.style.top = `${Math.min(1, Math.max(0, f)) * 100}%`;

      for (const [i, stop] of plan.stops.entries()) {
        place(ticks[i], toWorld(stop.item.value) / toWorld(max));
      }
      place(elbow, toWorld(1000) / toWorld(max));

      // The label changes when the camera enters a stop's window.
      const active = plan.stops.findIndex((s) => t >= s.from && t <= s.to);
      if (active !== lastStop) {
        lastStop = active;
        const stop = active >= 0 ? plan.stops[active] : null;
        stopName.textContent = stop ? stop.item.label : "";
        stopNote.textContent = stop?.item.note ?? "";
        stopLabel.style.opacity = stop ? "1" : "0";
      }

      const card = Math.min(1, Math.max(0, (t - plan.closeAt) / 0.8));
      close.style.opacity = String(card);
      close.style.transform = `translateY(${(1 - card) * 14}px)`;
      // The counter recedes while the closing card is up.
      counter.style.opacity = String(1 - 0.55 * card);
      stopLabel.style.opacity = String((1 - card) * (lastStop >= 0 ? 1 : 0));
    },
  };
}



