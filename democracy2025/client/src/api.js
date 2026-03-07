// src/api.js
const BASE = process.env.REACT_APP_API_URL || "";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  getStats: () => request("/stats"),
  getCases: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ""))
    ).toString();
    return request(`/cases${qs ? `?${qs}` : ""}`);
  },
  getCase: (id) => request(`/cases/${id}`),
  approveCase: (id, notes) => request(`/cases/${id}/approve`, { method: "POST", body: { notes } }),
  excludeCase: (id, reason) => request(`/cases/${id}/exclude`, { method: "POST", body: { reason } }),
  resetCase: (id) => request(`/cases/${id}/reset`, { method: "POST" }),
  updateNotes: (id, notes) => request(`/cases/${id}/notes`, { method: "PATCH", body: { notes } }),
  getUpdates: () => request("/updates"),
  markUpdatesSeen: (id) => request(`/cases/${id}/updates/seen`, { method: "POST" }),
  triggerCaseSync: (params) => request("/sync/cases", { method: "POST", body: params }),
  triggerUpdateSync: () => request("/sync/updates", { method: "POST" }),
  getSyncLogs: () => request("/sync/logs"),
  exportCsv: (reviewStatus = "approved") => {
    window.open(`${BASE}/api/export/csv?reviewStatus=${reviewStatus}`, "_blank");
  },
};

export function connectSSE(onMessage) {
  const es = new EventSource(`${BASE}/api/sync/stream`);
  es.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch {}
  };
  es.onerror = () => {};
  return () => es.close();
}
