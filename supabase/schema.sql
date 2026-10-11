-- Kopra Ko v1.2 — Supabase schema + RLS. Idempotent: safe to re-run.
-- Ordering is 100% server-side: seq (monotonic bigint) + updated_at = now(). Client clocks are never trusted.
create extension if not exists pgcrypto;

create table if not exists teams (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz default now());
create table if not exists team_members (
  team_id uuid references teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'partner' check (role in ('owner','partner')),
  share numeric not null default 0.5,
  primary key (team_id,user_id));

create or replace function public.is_team_member(t uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.team_members where team_id=t and user_id=auth.uid()) $$;
revoke all on function public.is_team_member(uuid) from public, anon;
grant execute on function public.is_team_member(uuid) to authenticated;

create sequence if not exists public.kopra_seq;

-- Accept/reject + stamp. BEFORE trigger returning NULL skips that row (the rest of a batch upsert still succeeds;
-- PostgREST return=representation omits it, which is how the client detects a rejected push).
create or replace function public.kopra_stamp() returns trigger language plpgsql security definer set search_path=public as
$$ begin
  if tg_op = 'UPDATE' then
    if new.team_id is distinct from old.team_id then raise exception 'team_id cannot change'; end if;
    if old.deleted and not new.deleted then return null; end if;                 -- tombstones are sticky
    if not new.deleted and new.base_seq is distinct from old.seq then return null; end if; -- stale edit (row changed since client read it)
  end if;
  new.seq := nextval('public.kopra_seq');
  new.updated_at := now();
  new.server_at := clock_timestamp();
  -- NOTE: base_seq is NOT cleared on INSERT: in INSERT..ON CONFLICT the BEFORE INSERT trigger runs first and EXCLUDED
  -- must still carry the client's base_seq into the UPDATE branch. It is cleared once a row version is stored via UPDATE.
  if tg_op = 'UPDATE' then new.base_seq := null; end if;
  return new; end $$;

create table if not exists settings (id uuid primary key, team_id uuid not null references teams(id),
  "startDate" date, "copraPrice" numeric check ("copraPrice" > 0 and "copraPrice" <= 200), "targetMargin" numeric check ("targetMargin" between 0 and 5),
  "bagolRatio" numeric check ("bagolRatio" > 0 and "bagolRatio" < 1), "ulingPrice" numeric check ("ulingPrice" > 0 and "ulingPrice" <= 200),
  partners jsonb, budget jsonb);
create table if not exists batches (id uuid primary key, team_id uuid not null references teams(id),
  no int check (no between 1 and 1000000), dev text check (dev ~ '^[A-Z0-9]{1,4}$'), date date, source text check (length(source) <= 120),
  "rawKg" numeric not null check ("rawKg" > 0 and "rawKg" <= 200000), "buyTotal" numeric not null check ("buyTotal" > 0 and "buyTotal" <= 100 * "rawKg"),
  asarez numeric check (asarez >= 0 and asarez <= 100), "copraKg" numeric check ("copraKg" >= 0 and "copraKg" <= "rawKg"));
create table if not exists sales (id uuid primary key, team_id uuid not null references teams(id),
  batch_id uuid references batches(id), date date, kg numeric not null check (kg > 0 and kg <= 200000), price numeric not null check (price > 0 and price <= 200), buyer text check (length(buyer) <= 120));
create table if not exists expenses (id uuid primary key, team_id uuid not null references teams(id),
  batch_id uuid references batches(id), date date, category text not null check (length(category) <= 60), amount numeric not null check (amount > 0 and amount <= 1000000), note text check (length(note) <= 200));
create table if not exists charcoal (id uuid primary key, team_id uuid not null references teams(id),
  no int check (no between 1 and 1000000), dev text check (dev ~ '^[A-Z0-9]{1,4}$'), date date, "bagolKg" numeric check ("bagolKg" > 0 and "bagolKg" <= 100000),
  "ulingKg" numeric check ("ulingKg" >= 0 and "ulingKg" <= "bagolKg"), price numeric check (price > 0 and price <= 200), status text check (status in ('burning','done','sold')), buyer text check (length(buyer) <= 120));

do $$ declare t text; begin
  foreach t in array array['settings','batches','sales','expenses','charcoal'] loop
    execute format('alter table %1$I add column if not exists updated_at timestamptz not null default now(), add column if not exists deleted boolean not null default false,
      add column if not exists server_at timestamptz, add column if not exists seq bigint, add column if not exists base_seq bigint;',t);
    execute format('drop trigger if exists %1$s_server_at on %1$I; drop trigger if exists %1$s_stamp on %1$I;
      create trigger %1$s_stamp before insert or update on %1$I for each row execute function public.kopra_stamp();',t);
    execute format('create unique index if not exists %1$s_seq on %1$I(seq); create index if not exists %1$s_team_seq on %1$I(team_id,seq);',t);
    execute format('alter table %1$I enable row level security;',t);
    execute format('drop policy if exists %1$s_member_all on %1$I; drop policy if exists %1$s_member_rw on %1$I;
      create policy %1$s_member_rw on %1$I for all to authenticated using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));',t);
    execute format('revoke all on %1$I from anon; revoke delete, truncate on %1$I from authenticated; grant select, insert, update on %1$I to authenticated;',t);
  end loop; end $$;
drop function if exists public.set_server_at();

alter table teams enable row level security; alter table team_members enable row level security;
revoke all on teams, team_members from anon; revoke insert, update, delete, truncate on teams, team_members from authenticated; grant select on teams, team_members to authenticated;
drop policy if exists teams_member_read on teams; create policy teams_member_read on teams for select to authenticated using (public.is_team_member(id));
drop policy if exists tm_self_read on team_members; create policy tm_self_read on team_members for select to authenticated using (public.is_team_member(team_id));
revoke usage, select on sequence public.kopra_seq from anon, authenticated;
