> **English edition** — machine-assisted translation, unified by the i18n PM. **The Chinese original governs.**
> Source: `README.md`, `llms.txt` · Source baseline: 2026-10-15 · Glossary: [GLOSSARY.md](../GLOSSARY.md) · Governance: [README.md](../README.md)

# RongQi (ybkk-AIOS) — Enterprise AI Resource Management Platform


## 1. What is RongQi?

**RongQi** (original Chinese brand: 元冰可; product code name **ybkk-AIOS**) is a self-hosted, enterprise-grade AI resource management platform built on the **DeepSeek Harness (dsh)** "Everything is a plugin" architecture. It brings six classes of AI assets under one governance plane:

- one identity system (Identity & Access Management, IAM, with OIDC SSO),
- one permission model (permission points registered in a unified RBAC),
- one usage meter (transparent usage metering with a zero-price snapshot price book),
- one audit trail (four audit log classes with alert rules and mandatory L4 approvals).

The six managed asset types are: **MCP deployment services, skills, agents, AI applications, model routes, and NAS file storage**. Around them the platform ships services for workflow orchestration, a data asset domain, an Execution Hub, a digital worker (workforce) domain, SaaS connector governance, a plugin/skill marketplace, and a Model Access Gateway.

### 1.1 Key engineering facts

- **Self-hosted.** The platform runs inside your enterprise boundary; business data never leaves it. Business configuration is stored as JSON collections with atomic persistence; metering and usage-report data live in SQLite (`data/txnstore.db`, WAL + transactions + idempotency-unique indexes).
- **Node ≥ 22.6, no build step.** The server runs native TypeScript (`npm install && npm start`); there is no separate build pipeline. (`node:sqlite` reports "Experimental" under Node 24; harmless.)
- **Agent-operable.** The platform is itself an MCP server (`POST /mcp`, Streamable HTTP JSON): 40+ operations tools (as of the latest release) are open to any MCP client such as ZCode, Claude, or Cursor, reusing Bearer tokens and per-tool permission points.
- **Real transports, no silent mocks.** MCP execution uses real HTTP JSON-RPC (`exec: real`); a `demo` transport exists only as an explicitly labeled degraded mode. The DingTalk connector likewise supports a real OpenAPI mode, and its mock fallback is flagged `mock: true` in health checks. The model gateway refuses to call models without a configured endpoint rather than fabricating completions.

### 1.2 Design lineage

The platform implements the internal design scheme "Enterprise Service Resource Unified Management Scheme V1.0" and its technical implementation plan (Chinese, internal). The ecosystem evolution baseline is `docs/ecosystem-design-v1.2.md` (internal Chinese archive) — **its wallet / resale / revenue-share commercialization chapters were deprecated by M0 (2026-09-09)** and must not be quoted as active plans; see [Section 5](#5-usage-transparency-and-the-m0-compliance-posture). This English overview is a restructured edition of the repository root `README.md`; the Chinese original governs.

### 1.3 State of the current baseline (2026-10-15)

The latest batches closed the digital-worker loop and a round of review hardening: the workforce domain gained a trusted-risk registration flow for MCP tools, REST/Panel invocation-surface parity, usage-reporting-on-behalf whitelisting, and a `workforce.admin` operations surface; the review-remediation batch added organization-isolation fail-closed semantics, per-tool minimal-permission declarations across the whole tool surface, a budget guard on model-channel fallback chains, and whitelist-based `/docs` publishing. Six-gate verification on that baseline: lint green · selftest ≥ 1,380 · drill ≥ 37 (as of the latest run). Earlier milestones — the Execution Hub, App SSO, NAS, connectors, and M0 itself — are in [Section 9](#9-release-history).

## 2. At a glance

RongQi's surface area is easiest to absorb in three tables: the six asset types it manages, the platform services wrapped around them, and the mapping from the original design scheme to shipped implementation.

### 2.1 Six managed asset types

| Asset type | Plugin package | What the platform provides |
|---|---|---|
| MCP deployment services | `dsh-plugin-mcp` | draft → validate → canary → full rollout; immutable releases; one-click rollback; token gateway (permission groups, per-tool granularity, read-only constraints); health-based circuit breaking with a shared failure counter; P95 monitoring over a real HTTP JSON-RPC transport |
| Skills | `dsh-plugin-skillhub` | submit → static scanning (automatic rejection of malicious code / leaked secrets) → two-tier approval → versioned publishing; Ed25519 contract signature verification; skill packages can be stored directly on onboarded NAS (fail-closed on upload failure) |
| Agents | `dsh-plugin-agent` | agent registry with machine credentials, user binding, on-behalf-of token chains, autonomy levels (A0–A3), agent-to-agent (A2A) named invocation, organizational attributes (orgRole / rank / managerId), five-tier health scoring |
| AI applications | `dsh-plugin-app` | application registry, orchestration topology (single SVG view), PV/UV/DAU metrics (active reporting + a public visitor beacon), OIDC SSO onboarding with a two-checkpoint app go-live gate, lifecycle L4 approvals |
| Model routes | `dsh-plugin-modelgw` | Model Access Gateway (modelgw): OpenAI-compatible real forwarding, tiered routing, channel-group fallback chains, budget circuit breakers, honest omission of TTFT telemetry (explicitly not reported) |
| NAS file storage | `dsh-plugin-nas` | NAS asset onboarding through an MCP file gateway (no direct DSM private API calls), one-click `mcpServers` JSON import, organization-location + role-hierarchy RBAC, HMAC-signed download URLs, file ownership tracking |

### 2.2 Platform services

| Capability | Plugin package(s) | Summary |
|---|---|---|
| Identity & Access Management (IAM) | `dsh-plugin-iam` | multi-level organization tree, roles / user groups, permission-point matrix, DingTalk connector with scheduled auto-sync, all-staff roster API (`GET /api/iam/roster`, PII-minimized), app org-sync (`GET /api/apps/:id/org-sync`) |
| Unified Authentication & SSO | `dsh-plugin-authn` | dual-track identity, OIDC Provider (RS256 / JWKS / PKCE S256 / refresh-token rotation / end_session / revoke), owner self-service credential issuance, DingTalk passwordless login |
| Workflow orchestration (flow-core) | `dsh-plugin-flow-core` | TF orchestration + step state machine, template library / contextPack, SLA and progress, Gantt timeline (`/api/flow/*`, `flow.*` events on the bus and Panel SSE) |
| Data asset domain | `dsh-plugin-flow-core` domain set | dataset registration, four-dimension quality score, reverse lineage tracing, metric dictionary definition arbitration |
| Execution Hub | `dsh-plugin-exec-hub` | goal alignment (`exec:goals` goal tree → projects → issues), 30 s heartbeat loop with a governance pre-check chain, issue execution locks (CAS) with zombie-lock reclamation, routine scheduling (interval / cron / webhook) |
| Workforce domain (digital workers) | `dsh-plugin-workforce` | worker profiles, appointment version state machine, short-term work permits, controlled-invocation ledger across four gateways, delivery-to-human-acceptance loop |
| Usage metering & FinOps | `dsh-plugin-usage` | schema v1 idempotent pipeline (dead-letter replay, consumption idempotency), zero-price snapshot price book, third-party reconciliation, capability drift detection, cost pass-through reports including cost per DAU; event retention default 730 days (`USAGE_RETENTION_DAYS`, `0` = permanent) |
| Connector governance | `dsh-plugin-connector` | SaaS data plane via the open-connector sidecar (1,000+ provider catalog, OAuth proxy, credential vault), two-layer authorization mirror on the platform side, metering reconciliation |
| Audit & alerting | `dsh-plugin-audit` | four audit log classes, alert rule engine, unauthorized-access counting alerts, L4 mandatory approvals (go-live / offline / delist / revoke; single approver executes, result written back), Approval Center（审批中心） |
| Plugin / skill marketplace | `dsh-plugin-market` | third-party and first-party publishing: five-face contract, Ed25519 verification, L0 declarative runtime, versioned publishing — see [dsh-ecosystem.md](dsh-ecosystem.md) |
| Remote dsh access | `dsh-plugin-connect` | enrollment-code onboarding for remote dsh hosts, one-time codes (hashed, single-use, TTL, failure lockout), remote proxying of operations tools, heartbeats, client revocation |
| Platform self-update | `dsh-plugin-update` | upstream version check (automatic + manual), Console one-click upgrade for source checkouts, dry-run preview, audit trail, optional signed release manifests |
| Portal data channel | `dsh-plugin-portal` | non-core, unauthenticated read-only pull endpoint for enterprise portals (CORS + visibility logging; `PORTAL_SYNC=off` disables) |

### 2.3 Capability mapping (scheme → implementation)

The root README maintains a mapping from the design scheme's clauses to shipped implementation. The headline rows:

| Scheme item | Shipped as |
|---|---|
| Organizations / accounts / roles / user groups | multi-level org tree, bulk import, account state machine, dynamic + static user groups, permission-point matrix |
| Third-party directory sync | connector interface + DingTalk connector (real OpenAPI or labeled mock), scheduled auto-sync, three conflict strategies, diff-based conflict tickets |
| Unified authentication | dual-track identity, HMAC short-term tokens (default 2 h), revocation/rotation, Client Credentials, machine-credential scope editing and secret rotation (with linked token revocation) |
| on-behalf-of | user → agent token chains (act stacking), full-chain audit reconstruction |
| MCP deployment / canary / rollback | draft → validate → canary → full rollout, immutable versions, one-click rollback |
| MCP token gateway | unified authz (permission groups + tool granularity + read-only constraints), rate limiting, circuit breaking, P95 / success-rate / token monitoring |
| Skill marketplace | static scanning, two-tier approval (high-risk security co-sign), versioning, install dependency registration, deprecation alerts |
| Agent registry | three attribute groups (basic / technical / governance), machine credential issuance, user binding, monitoring metrics, lifecycle L4 |
| AI application registry | app schema, orchestration topology, DAU/retention, cost pass-through |
| App SSO onboarding | OIDC Provider browser authorize flow, owner self-service issuance, go-live gate at two checkpoints, refresh / end_session / revoke, instant invalidation on freeze |
| Security & audit | four log classes, alert rule engine, unauthorized-access counting alerts, multi-dimension cost reports |
| L4 guardrails | mandatory approval tickets for go-live / offline / delist / revoke; single qualified approver executes; result written back |

### 2.4 Numbers worth knowing

All figures are as of the 2026-10-15 source baseline; counts marked with an asterisk are "as of the latest run" by design.

- **25** plugin entries in one dsh bundle install; **9** domain operations skills.
- **82** registered MCP-facing tools, each with a declared minimal permission point*; the `console.login` baseline on `/mcp` tools/call is a fail-safe for undeclared tools only.
- Quality gates: `npm run selftest` ≥ **1,380** assertions*, independent full-chain drill ≥ **37** steps*, `npm run lint:manifests` zero red.
- Usage event retention default **730** days; login/SSO failure lockout **5 failures / 15 minutes** per source with escalation up to 24 h; OIDC tokens **2 h** access / **7 days** refresh by default.
- Internal cost figures are references in CNY only; no settlement amounts exist anywhere.

## 3. Quick start

```bash
npm install          # install dependencies (includes @deepseek-ai/cordis)
npm start            # start the platform (default http://127.0.0.1:7300)
```

Open **http://127.0.0.1:7300** to reach the management Console（控制台）. On first boot against an empty data directory the platform performs a **baseline initialization** (production shape): built-in roles + root organization + platform administrator `admin`, with no demo business data.

Evaluation shortcut — demo mode (evaluation/training only):

```bash
DEMO_SEED=1 npm start   # seeds a demo organization tree, demo accounts, MCP/Skill/Agent/app data, and 28 days of history
```

Never enable `DEMO_SEED=1` in production. The full quick start — prerequisites, both install forms, first-login walkthrough, demo accounts, quality gates, CLI first steps, and self-update basics — is in [Getting Started](getting-started.md).

Verify a fresh install:

```bash
curl -s http://127.0.0.1:7300/api/health            # expected: {"status":"ok",...}
npm run selftest && npm run lint:manifests          # quality gates (isolated instance, no production data touched)
```

The `/docs` path publishes a whitelist of documentation files over HTTP — for example `curl http://localhost:7300/docs/app-sso-integration.md` — so integration guides are readable straight from a running instance.

## 4. Architecture: "Everything is a plugin"

A running RongQi instance is a **cordis plugin tree** (the same plugin framework as dsh, `@deepseek-ai/cordis`). Every business domain is one plugin package that independently declares its dependencies, permission points, and events, and can be started and stopped independently.

**Plugin collaboration rule:** every state change emits an event; cross-plugin integration happens only through the event bus or extension points (`ctx.platformBus`) — plugins never reach into each other's data. Examples: `iam.user.frozen` → authn revokes all tokens; `agent.offlined` → credentials revoked + bound users notified; `skill.deprecated` → referencing agents alerted; `mcp.unhealthy` → circuit breaking + audit.

### 4.1 The plugin tree

Package names are code identifiers and are preserved verbatim; descriptions are translated.

```text
Access layer
  dsh-plugin-console          REST gateway + Console SPA + tool bridge + seed data
  dsh-plugin-dsh-bridge       Host bridge: mounts the RongQi data plane (REST / Console SPA /
                              docs / MCP) into the dsh webServer under the /rq prefix —
                              the dsh web port becomes the single entry point
  dsh-plugin-panel-core       Department Agent workbench Panel (面板): /panel SPA + /api/panel/* REST + SSE
  dsh-plugin-dingtalk-bridge  DingTalk bridge (group bridge / outbound delivery / approval push / alert channel)
  dsh-plugin-rq-card          In-session injected cards (four-state execution card with thumbs-up /
                              thumbs-down feedback bar; dsh.client dual-sided plugin)

Business domains
  dsh-plugin-iam              Organizations / accounts / roles / user groups / third-party connectors (DingTalk demo)
  dsh-plugin-authn            Dual-track identity + tokens + on-behalf-of chains
  dsh-plugin-mcp              Deployment / canary / rollback / health circuit breaking / permission
                              groups / invocation gateway / monitoring (real HTTP transport)
  dsh-plugin-nas              NAS file-storage asset onboarding (MCP file-gateway channel /
                              organization-location RBAC / signed download URLs / direct skill-package upload)
  dsh-plugin-skillhub         Submit → static scanning → two-tier approval → versioned publishing
  dsh-plugin-agent            Agent registry (resource-core foundation + machine credentials)
  dsh-plugin-app              AI applications (orchestration topology + app metrics + cost pass-through)
  dsh-plugin-usage            Metering pipeline (schema v1 / idempotency / dead-letter replay /
                              price book / third-party reconciliation / capability drift)
  dsh-plugin-modelgw          Model Access Gateway (OpenAI-compatible real forwarding /
                              zero-price snapshot metering / internal cost reference)
  dsh-plugin-connector        SaaS connector governance (open-connector sidecar as data plane:
                              provider catalog / OAuth proxy / credential vault / two-layer
                              authorization mirror / metering reconciliation)
  dsh-plugin-market           Third-party and first-party plugin marketplace (five-face contract /
                              Ed25519 verification / L0 runtime / zero-price metering declarations)
  dsh-plugin-audit            Four audit log classes + alert rules + cost roll-up + Approval Center（审批中心）
  dsh-plugin-connect          Remote dsh access (host role: enrollment codes / enroll / client
                              management; client role: credential application + remote tool
                              proxying + local configuration page)
  dsh-plugin-update           Platform self-update: upstream version check (auto + manual) →
                              notification → one-click upgrade for source checkouts
                              (git pull + npm install; dry-run / audit / permission points)
  dsh-plugin-portal           Portal data channel (non-core: unauthenticated read-only pull of
                              published apps / agents / skills for enterprise portals;
                              CORS + visibility logging; PORTAL_SYNC=off disables)
  dsh-plugin-flow-core        Workflow orchestration (TF orchestration + step state machine /
                              template library contextPack / SLA & progress / Gantt timeline)
  dsh-plugin-exec-hub         Execution Hub (goal lineage / heartbeat wake-ups / issue execution
                              locks CAS / routine scheduling)
  dsh-plugin-workforce        Workforce domain (digital workers: profiles / appointments / permit
                              work authorization / controlled invocation / delivery acceptance)

Foundation
  dsh-plugin-resource-core    Resource registry: attribute schema + lifecycle state machine + dependency graph

Base layer
  dsh-plugin-platform-core    Storage (JSON collections / atomic persistence) + SQLite transactional
                              store + YAML parsing + event bus + ToolRuntime-lite + HTTP
```

A bundle installation into dsh mounts all **25 plugin entries** in one command; the repository also ships 9 domain operations skills (`skills/dsh-ops-*/SKILL.md`, including the `dsh-ops-admin` master index).

### 4.2 One codebase, multiple host forms

| Form | Process | Entry point | Typical use |
|---|---|---|---|
| A. Independent host (default) | `node src/main.ts` (i.e. `npm start`) | platform's own port, default 7300 | minimal enterprise production; human operators in the Console |
| B. Independent host + dsh runtime | Form A + `dsh web --patch cordis.yml` (same `data/` directory) | both ports | agent-driven operations: operations tools surface in dsh's native ToolRuntime and become callable by models in natural language |
| C. Remote dsh access | Form A host + remote computers install the bundle from the plugin marketplace | remote dsh + one-time enrollment code | multi-site teams operating one platform without source checkouts or shared data directories |

In form B, the `dsh-plugin-dsh-bridge` host bridge mounts the RongQi data plane (REST / Console SPA / docs / MCP) under the **`/rq` prefix** of the dsh webServer, so the dsh web port becomes the single entry; the platform's own HTTP port can be turned off with `startHttp: false`. Ecosystem mechanics (plugin anatomy, marketplace, single-cordis-instance constraint) are covered in [DSH ecosystem](dsh-ecosystem.md); deployment runbooks are in the internal Chinese doc `docs/deploy-enterprise.md`.

### 4.3 Console interaction principles

The Console（控制台）follows a Feishu-style interaction model:

- a **Cmd+K command palette** for searching resources (skills / agents / apps / MCP), jumping to pages, and running high-frequency actions;
- **role-based workbenches** combining pending approvals, alerts, event streams, and cost trends;
- **task-oriented navigation** organized by "what do you want to do" (marketplace / registries / governance / organization);
- **right-side drawers for all details** — agent and app details carry six tabs (overview / monitoring / permissions / topology / audit / lifecycle);
- **progressive forms** that create drafts from a minimal required set and enforce governance attributes before go-live;
- **danger-operation reversibility cues**: dry-run impact preview, L4 approval timelines, mandatory reasons;
- empty states that act as onboarding, a unified badge system, red/green health lights, canary progress bars, and dependency-free SVG charts.

### 4.4 Storage and resilience notes

- Corrupt JSON collection files are automatically backed up as `*.corrupt-*` with an explicit alert, instead of being silently treated as empty.
- Authentication-critical collections (tokens, principals, lockout counters) are persisted and fsynced immediately; a crash after a 200 response to logout / revoke does not lose the state.
- Metering consumption is engine-level idempotent (unique index on the consumption watermark): replays and dead-letter redelivery produce zero duplicate side effects.

### 4.5 Remote dsh access, in short

Form C deserves one paragraph here because it changes the operating model: any computer running dsh can install the RongQi bundle from the plugin marketplace and enroll to your host with a **one-time enrollment code** (hashed storage, single use, configurable TTL, per-IP failure lockout). Its operations tools are then proxied to the host under a permission template (`readonly` / `operator` / `full`), heartbeats keep the host's **Platform Access（平台接入）** page informed, and disabling a client revokes all of its machine tokens immediately. No source checkout, no shared data directory, and machine credentials never leave the remote machine (stored with `0600` permissions). The full flow is in [dsh-ecosystem.md §3.4](dsh-ecosystem.md) and the internal runbook `docs/deploy-enterprise.md`.

## 5. Usage transparency and the M0 compliance posture

**M0 (September 9, 2026) is the platform's compliance reset, and it is a red line for all external communication.** M0 abolished usage-based charging, resale, and revenue sharing. Concretely:

- The price book is a **zero-price snapshot (charge always 0)** on the list side; the cost side keeps an **internal procurement cost reference** (in CNY) for the enterprise's own FinOps analysis only.
- The former wallet / revenue-share subsystem (`plugin-billing`) has been **decommissioned and sealed**: its APIs, permission points, and wallet/budget/ledger features were removed; its historical transaction export is archived read-only for 90 days (internal register `docs/billing-archive-register.md`).
- The external posture is **transparent usage metering + internal cost pass-through**. The platform presents no monetary settlement semantics anywhere: no wallets, no top-ups, no splits, no chargeable events.

### 5.1 What you get instead

- The J4 monthly usage report (`GET /api/usage/report/monthly`, permission point `usage.read`) aggregates usage by department / agent / skill tokens with CSV self-service export.
- FinOps report v1 adds a department × model cost cross-matrix, month-over-month comparison, top consumers, and idle-run detection v1 — explicitly labeled as an approximate heuristic requiring human review, not a performance-scoring instrument. The Console page is **FinOps View（财务视图）** (`#/finops`).
- The **Asset Operations（资产运营）** console page inventories all five registry asset types (MCP / agent / app / skill / model routes) with ownership, health, recent invocations, one-click health inspection, cost pass-through by principal, and retire-reason analysis.
- Usage events are retained 730 days by default (`USAGE_RETENTION_DAYS`, `0` = permanent).

### 5.2 Honesty in engineering

- TTFT is deliberately not reported (honest omission of TTFT telemetry) rather than estimated.
- The model gateway forwards only to configured endpoints; a missing endpoint is a refused call, never a fabricated completion.
- Test stubs are in-process real HTTP services, not mocks; selftest asserts real round-trips and real error paths.

What this means for evaluators: you get complete visibility of who used what, how much, and what it internally cost the organization — without the platform acting as a billing system.

### 5.3 What M0 changed for integrators

Custom integrations written against pre-M0 builds must migrate off the removed settlement surface (full contract-change list in the M0 release notes, internal Chinese):

| Removed (pre-M0) | Replacement |
|---|---|
| wallet / recharge / budget / settle / ledger endpoints | none — settlement semantics abolished; usage questions go to `GET /api/usage/report/monthly` (J4) and `GET /api/usage/events` |
| `billing.read` / `billing.write` / `billing.admin` permission points | removed (ignored if present in legacy roles) |
| `wallet.balance.changed` / `billing.ledger.settled` events | no producers; remove subscriptions |
| modelgw response fields `chargeCents` / `balanceAfterCents` | `costCents` (internal procurement cost reference) only |
| marketplace plugin `billing` field | `metering: { usageKey, unit }` (meter keys only, no amounts) |

For metering callers: usage records must carry a meter key registered in the price book (`mcp:*` uses `tokens`, `model:*` uses `output_tokens`); mismatches are hard-rejected with the expected key stated in the error message — there is deliberately no silent zero-rate fallback.

### 5.4 Reporting endpoint map

| Endpoint | Permission point | Content |
|---|---|---|
| `GET /api/usage/report/monthly?month=YYYY-MM[&format=csv]` | `usage.read` | J4 monthly usage report: department / agent / skill token aggregation, CSV export |
| `GET /api/finops/overview?month=YYYY-MM&window=<minutes>` | `usage.read` | cost penetration + idle-run detection in one call |
| `GET /api/finops/idle?month=YYYY-MM&window=<minutes>` | `usage.read` | idle-run detection standalone (window 1–1440 minutes) |
| `GET /api/finops/report/monthly?month=YYYY-MM[&format=csv]` | `usage.read` | CFO cost report; CSV uses an Excel-friendly UTF-8 BOM |
| `GET /api/assets/benefit` | (asset ops) | usage + internal cost reference per asset; cost per DAU for app-type assets |

All monetary fields in these reports are the internal procurement cost reference (CNY); the list side is the zero-price snapshot with `charge` always 0.

## 6. Commercial model

RongQi is **priced by "team + domain assets"**, not as a platform-level bundle: pricing follows the size of the activated team and the selected domain asset packs (industry knowledge-graph packs / scenario packs). Manufacturing customers can alternatively adopt **on-premises (private) delivery as a project-based engagement**.

Commercial terms are a matter of your agreement with the vendor. Inside the product there are no monetary settlement semantics (see [Section 5](#5-usage-transparency-and-the-m0-compliance-posture)); usage and internal-cost reporting remain the only in-product money-adjacent surfaces, and cost figures are internal procurement references in CNY.

## 7. Documentation index

### 7.1 English edition (docs/i18n/en/)

| Document | Content |
|---|---|
| [README.md](README.md) | this document: product overview, architecture, compliance posture |
| [product-introduction.md](product-introduction.md) | positioning one-pager for marketing / sales enablement |
| [getting-started.md](getting-started.md) | quick start, first boot, demo mode, quality gates, CLI |
| [dsh-ecosystem.md](dsh-ecosystem.md) | DSH ecosystem: plugin framework, host bridge, marketplace, governance |
| [user-guide.md](user-guide.md) | feature usage guide across all domains |
| [deploy-enterprise.md](deploy-enterprise.md) | enterprise deployment and dsh onboarding runbook |
| [app-sso-integration.md](app-sso-integration.md) | AI application SSO onboarding guide |
| [usage-reporting.md](usage-reporting.md) | usage transparency and FinOps reporting (J4) |
| [release-notes-summary.md](release-notes-summary.md) | release history summary from M0 to the latest batch |

Translations are machine-assisted and unified by the i18n PM; the Chinese originals govern. The governance model, language tiers (English and Japanese as Tier 1 full editions; de / fr / es / pt / hi one-pagers as Tier 2), and per-market adaptation notes live in [../README.md](../README.md).

### 7.2 Authoritative internal documents (Chinese, not translated)

These are the governing sources. If any English page conflicts with them, the Chinese original wins.

| Document | Status | Content |
|---|---|---|
| [README.md](../../../README.md) (repo root) | current | product panorama, plugin architecture, capability mapping (Chinese) |
| [llms.txt](../../../llms.txt) | current | machine-readable capability digest (bilingual lead-in) |
| `docs/协议键中文对照总表.md` | current | authoritative Chinese gloss for every ASCII protocol key (R10, 280 keys) |
| `docs/release-notes-2026-09-09-m0.md` | current for M0 scope | M0 compliance reset: contract change list, decommissioned wallet/billing APIs |
| `docs/release-notes-2026-09-16-m2.md` | current for M2 scope | FinOps report v1, first-boot experience, contract additions |
| `docs/deploy-enterprise.md` | current | enterprise deployment runbook and dsh onboarding (Chinese) |
| `docs/app-sso-integration.md` | current | AI application SSO onboarding guide (Chinese) |
| `docs/ecosystem-design-v1.2.md` | **archive** | ecosystem design baseline; its wallet / resale / revenue-share chapters are **deprecated by M0** (see its warning banner) and must not be quoted as active plans |

### 7.3 Suggested reading paths

- **Evaluating the product?** [product-introduction.md](product-introduction.md) → this document → [release-notes-summary.md](release-notes-summary.md); then run the demo (`DEMO_SEED=1`, see [getting-started.md](getting-started.md)).
- **Deploying it?** [getting-started.md](getting-started.md) → [deploy-enterprise.md](deploy-enterprise.md) → [dsh-ecosystem.md](dsh-ecosystem.md) (if mounting into dsh).
- **Integrating an application?** [getting-started.md](getting-started.md) → [app-sso-integration.md](app-sso-integration.md) → [usage-reporting.md](usage-reporting.md).
- **Operating it day to day?** [user-guide.md](user-guide.md), with this document's Sections 5 and 8 as the compliance reference.

## 8. Governance and boundaries

### 8.1 Interface language note

As of the 2026-10-16 release, the runtime UI — Console（控制台）, Panel（面板）, Portal（门户）, CLI output, notifications and approval texts, and error messages — ships with a built-in language switcher: Simplified Chinese (default), English (US), and Japanese. Switch via the top-bar language selector; the preference is stored in the browser (`rq_lang`). The CLI follows `--lang` or `DSHCTL_LANG`. Any string not yet covered by a dictionary gracefully falls back to Chinese. The bilingual 'English（中文原文）' annotations in this guide remain useful for navigating screenshots, on-prem deployments pinned to Chinese, and protocol-adjacent labels — e.g. **Organization & Accounts（组织与账号）→ Account Details（账号详情）→ Reset Password（重置口令）**; browser page translation also still works on the plain-DOM UI.

Platform logs carry server-local timestamps; international readers should convert time zones when correlating events.

### 8.2 Protocol keys stay ASCII

Event names (`platform.update.available`, `flow.*`), permission points (`iam.user.write`, `workforce.admin`, `platform.update.apply`), error reason codes and the `ok` / `data` / `error` API envelope fields, environment variable names (`DEMO_SEED`, `ADMIN_PASSWORD`, `USAGE_RETENTION_DAYS`, `SECURITY_HEADERS`, `GITHUB_TOKEN`, `DSH_UPDATE_AUTO_CHECK`, ...), browser storage keys, HTTP headers (`X-On-Behalf-User`), commands, paths, and package names are **machine contracts and are never translated** in any language edition. The authoritative per-key Chinese glossary is the internal table `docs/协议键中文对照总表.md`; English documents may paraphrase meanings but never rewrite the keys.

### 8.3 Demo mode warning

`DEMO_SEED=1` seeds demo organizations, accounts (shared password `Ybk@2026`), and 28 days of synthetic history. It exists for evaluation and training only. **Never enable it in production**; the deployment acceptance checklist explicitly verifies that demo accounts cannot log in and that the production data directory contains no demo data.

### 8.4 Security and data-protection defaults

- HTTP security response headers are on by default (`SECURITY_HEADERS=off` disables).
- Login, Client Credentials, SSO binding, and OIDC endpoints all enforce failure lockout (5 failures per 15 minutes per source, escalating up to 24 h, persisted across restarts, alert on trigger).
- OIDC access tokens default to 2 h (`OIDC_ACCESS_TTL_SECONDS`) and refresh tokens to 7 days (`OIDC_REFRESH_TTL_SECONDS`); refresh tokens rotate once per use and replay revokes the whole chain.
- Secret rotation keeps a 24 h verification grace window for old keys, so in-flight requests do not drop.
- Unmatched `/api/*` routes return 401 for anonymous callers by design (the auth middleware runs before routing) — there is no route-existence side channel via 404/401 differences.
- Data-protection posture: organization APIs are PII-minimized (the roster endpoint carries no phone numbers; offboarded accounts are excluded); platform-to-gateway file calls pass the real user identity via `X-On-Behalf-User`; NAS authorization is default-deny with per-decision logging; NAS download URLs are HMAC-signed and independently revocable; machine-identity reads of registries are audit-trailed while human Console reads are noise-suppressed.

### 8.5 Honesty boundaries

- Only implemented features are described in this documentation set; forward-looking items are labeled "Roadmap". Compliance certifications such as SOC 2 or ISO 27001 have **not** been obtained and appear only as roadmap items.
- Quality-gate numbers (`npm run selftest`, drill counts) are quoted "as of the latest run"; historical counts are void. Recent six-gate verification: lint green · selftest ≥ 1,380 · drill ≥ 37.
- Region-specific compliance wording (GDPR, PDPA, DPDP, APPI, Privacy Act 1988) in the governance README is positioning guidance, not legal advice.

### 8.6 Runtime conventions and honest limitations

- REST APIs authenticate with Bearer tokens; responses use the `ok` / `data` / `error` envelope.
- The model gateway forwards OpenAI-compatible `chat/completions` only; other modalities are out of scope today.
- NAS file operations execute in the file-gateway process reading local paths: the platform and gateway must be co-located, or the asset `stagingDir` must point at a shared mount.
- The `/mcp` endpoint is a sessionless pure-JSON form (no GET SSE streaming), chosen for broad MCP-client compatibility.
- OIDC private keys live in the data directory by default; production deployments should move them to a KMS.
- Budget circuit breakers exist at the model-gateway channel level and for agent/app principals (with L4 unfreeze approvals); they are governance guardrails, not prepaid balances — no monetary semantics attach to them.

### 8.7 Roadmap

Delivered in the 2026-10-16 release: built-in runtime UI language switching (Simplified Chinese default / English (US) / Japanese) with the top-bar selector and `rq_lang` preference, and `dshctl` output language switching via `--lang` / `DSHCTL_LANG`. Planned, not implemented: additional UI languages, regional compliance enhancement packs (GDPR DPA template, SOC 2 audit preparation, APPI), a multi-language docs portal with language routing, and additional Tier 2 languages (ko / id / ar). See [../README.md](../README.md) §六.

### 8.8 Language editions of the documentation

- **简体中文 (zh)** — the native, authoritative full-repository documentation.
- **English (en)** and **日本語 (ja)** — Tier 1 full editions (this document set and its Japanese counterpart), targeting the US, Europe, India, Africa, Australia, and Singapore as the business language.
- **de / fr / es / pt / hi** — Tier 2 one-page product overviews for DACH, French-speaking Europe and Africa, Spain/LatAm, Lusophone Africa and Portugal, and India respectively.
Every edition is produced under the same terminology contract ([../GLOSSARY.md](../GLOSSARY.md)) and the same governance flow ([../README.md](../README.md)); the Chinese original governs all of them.

## 9. Release history

The curated English summary lives in [release-notes-summary.md](release-notes-summary.md). Compressed timeline:

| Date | Batch | Highlights |
|---|---|---|
| 2026-08 | Ecosystem design v1.2 | internal design baseline (later archive; commercialization parts deprecated) |
| 2026-09-09 | **M0** | compliance reset: charging/resale/revenue-share abolished; `plugin-billing` decommissioned and sealed; zero-price snapshot posture; J4 usage-report contract |
| 2026-09-11 | M1-1 optimization | J1–J4 contract freeze (panel invocation, entry triage, session passthrough, usage report); security headers default on; usage retention policy |
| 2026-09-11 | IAW batch | flow-core orchestration, data asset domain, model channel governance, agent autonomy A0–A3 + A2A, scene-level authorization (`sceneCode`), audit evidence anchors |
| 2026-09-13 | QA fixes | key-rotation grace window, brute-force lockout, crash recovery, metering idempotency, OIDC convergence, Asset Operations page |
| 2026-09-15 | Commercial model update | "team + domain assets" pricing; on-prem project delivery for manufacturing |
| 2026-09-16 | **M2** | FinOps report v1, first-boot experience, signed release manifests, tech-debt closure |
| v1.4–v1.5 batches | App SSO / NAS | OIDC Provider browser authorize flow with app go-live gate; NAS onboarding, skill-package NAS storage, platform-as-MCP-server (`POST /mcp`) |
| v1.6–v1.7 batches | hardening / connectors | agent-credential and metering-key hardening, machine-credential governance, open-connector fusion, NAS organization RBAC, connector auto-sync, roster and org-sync APIs |
| 2026-10-13 | REFACTOR batch | Chinese-only UI decision (R10), protocol key table (280 keys), console backend split, lint gates |
| 2026-10-14 | Execution Hub | plugin-exec-hub delivery plus R2–R12 governance closure (budget-linked freezes, agent organization, multi-company scoping) |
| 2026-10-15 | Workforce Phase II + review remediation | trusted-risk registration for MCP tools, organization isolation fail-closed, tool permission minimization, `/docs` whitelist publishing, six-gate verification |

Product capability statements are governed by the M0 release notes (internal, Chinese).
