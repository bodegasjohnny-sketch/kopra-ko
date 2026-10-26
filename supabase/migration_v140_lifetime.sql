-- Kopra Ko v1.4.0 migration: lifetime items (capital + one-off lifetime expenses) + 2 new settings columns.
-- Run AFTER supabase/schema.sql. Idempotent: safe to re-run. Must be applied before turning sync on with app v1.4.0
-- (the app pushes the lifetime_items table and settings."lifeMargin"/"lifeInBid").
create table if not exists lifetime_items (id uuid primary key, team_id uuid not null references teams(id),
  date date, name text not null check (length(btrim(name)) between 1 and 120),
  kind text not null check (kind in ('capital','expense')),
  amount numeric not null check (amount > 0 and amount <= 10000000),
  note text check (length(note) <= 200),
  "paidBy" text check ("paidBy" is null or "paidBy" in ('p1','p2','shared','')));
alter table settings add column if not exists "lifeMargin" numeric check ("lifeMargin" is null or ("lifeMargin" >= 0 and "lifeMargin" <= 20));
alter table settings add column if not exists "lifeInBid" boolean;

-- Same conventions as every other table: server seq + updated_at via kopra_stamp(), soft delete, RLS per team, no hard delete.
do $$ declare t text := 'lifetime_items'; begin
  execute format('alter table %1$I add column if not exists updated_at timestamptz not null default now(), add column if not exists deleted boolean not null default false,
    add column if not exists server_at timestamptz, add column if not exists seq bigint, add column if not exists base_seq bigint;',t);
  execute format('drop trigger if exists %1$s_stamp on %1$I; create trigger %1$s_stamp before insert or update on %1$I for each row execute function public.kopra_stamp();',t);
  execute format('create unique index if not exists %1$s_seq on %1$I(seq); create index if not exists %1$s_team_seq on %1$I(team_id,seq);',t);
  execute format('alter table %1$I enable row level security;',t);
  execute format('drop policy if exists %1$s_member_rw on %1$I;
    create policy %1$s_member_rw on %1$I for all to authenticated using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));',t);
  execute format('revoke all on %1$I from anon; revoke delete, truncate on %1$I from authenticated; grant select, insert, update on %1$I to authenticated;',t);
end $$;
