// src/App.js
import React, { useState, useEffect, useCallback } from "react";
import { api, connectSSE } from "./api";
import Dashboard from "./components/Dashboard";
import ReviewQueue from "./components/ReviewQueue";
import Tracker from "./components/Tracker";
import { UpdatesFeed, ExcludedCases } from "./components/Updates";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "review", label: "Review Queue" },
  { id: "tracker", label: "Approved Cases" },
  { id: "updates", label: "Updates" },
  { id: "excluded", label: "Excluded" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [stats, setStats] = useState(null);
  const [serverOk, setServerOk] = useState(null);

  const loadStats = useCallback(async () => {
    try {
      const s = await api.getStats();
      setStats(s);
      setServerOk(true);
    } catch {
      setServerOk(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  // SSE: reload stats on sync complete
  useEffect(() => {
    const disconnect = connectSSE((msg) => {
      if (msg.type === "sync_complete") loadStats();
    });
    return disconnect;
  }, [loadStats]);

  function navBadge(tabId) {
    if (tabId === "review" && stats?.pending > 0) return stats.pending;
    if (tabId === "updates" && stats?.unseenUpdates > 0) return stats.unseenUpdates;
    return null;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f7f6f2" }}>
      {/* Top nav */}
      <header style={{
        background: "#1b3254",
        borderBottom: "1px solid #142640",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{
          maxWidth: 1200, margin: "0 auto",
          display: "flex", alignItems: "center",
          padding: "0 32px", height: 52,
          gap: 0,
        }}>
          {/* Logo */}
          <div style={{ marginRight: 32, flexShrink: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 15, color: "#fff", letterSpacing: "-0.01em" }}>
              Democracy 2025
            </span>
            <span style={{ fontSize: 13, color: "#6a94c0", marginLeft: 10, fontWeight: 400 }}>
              Case Tracker
            </span>
          </div>

          {/* Nav tabs */}
          <nav style={{ display: "flex", gap: 2, flex: 1 }}>
            {TABS.map((t) => {
              const badge = navBadge(t.id);
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "0 14px", height: 52, fontWeight: active ? 600 : 400,
                  fontSize: 13, color: active ? "#fff" : "#8ab4d4",
                  background: active ? "rgba(255,255,255,0.1)" : "transparent",
                  borderBottom: active ? "2px solid #fff" : "2px solid transparent",
                  border: "none", borderRadius: 0, cursor: "pointer",
                  transition: "all 0.12s",
                }}>
                  {t.label}
                  {badge != null && (
                    <span style={{
                      background: t.id === "updates" ? "#c0392b" : "#e8a020",
                      color: "#fff", borderRadius: 10,
                      fontSize: 11, fontWeight: 700,
                      padding: "1px 6px", lineHeight: "16px",
                    }}>{badge}</span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Server status */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: serverOk === null ? "#6a94c0" : serverOk ? "#4cba7a" : "#e05c4c",
              display: "inline-block",
            }} />
            <span style={{ fontSize: 11, color: "#6a94c0" }}>
              {serverOk === null ? "Connecting…" : serverOk ? "Connected" : "Server offline"}
            </span>
          </div>
        </div>
      </header>

      {/* Server offline banner */}
      {serverOk === false && (
        <div style={{
          background: "#c0392b", color: "#fff", padding: "10px 32px",
          fontSize: 13, textAlign: "center",
        }}>
          ⚠ Cannot reach the server at localhost:3001. Make sure the backend is running with{" "}
          <code style={{ background: "rgba(255,255,255,0.2)", padding: "1px 6px", borderRadius: 3 }}>
            cd server && npm start
          </code>
        </div>
      )}

      {/* Page content */}
      <main>
        {tab === "dashboard" && <Dashboard onTabChange={setTab} />}
        {tab === "review" && <ReviewQueue />}
        {tab === "tracker" && <Tracker />}
        {tab === "updates" && <UpdatesFeed />}
        {tab === "excluded" && <ExcludedCases />}
      </main>
    </div>
  );
}
