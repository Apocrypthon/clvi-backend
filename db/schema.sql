-- STRATA ledger schema (M1).
--
-- Idempotent: safe to paste into the Supabase SQL editor repeatedly.
-- See docs/SCHEMA.md for the one-time application step.
--
-- Integrity model (persist-ant pattern):
--   * ledger is append-only, enforced by a BEFORE UPDATE OR DELETE trigger.
--   * every ledger row carries immutable_check = HMAC-SHA256(LEDGER_SECRET, canonical row JSON).
--   * every ledger row carries prev_hash = SHA-256(canonical JSON of the previous entry).
--   * LEDGER_SECRET is never stored here; hashes are computed in the Netlify
--     function layer, so a database-only attacker cannot forge a row.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- accounts --

create table if not exists public.accounts (
  player_id   text primary key,
  display_id  text not null unique,
  name        text not null,
  palette     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- -------------------------------------------------------------- challenges --

create table if not exists public.challenges (
  challenge_id    uuid primary key default gen_random_uuid(),
  salt            text not null,
  difficulty_bits smallint not null,
  player_id       text not null,
  expires_at      timestamptz not null,
  used            boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint challenges_salt_hex check (salt ~ '^[0-9a-f]{32}$'),
  constraint challenges_difficulty_range check (difficulty_bits between 8 and 32)
);

create index if not exists challenges_player_created_idx
  on public.challenges (player_id, created_at desc);
create index if not exists challenges_expires_idx
  on public.challenges (expires_at);

-- ------------------------------------------------------------------ ledger --

create table if not exists public.ledger (
  entry_id        uuid primary key default gen_random_uuid(),
  seq             bigserial not null unique,
  -- UNIQUE is what makes the chain single-threaded: two writers racing for the
  -- same head cannot both commit, so the loser retries against the new head.
  prev_hash       char(64) not null unique,
  ts              timestamptz not null default now(),
  player_id       text not null,
  cell_id         text not null,
  artifact_id     text not null,
  hashes          bigint not null,
  ms              integer not null,
  est_kwh         numeric(18, 9) not null,
  immutable_check char(64) not null,
  constraint ledger_prev_hash_hex check (prev_hash ~ '^[0-9a-f]{64}$'),
  constraint ledger_immutable_check_hex check (immutable_check ~ '^[0-9a-f]{64}$'),
  constraint ledger_hashes_nonneg check (hashes >= 0),
  constraint ledger_ms_range check (ms >= 0 and ms <= 30000),
  constraint ledger_est_kwh_nonneg check (est_kwh >= 0)
);

create index if not exists ledger_ts_idx on public.ledger (ts);
create index if not exists ledger_player_seq_idx on public.ledger (player_id, seq desc);

-- Append-only enforcement. This fires for every role, service_role included:
-- the ledger cannot be rewritten even with the deploy's own credentials.
create or replace function public.ledger_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'ledger is append-only: % on entry_id % is refused', tg_op, coalesce(old.entry_id::text, '?')
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists ledger_no_update_or_delete on public.ledger;
create trigger ledger_no_update_or_delete
  before update or delete on public.ledger
  for each row execute function public.ledger_append_only();

-- --------------------------------------------------------- guardian_tokens --

-- One token per verified find. The entry_id UNIQUE constraint is the mint rule:
-- a ledger entry can never mint twice.
create table if not exists public.guardian_tokens (
  token_id   uuid primary key default gen_random_uuid(),
  entry_id   uuid not null unique references public.ledger (entry_id) on delete restrict,
  est_kwh    numeric(18, 9) not null,
  minted_at  timestamptz not null default now(),
  constraint guardian_tokens_est_kwh_nonneg check (est_kwh >= 0)
);

create index if not exists guardian_tokens_minted_idx on public.guardian_tokens (minted_at);

drop trigger if exists guardian_tokens_no_update_or_delete on public.guardian_tokens;
create trigger guardian_tokens_no_update_or_delete
  before update or delete on public.guardian_tokens
  for each row execute function public.ledger_append_only();

-- ------------------------------------------------------------- rate_events --

-- Sliding-window counters for the per-player and per-IP limits. Unlike the
-- ledger these rows are disposable and are pruned after 24 h.
create table if not exists public.rate_events (
  event_id bigserial primary key,
  bucket   text not null,
  ts       timestamptz not null default now()
);

create index if not exists rate_events_bucket_ts_idx on public.rate_events (bucket, ts desc);
create index if not exists rate_events_ts_idx on public.rate_events (ts);

-- ------------------------------------------------------------ lockdown ------

-- Every table is reachable only through the service-role key held by the
-- Netlify functions. RLS is enabled with no policies, so anon/authenticated get
-- nothing even if a key leaks into the browser bundle.
alter table public.accounts        enable row level security;
alter table public.challenges      enable row level security;
alter table public.ledger          enable row level security;
alter table public.guardian_tokens enable row level security;
alter table public.rate_events     enable row level security;

revoke all on public.accounts        from anon, authenticated;
revoke all on public.challenges      from anon, authenticated;
revoke all on public.ledger          from anon, authenticated;
revoke all on public.guardian_tokens from anon, authenticated;
revoke all on public.rate_events     from anon, authenticated;

revoke all on sequence public.ledger_seq_seq          from anon, authenticated;
revoke all on sequence public.rate_events_event_id_seq from anon, authenticated;
