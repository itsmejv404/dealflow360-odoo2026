# DealFlow360 — FastAPI + RabbitMQ Backend (`@dealflow/api-py`)

Modern, high-performance, asynchronous Python backend migrating DealFlow360's multi-tenant Quote-to-Cash engine from Node.js/Express to **FastAPI**, **SQLAlchemy 2.0 (Asyncpg)**, **RabbitMQ**, and **Celery**.

---

## 1. Stack & Architecture

- **Web Framework**: FastAPI 0.115+ (ASGI, Python 3.12, Uvicorn, Pydantic v2 settings & schemas).
- **ORM & Database**: SQLAlchemy 2.0 async engine with `asyncpg` driver connecting to PostgreSQL 16.
- **Message Broker & Task Queue**: RabbitMQ 3 (`amqp://guest:guest@rabbitmq:5672//`) with Celery 5.4.
- **Cache & Rate Limiting**: Redis 7 (`redis-py` async client).
- **Object Storage**: MinIO S3 client (`minio` SDK) with strict tenant bucket partitioning (`org-{id}/`).
- **Realtime WebSockets**: Python-SocketIO (`AsyncServer`) mounted as an ASGI app on `socket.io` for live CPQ quoting, approvals, and portal negotiation rooms.
- **PDF Generation**: Chromium rendering via Gotenberg.
- **Email Notifications**: Asynchronous SMTP client (`aiosmtplib`) via Mailhog.

---

## 2. Queue & Worker Architecture (RabbitMQ + Celery)

All background jobs have been migrated to RabbitMQ-backed Celery task queues:

| Queue Name | Celery Task Name | Description |
|---|---|---|
| `org_approval_notifications` | `src.tasks.approvals.notify` | Realtime email + Socket.IO notification when a quote triggers discount threshold approvals |
| `org_backorder_consolidation` | `src.tasks.fulfillment.consolidate` | Automatic order consolidation when backordered inventory arrives at warehouse |
| `org_billing_schedules` | `src.tasks.billing.generate_schedule` | Generates recurring invoice schedules (monthly/quarterly/annual) for confirmed orders |
| `org_proration_runs` | `src.tasks.billing.modify_quantity` | Mid-cycle subscription seat/quantity adjustments with exact daily proration |
| `org_deal_health_scans` | `src.tasks.dealhealth.scan_org` | Scans tenant quotes for margin slippage, stalling, and customer discount ceiling violations |

The Celery worker runs with concurrency 4 and listens to all queues:
```bash
celery -A src.lib.celery_app worker --loglevel=info -c 4 -Q default,org_approval_notifications,org_backorder_consolidation,org_billing_schedules,org_proration_runs,org_deal_health_scans
```

---

## 3. Directory Layout

```
apps/api-py/
├── Dockerfile                  # Python 3.12-slim production container
├── requirements.txt            # Python dependencies (FastAPI, Celery, SQLAlchemy, etc.)
├── test_e2e.py                 # Full 10-section end-to-end test suite
└── src/
    ├── main.py                 # FastAPI application, CORS, SocketIO ASGI mount, router registry
    ├── worker.py               # Celery worker entrypoint
    ├── database.py             # Async SQLAlchemy engine & session dependency (get_db)
    ├── config/
    │   └── env.py              # Pydantic BaseSettings loading environment variables
    ├── models/
    │   └── models.py           # 39 complete SQLAlchemy ORM models matching PostgreSQL schema
    ├── shared/
    │   ├── errors.py           # HttpError exception classes & JSON error handlers
    │   ├── jwt_utils.py        # HS256 JWT encoding/decoding & bcrypt password hashing
    │   └── tenant.py           # Multi-tenant context dependency, RBAC, Super Admin guards
    ├── lib/
    │   ├── celery_app.py       # Celery broker & queue routing configuration
    │   ├── redis.py            # Async Redis singleton client
    │   ├── minio_client.py     # MinIO S3 tenant-isolated storage client
    │   ├── socket.py           # Python-SocketIO async realtime server
    │   ├── mailer.py           # Async SMTP mailer client
    │   ├── gotenberg.py        # PDF generation client
    │   └── logger.py           # Structured logging
    ├── tasks/
    │   ├── approvals.py        # Approval & counter-proposal notification tasks
    │   ├── fulfillment.py      # Backorder auto-consolidation task
    │   ├── billing.py          # Recurring billing & proration calculation tasks
    │   └── dealhealth.py       # Deal health scanner task
    └── routers/
        ├── health.py           # GET /api/health (checks Postgres, Redis, MinIO, RabbitMQ)
        ├── auth.py             # POST /api/auth/login, me, logout, forgot/reset password
        ├── users.py            # GET/POST /api/users, invite, suspend, change role
        ├── organization.py     # GET/PATCH /api/organization, logo upload
        ├── onboarding.py       # GET/POST /api/onboarding, wizard completion
        ├── platform.py         # Super Admin endpoints: org creation, metrics, suspend
        ├── catalog.py          # Products, categories, customer tiers, pricelist, inventory
        ├── rulebook.py         # Approval chain configuration, discount ceilings
        ├── quotations.py       # CPQ quotation creation, line pricing calculation, confirm
        ├── approvals.py        # Approval requests, approve/reject workflow
        ├── negotiation.py      # Negotiation comments & counter-proposals
        ├── warehouses.py       # Warehouses & inventory stock management
        ├── fulfillment.py      # Fulfillment plan generation, pick/pack/ship dispatch
        ├── billing.py          # Invoices, split payment schedules, subscriptions, proration
        ├── dealhealth.py       # Deal health scores, alert scanner, actioning
        ├── files.py            # MinIO file upload/download signed URLs
        ├── portal.py           # Magic-link token authentication & customer quote acceptance
        ├── recommendations.py  # Product affinities & cross-sell recommendations
        ├── governance.py       # Audit logs & compliance exports
        └── demo.py             # Demo scenario reset triggers
```

---

## 4. Multi-Tenancy & Security Rules (AGENTS.md)

1. **Every Query Scoped by Tenant**: All database selects, inserts, updates, and deletes enforce `organization_id == tenant.organization_id`.
2. **Cross-Tenant Isolation**: Verified in Section 6 of `test_e2e.py`. Requests to another organization's quotes or resources return `403 Forbidden` / `404 Not Found`.
3. **Tenant-Isolated S3 Storage**: File keys prefixed `org-{organization_id}/` in MinIO.
4. **Tenant-Isolated Realtime WebSockets**: Socket.IO connections join `org:{organization_id}` and `quote:{quotation_id}` rooms with token authentication.

---

## 5. Verification Commands

Run the full end-to-end verification test suite:
```bash
npm run test:backend
# Or directly via docker compose:
docker compose exec -T api-py python test_e2e.py
```

View backend service logs:
```bash
npm run logs:backend
# Or:
docker compose logs -f api-py celery-worker rabbitmq
```
