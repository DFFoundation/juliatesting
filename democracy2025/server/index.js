require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const logger = require("./logger");
const db = require("./db");
const { runCaseIdentificationSync, runUpdateTrackingSync, addSseClient, startScheduledJobs } = require("./sync");
const { parseWebhookPayload } = require("./courtlistener");
const { DEMOCRACY_NOS_CODES } = require("./pacer");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:3000" }));
app.use(express.json());
app.use("/api/", rateLimit({ windowMs: 60000, max: 100 }));

app.get("/api/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

app.get("/api/stats", async (req, res) => {
  try { res.json(await db.getStats()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/cases", async (req, res) => {
  try {
    const { reviewStatus, courtId, nosCode, search } = req.query;
    res.json(await db.getCases({ reviewStatus, courtId, nosCode, search }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/cases/:id", async (req, res) => {
  try {
    const c = await db.getCase(req.params.id);
    if (!c) return res.status(404).json({ error: "Not found" });
    const updates = await db.getUpdatesForCase(c.id);
    res.json({ ...c, updates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/cases/:id/approve", async (req, res) => {
  try {
    const { notes } = req.body;
    const c = await db.getCase(req.params.id);
    if (!c) return res.status(404).json({ error: "Not found" });
    await db.updateCaseReviewStatus(req.params.id, "approved");
    if (notes) await db.updateCaseNotes(req.params.id, notes);
    if (process.env.COURTLISTENER_TOKEN) {
      const { findDocket, subscribeToDocket } = require("./courtlistener");
      findDocket(c.docketNumber, c.courtId).then(async (docket) => {
        if (docket) {
          await db.updateCaseClDocket(c.id, String(docket.id), `https://www.courtlistener.com${docket.absolute_url}`);
          await subscribeToDocket(docket.id);
          await db.insertUpdate({ caseId: c.id, updateType: "cl_linked", description: `Linked to CourtListener docket ${docket.id}`, rawData: docket });
        }
      }).catch((e) => logger.warn(`CL link failed: ${e.message}`));
    }
    logger.info(`Case approved: ${c.caseName}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/cases/:id/exclude", async (req, res) => {
  try {
    await db.updateCaseReviewStatus(req.params.id, "excluded", req.body.reason || "Manually excluded");
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/cases/:id/reset", async (req, res) => {
  try {
    await db.updateCaseReviewStatus(req.params.id, "pending", null);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch("/api/cases/:id/notes", async (req, res) => {
  try {
    await db.updateCaseNotes(req.params.id, req.body.notes || "");
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/updates", async (req, res) => {
  try { res.json(await db.getAllUnseenUpdates()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/cases/:id/updates/seen", async (req, res) => {
  try {
    await db.markUpdatesSeen(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/sync/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write("data: {\"type\":\"connected\"}\n\n");
  addSseClient(res);
});

app.post("/api/sync/cases", async (req, res) => {
  try {
    const { dateFrom, dateTo, nosCodes, courts, enrichParties } = req.body;
    res.json({ success: true, message: "Case sync started" });
    runCaseIdentificationSync({ dateFrom, dateTo, nosCodes, courts, enrichParties })
      .catch((err) => logger.error(`Manual case sync error: ${err.message}`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/sync/updates", async (req, res) => {
  try {
    res.json({ success: true, message: "Update sync started" });
    runUpdateTrackingSync().catch((err) => logger.error(`Manual update sync error: ${err.message}`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/sync/logs", async (req, res) => {
  try { res.json(await db.getRecentSyncLogs(20)); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/webhooks/courtlistener", async (req, res) => {
  try {
    res.status(200).json({ received: true });
    const entries = parseWebhookPayload(req.body);
    for (const entry of entries) {
      const cases = await db.all("SELECT id, case_name FROM cases WHERE cl_docket_id = ?", [String(entry.docketId)]);
      for (const c of cases) {
        await db.insertUpdate({ caseId: c.id, updateType: "new_filing", description: entry.description || `Entry #${entry.entryNumber}`, entryNumber: String(entry.entryNumber || ""), dateFiled: entry.dateFiled, documents: entry.documents, rawData: entry });
        logger.info(`Webhook: new filing for ${c.case_name}`);
      }
    }
  } catch (err) { logger.error(`Webhook error: ${err.message}`); }
});

app.get("/api/export/csv", async (req, res) => {
  try {
    const { reviewStatus = "approved" } = req.query;
    const cases = await db.getCases({ reviewStatus });
    const escape = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
    const headers = ["Case Name","Docket Number","Filing Date","Court","Appeal Level","Case Type","NOS Code","Plaintiffs","Defendants","Counsel","CourtListener Link","Notes","Last Updated"];
    const rows = cases.map((c) => [
      escape(c.caseName),escape(c.docketNumber),escape(c.filingDate),escape(c.court),
      escape(c.appealLevel),escape(c.caseType),escape(c.nosCode),
      escape((c.plaintiffs||[]).join("; ")),escape((c.defendants||[]).join("; ")),
      escape((c.counsel||[]).join("; ")),escape(c.courtListenerLink),
      escape(c.notes),escape(c.lastUpdated),
    ].join(","));
    const csv = [headers.map(escape).join(","), ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="democracy2025-cases-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/nos-codes", (req, res) => res.json(DEMOCRACY_NOS_CODES));

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  if (process.env.NODE_ENV !== "test") startScheduledJobs();
});

module.exports = app;
