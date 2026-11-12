-- Configurações da plataforma (hoje: servidor de e-mail) e links de conta (convite e redefinição de senha).
-- Tabelas administrativas: RLS ligado e nenhuma política — só o backend, com papel privilegiado, enxerga.

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table public.account_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null,
  email text not null,
  purpose text not null check (purpose in ('invite', 'reset')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index account_links_user_idx on public.account_links (user_id, created_at desc);

alter table public.platform_settings enable row level security;
alter table public.account_links enable row level security;
revoke all on public.platform_settings, public.account_links from anon, public, authenticated;
grant all on public.platform_settings, public.account_links to service_role;

create trigger platform_settings_set_updated_at before update on public.platform_settings
  for each row execute function public.set_updated_at();
create trigger account_links_set_updated_at before update on public.account_links
  for each row execute function public.set_updated_at();
