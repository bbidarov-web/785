import type { Notifier } from '../../domain/ports.js';

/**
 * Заглушка на дев/тест-окружение: код не уходит по смс/почте, а складывается
 * в память, чтобы тест мог его прочитать. Реальный шлюз — infra/providers/*
 * (SMS.ru / Unisender / ЮKassa-уведомления и т.п., выбор — SERVER.md §7 "до запуска решить").
 */
export class InMemoryNotifier implements Notifier {
  public sentOtp: { via: 'sms' | 'email'; to: string; code: string }[] = [];
  public sentReset: { via: 'sms' | 'email'; to: string; code: string }[] = [];
  public sentDigests: { to: string; subject: string; body: string }[] = [];
  public sentReminders: { via: 'sms' | 'email'; to: string; subject: string; text: string }[] = [];

  async sendOtp(via: 'sms' | 'email', to: string, code: string): Promise<void> {
    this.sentOtp.push({ via, to, code });
  }

  async sendPasswordReset(via: 'sms' | 'email', to: string, code: string): Promise<void> {
    this.sentReset.push({ via, to, code });
  }

  async sendDigest(to: string, subject: string, body: string): Promise<void> {
    this.sentDigests.push({ to, subject, body });
  }

  async sendReminder(via: 'sms' | 'email', to: string, subject: string, text: string): Promise<void> {
    this.sentReminders.push({ via, to, subject, text });
  }
}

/** Консольный адаптер — временная реализация для локального dev до подключения реального провайдера. */
export class ConsoleNotifier implements Notifier {
  async sendOtp(via: 'sms' | 'email', to: string, code: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[DEV OTP] ${via} -> ${to}: ${code}`);
  }
  async sendPasswordReset(via: 'sms' | 'email', to: string, code: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[DEV RESET] ${via} -> ${to}: ${code}`);
  }
  async sendDigest(to: string, subject: string, body: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[DEV DIGEST] -> ${to}: ${subject}\n${body}`);
  }
  async sendReminder(via: 'sms' | 'email', to: string, subject: string, text: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[DEV REMINDER] ${via} -> ${to}: ${subject} — ${text}`);
  }
}
