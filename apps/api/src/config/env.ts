export interface Env {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  databaseSsl: boolean;
  authProvider: 'supabase' | 'local';
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  /** Segredo HS256 legado do Supabase. Se vazio, os JWTs são validados via JWKS do projeto. */
  supabaseJwtSecret: string;
  /** Segredo dos tokens emitidos pelo próprio backend (impersonation e provedor local de dev/teste). */
  appJwtSecret: string;
  corsOrigins: string[];
  portalBaseUrl: string;
  /** Fuso padrão das regras de negócio (dia, semana, mês) quando a oficina não definiu o seu. O armazenamento é sempre UTC. */
  appTimezone: string;
  privacyPolicyVersion: string;
  /** Contato do encarregado (DPO) exibido na política de privacidade. Vazio: a política manda procurar a oficina. */
  dpoContactEmail: string;
  fipePlateApiUrl: string;
  /** Integração opcional com a API oficial do WhatsApp (Meta Cloud API). Sem token e número, o envio automático fica desligado. */
  whatsapp: {
    apiUrl: string;
    token: string;
    phoneNumberId: string;
    templates: { quote_pending: string; status_update: string; vehicle_ready: string };
    language: string;
  };
  /** Chave opcional para a camada de IA (Fase 4). Vazia: vale o NoOpEnhancer. */
  openaiApiKey: string;
  openaiModel: string;
  logLevel: string;
}

export const ENV = Symbol('ENV');

function required(source: NodeJS.ProcessEnv, key: string): string {
  const value = source[key];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${key}`);
  return value;
}

/** APP_TIMEZONE precisa ser um fuso IANA válido; um valor errado derruba a subida, em vez de gerar relatórios no dia errado. */
function timezone(value: string | undefined): string {
  const zone = value?.trim() || 'America/Sao_Paulo';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    throw new Error(`APP_TIMEZONE inválido: "${zone}". Use um fuso IANA, por exemplo America/Sao_Paulo.`);
  }
  return zone;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const nodeEnv = source.NODE_ENV ?? 'development';
  const authProvider = (source.AUTH_PROVIDER ?? 'supabase') as Env['authProvider'];
  if (authProvider !== 'supabase' && authProvider !== 'local') {
    throw new Error('AUTH_PROVIDER deve ser "supabase" ou "local"');
  }
  if (authProvider === 'local' && nodeEnv === 'production') {
    throw new Error('AUTH_PROVIDER=local é exclusivo de desenvolvimento/teste e não pode rodar em produção');
  }
  const appJwtSecret = required(source, 'APP_JWT_SECRET');
  if (appJwtSecret.length < 32) throw new Error('APP_JWT_SECRET deve ter ao menos 32 caracteres');

  const supabase = authProvider === 'supabase';
  return {
    nodeEnv,
    port: Number(source.PORT ?? 3000),
    databaseUrl: required(source, 'DATABASE_URL'),
    databaseSsl: (source.DATABASE_SSL ?? (supabase ? 'true' : 'false')) === 'true',
    authProvider,
    supabaseUrl: supabase ? required(source, 'SUPABASE_URL').replace(/\/$/, '') : '',
    supabaseAnonKey: supabase ? required(source, 'SUPABASE_ANON_KEY') : '',
    supabaseServiceRoleKey: supabase ? required(source, 'SUPABASE_SERVICE_ROLE_KEY') : '',
    supabaseJwtSecret: source.SUPABASE_JWT_SECRET ?? '',
    appJwtSecret,
    corsOrigins: (source.CORS_ORIGINS ?? 'http://localhost:4200,http://localhost:4300')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    portalBaseUrl: (source.PORTAL_BASE_URL ?? 'http://localhost:4200').replace(/\/$/, ''),
    appTimezone: timezone(source.APP_TIMEZONE),
    privacyPolicyVersion: source.PRIVACY_POLICY_VERSION ?? '2026-11',
    dpoContactEmail: (source.DPO_CONTACT_EMAIL ?? '').trim(),
    fipePlateApiUrl: source.FIPE_PLATE_API_URL ?? '',
    whatsapp: {
      apiUrl: (source.WHATSAPP_API_URL ?? 'https://graph.facebook.com/v21.0').replace(/\/$/, ''),
      token: source.WHATSAPP_API_TOKEN ?? '',
      phoneNumberId: source.WHATSAPP_PHONE_NUMBER_ID ?? '',
      templates: {
        quote_pending: source.WHATSAPP_TEMPLATE_QUOTE_PENDING ?? 'pitstop_orcamento',
        status_update: source.WHATSAPP_TEMPLATE_STATUS_UPDATE ?? 'pitstop_status',
        vehicle_ready: source.WHATSAPP_TEMPLATE_VEHICLE_READY ?? 'pitstop_pronto'
      },
      language: source.WHATSAPP_TEMPLATE_LANGUAGE ?? 'pt_BR'
    },
    openaiApiKey: source.OPENAI_API_KEY ?? '',
    openaiModel: source.OPENAI_MODEL ?? 'gpt-4o-mini',
    logLevel: source.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info')
  };
}
