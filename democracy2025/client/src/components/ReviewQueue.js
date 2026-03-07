// src/components/ReviewQueue.js
import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api";
import { Card, Button, Badge, Spinner, EmptyState, SectionHeader } from "./UI";
import { NOS_LABEL_MAP } from "../nosCodes";

function nosVariant(code) {
  const map = { "895": "blue", "899": "navy", "441": "green", "463": "amber", "465": "amber" };
  return map[code] || "default";
}

function appealBadge(level) {
  if (level === "Supreme Court") return "red";
  if (level === "Circuit Court") return "amber";
  return "default";
}

function CaseRow({ c, onApprove, onExclude, onSelect }) {
  const [loading, setLoading] = useState(null);

  async function approve() {
    setLoading("approve");
    await onApprove(c.id);
    setLoading(null);
  }

  async function exclude() {
    const reason = window.prompt("Exclusion reason (optional):");
    if (reason === null) return;
    setLoading("exclude");
    await onExclude(c.id, reason);
    setLoading(null);
  }

  return (
    <tr style={{ borderBottom: "1px solid #f0efe9", verticalAlign: "top" }}
      className="fade-in">
      <td style={{ padding: "12px 14px 12px 0" }}>
        <button onClick={() => onSelect(c)} style={{
          background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0,
        }}>
          <div style={{ fontWeight: 600, color: "#1b3254", fontSize: 13, lineHeight: 1.3, marginBottom: 3 }}>
            {c.caseName}
          </div>
          <div style={{ fontSize: 12, color: "#8a8778", fontFamily: "IBM Plex Mono, monospace" }}>
            {c.docketNumber}
          </div>
        </button>
      </td>
      <td style={{ padding: "12px 12px 12px 0", whiteSpace: "nowrap" }}>
        <div style={{ fontSize: 12, color: "#4a4840" }}>{c.filingDate}</div>
        <div style={{ fontSize: 11, color: "#8a8778", marginTop: 2 }}>{c.court}</div>
      </td>
      <td style={{ padding: "12px 12px 12px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Badge variant={nosVariant(c.nosCode)}>
            <span style={{ fontFamily: "monospace", marginRight: 4 }}>{c.nosCode}</span>
            {NOS_LABEL_MAP[c.nosCode] || c.caseType}
          </Badge>
          {c.appealLevel !== "District Court" && (
            <Badge variant={appealBadge(c.appealLevel)}>{c.appealLevel}</Badge>
          )}
        </div>
      </td>
      <td style={{ padding: "12px 12px 12px 0", maxWidth: 220 }}>
        {c.plaintiffs?.length > 0 && (
          <div style={{ fontSize: 11, color: "#4a4840", marginBottom: 2 }}>
            <span style={{ color: "#8a8778" }}>P:</span> {c.plaintiffs.slice(0, 2).join(", ")}
            {c.plaintiffs.length > 2 && ` +${c.plaintiffs.length - 2}`}
          </div>
        )}
        {c.defendants?.length > 0 && (
          <div style={{ fontSize: 11, color: "#4a4840" }}>
            <span style={{ color: "#8a8778" }}>D:</span> {c.defendants.slice(0, 2).join(", ")}
            {c.defendants.length > 2 && ` +${c.defendants.length - 2}`}
          </div>
        )}
        {c.plaintiffs?.length === 0 && c.defendants?.length === 0 && (
          <span style={{ fontSize: 11, color: "#c8c5b8" }}>Party data pending</span>
        )}
      </td>
      <td style={{ padding: "12px 0 12px 0", whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" variant="success" onClick={approve} disabled={!!loading}
            style={{ minWidth: 76 }}>
            {loading === "approve" ? <Spinner size={11} color="#fff" /> : "✓ Approve"}
          </Button>
          <Button size="sm" variant="danger" onClick={exclude} disabled={!!loading}
            style={{ minWidth: 76 }}>
            {loading === "exclude" ? <Spinner size={11} color="#fff" /> : "✗ Exclude"}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function CaseDetail({ c, onClose, onApprove, onExclude }) {
  const [full, setFull] = useState(null);
  const [notes, setNotes] = useState(c.notes || "");
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    api.getCase(c.id).then(setFull);
  }, [c.id]);

  async function saveNotes() {
    setSavingNotes(true);
    await api.updateNotes(c.id, notes);
    setSavingNotes(false);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100,
      display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
    }} onClick={onClose}>
      <div style={{
        width: 540, height: "100%", background: "#fff", overflowY: "auto",
        boxShadow: "-4px 0 20px rgba(0,0,0,0.15)", padding: 28,
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1b3254", lineHeight: 1.3 }}>{c.caseName}</h3>
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 12, color: "#8a8778", marginTop: 4 }}>{c.docketNumber}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#8a8778", padding: 0, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          <Badge variant={nosVariant(c.nosCode)}>
            <span style={{ fontFamily: "monospace", marginRight: 4 }}>{c.nosCode}</span>
            {NOS_LABEL_MAP[c.nosCode] || c.caseType}
          </Badge>
          {c.appealLevel !== "District Court" && <Badge variant={appealBadge(c.appealLevel)}>{c.appealLevel}</Badge>}
          <Badge variant="default">{c.court}</Badge>
          <Badge variant="default">Filed {c.filingDate}</Badge>
        </div>

        <div style={{ marginBottom: 20 }}>
          <Row label="Court" value={c.court} />
          <Row label="Docket" value={<span style={{ fontFamily: "monospace" }}>{c.docketNumber}</span>} />
          <Row label="Filed" value={c.filingDate} />
          <Row label="NOS Code" value={`${c.nosCode} — ${NOS_LABEL_MAP[c.nosCode] || c.nosLabel || "Unknown"}`} />
          {c.courtListenerLink && <Row label="CourtListener" value={<a href={c.courtListenerLink} target="_blank" rel="noopener noreferrer">View docket ↗</a>} />}
        </div>

        {(c.plaintiffs?.length > 0 || c.defendants?.length > 0) && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8a8778", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Parties</div>
            {c.plaintiffs?.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#8a8778", marginBottom: 4 }}>Plaintiffs</div>
                {c.plaintiffs.map((p, i) => <div key={i} style={{ fontSize: 13 }}>{p}</div>)}
              </div>
            )}
            {c.defendants?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: "#8a8778", marginBottom: 4 }}>Defendants</div>
                {c.defendants.map((d, i) => <div key={i} style={{ fontSize: 13 }}>{d}</div>)}
              </div>
            )}
          </div>
        )}

        {c.counsel?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8a8778", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Counsel of Record</div>
            {c.counsel.map((a, i) => <div key={i} style={{ fontSize: 13 }}>{a}</div>)}
          </div>
        )}

        {full?.updates?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8a8778", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Filings</div>
            {full.updates.map((u) => (
              <div key={u.id} style={{ padding: "8px 0", borderBottom: "1px solid #f0efe9", fontSize: 12 }}>
                <div style={{ fontWeight: 500 }}>{u.description}</div>
                <div style={{ color: "#8a8778", marginTop: 2 }}>{u.dateFiled}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8a8778", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Notes</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Add internal notes…"
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e0d8", borderRadius: 6, fontSize: 13, resize: "vertical", minHeight: 80, fontFamily: "inherit" }} />
          <Button size="sm" onClick={saveNotes} disabled={savingNotes} style={{ marginTop: 6 }}>
            {savingNotes ? <Spinner size={11} /> : "Save notes"}
          </Button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="success" onClick={() => { onApprove(c.id); onClose(); }} style={{ flex: 1 }}>✓ Approve</Button>
          <Button variant="danger" onClick={() => {
            const r = window.prompt("Exclusion reason:") ?? "";
            onExclude(c.id, r); onClose();
          }} style={{ flex: 1 }}>✗ Exclude</Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "5px 0", borderBottom: "1px solid #f7f6f2", fontSize: 13 }}>
      <div style={{ width: 110, flexShrink: 0, color: "#8a8778", fontWeight: 500 }}>{label}</div>
      <div style={{ color: "#1a1a18" }}>{value}</div>
    </div>
  );
}

export default function ReviewQueue() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterNos, setFilterNos] = useState("");
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api.getCases({ reviewStatus: "pending", search: search || undefined, nosCode: filterNos || undefined });
    setCases(data);
    setLoading(false);
  }, [search, filterNos]);

  useEffect(() => { load(); }, [load]);

  async function handleApprove(id) {
    await api.approveCase(id);
    setCases((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleExclude(id, reason) {
    await api.excludeCase(id, reason);
    setCases((prev) => prev.filter((c) => c.id !== id));
  }

  const nosOptions = [...new Set(cases.map((c) => c.nosCode).filter(Boolean))];

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <SectionHeader
        title={`Review Queue`}
        subtitle={`${cases.length} case${cases.length !== 1 ? "s" : ""} pending human review`}
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cases…"
              style={{ padding: "6px 10px", border: "1px solid #e2e0d8", borderRadius: 6, fontSize: 13, width: 200 }} />
            <select value={filterNos} onChange={(e) => setFilterNos(e.target.value)}
              style={{ padding: "6px 10px", border: "1px solid #e2e0d8", borderRadius: 6, fontSize: 13 }}>
              <option value="">All NOS codes</option>
              {nosOptions.map((n) => <option key={n} value={n}>{n} — {NOS_LABEL_MAP[n] || n}</option>)}
            </select>
          </div>
        }
      />

      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}><Spinner size={28} /></div>
      ) : cases.length === 0 ? (
        <EmptyState icon="✅" title="No cases pending review" subtitle="Run a case sync to identify new cases" />
      ) : (
        <Card>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e2e0d8" }}>
                {["Case", "Filed / Court", "Type", "Parties", "Actions"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px 10px 0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#8a8778" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <CaseRow key={c.id} c={c}
                  onApprove={handleApprove}
                  onExclude={handleExclude}
                  onSelect={setSelected}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selected && (
        <CaseDetail
          c={selected}
          onClose={() => setSelected(null)}
          onApprove={async (id) => { await handleApprove(id); setSelected(null); }}
          onExclude={async (id, r) => { await handleExclude(id, r); setSelected(null); }}
        />
      )}
    </div>
  );
}
