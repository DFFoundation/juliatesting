// server/pacer.js
// Handles PACER authentication and PCL (Case Locator) API calls

const axios = require("axios");
const logger = require("./logger");

const AUTH_URL = "https://pacer.login.uscourts.gov/services/cso-auth";
const PCL_BASE = "https://pcl.uscourts.gov/pcl-public-api/rest";

// NOS codes relevant to Democracy 2025 universe
// These are sent as the pre-filter to the PCL API
const DEMOCRACY_NOS_CODES = [
  "440", // Other Civil Rights
  "441", // Voting Rights
  "442", // Employment (Civil Rights)
  "448", // Education
  "463", // Habeas Corpus — Alien Detainee
  "465", // Other Immigration
  "790", // Other Labor Litigation
  "791", // ERISA
  "895", // Freedom of Information Act
  "899", // Administrative Procedure Act
  "890", // Other Statutory Actions
  "870", // Taxes (U.S. Defendant)
  "893", // Environmental Matters
];

// Partner orgs: FOIA/habeas cases from these orgs are INCLUDED despite normal exclusions
const PARTNER_ORGS = [
  "democracy defenders",
  "democracy defenders fund",
  "aclu",
  "american civil liberties union",
  "protect democracy",
  "state democracy defenders",
  "public citizen",
];

// Tokens that strongly suggest a federal defendant in party data or case title
const FEDERAL_DEFENDANT_SIGNALS = [
  "united states",
  "u.s. department",
  "department of",
  "secretary of",
  "administrator of",
  "commissioner of",
  "director of",
  "attorney general",
  "doge",
  "office of management",
  "opm",
  "dhs",
  "doj",
  "cia",
  "fbi",
  "irs",
  "department of homeland",
  "department of justice",
  "department of education",
  "department of state",
  "department of defense",
  "department of health",
  "federal bureau",
  "immigration and customs",
  "customs and border",
  "transportation security",
  "social security administration",
];

let _token = null;
let _tokenExpiry = null;

// ── Authentication ──────────────────────────────────────────────────────────
async function authenticate() {
  // Reuse token if still valid (tokens last ~1 hour)
  if (_token && _tokenExpiry && Date.now() < _tokenExpiry) {
    return _token;
  }

  logger.info("Authenticating with PACER…");

  const response = await axios.post(
    AUTH_URL,
    {
      loginId: process.env.PACER_USERNAME,
      password: process.env.PACER_PASSWORD,
      redactFlag: "1",
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    }
  );

  if (!response.data?.nextGenCSO) {
    throw new Error("PACER auth failed — no token returned");
  }

  _token = response.data.nextGenCSO;
  _tokenExpiry = Date.now() + 50 * 60 * 1000; // expire after 50 min to be safe
  logger.info("PACER authentication successful");
  return _token;
}

// ── Case Search ─────────────────────────────────────────────────────────────
// Search PCL for civil cases matching date range + NOS codes
// Returns raw PCL case results
async function searchCases({ dateFrom, dateTo, nosCodes, courts, page = 0 }) {
  const token = await authenticate();

  // Build NOS filter — PCL accepts an array of NOS codes
  const nosFilter = (nosCodes || DEMOCRACY_NOS_CODES).map((n) => String(n));

  // Build court filter — PCL uses court IDs (e.g. "dcd", "nysd")
  const courtFilter = courts
    ? courts.split(",").map((c) => c.trim()).filter(Boolean)
    : null;

  const body = {
    dateFiledFrom: dateFrom, // YYYY-MM-DD
    dateFiledTo: dateTo,
    caseType: "cv", // civil only
    natureOfSuits: nosFilter,
    ...(courtFilter ? { courtIds: courtFilter } : {}),
  };

  logger.info(`PCL search page ${page}: ${nosFilter.length} NOS codes, courts: ${courtFilter?.join(",") || "all"}`);

  const response = await axios.post(
    `${PCL_BASE}/cases/find?page=${page}`,
    body,
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-NEXT-GEN-CSO": token,
      },
      timeout: 30000,
    }
  );

  return response.data;
}

// ── Party Search ─────────────────────────────────────────────────────────────
// For a given case (by caseId + courtId), fetch party data to identify
// federal defendants and check for pro se status
async function getCaseParties(caseId, courtId) {
  const token = await authenticate();

  const body = {
    caseId,
    courtId,
  };

  try {
    const response = await axios.post(
      `${PCL_BASE}/parties/find?page=0`,
      body,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-NEXT-GEN-CSO": token,
        },
        timeout: 15000,
      }
    );
    return response.data?.content || [];
  } catch (err) {
    logger.warn(`Party fetch failed for ${caseId}@${courtId}: ${err.message}`);
    return [];
  }
}

// ── Eligibility Filtering ───────────────────────────────────────────────────
// Apply Democracy 2025 inclusion/exclusion rules to a PCL case object
// Returns null if eligible, or a string exclusion reason if not
function checkEligibility(pclCase, parties = []) {
  const title = (pclCase.caseTitle || "").toLowerCase();
  const nos = String(pclCase.natureOfSuit || "");

  // Check if any party is a known partner org (affects FOIA/habeas exceptions)
  const isPartner = PARTNER_ORGS.some(
    (org) =>
      title.includes(org) ||
      parties.some((p) => (p.lastName || "").toLowerCase().includes(org) ||
        (p.firstName || "").toLowerCase().includes(org))
  );

  // Check for federal defendant — first from party data, then from title
  const hasFederalDefendantFromParties =
    parties.length > 0 &&
    parties.some(
      (p) =>
        (p.partyRole || "").toLowerCase().includes("defendant") &&
        FEDERAL_DEFENDANT_SIGNALS.some((sig) =>
          (p.lastName || "").toLowerCase().includes(sig) ||
          (p.firstName || "").toLowerCase().includes(sig)
        )
    );

  const hasFederalDefendantFromTitle = FEDERAL_DEFENDANT_SIGNALS.some((sig) =>
    title.includes(sig)
  );

  const hasFederalDefendant =
    hasFederalDefendantFromParties || hasFederalDefendantFromTitle;

  // Check pro se: no attorneys in party data
  const hasAttorney = parties.some(
    (p) => p.attorneys && p.attorneys.length > 0
  );
  const isProSe = parties.length > 0 && !hasAttorney && !isPartner;

  // NOS-based type flags
  const isFOIA = nos === "895";
  const isHabeas = nos === "463";

  // Apply rules
  if (!hasFederalDefendant) return "No federal defendant identified";
  if (isProSe) return "Pro se (no attorney of record)";
  if (isHabeas && !isPartner) return "Individual habeas/removal — non-partner org";
  if (isFOIA && !isPartner) return "Standalone FOIA — non-partner org";

  return null; // eligible
}

// ── Case Classification ─────────────────────────────────────────────────────
function classifyCaseType(nosCode) {
  const nos = String(nosCode || "");
  const map = {
    "895": "FOIA / Transparency",
    "899": "APA / Agency Review",
    "441": "Election / Voting Rights",
    "442": "Federal Employment (Civil Rights)",
    "448": "Education Policy",
    "463": "Habeas / Immigration Detention",
    "465": "Immigration",
    "462": "Immigration — Naturalization",
    "790": "Federal Employment / Labor",
    "791": "ERISA / Federal Benefits",
    "710": "Fair Labor Standards Act",
    "440": "Civil Rights",
    "443": "Civil Rights — Housing",
    "444": "Civil Rights — Welfare",
    "445": "ADA — Employment",
    "446": "ADA — Other",
    "870": "Federal Tax",
    "890": "Other Statutory",
    "893": "Environmental / Regulatory",
  };
  return map[nos] || "Constitutional / Federal";
}

// ── Full Search + Filter Pipeline ───────────────────────────────────────────
// Runs a full search, paginates through results, applies eligibility rules
// Returns { eligible, excluded, total, pages }
async function runCaseSearch(options, onProgress) {
  const { dateFrom, dateTo, nosCodes, courts, enrichParties = false } = options;
  const eligible = [];
  const excluded = [];
  let totalFetched = 0;
  let page = 0;
  let hasMore = true;

  onProgress?.({ type: "status", message: "Starting PACER PCL search…" });

  while (hasMore) {
    onProgress?.({ type: "status", message: `Fetching page ${page + 1}…` });

    let data;
    try {
      data = await searchCases({ dateFrom, dateTo, nosCodes, courts, page });
    } catch (err) {
      throw new Error(`PCL API error on page ${page}: ${err.message}`);
    }

    const cases = data?.content || [];
    const totalPages = data?.totalPages ?? 1;

    onProgress?.({
      type: "progress",
      message: `Page ${page + 1}/${totalPages} — ${cases.length} cases received`,
      total: data?.totalElements || 0,
    });

    for (const pclCase of cases) {
      totalFetched++;

      // Optionally enrich with party data (costs PACER fees per case)
      let parties = [];
      if (enrichParties && pclCase.caseId && pclCase.courtId) {
        parties = await getCaseParties(pclCase.caseId, pclCase.courtId);
        // Small delay to be respectful of PACER rate limits
        await delay(300);
      }

      const exclusionReason = checkEligibility(pclCase, parties);
      const normalized = normalizePclCase(pclCase, parties);

      if (exclusionReason) {
        excluded.push({ ...normalized, exclusionReason });
      } else {
        eligible.push(normalized);
      }
    }

    page++;
    hasMore = page < totalPages && page < 100; // PCL max is 100 pages
  }

  onProgress?.({
    type: "complete",
    message: `Search complete: ${eligible.length} eligible, ${excluded.length} excluded from ${totalFetched} total`,
  });

  return { eligible, excluded, total: totalFetched };
}

// ── Normalize PCL case object to our internal format ────────────────────────
function normalizePclCase(pclCase, parties = []) {
  const nos = String(pclCase.natureOfSuit || "");

  const plaintiffs = parties
    .filter((p) => (p.partyRole || "").toLowerCase().includes("plaintiff") ||
      (p.partyRole || "").toLowerCase().includes("petitioner"))
    .map((p) => [p.firstName, p.lastName].filter(Boolean).join(" ").trim())
    .filter(Boolean);

  const defendants = parties
    .filter((p) => (p.partyRole || "").toLowerCase().includes("defendant") ||
      (p.partyRole || "").toLowerCase().includes("respondent"))
    .map((p) => [p.firstName, p.lastName].filter(Boolean).join(" ").trim())
    .filter(Boolean);

  const counsel = parties
    .flatMap((p) => p.attorneys || [])
    .map((a) => [a.firstName, a.lastName].filter(Boolean).join(" ").trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i) // dedupe
    .slice(0, 8);

  return {
    id: pclCase.caseId || String(Math.random()),
    caseName: pclCase.caseTitle || "",
    docketNumber: pclCase.caseNumberFull || pclCase.caseNumber || "",
    filingDate: pclCase.dateFiled || "",
    courtId: pclCase.courtId || "",
    court: pclCase.courtName || pclCase.courtId || "",
    appealLevel: inferAppealLevel(pclCase.courtId || ""),
    caseType: classifyCaseType(nos),
    nosCode: nos,
    nosLabel: pclCase.natureOfSuitDescription || "",
    plaintiffs,
    defendants,
    counsel,
    status: "Unreviewed",
    pclCaseId: pclCase.caseId,
    courtListenerDocketId: null, // populated after CL subscription
    courtListenerLink: "",
    lastUpdated: new Date().toISOString().split("T")[0],
    latestFilings: [],
    notes: "",
    _source: "pacer-pcl",
  };
}

function inferAppealLevel(courtId = "") {
  if (courtId === "scotus") return "Supreme Court";
  if (/^ca\d+$/.test(courtId) || courtId === "cadc" || courtId === "cafc") return "Circuit Court";
  return "District Court";
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  authenticate,
  searchCases,
  getCaseParties,
  runCaseSearch,
  checkEligibility,
  classifyCaseType,
  normalizePclCase,
  DEMOCRACY_NOS_CODES,
  PARTNER_ORGS,
};
