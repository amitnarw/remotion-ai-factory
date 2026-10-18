import { useState, useEffect } from "react";
import { listVideos, deleteVideo, Video } from "../api";

// This dashboard is a React web app (not a Remotion composition), so native
// media elements are correct here.
/* eslint-disable @remotion/warn-native-media-tag */

export default function Videos() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [openReview, setOpenReview] = useState<{ id: string; reviewFolder?: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    listVideos().then((d) => setVideos(d || []));
  }, []);

  const handleDelete = async (v: Video) => {
    if (!window.confirm(`Delete "${v.premise}" and ALL of its rendered versions + review stills?\nThis cannot be undone.`)) {
      return;
    }
    setDeleteError(null);
    try {
      await deleteVideo(v.id);
      listVideos().then((d) => setVideos(d || []));
    } catch (e) {
      setDeleteError(String(e));
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h2 style={{ fontSize: "20px", marginBottom: 16 }}>Generated videos</h2>
      {videos.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No videos yet. Generate one from the Generate tab.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
          {videos.map((v) => (
            <div key={v.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
              <div style={{ aspectRatio: "9/16", background: "#000", position: "relative" }}>
                <video
                  autoPlay
                  loop
                  playsInline
                  controls
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  src={`/media/${v.output}`}
                />
                <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 8px", borderRadius: 4, fontSize: 12 }}>
                  {Math.round((Number(v.durationSec || 0) * 10)) / 10}s
                </div>
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{v.premise}</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                  {v.engine === "story" ? (
                    <>
                      Story engine • bespoke composition • {v.music ? `music: ${(v.music as { mood?: string }).mood}` : "synthesized score"}
                    </>
                  ) : (
                    <>
                      {v.provider} / {v.model} • {v.scenes} scenes • {v.events} events
                    </>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button
                    onClick={() => window.open(`/media/${v.output}`, "_blank")}
                    style={{ flex: 1, padding: "8px 12px", background: "#111827", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
                  >
                    Download
                  </button>
                  <button
                    onClick={() => setOpenReview({ id: v.id, reviewFolder: v.reviewFolder })}
                    disabled={!v.reviewFolder}
                    style={{ flex: 1, padding: "8px 12px", background: v.reviewFolder ? "#e5e7eb" : "#f9fafb", color: v.reviewFolder ? "#111827" : "#c7cad1", border: "none", borderRadius: 6, cursor: v.reviewFolder ? "pointer" : "not-allowed" }}
                    title={v.reviewFolder ? "Frame-by-frame review" : "No review folder (story engine renders are verified at build time)"}
                  >
                    Review frames
                  </button>
                  <button
                    onClick={() => handleDelete(v)}
                    style={{ padding: "8px 12px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {deleteError && (
        <div
          style={{
            background: "#fef2f2",
            color: "#991b1b",
            border: "1px solid #fecaca",
            padding: 12,
            borderRadius: 8,
            whiteSpace: "pre-wrap",
          }}
        >
          Delete failed: {deleteError}
        </div>
      )}
      {openReview && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 700, maxHeight: "90vh", overflow: "auto" }}>
            <button
              onClick={() => setOpenReview(null)}
              style={{ position: "absolute", top: 12, right: 12, background: "#111827", color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}
            >
              Close
            </button>
            <StillGallery id={openReview.id} reviewFolder={openReview.reviewFolder} />
          </div>
        </div>
      )}
    </div>
  );
}

function StillGallery({ id, reviewFolder }: { id: string; reviewFolder?: string }) {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!reviewFolder) return;
    fetch(`/media/${reviewFolder}/review-report.json`)
      .then((r) => (r.ok ? (r.json() as { frames?: Array<{ frame: number }> }) : null))
      .then((rep) => {
        if (rep?.frames) setFrames(rep.frames.map((f) => `/media/${reviewFolder}/frame-${String(f.frame).padStart(4, "0")}.png`));
      });
  }, [id, reviewFolder]);

  if (!frames.length) return <div style={{ color: "#6b7280" }}>Loading frames…</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
      {frames.map((src, i) => (
        <img key={i} src={src} alt="" style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", borderRadius: 6, border: "1px solid #e5e7eb" }} />
      ))}
    </div>
  );
}
