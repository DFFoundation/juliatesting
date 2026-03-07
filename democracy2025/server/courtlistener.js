// server/courtlistener.js
// Primary case identification and update tracking via CourtListener API

const axios = require("axios");
const logger = require("./logger");

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";

// NOS label → code mapping (CourtListener stores the label, not the code)
const NOS_LABEL_TO_CODE = {
  "Other Civil Rights": "440",
  "Voting": "441",
  "Employment": "442",
  "Housing/Accommodations": "443",
  "Americans with Disabilities - Employment": "445",
  "Americans with Disabilities - Other": "446",
  "Education": "448",
  "Alien Detainee": "463",
  "Other Immigration Actions": "465",
  "Other Labor Litigation": "790",
  "E.R.I.S.A.": "791",
  "Freedom of Information Act": "895",
  "Administrative Procedure Act/Review or Appeal of Agency Decision": "899",
  "Other Statutory Actions": "890",
  "Taxes (U.S. Plaintiff or Defendant)": "870",
  "Environmental Matters": "893",
};

// NOS labels we want to search for
const TARGET_NOS_LABELS = Object.keys(NOS_LABEL_TO_CODE);

// Partner orgs whose FOIA/habeas cases are included despite normal exclusions
const PARTNER_ORGS = [
  "democracy defenders",
  "democracy defenders fund",
  "aclu",
  "american civil liberties union",
  "protect democracy",
  "state democracy defenders",
  "public citizen",
];

// Signals that identify a federal defendant from case name
const FEDERAL_DEFENDANT_SIGNALS = [
  "united states", "u.s. department", "department of", "secretary of",
  "administrator of", "commissioner of", "director of", "attorney general",
  "doge", "office of management", "opm", "dhs", "doj", "cia", "fbi", "irs",
  "department of homeland", "department of justice", "department of education",
  "department of state", "department of defense", "department of health",
  "federal bureau", "immigration and customs", "customs and border",
  "transportation security", "social security administration",
];

function clHeaders() {
  return {
    Authorization: `Token ${process.env.COURTLISTENER_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// ── Case Search ─────────────────────────────────────────────────────────────
// Search CourtListener dockets for cases matching our criteria
// Uses jurisdiction_type=U.S. Government Defendant to find federal defendants
async function searchCases({ dateFrom, dateTo, nosCodes }, onProgress) {
  const eligible = [];
  const excluded = [];
  let totalFetched = 0;

  // Build NOS label list from codes (CL uses labels not codes in filter)
  // We search all target NOS labels in batches
  const nosLabels = nosCodes
    ? TARGET_NOS_LABELS.filter((label) => {
        const code = NOS_LABEL_TO_CODE[label];
        return nosCodes.includes(code);
      })
    : TARGET_NOS_LABELS;

  onProgress?.({ type: "status", message: "Searching CourtListener dockets…" });

  // Search with jurisdiction_type filter for U.S. Government Defendant
  // This is the most reliable federal defendant filter
  const params = new URLSearchParams({
    date_filed__gte: dateFrom || process.env.DEFAULT_DATE_FROM || "2025-01-20",
    ...(dateTo ? { date_filed__lte: dateTo } : {}),
    jurisdiction_type: "U.S. Government Defendant",
    order_by: "-date_filed",
    page_size: 100,
  });

  let url = `${CL_BASE}/dockets/?${params}`;
  let pageNum = 0;

  while (url) {
    pageNum++;
    onProgress?.({ type: "status", message: `Fetching page ${pageNum}…` });

    let response;
    try {
      response = await axios.get(url, {
        headers: clHeaders(),
        timeout: 30000,
      });
    } catch (err) {
      throw new Error(`CourtListener API error on page ${pageNum}: ${err.message}`);
    }

    const data = response.data;
    const cases = data.results || [];

    onProgress?.({
      type: "progress",
      message: `Page ${pageNum} — ${cases.length} cases received (${totalFetched + cases.length} total so far)`,
      total: data.count || 0,
    });

    for (const docket of cases) {
      totalFetched++;
      const normalized = normalizeDocket(docket);
      const exclusionReason = checkEligibility(docket);

      if (exclusionReason) {
        excluded.push({ ...normalized, exclusionReason });
      } else {
        eligible.push(normalized);
      }
    }

    // Cursor-based pagination
    url = data.next || null;

    // Rate limit: CL allows ~5000 requests/day for free accounts
    // Small delay to be respectful
    if (url) await delay(200);
  }

  onProgress?.({
    type: "complete",
    message: `Search complete: ${eligible.length} eligible, ${excluded.length} excluded from ${totalFetched} total`,
  });

  return { eligible, excluded, total: totalFetched };
}

// ── Eligibility Check ────────────────────────────────────────────────────────
function checkEligibility(docket) {
  const title = (docket.case_name || "").toLowerCase();
  const nos = (docket.nature_of_suit || "").toLowerCase();
  const jurisdiction = (docket.jurisdiction_type || "").toLowerCase();

  // Must be a civil case with federal defendant
  // jurisdiction_type "U.S. Government Defendant" already handles this
  // but double-check via title signals as fallback
  const hasFederalDefendant =
    jurisdiction.includes("u.s. government defendant") ||
    FEDERAL_DEFENDANT_SIGNALS.some((sig) => title.includes(sig));

  if (!hasFederalDefendant) return "No federal defendant identified";

  // Check partner org status for exception handling
  const isPartner = PARTNER_ORGS.some((org) => title.includes(org));

  // NOS-based exclusions
  const isFOIA =
    nos.includes("freedom of information") ||
    nos.includes("895");
  const isHabeas =
    nos.includes("alien detainee") ||
    nos.includes("463");

  if (isHabeas && !isPartner) return "Individual habeas/removal — non-partner org";
  if (isFOIA && !isPartner) return "Standalone FOIA — non-partner org";

  return null; // eligible
}

// ── Normalize CourtListener docket to internal format ────────────────────────
function normalizeDocket(docket) {
  const nos = docket.nature_of_suit || "";
  const nosCode = NOS_LABEL_TO_CODE[nos] || "";
  const courtId = docket.court_id || "";
  const clId = docket.id;

  return {
    id: String(clId),
    caseName: docket.case_name || "",
    docketNumber: docket.docket_number || "",
    filingDate: docket.date_filed || "",
    courtId,
    court: courtId,
    appealLevel: inferAppealLevel(courtId),
    caseType: classifyCaseType(nosCode, nos),
    nosCode,
    nosLabel: nos,
    plaintiffs: [],
    defendants: [],
    counsel: [],
    status: "Unreviewed",
    pclCaseId: docket.pacer_case_id || null,
    courtListenerDocketId: clId,
    courtListenerLink: `https://www.courtlistener.com${docket.absolute_url || ""}`,
    lastUpdated: new Date().toISOString().split("T")[0],
    latestFilings: [],
    notes: "",
    _source: "courtlistener",
  };
}

// ── Update Tracking ──────────────────────────────────────────────────────────
// Check for new docket entries on approved cases
async function checkForUpdates(cases) {
  const updates = [];

  for (const c of cases) {
    if (!c.courtListenerDocketId) continue;

    try {
      const response = await axios.get(
        `${CL_BASE}/docket-entries/?docket=${c.courtListenerDocketId}&order_by=-date_filed&page_size=5`,
        { headers: clHeaders(), timeout: 15000 }
      );

      const entries = response.data?.results || [];
      for (const entry of entries) {
        updates.push({
          caseId: c.id,
          caseName: c.caseName,
          docketEntryId: entry.id,
          description: entry.description || "New docket entry",
          dateFiled: entry.date_filed || entry.date_created,
          documents: (entry.recap_documents || []).slice(0, 3).map((d) => ({
            id: d.id,
            description: d.description || "",
            url: d.filepath_ia || d.filepath_local || "",
          })),
        });
      }

      await delay(300);
    } catch (err) {
      logger.warn(`Update check failed for case ${c.id}: ${err.message}`);
    }
  }

  return updates;
}

// ── Subscribe to docket alerts ───────────────────────────────────────────────
async function subscribeToDocket(docketId) {
  try {
    const response = await axios.post(
      `${CL_BASE}/docket-alerts/`,
      { docket: `${CL_BASE}/dockets/${docketId}/` },
      { headers: clHeaders(), timeout: 10000 }
    );
    return response.data;
  } catch (err) {
    logger.warn(`Failed to subscribe to docket ${docketId}: ${err.message}`);
    return null;
  }
}

// ── Case Classification ──────────────────────────────────────────────────────
function classifyCaseType(nosCode, nosLabel = "") {
  const map = {
    "895": "FOIA / Transparency",
    "899": "APA / Agency Review",
    "441": "Election / Voting Rights",
    "442": "Federal Employment (Civil Rights)",
    "448": "Education Policy",
    "463": "Habeas / Immigration Detention",
    "465": "Immigration",
    "790": "Federal Employment / Labor",
    "791": "ERISA / Federal Benefits",
    "440": "Civil Rights",
    "870": "Federal Tax",
    "890": "Other Statutory",
    "893": "Environmental / Regulatory",
  };
  if (map[nosCode]) return map[nosCode];
  if (nosLabel.toLowerCase().includes("administrative")) return "APA / Agency Review";
  return "Constitutional / Federal";
}

function inferAppealLevel(courtId = "") {
  if (courtId === "scotus") return "Supreme Court";
  if (/^ca\d+$/.test(courtId) || courtId === "cadc" || courtId === "cafc")
    return "Circuit Court";
  return "District Court";
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  searchCases,
  checkEligibility,
  checkForUpdates,
  subscribeToDocket,
  normalizeDocket,
  classifyCaseType,
  PARTNER_ORGS,
  TARGET_NOS_LABELS,
  NOS_LABEL_TO_CODE,
};
