-- Run this in your Supabase SQL editor to create the required table

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists daily_entries (
  id uuid default gen_random_uuid() primary key,
  date date not null unique,
  registered_deeds integer not null default 0,
  amount_received numeric(12,2) not null default 0,
  amount_deposited numeric(12,2) default null,
  deposit_date date default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_daily_entries_date on daily_entries(date);

-- Auto-update updated_at on row change
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_daily_entries_updated_at on daily_entries;
create trigger trg_daily_entries_updated_at
  before update on daily_entries
  for each row execute function update_updated_at();

-- ── Disable RLS (single-admin app, no user auth needed) ───────────────────
alter table daily_entries disable row level security;
