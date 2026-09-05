# DealFlow360 — Seeded Credentials & Service Endpoints

This document contains all seeded user accounts, tenant organizations, and infrastructure service endpoints for testing and operating DealFlow360.

---

## 1. Platform & Super Admin (Cross-Tenant)

| Parameter | Value |
|---|---|
| **Role** | Platform Super Admin |
| **Email** | `superadmin@dealflow360.com` |
| **Password** | `SuperAdminSecret123!` |
| **Scope** | Cross-tenant `/platform/*` routes only (no `organization_id`) |
| **Auth Endpoint** | `POST http://localhost/platform/auth/login` |

---

## 2. Tenant Organizations & Seeded Admins

### Organization 1: Acme Corp (`acme`)

| Parameter | Value |
|---|---|
| **Organization Name** | Acme Corp |
| **Slug** | `acme` |
| **Status** | `active` |
| **Operating Currency** | `USD` ($) |
| **Timezone** | `America/New_York` (EST) |
| **Onboarding Status** | Completed (Logo uploaded to MinIO) |
| **Admin Name** | Alice Johnson |
| **Admin Email** | `admin@acme.com` |
| **Admin Password** | `AcmeAdmin123!` |
| **Admin Role** | `org_admin` |

### Organization 2: Globex Corporation (`globex`)

| Parameter | Value |
|---|---|
| **Organization Name** | Globex Corporation |
| **Slug** | `globex` |
| **Status** | `active` |
| **Operating Currency** | `EUR` (€) |
| **Timezone** | `Europe/Berlin` (CET) |
| **Onboarding Status** | Completed (Logo uploaded to MinIO) |
| **Admin Name** | Gerd Müller |
| **Admin Email** | `admin@globex.com` |
| **Admin Password** | `GlobexAdmin123!` |
| **Admin Role** | `org_admin` |

### Organization 3: Apex Dynamics (`apex`) — *Pending Onboarding Demo*

| Parameter | Value |
|---|---|
| **Organization Name** | Apex Dynamics |
| **Slug** | `apex` |
| **Status** | `active` |
| **Operating Currency** | `GBP` (£) |
| **Timezone** | `Europe/London` (GMT) |
| **Onboarding Status** | Pending (`onboardingCompleted: false`) |
| **Invited Admin Email** | `admin@apexdynamics.io` |
| **Activation Token** | `apex-onboarding-demo-token-1234567890` |
| **Direct Activation URL** | [http://localhost/activate?token=apex-onboarding-demo-token-1234567890](http://localhost/activate?token=apex-onboarding-demo-token-1234567890) |

> [!TIP]
> Open the **Direct Activation URL** above in your browser to walk through the live 3-step Onboarding Wizard (Logo upload $\rightarrow$ Profile details $\rightarrow$ Currency/Timezone).

---

## 3. Infrastructure Service Endpoints

| Service | Host Port | Internal Docker Port | Description / URL |
|---|---|---|---|
| **Nginx Reverse Proxy** | `80` | `80` | Primary Entrypoint: [http://localhost](http://localhost) |
| **Workspace Frontend (Vue 3)** | `5173` | `5173` | Internal App Shell: [http://localhost:5173](http://localhost:5173) |
| **API Modular Monolith** | `3000` | `3000` | Express REST API: [http://localhost:3000](http://localhost:3000) |
| **Mailhog Web UI** | `8025` | `8025` | Dev Email Catcher UI: [http://localhost:8025](http://localhost:8025) |
| **Mailhog SMTP Server** | `1025` | `1025` | SMTP Relay (`mailhog:1025`) |
| **MinIO Console** | `9001` | `9001` | S3 Storage Console: [http://localhost:9001](http://localhost:9001) (`minioadmin` / `minioadmin`) |
| **MinIO S3 API** | `9000` | `9000` | S3 API Endpoint (`minio:9000`) |
| **PostgreSQL 16** | `5432` | `5432` | Primary Relational DB (`dealflow` / `dealflow`) |
| **Redis 7** | `6379` | `6379` | In-Memory Cache & Queues |

---

## 4. How to Run & Verify

```powershell
# Re-run full database seed
docker compose exec -w /repo/apps/api api npm run seed

# Run cross-tenant isolation checks
docker compose exec -w /repo/apps/api api npm run test:isolation

# Run Super Admin & platform test suite
docker compose exec -w /repo/apps/api api npm run test:platform

# Run Onboarding & MinIO logo storage test suite
docker compose exec -w /repo/apps/api api npm run test:onboarding

# Run Tenant Auth & RBAC test suite
docker compose exec -w /repo/apps/api api npm run test:auth

# Typecheck all workspaces
docker compose exec api npm run typecheck
```
