import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normPhone } from '@kontur785/shared';
import {
  clearOtpPendingCookie,
  clearSessionCookie,
  readOtpPendingCookie,
  requireAuth,
  setOtpPendingCookie,
  setSessionCookie,
} from '../plugins/session.js';

const registerSchema = z.object({
  inn: z.string(),
  login: z.string(),
  password: z.string(),
  password2: z.string(),
  org: z.string().optional(),
  fio: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  side: z.enum(['clinic', 'operator']),
  role: z.string().optional(),
  invite: z.string().optional(),
});

const loginSchema = z.object({ inn: z.string(), login: z.string(), password: z.string() });
const loginByPhoneSchema = z.object({ inn: z.string(), phone: z.string(), password: z.string() });
const otpVerifySchema = z.object({ code: z.string() });
const start2faSchema = z.object({ via: z.enum(['sms', 'email']), password: z.string() });
const disable2faSchema = z.object({ password: z.string() });
const requestResetSchema = z.object({ inn: z.string(), login: z.string() });
const confirmResetSchema = z.object({ inn: z.string(), login: z.string(), code: z.string(), password: z.string(), password2: z.string() });
const changePasswordSchema = z.object({ oldPassword: z.string(), newPassword: z.string(), newPassword2: z.string() });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const secureCookies = process.env.NODE_ENV === 'production';

  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const r = await app.container.auth.register(body as Parameters<typeof app.container.auth.register>[0]);
    if (!r.ok) return reply.code(400).send(r);
    return reply.send({ ok: true, pending: r.pending, warn: r.warn });
  });

  // Публичная проверка ссылки-приглашения: форма регистрации показывает клинику и роль.
  app.get('/api/auth/invite', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { token } = z.object({ token: z.string() }).parse(req.query);
    const preview = await app.container.auth.invites.peek(token);
    if (!preview) return reply.code(404).send({ ok: false, error: 'Приглашение недействительно или просрочено' });
    return reply.send({ ok: true, invite: preview });
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const r = await app.container.auth.login(body.inn, body.login, body.password, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip,
    });
    if (!r.ok) return reply.code(401).send(r);
    if ('needOtp' in r) {
      // accountId не уходит клиенту напрямую — он в подписанной cookie, иначе
      // клиент мог бы попытаться подтвердить код для чужого аккаунта
      const acc = await app.container.repos.accounts.findByInnLogin(body.inn.replace(/\D/g, ''), body.login);
      if (acc) setOtpPendingCookie(reply, acc.id, secureCookies);
      return reply.send({ ok: true, needOtp: true, via: r.via });
    }
    setSessionCookie(reply, r.session.id, secureCookies);
    return reply.send({ ok: true });
  });

  app.post('/api/auth/login-by-phone', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = loginByPhoneSchema.parse(req.body);
    const r = await app.container.auth.loginByPhone(body.inn, body.phone, body.password, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip,
    });
    if (!r.ok) return reply.code(401).send(r);
    if ('needOtp' in r) {
      const acc = await app.container.repos.accounts.findByInnPhone(body.inn.replace(/\D/g, ''), normPhone(body.phone));
      if (acc) setOtpPendingCookie(reply, acc.id, secureCookies);
      return reply.send({ ok: true, needOtp: true, via: r.via });
    }
    setSessionCookie(reply, r.session.id, secureCookies);
    return reply.send({ ok: true });
  });

  app.post('/api/auth/otp/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const accountId = readOtpPendingCookie(req);
    if (!accountId) return reply.code(400).send({ ok: false, error: 'Код не запрашивался' });
    const { code } = otpVerifySchema.parse(req.body);
    const r = await app.container.auth.verifyOtp(accountId, code, { userAgent: req.headers['user-agent'] ?? null, ip: req.ip });
    if (!r.ok) return reply.code(401).send(r);
    clearOtpPendingCookie(reply);
    setSessionCookie(reply, r.session.id, secureCookies);
    return reply.send({ ok: true });
  });

  app.post('/api/auth/otp/resend', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const accountId = readOtpPendingCookie(req);
    if (!accountId) return reply.code(400).send({ ok: false, error: 'Сначала введите логин и пароль' });
    const r = await app.container.auth.resendOtp(accountId);
    return reply.send(r);
  });

  app.post('/api/auth/password/request-reset', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = requestResetSchema.parse(req.body);
    const r = await app.container.auth.requestReset(body.inn, body.login);
    return reply.send(r);
  });

  app.post('/api/auth/password/confirm-reset', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = confirmResetSchema.parse(req.body);
    const acc = await app.container.repos.accounts.findByInnLogin(body.inn.replace(/\D/g, ''), body.login);
    if (!acc) return reply.code(400).send({ ok: false, error: 'Код не запрашивался' });
    const r = await app.container.auth.confirmReset(acc.id, body.code, body.password, body.password2);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/auth/password/change', async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const body = changePasswordSchema.parse(req.body);
    const r = await app.container.auth.changePassword(ctx.account.id, body.oldPassword, body.newPassword, body.newPassword2);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/auth/2fa/start', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const body = start2faSchema.parse(req.body);
    const r = await app.container.auth.start2fa(ctx.account.id, body.via, body.password);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/auth/2fa/confirm', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const { code } = otpVerifySchema.parse(req.body);
    const r = await app.container.auth.confirm2fa(ctx.account.id, code);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/auth/2fa/disable', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;
    const body = disable2faSchema.parse(req.body);
    const r = await app.container.auth.disable2fa(ctx.account.id, body.password);
    return reply.code(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth) await app.container.auth.logout(req.auth.session.id);
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  app.get('/api/auth/session', async (req, reply) => {
    if (!req.auth) return reply.send({ ok: true, session: null });
    const { account } = req.auth;
    return reply.send({
      ok: true,
      session: {
        accountId: account.id,
        inn: account.inn,
        login: account.login,
        side: account.side,
        role: account.role,
        org: account.org,
        fio: account.fio,
        mustChange: account.mustChange,
        twoFactor: account.twoFactor,
        twoFactorVia: account.twoFactorVia,
        hasPhone: !!account.phone,
        hasEmail: !!account.email,
      },
    });
  });
}
