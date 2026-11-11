# PitStop

SaaS B2B multi-tenant de gestão para oficinas mecânicas: triagem de sintomas, ordens de serviço, orçamento com aprovação digital, portal do cliente e painel central de provisionamento.

A triagem e as sugestões ao mecânico são **determinísticas** (catálogo curado + histórico da própria oficina). Não há IA no caminho crítico: o produto funciona inteiro sem ela. A especificação completa está em [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md).

> Esta é a versão 2 do projeto. A versão anterior (PitStop Triage, triagem para o motorista com OpenAI, projeto do curso Ford Enter) está preservada na branch `tcc-ford-enter`.

Como usar o sistema depois de instalado: [`docs/GUIA-DE-USO.md`](docs/GUIA-DE-USO.md).

## O que tem aqui

| Pasta                   | O que é                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `apps/api`              | Backend NestJS (monólito modular), API em `/api/v1`                                       |
| `apps/web`              | App da oficina (Angular 19, PWA) + portal do cliente (`/portal/:token`) + triagem pública |
| `apps/admin`            | Painel Super Admin (Angular 19), deploy separado                                          |
| `libs/front`            | Base compartilhada dos frontends: sessão, interceptor, guards, formatação, estilos        |
| `packages/shared-types` | Contratos TypeScript compartilhados entre backend e frontends                             |
| `supabase/migrations`   | Schema, RLS, hook de custom claims e seed do catálogo de sintomas                         |
| `e2e`                   | Teste de aceite ponta a ponta no navegador (Playwright)                                   |

### Módulos da Fase 1 (MVP)

- **Autenticação e RBAC**: Supabase Auth com `tenant_id` e `role` no JWT; papéis owner, manager, receptionist e mechanic.
- **CRM**: clientes e veículos, busca por telefone e placa, exportação e anonimização (LGPD).
- **Triagem**: cinco etapas no balcão (carro, mapa 3D das zonas do veículo, sintomas, detalhes e resumo) e link público para o cliente preencher em casa.
- **Motor de diagnóstico determinístico**: causas ranqueadas (50% catálogo + 50% histórico da oficina), verificações e peças com preço da oficina; snapshot imutável por OS.
- **Ordens de serviço**: quadro kanban com arrastar e soltar, workflow validado no backend, timeline auditada.
- **Orçamento**: versões, envio por link tokenizado, mensagem pronta e link `wa.me`.
- **Portal do cliente**: acompanhamento, aprovação ou recusa e histórico do veículo, com DTO dedicado.
- **Painel Super Admin**: provisionamento de oficinas, planos, feature flags, limites, suspensão, sessão de suporte e auditoria.

### Módulos das Fases 2 a 4

Cada um é ligado por oficina no painel admin (feature flag); o plano define o padrão.

- **Avisos ao cliente** (`whatsapp`): textos por oficina para "orçamento pronto", "novidade no serviço" e "veículo pronto", mensagem pronta com link `wa.me` e link de acompanhamento. Envio automático opcional pela API oficial do WhatsApp (Meta Cloud API), sempre depois do commit e com registro em `notification_log`: uma falha de envio nunca derruba a operação.
- **Agenda** (`schedule`): agendamentos por dia, com bloqueio de conflito por box e por mecânico.
- **Estoque** (`inventory`): itens com saldo, mínimo e movimentações. Peça de OS ligada ao estoque dá baixa automática na conclusão, na mesma transação.
- **Financeiro** (`financial`): contas a receber e a pagar. Toda OS concluída gera a conta a receber (uma por OS).
- **Indicadores**: faturamento, ticket médio, conversão de orçamentos, serviços que mais rendem, por mecânico e por mês.
- **IA opcional** (`ai`): com `OPENAI_API_KEY` definida, acrescenta um resumo em linguagem simples ao painel de sugestões. Só seguem para o provedor nomes de sintomas, causas e a marca. O motor determinístico continua sendo a fonte de verdade e funciona igual sem a chave.

Fora do escopo desta versão: multi-filial, white-label e migração para infraestrutura própria (VPS). O envio automático pelo WhatsApp e o resumo por IA estão cobertos por testes com o provedor simulado, mas não foram exercitados contra as APIs reais da Meta e da OpenAI.

## Rodando local

Pré-requisitos: Node.js 22+, npm 10 e Docker (para o Postgres).

```bash
npm ci
cp .env.example .env          # ajuste se quiser; o padrão já funciona local
npm run db:up                 # Postgres em localhost:54329
set -a && source .env && set +a
npm run db:migrate            # aplica supabase/migrations
npm run seed:dev              # oficina demo + usuários

npm run dev:api               # http://localhost:3000/api/v1
npm run dev:web               # http://localhost:4200  (app da oficina e portal)
npm run dev:admin             # http://localhost:4300  (painel admin)
```

Em desenvolvimento o backend usa `AUTH_PROVIDER=local` (usuários no próprio Postgres), então não é preciso um projeto Supabase. Esse provedor é recusado com `NODE_ENV=production`.

Usuários do seed (senha `pitstop-dev-123`):

| Onde            | Login                                                           |
| --------------- | --------------------------------------------------------------- |
| Painel admin    | `admin@pitstop.local`                                           |
| App da oficina  | `dono@demo.local`, `recepcao@demo.local`, `mecanico@demo.local` |
| Triagem pública | `http://localhost:4200/triagem/oficina-demo`                    |

## Testes e qualidade

```bash
npm run lint            # ESLint (TypeScript + Angular + templates)
npm run format:check    # Prettier
npm run typecheck
npm test                # backend: unitários, integração e isolamento RLS (precisa do Postgres)
npm run test:cov        # o mesmo, exigindo as metas de cobertura
npm run test:web        # frontends: Karma/Jasmine, com cobertura do app da oficina
npm run test:e2e        # aceite do MVP no navegador (API, web e admin rodando com o seed)
npm run check           # tudo acima, menos o E2E, mais os builds
```

- Metas de cobertura da especificação, verificadas no CI: backend com 70% de linhas no geral e 100% nos fluxos críticos (guards de autenticação, tokens, transição de status e portal); app da oficina com 50% de linhas. Hoje estão em cerca de 95% e 97%.
- Os testes de integração recriam o banco `pitstop_test` e aplicam as migrations reais. Para outro Postgres: `TEST_DATABASE_URL=postgres://...`.
- O E2E (`e2e/acceptance.mjs`) percorre o checklist da seção 18 da especificação: cadastro, triagem, OS, diagnóstico ignorando as sugestões, orçamento, aprovação pelo portal, entrega, histórico do veículo e suspensão/reativação pelo admin. Na primeira vez: `npx playwright install chromium` (ou use o Chrome já instalado com `PW_CHANNEL=chrome`). Com `E2E_SCREENSHOTS=pasta` ele salva capturas de cada etapa.
- O CI (`.github/workflows/ci.yml`) roda lint, formato, tipos, testes do backend, testes e builds dos frontends, o E2E e o build da imagem Docker em todo PR e em push para `main` e `develop`.

## Deploy

| Parte          | Onde                   | Como                                                                                                         |
| -------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| Banco e Auth   | Supabase               | `supabase db push` aplica `supabase/migrations`. Ative o Custom Access Token Hook (abaixo).                  |
| Backend        | Render ou Railway      | `render.yaml` (plano gratuito) ou `railway.json`, ambos apontando para `apps/api/Dockerfile`.                |
| App da oficina | Vercel                 | Projeto com Root Directory `apps/web`; o `vercel.json` de lá instala e compila a partir da raiz do monorepo. |
| Painel admin   | Vercel (outro projeto) | Root Directory `apps/admin`, em domínio próprio (`admin.<domínio>`).                                         |

Passos que dependem das suas contas:

1. **Supabase**: crie o projeto, rode as migrations e, em Authentication → Hooks, selecione a função `public.custom_access_token_hook` como Custom Access Token Hook. É ela que coloca `tenant_id`, `role` e `is_super_admin` no JWT.
2. **Primeiro super admin**: crie o usuário no Supabase Auth e insira o e-mail em `public.super_admins`.
3. **Backend (Render ou Railway)**: defina `AUTH_PROVIDER=supabase`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_JWT_SECRET`, `CORS_ORIGINS`, `PORTAL_BASE_URL` e, se quiser, `DPO_CONTACT_EMAIL` (contato do encarregado mostrado na política de privacidade), `WHATSAPP_API_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` (envio automático; os modelos aprovados na Meta recebem, nesta ordem, cliente, oficina, veículo, placa, status e link) e `OPENAI_API_KEY` (resumo por IA). No Render, use a conexão do pooler do Supabase (Session pooler), porque a conexão direta é só IPv6. No plano gratuito do Render o serviço hiberna após 15 minutos sem acesso e a primeira requisição seguinte demora perto de um minuto.
4. **Vercel**: os dois `vercel.json` repassam `/api` para o backend de staging (`pitstop-api-ct5p.onrender.com`). Ao criar outro ambiente, troque esse domínio pelo do backend correspondente.
5. O painel admin abre a sessão de suporte no endereço definido em `PORTAL_BASE_URL` do backend, que é também a base dos links do portal do cliente.

A imagem do backend é a mesma para Render, Railway ou VPS com Coolify:

```bash
docker build -f apps/api/Dockerfile -t pitstop-api .
```

## Segurança, em resumo

- Isolamento por tenant no banco (RLS em todas as tabelas de negócio), com teste automatizado por tabela.
- `service_role` só no backend. Os frontends nunca falam com o Supabase para operações de negócio.
- Tokens do portal: UUID v4 entregue ao cliente, hash SHA-256 no banco, com expiração, revogação e finalidade.
- Rate limit global e reforçado em login e portal; Helmet; CORS por origem; validação de payload em todos os endpoints.
- LGPD: consentimento registrado no primeiro acesso ao portal, exportação e anonimização por cliente.

## Convenções

TypeScript em todo o monorepo, Prettier + ESLint, Conventional Commits, branches `main` (produção), `develop` (staging) e `feature/*`. IDs UUID v4, timestamps `TIMESTAMPTZ` em UTC, migrations SQL versionadas em `supabase/migrations/`, segredos apenas em variáveis de ambiente.
