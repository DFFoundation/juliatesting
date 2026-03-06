// server/db.js
// SQLite database for persisting cases, updates, and sync state

const Database = require("better-sqlite3");
const path = require("path");
const logger = require("./logger");

const DB_PATH = path.join(__dirname, "data", "democracy2025.db");

// Ensure data directory exists
const fs = require("fs");
fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Schema ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    case_name TEXT NOT NULL,
    docket_number TEXT,
    filing_date TEXT,
    court_id TEXT,
    court_name TEXT,
    appeal_level TEXT,
    case_type TEXT,
    nos_code TEXT,
    nos_label TEXT,
    plaintiffs TEXT,       -- JSON array
    defendants TEXT,       -- JSON array
    counsel TEXT,          -- JSON array
    status TEXT DEFAULT 'Unreviewed',
    review_status TEXT DEFAULT 'pending',  -- pending | approved | excluded
    exclusion_reason TEXT,
    pcl_case_id TEXT,
    cl_docket_id TEXT,
    cl_link TEXT,
    latest_filings TEXT,   -- JSON array
    notes TEXT,
    source TEXT DEFAULT 'pacer-pcl',
    approved_at TEXT,
    approved_by TEXT,
    last_updated TEXT,
    last_cl_check TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS case_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL,
    update_type TEXT NOT NULL,  -- 'new_filing' | 'status_change' | 'new_party' | 'cl_linked'
    description TEXT,
    entry_number TEXT,
    date_filed TEXT,
    documents TEXT,            -- JSON array
    raw_data TEXT,             -- JSON blob
    seen INTEGER DEFAULT 0,    -- 0 = unseen, 1 = seen
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (case_id) REFERENCES cases(id)
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type TEXT NOT NULL,   -- 'case_search' | 'update_check' | 'webhook'
    status TEXT NOT NULL,      -- 'running' | 'complete' | 'error'
    started_at TEXT,
    completed_at TEXT,
    cases_found INTEGER DEFAULT 0,
    cases_eligible INTEGER DEFAULT 0,
    cases_excluded INTEGER DEFAULT 0,
    updates_found INTEGER DEFAULT 0,
    error_message TEXT,
    params TEXT                -- JSON blob of search params used
  );

  CREATE INDEX IF NOT EXISTS idx_cases_review_status ON cases(review_status);
  CREATE INDEX IF NOT EXISTS idx_cases_filing_date ON cases(filing_date);
  CREATE INDEX IF NOT EXISTS idx_updates_case_id ON case_updates(case_id);
  CREATE INDEX IF NOT EXISTS idx_updates_seen ON case_updates(seen);
`);

// ── Cases ────────────────────────────────────────────────────────────────────

function upsertCase(c) {
  const stmt = db.prepare(`
    INSERT INTO cases (
      id, case_name, docket_number, filing_date, court_id, court_name,
      appeal_level, case_type, nos_code, nos_label, plaintiffs, defendants,
      counsel, status, review_status, exclusion_reason, pcl_case_id,
      cl_docket_id, cl_link, latest_filings, notes, source, last_updated
    ) VALUES (
      @id, @case_name, @docket_number, @filing_date, @court_id, @court_name,
      @appeal_level, @case_type, @nos_code, @nos_label, @plaintiffs, @defendants,
      @counsel, @status, @review_status, @exclusion_reason, @pcl_case_id,
      @cl_docket_id, @cl_link, @latest_filings, @notes, @source, @last_updated
    )
    ON CONFLICT(id) DO UPDATE SET
      case_name = excluded.case_name,
      docket_number = excluded.docket_number,
      court_name = excluded.court_name,
      plaintiffs = excluded.plaintiffs,
      defendants = excluded.defendants,
      counsel = excluded.counsel,
      nos_label = excluded.nos_label,
      latest_filings = excluded.latest_filings,
      last_updated = excluded.last_updated
  `);

  stmt.run({
    id: c.id,
    case_name: c.caseName,
    docket_number: c.docketNumber,
    filing_date: c.filingDate,
    court_id: c.courtId,
    court_name: c.court,
    appeal_level: c.appealLevel,
    case_type: c.caseType,
    nos_code: c.nosCode,
    nos_label: c.nosLabel || "",
    plaintiffs: JSON.stringify(c.plaintiffs || []),
    defendants: JSON.stringify(c.defendants || []),
    counsel: JSON.stringify(c.counsel || []),
    status: c.status || "Unreviewed",
    review_status: c.reviewStatus || "pending",
    exclusion_reason: c.exclusionReason || null,
    pcl_case_id: c.pclCaseId || null,
    cl_docket_id: c.courtListenerDocketId || null,
    cl_link: c.courtListenerLink || "",
    latest_filings: JSON.stringify(c.latestFilings || []),
    notes: c.notes || "",
    source: c._source || "pacer-pcl",
    last_updated: c.lastUpdated || new Date().toISOString().split("T")[0],
  });
}

function getCase(id) {
  const row = db.prepare("SELECT * FROM cases WHERE id = ?").get(id);
  return row ? deserializeCase(row) : null;
}

function getCases(filter = {}) {
  let query = "SELECT * FROM cases WHERE 1=1";
  const params = [];

  if (filter.reviewStatus) {
    query += " AND review_status = ?";
    params.push(filter.reviewStatus);
  }
  if (filter.courtId) {
    query += " AND court_id = ?";
    params.push(filter.courtId);
  }
  if (filter.nosCode) {
    query += " AND nos_code = ?";
    params.push(filter.nosCode);
  }
  if (filter.search) {
    query += " AND (case_name LIKE ? OR docket_number LIKE ?)";
    params.push(`%${filter.search}%`, `%${filter.search}%`);
  }

  query += " ORDER BY filing_date DESC";

  const rows = db.prepare(query).all(...params);
  return rows.map(deserializeCase);
}

function updateCaseReviewStatus(id, status, reason = null) {
  db.prepare(`
    UPDATE cases SET
      review_status = ?,
      exclusion_reason = ?,
      approved_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE approved_at END,
      last_updated = date('now')
    WHERE id = ?
  `).run(status, reason, status, id);
}

function updateCaseClDocket(id, clDocketId, clLink) {
  db.prepare(`
    UPDATE cases SET
      cl_docket_id = ?,
      cl_link = ?,
      last_updated = date('now')
    WHERE id = ?
  `).run(clDocketId, clLink, id);
}

function updateCaseLastClCheck(id) {
  db.prepare("UPDATE cases SET last_cl_check = datetime('now') WHERE id = ?").run(id);
}

function updateCaseLatestFilings(id, filings) {
  db.prepare(`
    UPDATE cases SET
      latest_filings = ?,
      last_updated = date('now')
    WHERE id = ?
  `).run(JSON.stringify(filings), id);
}

function deserializeCase(row) {
  return {
    id: row.id,
    caseName: row.case_name,
    docketNumber: row.docket_number,
    filingDate: row.filing_date,
    courtId: row.court_id,
    court: row.court_name,
    appealLevel: row.appeal_level,
    caseType: row.case_type,
    nosCode: row.nos_code,
    nosLabel: row.nos_label,
    plaintiffs: JSON.parse(row.plaintiffs || "[]"),
    defendants: JSON.parse(row.defendants || "[]"),
    counsel: JSON.parse(row.counsel || "[]"),
    status: row.status,
    reviewStatus: row.review_status,
    exclusionReason: row.exclusion_reason,
    pclCaseId: row.pcl_case_id,
    courtListenerDocketId: row.cl_docket_id,
    courtListenerLink: row.cl_link,
    latestFilings: JSON.parse(row.latest_filings || "[]"),
    notes: row.notes,
    approvedAt: row.approved_at,
    lastUpdated: row.last_updated,
    lastClCheck: row.last_cl_check,
    createdAt: row.created_at,
  };
}

// ── Case Updates ─────────────────────────────────────────────────────────────

function insertUpdate(update) {
  db.prepare(`
    INSERT INTO case_updates (case_id, update_type, description, entry_number, date_filed, documents, raw_data)
    VALUES (@case_id, @update_type, @description, @entry_number, @date_filed, @documents, @raw_data)
  `).run({
    case_id: update.caseId,
    update_type: update.updateType,
    description: update.description || "",
    entry_number: update.entryNumber || null,
    date_filed: update.dateFiled || null,
    documents: JSON.stringify(update.documents || []),
    raw_data: JSON.stringify(update.rawData || {}),
  });
}

function getUpdatesForCase(caseId, unseenOnly = false) {
  let query = "SELECT * FROM case_updates WHERE case_id = ?";
  if (unseenOnly) query += " AND seen = 0";
  query += " ORDER BY created_at DESC";
  const rows = db.prepare(query).all(caseId);
  return rows.map(deserializeUpdate);
}

function getAllUnseenUpdates() {
  const rows = db.prepare(`
    SELECT u.*, c.case_name, c.docket_number, c.court_name
    FROM case_updates u
    JOIN cases c ON u.case_id = c.id
    WHERE u.seen = 0
    ORDER BY u.created_at DESC
  `).all();
  return rows.map((r) => ({
    ...deserializeUpdate(r),
    caseName: r.case_name,
    docketNumber: r.docket_number,
    courtName: r.court_name,
  }));
}

function markUpdatesSeen(caseId) {
  db.prepare("UPDATE case_updates SET seen = 1 WHERE case_id = ?").run(caseId);
}

function deserializeUpdate(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    updateType: row.update_type,
    description: row.description,
    entryNumber: row.entry_number,
    dateFiled: row.date_filed,
    documents: JSON.parse(row.documents || "[]"),
    seen: Boolean(row.seen),
    createdAt: row.created_at,
  };
}

// ── Sync Log ─────────────────────────────────────────────────────────────────

function startSyncLog(syncType, params = {}) {
  const result = db.prepare(`
    INSERT INTO sync_log (sync_type, status, started_at, params)
    VALUES (?, 'running', datetime('now'), ?)
  `).run(syncType, JSON.stringify(params));
  return result.lastInsertRowid;
}

function completeSyncLog(id, stats = {}) {
  db.prepare(`
    UPDATE sync_log SET
      status = 'complete',
      completed_at = datetime('now'),
      cases_found = ?,
      cases_eligible = ?,
      cases_excluded = ?,
      updates_found = ?
    WHERE id = ?
  `).run(
    stats.casesFound || 0,
    stats.casesEligible || 0,
    stats.casesExcluded || 0,
    stats.updatesFound || 0,
    id
  );
}

function failSyncLog(id, errorMessage) {
  db.prepare(`
    UPDATE sync_log SET status = 'error', completed_at = datetime('now'), error_message = ?
    WHERE id = ?
  `).run(errorMessage, id);
}

function getRecentSyncLogs(limit = 20) {
  return db.prepare("SELECT * FROM sync_log ORDER BY started_at DESC LIMIT ?").all(limit);
}

// ── Stats ────────────────────────────────────────────────────────────────────

function getStats() {
  const total = db.prepare("SELECT COUNT(*) as n FROM cases").get().n;
  const pending = db.prepare("SELECT COUNT(*) as n FROM cases WHERE review_status = 'pending'").get().n;
  const approved = db.prepare("SELECT COUNT(*) as n FROM cases WHERE review_status = 'approved'").get().n;
  const excluded = db.prepare("SELECT COUNT(*) as n FROM cases WHERE review_status = 'excluded'").get().n;
  const unseenUpdates = db.prepare("SELECT COUNT(*) as n FROM case_updates WHERE seen = 0").get().n;
  const lastSync = db.prepare("SELECT completed_at FROM sync_log WHERE status = 'complete' ORDER BY completed_at DESC LIMIT 1").get();

  return { total, pending, approved, excluded, unseenUpdates, lastSync: lastSync?.completed_at || null };
}

module.exports = {
  db,
  upsertCase,
  getCase,
  getCases,
  updateCaseReviewStatus,
  updateCaseClDocket,
  updateCaseLastClCheck,
  updateCaseLatestFilings,
  insertUpdate,
  getUpdatesForCase,
  getAllUnseenUpdates,
  markUpdatesSeen,
  startSyncLog,
  completeSyncLog,
  failSyncLog,
  getRecentSyncLogs,
  getStats,
};
