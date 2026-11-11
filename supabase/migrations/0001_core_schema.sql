-- PitStop — schema base (Fase 1 + estruturas das fases seguintes).
-- Convenções: PK uuid, tenant_id em toda tabela de negócio, created_at/updated_at timestamptz,
-- FKs compostas (tenant_id, id) para impedir referência cruzada entre tenants.

-- ───────────────────────── helpers ─────────────────────────
create or replace function public.current_tenant_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid
$$;

create or replace function public.current_app_role() returns text
language sql stable as $$
  select auth.jwt() -> 'app_metadata' ->> 'role'
$$;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ───────────────────────── núcleo multi-tenant ─────────────────────────
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  document text,
  contact_name text,
  contact_email text,
  contact_phone text,
  status text not null default 'active' check (status in ('active', 'suspended', 'expired')),
  plan text not null default 'basic' check (plan in ('basic', 'pro', 'enterprise')),
  is_trial boolean not null default false,
  expires_at timestamptz,
  suspended_at timestamptz,
  feature_flags jsonb not null default '{}'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'receptionist', 'mechanic')),
  full_name text not null,
  email text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index tenant_users_tenant_idx on public.tenant_users (tenant_id);

create table public.super_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete set null,
  tenant_slug text,
  super_admin_email text not null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index tenant_audit_log_tenant_idx on public.tenant_audit_log (tenant_id, created_at desc);

create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% é append-only', tg_table_name;
end $$;

create trigger tenant_audit_log_append_only
  before update or delete on public.tenant_audit_log
  for each row execute function public.forbid_mutation();

-- ───────────────────────── CRM ─────────────────────────
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  document text,
  notes text,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index customers_tenant_phone_idx on public.customers (tenant_id, phone);
create index customers_tenant_name_idx on public.customers (tenant_id, lower(name));

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  plate text not null,
  brand text,
  model text,
  year int check (year is null or year between 1900 and 2100),
  color text,
  vin text,
  fuel_type text,
  current_mileage int check (current_mileage is null or current_mileage >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, plate),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict
);
create index vehicles_tenant_plate_idx on public.vehicles (tenant_id, plate);
create index vehicles_customer_idx on public.vehicles (customer_id);

-- ───────────────────────── catálogo global de sintomas ─────────────────────────
create table public.symptom_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  icon text,
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.symptoms (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.symptom_categories (id) on delete restrict,
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  name text not null,
  description text,
  follow_up_questions jsonb not null default '[]'::jsonb,
  probable_causes jsonb not null default '[]'::jsonb,
  recommended_checks jsonb not null default '[]'::jsonb,
  typical_parts jsonb not null default '[]'::jsonb,
  avg_service_minutes int not null default 60 check (avg_service_minutes >= 0),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index symptoms_category_idx on public.symptoms (category_id);

-- ───────────────────────── base de conhecimento da oficina ─────────────────────────
create table public.shop_symptom_stats (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  symptom_code text not null,
  vehicle_brand text not null default '',
  cause_description text not null,
  occurrences int not null default 0 check (occurrences >= 0),
  avg_price numeric(12, 2),
  avg_duration_minutes numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, symptom_code, vehicle_brand, cause_description)
);

create table public.shop_services_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  description text,
  default_price numeric(12, 2) not null default 0 check (default_price >= 0),
  duration_minutes int check (duration_minutes is null or duration_minutes >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shop_services_catalog_tenant_idx on public.shop_services_catalog (tenant_id);

create table public.shop_parts_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  sku text,
  default_price numeric(12, 2) not null default 0 check (default_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shop_parts_catalog_tenant_idx on public.shop_parts_catalog (tenant_id);

-- ───────────────────────── triagem ─────────────────────────
create table public.triage_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid,
  vehicle_id uuid,
  reported_symptoms jsonb not null default '[]'::jsonb,
  free_form_notes text,
  status text not null default 'pending' check (status in ('pending', 'converted', 'archived')),
  source text not null default 'staff' check (source in ('staff', 'public')),
  contact jsonb,
  created_by uuid,
  service_order_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, vehicle_id) references public.vehicles (tenant_id, id) on delete restrict
);
create index triage_sessions_tenant_status_idx on public.triage_sessions (tenant_id, status, created_at desc);

-- ───────────────────────── ordens de serviço ─────────────────────────
create table public.service_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_number int not null,
  customer_id uuid not null,
  vehicle_id uuid not null,
  triage_session_id uuid,
  assigned_mechanic_id uuid,
  status text not null default 'draft' check (
    status in ('draft', 'diagnosis', 'awaiting_approval', 'approved', 'in_progress',
               'completed', 'delivered', 'rejected', 'cancelled')
  ),
  reported_symptoms jsonb not null default '[]'::jsonb,
  free_form_notes text,
  mechanic_diagnosis text,
  confirmed_causes jsonb not null default '[]'::jsonb,
  mechanic_suggestions_snapshot jsonb,
  suggestions_computed_at timestamptz,
  total_amount numeric(12, 2) not null default 0,
  opened_at timestamptz not null default now(),
  diagnosis_started_at timestamptz,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, order_number),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, vehicle_id) references public.vehicles (tenant_id, id) on delete restrict,
  foreign key (tenant_id, triage_session_id) references public.triage_sessions (tenant_id, id) on delete set null (triage_session_id),
  foreign key (tenant_id, assigned_mechanic_id) references public.tenant_users (tenant_id, id) on delete set null (assigned_mechanic_id)
);
create index service_orders_tenant_status_idx on public.service_orders (tenant_id, status);
create index service_orders_vehicle_idx on public.service_orders (vehicle_id);
create index service_orders_mechanic_idx on public.service_orders (tenant_id, assigned_mechanic_id);
create index service_orders_opened_idx on public.service_orders (tenant_id, opened_at desc);

alter table public.triage_sessions
  add constraint triage_sessions_service_order_fk
  foreign key (tenant_id, service_order_id) references public.service_orders (tenant_id, id) on delete set null (service_order_id);

create table public.service_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  service_order_id uuid not null,
  type text not null check (type in ('service', 'part')),
  description text not null,
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  total numeric(14, 2) generated always as (round(quantity * unit_price, 2)) stored,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, service_order_id) references public.service_orders (tenant_id, id) on delete cascade
);
create index service_order_items_order_idx on public.service_order_items (service_order_id);

create table public.service_order_status_history (
  id uuid primary key default gen_random_uuid(),
  -- ordem total da timeline: transições na mesma transação têm o mesmo now(), então não dá para ordenar só por data
  seq bigint generated always as identity,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  service_order_id uuid not null,
  from_status text,
  to_status text not null,
  actor_type text not null default 'staff' check (actor_type in ('staff', 'customer', 'system', 'support')),
  changed_by uuid,
  changed_by_name text,
  note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, service_order_id) references public.service_orders (tenant_id, id) on delete cascade
);
create index service_order_status_history_order_idx on public.service_order_status_history (service_order_id, seq);

create table public.service_order_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  service_order_id uuid not null,
  author_id uuid,
  author_name text,
  body text not null,
  visible_to_customer boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, service_order_id) references public.service_orders (tenant_id, id) on delete cascade
);
create index service_order_notes_order_idx on public.service_order_notes (service_order_id, created_at);

-- ───────────────────────── orçamentos e acesso do cliente ─────────────────────────
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  service_order_id uuid not null,
  version int not null default 1,
  total_amount numeric(12, 2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'rejected', 'expired')),
  sent_at timestamptz,
  responded_at timestamptz,
  responded_via text check (responded_via in ('portal', 'staff')),
  expires_at timestamptz,
  response_notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (service_order_id, version),
  foreign key (tenant_id, service_order_id) references public.service_orders (tenant_id, id) on delete cascade
);
create index quotes_order_idx on public.quotes (service_order_id);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  quote_id uuid not null,
  type text not null check (type in ('service', 'part')),
  description text not null,
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  total numeric(14, 2) generated always as (round(quantity * unit_price, 2)) stored,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, quote_id) references public.quotes (tenant_id, id) on delete cascade
);
create index quote_items_quote_idx on public.quote_items (quote_id);

create table public.customer_access_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  token_hash text not null unique,
  service_order_id uuid not null,
  quote_id uuid,
  purposes text[] not null check (purposes <@ array['view_order', 'approve_quote']::text[] and cardinality(purposes) > 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  consent_at timestamptz,
  last_used_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, service_order_id) references public.service_orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, quote_id) references public.quotes (tenant_id, id) on delete cascade
);
create index customer_access_tokens_order_idx on public.customer_access_tokens (service_order_id);

create table public.customer_consent_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  access_token_id uuid,
  service_order_id uuid,
  policy_version text not null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fipe_cache (
  plate text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

-- ───────────────────────── fase 3: estoque e financeiro (estrutura) ─────────────────────────
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  sku text,
  name text not null,
  quantity_on_hand numeric(12, 2) not null default 0,
  minimum_quantity numeric(12, 2) not null default 0,
  unit_cost numeric(12, 2) not null default 0,
  unit_price numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  inventory_item_id uuid not null,
  type text not null check (type in ('in', 'out', 'adjustment')),
  quantity numeric(12, 2) not null,
  reason text,
  service_order_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, inventory_item_id) references public.inventory_items (tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_order_id) references public.service_orders (tenant_id, id) on delete set null (service_order_id)
);

create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  type text not null check (type in ('receivable', 'payable')),
  description text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  due_date date,
  paid_at timestamptz,
  service_order_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, service_order_id) references public.service_orders (tenant_id, id) on delete set null (service_order_id)
);

-- ───────────────────────── updated_at ─────────────────────────
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'updated_at'
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end $$;
