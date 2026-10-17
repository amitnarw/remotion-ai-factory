import { useState } from "react";
import Generate from "./pages/Generate";
import Providers from "./pages/Providers";
import Videos from "./pages/Videos";

type Tab = { key: "generate" | "providers" | "videos"; label: string };
const TABS: Tab[] = [
  { key: "generate", label: "Generate" },
  { key: "providers", label: "Providers" },
  { key: "videos", label: "Videos" },
];

export default function App() {
  const [tab, setTab] = useState<"generate" | "providers" | "videos">("generate");

  return (
    <div style={appStyle}>
      <div style={headerStyle}>
        <h1 style={h1Style}>AI Video Factory</h1>
        <div style={tabsStyle}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={tabStyle(tab === t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div style={contentStyle}>
        {tab === "generate" && <Generate />}
        {tab === "providers" && <Providers />}
        {tab === "videos" && <Videos />}
      </div>
    </div>
  );
}

const appStyle: React.CSSProperties = {
  fontFamily: 'system-ui, -apple-system, sans-serif',
  margin: 0,
  background: "#f5f5f7",
  minHeight: "100vh",
};
const headerStyle: React.CSSProperties = {
  background: "#111827",
  color: "#fff",
  padding: "16px 24px",
};
const h1Style: React.CSSProperties = { margin: 0, fontSize: "20px", display: "inline-block", marginRight: "24px" };
const tabsStyle: React.CSSProperties = { display: "flex", gap: "8px" };
const tabStyle = (active: boolean): React.CSSProperties => ({
  border: "none",
  background: active ? "#2563eb" : "#e5e7eb",
  color: active ? "#fff" : "#374151",
  padding: "8px 14px",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "14px",
});
const contentStyle: React.CSSProperties = {
  padding: "24px",
  maxWidth: 1200,
  margin: "0 auto",
};
