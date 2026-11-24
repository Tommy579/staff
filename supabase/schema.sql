-- Staff Auto BDE Polytech : a coller dans Supabase > SQL Editor > Run.
-- Change le mot de passe BDE ci-dessous avant d'executer.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.bde_state (
  id text primary key default 'main',
  config jsonb not null,
  schedule jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.bde_auth (
  id text primary key default 'main',
  password_hash text not null
);

alter table public.bde_state enable row level security;
alter table public.bde_auth enable row level security;

-- Lecture publique du planning, aucune ecriture directe.
drop policy if exists "bde_state_read" on public.bde_state;
create policy "bde_state_read" on public.bde_state
  for select to anon, authenticated using (true);
-- bde_auth : aucune policy, donc inaccessible depuis le navigateur.

insert into public.bde_auth (id, password_hash)
values ('main', extensions.crypt('polytech-bde-2026', extensions.gen_salt('bf')))
on conflict (id) do update set password_hash = excluded.password_hash;

create or replace function public.save_bde_state(p_password text, p_config jsonb, p_schedule jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_now timestamptz := now();
begin
  select password_hash into v_hash from public.bde_auth where id = 'main';
  if v_hash is null or p_password is null or extensions.crypt(p_password, v_hash) <> v_hash then
    raise exception 'Mot de passe BDE incorrect' using errcode = '28P01';
  end if;

  if jsonb_typeof(p_config->'settings') <> 'object'
     or jsonb_typeof(p_config->'members') <> 'array'
     or jsonb_typeof(p_config->'roles') <> 'array'
     or pg_column_size(p_config) > 262144
     or pg_column_size(coalesce(p_schedule, '{}'::jsonb)) > 524288 then
    raise exception 'Configuration invalide' using errcode = '22023';
  end if;

  insert into public.bde_state (id, config, schedule, updated_at)
  values ('main', p_config, p_schedule, v_now)
  on conflict (id) do update
    set config = excluded.config, schedule = excluded.schedule, updated_at = excluded.updated_at;

  return v_now;
end;
$$;

revoke all on function public.save_bde_state(text, jsonb, jsonb) from public;
grant execute on function public.save_bde_state(text, jsonb, jsonb) to anon, authenticated;
