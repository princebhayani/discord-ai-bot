# AI-Powered Discord Ticket Conversation Assistant

A production-ready TypeScript monorepo implementing an **AI-powered conversational support assistant (`@hrbot/bot`)** and **Next.js administrative dashboard (`@hrbot/dashboard`)** designed to work seamlessly alongside an **existing Discord ticket-management bot** and an **existing player-data bot**.

---

## 1. Strict Architectural Boundary

There are **two completely separate Discord bots** in your server:

| Component | Responsibility |
|---|---|
| **Bot 1 — Existing Ticket Management Bot** | Opens tickets, creates ticket channels/threads, manages ticket permissions & categories, closes/locks/deletes tickets. |
| **Bot 2 — Our AI Conversation Assistant (This Project)** | Passively observes newly created ticket channels/threads in enabled categories, conducts natural Groq-powered intake conversations, queries an approved player-data bot, delivers neutral moderator reports to pre-existing channels/threads, and purges temporary session data upon confirmed closure. |

### Non-Negotiable Restrictions Enforced in Code & Tests
Our bot **never**:
1. Creates Discord ticket channels or threads.
2. Opens, closes, deletes, archives, or locks channels or threads.
3. Modifies channel/thread permissions or moves channels between categories.
4. Registers ticket-creation or ticket-closure commands.
5. Publishes confidential staff assessments inside player-visible ticket channels.

---

## 2. Monorepo Structure

```text
discord-ticket-ai/
├── apps/
│   ├── bot/                   # Persistent Discord.js + Groq worker (Docker / Northflank)
│   │   └── src/
│   │       ├── config/        # Zod env loader & versioned config snapshotting
│   │       ├── events/        # Read-only Gateway observers
│   │       ├── handlers/      # Ticket channel/thread detector & provider verifier
│   │       ├── integrations/  # Approved external player-data bot adapter
│   │       ├── queues/        # Per-ticket FIFO queue & global Groq concurrency semaphore
│   │       ├── services/      # Session recovery, Groq engine, reports, closure purge
│   │       └── index.ts       # Bot entrypoint & graceful SIGTERM/SIGINT shutdown
│   └── dashboard/             # Next.js App Router + Tailwind + ShadCN UI (Vercel)
│       └── src/
│           ├── app/           # Protected dashboard pages & server-only API routes
│           ├── components/    # ShadCN UI & interactive editors / live previews
│           ├── hooks/         # Save banner & state hooks
│           └── lib/           # Supabase SSR auth, moderator allowlist guard, data service
├── packages/
│   └── shared/                # Shared Zod schemas, questionnaire engine, privacy redactor
├── supabase/
│   └── migrations/            # PostgreSQL schema, ON DELETE CASCADE, RLS & cleanup RPC
├── tests/                     # Static restriction & multi-ticket acceptance test suite
├── .env.example
├── Dockerfile
├── northflank.template.json
├── package.json
└── pnpm-workspace.yaml
```

---

## 3. Bot Permissions & Gateway Intents

### Required Gateway Intents (Enable in Discord Developer Portal -> Bot)
- `Guilds`
- `GuildMessages`
- `MessageContent`

### Required Channel Permissions (Least-Privilege Only — Bitfield `274877991936`)
- `View Channel` (`1024`)
- `Send Messages` (`2048`)
- `Embed Links` (`16384`)
- `Read Message History` (`65536`)
- `Send Messages in Threads` (`274877906944`)

### Explicitly Forbidden Permissions (Do NOT Grant)
- `Manage Channels`
- `Manage Threads`
- `Create Public Threads`
- `Create Private Threads`
- `Administrator`

---

## 4. Database Setup (Supabase PostgreSQL)

1. Create a new Supabase project.
2. Run the SQL migrations in order inside the Supabase SQL Editor (or via `supabase db push`):
   - `supabase/migrations/0001_initial_schema.sql`
   - `supabase/migrations/0002_rls_and_cleanup.sql`
3. Enable **Discord OAuth2** in **Supabase Dashboard -> Authentication -> Providers -> Discord**:
   - Create/use a Discord OAuth2 application and copy its `Client ID` and `Client Secret`.
   - Add your Supabase callback URL to the Discord Developer Portal OAuth2 Redirects.
   - Add `http://localhost:3000/auth/callback` and `https://<your-vercel-domain>/auth/callback` under **Supabase -> Authentication -> URL Configuration -> Redirect URLs**.
4. Bootstrap your initial server row and owner allowlist entry in the Supabase SQL Editor (replace IDs with your Discord Guild ID and your Discord User ID):
   ```sql
   INSERT INTO public.server_settings (guild_id, guild_name)
   VALUES ('YOUR_DISCORD_GUILD_ID', 'Your Server Name')
   ON CONFLICT (guild_id) DO NOTHING;

   INSERT INTO public.dashboard_admins (guild_id, discord_user_id, label, permission_level)
   VALUES ('YOUR_DISCORD_GUILD_ID', 'YOUR_DISCORD_USER_ID', 'Server Owner', 'owner');
   ```

---

## 5. Groq AI Configuration

Set server-side environment variables:

```env
GROQ_API_KEY=gsk_...
GROQ_MODEL=openai/gpt-oss-20b
```

- Always check [Groq Supported Models](https://console.groq.com/docs/models) and [Structured Outputs](https://console.groq.com/docs/structured-outputs) when choosing models.
- Models supporting native `json_schema` strict constrained decoding (such as `openai/gpt-oss-20b` and `openai/gpt-oss-120b`) automatically use `response_format: { type: "json_schema", strict: true }`.
- Models supporting JSON Object mode (such as `llama-3.3-70b-versatile` and `llama-3.1-8b-instant`) automatically use `response_format: { type: "json_object" }`.
- Every AI output is deterministically validated with Zod (`AiTurnResponseSchema`) before any state update or approved lookup action occurs.

---

## 6. Local Development & Testing

```bash
# 1. Install dependencies across workspace
pnpm install

# 2. Copy .env.example to .env and populate credentials
cp .env.example .env

# 3. Build all packages & apps
pnpm build

# 4. Run strict TypeScript verification across shared, bot, and dashboard
pnpm typecheck

# 5. Run unit, concurrency, and restriction audit tests
pnpm test

# 6. Run locally in development
pnpm dev:bot
pnpm dev:dashboard
```

---

## 7. Production Deployment

### A. Persistent Discord Bot on Northflank (Docker)
1. Push this repository to GitHub.
2. In Northflank, create a **Combined Service** (or build + deployment service) linked to your GitHub repo using root `/Dockerfile`.
3. Select a single-instance plan within your approved allowance (e.g., Sandbox `nf-compute-10`, `instances: 1` — see `northflank.template.json`). Do not add paid add-ons or scale beyond your plan allowance unless explicitly intended.
4. Expose **no public HTTP ports** (the bot uses outbound WebSocket/HTTPS connections only).
5. Add secret runtime environment variables in Northflank:
   - `DISCORD_BOT_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_GUILD_ID`
   - `GROQ_API_KEY`
   - `GROQ_MODEL`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

### B. Next.js Dashboard on Vercel
1. Import the GitHub repository into Vercel and set the **Root Directory** to `apps/dashboard`.
2. Vercel automatically uses `apps/dashboard/vercel.json` (`pnpm --filter @hrbot/shared build && pnpm --filter @hrbot/dashboard build`).
3. Configure environment variables in Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` *(Server-only — never prefix with `NEXT_PUBLIC_`)*
   - `GROQ_API_KEY` *(Server-only)*
   - `GROQ_MODEL`
   - `DEFAULT_GUILD_ID`
   - `DASHBOARD_DISCORD_BOT_TOKEN` *(Optional, server-only — used if matching allowlisted Discord Guild Role IDs)*
4. **Never** deploy the persistent Discord Gateway bot as a Vercel Serverless Function.

---

## 8. Ticket Closure Detection & Provider Limitations

Because the existing ticket bot owns ticket lifecycle, closure detection supports four complementary mechanisms:
1. **`ChannelDelete` / `ThreadDelete` Gateway events** when the ticket bot deletes closed channels/threads.
2. **`ThreadUpdate` Gateway events** governed by `threadClosurePolicy` (`locked_only` by default so Discord's automatic idle-thread archiving is never mistaken for ticket closure; also supports `archived_and_locked`, `archived_or_locked`, and `delete_only`).
3. **Periodic channel reconciliation** (`CLOSURE_RECONCILE_INTERVAL_MS`) that verifies active session channels still exist on Discord and purges sessions closed while the bot was restarting.
4. **Optional HMAC-SHA256 signed webhook** (`/webhooks/ticket` when `WEBHOOK_PORT` & `TICKET_WEBHOOK_SECRET` are enabled) for ticket bots that keep closed channels open in an archive category without deleting or locking them.

*Provider Limitation Note:* If your existing ticket bot closes a standard text channel solely by renaming it or changing permissions without deleting the channel or firing a webhook, configure a closure webhook or delete-on-close workflow in your ticket bot so closure is deterministically observable.

---

## 9. Privacy & Third-Party Data Retention Disclosures

- **Active-Session-Only Storage:** Messages from general channels, disabled categories, and unrelated threads are never stored.
- **Credential Redaction:** Passwords, recovery codes, 2FA backup codes, API keys, tokens, and payment card patterns are automatically redacted via `sanitizeSensitiveContent` before database persistence or Groq API submission.
- **Redacted Logging & Analytics:** Structured logs strip message bodies and credentials, and the Dashboard Overview displays only aggregate counters and session status metadata (never private conversation transcripts).
- **Automatic Closure Purge:** Confirmed ticket closure executes an idempotent cascade deletion removing `ticket_messages`, `ticket_answers`, `player_lookups`, `staff_reports`, and `ticket_sessions` while preserving persistent server/category configurations.
- **Third-Party Retention Realities:**
  1. **Discord:** Deleting temporary rows in Supabase does **not** delete messages stored on Discord's servers (unless the existing ticket bot deletes the ticket channel/thread).
  2. **Database Backups:** Deleting rows from active PostgreSQL tables removes live records immediately, but encrypted database WAL segments or point-in-time recovery snapshots managed by Supabase expire according to your Supabase plan's backup retention schedule.
  3. **Groq API:** Redacted conversation turns are transmitted to Groq's Chat Completions API for real-time inference and are subject to GroqCloud's data processing and zero/short-term abuse-monitoring retention policies configured on your Groq organization account.

# discord-ai-bot
