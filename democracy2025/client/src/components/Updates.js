// src/components/Updates.js
import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Card, Badge, Button, Spinner, EmptyState, SectionHeader } from "./UI";

export function UpdatesFeed() {
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getUpdates().then((data) => {
      setUpdates(data);
      setLoading(false);
    });
  }, []);

  async function markSeen(caseId) {
    await api.markUpdatesSeen(caseId);
    setUpdates((prev) => prev.filter((u) => u.caseId !== caseId));
  }

  const grouped = updates.reduce((acc, u) => {
    if (!acc[u.caseId]) acc[u.caseId] = { caseName: u.caseName, docketNumber: u.docketNumber, courtName: u.courtName, updates: [] };
    acc[u.caseId].updates.push(u);
    return acc;
  }, {});

  return (
    <div style={{ padding: "28px 32px", maxWidth: 900, margin: "0 auto" }}>
      <SectionHeader
        title="Unseen Updates"
        subtitle={updates.length > 0 ? `${updates.length} new filing${updates.length > 1 ? "s" : ""} across ${Object.keys(grouped).length} case${Object.keys(grouped).length > 1 ? "s" : ""}` : "All caught up"}
        actions={updates.length > 0 ? (
          <Button onClick={async () => {
            for (const id of Object.keys(grouped)) await api.markUpdatesSeen(id);
            setUpdates([]);
          }}>Mark all seen</Button>
        ) : null}
      />

      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}><Spinner size={28} /></div>
      ) : Object.keys(grouped).length === 0 ? (
        <EmptyState icon="🎉" title="No unseen updates" subtitle="You're all caught up. Updates appear here when tracked cases have new docket activity." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {Object.entries(grouped).map(([caseId, group]) => (
            <Card key={caseId} style={{ overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", background: "#f7f6f2", borderBottom: "1px solid #e2e0d8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#1b3254" }}>{group.caseName}</div>
                  <div style={{ fontSize: 11, color: "#8a8778", marginTop: 2 }}>
                    <span style={{ fontFamily: "monospace" }}>{group.docketNumber}</span> · {group.courtName}
                  </div>
                </div>
                <Button size="sm" onClick={() => markSeen(caseId)}>Mark seen</Button>
              </div>
              <div style={{ padding: "12px 20px" }}>
                {group.updates.map((u) => (
                  <div key={u.id} style={{ padding: "8px 0", borderBottom: "1px solid #f0efe9", fontSize: 13 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <Badge variant={u.updateType === "new_filing" ? "blue" : u.updateType === "cl_linked" ? "green" : "amber"}>
                        {u.updateType.replace("_", " ")}
                      </Badge>
                      <span style={{ fontWeight: 500 }}>{u.description}</span>
                    </div>
                    {u.dateFiled && <div style={{ color: "#8a8778", fontSize: 12, marginTop: 3 }}>Filed: {u.dateFiled}</div>}
                    {u.documents?.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {u.documents.map((d, i) => (
                          <div key={i} style={{ fontSize: 12, color: "#1d5fa8" }}>
                            {d.filepath ? (
                              <a href={`https://storage.courtlistener.com/${d.filepath}`} target="_blank" rel="noopener noreferrer">
                                📄 {d.description || `Document ${i + 1}`}
                              </a>
                            ) : (
                              <span>📄 {d.description || `Document ${i + 1}`}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// src/components/Excluded.js
export function ExcludedCases() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.getCases({ reviewStatus: "excluded", search: search || undefined }).then((data) => {
      setCases(data);
      setLoading(false);
    });
  }, [search]);

  async function handleReset(id) {
    await api.resetCase(id);
    setCases((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <SectionHeader
        title="Excluded Cases"
        subtitle={`${cases.length} case${cases.length !== 1 ? "s" : ""} filtered out`}
        actions={
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ padding: "6px 10px", border: "1px solid #e2e0d8", borderRadius: 6, fontSize: 13, width: 200 }} />
        }
      />
      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}><Spinner size={28} /></div>
      ) : cases.length === 0 ? (
        <EmptyState icon="🗂" title="No excluded cases" />
      ) : (
        <Card>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e2e0d8" }}>
                {["Case", "Filed", "Court", "Exclusion Reason", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px 10px 0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#8a8778" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} style={{ borderBottom: "1px solid #f0efe9" }}>
                  <td style={{ padding: "10px 14px 10px 0" }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#4a4840" }}>{c.caseName}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8a8778" }}>{c.docketNumber}</div>
                  </td>
                  <td style={{ padding: "10px 12px 10px 0", fontSize: 12, color: "#8a8778", whiteSpace: "nowrap" }}>{c.filingDate}</td>
                  <td style={{ padding: "10px 12px 10px 0", fontSize: 12, color: "#8a8778" }}>{c.court}</td>
                  <td style={{ padding: "10px 12px 10px 0" }}>
                    <Badge variant="red">{c.exclusionReason || "Excluded"}</Badge>
                  </td>
                  <td style={{ padding: "10px 0", whiteSpace: "nowrap" }}>
                    <Button size="sm" onClick={() => handleReset(c.id)} title="Move back to pending">↩ Restore</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
