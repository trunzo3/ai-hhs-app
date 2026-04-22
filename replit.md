# AI for HHS Workspace

## Project Overview

AI for HHS is an AI coaching web app for California county Health and Human Services (HHS) managers. It provides a streaming chat interface powered by Claude (Anthropic), with IQmeetEQ methodology embedded in the system prompt.

## Product Features

- **Email/password authentication** with domain pattern matching (.gov/.ca.gov/.ca.us/.org/.edu)
- **58-county + service category registration** for all California counties
- **Streaming chat with Claude** (claude-opus-4-5 default, claude-sonnet-4-5 fallback)
- **8 task launcher cards** for common HHS workflows (ACL breakdown, email drafting, coaching prep, etc.)
- **IQmeetEQ methodology** baked into system prompt (RICECO, 6 Ways, Power Follow-Ups)
- **PDF upload** support (base64-encoded, passed as Anthropic document blocks)
- **RAG via pgvector** with corpus of methodology + HHS prompt guides
- **Thumbs up/down ratings** on AI responses
- **Feedback table** for file upload errors and other feedback
- **Admin dashboard** at `/admin` (creds: anthony@iqmeeteq.com / 95682)
- **Token tracking** with auto-downgrade to Sonnet when spend threshold exceeded
- **No conversation content stored** — only metadata (user, county, task launcher, message count)

## Brand & Design

- **Colors**: Navy #1A2744 (`--sidebar` CSS var), Gold #C8963E (`--primary`)
- **Fonts**: DM Serif Display (headings), DM Sans (body)
- **UI Library**: Radix UI + Tailwind CSS (shadcn/ui style)

## Architecture

### Monorepo Structure

```
lib/
  api-spec/        # OpenAPI spec + Orval codegen config
  api-zod/         # Generated Zod schemas (from Orval)
  api-client-react/ # Generated React Query hooks + custom fetch
  db/              # Drizzle ORM schema + client

artifacts/
  api-server/      # Express 5 backend (port 8080)
  aiforrhhs/       # React + Vite frontend (port 18162 → external 3000 → proxy to 80)

corpus/            # Markdown documents ingested into pgvector
  methodology/     # RICECO, Six Ways, Power Follow-Ups, Red/Yellow/Green, Peer Review
  task-chains/     # ACL breakdown, email drafting, coaching prep, brainstorm, case for change
  prompts/         # CPS and APS specific prompt guides

scripts/           # Ingest corpus script
```

### API Server Routes (Express)

- `GET /api/health` — health check
- `POST /api/auth/register` — register with email/password/county/category
- `POST /api/auth/login` — login with session cookie
- `POST /api/auth/logout` — destroy session
- `GET /api/auth/me` — get current user (requires auth)
- `POST /api/chat/conversation/start` — start a new conversation (requires auth)
- `POST /api/chat/message` — send message, streams SSE response (requires auth)
- `POST /api/chat/conversation/:id/rate` — rate a response up/down (requires auth)
- `POST /api/feedback` — submit feedback (requires auth)
- `GET /api/admin/stats` — admin statistics (requires x-admin-auth header)
- `GET /api/admin/users` — all users list (requires x-admin-auth header)
- `GET /api/admin/feedback` — feedback entries (requires x-admin-auth header)
- `GET /api/admin/config` — app config (requires x-admin-auth header)
- `PATCH /api/admin/config` — update config (requires x-admin-auth header)
- `PATCH /api/admin/users/:id` — toggle user disabled status (requires x-admin-auth header)

### Database Schema (PostgreSQL + pgvector)

- `users` — id, email, passwordHash, county, serviceCategory, domainMatch, domainNote, disabled (boolean, default false), resetToken/Expires, lastActive
- `conversation_metadata` — id, userId, startedAt, messageCount, taskLauncherUsed, corpusDocsRetrieved
- `response_ratings` — id, conversationId, userId, rating (up/down), messageIndex
- `feedback` — id, userId, feedbackType, detail, attemptedFileSize
- `corpus_chunks` — id, docId, chunkIndex, content, embedding (vector 384), with HNSW index
- `app_config` — key/value pairs (active_model, spend_threshold)
- `token_usage` — monthly token tracking with estimated cost

### Key Libraries

- **Backend**: Express 5, express-session, Anthropic SDK, argon2 (password hashing), Drizzle ORM, @xenova/transformers (local embeddings via all-MiniLM-L6-v2, 384-dim)
- **Frontend**: React 18, Vite, Wouter (routing), TanStack Query, React Hook Form, shadcn/ui, Lucide icons
- **Dev**: TypeScript 5.9, Orval (codegen), Drizzle Kit (migrations), pino (logging)

## Environment Variables

- `ANTHROPIC_API_KEY` — Anthropic Claude API key
- `SESSION_SECRET` — Express session secret
- `DATABASE_URL` — PostgreSQL connection string (auto-set by Replit)
- `PORT` — Port for each service (set by Replit per artifact)
- `BASE_PATH` — URL base path for Vite (set by Replit)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Admin Auth Pattern

The admin dashboard uses a hardcoded check on the frontend (email/password checked client-side). When authenticated, it calls `setAdminAuthenticated(true)` which monkey-patches `globalThis.fetch` to inject `x-admin-auth: authenticated` header for all `/api/admin/*` requests. The backend checks this header for admin routes.

## Chat Streaming

Chat uses raw SSE fetch (not the generated hook) since streaming responses need custom handling. The frontend reads the SSE stream token by token. The final event sends `{done: true, followUps: [...]}`.

## Conversation Storage

Conversation history is stored **in-memory only** using a Map (cleared on server restart). The DB only stores metadata (not content). This is intentional for privacy.
