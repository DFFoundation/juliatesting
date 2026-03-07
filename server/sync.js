const cron = require("node-cron");
const { runCaseSearch, DEMOCRACY_NOS_CODES } = require("./pacer");
const { checkAllApprovedForUpdates, subscribeToDocket } = require("./courtlistener");
const db = require("./db");
const logger = require("./logger");

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

async function runCaseIdentificationSync(options = {}) {
  const params = {
    dateFrom: options.dateFrom || process.env.DEFAULT_DATE_FROM || "2025-01-20",
    dateTo: options.dateTo || new Date().toISOString().split("T")[0],
    nosCodes: options.nosCodes || DEMOCRACY_NOS_CODES,
    courts: options.courts || null,
    enrichParties: options.enrichParties ?? false,
  };

  const syncId = await db.startSyncLog("case_search", params);
  logger.info(`Starting case identification sync (syncId: ${syncId})`);
  broadcast({ type: "sync_start", syncType: "case_search", syncId });

  try {
    const { eligible, excluded, total } = await runCaseSearch(params, (progress) => {
      logger.debug(progress.message);
      broadcast({ type: "progress", ...progress });
    });

    let newCases = 0;
    for (const c of eligible) {
      const existing = await db.getCase(c.id);
      if (!existing) { await db.upsertCase({ ...c, reviewStatus: "pending" }); newCases++; }
    }
    for (const c of excluded) {
      const existing = await db.getCase(c.id);
      if (!existing) await db.upsertCase({ ...c, reviewStatus: "excluded" });
    }

    await db.completeSyncLog(syncId, { casesFound: total, casesEligible: eligible.length, casesExcluded: excluded.length });
    const result = { total, eligible: eligible.length, excluded: excluded.length, newCases };
    broadcast({ type: "sync_complete", syncType: "case_search", ...result });
    logger.info(`Case sync complete: ${newCases} new, ${eligible.length} eligible, ${excluded.length} excluded`);
    return result;
  } catch (err) {
    await db.failSyncLog(syncId, err.message);
    broadcast({ type: "sync_error", syncType: "case_search", error: err.message });
    logger.error(`Case sync failed: ${err.message}`);
    throw err;
  }
}

async function runUpdateTrackingSync() {
  const syncId = await db.startSyncLog("update_check");
  logger.info(`Starting update tracking sync (syncId: ${syncId})`);
  broadcast({ type: "sync_start", syncType: "update_check", syncId });

  try {
    const approvedCases = await db.getCases({ reviewStatus: "approved" });
    if (approvedCases.length === 0) {
      await db.completeSyncLog(syncId, { updatesFound: 0 });
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

      if (update.linked && update.clDocketId) {
        await db.updateCaseClDocket(c.id, String(update.clDocketId), update.clLink || "");
        await subscribeToDocket(update.clDocketId);
        await db.insertUpdate({ caseId: c.id, updateType: "cl_linked", description: `Linked to CourtListener docket ${update.clDocketId}`, rawData: update.meta });
        updatesFound++;
        continue;
      }

      if (update.entries?.length > 0) {
        const newEntries = update.entries.filter((e) => !c.latestFilings.some((f) => f.entryNumber === e.entry_number));
        for (const entry of newEntries) {
          await db.insertUpdate({ caseId: c.id, updateType: "new_filing", description: entry.description || `Entry #${entry.entry_number}`, entryNumber: String(entry.entry_number || ""), dateFiled: entry.date_filed, documents: (entry.recap_documents || []).map((d) => ({ id: d.id, description: d.description, filepath: d.filepath_local })), rawData: entry });
          updatesFound++;
        }
        if (newEntries.length > 0) {
          await db.updateCaseLatestFilings(c.id, update.entries.slice(0, 10).map((e) => ({ entryNumber: e.entry_number, dateFiled: e.date_filed, description: e.description })));
        }
      }
      await db.updateCaseLastClCheck(c.id);
    }

    await db.completeSyncLog(syncId, { updatesFound });
    broadcast({ type: "sync_complete", syncType: "update_check", updatesFound });
    logger.info(`Update sync complete: ${updatesFound} updates`);
    return { updatesFound };
  } catch (err) {
    await db.failSyncLog(syncId, err.message);
    broadcast({ type: "sync_error", syncType: "update_check", error: err.message });
    logger.error(`Update sync failed: ${err.message}`);
    throw err;
  }
}

function startScheduledJobs() {
  const schedule = process.env.SYNC_CRON_SCHEDULE || "0 8 * * *";
  logger.info(`Scheduling case sync: ${schedule}`);
  cron.schedule(schedule, () => runCaseIdentificationSync().catch((e) => logger.error(e.message)));
  cron.schedule("0 9,17 * * *", () => runUpdateTrackingSync().catch((e) => logger.error(e.message)));
  logger.info("Scheduled jobs registered");
}

module.exports = { runCaseIdentificationSync, runUpdateTrackingSync, startScheduledJobs, addSseClient, broadcast };
