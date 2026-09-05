# Milestones — Multi-Tenant Quote-to-Cash Platform

Stack: VueJS (two frontends) · Node/Express modular monolith · PostgreSQL · Redis (cache + BullMQ) · MinIO · Nginx · Mailhog · Socket.IO · Docker

Tenancy model: **shared schema, shared database, `organization_id` discriminator on every business table**. One platform Super Admin governs organizations; each Organization Admin runs their own fully isolated rulebook, catalog, quotes, and data. Every query, cache key, queue payload, socket room, and storage path is tenant-scoped.

Guiding rule: **every phase ends with something you can demo in front of a person** — a screen, a flow, or a visible system behavior. No phase ends with "the backend is half-wired."

---

## Roles & Responsibilities

### Platform Level (cross-tenant)

| Role | Responsibilities |
|---|---|
| **Super Admin** | Platform owner. The only cross-tenant user. Creates organizations, invites/activates/suspends Organization Admins, views org-level health and usage across tenants, can inspect (read-only) any org's audit trail for compliance. Does **not** touch per-org business config — that belongs to the Org Admin. |

### Organization Level (tenant-scoped JWT: `{ org_id, role }`)

| Role | Responsibilities |
|---|---|
| **Organization Admin** | Owns their organization's "rulebook" (Stage 1) and profile. Onboards the org: logo, location, description, contact info, currency/timezone. Configures products, price lists, discount ceilings per customer tier (Bronze/Silver/Gold) × product category, approval chains (Sales Manager only vs. Manager→Finance), warehouses & stock/shipping rules, subscription plans & proration rules. Manages their org's internal users. |
| **Sales Rep** | Builds quotations (Stage 2) within their org: adds lines, adjusts quantities, applies line/order discounts, accepts upsell suggestions. Watches the live margin indicator and risk score. Responds to customer counters (Stage 6). Receives deal-health nudges. |
| **Sales Manager** | First-line approver (Stage 3) within their org. Approves/rejects/edits quotes that cross the first risk threshold, always with a recorded reason. Escalates (automatically, per chain config) to Finance for high-risk quotes. |
| **Finance** | Second-line approver for high-risk discount cases within their org. Final internal gate before a quote's terms become binding. |
| **Ops (Fulfillment)** | Accepts or overrides the proposed warehouse split (Stage 4) for their org's warehouses, manages backorders, acts on "Consolidate Remaining Backorder" prompts. |
| **Customer (external)** | Portal-only access via magic link or email+password (separate, restricted JWT scope: `{ org_id, quotation_ids }`). Views their quote, comments line-by-line, requests changes, counters discounts, confirms with one click (Stage 6). Sees only their own quotations within the one org that issued them. |

### The System as an Actor (BullMQ workers)

Treat automated jobs as a first-class role: risk-score recalculation, backorder consolidation prompts, deal-health scans, billing schedule generation, proration runs, nudge/escalation emails, payment webhook handling. **Every job payload carries `org_id`** — a worker must never process one org's records with another org's config. These carry the "automatic" behaviors and must be observable (health + DLQ).

---

## Phase 1 — Project Foundation & Dev Environment

**Build:** Docker Compose stack (Postgres, Redis, MinIO, Mailhog, Nginx) + Node/Express modular monolith scaffold (module-per-domain layout) + Vue workspace app scaffold + `/health` endpoint + base migration tooling.

**Demo:** `docker compose up` boots the whole stack; hitting `/health` through Nginx returns service status; login shell of the workspace app renders.

## Phase 2 — Multi-Tenancy Core & Data Isolation

**Build:** `organizations` table; `organization_id` column + index on every business table; a tenant-context middleware that resolves `org_id` from the JWT and attaches it to the request; a tenant-scoped query wrapper/DB helper so no repository can issue an unscoped query; Postgres foreign keys enforcing tenant-local integrity (an org's order line can only reference that org's product).

**Demo:** Seed two organizations with dummy rows; show via API + DB inspection that org A's records are unreachable through org B's context, and that attempting a cross-org foreign key reference is rejected.

## Phase 3 — Super Admin & Organization Management

**Build:** Super Admin account (platform-scoped JWT, no `org_id`); organization CRUD (name, status: active/suspended); **invite Organization Admin flow** — super admin enters the org admin's email, system generates an activation link sent via Mailhog; suspension flag that blocks all of an org's logins and jobs.

**Demo:** Super Admin creates "Acme Corp" and invites an org admin; the invite lands in Mailhog; suspending the org immediately blocks its users' API access while the super admin still sees the org listed.

## Phase 4 — Organization Onboarding & Profile

**Build:** Org admin's first-login onboarding wizard collecting: **logo** (upload → MinIO, per-org prefix), **location/address**, **description**, contact email/phone, website, **currency & timezone** (drives billing and deal-health schedules later). Editable afterwards in an Org Settings page; logo rendered in the workspace shell.

**Demo:** Invited org admin opens the activation link, sets their password, walks the wizard end-to-end (upload logo, fill location/description/contacts, pick currency/timezone); workspace header shows the org's logo; settings page edits persist.

## Phase 5 — Tenant-Scoped Auth & RBAC

**Build:** JWT login for internal users with claims `{ org_id, role }`; roles `org_admin` / `rep` / `manager` / `finance` / `ops`; route-level authorization middleware (role + tenant checks); org admin user-management screen (invite/deactivate users within their org); seeded users per role in two orgs.

**Demo:** Log in as each role in each org; each lands on a role-appropriate home showing only their org's branding/data; a rep from org A replaying their token against org B's data gets 403/404.

## Phase 6 — Product Catalog & Price Lists (Org Admin)

**Build:** Product categories (Hardware / Services / Subscriptions), product CRUD, customer tier definition, price lists per tier — all tenant-scoped. Org Admin UI for all of it.

**Demo:** Org Admin creates categories/products/tier prices for their org; a second org's admin sees a completely separate catalog.

## Phase 7 — Discount Rulebook & Approval Chains (Org Admin)

**Build:** Per-org discount ceiling matrix (customer tier × product category), per-org approval chain config (threshold → "Manager only" vs. "Manager → Finance"). Schema enforces `order_lines → products → categories → ceilings` joins within the tenant boundary.

**Demo:** Org A allows Gold×Hardware 20% with Manager-only approval; Org B allows 10% with Manager→Finance. Editing one org's rulebook never touches the other's.

## Phase 8 — Quotation Builder Core (Rep)

**Build:** Quotations + order lines in Postgres (tenant-scoped); rep picks a customer of their org, adds lines across the three categories, sets quantities, applies line-level and order-level discounts; totals computed server-side.

**Demo:** A rep builds a complete mixed quote from empty to priced; refresh shows it persisted; the same rep account can never see the other org's quotes in lists or by direct ID.

## Phase 9 — Live Pricing & Margin (Redis + Socket.IO)

**Build:** Redis cache for price-list lookups per tier and the in-progress quote's running totals — **all cache keys namespaced by org** (`org:{id}:pricelist:{tier}`); Socket.IO rooms per org (`org:{id}`) pushing total/margin updates to the builder UI on every keystroke-level edit.

**Demo:** Rep changes a quantity/discount and the margin indicator updates instantly; show Redis keys are org-namespaced and that two orgs' builder sessions receive only their own socket events.

## Phase 10 — Upsell / Cross-Sell Panel

**Build:** Per-org co-purchase history model + seed data, ranked suggestion query with per-suggestion margin delta, side panel in the builder, accept-suggestion flow updating the cart live over Socket.IO.

**Demo:** While building a quote, the panel shows ranked suggestions computed from *this org's* sales history with margin deltas; clicking "add" instantly updates cart, totals, and margin.

## Phase 11 — Blended Discount Risk Score Engine

**Build:** The governance core: every line checked against **its own category ceiling in its own org's rulebook**, aggregation across lines into a blended score, threshold bands mapping to routing decisions (none / Manager / Manager→Finance). Score recomputed on every edit and surfaced live in the builder.

**Demo:** Show three cases live: (a) a line slightly over its category ceiling gets flagged even though the customer's tier allows more overall; (b) several slightly-over lines trigger the aggregate threshold; (c) the identical quote in the other org with looser ceilings stays green — proving scores are computed per-org rules.

## Phase 12 — Approval Workflow & Audit Trail

**Build:** Approval routing per the org's chain config, approve/reject/edit actions with mandatory reason, immutable audit log (org, user, timestamp, action, reason), BullMQ-enqueued email notifications via Mailhog at every handoff, realtime status push to the rep.

**Demo:** Over-ceiling quote routes to that org's Manager; high-risk continues to that org's Finance; rep sees "Approved" appear without refresh; audit trail screen shows every step; Mailhog shows all handoff emails; super admin can read (not act on) any org's audit trail.

## Phase 13 — Customer Portal Shell (Separate Frontend)

**Build:** Second Vue app served by Nginx under portal routes; magic-link issuance via Mailhog; customer-scoped JWT carrying `{ org_id, quotation_ids }`; portal branding pulled from the issuing org's profile (logo/name); Nginx rules ensuring portal routes can never proxy to internal/admin endpoints.

**Demo:** Send a quote → customer opens magic link from Mailhog → sees a real, restricted portal view branded with the org's logo, showing only their quote; replaying the customer token against an internal API or another org's data fails.

## Phase 14 — Negotiation & Re-Approval Loop

**Build:** Line-by-line comments, change requests, counter-discount proposals, one-click confirm — and the critical rule: **confirmed terms that exceed thresholds re-enter Stage 3 automatically**, routed by the org's own chain config. `express-rate-limit` (Redis-backed, org+customer keyed) on all portal write endpoints.

**Demo:** Customer counters a discount above threshold → quote re-appears in their org's Manager approval queue (not silently accepted); hammering the confirm endpoint gets 429s.

## Phase 15 — Warehouses & Inventory (Org Admin/Ops)

**Build:** Per-org warehouse CRUD, stock levels per product per warehouse, shipping rules, Redis-cached live stock reads with org-namespaced keys.

**Demo:** Ops screen shows live stock for their org's warehouses served from cache; adjusting stock in admin reflects immediately; org A's warehouses never appear in org B's split proposals.

## Phase 16 — Fulfillment Split Proposal

**Build:** Allocation algorithm proposing a warehouse split from the org's own warehouses that minimizes shipment count/cost from live stock; Ops accept or manual override; fulfillment status tracking per line.

**Demo:** Approved quote → proposed split shown with rationale (shipments/cost); Ops overrides one line to a different warehouse; fulfillment status updates.

## Phase 17 — Backorders & Auto-Consolidation Job

**Build:** Backorder state on unfulfillable lines; stock-arrival event → BullMQ job (payload carries `org_id`) that finds that org's affected orders and raises a "Consolidate Remaining Backorder" prompt to Ops; worker liveness visible on a simple queue status view.

**Demo:** Create a backordered order, then simulate stock arrival → the consolidation prompt fires automatically (no one clicked anything); Ops consolidates and the split updates; a stock event in org A never touches org B's backorders.

## Phase 18 — Billing Engine: Mixed Orders & Schedules

**Build:** Order confirmation splits one-time vs. recurring lines; billing schedule generation job for subscriptions using the org's plans and currency; invoice records per schedule entry with org-branded numbering.

**Demo:** Confirm a mixed order → one-time invoice plus a multi-period billing schedule appears, each row correct per the org's plan rules and currency.

## Phase 19 — Proration & Credit Notes

**Build:** Mid-cycle quantity change → BullMQ proration job using the org's plan proration rules and timezone for cycle boundaries; automatic partial refund / credit note generation when the change reduces the charge.

**Demo:** Change a subscription quantity mid-cycle → prorated amounts recompute (cycle math respects the org's timezone) and a credit note is generated and visible on the invoice timeline.

## Phase 20 — Payment Gateway & Webhook DLQ

**Build:** Per-org gateway credentials (sandbox): direct charge for one-time lines, recurring charges via the gateway's subscription API, refunds tied to credit notes; webhook handler resolving the org from the payload and updating invoice status; failed webhook/payment jobs routed to a monitored Dead Letter Queue.

**Demo:** Record a payment → that org's invoice status flips to paid; force a webhook handler failure → the job lands in the DLQ view (with its `org_id` visible) instead of vanishing.

## Phase 21 — Deal Health Monitoring

**Build:** Scheduled BullMQ scans per org: stalled quotes (inactive > N days, evaluated in the org's timezone), discount anomalies (rep's current discount vs. their own historical average), delivery slippage. Alerts dashboard pushed over Socket.IO to the right org's room; click an alert → jump straight to the quotation; trigger nudge/escalation (email via Mailhog).

**Demo:** Seed a stalled deal and a discount-happy rep in org A → alerts appear only on org A's dashboard without refresh; clicking one opens the quote; sending a nudge lands in Mailhog; org B's dashboard stays clean.

## Phase 22 — Files & Reports (MinIO)

**Build:** PDF generation for quotations (portal-downloadable, org-branded with the onboarding logo) and invoices; report export to PDF/XLS; product images; all artifacts in MinIO under **per-org prefixes** with signed-URL access. Postgres remains the source of truth.

**Demo:** Customer downloads a quotation PDF carrying the org's logo; rep exports their org's deals report as XLS; MinIO console shows `org-{id}/...` prefixes; a signed URL from org A cannot be repurposed for org B's files.

## Phase 23 — Super Admin Platform Dashboard & Tenant Ops

**Build:** Cross-tenant overview for the Super Admin: org list with status, user counts, active-quote counts, job-failure counts per org; suspend/reactivate org; read-only drill into any org's audit trail; platform-wide DLQ view filterable by org.

**Demo:** Super Admin sees both orgs side by side with live counts; suspends one org → its users are locked out and its jobs pause, the other org is unaffected; reactivates and everything resumes.

## Phase 24 — Hardening & Full Multi-Tenant End-to-End Dry Run

**Build:** Queue-depth/worker-liveness health endpoint, DLQ alerting, operational logging separated from the business audit trail, rate-limit verification, cross-tenant isolation regression checks (automated tests asserting scoping on every module), and a seed script that sets up **two fully configured organizations** for the complete scripted scenario.

**Demo (the full test flow, twice — once per org):** One continuous run per org — Super Admin creates the org & invites the admin → org onboarding (logo/location/description) → rulebook config → Rep builds with upsells → risk score routes per that org's chain → approved → warehouse split (Ops override) → stock arrival consolidates a backorder → mixed billing schedule → mid-cycle proration with credit note → payment recorded and invoice status updates → customer counters and the quote re-enters approval → deal-health alert fires and gets nudged. Side-by-side screens show the two orgs fully isolated, and the Super Admin dashboard reflects both. Ops dashboard shows queues healthy throughout.

---

## Phase Map at a Glance

| # | Phase | Workflow Stage | Primary Actor |
|---|---|---|---|
| 1 | Foundation & Docker | — | System |
| 2 | Multi-Tenancy Core & Isolation | — | System |
| 3 | Super Admin & Org Management | — | Super Admin |
| 4 | Org Onboarding & Profile | Setup (org) | Org Admin |
| 5 | Tenant Auth & RBAC | — | All internal |
| 6 | Catalog & Price Lists | 1 | Org Admin |
| 7 | Discount Rulebook & Chains | 1 | Org Admin |
| 8 | Quotation Builder Core | 2 | Rep |
| 9 | Live Pricing & Margin | 2 | Rep |
| 10 | Upsell Panel | 2 | Rep |
| 11 | Blended Risk Score | 3 | System |
| 12 | Approvals & Audit | 3 | Manager/Finance |
| 13 | Portal Shell | 6 | Customer |
| 14 | Negotiation Loop | 6→3 | Customer/Manager |
| 15 | Warehouses & Stock | 1/4 | Org Admin/Ops |
| 16 | Fulfillment Split | 4 | Ops |
| 17 | Backorder Consolidation | 4 | System/Ops |
| 18 | Billing & Schedules | 5 | System |
| 19 | Proration & Credits | 5 | System |
| 20 | Payments & DLQ | 5+ | System |
| 21 | Deal Health | All | System/Rep |
| 22 | Files & Reports | All | All |
| 23 | Super Admin Dashboard & Tenant Ops | — | Super Admin |
| 24 | Hardening & Multi-Tenant E2E Demo | All | Everyone |

---

## Multi-Tenancy Rules That Apply to Every Phase

1. **Schema:** every business table has `organization_id NOT NULL` with an index; tenant-local foreign keys (e.g., `(organization_id, product_id)` references) wherever practical.
2. **API:** no handler queries without the tenant context middleware; super-admin endpoints live under a separate `/platform` namespace with its own guard.
3. **JWT:** internal tokens carry `{ org_id, role }`; customer tokens carry `{ org_id, quotation_ids }`; super admin tokens carry neither and only work on `/platform`.
4. **Redis:** every cache key prefixed `org:{id}:`; BullMQ payloads always include `org_id`; rate-limit buckets keyed by org + subject.
5. **Socket.IO:** one room per org; a connection joins only its token's org room.
6. **MinIO:** one prefix per org (`org-{id}/...`); signed URLs minted only after a tenant check.
7. **Jobs:** workers resolve the org's config (ceilings, plans, timezone, currency) from the payload's `org_id` — never from globals.
8. **Testing:** each feature phase ships at least one cross-tenant isolation check.
