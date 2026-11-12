import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, AuthService, errorMessage, silent, ToastService } from '@front/core';
import { FORMAT_PIPES, localDay, type Tone } from '@front/format';
import { APPOINTMENT_STATUS_LABELS, type Appointment, type AppointmentStatus, type TenantUser, type Vehicle } from '@pitstop/shared-types';

type Assignable = Pick<TenantUser, 'id' | 'full_name' | 'role'>;

const TONES: Record<AppointmentStatus, Tone> = { scheduled: 'wait', confirmed: 'work', done: 'done', cancelled: 'idle', no_show: 'stop' };
const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const LONG_DAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Agenda do dia: horários por box e por mecânico. O backend recusa dois agendamentos no mesmo box ou com o mesmo responsável. */
@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page page-wide">
      <div class="row-between">
        <header class="page-head">
          <span class="eyebrow">Agenda</span>
          <h1>Quem entra no <span class="hl">box</span> hoje?</h1>
        </header>
        @if (canEdit) {
          <button type="button" class="btn-primary" (click)="adding.set(!adding())">{{ adding() ? 'Cancelar' : 'Novo agendamento' }}</button>
        }
      </div>

      <div class="row day-nav">
        <button type="button" aria-label="Dia anterior" (click)="shift(-1)">←</button>
        <label
          ><span class="sr-only">Dia</span>
          <input type="date" name="day" required [ngModel]="day()" (ngModelChange)="setDay($event)" />
        </label>
        <button type="button" aria-label="Próximo dia" (click)="shift(1)">→</button>
        <button type="button" class="btn-quiet" (click)="setDay(today())">Hoje</button>
        <strong class="day-label">{{ dayLabel() }}</strong>
      </div>

      @if (adding()) {
        <form class="sheet stripe stack" (ngSubmit)="create()" #form="ngForm">
          <h2>Novo agendamento</h2>
          <div class="cols-form">
            <label
              >O que será feito <input name="title" required minlength="2" maxlength="160" placeholder="Ex.: Revisão dos 40 mil" [(ngModel)]="draft.title"
            /></label>
            <label>Início <input name="start" type="time" required [(ngModel)]="draft.start" /></label>
            <label>Término <input name="end" type="time" required [(ngModel)]="draft.end" /></label>
            <label
              >Box
              <select name="bay" [(ngModel)]="draft.bay">
                <option value="">Sem box definido</option>
                @for (bay of bays(); track bay) {
                  <option [value]="bay">{{ bay }}</option>
                }
              </select>
            </label>
            <label
              >Responsável
              <select name="mechanic" [(ngModel)]="draft.mechanic_id">
                <option value="">Sem responsável</option>
                @for (member of team(); track member.id) {
                  <option [value]="member.id">{{ member.full_name }}</option>
                }
              </select>
            </label>
            <label
              >Placa do veículo (opcional)
              <input name="plate" maxlength="8" autocapitalize="characters" [(ngModel)]="draft.plate" (change)="findVehicle()" />
            </label>
          </div>
          @if (vehicle(); as found) {
            <p class="notice notice-done">{{ found.plate }} · {{ found.customer_name }}</p>
          } @else if (plateMiss()) {
            <p class="notice notice-wait">Placa não cadastrada. O agendamento fica sem veículo vinculado; cadastre o cliente quando ele chegar.</p>
          }
          <label>Observações (opcional) <textarea name="notes" rows="2" maxlength="1000" [(ngModel)]="draft.notes"></textarea></label>
          @if (!bays().length) {
            <small>Cadastre os boxes da oficina em <a routerLink="/settings">Ajustes</a> para reservar o espaço junto com o horário.</small>
          }
          @if (error()) {
            <p class="notice notice-stop" role="alert">{{ error() }}</p>
          }
          <div><button class="btn-primary" [disabled]="form.invalid">Agendar</button></div>
        </form>
      }

      <section class="kpis" aria-label="Resumo do dia">
        <div class="sheet kpi">
          <strong class="num">{{ active().length }}</strong> {{ active().length === 1 ? 'agendamento' : 'agendamentos' }} no dia
        </div>
        <div class="sheet kpi" data-tone="work">
          <strong class="num">{{ confirmed() }}</strong> confirmados
        </div>
      </section>

      <ul class="list agenda" aria-label="Agendamentos do dia">
        @for (item of appointments(); track item.id) {
          <li class="sheet row-between" [class.off]="item.status === 'cancelled' || item.status === 'no_show'">
            <div class="row slot">
              <span class="num hours"
                >{{ time(item.starts_at) }}<br /><small>{{ time(item.ends_at) }}</small></span
              >
              <span>
                <strong>{{ item.title }}</strong>
                <span class="status" [attr.data-tone]="tones[item.status]">{{ statusLabels[item.status] }}</span>
                <br /><small
                  >{{ item.bay || 'Sem box' }} · {{ item.mechanic_name || 'Sem responsável' }}
                  @if (item.vehicle_plate) {
                    · {{ item.vehicle_plate }} {{ item.vehicle_label }}
                  }
                  @if (item.customer_name) {
                    · {{ item.customer_name }} {{ item.customer_phone | phone }}
                  }
                </small>
                @if (item.notes) {
                  <br /><small>{{ item.notes }}</small>
                }
              </span>
            </div>
            @if (canEdit) {
              <span class="row">
                @switch (item.status) {
                  @case ('scheduled') {
                    <button type="button" [attr.aria-label]="'Confirmar ' + item.title" (click)="setStatus(item, 'confirmed')">Confirmar</button>
                  }
                  @case ('confirmed') {
                    <button type="button" class="btn-go" [attr.aria-label]="'Marcar como atendido: ' + item.title" (click)="setStatus(item, 'done')">
                      Atendido
                    </button>
                    <button type="button" class="btn-quiet" [attr.aria-label]="'Não compareceu: ' + item.title" (click)="setStatus(item, 'no_show')">
                      Não veio
                    </button>
                  }
                }
                @if (item.status === 'scheduled' || item.status === 'confirmed') {
                  <button type="button" class="btn-quiet" [attr.aria-label]="'Cancelar ' + item.title" (click)="setStatus(item, 'cancelled')">Cancelar</button>
                } @else {
                  <button type="button" class="btn-quiet" [attr.aria-label]="'Excluir ' + item.title" (click)="remove(item)">Excluir</button>
                }
              </span>
            }
          </li>
        } @empty {
          <li class="sheet empty">Nenhum agendamento neste dia.</li>
        }
      </ul>
    </div>
  `,
  styles: `
    .day-nav {
      align-items: center;
      flex-wrap: wrap;
    }
    .day-label {
      display: inline-block;
    }
    .day-label::first-letter {
      text-transform: uppercase;
    }
    .agenda {
      display: grid;
      gap: 0.6rem;
    }
    .agenda > li {
      border-bottom: 0;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .slot {
      align-items: flex-start;
      gap: 1rem;
    }
    .hours {
      font-family: var(--font-mono, monospace);
      color: var(--coverall);
      min-width: 3.5rem;
    }
    .off strong {
      color: var(--ink-soft);
      text-decoration: line-through;
    }
    .status {
      margin-left: 0.5rem;
    }
  `
})
export class SchedulePage implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  readonly canEdit = this.auth.hasRole('owner', 'manager', 'receptionist');
  readonly tones = TONES;
  readonly statusLabels = APPOINTMENT_STATUS_LABELS;
  readonly day = signal(localDay(new Date()));
  readonly appointments = signal<Appointment[]>([]);
  readonly team = signal<Assignable[]>([]);
  readonly adding = signal(false);
  readonly error = signal('');
  readonly vehicle = signal<Vehicle | null>(null);
  readonly plateMiss = signal(false);
  readonly bays = computed(() => this.auth.tenant()?.settings.bays ?? []);
  readonly active = computed(() => this.appointments().filter((item) => item.status !== 'cancelled' && item.status !== 'no_show'));
  readonly confirmed = computed(() => this.appointments().filter((item) => item.status === 'confirmed').length);
  readonly dayLabel = computed(() => LONG_DAY.format(new Date(`${this.day()}T12:00:00`)));
  draft = this.emptyDraft();

  private emptyDraft() {
    return { title: '', start: '08:00', end: '09:00', bay: '', mechanic_id: '', plate: '', notes: '' };
  }

  today(): string {
    return localDay(new Date());
  }

  time(value: string): string {
    return TIME.format(new Date(value));
  }

  ngOnInit(): void {
    void this.api
      .get<Assignable[]>('/users/assignable', undefined, silent())
      .then((team) => this.team.set(team))
      .catch(() => undefined);
    void this.load();
  }

  setDay(day: string): void {
    if (!day) return;
    this.day.set(day);
    void this.load();
  }

  shift(days: number): void {
    const date = new Date(`${this.day()}T12:00:00`);
    date.setDate(date.getDate() + days);
    this.setDay(localDay(date));
  }

  async load(): Promise<void> {
    const from = new Date(`${this.day()}T00:00:00`);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    this.appointments.set(await this.api.get<Appointment[]>('/appointments', { from: from.toISOString(), to: to.toISOString() }));
  }

  async findVehicle(): Promise<void> {
    const plate = this.draft.plate.replace(/[^a-z0-9]/gi, '').toUpperCase();
    this.vehicle.set(null);
    this.plateMiss.set(false);
    if (plate.length < 7) return;
    try {
      this.vehicle.set(await this.api.get<Vehicle>(`/vehicles/by-plate/${plate}`, undefined, silent()));
    } catch {
      this.plateMiss.set(true);
    }
  }

  async create(): Promise<void> {
    this.error.set('');
    const starts = new Date(`${this.day()}T${this.draft.start}:00`);
    const ends = new Date(`${this.day()}T${this.draft.end}:00`);
    if (!(ends > starts)) return this.error.set('O término precisa ser depois do início.');
    const found = this.vehicle();
    try {
      await this.api.post(
        '/appointments',
        {
          title: this.draft.title.trim(),
          starts_at: starts.toISOString(),
          ends_at: ends.toISOString(),
          bay: this.draft.bay || undefined,
          mechanic_id: this.draft.mechanic_id || undefined,
          vehicle_id: found?.id,
          customer_id: found?.customer_id,
          notes: this.draft.notes.trim() || undefined
        },
        silent()
      );
    } catch (failure) {
      // conflito de box ou de responsável: a mensagem do backend diz qual
      return this.error.set(errorMessage(failure));
    }
    this.draft = this.emptyDraft();
    this.vehicle.set(null);
    this.plateMiss.set(false);
    this.adding.set(false);
    this.toast.ok('Agendamento criado');
    await this.load();
  }

  async setStatus(item: Appointment, status: AppointmentStatus): Promise<void> {
    await this.api.patch(`/appointments/${item.id}`, { status });
    await this.load();
  }

  async remove(item: Appointment): Promise<void> {
    if (!confirm(`Excluir o agendamento "${item.title}"?`)) return;
    await this.api.delete(`/appointments/${item.id}`);
    await this.load();
  }
}
