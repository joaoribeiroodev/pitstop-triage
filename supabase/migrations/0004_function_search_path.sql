-- Fixa o search_path das funções auxiliares (recomendação do linter de segurança do Supabase):
-- sem isso, um schema colocado à frente no search_path da sessão poderia sombrear o que elas chamam.
-- Todas já usam nomes qualificados (auth.jwt) ou funções de pg_catalog, então o caminho vazio não muda o comportamento.
alter function public.current_tenant_id() set search_path = '';
alter function public.current_app_role() set search_path = '';
alter function public.set_updated_at() set search_path = '';
alter function public.forbid_mutation() set search_path = '';
