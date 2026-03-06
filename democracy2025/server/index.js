// server/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const logger = require("./logger");
const db = require("./db");
const { runCaseIdentificationSync, runUpdateTrackingSync, addSseClient, startScheduledJobs } = require("./sync");
const { parseWebhookPayload, subscribeToDocket } = require("./courtlistener");
const { DEMOCRACY_NOS_CODES } = require("./pacer");

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:3000" }));
app.use(express.json());

const limiter = rateLimit({ windowMs: 60 * 1000, max: 100 });
app.use("/api/", limiter);

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get("/api/stats", (req, res) => {
  try {
    res.json(db.getStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cases ─────────────────────────────────────────────────────────────────────
app.get("/api/cases", (req, res) => {
  try {
    const { reviewStatus, courtId, nosCode, search } = req.query;
    const cases = db.getCases({ reviewStatus, courtId, nosCode, search });
    res.json(cases);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/cases/:id", (req, res) => {
  try {
    const c = db.getCase(req.params.id);
    if (!c) return res.status(404).json({ error: "Not found" });
    const updates = db.getUpdatesForCase(c.id);
    res.json({ ...c, updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve a case — add to tracker
app.post("/api/cases/:id/approve", (req, res) => {
  try {
    const { notes } = req.body;
    const c = db.getCase(req.params.id);
    if (!c) return res.status(404).json({ error: "Not found" });

    db.updateCaseReviewStatus(req.params.id, "approved");
    if (notes) {
      db.db.prepare("UPDATE cases SET notes = ? WHERE id = ?").run(notes, req.params.id);
    }

    // Async: try to link CourtListener docket and subscribe to alerts
    // (don't await — do it in background)
    if (process.env.COURTLISTENER_TOKEN) {
      const { findDocket, subscribeToDocket } = require("./courtlistener");
      findDocket(c.docketNumber, c.courtId).then((docket) => {
        if (docket) {
          db.updateCaseClDocket(c.id, String(docket.id), `https://www.courtlistener.com${docket.absolute_url}`);
          subscribeToDocket(docket.id);
          db.insertUpdate({
            caseId: c.id,
            updateType: "cl_linked",
            description: `Linked to CourtListener docket ${docket.id}`,
            rawData: docket,
          });
        }
      }).catch((e) => logger.warn(`CL link failed for ${c.id}: ${e.message}`));
    }

    logger.info(`Case approved: ${c.caseName}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Exclude a case
app.post("/api/cases/:id/exclude", (req, res) => {
  try {
    const { reason } = req.body;
    db.updateCaseReviewStatus(req.params.id, "excluded", reason || "Manually excluded");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset case back to pending (un-exclude / un-approve)
app.post("/api/cases/:id/reset", (req, res) => {
  try {
    db.updateCaseReviewStatus(req.params.id, "pending", null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update notes
app.patch("/api/cases/:id/notes", (req, res) => {
  try {
    const { notes } = req.body;
    db.db.prepare("UPDATE cases SET notes = ? WHERE id = ?").run(notes || "", req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Updates ───────────────────────────────────────────────────────────────────
app.get("/api/updates", (req, res) => {
  try {
    const updates = db.getAllUnseenUpdates();
    res.json(updates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/cases/:id/updates/seen", (req, res) => {
  try {
    db.markUpdatesSeen(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sync ──────────────────────────────────────────────────────────────────────

// SSE endpoint — client subscribes to receive real-time sync progress
app.get("/api/sync/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write("data: {\"type\":\"connected\"}\n\n");
  addSseClient(res);
});

// Trigger a manual case identification sync
app.post("/api/sync/cases", async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      nosCodes,
      courts,
      enrichParties,
    } = req.body;

    // Respond immediately — sync runs async, progress via SSE
    res.json({ success: true, message: "Case sync started" });

    runCaseIdentificationSync({ dateFrom, dateTo, nosCodes, courts, enrichParties })
      .catch((err) => logger.error(`Manual case sync error: ${err.message}`));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger a manual update tracking sync
app.post("/api/sync/updates", async (req, res) => {
  try {
    res.json({ success: true, message: "Update sync started" });
    runUpdateTrackingSync()
      .catch((err) => logger.error(`Manual update sync error: ${err.message}`));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync history
app.get("/api/sync/logs", (req, res) => {
  try {
    res.json(db.getRecentSyncLogs(20));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CourtListener Webhook ─────────────────────────────────────────────────────
// CL will POST here when a tracked docket has new filings
app.post("/api/webhooks/courtlistener", (req, res) => {
  try {
    // Acknowledge immediately
    res.status(200).json({ received: true });

    const entries = parseWebhookPayload(req.body);
    if (!entries.length) return;

    for (const entry of entries) {
      // Find our case by CL docket ID
      const cases = db.db.prepare(
        "SELECT id, case_name FROM cases WHERE cl_docket_id = ?"
      ).all(String(entry.docketId));

      for (const c of cases) {
        db.insertUpdate({
          caseId: c.id,
          updateType: "new_filing",
          description: entry.description || `Entry #${entry.entryNumber}`,
          entryNumber: String(entry.entryNumber || ""),
          dateFiled: entry.dateFiled,
          documents: entry.documents,
          rawData: entry,
        });
        logger.info(`Webhook: new filing for ${c.case_name} — ${entry.description}`);
      }
    }
  } catch (err) {
    logger.error(`Webhook error: ${err.message}`);
  }
});

// ── CSV Export ────────────────────────────────────────────────────────────────
app.get("/api/export/csv", (req, res) => {
  try {
    const { reviewStatus = "approved" } = req.query;
    const cases = db.getCases({ reviewStatus });

    const headers = [
      "Case Name", "Docket Number", "Filing Date", "Court", "Appeal Level",
      "Case Type", "NOS Code", "Plaintiffs", "Defendants", "Counsel",
      "CourtListener Link", "Status", "Notes", "Last Updated",
    ];

    const escape = (v) => `"${String(v || "").replace(/"/g, '""')}"`;

    const rows = cases.map((c) => [
      escape(c.caseName),
      escape(c.docketNumber),
      escape(c.filingDate),
      escape(c.court),
      escape(c.appealLevel),
      escape(c.caseType),
      escape(c.nosCode),
      escape((c.plaintiffs || []).join("; ")),
      escape((c.defendants || []).join("; ")),
      escape((c.counsel || []).join("; ")),
      escape(c.courtListenerLink),
      escape(c.status),
      escape(c.notes),
      escape(c.lastUpdated),
    ].join(","));

    const csv = [headers.map(escape).join(","), ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="democracy2025-cases-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── NOS Codes Reference ───────────────────────────────────────────────────────
app.get("/api/nos-codes", (req, res) => {
  res.json(DEMOCRACY_NOS_CODES);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Democracy 2025 Case Tracker server running on port ${PORT}`);
  if (process.env.NODE_ENV !== "test") {
    startScheduledJobs();
  }
});

module.exports = app;
