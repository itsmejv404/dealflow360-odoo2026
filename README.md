# DealFlow360

## 🚀 Key Capabilities

- 🏢 **Strict Multi-Tenant Isolation**: Shared-schema, tenant-isolated architecture with `organization_id` row-level enforcement, org-namespaced Redis keys, tenant-scoped RabbitMQ / Celery queue payloads, and isolated MinIO S3 storage prefixes.
- ⚡ **Real-Time Quotation Builder**: Keystroke-level margin indicators, customer tier pricing, and instant upsell / cross-sell suggestions based on co-purchase history.
- 🛡️ **Discount Risk Score Engine**: Automated evaluation of line items against discount ceiling matrices (Customer Tier × Product Category), dynamically triggering dual-stage approval workflows (Sales Manager $\rightarrow$ Finance).
- 🤝 **Interactive Customer Portal**: Magic-link customer negotiation UI allowing line-by-line discussions, counter-discount proposals, automated approval re-entry on threshold breaches, and one-click confirmations.
- 📦 **Smart Warehouse Fulfillment**: Automated multi-warehouse split optimization minimizing shipment overhead, with Ops override capabilities and automated backorder consolidation upon stock arrival.
- 💳 **Mixed Billing & Subscription Engine**: Unified order processing supporting one-time charges, multi-period recurring schedules, timezone-aware mid-cycle proration, and automatic credit note generation.
- 📊 **Deal Health & Stalled-Deal Monitoring**: Scheduled automated scans detecting stalled deals, rep discount anomalies, and fulfillment slippage with live Socket.IO push alerts and email nudges.
- 👑 **Super Admin Platform Governance**: Global tenant provisioning, self-serve onboarding wizard invitation flows, tenant suspension/activation controls, and cross-tenant compliance audit logging.

---

## 🛠️ Architecture & Tech Stack

| Layer | Technologies |
|---|---|
| **Workspace Frontend** | Vue 3, Vite, shadcn-vue, Tailwind CSS v4, Reka UI, Lucide Icons |
| **Customer Portal** | Vue 3, Vite, Tailwind CSS (served under `/portal/` with scoped magic links) |
| **Backend Services** | Python 3.12 (FastAPI, Async SQLAlchemy, Pydantic) + Node 24 (Express, TypeScript, Prisma) |
| **Async Tasks & Queues** | Celery / RabbitMQ / Redis (tenant-scoped job payloads) |
| **Database & Cache** | PostgreSQL 16, Redis 7 (caching, pub/sub, rate limiting) |
| **Object Storage & Media** | MinIO S3 (`org-{id}/` prefixes with signed URL security) |
| **PDF Generation** | Gotenberg 8 (Chromium headless engine for quotation & invoice rendering) |
| **Email & Routing** | Mailhog (SMTP email catcher & inbox UI), Nginx Reverse Proxy |
| **Containerization** | Docker Compose with hot reload across all services |

---

## 🌐 Service Map & Endpoints

All web services are unified behind the **Nginx Reverse Proxy** on port `80`:

| Endpoint / URL | Service Description | Credentials / Scope |
|---|---|---|
| **[http://localhost](http://localhost)** | **Sales Workspace SPA** (Internal Sales & Operations) | Org Users (e.g., `admin@acme.com`) |
| **[http://localhost/platform](http://localhost/platform)** | **Super Admin Platform Portal** | Platform Super Admin |
| **[http://localhost/portal/](http://localhost/portal/)** | **Customer Portal** | Magic Link / Customer Token |
| **[http://localhost/api/health](http://localhost/api/health)** | **API Health Check** (Postgres, Redis, RabbitMQ, MinIO) | Public |
| **[http://localhost:8025](http://localhost:8025)** | **Mailhog Web UI** (Email Inbox for invites, alerts & quotes) | Dev Tool |
| **[http://localhost:9001](http://localhost:9001)** | **MinIO Console** (S3 Storage Explorer) | `minioadmin` / `minioadmin` |
| **[http://localhost:15672](http://localhost:15672)** | **RabbitMQ Management Dashboard** | `guest` / `guest` |
| **[http://localhost:3001](http://localhost:3001)** | **Gotenberg API** (PDF Generation Engine) | Internal Service |

---

## ⚡ Quick Start

### 1. Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (v20+ with Compose v2)
- Node.js 20+ (optional, for local workspace tooling)

### 2. Setup & Boot Stack
```powershell
# 1. Copy environment variables
Copy-Item .env.example .env

# 2. Boot all services via Docker Compose
docker compose up -d --build

# 3. Follow SETUP.md for first-time DB initialization and migrations:
npm run migrate:deploy
```

### 3. Verify Health
Visit [http://localhost/api/health](http://localhost/api/health) to ensure all services (`postgres`, `redis`, `rabbitmq`, `minio`) report `healthy`.

---

## 🧪 Testing & Verification

```powershell
# Run full Backend E2E test suite
npm run test:backend

# Run Cross-Tenant Isolation checks
docker compose exec -w /repo/apps/api api npm run test:isolation

# Run Super Admin & Platform tests
docker compose exec -w /repo/apps/api api npm run test:platform

# Run Tenant Auth & RBAC checks
docker compose exec -w /repo/apps/api api npm run test:auth

# Typecheck all frontend and backend workspaces
npm run typecheck
```

---

## 📁 Repository Structure

```
dealflow360/
├── apps/
│   ├── api/            # Express + TypeScript modular monolith (Legacy API & Migration Tooling)
│   ├── api-py/         # FastAPI + SQLAlchemy async service + Celery worker backend
│   ├── workspace/      # Vue 3 + shadcn-vue Internal Sales Workspace SPA
│   └── portal/         # Vue 3 + Tailwind Customer-facing Negotiation Portal SPA
├── infra/
│   └── nginx/          # Unified reverse proxy routing configuration
├── packages/
│   └── tsconfig/       # Shared TypeScript configuration presets
├── creds.md            # Detailed seeded credentials reference
├── milestones.md       # 24-phase product roadmap and milestone verification guide
├── workflow.md         # Product workflow specifications and state machine definitions
├── SETUP.md            # Manual setup & deployment instructions
└── docker-compose.yml  # Docker multi-container orchestration
```

---

## 🔒 Multi-Tenancy Principles

1. **Explicit Scoping**: Every database entity includes an indexed `organization_id` foreign key.
2. **Context-Aware Middlewares**: APIs derive tenant context strictly from verified JWT claims (`{ org_id, role }`). Super Admin routes operate in an isolated `/platform` namespace.
3. **Data Cache Namespacing**: All Redis keys are formatted with `org:{org_id}:...`.
4. **Queue Isolation**: Celery and BullMQ task payloads mandate explicit `org_id` parameters to ensure workers execute under tenant-specific rulebooks.
5. **Storage Sandboxing**: MinIO assets are organized by tenant prefix (`org-{org_id}/...`) and delivered exclusively via time-limited presigned URLs.