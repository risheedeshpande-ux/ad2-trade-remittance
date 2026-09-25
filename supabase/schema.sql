-- AD2 Trade Remittance: the state store in Supabase.
-- Run once: Supabase dashboard → SQL Editor → New query → paste this → Run.

create table if not exists public.ad2_state (
  id          text primary key,           -- one row per demo (STATE_PREFIX, default 'ad2-trade')
  doc         jsonb not null,             -- the whole platform state
  etag        text not null,              -- changes on every write; an update only lands on the etag it read
  updated_at  timestamptz not null default now()
);

-- Only the server may read or write it, with the service role (secret) key.
-- Row level security is on and no policy lets the public (anon) or signed-in
-- (authenticated) roles see a thing; the service role bypasses it.
alter table public.ad2_state enable row level security;
revoke all on table public.ad2_state from anon, authenticated;
