import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpNotifier } from './httpNotifier.js';

describe('HttpNotifier — реальная доставка через SMS.ru/Resend', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: async () => ({ status: 'OK' }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('без ключа SMS_PROVIDER_API_KEY смс не отправляется и fetch не вызывается', async () => {
    const notifier = new HttpNotifier(undefined, 'email-key', 'noreply@x.ru');
    await notifier.sendOtp('sms', '+79160000000', '123456');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendOtp по смс обращается к SMS.ru с номером и кодом в тексте', async () => {
    const notifier = new HttpNotifier('sms-key', undefined, 'noreply@x.ru');
    await notifier.sendOtp('sms', '+79160000000', '123456');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('sms.ru/sms/send');
    expect(url).toContain('api_id=sms-key');
    expect(url).toContain(encodeURIComponent('+79160000000'));
    expect(decodeURIComponent(url)).toContain('123456');
  });

  it('sendOtp по почте шлёт POST на Resend с темой и телом письма', async () => {
    const notifier = new HttpNotifier(undefined, 'email-key', 'noreply@x.ru');
    await notifier.sendOtp('email', 'user@example.com', '654321');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer email-key');
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(['user@example.com']);
    expect(body.from).toBe('noreply@x.ru');
    expect(body.text).toContain('654321');
  });

  it('sendDigest отправляет письмо получателю дайджеста', async () => {
    const notifier = new HttpNotifier(undefined, 'email-key', 'noreply@x.ru');
    await notifier.sendDigest('ops@x.ru', 'Тема', 'Тело');
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ to: ['ops@x.ru'], subject: 'Тема', text: 'Тело' });
  });

  it('не бросает исключение, если провайдер ответил ошибкой — сбой логируется, а не роняет вызывающий код', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) });
    const notifier = new HttpNotifier('sms-key', undefined, 'noreply@x.ru');
    await expect(notifier.sendOtp('sms', '+79160000000', '123456')).resolves.toBeUndefined();
  });
});
