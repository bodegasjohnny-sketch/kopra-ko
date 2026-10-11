#!/bin/bash
# Applies supabase/schema.sql to a throwaway local Postgres (stubbed auth schema) and checks trigger ordering, clock-skew, RLS, caps.
set -e;cd "$(dirname "$0")/..";BIN=/usr/lib/postgresql/17/bin;D=$(mktemp -d);PORT=55432
$BIN/initdb -D $D -U postgres >/dev/null;$BIN/pg_ctl -D $D -o "-p $PORT -k $D" -l $D/log start >/dev/null;trap "$BIN/pg_ctl -D $D stop >/dev/null;rm -rf $D" EXIT
Q(){ psql -h $D -p $PORT -U postgres -v ON_ERROR_STOP=1 -qtA "$@"; }
Q <<'SQL'
create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub',true),'')::uuid $$;
grant usage on schema public, auth to authenticated, anon;grant execute on function auth.uid() to authenticated;
SQL
Q -f supabase/schema.sql >/dev/null 2>&1; Q -f supabase/schema.sql >/dev/null 2>&1   # run twice: must be idempotent
Q <<'SQL'
insert into auth.users values ('00000000-0000-0000-0000-00000000000a','j@x'),('00000000-0000-0000-0000-00000000000b','b@x'),('00000000-0000-0000-0000-00000000000c','eve@x');
insert into teams(id,name) values ('11111111-1111-1111-1111-111111111111','JB'),('22222222-2222-2222-2222-222222222222','Other');
insert into team_members values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000a','owner',.5),('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000b','partner',.5),('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-00000000000c','owner',1);
SQL
set +e;pass=0;fail=0;ok(){ if [ "$2" == "$3" ]; then echo "PASS $1";pass=$((pass+1)); else echo "FAIL $1 (got '$2' want '$3')";fail=$((fail+1)); fi; }
AS(){ Q -c "set role authenticated; set request.jwt.sub='$1'; $2" 2>&1 | tail -1; }
AE(){ Q -c "set role authenticated; set request.jwt.sub='$1'; $2" 2>&1 | tr "\n" " "; }
J=00000000-0000-0000-0000-00000000000a;B=00000000-0000-0000-0000-00000000000b;E=00000000-0000-0000-0000-00000000000c;T=11111111-1111-1111-1111-111111111111;ID=aaaaaaaa-0000-0000-0000-000000000001
UP(){ echo "insert into batches(id,team_id,no,\"rawKg\",\"buyTotal\",source,updated_at,deleted,base_seq) values ('$1','$T',1,100,900,'$2','$3',$4,$5) on conflict(id) do update set source=excluded.source,updated_at=excluded.updated_at,deleted=excluded.deleted,base_seq=excluded.base_seq returning source"; }
SEQ(){ Q -c "select seq from batches where id='$ID'"; }
ok "insert accepted" "$(AS $J "$(UP $ID v1 2030-01-01T00:00:00Z false null)")" "v1"
ok "server stamps updated_at (client's 2030 ignored)" "$(Q -c "select updated_at < now()+interval '1 minute' from batches where id='$ID'")" "t"
S1=$(SEQ);ok "server assigns seq" "$([ -n "$S1" ] && echo y)" "y"
ok "edit on current base_seq accepted" "$(AS $B "$(UP $ID v2-B 2026-10-11T10:00:00Z false $S1)")" "v2-B"
S2=$(SEQ);ok "seq is monotonic" "$([ $S2 -gt $S1 ] && echo y)" "y"
# Phone A clock is +1h and A edits from the OLD version (base_seq=S1): must be rejected regardless of its later timestamp
ok "CLOCK SKEW: phone A (+1h) stale edit rejected, returns no row" "$(AS $J "$(UP $ID v-A-skewed 2026-10-11T11:00:00Z false $S1)")" ""
ok "CLOCK SKEW: B's edit kept" "$(Q -c "select source from batches where id='$ID'")" "v2-B"
ok "rejected write does not consume/move seq on row" "$(SEQ)" "$S2"
ok "A rebased on S2 is accepted" "$(AS $J "$(UP $ID v3-A 2026-10-11T11:00:00Z false $S2)")" "v3-A"
S3=$(SEQ)
ok "delete accepted even from stale base" "$(AS $B "$(UP $ID v3-A 2026-10-11T09:00:00Z true $S1)")" "v3-A"
ok "tombstone sticky (undelete w/ current base rejected)" "$(AS $J "$(UP $ID zombie 2026-10-11T12:00:00Z false $(SEQ))"; Q -c "select deleted from batches where id='$ID'")" "t"
ID2=aaaaaaaa-0000-0000-0000-000000000002;ID3=aaaaaaaa-0000-0000-0000-000000000003
AS $J "$(UP $ID2 x2 2026-10-11T10:00:00Z false null)" >/dev/null;AS $J "$(UP $ID3 x3 2026-10-11T10:00:00Z false null)" >/dev/null;S_2=$(Q -c "select seq from batches where id='$ID2'");S_3=$(Q -c "select seq from batches where id='$ID3'")
AS $B "update batches set source='x3-B', base_seq=$S_3 where id='$ID3'" >/dev/null
ok "multi-row upsert: fresh row returned, stale row omitted" "$(AS $J "insert into batches(id,team_id,no,\"rawKg\",\"buyTotal\",source,base_seq) values ('$ID2','$T',1,100,900,'x2-A',$S_2),('$ID3','$T',1,100,900,'x3-A',$S_3) on conflict(id) do update set source=excluded.source,base_seq=excluded.base_seq returning source" | tr "\n" , | sed "s/,$//")" "x2-A"
ok "partner B can read team rows" "$(AS $B "select count(*) from batches")" "3"
ok "outsider cannot read (RLS)" "$(AS $E "select count(*) from batches")" "0"
ok "outsider cannot insert into team (RLS)" "$(AE $E "$(UP aaaaaaaa-0000-0000-0000-000000000009 x 2026-10-11T10:00:00Z false null)" | grep -c 'row-level security')" "1"
ok "anon (logged out) denied" "$(Q -c "set role anon; select count(*) from batches" 2>&1 | grep -c 'permission denied')" "1"
ok "hard delete blocked" "$(AE $J "delete from batches where id='$ID2'" | grep -c 'permission denied')" "1"
ok "team_id cannot be changed" "$(AE $J "update batches set team_id='22222222-2222-2222-2222-222222222222', base_seq=seq where id='$ID2'" | grep -cE 'cannot change|row-level')" "1"
ok "cap: rawKg 300,000 rejected by DB" "$(AE $J "insert into batches(id,team_id,no,\"rawKg\",\"buyTotal\") values (gen_random_uuid(),'$T',2,300000,1000)" | grep -c 'check constraint')" "1"
ok "cap: sale price 500 rejected by DB" "$(AE $J "insert into sales(id,team_id,batch_id,kg,price) values (gen_random_uuid(),'$T','$ID2',1,500)" | grep -c 'check constraint')" "1"
ok "authenticated cannot nextval the sequence" "$(AE $J "select nextval('public.kopra_seq')" | grep -c 'permission denied')" "1"
ok "authenticated cannot write team_members" "$(AE $E "insert into team_members values ('$T','$E','owner',1)" | grep -c 'permission denied')" "1"
ok "v1.3 uling_sales insert by member" "$(AS $J "insert into uling_sales(id,team_id,kg,price) values (gen_random_uuid(),'$T',100,31) returning kg")" "100"
ok "v1.3 uling_sales outsider blocked (RLS)" "$(AS $E "select count(*) from uling_sales")" "0"
ok "v1.3 uling_sales price cap" "$(AE $J "insert into uling_sales(id,team_id,kg,price) values (gen_random_uuid(),'$T',1,500)" | grep -c 'check constraint')" "1"
ok "v1.3 uling_sales gets server seq" "$(Q -c "select count(*) from uling_sales where seq is not null")" "1"
echo "SQL: $pass passed, $fail failed";[ $fail -eq 0 ]
