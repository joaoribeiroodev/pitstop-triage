import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { anonymous, Api, errorMessage } from '@front/core';
import type { ReportedSymptom, SymptomCategory } from '@pitstop/shared-types';
import { SymptomQuestionsComponent, SymptomSelectComponent, ZoneMapComponent } from '../ui/symptoms';

/** Triagem pública: o cliente relata os sintomas antes de ir à oficina. Sem login e sem cadastro. */
@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, ZoneMapComponent, SymptomSelectComponent, SymptomQuestionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="portal portal-wide">
      @if (unavailable()) {
        <h1>Triagem indisponível</h1>
        <p class="notice notice-wait">{{ unavailable() }}</p>
      } @else if (shopName()) {
        <header class="portal-head">
          <span class="mono-label signal">Triagem do veículo</span>
          <h1>{{ shopName() }}</h1>
        </header>

        @if (done()) {
          <div class="notice notice-done" role="status">
            <strong>Recebemos o seu relato.</strong> A oficina vai entrar em contato pelo telefone informado para combinar o atendimento.
          </div>
        } @else {
          <ol class="steps" aria-label="Etapas">
            @for (label of steps; track label; let i = $index) {
              <li [class.done]="i < step()" [attr.aria-current]="i === step() ? 'step' : null">{{ label }}</li>
            }
          </ol>

          @switch (step()) {
            @case (0) {
              <form class="sheet stripe stack" (ngSubmit)="step.set(1)" #form="ngForm">
                <h2>Quem é <span class="hl">você</span>?</h2>
                <label>Seu nome <input name="name" required minlength="2" maxlength="160" autocomplete="name" [(ngModel)]="contact.name" /></label>
                <label
                  >Telefone com DDD
                  <input
                    name="phone"
                    required
                    inputmode="tel"
                    autocomplete="tel"
                    pattern="[0-9 ()+-]{10,20}"
                    placeholder="(71) 99999-0000"
                    [(ngModel)]="contact.phone"
                  />
                </label>
                <label>Placa do veículo (opcional) <input name="plate" maxlength="8" autocapitalize="characters" [(ngModel)]="contact.plate" /></label>
                <label>Marca e modelo (opcional) <input name="vehicle" maxlength="120" placeholder="Ex.: Ford Ka 2019" [(ngModel)]="contact.vehicle" /></label>
                <button class="btn-primary btn-big" [disabled]="form.invalid">Continuar</button>
                <small>Seus dados são usados apenas pela oficina para este atendimento. <a routerLink="/privacidade">Política de privacidade</a>.</small>
              </form>
            }
            @case (1) {
              <h2>Onde dói no <span class="hl">carro</span>?</h2>
              <p class="muted">Toque na parte do carro onde você percebe o problema.</p>
              <ps-zone-map [catalog]="catalog()" [value]="symptoms()" [(zone)]="zone" />
            }
            @case (2) {
              <h2>O que está <span class="hl">acontecendo</span>?</h2>
              <p class="muted">Marque tudo o que você percebeu. Para outra parte do carro, volte ao mapa.</p>
              <ps-symptom-select [catalog]="catalog()" [zone]="zone()" [(value)]="symptoms" />
              <label
                >Quer contar com suas palavras? (opcional)
                <textarea name="notes" maxlength="2000" [(ngModel)]="notes"></textarea>
              </label>
            }
            @case (3) {
              <h2>Só mais alguns <span class="hl">detalhes</span></h2>
              <p class="muted">Responda o que souber. Pode deixar em branco.</p>
              <ps-symptom-questions [catalog]="catalog()" [(value)]="symptoms" />
              @if (error()) {
                <p class="notice notice-stop" role="alert">{{ error() }}</p>
              }
            }
          }

          @if (step() > 0) {
            <div class="row-between">
              <button type="button" (click)="step.set(step() - 1)">{{ step() === 2 ? '← Mapa' : 'Voltar' }}</button>
              @switch (step()) {
                @case (1) {
                  <button type="button" class="btn-primary btn-big" [disabled]="!zone()" (click)="step.set(2)">Continuar</button>
                }
                @case (2) {
                  <button type="button" class="btn-primary btn-big" [disabled]="!symptoms().length" (click)="step.set(3)">Continuar</button>
                }
                @default {
                  <button type="button" class="btn-primary btn-big" [disabled]="sending()" (click)="send()">Enviar para a oficina</button>
                }
              }
            </div>
          }
        }
      }
    </main>
  `
})
export class PublicTriagePage implements OnInit {
  private readonly api = inject(Api);
  readonly slug = input.required<string>();
  readonly steps = ['Você', 'Mapa', 'Sintomas', 'Detalhes'];
  /** Zona do carro escolhida no mapa. */
  readonly zone = signal<string | null>(null);
  readonly step = signal(0);
  readonly shopName = signal('');
  readonly catalog = signal<SymptomCategory[]>([]);
  readonly symptoms = signal<ReportedSymptom[]>([]);
  readonly unavailable = signal('');
  readonly error = signal('');
  readonly sending = signal(false);
  readonly done = signal(false);
  contact = { name: '', phone: '', plate: '', vehicle: '' };
  notes = '';

  async ngOnInit(): Promise<void> {
    try {
      const intro = await this.api.get<{ shop_name: string; catalog: SymptomCategory[] }>(`/triage/public/${this.slug()}`, undefined, anonymous());
      this.shopName.set(intro.shop_name);
      this.catalog.set(intro.catalog);
    } catch {
      this.unavailable.set('Este link de triagem não está disponível. Confira o endereço ou fale com a oficina.');
    }
  }

  async send(): Promise<void> {
    this.sending.set(true);
    this.error.set('');
    try {
      await this.api.post(
        `/triage/public/${this.slug()}/sessions`,
        {
          contact: {
            name: this.contact.name,
            phone: this.contact.phone,
            plate: this.contact.plate || undefined,
            vehicle: this.contact.vehicle || undefined
          },
          reported_symptoms: this.symptoms(),
          free_form_notes: this.notes.trim() || undefined
        },
        anonymous()
      );
      this.done.set(true);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.sending.set(false);
    }
  }
}
