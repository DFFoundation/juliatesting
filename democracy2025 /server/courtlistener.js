// server/courtlistener.js
// Handles CourtListener API for docket update subscriptions and tracking

const axios = require("axios");
const logger = require("./logger");

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";

function clHeaders(token) {
  return {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// ── Find a docket on CourtListener by docket number + court ─────────────────
async function findDocket(docketNumber, courtId) {
  const token = process.env.COURTLISTENER_TOKEN;
  if (!token) return null;

  try {
    const response = await axios.get(`${CL_BASE}/dockets/`, {
      headers: clHeaders(token),
      params: {
        docket_number: docketNumber,
        court: courtId,
        fields: "id,absolute_url,date_filed,date_last_filing,case_name,assigned_to_str",
      },
      timeout: 15000,
    });

    const results = response.data?.results || [];
    return results[0] || null;
  } catch (err) {
    logger.warn(`CL docket lookup failed for ${docketNumber}: ${err.message}`);
    return null;
  }
}

// ── Subscribe to docket alerts for a case ────────────────────────────────────
// Creates a CourtListener docket alert so we get webhooks on new filings
async function subscribeToDocket(clDocketId) {
  const token = process.env.COURTLISTENER_TOKEN;
  if (!token) {
    logger.warn("No CourtListener token — skipping docket alert subscription");
    return null;
  }

  try {
    const response = await axios.post(
      `${CL_BASE}/docket-alerts/`,
      { docket: clDocketId },
      { headers: clHeaders(token), timeout: 15000 }
    );
    logger.info(`Subscribed to CL docket alerts for docket ${clDocketId}`);
    return response.data;
  } catch (err) {
    // 400 usually means already subscribed
    if (err.response?.status === 400) {
      logger.info(`Already subscribed to docket ${clDocketId}`);
      return { already_subscribed: true };
    }
    logger.warn(`CL docket alert subscription failed for ${clDocketId}: ${err.message}`);
    return null;
  }
}

// ── Fetch recent docket entries for a case ───────────────────────────────────
async function getDocketEntries(clDocketId, limit = 10) {
  const token = process.env.COURTLISTENER_TOKEN;
  if (!token) return [];

  try {
    const response = await axios.get(`${CL_BASE}/docket-entries/`, {
      headers: clHeaders(token),
      params: {
        docket: clDocketId,
        order_by: "-date_filed",
        page_size: limit,
      },
      timeout: 15000,
    });
    return response.data?.results || [];
  } catch (err) {
    logger.warn(`CL docket entries fetch failed for ${clDocketId}: ${err.message}`);
    return [];
  }
}

// ── Pull latest docket metadata ───────────────────────────────────────────────
async function getDocketMeta(clDocketId) {
  const token = process.env.COURTLISTENER_TOKEN;
  if (!token) return null;

  try {
    const response = await axios.get(`${CL_BASE}/dockets/${clDocketId}/`, {
      headers: clHeaders(token),
      timeout: 15000,
    });
    return response.data;
  } catch (err) {
    logger.warn(`CL docket meta fetch failed for ${clDocketId}: ${err.message}`);
    return null;
  }
}

// ── Check for updates to a tracked case ──────────────────────────────────────
// Returns { hasUpdates, entries, meta } for a given tracked case
async function checkCaseForUpdates(trackedCase) {
  if (!trackedCase.courtListenerDocketId) {
    // Try to find and link the docket first
    const docket = await findDocket(trackedCase.docketNumber, trackedCase.courtId);
    if (!docket) {
      return { hasUpdates: false, entries: [], meta: null, linked: false };
    }
    return {
      hasUpdates: true, // newly linked counts as an update
      entries: [],
      meta: docket,
      linked: true,
      clDocketId: docket.id,
      clLink: `https://www.courtlistener.com${docket.absolute_url}`,
    };
  }

  const [meta, entries] = await Promise.all([
    getDocketMeta(trackedCase.courtListenerDocketId),
    getDocketEntries(trackedCase.courtListenerDocketId, 5),
  ]);

  if (!meta) return { hasUpdates: false, entries: [], meta: null };

  // Check if there are newer filings since we last updated
  const lastFiling = meta.date_last_filing;
  const hasUpdates = lastFiling && lastFiling > trackedCase.lastUpdated;

  return { hasUpdates, entries, meta };
}

// ── Batch update check for all approved cases ─────────────────────────────────
async function checkAllApprovedForUpdates(approvedCases, onProgress) {
  const updates = [];
  const total = approvedCases.length;

  for (let i = 0; i < total; i++) {
    const c = approvedCases[i];
    onProgress?.({
      type: "progress",
      message: `Checking updates: ${i + 1}/${total} — ${c.caseName?.slice(0, 50)}`,
      pct: Math.round(((i + 1) / total) * 100),
    });

    const result = await checkCaseForUpdates(c);
    if (result.hasUpdates) {
      updates.push({ caseId: c.id, ...result });
    }

    // Respectful delay between CL API calls
    await new Promise((r) => setTimeout(r, 200));
  }

  return updates;
}

// ── Process incoming CourtListener webhook ────────────────────────────────────
// Called when CL POSTs a docket alert to our webhook endpoint
function parseWebhookPayload(body) {
  try {
    const payload = body?.payload || body;
    const results = payload?.results || [];

    return results.map((entry) => ({
      docketId: entry.docket,
      entryNumber: entry.entry_number,
      dateFiled: entry.date_filed,
      description: entry.description || "",
      documents: (entry.recap_documents || []).map((d) => ({
        id: d.id,
        description: d.description,
        filepath: d.filepath_local,
        pageCount: d.page_count,
      })),
    }));
  } catch (err) {
    logger.warn(`Webhook parse error: ${err.message}`);
    return [];
  }
}

module.exports = {
  findDocket,
  subscribeToDocket,
  getDocketEntries,
  getDocketMeta,
  checkCaseForUpdates,
  checkAllApprovedForUpdates,
  parseWebhookPayload,
};
