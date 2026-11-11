-- Row Level Security + Custom Access Token Hook.
-- A barreira entre tenants vive aqui, não na aplicação.

-- ───────────────────────── tabelas de negócio: 4 políticas por tabela ─────────────────────────
do $$
declare
  t text;
  tenant_tables text[] := array[
    'customers', 'vehicles', 'shop_symptom_stats', 'shop_services_catalog', 'shop_parts_catalog',
    'triage_sessions', 'service_orders', 'service_order_items', 'service_order_status_history',
    'service_order_notes', 'quotes', 'quote_items', 'customer_access_tokens', 'customer_consent_log',
    'inventory_items', 'stock_movements', 'financial_entries'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format(
      'create policy tenant_select on public.%I for select to authenticated using (tenant_id = (select public.current_tenant_id()))', t);
    execute format(
      'create policy tenant_insert on public.%I for insert to authenticated with check (tenant_id = (select public.current_tenant_id()))', t);
    execute format(
      'create policy tenant_update on public.%I for update to authenticated using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()))', t);
    execute format(
      'create policy tenant_delete on public.%I for delete to authenticated using (tenant_id = (select public.current_tenant_id()))', t);
  end loop;
end $$;

-- ───────────────────────── tenants: o membro enxerga apenas o próprio tenant, nunca altera ─────────────────────────
alter table public.tenants enable row level security;
revoke all on public.tenants from anon, public, authenticated;
grant select on public.tenants to authenticated;
grant all on public.tenants to service_role;
create policy tenant_self_select on public.tenants for select to authenticated
  using (id = (select public.current_tenant_id()));

-- ───────────────────────── tenant_users: leitura por tenant; escrita só pelo owner ─────────────────────────
-- (mais restrito que o padrão: impede que um mecânico promova a si mesmo via acesso direto ao banco)
alter table public.tenant_users enable row level security;
revoke all on public.tenant_users from anon, public;
grant select, insert, update, delete on public.tenant_users to authenticated;
grant all on public.tenant_users to service_role;
create policy tenant_select on public.tenant_users for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy tenant_insert on public.tenant_users for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_app_role()) = 'owner');
create policy tenant_update on public.tenant_users for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_app_role()) = 'owner')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_app_role()) = 'owner');
create policy tenant_delete on public.tenant_users for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_app_role()) = 'owner');

-- ───────────────────────── catálogo global: somente leitura para autenticados ─────────────────────────
alter table public.symptom_categories enable row level security;
alter table public.symptoms enable row level security;
revoke all on public.symptom_categories, public.symptoms from anon, public, authenticated;
grant select on public.symptom_categories, public.symptoms to authenticated;
grant all on public.symptom_categories, public.symptoms to service_role;
create policy catalog_read on public.symptom_categories for select to authenticated using (true);
create policy catalog_read on public.symptoms for select to authenticated using (true);

-- ───────────────────────── tabelas administrativas: RLS ligado, nenhuma política ─────────────────────────
alter table public.super_admins enable row level security;
alter table public.tenant_audit_log enable row level security;
alter table public.fipe_cache enable row level security;
revoke all on public.super_admins, public.tenant_audit_log, public.fipe_cache from anon, public, authenticated;
grant all on public.super_admins, public.tenant_audit_log, public.fipe_cache to service_role;

-- ───────────────────────── Custom Access Token Hook ─────────────────────────
-- Configure em Supabase > Authentication > Hooks > "Customize Access Token (JWT) Claims".
-- Materializa tenant_id / role / is_super_admin no app_metadata de todo JWT emitido,
-- lendo as tabelas (fonte de verdade) no momento da emissão.
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  meta jsonb := coalesce(event -> 'claims' -> 'app_metadata', '{}'::jsonb);
  membership record;
  user_email text := lower(coalesce(event -> 'claims' ->> 'email', ''));
begin
  meta := meta - 'tenant_id' - 'role' - 'is_super_admin';

  select tu.tenant_id, tu.role into membership
  from public.tenant_users tu
  where tu.user_id = (event ->> 'user_id')::uuid and tu.is_active;

  if found then
    meta := meta || jsonb_build_object('tenant_id', membership.tenant_id, 'role', membership.role);
  end if;

  if exists (select 1 from public.super_admins sa where sa.email = user_email) then
    meta := meta || jsonb_build_object('is_super_admin', true);
  end if;

  claims := jsonb_set(claims, '{app_metadata}', meta);
  return jsonb_set(event, '{claims}', claims);
end $$;

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
