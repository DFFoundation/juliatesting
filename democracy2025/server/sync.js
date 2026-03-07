// server/sync.js
// Cron jobs and sync logic — uses CourtListener as primary data source

const cron = require("node-cron");
const db = require("./db");
const cl = require("./courtlistener");
const logger = require("./logger");

// SSE clients waiting for progress updates
const sseClients = new Set();

function addSseClient(res) {
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
}

function broadcast(event, data) {
  const payload = `data: ${JSON.stringify({ event, ...data })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

// ── Case Sync ────────────────────────────────────────────────────────────────
async function syncCases(options = {}) {
  const dateFrom = options.dateFrom || process.env.DEFAULT_DATE_FROM || "2025-01-20";
  const dateTo = options.dateTo || null;
  const nosCodes = options.nosCodes || null;

  logger.info(`Starting case sync from ${dateFrom}${dateTo ? ` to ${dateTo}` : ""}`);
  broadcast("sync_start", { message: "Starting case sync from CourtListener…" });

  const logId = await db.insertSyncLog({
    type: "cases",
    status: "running",
    startedAt: new Date().toISOString(),
  });

  try {
    const onProgress = (p) => {
      logger.info(`Sync: ${p.message}`);
      broadcast("sync_progress", p);
    };

    const { eligible, excluded, total } = await cl.searchCases(
      { dateFrom, dateTo, nosCodes },
      onProgress
    );

    // Upsert eligible cases
    let added = 0;
    let updated = 0;
    for (const c of eligible) {
      const existing = await db.getCaseById(c.id);
      if (existing) {
        // Don't overwrite manual review status
        await db.updateCase(c.id, {
          caseName: c.caseName,
          docketNumber: c.docketNumber,
          filingDate: c.filingDate,
          court: c.court,
          courtId: c.courtId,
          nosCode: c.nosCode,
          nosLabel: c.nosLabel,
          caseType: c.caseType,
          courtListenerDocketId: c.courtListenerDocketId,
          courtListenerLink: c.courtListenerLink,
          lastUpdated: c.lastUpdated,
        });
        updated++;
      } else {
        await db.insertCase(c);
        added++;
      }
    }

    // Store excluded cases for reference
    for (const c of excluded) {
      const existing = await db.getCaseById(c.id);
      if (!existing) {
        await db.insertCase({ ...c, status: "Excluded", exclusionReason: c.exclusionReason });
      }
    }

    const summary = `Sync complete: ${added} new, ${updated} updated, ${excluded.length} excluded from ${total} total`;
    logger.info(summary);
    broadcast("sync_complete", { message: summary, added, updated, excluded: excluded.length, total });

    await db.updateSyncLog(logId, {
      status: "success",
      completedAt: new Date().toISOString(),
      casesFound: total,
      casesAdded: added,
      casesUpdated: updated,
      casesExcluded: excluded.length,
      message: summary,
    });

    return { added, updated, excluded: excluded.length, total };
  } catch (err) {
    logger.error(`Case sync failed: ${err.message}`);
    broadcast("sync_error", { message: err.message });
    await db.updateSyncLog(logId, {
      status: "error",
      completedAt: new Date().toISOString(),
      message: err.message,
    });
    throw err;
  }
}

// ── Update Tracking ──────────────────────────────────────────────────────────
async function syncUpdates() {
  logger.info("Starting update tracking…");
  broadcast("update_start", { message: "Checking for case updates…" });

  try {
    const approvedCases = await db.getCasesByStatus("Approved");
    logger.info(`Checking updates for ${approvedCases.length} approved cases`);

    if (approvedCases.length === 0) {
      broadcast("update_complete", { message: "No approved cases to check", count: 0 });
      return { count: 0 };
    }

    const updates = await cl.checkForUpdates(approvedCases);
    let newCount = 0;

    for (const update of updates) {
      const exists = await db.updateExists(update.docketEntryId);
      if (!exists) {
        await db.insertUpdate(update);
        newCount++;
      }
    }

    const msg = `Update check complete: ${newCount} new filings found`;
    logger.info(msg);
    broadcast("update_complete", { message: msg, count: newCount });

    return { count: newCount };
  } catch (err) {
    logger.error(`Update sync failed: ${err.message}`);
    broadcast("update_error", { message: err.message });
    throw err;
  }
}

// ── Cron Scheduling ──────────────────────────────────────────────────────────
function scheduleJobs() {
  const caseCron = process.env.SYNC_CRON_SCHEDULE || "0 8 * * *";
  logger.info(`Scheduling case sync: ${caseCron}`);

  cron.schedule(caseCron, () => {
    syncCases().catch((err) => logger.error(`Scheduled case sync failed: ${err.message}`));
  });

  // Update checks twice daily
  cron.schedule("0 9,17 * * *", () => {
    syncUpdates().catch((err) => logger.error(`Scheduled update sync failed: ${err.message}`));
  });

  logger.info("Scheduled jobs registered");
}

module.exports = { syncCases, syncUpdates, scheduleJobs, addSseClient };
