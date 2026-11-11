import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideExperimentalZonelessChangeDetection, Type } from '@angular/core';
import { ComponentFixture, DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { apiInterceptor, AuthService, SESSION_KEY } from '@front/core';
import type { FeatureFlags, MeResponse, ServiceOrder, SymptomCategory, TenantRole } from '@pitstop/shared-types';

const FLAGS: FeatureFlags = {
  triage: true,
  public_triage: true,
  diagnostics: true,
  portal: true,
  whatsapp: false,
  inventory: false,
  financial: false,
  ai: false
};

export function me(role: TenantRole = 'receptionist', flags: Partial<FeatureFlags> = {}): MeResponse {
  return {
    id: 'user-1',
    email: `${role}@demo.local`,
    is_super_admin: false,
    membership: { id: 'member-1', role, full_name: 'Pessoa de Teste' },
    tenant: {
      id: 'tenant-1',
      name: 'Oficina Demo',
      slug: 'oficina-demo',
      plan: 'pro',
      status: 'active',
      expires_at: null,
      feature_flags: { ...FLAGS, ...flags },
      limits: { max_users: 15, max_orders_month: 600, max_storage_mb: 5120 },
      settings: {}
    }
  };
}

export const CATALOG: SymptomCategory[] = [
  {
    id: 'cat-1',
    code: 'freios',
    name: 'Freios',
    icon: null,
    description: null,
    symptoms: [
      {
        id: 'sym-1',
        code: 'brake_noise',
        name: 'Chiado ao frear',
        description: 'Ruído agudo ao pisar no freio',
        follow_up_questions: [{ id: 'when', text: 'Quando acontece?', type: 'select', options: ['Sempre', 'Só a frio'] }]
      },
      { id: 'sym-2', code: 'soft_pedal', name: 'Pedal baixo', description: null, follow_up_questions: [] }
    ]
  }
];

export function order(overrides: Partial<ServiceOrder> = {}): ServiceOrder {
  return {
    id: 'order-1',
    order_number: 7,
    status: 'diagnosis',
    customer_id: 'cust-1',
    customer_name: 'Marina Souza',
    customer_phone: '71988887777',
    vehicle_id: 'veh-1',
    vehicle_plate: 'PIT1A23',
    vehicle_label: 'Ford Ka 2019',
    vehicle_brand: 'Ford',
    assigned_mechanic_id: null,
    assigned_mechanic_name: null,
    total_amount: 0,
    opened_at: '2026-11-10T12:00:00Z',
    updated_at: '2026-11-10T12:00:00Z',
    triage_session_id: 'triage-1',
    reported_symptoms: [{ symptom_code: 'brake_noise', answers: { when: 'Sempre' } }],
    free_form_notes: 'Piora na descida',
    mechanic_diagnosis: null,
    confirmed_causes: [],
    mechanic_suggestions_snapshot: {
      engine_version: '1',
      vehicle_brand: 'Ford',
      total_estimated_minutes: 90,
      unknown_symptoms: [],
      suggestions: [
        {
          symptom_code: 'brake_noise',
          symptom_name: 'Chiado ao frear',
          stats_scope: 'none',
          shop_total_occurrences: 0,
          estimated_minutes: 90,
          causes: [
            {
              description: 'Pastilhas desgastadas',
              final_score: 0.43,
              global_score: 0.43,
              shop_score: 0,
              origin: 'global',
              shop_occurrences: 0,
              shop_share_pct: 0,
              avg_price: null,
              avg_duration_minutes: null,
              notes: null,
              phrasing: 'Considere verificar: Pastilhas desgastadas.'
            }
          ],
          checks: [{ name: 'Medir espessura das pastilhas', tools: ['Paquímetro'], estimated_minutes: 15, shop_price: null, shop_duration_minutes: null }],
          parts: [{ name: 'Jogo de pastilhas', avg_quantity: 1, shop_price: 189.9, shop_sku: 'PF-1' }]
        }
      ]
    },
    suggestions_computed_at: '2026-11-10T12:05:00Z',
    approved_at: null,
    started_at: null,
    completed_at: null,
    delivered_at: null,
    items: [],
    history: [
      { id: 'h-1', from_status: null, to_status: 'draft', actor_type: 'staff', changed_by_name: 'Rafa', note: null, created_at: '2026-11-10T12:00:00Z' }
    ],
    notes: [],
    quotes: [],
    allowed_transitions: ['awaiting_approval', 'cancelled'],
    ...overrides
  };
}

export interface Page<T> {
  fixture: ComponentFixture<T>;
  component: T;
  http: HttpTestingController;
  router: Router;
  /** Texto visível da tela, com espaços normalizados. */
  text(): string;
  /** Responde a requisição pendente para o caminho (sem o prefixo /api/v1) e deixa a tela reagir. */
  respond(method: string, path: string, body: object, status?: number): Promise<unknown>;
  settle(): Promise<void>;
  click(label: string): Promise<void>;
}

/** Monta uma página com sessão já iniciada, HTTP simulado e inputs de rota. */
export async function mount<T>(
  component: Type<T>,
  options: { role?: TenantRole; flags?: Partial<FeatureFlags>; inputs?: Record<string, unknown>; anonymous?: boolean } = {}
): Promise<Page<T>> {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    // o modelo 3D do carro fica atrás de @defer: nos testes ele não é carregado (não há WebGL no navegador de teste)
    deferBlockBehavior: DeferBlockBehavior.Manual,
    providers: [
      provideExperimentalZonelessChangeDetection(),
      provideRouter([{ path: '**', children: [] }]),
      provideHttpClient(withInterceptors([apiInterceptor])),
      provideHttpClientTesting(),
      { provide: SESSION_KEY, useValue: 'teste.sessao' }
    ]
  });
  const auth = TestBed.inject(AuthService);
  if (!options.anonymous) {
    auth.tokens.set({ access_token: 'jwt-teste' });
    auth.me.set(me(options.role, options.flags));
  }
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(component);
  for (const [name, value] of Object.entries(options.inputs ?? {})) fixture.componentRef.setInput(name, value);

  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    }
  };
  const page: Page<T> = {
    fixture,
    component: fixture.componentInstance,
    http,
    router: TestBed.inject(Router),
    text: () => ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ').trim(),
    async respond(method, path, body, status = 200) {
      const request = http.expectOne((candidate) => candidate.method === method && candidate.url === `/api/v1${path}`, `${method} ${path}`);
      const sent = request.request.body;
      if (status >= 400) request.flush(body, { status, statusText: 'Erro' });
      else request.flush(body);
      await settle();
      return sent;
    },
    settle,
    async click(label) {
      const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('button, a'));
      const target = buttons.find((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim() === label);
      if (!target) throw new Error(`Botão "${label}" não encontrado. Disponíveis: ${buttons.map((element) => element.textContent?.trim()).join(' | ')}`);
      target.click();
      await settle();
    }
  };
  fixture.detectChanges();
  await settle();
  return page;
}
