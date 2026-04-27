# AI for HHS — replit.md

## Overview

AI for HHS is a web application serving as an AI coaching tool for California county Health and Human Services (HHS) managers. It provides a streaming chat interface powered by Anthropic's Claude models, with IQmeetEQ methodology embedded in the system prompt. The app is built on a pnpm monorepo and deployed on Replit.

**Core purpose:** Help HHS managers get real work done using AI — drafting emails, breaking down policy letters, preparing for difficult conversations, building cases for change — without needing to know how to prompt.

**Key trust constraint:** No conversation content is ever stored. Only metadata (user, county, task launcher used, message count) is persisted.

---

## User Preferences

Preferred communication style: Simple, everyday language.

---

## System Architecture

### Monorepo Layout

The repository is a pnpm workspace with three layers:

- **`lib/`** — Shared libraries (db schema, API spec, generated client code)
- **`artifacts/`** — Deployable apps (Express API server, React frontend, mockup sandbox)
- **`corpus/`** — Markdown documents ingested into pgvector for RAG
- **`scripts/`** — Utility scripts (corpus ingestion)

### Frontend (`artifacts/aiforrhhs`)

- **Framework:** React 18 + Vite
- **Routing:** Wouter (lightweight client-side routing)
- **Styling:** Tailwind CSS v4 + Radix UI primitives (shadcn/ui style)
- **State/data fetching:** TanStack React Query
- **Fonts:** DM Serif Display (headings), DM Sans (body)
- **Brand colors:** Navy `#1A2744`, Gold `#C8963E`
- **Three main pages:**
  - `/` — Home: login/registration (default shows login first)
  - `/chat` — Main chat interface with task launcher cards
  - `/admin` — Admin dashboard (tabbed: Inbox, Dashboard, Users, Settings)
- **Markdown rendering:** `react-markdown` + `remark-gfm` for assistant responses
- **File uploads:** PDF (base64 → Anthropic document blocks) and DOCX (server-side text extraction via mammoth)

### Backend (`artifacts/api-server`)

- **Framework:** Express 5 (Node.js)
- **Port:** 8080
- **Session management:** `express-session` + `connect-pg-simple` (PostgreSQL session store)
- **Two separate session namespaces:** User sessions and admin sessions use separate cookies so logging out of one doesn't affect the other
- **Password hashing:** argon2
- **AI integration:** `@anthropic-ai/sdk` — streaming chat using claude-opus-4-5 (default) with auto-downgrade to claude-sonnet-4-5 when monthly spend threshold is exceeded
- **RAG:** pgvector similarity search — on each chat message, relevant corpus chunks are retrieved and injected into the system prompt
- **Embeddings:** `@xenova/transformers` (Xenova/all-MiniLM-L6-v2 model, runs locally in Node)
- **File parsing:** `mammoth` for DOCX → text extraction
- **Logging:** pino + pino-http

### Shared Libraries

| Package | Purpose |
|---|---|
| `@workspace/db` | Drizzle ORM schema + PostgreSQL pool client |
| `@workspace/api-zod` | Zod validation schemas (generated from OpenAPI spec via Orval) |
| `@workspace/api-client-react` | React Query hooks + custom fetch (generated from OpenAPI spec via Orval) |
| `@workspace/api-spec` | OpenAPI YAML spec + Orval codegen config |

### Database (PostgreSQL + pgvector)

Key tables (managed via Drizzle ORM):

- **`users`** — Email, hashed password, county, service category, domain match flag, domain note, disabled flag, timestamps
- **`conversations`** — Metadata only (user, county, task launcher used, message count) — NO content stored
- **`corpus_chunks`** — RAG corpus: doc_id, chunk text, vector embedding (384-dim), chunk index
- **`corpus_documents`** — Document metadata: title, description, category, timestamps
- **`system_prompt_layers`** — 4 layers of the system prompt (editable via admin UI), with previous content for one-level undo
- **`token_usage`** — Per-request token tracking for cost estimation and auto-downgrade logic
- **`ratings`** — Thumbs up/down on assistant responses
- **`feedback`** — File upload errors and user feedback form submissions
- **`inquiries`** — "Get in Touch" modal submissions (type, message, preferred email)
- **`app_settings`** — Key-value store for active model, spend threshold

### Authentication

- **User auth:** Email + password (argon2), session cookie (1-year expiry), stored in PostgreSQL via connect-pg-simple
- **Domain matching:** On registration, email domain is checked against `.gov`, `.ca.gov`, `.ca.us`, `.org`, `.edu` patterns. Non-matching domains require a connection explanation.
- **Disabled accounts:** Admin can disable users; disabled users see a paused message on login attempt
- **Admin auth:** Hardcoded credentials (anthony@iqmeeteq.com / 95682), accessed via gear icon on login page — completely separate session/cookie from user sessions

### RAG Pipeline

- **Ingestion:** `scripts/src/ingest-corpus.ts` reads markdown files from `corpus/`, chunks them (~300 words, 50-word overlap), embeds with Xenova/all-MiniLM-L6-v2, stores vectors in pgvector
- **Retrieval:** On each chat message, query is embedded and top-k similar chunks are retrieved via cosine similarity, injected as Layer 3 of the system prompt
- **Corpus management:** Admin UI in Settings tab allows uploading new markdown documents, viewing chunks, re-ingesting, and deleting

### System Prompt Architecture

The system prompt is split into 4 layers stored in the database (editable via admin):
1. **Layer 1:** Identity & Tone
2. **Layer 2:** Methodology (RICECO, Six Ways, Power Follow-Ups, Red/Yellow/Green, Peer Review)
3. **Layer 3:** RAG Context (injected dynamically per request)
4. **Layer 4:** User Context (county, service category injected per user)

### Admin Dashboard

Tabbed interface at `/admin`:
- **Inbox** — "Get in Touch" inquiries + file upload errors/feedback
- **Dashboard** — Summary cards, sparkline trend charts, breakdowns by county/service category, task launcher rankings, unmatched domain registrations
- **Users** — Filterable/sortable user table, enable/disable accounts
- **Settings** — Model controls (active model + spend threshold), corpus document management, system prompt editor with diff view before saving

---

## External Dependencies

### APIs & Services

| Service | Purpose | Package |
|---|---|---|
| Anthropic Claude API | Streaming chat completions (claude-opus-4-5 / claude-sonnet-4-5) | `@anthropic-ai/sdk` |
| Google Fonts | DM Sans + DM Serif Display fonts | CDN link in HTML |

### Key npm Dependencies

| Package | Role |
|---|---|
| `drizzle-orm` + `drizzle-kit` | ORM + migrations for PostgreSQL |
| `pg` + `pgvector` | PostgreSQL client + vector extension support |
| `connect-pg-simple` | PostgreSQL-backed session store |
| `argon2` | Password hashing |
| `@xenova/transformers` | Local embedding model (all-MiniLM-L6-v2) for RAG |
| `mammoth` | DOCX → plain text extraction |
| `express-session` | Session middleware |
| `nodemailer` | Email (for future/existing notification needs) |
| `react-markdown` + `remark-gfm` | Markdown rendering in chat |
| `@tanstack/react-query` | Server state management on frontend |
| `wouter` | Client-side routing |
| `multer` | File upload handling |
| `uuid` | ID generation |
| `pino` | Structured logging |

### Environment Variables Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Express session signing secret |
| `ANTHROPIC_API_KEY` | Anthropic API access |
| `PORT` | Server port (backend 8080, frontend 18162) |
| `BASE_PATH` | Vite base path for asset routing |

### Corpus Content (in `corpus/`)

Pre-written markdown documents seeded into the RAG database:
- `methodology/` — RICECO, Six Ways, Power Follow-Ups, Red/Yellow/Green, Peer Review
- `task-chains/` — ACL breakdown, email drafting, coaching prep, brainstorm, case for change
- `prompts/` — CPS-specific and APS-specific prompt guides