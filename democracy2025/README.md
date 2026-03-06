# Democracy 2025 — Case Tracker

Identifies and tracks federal civil cases filed against federal defendants since January 20, 2025.

## Architecture

```
democracy2025/
├── server/           # Node.js + Express backend
│   ├── index.js      # API server + routes
│   ├── pacer.js      # PACER PCL API client + eligibility rules
│   ├── courtlistener.js  # CourtListener API for update tracking
│   ├── db.js         # SQLite database layer
│   ├── sync.js       # Scheduled sync jobs + SSE progress streaming
│   └── logger.js     # Winston logger
└── client/           # React frontend
    └── src/
        ├── App.js            # Nav shell
        ├── components/
        │   ├── Dashboard.js  # Stats, sync controls, NOS selector
        │   ├── ReviewQueue.js  # Human review queue
        │   ├── Tracker.js    # Approved cases tracker
        │   └── Updates.js    # Unseen updates feed + excluded cases
        └── api.js            # API client
```

## Data Sources

| Task | Source |
|------|--------|
| Case identification | PACER Case Locator (PCL) API |
| Party / attorney data | PACER PCL party search (optional, billed) |
| Docket update tracking | CourtListener docket alerts + webhooks |
| Document links | CourtListener RECAP Archive |

## Setup

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Configure environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```env
PACER_USERNAME=your_pacer_username
PACER_PASSWORD=your_pacer_password
COURTLISTENER_TOKEN=your_courtlistener_token
```

Get your CourtListener token free at: https://www.courtlistener.com/sign-in/

### 3. Run

```bash
npm run dev
```

- Backend: http://localhost:3001
- Frontend: http://localhost:3000

### Production

```bash
npm run build        # Builds React to client/build/
cd server && npm start
```

Serve the `client/build/` folder as static files from your server or a CDN.

## CourtListener Webhook

To receive real-time docket update notifications, point a CourtListener docket alert webhook to:

```
POST https://your-domain.com/api/webhooks/courtlistener
```

Configure this in your CourtListener account settings under Webhooks.

## Eligibility Rules

Cases are automatically filtered by:

**Included:**
- Civil cases (`caseType: cv`) in federal courts
- Filed since January 20, 2025
- Matching selected Nature of Suit codes
- Against a federal defendant (agency, official, department)
- FOIA / habeas cases filed by partner organizations (ACLU, Democracy Defenders, Protect Democracy, State Democracy Defenders, Public Citizen)

**Excluded:**
- Pro se plaintiffs (no attorney of record)
- Individual habeas / removal cases (non-partner orgs)
- Standalone FOIA cases (non-partner orgs)
- No identifiable federal defendant

## NOS Codes Monitored

| Code | Category |
|------|----------|
| 899 | APA / Administrative Review |
| 895 | FOIA / Transparency |
| 441 | Voting Rights |
| 440 | Other Civil Rights |
| 442 | Civil Rights — Employment |
| 448 | Education Policy |
| 463 | Habeas — Alien Detainee |
| 465 | Other Immigration |
| 790 | Federal Labor / Employment |
| 791 | ERISA / Federal Benefits |
| 870 | Federal Tax (U.S. Defendant) |
| 893 | Environmental / Regulatory |
| 890 | Other Statutory Actions |

## Sync Schedule

- **Case identification:** Daily at 8:00 AM (configurable via `SYNC_CRON_SCHEDULE`)
- **Update tracking:** Daily at 9:00 AM and 5:00 PM

Change via `.env`:
```env
SYNC_CRON_SCHEDULE=0 8 * * *         # once daily at 8am
SYNC_CRON_SCHEDULE=0 */12 * * *      # every 12 hours
SYNC_CRON_SCHEDULE=0 8,12,17 * * *   # three times daily
```

## PACER Fees

PACER bills at $0.10/page. The case identification search incurs per-page fees on search results. Enabling party enrichment adds additional fees per case (one party search per case).

Fees are waived if you accrue less than $30/quarter.

## Airtable Export

Export approved cases to CSV from the Dashboard or via:

```
GET /api/export/csv?reviewStatus=approved
```

The CSV is formatted for direct Airtable import.
