/**
 * Room.tsx — warm vector interior: wall, window with light shaft, door,
 * poster, side table + lamp, rug. Layered for parallax; every color from
 * the theme palettes. The "normal life" beat world.
 */
import * as React from "react";
import { PALETTES } from "../theme";

export interface RoomProps {
  /** "day" = bright glass + light shaft; "night" = dark glass, lamp glow. */
  light?: "day" | "night";
}

export const Room: React.FC<RoomProps> = ({ light = "day" }) => {
  const P = PALETTES.room;
  const wallGrad = `linear-gradient(180deg, ${P.wallLight} 0%, ${P.wall} 78%)`;
  const glass =
    light === "day"
      ? `linear-gradient(180deg, #bfe3ff 0%, #ffe0b8 100%)`
      : `linear-gradient(180deg, #2b1f52 0%, #4d3a7a 100%)`;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* Wall */}
      <div style={{ position: "absolute", inset: `0 0 39% 0`, background: wallGrad }} />

      {/* Floor */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "39%",
          background: `linear-gradient(180deg, ${P.floorLight} 0%, ${P.floor} 30%)`,
        }}
      />
      {/* Baseboard */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "61.0%",
          height: 26,
          background: "#2a2840",
        }}
      />

      {/* Floor plank lines (subtle) */}
      <svg
        viewBox="0 0 1080 750"
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: "100%",
          height: "39%",
          opacity: 0.25,
        }}
        preserveAspectRatio="none"
      >
        {[620, 530, 450, 380, 320].map((lineY, i) => (
          <line
            key={lineY}
            x1={i % 2 === 0 ? 0 : -40}
            y1={lineY}
            x2={1080}
            y2={lineY + (i % 2 === 0 ? 0 : -20)}
            stroke="#2f2342"
            strokeWidth={6}
          />
        ))}
      </svg>

      {/* Window (right) */}
      <div style={{ position: "absolute", left: 660, top: 230, width: 330, height: 470 }}>
        <div
          style={{
            position: "absolute",
            inset: -22,
            borderRadius: 18,
            background: "#242238",
          }}
        />
        <div style={{ position: "absolute", inset: 0, borderRadius: 8, background: glass, overflow: "hidden" }}>
          {/* Far window glints */}
          <div style={{ position: "absolute", left: 40, top: 180, width: 34, height: 34, borderRadius: 8, background: light === "day" ? "rgba(255,255,255,0.75)" : "rgba(255,196,107,0.85)" }} />
          <div style={{ position: "absolute", left: 190, top: 240, width: 26, height: 26, borderRadius: 7, background: light === "day" ? "rgba(255,255,255,0.5)" : "rgba(125,224,255,0.75)" }} />
          <div style={{ position: "absolute", left: 120, top: 320, width: 20, height: 20, borderRadius: 6, background: light === "day" ? "rgba(255,255,255,0.4)" : "rgba(255,196,107,0.6)" }} />
        </div>
        {/* Mullions */}
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 14, transform: "translateX(-50%)", background: "#242238" }} />
        <div style={{ position: "absolute", top: "48%", left: 0, right: 0, height: 14, background: "#242238" }} />
      </div>

      {/* Light shaft from window */}
      {light === "day" && (
        <svg
          viewBox="0 0 1080 1920"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        >
          <defs>
            <linearGradient id="shaft" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={P.windowGlow} stopOpacity="0.5" />
              <stop offset="60%" stopColor={P.windowGlow} stopOpacity="0.16" />
              <stop offset="100%" stopColor={P.windowGlow} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points="700,700 990,700 1080,1730 430,1730" fill="url(#shaft)" />
        </svg>
      )}

      {/* Door (left) — reaches the floor line */}
      <div style={{ position: "absolute", left: 86, top: 350, width: 210, height: 820 }}>
        <div style={{ position: "absolute", inset: -18, borderRadius: 14, background: "#211f33" }} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 6,
            background: `linear-gradient(90deg, #4a3f66 0%, #3c3354 60%)`,
          }}
        />
        <div style={{ position: "absolute", left: 18, top: 70, width: 70, height: 3, background: "#332c49" }} />
        <div style={{ position: "absolute", left: 18, top: 90, width: 70, height: 3, background: "#332c49" }} />
        <div style={{ position: "absolute", right: 20, top: 50, width: 16, height: 16, borderRadius: 8, background: "#ffb703" }} />
      </div>

      {/* Poster */}
      <div
        style={{
          position: "absolute",
          left: 372,
          top: 260,
          width: 170,
          height: 230,
          background: "#fff3d6",
          borderRadius: 10,
          transform: "rotate(-2deg)",
          boxShadow: "0 12px 30px rgba(10,6,24,0.35)",
        }}
      >
        <div style={{ position: "absolute", inset: 18, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div
            style={{
              fontFamily: "Inter, sans-serif",
              fontWeight: 900,
              fontSize: 26,
              color: "#312e5c",
              transform: "rotate(2deg)",
              letterSpacing: 1,
            }}
          >
            UP IS DOWN.
          </div>
        </div>
        <div style={{ position: "absolute", left: 20, top: 20, width: 90, height: 90, borderRadius: "50%", background: "#6d28d9" }} />
      </div>

      {/* Side table + lamp (left of rug, front-left) */}
      <div style={{ position: "absolute", left: 96, top: 1180, width: 240, height: 240 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 70,
            width: 230,
            height: 120,
            borderRadius: 14,
            background: `linear-gradient(180deg, #5a4878 0%, #463765 100%)`,
          }}
        />
        <div style={{ position: "absolute", left: 26, top: 190, width: 22, height: 60, background: "#3a2f58" }} />
        <div style={{ position: "absolute", left: 190, top: 190, width: 22, height: 60, background: "#3a2f58" }} />
        {/* Lamp */}
        <div style={{ position: "absolute", left: 130, top: -80, width: 70, height: 70 }}>
          <div style={{ position: "absolute", bottom: 0, left: 20, width: 8, height: 90, background: "#2f2a4a" }} />
          <div
            style={{
              position: "absolute",
              top: -26,
              left: -18,
              width: 84,
              height: 62,
              borderRadius: "50% 50% 24% 24%",
              background: light === "day" ? "#c9b8de" : "#ffdf9e",
              boxShadow: light === "day" ? "none" : "0 0 60px 24px rgba(255,223,158,0.45)",
            }}
          />
        </div>
        {/* Mug on table */}
        <div style={{ position: "absolute", left: 62, top: 52, width: 52, height: 40, borderRadius: "0 0 14px 14px", background: "#e76f51" }} />
      </div>

      {/* Rug — restrained */}
      <div
        style={{
          position: "absolute",
          left: 350,
          top: 1500,
          width: 560,
          height: 230,
          borderRadius: "50%",
          background: "radial-gradient(ellipse at center, #564070 0%, #47335c 70%)",
          transform: "rotate(-1.5deg)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 396,
          top: 1526,
          width: 470,
          height: 178,
          borderRadius: "50%",
          border: "7px solid rgba(255,255,255,0.12)",
        }}
      />
    </div>
  );
};
