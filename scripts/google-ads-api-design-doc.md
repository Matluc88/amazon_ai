# Google Ads API — Design Document

**Tool name:** Sivigliart BI Dashboard
**Applicant:** Matteo Luceri (independent marketing consultant)
**Contact:** matteo.luceri2@gmail.com
**Google Ads Manager Account (MCC):** 433-866-3546
**Date:** April 2026

---

## 1. Purpose and Overview

Sivigliart BI Dashboard is an **internal, single-user reporting tool** used by
Matteo Luceri, an independent marketing consultant, to monitor advertising
performance across multiple platforms (Google Ads and Meta Ads) for a small
number of client accounts, primarily Sivigliart — an Italian online seller
of art prints and canvas wall art.

The tool automates the daily collection of **read-only performance metrics**
(spend, impressions, clicks, conversions, conversion value) from each
advertising platform into a single PostgreSQL database, so that campaign
results can be reviewed from a unified internal dashboard instead of logging
into each platform's native UI.

This tool **does not create, modify, pause, enable or delete** any campaigns,
ad groups, keywords, ads, budgets, bids or assets. It is strictly a
reporting/read-only integration.

---

## 2. Users and Access

- **Number of users:** 1 (the consultant himself)
- **User type:** Internal — employees only (in this case, a single-person
  consulting activity)
- **Authentication:** The dashboard is protected behind a username/password
  login using express-session + bcrypt, served only over HTTPS via Render.
- **Number of Google Ads accounts accessed:** 1 client account
  (Sivigliart — customer ID 553-612-2825), all under the same MCC
  (433-866-3546).
- **Distribution:** The tool is NOT distributed to any third party, is NOT
  publicly available, is NOT a SaaS product, and is not sold or licensed
  to anyone.

---

## 3. Architecture Overview

```
┌─────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  Google Ads API │      │  Meta Marketing  │      │  Other sources   │
│   (read-only)   │      │       API        │      │    (future)      │
└────────┬────────┘      └────────┬─────────┘      └────────┬─────────┘
         │                        │                         │
         └────────────────────────┼─────────────────────────┘
                                  │
                                  ▼
                  ┌───────────────────────────────┐
                  │  ETL Worker (Node.js script)  │
                  │  scripts/sync-metrics.js      │
                  │  Runs once per day via cron   │
                  └──────────────┬────────────────┘
                                 │ UPSERT
                                 ▼
                  ┌───────────────────────────────┐
                  │   PostgreSQL database         │
                  │   table: metrics_ads_daily    │
                  │   (date, platform,            │
                  │    campaign_id, spend,        │
                  │    impressions, clicks,       │
                  │    conversions, revenue)      │
                  └──────────────┬────────────────┘
                                 │ SELECT
                                 ▼
                  ┌───────────────────────────────┐
                  │ Express.js HTTP API           │
                  │ /api/metrics/summary          │
                  │ /api/metrics/daily            │
                  │ /api/metrics/campaigns        │
                  └──────────────┬────────────────┘
                                 │ JSON
                                 ▼
                  ┌───────────────────────────────┐
                  │  HTML dashboard (Chart.js)    │
                  │  /metrics                     │
                  │  KPI cards, line chart,       │
                  │  sortable campaign table      │
                  └───────────────────────────────┘
```

All components run inside a single Node.js application hosted on Render
(https://render.com), a PaaS provider. The entire stack is:

- **Language:** Node.js (v20)
- **HTTP server:** Express.js
- **Database:** PostgreSQL (managed by Render)
- **Scheduler:** Render Cron Jobs (native feature)
- **Google Ads client library:** `google-ads-api` (npm package,
  https://www.npmjs.com/package/google-ads-api) — or equivalent official
  library
- **Auth library:** `google-auth-library` for OAuth2 token refresh

---

## 4. Authentication Flow

1. The Google Cloud Console project ("Sivigliart BI") is configured with an
   OAuth 2.0 Client ID of type "Desktop app".
2. During one-time setup, the consultant runs a local CLI script that opens
   a browser, authenticates with his Google account
   (matteo.luceri2@gmail.com, which has access to the Google Ads MCC
   433-866-3546), and accepts the `https://www.googleapis.com/auth/adwords`
   read scope.
3. The resulting **refresh token** is saved securely as an environment
   variable on Render (`GOOGLE_ADS_REFRESH_TOKEN`) alongside:
   - `GOOGLE_ADS_CLIENT_ID`
   - `GOOGLE_ADS_CLIENT_SECRET`
   - `GOOGLE_ADS_DEVELOPER_TOKEN`
   - `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (the MCC)
   - `GOOGLE_ADS_CUSTOMER_ID` (the client account under the MCC)
4. At runtime, the ETL worker uses the refresh token to obtain short-lived
   access tokens (auto-managed by the Google Ads client library).
5. No end-user OAuth flow is ever exposed — this is a private single-user
   tool, not a public application.

---

## 5. API Calls

The tool makes **read-only** API calls to `GoogleAdsService.searchStream`
using GAQL (Google Ads Query Language). The following query is executed
once per day during the scheduled sync:

### Query: daily campaign performance

```sql
SELECT
  segments.date,
  campaign.id,
  campaign.name,
  metrics.cost_micros,
  metrics.impressions,
  metrics.clicks,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE segments.date DURING LAST_7_DAYS
  AND campaign.status != 'REMOVED'
```

The initial backfill uses `LAST_90_DAYS` as the date range. After that,
only the last 7 days are re-fetched each night (rolling window, so late
conversion attributions are captured correctly), and the results are
UPSERTed into the PostgreSQL table `metrics_ads_daily` using
`ON CONFLICT (date, platform, campaign_id) DO UPDATE`.

**Read-only endpoints used:**
- `GoogleAdsService.searchStream` — main query endpoint
- `CustomerService.listAccessibleCustomers` (optional, during initial setup
  only, to verify the correct customer ID)

**Endpoints NOT used (never):**
- Any `Mutate*` operation on campaigns, ad groups, ads, keywords, budgets,
  bidding strategies or assets
- Any write operation whatsoever

---

## 6. API Quota and Rate Limiting

- **Expected call volume:** ~1 query per day (during the nightly sync).
- **Expected operations per day:** Well under 100. For reference, the
  default daily operation quota in Google Ads API is 15,000 operations
  per developer token per account per day, so this usage is orders of
  magnitude below any limit.
- **Concurrency:** 1 request at a time, strictly sequential.
- **Backoff and retry:** The `google-ads-api` client library handles
  transient errors with exponential backoff. On persistent errors, the
  sync script logs the error to the `metrics_sync_log` table and exits
  with a non-zero code so that Render alerts the consultant.
- **Caching:** Results are stored in PostgreSQL for 90 days (rolling
  window). The dashboard reads exclusively from PostgreSQL — it never
  calls the Google Ads API directly from the frontend.

---

## 7. Data Storage and Security

- **Where data is stored:** Only in the private Render-managed PostgreSQL
  database owned by the consultant. The database is not accessible from
  the public internet; access is restricted to the Render internal network
  and the consultant's own machine via `DATABASE_URL`.
- **Data retained:** Aggregated daily campaign metrics (no personal data,
  no ad creative content, no user-level data).
- **Data sharing:** NONE. Data is not shared with any third party, not
  sold, not forwarded to other systems, and not aggregated with data from
  other clients or advertisers.
- **Secrets management:** All API credentials (developer token, OAuth
  client secret, refresh token) are stored exclusively as environment
  variables on Render, never committed to the Git repository. The `.env`
  file is ignored via `.gitignore`.
- **Encryption in transit:** All API calls use HTTPS. The dashboard is
  served only over HTTPS via Render.

---

## 8. Error Handling and Monitoring

- Each sync run writes an entry to the `metrics_sync_log` table with
  status (`running` / `ok` / `error`), start time, end time, number of
  rows synced and error message if any.
- The internal dashboard displays the status of the last sync to the
  consultant.
- On repeated failures, Render sends an email notification to
  matteo.luceri2@gmail.com.

---

## 9. Compliance with Google Ads API Policies

- **Required Minimum Functionality (RMF):** This tool is classified as an
  **internal tool** used solely by the consultant to report on his own
  managed accounts. Per the Google Ads API Required Minimum Functionality
  policy, internal tools are subject to reduced RMF requirements.
- **No prohibited uses:** The tool does not perform automated bidding,
  does not perform mass account creation, does not scrape Google services,
  does not redistribute Google Ads data to third parties, and does not
  implement App Conversion Tracking or Remarketing.
- **Data usage:** All data retrieved from the Google Ads API is used
  exclusively for performance reporting within the consultant's internal
  dashboard. No data is exported, resold, or shared externally.

---

## 10. Screenshots / Mockups

The internal dashboard (currently live for Meta Ads only, awaiting Google
Ads approval to extend) displays:

- **Top KPI cards:** total spend, impressions, clicks, conversions,
  revenue, ROAS.
- **Time series line chart:** daily spend and clicks across the selected
  period.
- **Campaign table:** per-campaign rows with spend, impressions, clicks,
  CTR, CPC, conversions, CPA, revenue, ROAS. Sortable and filterable by
  platform (Meta / Google).
- **Date range selector:** today / yesterday / 7 / 30 / 90 days.

Screenshots can be provided on request.

---

## 11. Contact

For any questions about this design document or the tool's intended use:

**Matteo Luceri**
Email: matteo.luceri2@gmail.com
LinkedIn: https://www.linkedin.com/in/matteo-luceri-137ab120a/
Google Ads Manager (MCC): 433-866-3546
