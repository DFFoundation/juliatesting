// server/sync.js
// Scheduled jobs for case identification and update tracking

const cron = require("node-cron");
const { runCaseSearch, DEMOCRACY_NOS_CODES } = require("./pacer");
const { checkAllApprovedForUpdates, subscribeToDocket } = require("./courtlistener");
const {
  upsertCase,
  getCases,
  updateCaseClDocket,
  updateCaseLastClCheck,
  updateCaseLatestFilings,
  insertUpdate,
  startSyncLog,
  completeSyncLog,
  failSyncLog,
} = require("./db");
const logger = require("./logger");

// In-memory store for SSE clients (for real-time progress streaming)
const sseClients = new Set();

function addSseClient(res) {
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
}

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch {}
  }
}

// ── Case Identification Sync ──────────────────────────────────────────────────
async function runCaseIdentificationSync(options = {}) {
  const params = {
    dateFrom: options.dateFrom || process.env.DEFAULT_DATE_FROM || "2025-01-20",
    dateTo: options.dateTo || new Date().toISOString().split("T")[0],
    nosCodes: options.nosCodes || DEMOCRACY_NOS_CODES,
    courts: options.courts || null, // null = all federal courts
    enrichParties: options.enrichParties ?? false,
  };

  const syncId = startSyncLog("case_search", params);
  logger.info(`Starting case identification sync (syncId: ${syncId})`);
  broadcast({ type: "sync_start", syncType: "case_search", syncId });

  try {
    const { eligible, excluded, total } = await runCaseSearch(params, (progress) => {
      logger.debug(progress.message);
      broadcast({ type: "progress", ...progress });
    });

    // Persist eligible cases
    let newCases = 0;
    for (const c of eligible) {
      const existing = require("./db").getCase(c.id);
      if (!existing) {
        upsertCase({ ...c, reviewStatus: "pending" });
        newCases++;
      }
    }

    // Persist excluded cases (for audit trail)
    for (const c of excluded) {
      const existing = require("./db").getCase(c.id);
      if (!existing) {
        upsertCase({ ...c, reviewStatus: "excluded" });
      }
    }

    completeSyncLog(syncId, {
      casesFound: total,
      casesEligible: eligible.length,
      casesExcluded: excluded.length,
    });

    const result = { total, eligible: eligible.length, excluded: excluded.length, newCases };
    broadcast({ type: "sync_complete", syncType: "case_search", ...result });
    logger.info(`Case sync complete: ${newCases} new cases, ${eligible.length} eligible, ${excluded.length} excluded`);
    return result;
  } catch (err) {
    failSyncLog(syncId, err.message);
    broadcast({ type: "sync_error", syncType: "case_search", error: err.message });
    logger.error(`Case sync failed: ${err.message}`);
    throw err;
  }
}

// ── Update Tracking Sync ─────────────────────────────────────────────────────
async function runUpdateTrackingSync() {
  const syncId = startSyncLog("update_check");
  logger.info(`Starting update tracking sync (syncId: ${syncId})`);
  broadcast({ type: "sync_start", syncType: "update_check", syncId });

  try {
    // Get all approved cases
    const approvedCases = getCases({ reviewStatus: "approved" });
    if (approvedCases.length === 0) {
      completeSyncLog(syncId, { updatesFound: 0 });
      broadcast({ type: "sync_complete", syncType: "update_check", updatesFound: 0 });
      return { updatesFound: 0 };
    }

    logger.info(`Checking ${approvedCases.length} approved cases for updates`);
    let updatesFound = 0;

    const updates = await checkAllApprovedForUpdates(approvedCases, (progress) => {
      broadcast({ type: "progress", ...progress });
    });

    for (const update of updates) {
      const c = approvedCases.find((x) => x.id === update.caseId);
      if (!c) continue;

      // If newly linked to CL, save the docket ID
      if (update.linked && update.clDocketId) {
        updateCaseClDocket(c.id, String(update.clDocketId), update.clLink || "");
        // Subscribe to docket alerts
        await subscribeToDocket(update.clDocketId);
        insertUpdate({
          caseId: c.id,
          updateType: "cl_linked",
          description: `Linked to CourtListener docket ${update.clDocketId}`,
          rawData: update.meta,
        });
        updatesFound++;
        continue;
      }

      // Process new docket entries
      if (update.entries?.length > 0) {
        const newEntries = update.entries.filter(
          (e) => !c.latestFilings.some((f) => f.entryNumber === e.entry_number)
        );

        for (const entry of newEntries) {
          insertUpdate({
            caseId: c.id,
            updateType: "new_filing",
            description: entry.description || `Entry #${entry.entry_number}`,
            entryNumber: String(entry.entry_number || ""),
            dateFiled: entry.date_filed,
            documents: (entry.recap_documents || []).map((d) => ({
              id: d.id,
              description: d.description,
              filepath: d.filepath_local,
            })),
            rawData: entry,
          });
          updatesFound++;
        }

        // Update the case's latest filings cache
        if (newEntries.length > 0) {
          const filings = update.entries.slice(0, 10).map((e) => ({
            entryNumber: e.entry_number,
            dateFiled: e.date_filed,
            description: e.description,
          }));
          updateCaseLatestFilings(c.id, filings);
        }
      }

      updateCaseLastClCheck(c.id);
    }

    completeSyncLog(syncId, { updatesFound });
    broadcast({ type: "sync_complete", syncType: "update_check", updatesFound });
    logger.info(`Update sync complete: ${updatesFound} updates found across ${approvedCases.length} cases`);
    return { updatesFound };
  } catch (err) {
    failSyncLog(syncId, err.message);
    broadcast({ type: "sync_error", syncType: "update_check", error: err.message });
    logger.error(`Update sync failed: ${err.message}`);
    throw err;
  }
}

// ── Cron Scheduling ──────────────────────────────────────────────────────────
function startScheduledJobs() {
  const schedule = process.env.SYNC_CRON_SCHEDULE || "0 8 * * *"; // default: daily 8am

  logger.info(`Scheduling case sync with cron: ${schedule}`);

  cron.schedule(schedule, async () => {
    logger.info("Cron: starting scheduled case identification sync");
    try {
      await runCaseIdentificationSync();
    } catch (err) {
      logger.error(`Scheduled case sync failed: ${err.message}`);
    }
  });

  // Update tracking: twice daily
  cron.schedule("0 9,17 * * *", async () => {
    logger.info("Cron: starting scheduled update tracking sync");
    try {
      await runUpdateTrackingSync();
    } catch (err) {
      logger.error(`Scheduled update sync failed: ${err.message}`);
    }
  });

  logger.info("Scheduled jobs registered");
}

module.exports = {
  runCaseIdentificationSync,
  runUpdateTrackingSync,
  startScheduledJobs,
  addSseClient,
  broadcast,
};
