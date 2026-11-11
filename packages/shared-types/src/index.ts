/**
 * Contratos compartilhados entre o backend NestJS e os frontends Angular.
 * Os campos de entidade seguem o nome das colunas do banco (snake_case).
 */

// ───────────── papéis e tenants ─────────────
export const TENANT_ROLES = ['owner', 'manager', 'receptionist', 'mechanic'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const TENANT_STATUSES = ['active', 'suspended', 'expired'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_PLANS = ['basic', 'pro', 'enterprise'] as const;
export type TenantPlan = (typeof TENANT_PLANS)[number];

export const FEATURE_FLAGS = ['triage', 'public_triage', 'diagnostics', 'portal', 'whatsapp', 'schedule', 'inventory', 'financial', 'ai'] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FeatureFlags = Record<FeatureFlag, boolean>;

export interface TenantLimits {
  max_users: number;
  max_orders_month: number;
  max_storage_mb: number;
}

export interface TenantSettings {
  /** Se true, mecânicos enxergam toda a fila; se false, apenas as OS atribuídas a eles. */
  mechanics_see_all_orders?: boolean;
  /** Validade padrão (dias) do link enviado ao cliente. */
  portal_token_days?: number;
  /** Boxes (vagas de serviço) da oficina, usados na agenda. */
  bays?: string[];
  /** Textos dos avisos ao cliente, por evento. Ausente: vale o texto padrão. */
  notification_templates?: Partial<NotificationTemplates>;
  /** Envio automático pela API oficial do WhatsApp nas mudanças de status (exige o módulo e a integração configurada). */
  whatsapp_auto?: boolean;
}

// ───────────── notificações (Fase 2) ─────────────
export const NOTIFICATION_EVENTS = ['quote_pending', 'status_update', 'vehicle_ready'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export type NotificationTemplates = Record<NotificationEvent, string>;

/** Marcadores aceitos nos textos: {cliente} {oficina} {veiculo} {placa} {os} {status} {total} {link}. */
export const NOTIFICATION_PLACEHOLDERS = ['cliente', 'oficina', 'veiculo', 'placa', 'os', 'status', 'total', 'link'] as const;

export const DEFAULT_NOTIFICATION_TEMPLATES: NotificationTemplates = {
  quote_pending:
    'Olá, {cliente}! O orçamento do seu {veiculo} ({placa}) está pronto. Total: {total}. Veja os itens e aprove ou recuse por aqui: {link}\n{oficina}',
  status_update: 'Olá, {cliente}! Novidade na OS {os} do seu {veiculo}: {status}. Acompanhe por aqui: {link}\n{oficina}',
  vehicle_ready: 'Olá, {cliente}! Seu {veiculo} ({placa}) está pronto para retirada. Detalhes do serviço: {link}\n{oficina}'
};

export function renderNotification(template: string, values: Partial<Record<(typeof NOTIFICATION_PLACEHOLDERS)[number], string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? (values as Record<string, string>)[key] : whole)).trim();
}

export interface NotificationPreview {
  event: NotificationEvent;
  message: string;
  whatsapp_url: string | null;
}

export interface NotificationLogEntry {
  id: string;
  event: NotificationEvent;
  channel: 'whatsapp_link' | 'whatsapp_api';
  recipient: string | null;
  status: 'sent' | 'failed' | 'skipped';
  detail: string | null;
  created_at: string;
}

const MVP_FLAGS: FeatureFlags = {
  triage: true,
  public_triage: true,
  diagnostics: true,
  portal: true,
  whatsapp: false,
  schedule: true,
  inventory: false,
  financial: false,
  ai: false
};

export const PLAN_DEFAULTS: Record<TenantPlan, { feature_flags: FeatureFlags; limits: TenantLimits }> = {
  basic: {
    feature_flags: { ...MVP_FLAGS },
    limits: { max_users: 5, max_orders_month: 150, max_storage_mb: 1024 }
  },
  pro: {
    feature_flags: { ...MVP_FLAGS, whatsapp: true, inventory: true, financial: true },
    limits: { max_users: 15, max_orders_month: 600, max_storage_mb: 5120 }
  },
  enterprise: {
    feature_flags: { ...MVP_FLAGS, whatsapp: true, inventory: true, financial: true },
    limits: { max_users: 100, max_orders_month: 5000, max_storage_mb: 51200 }
  }
};

export function resolveFeatureFlags(plan: TenantPlan, overrides: Partial<FeatureFlags> | null | undefined): FeatureFlags {
  return { ...PLAN_DEFAULTS[plan].feature_flags, ...(overrides ?? {}) };
}

export function resolveLimits(plan: TenantPlan, overrides: Partial<TenantLimits> | null | undefined): TenantLimits {
  return { ...PLAN_DEFAULTS[plan].limits, ...(overrides ?? {}) };
}

// ───────────── ordem de serviço: ciclo de vida ─────────────
export const ORDER_STATUSES = [
  'draft',
  'diagnosis',
  'awaiting_approval',
  'approved',
  'in_progress',
  'completed',
  'delivered',
  'rejected',
  'cancelled'
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Matriz explícita de transições válidas. Qualquer par fora dela é rejeitado pelo backend. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ['diagnosis', 'cancelled'],
  diagnosis: ['awaiting_approval', 'cancelled'],
  awaiting_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['delivered'],
  delivered: [],
  rejected: ['diagnosis', 'cancelled'],
  cancelled: []
};

/**
 * Transições que só acontecem como efeito do fluxo de orçamento
 * (enviar / aprovar / recusar) e nunca por pedido direto de mudança de status.
 */
export const QUOTE_DRIVEN_STATUSES: readonly OrderStatus[] = ['awaiting_approval', 'approved', 'rejected'];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Rascunho',
  diagnosis: 'Em diagnóstico',
  awaiting_approval: 'Aguardando aprovação',
  approved: 'Aprovada',
  in_progress: 'Em execução',
  completed: 'Concluída',
  delivered: 'Entregue',
  rejected: 'Orçamento recusado',
  cancelled: 'Cancelada'
};

export const QUOTE_STATUSES = ['draft', 'sent', 'approved', 'rejected', 'expired'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Rascunho',
  sent: 'Enviado',
  approved: 'Aprovado',
  rejected: 'Recusado',
  expired: 'Expirado'
};

export const TRIAGE_STATUSES = ['pending', 'converted', 'archived'] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

export const ITEM_TYPES = ['service', 'part'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const TOKEN_PURPOSES = ['view_order', 'approve_quote'] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

// ───────────── convenções de API ─────────────
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

// ───────────── sessão ─────────────
export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface MeResponse {
  id: string;
  email: string;
  is_super_admin: boolean;
  impersonated_by?: string;
  membership: {
    id: string;
    role: TenantRole;
    full_name: string;
  } | null;
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: TenantPlan;
    status: TenantStatus;
    expires_at: string | null;
    feature_flags: FeatureFlags;
    limits: TenantLimits;
    settings: TenantSettings;
  } | null;
}

// ───────────── entidades ─────────────
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  document: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: TenantStatus;
  plan: TenantPlan;
  is_trial: boolean;
  expires_at: string | null;
  suspended_at: string | null;
  feature_flags: Partial<FeatureFlags>;
  limits: Partial<TenantLimits>;
  settings: TenantSettings;
  created_at: string;
  updated_at: string;
}

export interface TenantUser {
  id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  full_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  document: string | null;
  notes: string | null;
  anonymized_at: string | null;
  created_at: string;
  updated_at: string;
  vehicles_count?: number;
}

export interface Vehicle {
  id: string;
  customer_id: string;
  plate: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vin: string | null;
  fuel_type: string | null;
  current_mileage: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  customer_name?: string;
  customer_phone?: string | null;
}

export type QuestionType = 'text' | 'select' | 'number' | 'boolean';

export interface FollowUpQuestion {
  id: string;
  text: string;
  type: QuestionType;
  options?: string[];
}

export interface SymptomCause {
  name: string;
  weight: number;
  notes?: string;
}

export interface SymptomCheck {
  name: string;
  tools: string[];
  estimated_minutes: number;
}

export interface SymptomPart {
  name: string;
  avg_quantity: number;
}

export interface Symptom {
  id: string;
  code: string;
  name: string;
  description: string | null;
  follow_up_questions: FollowUpQuestion[];
}

export interface SymptomCategory {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  description: string | null;
  symptoms: Symptom[];
}

export type AnswerValue = string | number | boolean | null;

export interface ReportedSymptom {
  symptom_code: string;
  answers: Record<string, AnswerValue>;
}

export interface TriageContact {
  name: string;
  phone: string;
  plate?: string;
  vehicle?: string;
}

export interface TriageSession {
  id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  reported_symptoms: ReportedSymptom[];
  free_form_notes: string | null;
  status: TriageStatus;
  source: 'staff' | 'public';
  contact: TriageContact | null;
  service_order_id: string | null;
  created_at: string;
  customer_name?: string | null;
  vehicle_plate?: string | null;
  vehicle_label?: string | null;
}

export interface OrderItem {
  id: string;
  type: ItemType;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  sort_order: number;
  /** Item do estoque de onde a peça sai na conclusão da OS (módulo de estoque). */
  inventory_item_id?: string | null;
}

export interface StatusHistoryEntry {
  id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_type: 'staff' | 'customer' | 'system' | 'support';
  changed_by_name: string | null;
  note: string | null;
  created_at: string;
}

export interface OrderNote {
  id: string;
  author_name: string | null;
  body: string;
  visible_to_customer: boolean;
  created_at: string;
}

export interface ConfirmedCause {
  symptom_code: string;
  cause_description: string;
}

export interface ServiceOrderSummary {
  id: string;
  order_number: number;
  status: OrderStatus;
  customer_id: string;
  customer_name: string;
  vehicle_id: string;
  vehicle_plate: string;
  vehicle_label: string;
  assigned_mechanic_id: string | null;
  assigned_mechanic_name: string | null;
  total_amount: number;
  opened_at: string;
  updated_at: string;
}

export interface ServiceOrder extends ServiceOrderSummary {
  triage_session_id: string | null;
  reported_symptoms: ReportedSymptom[];
  free_form_notes: string | null;
  mechanic_diagnosis: string | null;
  confirmed_causes: ConfirmedCause[];
  mechanic_suggestions_snapshot: DiagnosticResult | null;
  suggestions_computed_at: string | null;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  delivered_at: string | null;
  customer_phone: string | null;
  vehicle_brand: string | null;
  items: OrderItem[];
  history: StatusHistoryEntry[];
  notes: OrderNote[];
  quotes: Quote[];
  allowed_transitions: OrderStatus[];
}

export interface Quote {
  id: string;
  service_order_id: string;
  version: number;
  total_amount: number;
  status: QuoteStatus;
  sent_at: string | null;
  responded_at: string | null;
  responded_via: 'portal' | 'staff' | null;
  expires_at: string | null;
  response_notes: string | null;
  created_at: string;
  items?: OrderItem[];
}

export interface SendQuoteResponse {
  quote: Quote;
  /** URL pública com o token em claro — só é devolvida neste momento; o banco guarda apenas o hash. */
  portal_url: string;
  message: string;
  whatsapp_url: string | null;
  expires_at: string;
}

export interface ShopService {
  id: string;
  name: string;
  description: string | null;
  default_price: number;
  duration_minutes: number | null;
  is_active: boolean;
}

export interface ShopPart {
  id: string;
  name: string;
  sku: string | null;
  default_price: number;
  is_active: boolean;
}

// ───────────── motor de diagnóstico determinístico ─────────────
export type CauseOrigin = 'global' | 'shop' | 'both';

export interface SuggestedCause {
  description: string;
  final_score: number;
  global_score: number;
  shop_score: number;
  origin: CauseOrigin;
  shop_occurrences: number;
  /** Participação (0–100) desta causa nas OS da oficina para o sintoma, no escopo usado. */
  shop_share_pct: number;
  avg_price: number | null;
  avg_duration_minutes: number | null;
  notes: string | null;
  /** Texto pronto para a interface: sempre uma sugestão, nunca uma afirmação. */
  phrasing: string;
}

export interface SuggestedCheck {
  name: string;
  tools: string[];
  estimated_minutes: number;
  shop_price: number | null;
  shop_duration_minutes: number | null;
}

export interface SuggestedPart {
  name: string;
  avg_quantity: number;
  shop_price: number | null;
  shop_sku: string | null;
}

export interface SymptomSuggestion {
  symptom_code: string;
  symptom_name: string;
  /** brand: histórico filtrado pela marca; all: todas as marcas; none: sem histórico na oficina. */
  stats_scope: 'brand' | 'all' | 'none';
  shop_total_occurrences: number;
  causes: SuggestedCause[];
  checks: SuggestedCheck[];
  parts: SuggestedPart[];
  estimated_minutes: number;
}

export interface DiagnosticResult {
  engine_version: string;
  vehicle_brand: string | null;
  suggestions: SymptomSuggestion[];
  total_estimated_minutes: number;
  unknown_symptoms: string[];
  /** Resumo em linguagem simples gerado pela camada opcional de IA (Fase 4). Nunca substitui as sugestões acima. */
  ai_note?: string;
}

// ───────────── portal do cliente ─────────────
export interface PortalQuote {
  id: string;
  version: number;
  status: QuoteStatus;
  total_amount: number;
  sent_at: string | null;
  expires_at: string | null;
  can_respond: boolean;
  items: Array<{ type: ItemType; description: string; quantity: number; unit_price: number; total: number }>;
}

/** DTO dedicado do portal: construído campo a campo, nunca uma projeção de entidade interna. */
export interface PortalOrderResponse {
  shop: { name: string; phone: string | null };
  order: {
    number: number;
    status: OrderStatus;
    status_label: string;
    opened_at: string;
    total_amount: number;
  };
  vehicle: { plate: string; brand: string | null; model: string | null; year: number | null };
  reported_symptoms: Array<{ name: string; answers: Array<{ question: string; answer: string }> }>;
  customer_notes: string | null;
  timeline: Array<{ status: OrderStatus; label: string; at: string }>;
  shop_messages: Array<{ body: string; at: string }>;
  quote: PortalQuote | null;
  consent_required: boolean;
  privacy_policy_version: string;
}

export interface PortalHistoryEntry {
  number: number;
  status: OrderStatus;
  status_label: string;
  opened_at: string;
  delivered_at: string | null;
  total_amount: number;
  services: string[];
}

// ───────────── dashboard ─────────────
export interface DashboardSummary {
  opened_today: number;
  awaiting_approval: number;
  in_progress: number;
  completed_this_week: number;
  pending_triage: number;
  needs_action: ServiceOrderSummary[];
  /** Primeiros passos da oficina: o que já foi feito. O painel esconde o cartão quando tudo está pronto. */
  onboarding: { team: boolean; catalog: boolean; first_order: boolean };
}

// ───────────── admin ─────────────
export interface AdminTenantRow extends Tenant {
  users_count: number;
  orders_this_month: number;
  expiring_soon: boolean;
}

export interface AuditLogEntry {
  id: string;
  tenant_id: string | null;
  tenant_slug: string | null;
  super_admin_email: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AdminMetrics {
  tenants_active: number;
  tenants_trial: number;
  tenants_suspended: number;
  tenants_expiring_7d: number;
  orders_this_month: number;
  active_users: number;
  growth: Array<{ month: string; tenants: number; orders: number }>;
}

// ───────────── estoque (Fase 3) ─────────────
export interface InventoryItem {
  id: string;
  sku: string | null;
  name: string;
  location: string | null;
  quantity_on_hand: number;
  minimum_quantity: number;
  unit_cost: number;
  unit_price: number;
  is_active: boolean;
  /** quantity_on_hand <= minimum_quantity */
  low_stock: boolean;
  created_at: string;
  updated_at: string;
}

export const STOCK_MOVEMENT_TYPES = ['in', 'out', 'adjustment'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export interface StockMovement {
  id: string;
  inventory_item_id: string;
  type: StockMovementType;
  /** Entrada e saída: quantidade movimentada. Ajuste: o novo saldo contado. */
  quantity: number;
  reason: string | null;
  service_order_id: string | null;
  order_number?: number | null;
  created_by_name?: string | null;
  created_at: string;
}

// ───────────── financeiro (Fase 3) ─────────────
export const FINANCIAL_TYPES = ['receivable', 'payable'] as const;
export type FinancialType = (typeof FINANCIAL_TYPES)[number];

export interface FinancialEntry {
  id: string;
  type: FinancialType;
  description: string;
  counterparty: string | null;
  amount: number;
  due_date: string | null;
  paid_at: string | null;
  notes: string | null;
  service_order_id: string | null;
  order_number?: number | null;
  /** Em aberto e com vencimento anterior a hoje. */
  overdue: boolean;
  created_at: string;
}

export interface FinancialSummary {
  receivable_open: number;
  receivable_overdue: number;
  payable_open: number;
  payable_overdue: number;
  received_this_month: number;
  paid_this_month: number;
}

// ───────────── agenda (Fase 3) ─────────────
export const APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'done', 'cancelled', 'no_show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  done: 'Atendido',
  cancelled: 'Cancelado',
  no_show: 'Não compareceu'
};

export interface Appointment {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  bay: string | null;
  mechanic_id: string | null;
  mechanic_name?: string | null;
  status: AppointmentStatus;
  notes: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  vehicle_id: string | null;
  vehicle_plate?: string | null;
  vehicle_label?: string | null;
  service_order_id: string | null;
  created_at: string;
}

// ───────────── indicadores (Fase 3) ─────────────
export interface ReportsOverview {
  from: string;
  to: string;
  orders_completed: number;
  revenue: number;
  average_ticket: number;
  /** Minutos entre o início e a conclusão do serviço, em média. */
  average_execution_minutes: number | null;
  quotes: { sent: number; approved: number; rejected: number; conversion_pct: number | null };
  top_services: Array<{ description: string; type: ItemType; times: number; revenue: number }>;
  by_mechanic: Array<{ mechanic_name: string; orders: number; revenue: number }>;
  by_month: Array<{ month: string; orders: number; revenue: number }>;
}
