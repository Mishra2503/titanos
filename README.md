# Titan OS

Multi-account Instagram creator-brand operations console. Built single-tenant first,
architected for multi-tenant SaaS later. Binding spec: [`../Titan_OS_PRD_v1.md`](../Titan_OS_PRD_v1.md).

> **Compliance rails (non-negotiable).** Official Meta Instagram Graph API only — no
> scraping, session-cookie auth, anti-detect browsers, proxies, or video "spinning".
> No secrets in the client. No fabricated analytics. RBAC enforced server-side.
> Rate limits respected; publishing worker idempotent.

## Monorepo layout

```
titan-os/
├── apps/
│   ├── api/        FastAPI backend (auth, RBAC, workspace model, Celery worker)
│   └── web/        Next.js (App Router, TS, Tailwind "Studio Terminal" UI)
├── docker-compose.yml   Postgres + Redis for local dev
└── .env.example         Backend env template (copy to apps/api/.env)
```

## Status — Phase 0 (infra skeleton + auth/RBAC)

Implemented:
- Email/password auth (argon2), JWT access+refresh, `/api/auth/{login,refresh,logout,me}`.
- OWNER/EDITOR RBAC enforced on the server (`require_role`).
- VA invite → accept → revoke flow (single-use hashed invite tokens).
- Workspace-scoped data model (`workspace`, `user`, `audit_log`) + Alembic migration + seed.
- Fernet helper for encrypting IG tokens at rest (used by Connections in Phase 1).
- Next.js shell: login, auth guard, dashboard (empty-state KPIs — no fabricated data), IA nav.
- Celery worker app + API Dockerfile.

Not yet built (next phases): Connections (IG OAuth), Scriptwriter, Bulk Scheduler +
publish pipeline, Insights, Content Library, Settings, GHL webhook.

## Local setup

### 1. Infra
```bash
cp .env.example apps/api/.env          # then fill in secrets
docker compose up -d                    # Postgres + Redis
```
Generate the crypto secrets and put them in `apps/api/.env`:
```bash
openssl rand -hex 32                                                   # -> JWT_SECRET
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # -> FERNET_KEY
```

### 2. Backend
```bash
cd apps/api
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
python -m app.scripts.seed --email you@example.com --password 'strong-pass'
uvicorn app.main:app --reload          # http://localhost:8000  (docs at /docs)
pytest                                  # run the test suite
```

### 3. Worker (separate process)
```bash
cd apps/api && source .venv/bin/activate
celery -A app.worker.celery_app.celery_app worker --loglevel=info
```

### 4. Frontend
```bash
cd apps/web
cp .env.example .env.local
npm install
npm run dev                             # http://localhost:3000
```

## Tests
```bash
cd apps/api && pytest          # backend (auth, RBAC, invite/revoke)
cd apps/web && npm run build   # frontend type-check + build
```
