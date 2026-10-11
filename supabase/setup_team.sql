-- Run AFTER schema.sql, and AFTER both users exist in Authentication → Users
-- (create them with "Add user" or "Invite user" — do NOT enable public sign-ups).
-- Team members (both get full read/write access to all Kopra Ko data):
--   bodegas.juvy@gmail.com   – inputs data (owner)
--   jcb_ece2005@yahoo.com    – brother, oversees (partner)
with t as (
  insert into public.teams(name) values ('JB Copra') returning id
)
insert into public.team_members(team_id, user_id, role, share)
select t.id, u.id,
       case when lower(u.email) = 'bodegas.juvy@gmail.com' then 'owner' else 'partner' end,
       0.5
from t join auth.users u on lower(u.email) in ('bodegas.juvy@gmail.com', 'jcb_ece2005@yahoo.com')
returning team_id, user_id, role;
-- Expect 2 rows. Copy team_id into the app (Backup → Cloud sync, opened with ?sync=1) on each phone.
-- Check: select u.email, m.role from public.team_members m join auth.users u on u.id=m.user_id;
-- Note: "share" here is only a label; the app's profit split is set in Settings (50/50).
