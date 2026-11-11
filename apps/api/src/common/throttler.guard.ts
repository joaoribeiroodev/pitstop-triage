import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

/**
 * Rate limit por IP em geral e por token nas rotas do portal — assim um cliente atrás de
 * um NAT compartilhado não consome a cota de outro, e um token vazado tem teto próprio.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(request: { params?: Record<string, unknown>; path?: string; url?: string; ip?: string }): Promise<string> {
    const token = request.params?.token;
    if (typeof token === 'string' && String(request.path ?? request.url).includes('/portal/')) {
      return `portal:${createHash('sha256').update(token).digest('hex')}`;
    }
    return request.ip ?? 'unknown';
  }
}
