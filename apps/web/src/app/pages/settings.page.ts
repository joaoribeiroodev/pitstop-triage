import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, AuthService, ToastService } from '@front/core';
import { FORMAT_PIPES, ROLE_LABELS } from '@front/format';
import { TENANT_ROLES, type ShopPart, type ShopService, type TenantRole, type TenantUser } from '@pitstop/shared-types';

const PLAN_LABELS = { basic: 'Básico', pro: 'Pro', enterprise: 'Enterprise' } as const;

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <h1>Ajustes</h1>

      @if (auth.tenant(); as tenant) {
        <section class="sheet stack-sm">
          <h2>{{ tenant.name }}</h2>
          <div class="cols-form">
            <div><small>Plano</small><br />{{ planLabels[tenant.plan] }}</div>
            <div><small>Válido até</small><br />{{ tenant.expires_at ? (tenant.expires_at | day) : 'Sem data de expiração' }}</div>
            <div><small>Usuários</small><br />até {{ tenant.limits.max_users }}</div>
            <div><small>Ordens por mês</small><br />até {{ tenant.limits.max_orders_month }}</div>
          </div>
          <small>Plano, limites e módulos são definidos pela equipe do PitStop.</small>
        </section>
      }

      <nav class="sheet sheet-flush" aria-label="Seções de ajustes">
        <ul class="list">
          @if (isOwner) {
            <li>
              <a class="list-link" routerLink="/settings/users"
                ><span><strong>Usuários</strong><br /><small>Quem acessa o sistema e com qual papel</small></span></a
              >
            </li>
          }
          <li>
            <a class="list-link" routerLink="/settings/catalog"
              ><span><strong>Catálogo de serviços e peças</strong><br /><small>Preços padrão usados nos orçamentos e nas sugestões</small></span></a
            >
          </li>
        </ul>
      </nav>

      @if (isOwner) {
        <form class="sheet stack" (ngSubmit)="save()">
          <h2>Preferências da oficina</h2>
          <label class="check">
            <input type="checkbox" name="seeAll" [(ngModel)]="form.mechanics_see_all_orders" />
            Mecânicos enxergam toda a fila (desmarcado: só as ordens atribuídas a eles)
          </label>
          <label style="max-width: 16rem"
            >Validade do link do cliente (dias)
            <input type="number" name="days" min="1" max="90" required [(ngModel)]="form.portal_token_days" />
          </label>
          <div><button class="btn-primary">Salvar preferências</button></div>
        </form>
      }
    </div>
  `
})
export class SettingsPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  readonly auth = inject(AuthService);
  readonly isOwner = this.auth.hasRole('owner');
  readonly planLabels = PLAN_LABELS;
  form = {
    mechanics_see_all_orders: this.auth.tenant()?.settings.mechanics_see_all_orders ?? false,
    portal_token_days: this.auth.tenant()?.settings.portal_token_days ?? 30
  };

  async save(): Promise<void> {
    await this.api.patch('/tenant/settings', {
      mechanics_see_all_orders: this.form.mechanics_see_all_orders,
      portal_token_days: Number(this.form.portal_token_days)
    });
    await this.auth.loadMe();
    this.toast.ok('Preferências salvas');
  }
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div>
        <a routerLink="/settings">Ajustes</a>
        <div class="row-between">
          <h1>Usuários</h1>
          <button type="button" class="btn-primary" (click)="adding.set(!adding())">{{ adding() ? 'Cancelar' : 'Novo usuário' }}</button>
        </div>
        <small>{{ activeCount() }} de {{ auth.tenant()?.limits?.max_users }} usuários ativos do plano.</small>
      </div>

      @if (adding()) {
        <form class="sheet stack" (ngSubmit)="create()" #form="ngForm">
          <h2>Novo usuário</h2>
          <div class="cols-form">
            <label>Nome <input name="full_name" required minlength="2" [(ngModel)]="draft.full_name" /></label>
            <label>E-mail <input name="email" type="email" required [(ngModel)]="draft.email" /></label>
            <label
              >Papel
              <select name="role" [(ngModel)]="draft.role">
                @for (role of roles; track role) {
                  <option [value]="role">{{ roleLabels[role] }}</option>
                }
              </select>
            </label>
            <label
              >Senha inicial (opcional)
              <input name="password" type="password" minlength="8" autocomplete="new-password" [(ngModel)]="draft.password" />
            </label>
          </div>
          <small>Sem senha, a pessoa recebe um convite por e-mail para criar a própria.</small>
          <div><button class="btn-primary" [disabled]="form.invalid">Criar usuário</button></div>
        </form>
      }

      <div class="sheet sheet-flush table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Papel</th>
              <th>Situação</th>
              <th><span class="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            @for (user of users(); track user.id) {
              <tr>
                <td>
                  <strong>{{ user.full_name }}</strong
                  ><br /><small>{{ user.email }}</small>
                </td>
                <td>
                  <select [attr.aria-label]="'Papel de ' + user.full_name" [ngModel]="user.role" (ngModelChange)="update(user, { role: $event })">
                    @for (role of roles; track role) {
                      <option [value]="role">{{ roleLabels[role] }}</option>
                    }
                  </select>
                </td>
                <td>
                  <span class="status" [attr.data-tone]="user.is_active ? 'done' : 'idle'">{{ user.is_active ? 'Ativo' : 'Desativado' }}</span>
                </td>
                <td class="right">
                  <button type="button" class="btn-quiet" (click)="update(user, { is_active: !user.is_active })">
                    {{ user.is_active ? 'Desativar' : 'Reativar' }}
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `
})
export class UsersPage implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  readonly auth = inject(AuthService);
  readonly roles = TENANT_ROLES;
  readonly roleLabels = ROLE_LABELS;
  readonly users = signal<TenantUser[]>([]);
  readonly adding = signal(false);
  readonly activeCount = computed(() => this.users().filter((user) => user.is_active).length);
  draft = { full_name: '', email: '', role: 'mechanic' as TenantRole, password: '' };

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.users.set(await this.api.get<TenantUser[]>('/users'));
  }

  async create(): Promise<void> {
    const { password, ...rest } = this.draft;
    const created = await this.api.post<TenantUser & { invited: boolean }>('/users', password ? { ...rest, password } : rest);
    this.toast.ok(created.invited ? 'Usuário criado. O convite foi enviado por e-mail.' : 'Usuário criado');
    this.draft = { full_name: '', email: '', role: 'mechanic', password: '' };
    this.adding.set(false);
    await this.load();
  }

  async update(user: TenantUser, patch: Partial<Pick<TenantUser, 'role' | 'is_active'>>): Promise<void> {
    try {
      await this.api.patch(`/users/${user.id}`, patch);
      this.toast.ok('Usuário atualizado');
    } finally {
      await this.load();
    }
  }
}

type CatalogKind = 'services' | 'parts';
type CatalogRow = (ShopService | ShopPart) & { sku?: string | null; duration_minutes?: number | null };

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div>
        <a routerLink="/settings">Ajustes</a>
        <h1>Catálogo da oficina</h1>
      </div>

      <div class="tabs" role="tablist" aria-label="Tipo de catálogo">
        <button type="button" role="tab" [attr.aria-selected]="kind() === 'services'" (click)="setKind('services')">Serviços</button>
        <button type="button" role="tab" [attr.aria-selected]="kind() === 'parts'" (click)="setKind('parts')">Peças</button>
      </div>

      @if (canEdit) {
        <form class="sheet stack" (ngSubmit)="create()" #form="ngForm">
          <h2>{{ kind() === 'services' ? 'Novo serviço' : 'Nova peça' }}</h2>
          <div class="cols-form">
            <label>Nome <input name="name" required minlength="2" maxlength="160" [(ngModel)]="draft.name" /></label>
            <label>Preço padrão (R$) <input name="price" type="number" required min="0" step="0.01" [(ngModel)]="draft.default_price" /></label>
            @if (kind() === 'services') {
              <label>Duração (min) <input name="duration" type="number" min="0" [(ngModel)]="draft.duration_minutes" /></label>
            } @else {
              <label>Código (SKU) <input name="sku" maxlength="60" [(ngModel)]="draft.sku" /></label>
            }
          </div>
          <div><button class="btn-primary" [disabled]="form.invalid">Adicionar ao catálogo</button></div>
        </form>
      }

      <div class="sheet sheet-flush table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>{{ kind() === 'services' ? 'Duração' : 'Código' }}</th>
              <th class="right">Preço padrão</th>
              @if (canEdit) {
                <th><span class="sr-only">Ações</span></th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.id) {
              <tr [class.inactive]="!row.is_active">
                <td>{{ row.name }}</td>
                <td>{{ kind() === 'services' ? (row.duration_minutes | duration) : row.sku || '—' }}</td>
                <td class="right num">
                  @if (canEdit) {
                    <input
                      class="price"
                      type="number"
                      min="0"
                      step="0.01"
                      [attr.aria-label]="'Preço de ' + row.name"
                      [value]="row.default_price"
                      (change)="setPrice(row, $any($event.target).value)"
                    />
                  } @else {
                    {{ row.default_price | brl }}
                  }
                </td>
                @if (canEdit) {
                  <td class="right">
                    <button type="button" class="btn-quiet" (click)="toggle(row)">{{ row.is_active ? 'Desativar' : 'Reativar' }}</button>
                    <button type="button" class="btn-quiet" (click)="remove(row)">Excluir</button>
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td colspan="4" class="empty">
                  {{ kind() === 'services' ? 'Nenhum serviço cadastrado.' : 'Nenhuma peça cadastrada.' }} Itens do catálogo entram no orçamento com um toque e
                  dão preço às sugestões.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: `
    .price {
      width: 7.5rem;
      text-align: right;
    }
    .inactive td:first-child {
      color: var(--ink-soft);
      text-decoration: line-through;
    }
  `
})
export class CatalogPage implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  readonly canEdit = inject(AuthService).hasRole('owner', 'manager');
  readonly kind = signal<CatalogKind>('services');
  readonly rows = signal<CatalogRow[]>([]);
  draft = { name: '', default_price: 0, duration_minutes: null as number | null, sku: '' };

  ngOnInit(): void {
    void this.load();
  }

  setKind(kind: CatalogKind): void {
    this.kind.set(kind);
    this.rows.set([]);
    void this.load();
  }

  async load(): Promise<void> {
    this.rows.set(await this.api.get<CatalogRow[]>(`/catalog/${this.kind()}`));
  }

  async create(): Promise<void> {
    const base = { name: this.draft.name.trim(), default_price: Number(this.draft.default_price) };
    const body =
      this.kind() === 'services'
        ? { ...base, duration_minutes: this.draft.duration_minutes === null ? undefined : Number(this.draft.duration_minutes) }
        : { ...base, sku: this.draft.sku.trim() || undefined };
    await this.api.post(`/catalog/${this.kind()}`, body);
    this.draft = { name: '', default_price: 0, duration_minutes: null, sku: '' };
    this.toast.ok('Adicionado ao catálogo');
    await this.load();
  }

  async setPrice(row: CatalogRow, raw: string): Promise<void> {
    const price = Number(raw);
    if (!Number.isFinite(price) || price < 0) return this.load();
    await this.api.patch(`/catalog/${this.kind()}/${row.id}`, { default_price: Math.round(price * 100) / 100 });
    this.toast.ok('Preço atualizado');
    await this.load();
  }

  async toggle(row: CatalogRow): Promise<void> {
    await this.api.patch(`/catalog/${this.kind()}/${row.id}`, { is_active: !row.is_active });
    await this.load();
  }

  async remove(row: CatalogRow): Promise<void> {
    if (!confirm(`Excluir "${row.name}" do catálogo? Orçamentos já feitos não mudam.`)) return;
    await this.api.delete(`/catalog/${this.kind()}/${row.id}`);
    await this.load();
  }
}

@Component({
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page page-narrow">
      <h1>Módulo em preparação</h1>
      <p class="notice">
        Este módulo está ativo para a sua oficina, mas ainda não foi liberado nesta versão do PitStop. Você será avisado quando estiver disponível.
      </p>
      <div><a class="btn" routerLink="/dashboard">Voltar ao painel</a></div>
    </div>
  `
})
export class ComingSoonPage {}
