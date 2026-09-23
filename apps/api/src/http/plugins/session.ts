import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Container } from '../../container.js';
import type { Account, Session } from '../../domain/types.js';

export const SESSION_COOKIE = 'k785_session';
export const OTP_PENDING_COOKIE = 'k785_otp_pending';

declare module 'fastify' {
  interface FastifyRequest {
    auth: { session: Session; account: Account } | null;
  }
  interface FastifyInstance {
    container: Container;
  }
}

/**
 * Загружает сессию из httpOnly-cookie (SERVER.md §6.1: "httpOnly-cookie вместо
 * k785_session"). Cookie хранит только opaque id, подписанный секретом сервера —
 * сама сессия и её TTL живут в БД и могут быть отозваны в любой момент.
 */
export const sessionPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) {
      req.auth = null;
      return;
    }
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) {
      req.auth = null;
      return;
    }
    const ctx = await app.container.auth.getSessionContext(unsigned.value);
    req.auth = ctx;
  });
});

export function setSessionCookie(reply: FastifyReply, sessionId: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    signed: true,
    maxAge: 12 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function setOtpPendingCookie(reply: FastifyReply, accountId: string, secure: boolean): void {
  reply.setCookie(OTP_PENDING_COOKIE, accountId, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/auth',
    signed: true,
    maxAge: 5 * 60,
  });
}

export function readOtpPendingCookie(req: FastifyRequest): string | null {
  const raw = req.cookies[OTP_PENDING_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid ? unsigned.value : null;
}

export function clearOtpPendingCookie(reply: FastifyReply): void {
  reply.clearCookie(OTP_PENDING_COOKIE, { path: '/api/auth' });
}

export function requireAuth(req: FastifyRequest, reply: FastifyReply): { session: Session; account: Account } | null {
  if (!req.auth) {
    reply.code(401).send({ ok: false, error: 'Требуется вход' });
    return null;
  }
  return req.auth;
}
