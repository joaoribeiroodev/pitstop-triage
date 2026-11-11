-- Fases 2 e 3: estoque ligado aos itens da OS, financeiro, agenda e registro de notificações.

-- ───────────────────────── estoque ─────────────────────────
alter table public.inventory_items
  add column if not exists is_active boolean not null default true,
  add column if not exists location text;
create unique index if not exists inventory_items_sku_idx on public.inventory_items (tenant_id, lower(sku)) where sku is not null;
create index if not exists stock_movements_item_idx on public.stock_movements (inventory_item_id, created_at desc);

-- Uma peça da OS pode apontar para um item do estoque: é o que permite a baixa automática na conclusão.
alter table public.service_order_items add column if not exists inventory_item_id uuid;
alter table public.service_order_items
  add constraint service_order_items_inventory_fk foreign key (tenant_id, inventory_item_id)
  references public.inventory_items (tenant_id, id) on delete set null (inventory_item_id);

-- O orçamento carrega o mesmo vínculo, para ele sobreviver à aprovação (os itens do orçamento viram os itens da OS).
alter table public.quote_items add column if not exists inventory_item_id uuid;
alter table public.quote_items
  add constraint quote_items_inventory_fk foreign key (tenant_id, inventory_item_id)
  references public.inventory_items (tenant_id, id) on delete set null (inventory_item_id);

-- ───────────────────────── financeiro ─────────────────────────
alter table public.financial_entries
  add column if not exists counterparty text,
  add column if not exists notes text,
  add column if not exists created_by uuid;
-- No máximo uma conta a receber por OS: a conclusão pode ser repetida sem duplicar o lançamento.
create unique index if not exists financial_entries_order_receivable_idx
  on public.financial_entries (service_order_id) where type = 'receivable' and service_order_id is not null;
create index if not exists financial_entries_due_idx on public.financial_entries (tenant_id, type, due_date);

-- ───────────────────────── agenda ─────────────────────────
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid,
  vehicle_id uuid,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  bay text,
  mechanic_id uuid,
  status text not null default 'scheduled' check (status in ('scheduled', 'confirmed', 'done', 'cancelled', 'no_show')),
  notes text,
  service_order_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete set null (customer_id),
  foreign key (tenant_id, mechanic_id) references public.tenant_users (tenant_id, id) on delete set null (mechanic_id),
  foreign key (tenant_id, vehicle_id) references public.vehicles (tenant_id, id) on delete set null (vehicle_id),
  foreign key (tenant_id, service_order_id) references public.service_orders (tenant_id, id) on delete set null (service_order_id)
);
create index appointments_period_idx on public.appointments (tenant_id, starts_at);

-- ───────────────────────── notificações ─────────────────────────
-- Registro de cada tentativa de aviso ao cliente. Falha de notificação nunca desfaz a operação de negócio: fica anotada aqui.
create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  service_order_id uuid,
  event text not null check (event in ('quote_pending', 'status_update', 'vehicle_ready')),
  channel text not null check (channel in ('whatsapp_link', 'whatsapp_api')),
  recipient text,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, service_order_id) references public.service_orders (tenant_id, id) on delete set null (service_order_id)
);
create index notification_log_order_idx on public.notification_log (service_order_id, created_at desc);

-- ───────────────────────── RLS e updated_at das tabelas novas ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['appointments', 'notification_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy tenant_select on public.%I for select to authenticated using (tenant_id = (select public.current_tenant_id()))', t);
    execute format('create policy tenant_insert on public.%I for insert to authenticated with check (tenant_id = (select public.current_tenant_id()))', t);
    execute format(
      'create policy tenant_update on public.%I for update to authenticated using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()))', t);
    execute format('create policy tenant_delete on public.%I for delete to authenticated using (tenant_id = (select public.current_tenant_id()))', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;
