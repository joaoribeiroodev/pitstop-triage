import type { SessionTokens } from '@pitstop/shared-types';

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');

export interface AppMetadata {
  tenant_id?: string | null;
  role?: string | null;
  is_super_admin?: boolean;
}

export interface CreateUserInput {
  email: string;
  /** Quem convida por e-mail passa uma senha provisória aleatória: a pessoa define a própria pelo link do convite. */
  password?: string;
  appMetadata: AppMetadata;
}

/**
 * Fronteira com o provedor de identidade. Em produção é o Supabase Auth;
 * em desenvolvimento/teste existe uma implementação local para rodar sem Supabase.
 * Senhas nunca são manipuladas fora desta fronteira.
 */
export interface AuthProvider {
  signIn(email: string, password: string): Promise<SessionTokens>;
  refresh(refreshToken: string): Promise<SessionTokens>;
  signOut(accessToken: string): Promise<void>;
  /** Cria o usuário ou devolve o id se o e-mail já existir (e atualiza o app_metadata). */
  createUser(input: CreateUserInput): Promise<{ id: string; invited: boolean }>;
  updateAppMetadata(userId: string, appMetadata: AppMetadata): Promise<void>;
  setPassword(userId: string, password: string): Promise<void>;
  /** Id do usuário no provedor a partir do e-mail, ou null. */
  findUserId(email: string): Promise<string | null>;
  deleteUser(userId: string): Promise<void>;
}
