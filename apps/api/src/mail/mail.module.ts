import { BadGatewayException, BadRequestException, Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createTransport } from 'nodemailer';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';

const KEY = 'smtp';

interface StoredSmtp {
  user: string;
  from_name: string;
  /** Senha de app cifrada (AES-256-GCM): iv.tag.dados em base64url. */
  secret: string;
}

export interface EmailSettings {
  configured: boolean;
  user: string | null;
  from_name: string | null;
  updated_at: string | null;
}

export interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Modelo único dos e-mails transacionais: um parágrafo, um botão e o link por extenso. */
export function actionEmail(input: { title: string; intro: string; action: string; url: string; footer: string }): Pick<Message, 'text' | 'html'> {
  const text = `${input.title}\n\n${input.intro}\n\n${input.action}: ${input.url}\n\n${input.footer}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827">
  <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#c2410c;margin:0 0 8px">PitStop</p>
  <h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(input.title)}</h1>
  <p style="font-size:15px;line-height:1.5;margin:0 0 24px">${escapeHtml(input.intro)}</p>
  <p style="margin:0 0 24px"><a href="${escapeHtml(input.url)}" style="background:#fb923c;color:#111827;font-weight:bold;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">${escapeHtml(input.action)}</a></p>
  <p style="font-size:13px;line-height:1.5;color:#4b5563;margin:0 0 8px">Se o botão não abrir, copie este endereço no navegador:<br>${escapeHtml(input.url)}</p>
  <p style="font-size:13px;line-height:1.5;color:#4b5563;margin:0">${escapeHtml(input.footer)}</p>
</div>`;
  return { text, html };
}

/**
 * E-mail da plataforma, configurado pelo super admin dentro do sistema: uma conta Gmail e a "senha de app" dela.
 * A senha é cifrada antes de ir ao banco e nunca volta para o painel nem aparece em log.
 * A chave de cifra deriva de APP_JWT_SECRET: se o segredo for trocado, basta salvar a senha de app de novo.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly key: Buffer;

  constructor(
    private readonly db: DatabaseService,
    @Inject(ENV) env: Env
  ) {
    this.key = createHash('sha256').update(`pitstop:smtp:${env.appJwtSecret}`).digest();
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
  }

  private decrypt(secret: string): string | null {
    try {
      const [iv, tag, data] = secret.split('.').map((part) => Buffer.from(part, 'base64url'));
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  private stored(): Promise<{ value: StoredSmtp; updated_at: string } | null> {
    return this.db.admin((db) =>
      db.maybeOne<{ value: StoredSmtp; updated_at: string }>('select value, updated_at from public.platform_settings where key = $1', [KEY])
    );
  }

  async settings(): Promise<EmailSettings> {
    const row = await this.stored();
    const usable = !!row && this.decrypt(row.value.secret) !== null;
    return { configured: usable, user: row?.value.user ?? null, from_name: row?.value.from_name ?? null, updated_at: row?.updated_at ?? null };
  }

  async configured(): Promise<boolean> {
    return (await this.settings()).configured;
  }

  /** Senha em branco mantém a que já está salva (o painel nunca a recebe de volta). */
  async save(input: { user: string; from_name?: string; app_password?: string }, updatedBy: string): Promise<EmailSettings> {
    const current = await this.stored();
    const user = input.user.trim().toLowerCase();
    // O Google mostra a senha de app em quatro blocos separados por espaço; os espaços não fazem parte dela.
    const password = input.app_password?.replace(/\s+/g, '');
    const secret = password ? this.encrypt(password) : current?.value.secret;
    if (!secret) throw new BadRequestException('Informe a senha de app do Gmail.');
    const value: StoredSmtp = { user, from_name: input.from_name?.trim() || 'PitStop', secret };
    await this.db.admin((db) =>
      db.exec(
        `insert into public.platform_settings (key, value, updated_by) values ($1, $2, $3)
         on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by`,
        [KEY, JSON.stringify(value), updatedBy]
      )
    );
    return this.settings();
  }

  async remove(): Promise<EmailSettings> {
    await this.db.admin((db) => db.exec('delete from public.platform_settings where key = $1', [KEY]));
    return this.settings();
  }

  /** Envia ou lança 502 com um motivo legível. O conteúdo da mensagem nunca vai para o log. */
  async send(message: Message): Promise<void> {
    const row = await this.stored();
    const password = row ? this.decrypt(row.value.secret) : null;
    if (!row || !password) throw new BadRequestException('O e-mail da plataforma ainda não foi configurado no painel admin.');
    const transport = createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: row.value.user, pass: password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000
    });
    try {
      await transport.sendMail({ from: { name: row.value.from_name, address: row.value.user }, ...message });
    } catch (error) {
      const reason =
        (error as { responseCode?: number; code?: string }).responseCode === 535 || (error as { code?: string }).code === 'EAUTH'
          ? 'o Gmail recusou o login. Confira o e-mail e gere uma nova senha de app.'
          : 'não foi possível falar com o Gmail agora. Tente de novo em instantes.';
      this.logger.warn(`Envio de e-mail falhou (${(error as { code?: string }).code ?? 'erro'})`);
      throw new BadGatewayException(`E-mail não enviado: ${reason}`);
    } finally {
      transport.close();
    }
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
