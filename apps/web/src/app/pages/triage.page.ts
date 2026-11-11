import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, AuthService, ToastService } from '@front/core';
import { FORMAT_PIPES } from '@front/format';
import { PlateComponent } from '@front/ui';
import type { Paginated, ReportedSymptom, ServiceOrder, SymptomCategory, TriageSession, TriageStatus, Vehicle } from '@pitstop/shared-types';
import { copyText } from '../ui/clipboard';
import { SymptomCatalog, SymptomQuestionsComponent, SymptomReportComponent, SymptomSelectComponent, ZoneMapComponent } from '../ui/symptoms';
import { VehiclePickerComponent } from '../ui/vehicle-picker.component';

const TRIAGE_LABELS: Record<TriageStatus, string> = { pending: 'Pendentes', converted: 'Viraram OS', archived: 'Arquivadas' };

@Component({
  standalone: true,
  imports: [RouterLink, PlateComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="row-between">
        <header class="page-head">
          <span class="eyebrow">Escuta do cliente</span>
          <h1>Triagem</h1>
        </header>
        @if (canWrite) {
          <a class="btn btn-primary" routerLink="/triage/new">Nova triagem</a>
        }
      </div>

      @if (auth.hasFeature('public_triage') && canWrite) {
        <div class="sheet row-between">
          <span class="grow"
            ><strong>Link de triagem para o cliente</strong><br /><small>O cliente preenche os sintomas em casa e o relato cai aqui como pendente.</small></span
          >
          <button type="button" (click)="copyPublicLink()">Copiar link</button>
        </div>
      }

      <div class="tabs" role="tablist" aria-label="Situação da triagem">
        @for (option of statuses; track option) {
          <button type="button" role="tab" [attr.aria-selected]="status() === option" (click)="setStatus(option)">{{ labels[option] }}</button>
        }
      </div>

      <div class="sheet sheet-flush">
        <ul class="list">
          @for (session of page()?.data; track session.id) {
            <li>
              <a class="list-link" [routerLink]="['/triage', session.id]">
                <span class="row">
                  @if (session.vehicle_plate) {
                    <ps-plate [value]="session.vehicle_plate" />
                  }
                  <span>
                    <strong>{{ session.customer_name || session.contact?.name || 'Sem cliente vinculado' }}</strong>
                    <br /><small
                      >{{ session.reported_symptoms.length }} {{ session.reported_symptoms.length === 1 ? 'sintoma' : 'sintomas' }},
                      {{ session.created_at | moment }}</small
                    >
                  </span>
                </span>
                @if (session.source === 'public') {
                  <span class="status" data-tone="wait">Enviada pelo cliente</span>
                }
              </a>
            </li>
          } @empty {
            <li class="empty">
              {{ status() === 'pending' ? 'Nenhuma triagem pendente. As novas aparecem aqui até virarem ordem de serviço.' : 'Nada por aqui ainda.' }}
            </li>
          }
        </ul>
      </div>
      @if (page(); as p) {
        @if (p.total > p.pageSize) {
          <div class="row-between">
            <button type="button" [disabled]="p.page === 1" (click)="load(p.page - 1)">Anteriores</button>
            <small>{{ p.total }} triagens, página {{ p.page }}</small>
            <button type="button" [disabled]="p.page * p.pageSize >= p.total" (click)="load(p.page + 1)">Próximas</button>
          </div>
        }
      }
    </div>
  `
})
export class TriageListPage implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  readonly auth = inject(AuthService);
  readonly canWrite = this.auth.hasRole('owner', 'manager', 'receptionist');
  readonly statuses: TriageStatus[] = ['pending', 'converted', 'archived'];
  readonly labels = TRIAGE_LABELS;
  readonly status = signal<TriageStatus>('pending');
  readonly page = signal<Paginated<TriageSession> | null>(null);

  ngOnInit(): void {
    void this.load(1);
  }

  setStatus(status: TriageStatus): void {
    this.status.set(status);
    void this.load(1);
  }

  async load(page: number): Promise<void> {
    this.page.set(await this.api.get<Paginated<TriageSession>>('/triage/sessions', { status: this.status(), page }));
  }

  async copyPublicLink(): Promise<void> {
    const url = `${location.origin}/triagem/${this.auth.tenant()?.slug}`;
    if (await copyText(url)) this.toast.ok('Link copiado. Envie ao cliente pelo canal que preferir.');
  }
}

/** As cinco etapas do pit lane: do carro ao resumo do relato. */
const STEPS = [
  { label: 'Carro', eyebrow: 'Identificação' },
  { label: 'Mapa', eyebrow: 'Localização' },
  { label: 'Sintomas', eyebrow: 'Sintomas' },
  { label: 'Detalhes', eyebrow: 'Detalhes' },
  { label: 'Resumo', eyebrow: 'Revisão' }
] as const;

@Component({
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    PlateComponent,
    VehiclePickerComponent,
    ZoneMapComponent,
    SymptomSelectComponent,
    SymptomQuestionsComponent,
    SymptomReportComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a routerLink="/triage">Triagem</a>

      <div class="stack">
        <ol class="steps" aria-label="Etapas da triagem">
          @for (item of steps; track item.label; let i = $index) {
            <li [class.done]="i < step() || !!saved()" [attr.aria-current]="i === step() && !saved() ? 'step' : null">{{ item.label }}</li>
          }
        </ol>
        <div class="progress">
          <div
            class="progress-track"
            role="progressbar"
            aria-label="Progresso da triagem"
            [attr.aria-valuenow]="progress()"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <i [style.width.%]="progress()"></i>
          </div>
          <span class="mono-label num">{{ progress() }}% compl.</span>
        </div>
      </div>

      <header class="page-head">
        <span class="eyebrow">Etapa 0{{ step() + 1 }} · {{ steps[step()].eyebrow }}</span>
        @switch (step()) {
          @case (0) {
            <h1>Qual é o <span class="hl">carro</span>?</h1>
            <p>Busque pela placa, pelo nome ou pelo telefone do cliente. Se for a primeira visita, o cadastro é feito aqui mesmo.</p>
          }
          @case (1) {
            <h1>Onde dói no <span class="hl">carro</span>?</h1>
            <p>Arraste o carro para girar e clique nas zonas em laranja. Os atalhos ao lado fazem o mesmo e funcionam pelo teclado.</p>
          }
          @case (2) {
            <h1>O que está <span class="hl">acontecendo</span>?</h1>
            <p>Marque tudo o que o cliente descreveu. Para sintomas de outra parte do carro, volte ao mapa: o que já foi marcado fica guardado.</p>
          }
          @case (3) {
            <h1>Conte um pouco <span class="hl">mais</span>.</h1>
            <p>Respostas curtas ajudam o mecânico a chegar na causa. Pode deixar em branco o que o cliente não souber.</p>
          }
          @default {
            <h1>Tudo <span class="hl">certo</span> no relato?</h1>
            <p>Confira antes de salvar. A triagem fica pendente até virar ordem de serviço.</p>
          }
        }
      </header>

      @if (vehicle(); as v) {
        <div class="sheet row-between">
          <span class="row"
            ><ps-plate [value]="v.plate" /> <span>{{ v.brand }} {{ v.model }} {{ v.year }}, {{ v.customer_name }}</span></span
          >
          @if (!saved()) {
            <button type="button" class="btn-quiet" (click)="changeVehicle()">Trocar</button>
          }
        </div>
      }

      @switch (step()) {
        @case (0) {
          <ps-vehicle-picker (picked)="pick($event)" />
        }
        @case (1) {
          <ps-zone-map [catalog]="catalog()" [value]="symptoms()" [(zone)]="zone" />
        }
        @case (2) {
          <ps-symptom-select [catalog]="catalog()" [zone]="zone()" [(value)]="symptoms" />
        }
        @case (3) {
          <ps-symptom-questions [catalog]="catalog()" [(value)]="symptoms" />
        }
        @case (4) {
          @if (saved(); as session) {
            <div class="notice notice-done" role="status"><strong>Triagem salva.</strong> Ela fica pendente até virar ordem de serviço.</div>
            <div class="row">
              <button type="button" class="btn-primary btn-big" (click)="convert(session.id)">Abrir ordem de serviço agora</button>
              <a class="btn" routerLink="/triage">Deixar pendente</a>
            </div>
          } @else {
            <div class="sheet stripe stack">
              <h2>Confira o relato</h2>
              <ps-symptom-report [catalog]="catalog()" [symptoms]="symptoms()" />
              <label
                >Observações em texto livre (opcional)
                <textarea name="notes" maxlength="4000" placeholder="O que o cliente contou com as próprias palavras" [(ngModel)]="notes"></textarea>
              </label>
            </div>
          }
        }
      }

      @if (step() > 0 && !saved()) {
        <div class="row-between">
          <button type="button" (click)="step.set(step() - 1)">{{ step() === 2 ? '← Mapa' : 'Voltar' }}</button>
          @switch (step()) {
            @case (1) {
              <button type="button" class="btn-primary" [disabled]="!zone()" (click)="step.set(2)">
                {{ zone() ? 'Continuar' : 'Escolha uma zona do carro' }}
              </button>
            }
            @case (4) {
              <button type="button" class="btn-primary" (click)="save()">Salvar triagem</button>
            }
            @default {
              <button type="button" class="btn-primary" [disabled]="!symptoms().length" (click)="step.set(step() + 1)">
                {{ symptoms().length ? 'Continuar' : 'Selecione ao menos um sintoma' }}
              </button>
            }
          }
        </div>
      }
    </div>
  `
})
export class TriageWizardPage implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly catalogStore = inject(SymptomCatalog);
  /** ?vehicleId=<id>: atalho vindo da ficha do veículo. */
  readonly vehicleId = input<string>();
  readonly steps = STEPS;
  readonly step = signal(0);
  readonly vehicle = signal<Vehicle | null>(null);
  readonly catalog = signal<SymptomCategory[]>([]);
  readonly symptoms = signal<ReportedSymptom[]>([]);
  readonly saved = signal<TriageSession | null>(null);
  /** Zona do carro escolhida no mapa (código da categoria do catálogo). */
  readonly zone = signal<string | null>(null);
  readonly progress = computed(() => (this.saved() ? 100 : this.step() * 20));
  notes = '';

  async ngOnInit(): Promise<void> {
    void this.catalogStore.load().then((catalog) => this.catalog.set(catalog));
    const id = this.vehicleId();
    if (id) this.pick(await this.api.get<Vehicle>(`/vehicles/${id}`));
  }

  pick(vehicle: Vehicle): void {
    this.vehicle.set(vehicle);
    this.step.set(1);
  }

  changeVehicle(): void {
    this.vehicle.set(null);
    this.step.set(0);
  }

  async save(): Promise<void> {
    const vehicle = this.vehicle();
    if (!vehicle) return;
    const session = await this.api.post<TriageSession>('/triage/sessions', {
      customer_id: vehicle.customer_id,
      vehicle_id: vehicle.id,
      reported_symptoms: this.symptoms(),
      free_form_notes: this.notes.trim() || undefined
    });
    this.saved.set(session);
  }

  async convert(id: string): Promise<void> {
    const order = await this.api.post<ServiceOrder>(`/triage/sessions/${id}/convert`);
    await this.router.navigate(['/service-orders', order.id]);
  }
}

@Component({
  standalone: true,
  imports: [RouterLink, PlateComponent, VehiclePickerComponent, SymptomReportComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session(); as s) {
      <div class="page">
        <div>
          <a routerLink="/triage">Triagem</a>
          <h1>Triagem de {{ s.created_at | moment }}</h1>
        </div>

        @if (s.status === 'converted' && s.service_order_id) {
          <a class="notice notice-done" [routerLink]="['/service-orders', s.service_order_id]">Esta triagem já virou ordem de serviço. Abrir a OS.</a>
        } @else if (s.status === 'archived') {
          <p class="notice">Triagem arquivada.</p>
        }

        <section class="sheet stack-sm">
          <h2>Cliente e veículo</h2>
          @if (s.vehicle_id) {
            <div class="row">
              @if (s.vehicle_plate) {
                <ps-plate [value]="s.vehicle_plate" />
              }
              <span
                >{{ s.vehicle_label }}, <a [routerLink]="['/customers', s.customer_id]">{{ s.customer_name }}</a></span
              >
            </div>
          } @else {
            @if (s.contact; as contact) {
              <p>
                Enviada por <strong>{{ contact.name }}</strong
                >, {{ contact.phone | phone }}
                @if (contact.plate || contact.vehicle) {
                  <br /><small>Veículo informado: {{ contact.plate }} {{ contact.vehicle }}</small>
                }
              </p>
            }
            @if (isPending() && canWrite) {
              <p class="notice notice-wait">Vincule esta triagem a um cliente e veículo do cadastro para poder abrir a OS.</p>
              <ps-vehicle-picker (picked)="link($event)" />
            }
          }
        </section>

        <section class="sheet stack">
          <h2>Relato</h2>
          <ps-symptom-report [catalog]="catalog()" [symptoms]="s.reported_symptoms" [notes]="s.free_form_notes" />
        </section>

        @if (isPending() && canWrite) {
          <div class="row">
            <button type="button" class="btn-primary btn-big" [disabled]="!s.vehicle_id" (click)="convert()">Abrir ordem de serviço</button>
            <button type="button" (click)="archive()">Arquivar</button>
          </div>
        }
      </div>
    }
  `
})
export class TriageDetailPage implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly catalogStore = inject(SymptomCatalog);
  readonly id = input.required<string>();
  readonly canWrite = inject(AuthService).hasRole('owner', 'manager', 'receptionist');
  readonly session = signal<TriageSession | null>(null);
  readonly catalog = signal<SymptomCategory[]>([]);
  readonly isPending = computed(() => this.session()?.status === 'pending');

  async ngOnInit(): Promise<void> {
    void this.catalogStore.load().then((catalog) => this.catalog.set(catalog));
    this.session.set(await this.api.get<TriageSession>(`/triage/sessions/${this.id()}`));
  }

  async link(vehicle: Vehicle): Promise<void> {
    this.session.set(await this.api.patch<TriageSession>(`/triage/sessions/${this.id()}`, { customer_id: vehicle.customer_id, vehicle_id: vehicle.id }));
    this.toast.ok('Triagem vinculada ao veículo');
  }

  async convert(): Promise<void> {
    const order = await this.api.post<ServiceOrder>(`/triage/sessions/${this.id()}/convert`);
    await this.router.navigate(['/service-orders', order.id]);
  }

  async archive(): Promise<void> {
    this.session.set(await this.api.post<TriageSession>(`/triage/sessions/${this.id()}/archive`));
    this.toast.ok('Triagem arquivada');
  }
}
