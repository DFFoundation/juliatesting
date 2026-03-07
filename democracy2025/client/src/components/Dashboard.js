// src/components/Dashboard.js
import React, { useEffect, useState, useCallback } from "react";
import { api, connectSSE } from "../api";
import { Card, Button, Badge, Spinner, SectionHeader, StatusDot } from "./UI";
import { NOS_GROUPS, DEFAULT_NOS } from "../nosCodes";

function StatCard({ label, value, sub, color }) {
  return (
    <Card style={{ padding: "20px 24px", flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || "#1a1a18", lineHeight: 1 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#4a4840", marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: "#8a8778", marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}

export default function Dashboard({ onTabChange }) {
  const [stats, setStats] = useState(null);
  const [syncLogs, setSyncLogs] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState([]);
  const [showNosSelector, setShowNosSelector] = useState(false);
  const [selectedNos, setSelectedNos] = useState(new Set(DEFAULT_NOS));
  const [dateFrom, setDateFrom] = useState("2025-01-20");
  const [dateTo, setDateTo] = useState(new Date().toISOString().split("T")[0]);
  const [enrichParties, setEnrichParties] = useState(false);
  const [courts, setCourts] = useState("");

  const loadData = useCallback(async () => {
    const [s, logs] = await Promise.all([api.getStats(), api.getSyncLogs()]);
    setStats(s);
    setSyncLogs(logs);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // SSE progress listener
  useEffect(() => {
    const disconnect = connectSSE((msg) => {
      if (msg.type === "sync_start") {
        setSyncing(true);
        setSyncProgress([`▶ ${msg.syncType} started`]);
      } else if (msg.type === "progress") {
        setSyncProgress((p) => [...p.slice(-30), msg.message]);
      } else if (msg.type === "sync_complete") {
        setSyncing(false);
        setSyncProgress((p) => [...p, `✓ Complete`]);
        loadData();
      } else if (msg.type === "sync_error") {
        setSyncing(false);
        setSyncProgress((p) => [...p, `✗ Error: ${msg.error}`]);
      }
    });
    return disconnect;
  }, [loadData]);

  async function triggerCaseSync() {
    setSyncing(true);
    setSyncProgress(["Requesting case sync from PACER PCL…"]);
    await api.triggerCaseSync({
      dateFrom, dateTo,
      nosCodes: [...selectedNos],
      courts: courts || undefined,
      enrichParties,
    });
  }

  async function triggerUpdateSync() {
    setSyncing(true);
    setSyncProgress(["Requesting update check via CourtListener…"]);
    await api.triggerUpdateSync();
  }

  const toggleNos = (code) => {
    setSelectedNos((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <SectionHeader
        title="Democracy 2025 Case Tracker"
        subtitle="Federal civil cases against federal defendants — filed since January 20, 2025"
      />

      {/* Stats row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
        <StatCard label="Total Cases" value={stats?.total} />
        <StatCard label="Pending Review" value={stats?.pending} color="#b45309" />
        <StatCard label="Approved" value={stats?.approved} color="#1a7a4a" />
        <StatCard label="Excluded" value={stats?.excluded} color="#8a8778" />
        <StatCard
          label="Unseen Updates"
          value={stats?.unseenUpdates}
          color={stats?.unseenUpdates > 0 ? "#c0392b" : "#8a8778"}
          sub={stats?.unseenUpdates > 0 ? "Click Updates tab" : "All caught up"}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Case Identification Sync */}
        <Card style={{ padding: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Case Identification</div>
          <div style={{ fontSize: 13, color: "#8a8778", marginBottom: 16 }}>
            Pull new civil cases from PACER PCL matching your NOS codes and date range.
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#8a8778", display: "block", marginBottom: 4 }}>FROM</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                style={{ width: "100%", padding: "6px 10px", border: "1px solid #e2e0d8", borderRadius: 6, fontSize: 13 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#8a8778", display: "block", marginBottom: 4 }}>TO</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                style={{ width: "100%", padding: "6px 10px", border: "1px solid #e2e0d8", borderRadius: 6, fontSize: 13 }} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#8a8778", display: "block", marginBottom: 4 }}>COURT IDs (comma-separated, blank = all)</label>
            <input value={courts} onChange={(e) => setCourts(e.target.value)}
              placeholder="e.g. dcd, nysd, cacd, ilnd"
              style={{ width: "100%", padding: "6px 10px", border: "1px solid #e2e0d8", borderRadius: 6, fontSize: 13 }} />
          </div>

          {/* NOS Selector */}
          <div style={{ marginBottom: 16 }}>
            <button onClick={() => setShowNosSelector(!showNosSelector)} style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 12, fontWeight: 600, color: "#1b3254",
              background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 8,
            }}>
              <span>{showNosSelector ? "▼" : "▶"}</span>
              Nature of Suit Codes ({selectedNos.size} selected)
            </button>

            {showNosSelector && (
              <div style={{ border: "1px solid #e2e0d8", borderRadius: 6, padding: 12, background: "#f7f6f2" }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <button onClick={() => setSelectedNos(new Set(NOS_GROUPS.flatMap(g => g.codes.map(c => c.code))))}
                    style={{ fontSize: 11, fontWeight: 600, color: "#1b3254", background: "none", border: "1px solid #1b3254", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                    All
                  </button>
                  <button onClick={() => setSelectedNos(new Set())}
                    style={{ fontSize: 11, fontWeight: 600, color: "#8a8778", background: "none", border: "1px solid #c8c5b8", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                    None
                  </button>
                  <button onClick={() => setSelectedNos(new Set(DEFAULT_NOS))}
                    style={{ fontSize: 11, fontWeight: 600, color: "#1a7a4a", background: "none", border: "1px solid #1a7a4a", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                    Reset defaults
                  </button>
                </div>
                {NOS_GROUPS.map((group) => (
                  <div key={group.label} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#8a8778", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {group.label}
                    </div>
                    {group.codes.map((c) => (
                      <label key={c.code} title={c.description} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "3px 6px",
                        borderRadius: 4, cursor: "pointer",
                        background: selectedNos.has(c.code) ? "#e8edf5" : "transparent",
                        fontSize: 12,
                      }}>
                        <input type="checkbox" checked={selectedNos.has(c.code)} onChange={() => toggleNos(c.code)}
                          style={{ cursor: "pointer", flexShrink: 0 }} />
                        <span className="mono" style={{ color: "#4a4840", fontSize: 11, flexShrink: 0 }}>{c.code}</span>
                        <span>{c.label}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#4a4840", marginBottom: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={enrichParties} onChange={(e) => setEnrichParties(e.target.checked)} />
            Enrich with party data (uses additional PACER fees)
          </label>

          <Button variant="primary" onClick={triggerCaseSync} disabled={syncing} style={{ width: "100%" }}>
            {syncing ? <><Spinner size={14} color="#fff" /> Running…</> : "Run Case Search"}
          </Button>
        </Card>

        {/* Update Tracking Sync */}
        <Card style={{ padding: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Update Tracking</div>
          <div style={{ fontSize: 13, color: "#8a8778", marginBottom: 16 }}>
            Check all approved cases for new docket activity via CourtListener. Runs automatically twice daily.
          </div>

          {stats?.unseenUpdates > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", background: "#fdf0ee", border: "1px solid #f5c0b8",
              borderRadius: 6, marginBottom: 16, fontSize: 13,
            }}>
              <span style={{ fontSize: 18 }}>🔴</span>
              <div>
                <strong>{stats.unseenUpdates} unseen update{stats.unseenUpdates > 1 ? "s" : ""}</strong> across tracked cases.
                <span style={{ color: "#c0392b", cursor: "pointer", marginLeft: 6 }}
                  onClick={() => onTabChange("updates")}>
                  View updates →
                </span>
              </div>
            </div>
          )}

          <div style={{ padding: "12px 14px", background: "#f7f6f2", border: "1px solid #e2e0d8", borderRadius: 6, marginBottom: 16, fontSize: 12, color: "#4a4840" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Automatic schedule</div>
            <div>🔍 Case identification — Daily at 8:00 AM</div>
            <div>🔄 Update tracking — Daily at 9:00 AM and 5:00 PM</div>
            <div style={{ marginTop: 6, color: "#8a8778" }}>
              {stats?.lastSync ? `Last sync: ${new Date(stats.lastSync).toLocaleString()}` : "No syncs yet"}
            </div>
          </div>

          <Button variant="default" onClick={triggerUpdateSync} disabled={syncing} style={{ width: "100%", marginBottom: 12 }}>
            {syncing ? <><Spinner size={14} /> Checking…</> : "Check for Updates Now"}
          </Button>

          <Button variant="default" onClick={() => api.exportCsv("approved")} style={{ width: "100%" }}>
            ↓ Export Approved Cases (CSV)
          </Button>
        </Card>
      </div>

      {/* Progress Log */}
      {syncProgress.length > 0 && (
        <Card style={{ marginTop: 20, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", background: "#1b3254", display: "flex", alignItems: "center", gap: 10 }}>
            {syncing && <Spinner size={14} color="#fff" />}
            <span style={{ fontWeight: 600, fontSize: 13, color: "#fff" }}>
              {syncing ? "Sync in progress…" : "Last sync output"}
            </span>
          </div>
          <div style={{
            padding: 16, fontFamily: "IBM Plex Mono, monospace", fontSize: 12,
            background: "#0f1f35", color: "#a8c8e8", maxHeight: 200, overflowY: "auto",
            lineHeight: 1.7,
          }}>
            {syncProgress.map((line, i) => (
              <div key={i} style={{ color: line.startsWith("✗") ? "#f5a0a0" : line.startsWith("✓") ? "#88e0a8" : "#a8c8e8" }}>
                {line}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Sync History */}
      {syncLogs.length > 0 && (
        <Card style={{ marginTop: 20, padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Sync History</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e2e0d8" }}>
                {["Type", "Status", "Started", "Cases Found", "Eligible", "Updates"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "4px 10px 8px 0", color: "#8a8778", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {syncLogs.slice(0, 8).map((log) => (
                <tr key={log.id} style={{ borderBottom: "1px solid #f0efe9" }}>
                  <td style={{ padding: "6px 10px 6px 0", fontWeight: 500 }}>{log.sync_type}</td>
                  <td style={{ padding: "6px 10px 6px 0" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <StatusDot status={log.status} />
                      {log.status}
                    </span>
                  </td>
                  <td style={{ padding: "6px 10px 6px 0", color: "#8a8778" }}>{log.started_at ? new Date(log.started_at).toLocaleString() : "—"}</td>
                  <td style={{ padding: "6px 10px 6px 0" }}>{log.cases_found ?? "—"}</td>
                  <td style={{ padding: "6px 10px 6px 0", color: "#1a7a4a", fontWeight: 500 }}>{log.cases_eligible ?? "—"}</td>
                  <td style={{ padding: "6px 10px 6px 0", color: log.updates_found > 0 ? "#c0392b" : "#8a8778" }}>{log.updates_found ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
