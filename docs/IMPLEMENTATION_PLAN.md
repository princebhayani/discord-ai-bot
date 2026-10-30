# Discord Ticket AI Conversation Assistant — Architecture & Implementation Plan

## 1. Core Architectural Boundary

This repository implements **Bot 2 (Conversational AI Assistant)** designed to operate alongside **Bot 1 (Existing Ticket Management Bot)** and an **Existing Player-Data Bot**.

### Non-Negotiable Operational Rules
1. **Never** create, close, delete, move, archive, or lock Discord channels or threads.
2. **Never** modify Discord channel/thread permission overwrites.
3. **Never** expose ticket creation or ticket closure commands.
4. **Minimum Gateway Intents Only**: `Guilds`, `GuildMessages`, `MessageContent`.
5. **Minimum Channel Permissions Only**: `ViewChannel`, `SendMessages`, `ReadMessageHistory`, `EmbedLinks`, `SendMessagesInThreads`.
6. **Zero Unrelated Storage**: Store messages only for active tickets in enabled categories; purge all temporary records (`ticket_sessions`, `ticket_messages`, `ticket_answers`, `player_lookups`, `staff_reports`) immediately and idempotently upon confirmed ticket closure.

---

## 2. Package Responsibilities

- `packages/shared` (`@hrbot/shared`):
  - Strict Zod schemas for database models, questionnaire configs, Groq structured responses, player lookup templates, moderator reports, and webhook payloads.
  - Questionnaire validation & conditional question evaluation engine.
  - Groq model capability metadata (`json_schema` strict constrained decoding vs `json_object` fallback).
  - Privacy sanitizer for redacting passwords, recovery codes, tokens, and secrets prior to storage or LLM submission.
  - Permission bitfield guard utilities.
- `apps/bot` (`@hrbot/bot`):
  - Persistent Node.js TypeScript worker deployed via Docker on Northflank.
  - Read/send-only Discord gateway adapter (`SafeDiscordMessenger`).
  - Ticket channel/thread detector & configurable provider verifier.
  - Per-ticket sequential execution queue + global Groq concurrency semaphore + per-session `AbortController`.
  - Groq conversational engine (`groq-sdk`) + external player-data bot adapter + moderator report service + closure observer/reconciler.
- `apps/dashboard` (`@hrbot/dashboard`):
  - Next.js App Router administrative dashboard deployed on Vercel.
  - Discord OAuth2 via Supabase Auth + server-side moderator/admin verification + Supabase RLS.
  - Pages: Overview, Category Management, Question Builder (with live interactive preview), Player Integration, Report Settings, and AI Settings.
  - Immutable configuration snapshotting so active ticket sessions retain their initial published configuration version.
- `supabase/migrations/`:
  - PostgreSQL schema, foreign keys with `ON DELETE CASCADE`, indexes, RLS policies, and `cleanup_closed_ticket_session` RPC.

---

## 3. Ten-Phase Incremental Delivery

1. **Phase 1**: Monorepo, TypeScript strict foundation, `@hrbot/shared`, and Supabase SQL migrations + RLS.
2. **Phase 2**: Discord Gateway connection, minimal intents, safe send-only wrapper, and observation of existing ticket channels and threads.
3. **Phase 3**: Category filtering, configuration snapshot pinning, session persistence, and crash recovery.
4. **Phase 4**: Groq-powered natural conversation engine, structured answer extraction, and conditional/typed questionnaire engine.
5. **Phase 5**: Approved external player-data bot integration adapter with loop protection and response parsing.
6. **Phase 6**: Moderator report builder and delivery into pre-existing staff channels / verified private threads / optional player summary.
7. **Phase 7**: Closure observation (delete events, configurable thread closure policy, signed webhook, periodic channel reconciliation) and 10-step idempotent temporary data deletion.
8. **Phase 8**: Next.js + Tailwind CSS + ShadCN UI administrative dashboard.
9. **Phase 9**: Multi-stage `Dockerfile` and Northflank / Vercel deployment configuration.
10. **Phase 10**: Comprehensive unit/integration/static restriction test suite and full operational/privacy documentation.

