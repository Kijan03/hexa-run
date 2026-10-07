-- Supabase Dashboard > Authentication > Providers > "Allow anonymous sign-ins" 활성화 필요
-- 크루 값: RED = Pulse, BLUE = Flow, GREEN = Surge

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  team text not null check (team in ('RED', 'BLUE', 'GREEN')),
  has_starter_buff boolean not null default false
);

create table if not exists public.hex_tiles (
  h3_index varchar(15) primary key,
  owner_team text not null check (owner_team in ('RED', 'BLUE', 'GREEN')),
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.hex_tiles enable row level security;

create policy "users_select_own" on public.users
  for select to authenticated using (auth.uid() = id);
create policy "users_insert_own" on public.users
  for insert to authenticated with check (auth.uid() = id);
create policy "users_update_own" on public.users
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "tiles_select_all" on public.hex_tiles
  for select to authenticated using (true);
create policy "tiles_insert_auth" on public.hex_tiles
  for insert to authenticated with check (true);
create policy "tiles_update_auth" on public.hex_tiles
  for update to authenticated using (true) with check (true);

-- 크루 자동 배정용: RLS 때문에 클라이언트는 다른 유저 행을 읽을 수 없으므로
-- 크루별 인원수만 반환하는 보안 함수를 제공한다.
create or replace function public.get_crew_counts()
returns table (team text, member_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.team, count(u.id)::bigint as member_count
  from (values ('RED'), ('BLUE'), ('GREEN')) as t(team)
  left join public.users u on u.team = t.team
  group by t.team;
$$;

revoke all on function public.get_crew_counts() from public;
grant execute on function public.get_crew_counts() to authenticated;

-- ============================================================
-- [기존 DB 마이그레이션] 이미 테이블을 만든 경우에만 아래 블록을 실행
-- (YELLOW → GREEN 전환, 버프 컬럼 추가). 새로 만든 DB는 위 내용만으로 충분하다.
-- ============================================================
-- alter table public.users add column if not exists has_starter_buff boolean not null default false;
-- alter table public.users drop constraint if exists users_team_check;
-- alter table public.hex_tiles drop constraint if exists hex_tiles_owner_team_check;
-- update public.users set team = 'GREEN' where team = 'YELLOW';
-- update public.hex_tiles set owner_team = 'GREEN' where owner_team = 'YELLOW';
-- alter table public.users add constraint users_team_check check (team in ('RED', 'BLUE', 'GREEN'));
-- alter table public.hex_tiles add constraint hex_tiles_owner_team_check check (owner_team in ('RED', 'BLUE', 'GREEN'));
