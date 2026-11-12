-- A auditoria do painel admin é append-only, mas precisa sobreviver à remoção de uma oficina:
-- a FK `on delete set null` atualiza tenant_id, e o gatilho antigo barrava essa atualização.
-- Resultado: desfazer uma criação de oficina que falhou (ou excluir uma oficina) dava erro e deixava a oficina órfã.
-- Agora a única alteração aceita é exatamente essa: tenant_id indo para null, com todo o resto da linha intacto.
create or replace function public.audit_log_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.tenant_id is null and old.tenant_id is not null
     and (to_jsonb(new) - 'tenant_id') = (to_jsonb(old) - 'tenant_id') then
    return new;
  end if;
  raise exception '% é append-only', tg_table_name;
end $$;

drop trigger if exists tenant_audit_log_append_only on public.tenant_audit_log;
create trigger tenant_audit_log_append_only
  before update or delete on public.tenant_audit_log
  for each row execute function public.audit_log_append_only();
