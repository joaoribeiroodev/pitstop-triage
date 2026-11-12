import { ChangeDetectionStrategy, Component, computed, effect, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, ToastService } from '@front/core';
import { FORMAT_PIPES, localDay, ROLE_LABELS } from '@front/format';
import {
  FEATURE_FLAGS,
  PLAN_DEFAULTS,
  resolveFeatureFlags,
  resolveLimits,
  TENANT_PLANS,
  type AdminMetrics,
  type AdminTenantRow,
  type AuditLogEntry,
  type EmailSettings,
  type FeatureFlag,
  type FeatureFlags,
  type Paginated,
  type Tenant,
  type TenantLimits,
  type TenantPlan,
  type TenantStatus,
  type TenantUser
} from '@pitstop/shared-types';

const PLAN_LABELS: Record<TenantPlan, string> = { basic: 'Básico', pro: 'Pro', enterprise: 'Enterprise' };
const STATUS_LABELS: Record<TenantStatus, string> = { active: 'Ativa', suspended: 'Suspensa', expired: 'Expirada' };
const STATUS_TONES: Record<TenantStatus, string> = { active: 'done', suspended: 'stop', expired: 'wait' };

const FLAG_LABELS: Record<FeatureFlag, string> = {
  triage: 'Triagem de sintomas',
  public_triage: 'Triagem pública (link para o cliente)',
  diagnostics: 'Motor de diagnóstico determinístico',
  portal: 'Portal do cliente',
  whatsapp: 'Avisos ao cliente por WhatsApp',
  schedule: 'Agenda (boxes e mecânicos)',
  inventory: 'Estoque de peças',
  financial: 'Financeiro (contas a receber e a pagar)',
  ai: 'Resumo por IA no diagnóstico (opcional)'
};

const ACTION_LABELS: Record<string, string> = {
  'tenant.created': 'Oficina criada',
  'tenant.updated': 'Oficina alterada',
  'tenant.suspended': 'Oficina suspensa',
  'tenant.reactivated': 'Oficina reativada',
  'tenant.impersonated': 'Acesso de suporte',
  'catalog.reloaded': 'Catálogo recarregado'
};

/**
 * Endereço do app da oficina para abrir a sessão de suporte. O backend informa o endereço público do ambiente
 * (PORTAL_BASE_URL); em desenvolvimento ele aponta para localhost, então vale a porta local do app.
 */
function shopAppUrl(fromBackend?: string): string {
  if (fromBackend && !/\/\/(localhost|127\.0\.0\.1)(:|$)/.test(fromBackend)) return fromBackend.replace(/\/$/, '');
  return `${location.protocol}//${location.hostname}:4200`;
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="row-between">
        <header class="page-head">
          <span class="eyebrow">Clientes do PitStop</span>
          <h1>Oficinas</h1>
        </header>
        <a class="btn btn-primary" routerLink="/tenants/new">Nova oficina</a>
      </div>
      <form class="row" role="search" (ngSubmit)="load(1)">
        <label class="grow"
          >Nome, slug ou CNPJ
          <input name="q" type="search" [(ngModel)]="q" />
        </label>
        <label
          >Situação
          <select name="status" [(ngModel)]="status" (ngModelChange)="load(1)">
            <option value="">Todas</option>
            <option value="active">Ativas</option>
            <option value="suspended">Suspensas</option>
            <option value="expired">Expiradas</option>
          </select>
        </label>
        <button style="align-self: end">Buscar</button>
      </form>

      <div class="sheet sheet-flush table-wrap">
        <table>
          <thead>
            <tr>
              <th>Oficina</th>
              <th>Situação</th>
              <th>Plano</th>
              <th>Expira em</th>
              <th class="right">Usuários</th>
              <th class="right">OS no mês</th>
            </tr>
          </thead>
          <tbody>
            @for (tenant of page()?.data; track tenant.id) {
              <tr [class.row-warn]="tenant.expiring_soon">
                <td>
                  <a [routerLink]="['/tenants', tenant.id]"
                    ><strong>{{ tenant.name }}</strong></a
                  >
                  <br /><small>{{ tenant.slug }}</small>
                </td>
                <td>
                  <span class="status" [attr.data-tone]="tones[tenant.status]">{{ statusLabels[tenant.status] }}</span>
                </td>
                <td>{{ planLabels[tenant.plan] }}{{ tenant.is_trial ? ' (trial)' : '' }}</td>
                <td>
                  {{ tenant.expires_at | day }}
                  @if (tenant.expiring_soon) {
                    <br /><span class="status" data-tone="wait">Expira em menos de 7 dias</span>
                  }
                </td>
                <td class="right num">{{ tenant.users_count }}</td>
                <td class="right num">{{ tenant.orders_this_month }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="empty">
                  {{ q || status ? 'Nenhuma oficina para esse filtro.' : 'Nenhuma oficina provisionada ainda. Crie a primeira.' }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (page(); as p) {
        @if (p.total > p.pageSize) {
          <div class="row-between">
            <button type="button" [disabled]="p.page === 1" (click)="load(p.page - 1)">Anteriores</button>
            <small>{{ p.total }} oficinas, página {{ p.page }}</small>
            <button type="button" [disabled]="p.page * p.pageSize >= p.total" (click)="load(p.page + 1)">Próximas</button>
          </div>
        }
      }
    </div>
  `
})
export class TenantsPage implements OnInit {
  private readonly api = inject(Api);
  readonly page = signal<Paginated<AdminTenantRow> | null>(null);
  readonly planLabels = PLAN_LABELS;
  readonly statusLabels = STATUS_LABELS;
  readonly tones = STATUS_TONES;
  q = '';
  status = '';

  ngOnInit(): void {
    void this.load(1);
  }

  async load(page: number): Promise<void> {
    this.page.set(await this.api.get<Paginated<AdminTenantRow>>('/admin/tenants', { q: this.q, status: this.status, page }));
  }
}

const WIZARD_STEPS = ['Oficina', 'Plano', 'Proprietário', 'Revisão'];

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page page-narrow">
      <div>
        <a routerLink="/tenants">Oficinas</a>
        <h1>Nova oficina</h1>
      </div>
      <ol class="steps" aria-label="Etapas">
        @for (label of steps; track label; let i = $index) {
          <li [class.done]="i < step()" [attr.aria-current]="i === step() ? 'step' : null">{{ label }}</li>
        }
      </ol>

      <form class="sheet stack" (ngSubmit)="next()" #form="ngForm">
        @switch (step()) {
          @case (0) {
            <label>Nome da oficina <input name="name" required minlength="2" maxlength="160" [(ngModel)]="draft.name" (ngModelChange)="suggestSlug()" /></label>
            <label
              >Slug (subdomínio e link de triagem)
              <input
                name="slug"
                required
                minlength="3"
                maxlength="60"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                [(ngModel)]="draft.slug"
                (ngModelChange)="slugTouched = true"
              />
              <small>Só letras minúsculas, números e hífens. Não pode ser alterado depois.</small>
            </label>
            <label>CNPJ <input name="document" inputmode="numeric" maxlength="20" [(ngModel)]="draft.document" /></label>
            <div class="cols-form">
              <label>Nome do contato <input name="contact_name" maxlength="160" [(ngModel)]="draft.contact_name" /></label>
              <label>E-mail de contato <input name="contact_email" type="email" [(ngModel)]="draft.contact_email" /></label>
              <label>Telefone <input name="contact_phone" inputmode="tel" maxlength="30" [(ngModel)]="draft.contact_phone" /></label>
            </div>
          }
          @case (1) {
            <label
              >Plano
              <select name="plan" [(ngModel)]="draft.plan">
                @for (plan of plans; track plan) {
                  <option [value]="plan">{{ planLabels[plan] }}</option>
                }
              </select>
            </label>
            <p class="notice">
              Limites do plano: {{ limits().max_users }} usuários, {{ limits().max_orders_month }} ordens por mês, {{ limits().max_storage_mb }} MB. Módulos e
              limites podem ser ajustados depois, oficina por oficina.
            </p>
            <label class="check"><input type="checkbox" name="is_trial" [(ngModel)]="draft.is_trial" /> Período de teste (trial)</label>
            <label
              >Data de expiração
              <input name="expires_at" type="date" [(ngModel)]="draft.expires_at" />
              <small>Em branco: sem data de expiração.</small>
            </label>
          }
          @case (2) {
            <label>Nome do proprietário <input name="owner_name" required minlength="2" maxlength="120" [(ngModel)]="draft.owner_name" /></label>
            <label>E-mail do proprietário <input name="owner_email" type="email" required [(ngModel)]="draft.owner_email" /></label>
            <label
              >Senha inicial (opcional)
              <input name="owner_password" type="password" minlength="8" autocomplete="new-password" [(ngModel)]="draft.owner_password" />
              <small>Sem senha, o proprietário recebe um convite por e-mail para criar a própria (exige o e-mail da plataforma configurado em E-mail).</small>
            </label>
          }
          @case (3) {
            <h2>Confira antes de criar</h2>
            <div class="cols-form">
              <div><small>Oficina</small><br />{{ draft.name }}</div>
              <div><small>Slug</small><br />{{ draft.slug }}</div>
              <div><small>Plano</small><br />{{ planLabels[draft.plan] }}{{ draft.is_trial ? ' (trial)' : '' }}</div>
              <div><small>Expira em</small><br />{{ draft.expires_at ? (draft.expires_at | day) : 'Sem expiração' }}</div>
              <div><small>Proprietário</small><br />{{ draft.owner_name }}<br />{{ draft.owner_email }}</div>
              <div><small>Acesso</small><br />{{ draft.owner_password ? 'Senha definida agora' : 'Convite por e-mail' }}</div>
            </div>
          }
        }
        <div class="row-between">
          <button type="button" [disabled]="step() === 0" (click)="step.set(step() - 1)">Voltar</button>
          <button class="btn-primary" [disabled]="form.invalid || busy()">{{ step() === 3 ? 'Criar oficina' : 'Continuar' }}</button>
        </div>
      </form>
    </div>
  `
})
export class NewTenantPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly steps = WIZARD_STEPS;
  readonly plans = TENANT_PLANS;
  readonly planLabels = PLAN_LABELS;
  readonly step = signal(0);
  readonly busy = signal(false);
  slugTouched = false;
  draft = {
    name: '',
    slug: '',
    document: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    plan: 'basic' as TenantPlan,
    is_trial: false,
    expires_at: '',
    owner_name: '',
    owner_email: '',
    owner_password: ''
  };

  limits(): TenantLimits {
    return PLAN_DEFAULTS[this.draft.plan].limits;
  }

  suggestSlug(): void {
    if (!this.slugTouched) this.draft.slug = slugify(this.draft.name);
  }

  async next(): Promise<void> {
    if (this.step() < 3) {
      this.step.set(this.step() + 1);
      return;
    }
    this.busy.set(true);
    try {
      const body = Object.fromEntries(Object.entries(this.draft).filter(([, value]) => value !== ''));
      const tenant = await this.api.post<Tenant & { owner_invited: boolean }>('/admin/tenants', body);
      this.toast.ok(tenant.owner_invited ? 'Oficina criada. O convite foi enviado ao proprietário.' : 'Oficina criada');
      await this.router.navigate(['/tenants', tenant.id]);
    } finally {
      this.busy.set(false);
    }
  }
}

type TenantDetail = AdminTenantRow & { users: TenantUser[] };

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tenant(); as t) {
      <div class="page">
        <div>
          <a routerLink="/tenants">Oficinas</a>
          <div class="row-between">
            <h1>{{ t.name }}</h1>
            <span class="status" [attr.data-tone]="tones[t.status]">{{ statusLabels[t.status] }}</span>
          </div>
          <small>{{ t.slug }}, criada em {{ t.created_at | day }}. {{ t.users_count }} usuários, {{ t.orders_this_month }} OS neste mês.</small>
        </div>

        @if (t.expiring_soon) {
          <p class="notice notice-wait">Esta oficina expira em {{ t.expires_at | day }}. Renove a data de expiração para evitar o bloqueio.</p>
        }

        <form class="sheet stack" (ngSubmit)="saveProfile()" #profile="ngForm">
          <h2>Cadastro e plano</h2>
          <div class="cols-form">
            <label>Nome <input name="name" required minlength="2" [(ngModel)]="form.name" /></label>
            <label>CNPJ <input name="document" inputmode="numeric" [(ngModel)]="form.document" /></label>
            <label>Contato <input name="contact_name" [(ngModel)]="form.contact_name" /></label>
            <label>E-mail <input name="contact_email" type="email" [(ngModel)]="form.contact_email" /></label>
            <label>Telefone <input name="contact_phone" inputmode="tel" [(ngModel)]="form.contact_phone" /></label>
            <label
              >Plano
              <select name="plan" [(ngModel)]="form.plan">
                @for (plan of plans; track plan) {
                  <option [value]="plan">{{ planLabels[plan] }}</option>
                }
              </select>
            </label>
            <label>Expira em <input name="expires_at" type="date" [(ngModel)]="form.expires_at" /></label>
          </div>
          <label class="check"><input type="checkbox" name="is_trial" [(ngModel)]="form.is_trial" /> Período de teste (trial)</label>
          <div><button class="btn-primary" [disabled]="profile.invalid">Salvar cadastro</button></div>
        </form>

        <section class="sheet stack">
          <h2>Módulos</h2>
          <div class="flags">
            @for (flag of flags; track flag) {
              <label class="check"
                ><input type="checkbox" [checked]="effectiveFlags()[flag]" (change)="setFlag(flag, $any($event.target).checked)" />
                {{ flagLabels[flag] }}</label
              >
            }
          </div>
          <small>A mudança vale a partir da próxima requisição dos usuários da oficina e fica registrada na auditoria.</small>
        </section>

        <form class="sheet stack" (ngSubmit)="saveLimits()" #limitsForm="ngForm">
          <h2>Limites</h2>
          <div class="cols-form">
            <label>Usuários <input name="max_users" type="number" required min="1" [(ngModel)]="limits.max_users" /></label>
            <label>Ordens por mês <input name="max_orders_month" type="number" required min="1" [(ngModel)]="limits.max_orders_month" /></label>
            <label>Armazenamento (MB) <input name="max_storage_mb" type="number" required min="1" [(ngModel)]="limits.max_storage_mb" /></label>
          </div>
          <div><button [disabled]="limitsForm.invalid">Salvar limites</button></div>
        </form>

        <section class="sheet stack-sm">
          <h2>Usuários da oficina</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Papel</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                @for (user of t.users; track user.id) {
                  <tr>
                    <td>
                      {{ user.full_name }}<br /><small>{{ user.email }}</small>
                    </td>
                    <td>{{ roleLabels[user.role] }}</td>
                    <td>{{ user.is_active ? 'Ativo' : 'Desativado' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <form class="sheet stack" (ngSubmit)="impersonate()" #support="ngForm">
          <h2>Acesso de suporte</h2>
          <p class="muted">Abre o app da oficina como proprietário por tempo limitado. O motivo é obrigatório e fica na auditoria.</p>
          <label>Motivo do acesso <input name="reason" required minlength="5" maxlength="500" [(ngModel)]="supportReason" /></label>
          <div><button [disabled]="support.invalid">Abrir sessão de suporte</button></div>
        </form>

        <section class="sheet stack danger-zone">
          @if (t.status === 'active') {
            <h2>Suspender oficina</h2>
            <p class="muted">Bloqueia o login de todos os usuários imediatamente. Os dados são preservados.</p>
            <form class="stack" (ngSubmit)="suspend()">
              <label
                >Para confirmar, digite o slug <strong>{{ t.slug }}</strong>
                <input name="confirm" autocomplete="off" [(ngModel)]="confirmSlug" />
              </label>
              <label>Motivo (opcional) <input name="suspendReason" maxlength="500" [(ngModel)]="suspendReason" /></label>
              <div><button class="btn-danger" [disabled]="confirmSlug !== t.slug">Suspender oficina</button></div>
            </form>
          } @else {
            <h2>Reativar oficina</h2>
            <p class="muted">
              {{ t.status === 'suspended' ? 'Suspensa em ' + (t.suspended_at | day) + '.' : 'Expirada.' }} A reativação devolve o acesso a todos os usuários
              ativos.
            </p>
            <div><button type="button" class="btn-go" (click)="reactivate()">Reativar oficina</button></div>
          }
        </section>

        <a [routerLink]="['/audit']" [queryParams]="{ tenantId: t.id }">Ver auditoria desta oficina</a>
      </div>
    }
  `
})
export class TenantDetailPage implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  readonly id = input.required<string>();
  readonly tenant = signal<TenantDetail | null>(null);
  readonly plans = TENANT_PLANS;
  readonly flags = FEATURE_FLAGS;
  readonly planLabels = PLAN_LABELS;
  readonly statusLabels = STATUS_LABELS;
  readonly tones = STATUS_TONES;
  readonly flagLabels = FLAG_LABELS;
  readonly roleLabels = ROLE_LABELS;
  readonly effectiveFlags = computed<FeatureFlags>(() => {
    const tenant = this.tenant();
    return resolveFeatureFlags(tenant?.plan ?? 'basic', tenant?.feature_flags);
  });
  form = { name: '', document: '', contact_name: '', contact_email: '', contact_phone: '', plan: 'basic' as TenantPlan, expires_at: '', is_trial: false };
  limits: TenantLimits = { ...PLAN_DEFAULTS.basic.limits };
  supportReason = '';
  confirmSlug = '';
  suspendReason = '';

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const tenant = await this.api.get<TenantDetail>(`/admin/tenants/${this.id()}`);
    this.tenant.set(tenant);
    this.form = {
      name: tenant.name,
      document: tenant.document ?? '',
      contact_name: tenant.contact_name ?? '',
      contact_email: tenant.contact_email ?? '',
      contact_phone: tenant.contact_phone ?? '',
      plan: tenant.plan,
      expires_at: tenant.expires_at ? localDay(tenant.expires_at) : '',
      is_trial: tenant.is_trial
    };
    this.limits = resolveLimits(tenant.plan, tenant.limits);
    this.confirmSlug = '';
    this.suspendReason = '';
  }

  async saveProfile(): Promise<void> {
    const { contact_email, expires_at, ...rest } = this.form;
    await this.api.patch(`/admin/tenants/${this.id()}`, {
      ...rest,
      ...(contact_email ? { contact_email } : {}),
      expires_at: expires_at || null
    });
    this.toast.ok('Cadastro salvo');
    await this.load();
  }

  async setFlag(flag: FeatureFlag, enabled: boolean): Promise<void> {
    try {
      await this.api.patch(`/admin/tenants/${this.id()}`, { feature_flags: { [flag]: enabled } });
      this.toast.ok(`${FLAG_LABELS[flag]}: ${enabled ? 'ligado' : 'desligado'}`);
    } finally {
      await this.load();
    }
  }

  async saveLimits(): Promise<void> {
    await this.api.patch(`/admin/tenants/${this.id()}`, {
      limits: {
        max_users: Number(this.limits.max_users),
        max_orders_month: Number(this.limits.max_orders_month),
        max_storage_mb: Number(this.limits.max_storage_mb)
      }
    });
    this.toast.ok('Limites salvos');
    await this.load();
  }

  async impersonate(): Promise<void> {
    // A aba é aberta antes da chamada para não ser barrada como pop-up; o token viaja no fragmento, fora de logs de servidor.
    const tab = window.open('about:blank', '_blank');
    try {
      const session = await this.api.post<{ access_token: string; app_url?: string }>(`/admin/tenants/${this.id()}/impersonate`, {
        reason: this.supportReason.trim()
      });
      const url = `${shopAppUrl(session.app_url)}/suporte#token=${encodeURIComponent(session.access_token)}`;
      if (tab) tab.location.href = url;
      else location.href = url;
      this.supportReason = '';
    } catch (error) {
      tab?.close();
      throw error;
    }
  }

  async suspend(): Promise<void> {
    await this.api.post(`/admin/tenants/${this.id()}/suspend`, { confirm_slug: this.confirmSlug, reason: this.suspendReason.trim() || undefined });
    this.toast.ok('Oficina suspensa. Os usuários perderam o acesso.');
    await this.load();
  }

  async reactivate(): Promise<void> {
    await this.api.post(`/admin/tenants/${this.id()}/reactivate`);
    this.toast.ok('Oficina reativada');
    await this.load();
  }
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <span class="eyebrow">Visão global</span>
        <h1>Métricas</h1>
      </header>
      @if (data(); as m) {
        <section class="kpis" aria-label="Indicadores globais">
          <div class="sheet kpi">
            <strong class="num">{{ m.tenants_active }}</strong> oficinas ativas
          </div>
          <div class="sheet kpi">
            <strong class="num">{{ m.tenants_trial }}</strong> em trial
          </div>
          <div class="sheet kpi">
            <strong class="num">{{ m.tenants_suspended }}</strong> suspensas
          </div>
          <div class="sheet kpi">
            <strong class="num">{{ m.tenants_expiring_7d }}</strong> expiram em 7 dias
          </div>
          <div class="sheet kpi">
            <strong class="num">{{ m.orders_this_month }}</strong> OS no mês
          </div>
          <div class="sheet kpi">
            <strong class="num">{{ m.active_users }}</strong> usuários ativos
          </div>
        </section>
        <p class="muted">Receita recorrente não aparece aqui: na v1 o licenciamento é manual, sem cobrança pelo sistema.</p>

        <section class="sheet stack">
          <h2>Ordens de serviço por mês</h2>
          <div class="bars" role="img" [attr.aria-label]="chartLabel()">
            @for (point of m.growth; track point.month) {
              <div>
                <div class="track"><div class="bar" [style.height.%]="height(point.orders)"></div></div>
                <strong class="num">{{ point.orders }}</strong>
                <small>{{ monthLabel(point.month) }}</small>
              </div>
            }
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th class="right">Oficinas (acumulado)</th>
                  <th class="right">OS abertas</th>
                </tr>
              </thead>
              <tbody>
                @for (point of m.growth; track point.month) {
                  <tr>
                    <td>{{ monthLabel(point.month) }}</td>
                    <td class="right num">{{ point.tenants }}</td>
                    <td class="right num">{{ point.orders }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    </div>
  `
})
export class MetricsPage implements OnInit {
  private readonly api = inject(Api);
  readonly data = signal<AdminMetrics | null>(null);
  private readonly max = computed(() => Math.max(1, ...(this.data()?.growth ?? []).map((point) => point.orders)));
  readonly chartLabel = computed(
    () => 'Ordens por mês: ' + (this.data()?.growth ?? []).map((point) => `${this.monthLabel(point.month)} ${point.orders}`).join(', ')
  );

  async ngOnInit(): Promise<void> {
    this.data.set(await this.api.get<AdminMetrics>('/admin/metrics'));
  }

  height(orders: number): number {
    return (orders / this.max()) * 100;
  }

  monthLabel(month: string): string {
    const [year, number] = month.split('-');
    return `${number}/${year}`;
  }
}

@Component({
  standalone: true,
  imports: [RouterLink, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="row-between">
        <h1>Auditoria</h1>
        @if (tenantId()) {
          <a class="btn" routerLink="/audit">Ver todas as oficinas</a>
        }
      </div>
      <p class="muted">Registro somente de inclusão de toda ação administrativa.</p>
      <div class="sheet sheet-flush table-wrap">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Quem</th>
              <th>Oficina</th>
              <th>Ação</th>
              <th>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            @for (entry of page()?.data; track entry.id) {
              <tr>
                <td class="num">{{ entry.created_at | moment }}</td>
                <td>{{ entry.super_admin_email }}</td>
                <td>
                  @if (entry.tenant_id) {
                    <a [routerLink]="['/tenants', entry.tenant_id]">{{ entry.tenant_slug }}</a>
                  } @else {
                    —
                  }
                </td>
                <td>{{ actionLabels[entry.action] || entry.action }}</td>
                <td>
                  <pre class="payload">{{ payload(entry) }}</pre>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="empty">Nenhuma ação registrada ainda.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (page(); as p) {
        @if (p.total > p.pageSize) {
          <div class="row-between">
            <button type="button" [disabled]="p.page === 1" (click)="load(p.page - 1)">Mais recentes</button>
            <small>{{ p.total }} registros, página {{ p.page }}</small>
            <button type="button" [disabled]="p.page * p.pageSize >= p.total" (click)="load(p.page + 1)">Mais antigos</button>
          </div>
        }
      }
    </div>
  `
})
export class AuditPage {
  private readonly api = inject(Api);
  /** ?tenantId=<id>: filtra a auditoria de uma oficina. */
  readonly tenantId = input<string>();
  readonly page = signal<Paginated<AuditLogEntry> | null>(null);
  readonly actionLabels = ACTION_LABELS;

  constructor() {
    // recarrega quando o filtro de oficina muda sem trocar de rota
    effect(() => {
      this.tenantId();
      void this.load(1);
    });
  }

  async load(page: number): Promise<void> {
    this.page.set(await this.api.get<Paginated<AuditLogEntry>>('/admin/audit', { tenant_id: this.tenantId(), page }));
  }

  payload(entry: AuditLogEntry): string {
    const keys = Object.keys(entry.payload ?? {});
    return keys.length ? JSON.stringify(entry.payload, null, 1) : '';
  }
}

/** E-mail da plataforma: a conta Gmail que envia convites e redefinições de senha. */
@Component({
  standalone: true,
  imports: [FormsModule, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page">
      <header class="page-head">
        <span class="eyebrow">Plataforma</span>
        <h1>E-mail</h1>
        <p>Convites de acesso e "esqueci minha senha" saem por esta conta do Gmail.</p>
      </header>

      @if (settings(); as current) {
        <p class="notice" [class.notice-done]="current.configured" [class.notice-wait]="!current.configured" role="status">
          @if (current.configured) {
            Configurado: os e-mails saem de <strong>{{ current.user }}</strong> como "{{ current.from_name }}". Atualizado em {{ current.updated_at | moment }}.
          } @else if (current.user) {
            A senha de app salva não pôde ser lida. Informe a senha de app de novo para voltar a enviar.
          } @else {
            Ainda não configurado. Até lá, todo usuário novo precisa ter a senha definida na hora do cadastro.
          }
        </p>

        <form class="sheet stack" (ngSubmit)="save()" #form="ngForm">
          <div class="cols-form">
            <label
              >Conta Gmail <input name="user" type="email" required placeholder="suaoficina@gmail.com" autocomplete="off" [(ngModel)]="draft.user"
            /></label>
            <label>Nome do remetente <input name="from_name" maxlength="80" placeholder="PitStop" [(ngModel)]="draft.from_name" /></label>
            <label
              >Senha de app do Google
              <input
                name="app_password"
                type="password"
                autocomplete="new-password"
                minlength="8"
                maxlength="64"
                [required]="!current.configured"
                [placeholder]="current.configured ? 'Em branco mantém a atual' : '16 letras'"
                [(ngModel)]="draft.app_password"
              />
            </label>
          </div>
          <small>
            A senha de app não é a senha do Gmail. Crie uma em myaccount.google.com/apppasswords (a conta precisa ter a verificação em duas etapas ligada). Ela
            é guardada cifrada e nunca mais é mostrada.
          </small>
          <div class="row">
            <button class="btn-primary" [disabled]="form.invalid">Salvar</button>
            @if (current.user) {
              <button type="button" class="btn-quiet" (click)="remove()">Remover configuração</button>
            }
          </div>
        </form>

        @if (current.configured) {
          <form class="sheet stack" (ngSubmit)="test()">
            <h2>Enviar um e-mail de teste</h2>
            <label>Para (em branco: o seu e-mail) <input name="to" type="email" [(ngModel)]="testTo" /></label>
            <div>
              <button [disabled]="testing()">{{ testing() ? 'Enviando…' : 'Enviar teste' }}</button>
            </div>
          </form>
        }
      }
    </main>
  `
})
export class EmailSettingsPage implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  readonly settings = signal<EmailSettings | null>(null);
  readonly testing = signal(false);
  draft = { user: '', from_name: '', app_password: '' };
  testTo = '';

  ngOnInit(): void {
    void this.api.get<EmailSettings>('/admin/email-settings').then((settings) => this.apply(settings));
  }

  private apply(settings: EmailSettings): void {
    this.draft = { user: settings.user ?? '', from_name: settings.from_name ?? '', app_password: '' };
    this.settings.set(settings);
  }

  async save(): Promise<void> {
    const { app_password, from_name, user } = this.draft;
    this.apply(
      await this.api.put<EmailSettings>('/admin/email-settings', {
        user: user.trim(),
        ...(from_name.trim() ? { from_name: from_name.trim() } : {}),
        ...(app_password ? { app_password } : {})
      })
    );
    this.toast.ok('E-mail da plataforma salvo');
  }

  async remove(): Promise<void> {
    if (!confirm('Remover a configuração de e-mail? Convites e redefinições de senha deixam de ser enviados.')) return;
    this.apply(await this.api.delete<EmailSettings>('/admin/email-settings'));
  }

  async test(): Promise<void> {
    this.testing.set(true);
    try {
      await this.api.post('/admin/email-settings/test', this.testTo.trim() ? { to: this.testTo.trim() } : {});
      this.toast.ok('E-mail de teste enviado. Confira a caixa de entrada.');
    } finally {
      this.testing.set(false);
    }
  }
}
