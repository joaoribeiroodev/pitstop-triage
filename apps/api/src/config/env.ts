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
  privacyPolicyVersion: string;
  fipePlateApiUrl: string;
  logLevel: string;
}

export const ENV = Symbol('ENV');

function required(source: NodeJS.ProcessEnv, key: string): string {
  const value = source[key];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${key}`);
  return value;
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
    privacyPolicyVersion: source.PRIVACY_POLICY_VERSION ?? '2026-11',
    fipePlateApiUrl: source.FIPE_PLATE_API_URL ?? '',
    logLevel: source.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info')
  };
}
