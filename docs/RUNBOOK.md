---
type: reference
title: ASM Bots v3 Operations Runbook
created: 2026-09-24
tags:
  - asm-bots
  - operations
  - runbook
  - cloudflare
  - deployment
related:
  - '[[ARCHITECTURE]]'
---

# ASM Bots v3 Operations Runbook

Production operations for ASM Bots v3 running on Cloudflare Workers (ARCHITECTURE §7, §10).

## Deploy

### Automated deploy via GitHub Actions

The standard path. On every push to `main` after CI passes (`ci.yml`), the `deploy.yml` workflow:

1. Builds the app (`bun run build`)
2. Applies pending D1 migrations (`wrangler d1 migrations apply asmbots --remote`)
3. Deploys the Worker (`wrangler deploy --var APP_VERSION:<version>`)
4. Runs smoke tests (`scripts/smoke.ts https://asmbots.io`)
5. On failure: rolls back to the previous version and fails the job

The version stamp is `YYYY.MM.DD[letter]` (e.g., `2026.09.24a`), auto-generated from git date.

### Manual deploy (emergency)

```bash
cd /Users/pedram/Projects/asm-bots/asm-bots-v3
bun run build
cd apps/api
wrangler deploy --var APP_VERSION:$(bun run version)
# Verify smoke tests pass manually:
curl https://asmbots.io/api/health
```

## Rollback

If a deploy breaks production:

```bash
cd /Users/pedram/Projects/asm-bots/asm-bots-v3/apps/api
# List recent versions
wrangler rollback --message "Reverting broken deploy"
```

This rolls back to the previous deployment. The git history remains intact; the rollback is only the Worker version.

Alternatively, check the [Cloudflare Workers dashboard](https://dash.cloudflare.com) → Workers & Pages → `asmbots` → Deployments → click a prior version → "Rollback to this deployment".

## Migrations

ASM Bots uses Cloudflare D1 for the database. Migrations live in `apps/api/src/db/migrations/` as numbered SQL files.

### Applying migrations

Migrations run automatically during deploy via the `deploy.yml` workflow. To apply them manually:

```bash
cd /Users/pedram/Projects/asm-bots/asm-bots-v3/apps/api
# Apply to production (remote)
wrangler d1 migrations apply asmbots --remote
# Apply to local dev
wrangler d1 migrations apply asmbots
```

### Creating a new migration

Never edit a shipped migration; create a new one:

```bash
cd /Users/pedram/Projects/asm-bots/asm-bots-v3/apps/api/src/db/migrations
# List existing to find the next number
ls
# Create a new file, e.g., 0009_add_new_column.sql
touch 0009_add_new_column.sql
```

Edit the file with your SQL (DDL only; data changes live in `scripts/seed.ts`). Test locally:

```bash
cd /Users/pedram/Projects/asm-bots/asm-bots-v3
bun run migrate:local
# Verify with:
wrangler d1 execute asmbots "SELECT * FROM sqlite_master WHERE type='table';" --local
```

Commit the migration; it will run automatically on the next deploy.

## Rotating Secrets

Three secrets are managed via `wrangler secret put`. They are stored in Cloudflare Workers Secrets (encrypted, not visible in any UI after set):

| Secret | For | Where |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | GitHub OAuth | OAuth app at https://github.com/settings/developers |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth | OAuth app at https://github.com/settings/developers |
| `SESSION_SECRET` | Signs session cookies | Keychain service `asmbots/prod` |

### Update a secret

```bash
cd /Users/pedram/Projects/asm-bots/asm-bots-v3/apps/api
# wrangler prompts for the value interactively
wrangler secret put GITHUB_CLIENT_ID
# Or pass it directly (not recommended; history visible):
# echo "new-secret-value" | wrangler secret put GITHUB_CLIENT_ID
```

### Verify secrets are set

```bash
wrangler secret list
```

Note: `list` shows names only, not values (they are encrypted). Verification is via deploy success or test auth flow.

## Monitoring

### Health and diagnostics

```bash
# Check the health endpoint
curl https://asmbots.io/api/health
# Should return: { "ok": true, "version": "YYYY.MM.DD[x]", "isa": "x16c-v1" }
```

### Live logs

```bash
cd /Users/pedram/Projects/asm-bots/asm-bots-v3/apps/api
# Stream real-time logs from production (requires CLOUDFLARE_API_TOKEN)
wrangler tail
# Filter by status, message, or level (--status 500, --format json, etc.)
wrangler tail --status 500 --format json
```

### Workers Analytics

Visit [Cloudflare Workers Analytics](https://dash.cloudflare.com) → Workers & Pages → `asmbots`:

- **Requests**: total inbound, by status, by path
- **Duration**: p50, p95, p99 latencies
- **Error rate**: 4xx and 5xx counts
- **Custom analytics**: match counts and durations per-hill/tournament (from `MATCH_ANALYTICS` dataset)

## Durable Objects

Durable Objects run long-lived state (hill submissions, tournaments, live room broadcasts). Two classes:

- **`Runner`**: Executes a hill submission or tournament match-by-match, one match per alarm, storing results in D1 and R2
- **`LiveRoom`**: Keeps live standings and fans WebSocket events to spectators

### Inspect a Runner

```bash
cd /Users/pedram/Projects/asm-bots/asm-bots-v3/apps/api
# List all Durable Objects in production
wrangler durable-objects list asmbots
# Should return IDs like: "hill:melee:submission-12345", "tournament:championship-2026-w39"
```

### Inspect a Runner's state

```bash
# Get a specific Runner by its ID (replaces placeholders)
wrangler durable-objects get --name-pattern "hill:melee:submission-12345" asmbots
# Or query the database directly:
wrangler d1 execute asmbots "SELECT * FROM matches WHERE tournament_id = ? OR ..." --remote
```

### Force a Runner to process the next match (alarm)

```bash
# This is an internal operation; normally the Runner alarms trigger automatically.
# Via D1 query (check progress):
wrangler d1 execute asmbots "SELECT COUNT(*) FROM matches WHERE tournament_id = ? AND finished_at IS NULL;" --remote
# Via the API (manually POST a match to a hill):
curl -X POST https://asmbots.io/api/hills/melee/submit \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{ "botVersionId": "..." }'
```

## Re-running a hill from history

Hills store complete submission history in the `hill_history` table. To re-run a bot against a prior hill state:

1. Find the submission ID and the timestamp:
   ```bash
   wrangler d1 execute asmbots "SELECT * FROM hill_history WHERE hill_id = '<hill-id>' ORDER BY at DESC LIMIT 20;" --remote
   ```

2. The hill's matches are immutable (verified from the inputs), so re-run by POST-ing to the live hill and letting the Runner re-simulate. Or:

3. Restore a prior D1 snapshot (see **Backup** below) to a development instance and test locally.

## Clearing KV caches

KV stores sessions, rate limits, and ephemeral caches. To clear:

```bash
cd /Users/pedram/Projects/asm-bots/asm-bots-v3/apps/api
# Clear a single key
wrangler kv key delete "sess:example-session-id" --namespace-id 24af2453a5994d24ace5f8f0900f04ca
# Clear a prefix (e.g., all sessions for a user)
wrangler kv key delete "usess:user-123:*" --namespace-id 24af2453a5994d24ace5f8f0900f04ca --path
# Clear the ticker feed cache (it refreshes after 30 s automatically)
wrangler kv key delete "ticker" --namespace-id 24af2453a5994d24ace5f8f0900f04ca
# Redraw a replay's share card after a card design change (its SVG; PNGs are keyed by their SVG's hash)
wrangler kv key delete "og:<replay key>" --namespace-id 24af2453a5994d24ace5f8f0900f04ca
```

KV TTL: Sessions expire at 30 days (set on write); rate limits use 1-minute windows; caches use 1–24 hours. Share cards (`og:<replay key>` SVGs, `og:png:<sha-256 of the SVG>` PNGs) keep a day; a new card design reaches every card within a day, or at once after deleting the `og:` keys.

**Never mark a binding `remote` in `apps/api/wrangler.jsonc`.** Until 2026-09-25 the D1 binding had `"remote": true`, and the API tests and `wrangler dev` wrote to production D1 (test bots on the hills, a fake championship). Before any production write: `wrangler d1 export asmbots --remote --output <file>` and note `wrangler d1 time-travel info asmbots` (restore with `wrangler d1 time-travel restore asmbots --bookmark <bookmark>`).

## R2 Lifecycle and Maintenance

### Replays and binaries

R2 bucket `asmbots-replays` stores replays (deterministic, tiny—just inputs) and bot binaries (cached for speed). Both are content-addressed by `sha256(isa, config, bots, seed)` to avoid duplication.

**Lifecycle rule**: Keep all objects forever (they are small and immutable). No expiration is set.

### Backups

R2 bucket `asmbots-backups` holds nightly D1 database exports (SQL dumps). Set a lifecycle rule to keep recent backups:

```bash
# List lifecycle rules (check Cloudflare dashboard or API)
# Recommended: keep last 30 days of daily backups
```

Manual export:

```bash
cd /Users/pedram/Projects/asm-bots/asm-bots-v3/apps/api
# Export the production database to a local file
wrangler d1 export asmbots --remote > backup-$(date +%Y-%m-%d).sql
# Upload to R2 manually if needed
wrangler r2 object put asmbots-backups/backup-$(date +%Y-%m-%d).sql < backup-$(date +%Y-%m-%d).sql
```

## Backup and Recovery

A nightly GitHub Action (`backup.yml`) exports the production D1 database and uploads it to R2. This runs via cron every day at 02:00 UTC.

### Backup status

The workflow appears in [GitHub Actions](https://github.com/anthropics/asm-bots/actions) under "Backup D1 to R2". Check the latest run:

```bash
# From the repo
gh workflow list | grep -i backup
gh run list --workflow backup.yml --limit 5
```

### Manual backup

```bash
cd /Users/pedram/Projects/asm-bots/asm-bots-v3/apps/api
# Export and upload in one step
wrangler d1 export asmbots --remote | wrangler r2 object put asmbots-backups/manual-$(date +%Y-%m-%d-%H%M%S).sql
```

### Restore from backup

**To a local instance** (for testing):

```bash
cd /Users/pedram/Projects/asm-bots/asm-bots-v3/apps/api
# Download the backup
wrangler r2 object get asmbots-backups/backup-2026-09-24.sql --file backup.sql
# Restore to local D1
wrangler d1 execute asmbots --local < backup.sql
```

**To production** (destructive; verify before doing):

```bash
# Download the backup
wrangler r2 object get asmbots-backups/backup-2026-09-24.sql --file backup.sql
# WARNING: This overwrites the live database
wrangler d1 execute asmbots --remote < backup.sql
```

In case of catastrophic failure, restore is also possible via Cloudflare's D1 point-in-time recovery (contact support).

## On-Call Checklist

Daily or when on call:

- [ ] **Health**: `curl https://asmbots.io/api/health` returns 200 and `"ok": true`
- [ ] **Error rate**: Workers Analytics shows error rate < 1% (check Cloudflare dashboard)
- [ ] **Durable Object alarms**: `wrangler durable-objects list asmbots | wc -l` is in the expected range; no alarm backlog (query `/api/admin/stats` if available)
- [ ] **Database**: Latest backup is recent (`wrangler r2 ls asmbots-backups/ | sort | tail -1` shows today's date)
- [ ] **Recent deploy**: Workers dashboard shows a deploy from today or yesterday; no long gaps
- [ ] **Active users**: The ticker/feed has recent entries (post a test bot submission if not)
- [ ] **Logs**: `wrangler tail --status 500 --format json` shows no cascading errors
- [ ] **Rate limits**: No user complaints about hitting rate limits (`/api/hills/:slug/submit` is 5/hour per user)

### Emergency contacts

- **Cloudflare support**: [Cloudflare Dashboard](https://dash.cloudflare.com) → Support (paid plan required for priority)
- **GitHub Actions issues**: Check [workflow runs](https://github.com/anthropics/asm-bots/actions)
- **Database locked or very slow**: Query D1 performance metrics; consider rollback if a recent deploy changed queries

### Common issues

| Issue | Check | Fix |
| --- | --- | --- |
| Deploy fails on migration | `wrangler d1 migrations status asmbots --remote` | Rolled back automatically; fix migration file and re-push |
| 5xx errors spike | `wrangler tail --status 500 \| head -20` | Check recent logs; rollback if recent deploy |
| KV rate limit errors | Workers Analytics dataset | KV is not rate-limited; a query is slow; check query performance |
| DO alarms back up | Admin stats (if available) or DO list | Increase `RUNNER_ALARM_DELAY_MS`; Runner code may be slow |
| High latency | Analytics p99 latency + trace | Profile the slow endpoint; check D1 query plans |
| User locked out of sessions | `wrangler kv key delete "usess:<user-id>:*"` | Clear their sessions; they re-login next visit |

---

**Last updated**: 2026-09-24
