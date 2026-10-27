-- Kopra Ko v1.5.0 split trackers. NOT applied. Run in the Supabase SQL editor (after migration_v140_lifetime.sql)
-- BEFORE turning sync on with v1.5.0, because sync sends these optional columns.
-- Additive and idempotent: only adds nullable columns, nothing is dropped or rewritten.
alter table batches add column if not exists "paidBy" text check ("paidBy" is null or "paidBy" in ('p1','p2','shared'));
alter table batches add column if not exists "dryDate" date;
alter table sales add column if not exists "receivedBy" text check ("receivedBy" is null or "receivedBy" in ('p1','p2','shared'));
