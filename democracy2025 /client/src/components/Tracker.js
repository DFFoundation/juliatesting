// src/components/Tracker.js — Approved cases tracker
import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api";
import { Card, Button, Badge, Spinner, EmptyState, SectionHeader } from "./UI";
import { NOS_LABEL_MAP } from "../nosCodes";

export default function Tracker() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterNos, setFilterNos] = useState("");
  const [filterAppeal, setFilterAppeal] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api.getCases({
      reviewStatus: "approved",
      search: search || undefined,
      nosCode: filterNos || undefined,
    });
    const filtered = filterAppeal ? data.filter((c) => c.appealLevel === filterAppeal) : data;
    setCases(filtered);
    setLoading(false);
  }, [search, filterNos, filterAppeal]);

  useEffect(() => { load(); }, [load]);

  async function handleReset(id) {
    if (!window.confirm("Move this case back to pending review?")) return;
    await api.resetCase(id);
    setCases((prev) => prev.filter((c) => c.id !== id));
  }

  const nosOptions = [...new Set(cases.map((c) => c.nosCode).filter(Boolean))];
  const appealOptions = [...new Set(cases.map((c) => c.appealLevel).filter(Boolean))];

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1200, margin: "0 auto" }}>
      <SectionHeader
        title="Approved Cases"
        subtitle={`${cases.length} case${cases.length !== 1 ? "s" : ""} in tracker`}
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              style={{ padding: "6px 10px", border: "1px solid #e2e0d8", borderRadius: 6, fontSize: 13, width: 180 }} />
            <select value={filterNos} onChange={(e) => setFilterNos(e.target.value)}
              style={{ padding: "6px 10px", border: "1px solid #e2e0d8", borderRadius: 6, fontSize: 13 }}>
              <option value="">All types</option>
              {nosOptions.map((n) => <option key={n} value={n}>{n} — {NOS_LABEL_MAP[n] || n}</option>)}
            </select>
            <select value={filterAppeal} onChange={(e) => setFilterAppeal(e.target.value)}
              style={{ padding: "6px 10px", border: "1px solid #e2e0d8", borderRadius: 6, fontSize: 13 }}>
              <option value="">All courts</option>
              {appealOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <Button onClick={() => api.exportCsv("approved")}>↓ CSV</Button>
          </div>
        }
      />

      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}><Spinner size={28} /></div>
      ) : cases.length === 0 ? (
        <EmptyState icon="📋" title="No approved cases yet" subtitle="Approve cases from the Review Queue to add them here" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {cases.map((c) => (
            <CaseCard key={c.id} c={c} onReset={handleReset} />
          ))}
        </div>
      )}
    </div>
  );
}

function CaseCard({ c, onReset }) {
  const [expanded, setExpanded] = useState(false);
  const [updates, setUpdates] = useState(null);
  const hasUpdates = c.latestFilings?.length > 0;

  async function loadUpdates() {
    if (!expanded) {
      const data = await api.getCase(c.id);
      setUpdates(data.updates || []);
      if (data.updates?.some((u) => !u.seen)) {
        await api.markUpdatesSeen(c.id);
      }
    }
    setExpanded(!expanded);
  }

  return (
    <Card style={{ overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#1b3254" }}>{c.caseName}</span>
            <Badge variant="green">Approved</Badge>
            {c.appealLevel !== "District Court" && (
              <Badge variant={c.appealLevel === "Supreme Court" ? "red" : "amber"}>{c.appealLevel}</Badge>
            )}
            {hasUpdates && <Badge variant="red">New filings</Badge>}
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "#8a8778" }}>
            <span className="mono">{c.docketNumber}</span>
            <span>{c.court}</span>
            <span>Filed {c.filingDate}</span>
            <span style={{ color: "#4a4840" }}>
              <span style={{ padding: "1px 6px", background: "#f0efe9", borderRadius: 3, fontFamily: "monospace", fontSize: 11 }}>{c.nosCode}</span>
              {" "}{NOS_LABEL_MAP[c.nosCode] || c.caseType}
            </span>
          </div>

          {(c.plaintiffs?.length > 0 || c.defendants?.length > 0) && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#4a4840" }}>
              {c.plaintiffs?.length > 0 && <span><strong>P:</strong> {c.plaintiffs.slice(0, 3).join(", ")}{c.plaintiffs.length > 3 ? ` +${c.plaintiffs.length - 3}` : ""}</span>}
              {c.plaintiffs?.length > 0 && c.defendants?.length > 0 && <span style={{ margin: "0 8px", color: "#c8c5b8" }}>·</span>}
              {c.defendants?.length > 0 && <span><strong>D:</strong> {c.defendants.slice(0, 3).join(", ")}{c.defendants.length > 3 ? ` +${c.defendants.length - 3}` : ""}</span>}
            </div>
          )}

          {c.notes && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#4a4840", fontStyle: "italic" }}>{c.notes}</div>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {c.courtListenerLink && (
            <Button size="sm" onClick={() => window.open(c.courtListenerLink, "_blank")}>CL ↗</Button>
          )}
          <Button size="sm" onClick={loadUpdates}>
            {expanded ? "▲ Hide" : `▼ Details${hasUpdates ? " 🔴" : ""}`}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onReset(c.id)} title="Move back to review">↩</Button>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid #f0efe9", padding: "16px 20px", background: "#f7f6f2" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {c.counsel?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#8a8778", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Counsel</div>
                {c.counsel.map((a, i) => <div key={i} style={{ fontSize: 12 }}>{a}</div>)}
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#8a8778", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Recent Filings</div>
              {updates === null && <div style={{ fontSize: 12, color: "#8a8778" }}>Loading…</div>}
              {updates?.length === 0 && <div style={{ fontSize: 12, color: "#8a8778" }}>No filings tracked yet</div>}
              {updates?.map((u) => (
                <div key={u.id} style={{ marginBottom: 8, fontSize: 12 }}>
                  <div style={{ fontWeight: 500 }}>{u.description}</div>
                  <div style={{ color: "#8a8778" }}>{u.dateFiled || u.createdAt?.split("T")[0]}</div>
                  {u.documents?.length > 0 && (
                    <div style={{ color: "#1d5fa8", marginTop: 2 }}>
                      {u.documents.length} document{u.documents.length > 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
