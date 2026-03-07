// server/db.js
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "data", "democracy2025.db");
fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function initSchema() {
  await run(`PRAGMA journal_mode = WAL`);
  await run(`CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY, case_name TEXT NOT NULL, docket_number TEXT,
    filing_date TEXT, court_id TEXT, court_name TEXT, appeal_level TEXT,
    case_type TEXT, nos_code TEXT, nos_label TEXT, plaintiffs TEXT,
    defendants TEXT, counsel TEXT, status TEXT DEFAULT 'Unreviewed',
    review_status TEXT DEFAULT 'pending', exclusion_reason TEXT,
    pcl_case_id TEXT, cl_docket_id TEXT, cl_link TEXT, latest_filings TEXT,
    notes TEXT, source TEXT DEFAULT 'pacer-pcl', approved_at TEXT,
    approved_by TEXT, last_updated TEXT, last_cl_check TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await run(`CREATE TABLE IF NOT EXISTS case_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL,
    update_type TEXT NOT NULL, description TEXT, entry_number TEXT,
    date_filed TEXT, documents TEXT, raw_data TEXT, seen INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await run(`CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sync_type TEXT NOT NULL,
    status TEXT NOT NULL, started_at TEXT, completed_at TEXT,
    cases_found INTEGER DEFAULT 0, cases_eligible INTEGER DEFAULT 0,
    cases_excluded INTEGER DEFAULT 0, updates_found INTEGER DEFAULT 0,
    error_message TEXT, params TEXT
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_cases_review_status ON cases(review_status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_updates_seen ON case_updates(seen)`);
}

async function upsertCase(c) {
  await run(`INSERT INTO cases (id,case_name,docket_number,filing_date,court_id,court_name,
    appeal_level,case_type,nos_code,nos_label,plaintiffs,defendants,counsel,status,
    review_status,exclusion_reason,pcl_case_id,cl_docket_id,cl_link,latest_filings,
    notes,source,last_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET case_name=excluded.case_name,
    docket_number=excluded.docket_number,court_name=excluded.court_name,
    plaintiffs=excluded.plaintiffs,defendants=excluded.defendants,
    counsel=excluded.counsel,nos_label=excluded.nos_label,
    latest_filings=excluded.latest_filings,last_updated=excluded.last_updated`, [
    c.id,c.caseName,c.docketNumber,c.filingDate,c.courtId,c.court,
    c.appealLevel,c.caseType,c.nosCode,c.nosLabel||"",
    JSON.stringify(c.plaintiffs||[]),JSON.stringify(c.defendants||[]),
    JSON.stringify(c.counsel||[]),c.status||"Unreviewed",
    c.reviewStatus||"pending",c.exclusionReason||null,
    c.pclCaseId||null,c.courtListenerDocketId||null,c.courtListenerLink||"",
    JSON.stringify(c.latestFilings||[]),c.notes||"",c._source||"pacer-pcl",
    c.lastUpdated||new Date().toISOString().split("T")[0],
  ]);
}

async function getCase(id) {
  const row = await get("SELECT * FROM cases WHERE id = ?", [id]);
  return row ? deserializeCase(row) : null;
}

async function getCases(filter = {}) {
  let query = "SELECT * FROM cases WHERE 1=1";
  const params = [];
  if (filter.reviewStatus) { query += " AND review_status = ?"; params.push(filter.reviewStatus); }
  if (filter.courtId) { query += " AND court_id = ?"; params.push(filter.courtId); }
  if (filter.nosCode) { query += " AND nos_code = ?"; params.push(filter.nosCode); }
  if (filter.search) { query += " AND (case_name LIKE ? OR docket_number LIKE ?)"; params.push(`%${filter.search}%`,`%${filter.search}%`); }
  query += " ORDER BY filing_date DESC";
  const rows = await all(query, params);
  return rows.map(deserializeCase);
}

async function updateCaseReviewStatus(id, status, reason = null) {
  await run(`UPDATE cases SET review_status=?,exclusion_reason=?,
    approved_at=CASE WHEN ?='approved' THEN datetime('now') ELSE approved_at END,
    last_updated=date('now') WHERE id=?`, [status,reason,status,id]);
}

async function updateCaseClDocket(id, clDocketId, clLink) {
  await run("UPDATE cases SET cl_docket_id=?,cl_link=?,last_updated=date('now') WHERE id=?",[clDocketId,clLink,id]);
}

async function updateCaseLastClCheck(id) {
  await run("UPDATE cases SET last_cl_check=datetime('now') WHERE id=?",[id]);
}

async function updateCaseLatestFilings(id, filings) {
  await run("UPDATE cases SET latest_filings=?,last_updated=date('now') WHERE id=?",[JSON.stringify(filings),id]);
}

async function updateCaseNotes(id, notes) {
  await run("UPDATE cases SET notes=? WHERE id=?",[notes||"",id]);
}

function deserializeCase(row) {
  return {
    id:row.id,caseName:row.case_name,docketNumber:row.docket_number,
    filingDate:row.filing_date,courtId:row.court_id,court:row.court_name,
    appealLevel:row.appeal_level,caseType:row.case_type,
    nosCode:row.nos_code,nosLabel:row.nos_label,
    plaintiffs:JSON.parse(row.plaintiffs||"[]"),
    defendants:JSON.parse(row.defendants||"[]"),
    counsel:JSON.parse(row.counsel||"[]"),
    status:row.status,reviewStatus:row.review_status,
    exclusionReason:row.exclusion_reason,pclCaseId:row.pcl_case_id,
    courtListenerDocketId:row.cl_docket_id,courtListenerLink:row.cl_link,
    latestFilings:JSON.parse(row.latest_filings||"[]"),
    notes:row.notes,approvedAt:row.approved_at,
    lastUpdated:row.last_updated,lastClCheck:row.last_cl_check,createdAt:row.created_at,
  };
}

async function insertUpdate(update) {
  await run(`INSERT INTO case_updates (case_id,update_type,description,entry_number,date_filed,documents,raw_data)
    VALUES (?,?,?,?,?,?,?)`, [
    update.caseId,update.updateType,update.description||"",
    update.entryNumber||null,update.dateFiled||null,
    JSON.stringify(update.documents||[]),JSON.stringify(update.rawData||{}),
  ]);
}

async function getUpdatesForCase(caseId, unseenOnly = false) {
  let query = "SELECT * FROM case_updates WHERE case_id = ?";
  if (unseenOnly) query += " AND seen = 0";
  query += " ORDER BY created_at DESC";
  const rows = await all(query, [caseId]);
  return rows.map(deserializeUpdate);
}

async function getAllUnseenUpdates() {
  const rows = await all(`SELECT u.*,c.case_name,c.docket_number,c.court_name
    FROM case_updates u JOIN cases c ON u.case_id=c.id WHERE u.seen=0 ORDER BY u.created_at DESC`);
  return rows.map((r) => ({...deserializeUpdate(r),caseName:r.case_name,docketNumber:r.docket_number,courtName:r.court_name}));
}

async function markUpdatesSeen(caseId) {
  await run("UPDATE case_updates SET seen=1 WHERE case_id=?",[caseId]);
}

function deserializeUpdate(row) {
  return {
    id:row.id,caseId:row.case_id,updateType:row.update_type,
    description:row.description,entryNumber:row.entry_number,
    dateFiled:row.date_filed,documents:JSON.parse(row.documents||"[]"),
    seen:Boolean(row.seen),createdAt:row.created_at,
  };
}

async function startSyncLog(syncType, params = {}) {
  const result = await run("INSERT INTO sync_log (sync_type,status,started_at,params) VALUES (?,'running',datetime('now'),?)",[syncType,JSON.stringify(params)]);
  return result.lastID;
}

async function completeSyncLog(id, stats = {}) {
  await run(`UPDATE sync_log SET status='complete',completed_at=datetime('now'),
    cases_found=?,cases_eligible=?,cases_excluded=?,updates_found=? WHERE id=?`,
    [stats.casesFound||0,stats.casesEligible||0,stats.casesExcluded||0,stats.updatesFound||0,id]);
}

async function failSyncLog(id, errorMessage) {
  await run("UPDATE sync_log SET status='error',completed_at=datetime('now'),error_message=? WHERE id=?",[errorMessage,id]);
}

async function getRecentSyncLogs(limit = 20) {
  return all("SELECT * FROM sync_log ORDER BY started_at DESC LIMIT ?",[limit]);
}

async function getStats() {
  const [total,pending,approved,excluded,unseenUpdates,lastSync] = await Promise.all([
    get("SELECT COUNT(*) as n FROM cases"),
    get("SELECT COUNT(*) as n FROM cases WHERE review_status='pending'"),
    get("SELECT COUNT(*) as n FROM cases WHERE review_status='approved'"),
    get("SELECT COUNT(*) as n FROM cases WHERE review_status='excluded'"),
    get("SELECT COUNT(*) as n FROM case_updates WHERE seen=0"),
    get("SELECT completed_at FROM sync_log WHERE status='complete' ORDER BY completed_at DESC LIMIT 1"),
  ]);
  return {total:total.n,pending:pending.n,approved:approved.n,excluded:excluded.n,unseenUpdates:unseenUpdates.n,lastSync:lastSync?.completed_at||null};
}

initSchema().catch(console.error);

module.exports = {
  db,run,get,all,
  upsertCase,getCase,getCases,
  updateCaseReviewStatus,updateCaseClDocket,updateCaseLastClCheck,
  updateCaseLatestFilings,updateCaseNotes,
  insertUpdate,getUpdatesForCase,getAllUnseenUpdates,markUpdatesSeen,
  startSyncLog,completeSyncLog,failSyncLog,getRecentSyncLogs,getStats,
};
