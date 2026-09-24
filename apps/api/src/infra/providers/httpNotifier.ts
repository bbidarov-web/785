import type { Notifier } from '../../domain/ports.js';

/**
 * Реальная доставка (SERVER.md §7 "до запуска решить" — закрыто выбором:
 * SMS.ru для смс, Resend для почты, оба — один HTTP-запрос, без SDK).
 * Провайдер — деталь адаптера за портом `Notifier`; замена на Unisender/другой
 * шлюз не трогает ни один вызывающий код (auth/service.ts, workQueueService.ts).
 *
 * Коды/пароли не логируются (CLAUDE.md) — при сбое провайдера в лог уходит
 * только факт ошибки и получатель, без тела сообщения.
 */
export class HttpNotifier implements Notifier {
  constructor(private smsApiKey: string | undefined, private emailApiKey: string | undefined, private emailFrom: string) {}

  private async sendSms(to: string, text: string): Promise<void> {
    if (!this.smsApiKey) {
      // eslint-disable-next-line no-console
      console.warn(`[notifier] SMS_PROVIDER_API_KEY не задан — смс на ${to} не отправлено`);
      return;
    }
    const url = `https://sms.ru/sms/send?api_id=${encodeURIComponent(this.smsApiKey)}&to=${encodeURIComponent(to)}&msg=${encodeURIComponent(text)}&json=1`;
    const res = await fetch(url);
    const body = (await res.json().catch(() => null)) as { status?: string; status_text?: string } | null;
    if (!res.ok || body?.status !== 'OK') {
      // eslint-disable-next-line no-console
      console.error(`[notifier] SMS.ru отклонил отправку на ${to}: ${body?.status_text ?? res.statusText}`);
    }
  }

  private async sendEmail(to: string, subject: string, text: string): Promise<void> {
    if (!this.emailApiKey) {
      // eslint-disable-next-line no-console
      console.warn(`[notifier] EMAIL_PROVIDER_API_KEY не задан — письмо на ${to} не отправлено`);
      return;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.emailApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.emailFrom, to: [to], subject, text }),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(`[notifier] Провайдер почты отклонил отправку на ${to}: ${res.status} ${res.statusText}`);
    }
  }

  async sendOtp(via: 'sms' | 'email', to: string, code: string): Promise<void> {
    if (via === 'sms') await this.sendSms(to, `Контур 785: код подтверждения ${code}`);
    else await this.sendEmail(to, 'Контур 785 — код подтверждения', `Ваш код: ${code}`);
  }

  async sendPasswordReset(via: 'sms' | 'email', to: string, code: string): Promise<void> {
    if (via === 'sms') await this.sendSms(to, `Контур 785: код сброса пароля ${code}`);
    else await this.sendEmail(to, 'Контур 785 — сброс пароля', `Код для сброса пароля: ${code}`);
  }

  async sendDigest(to: string, subject: string, body: string): Promise<void> {
    await this.sendEmail(to, subject, body);
  }
}
