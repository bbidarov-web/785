import type { Notifier } from '../../domain/ports.js';

/**
 * Заглушка на дев/тест-окружение: код не уходит по смс/почте, а складывается
 * в память, чтобы тест мог его прочитать. Реальный шлюз — infra/providers/*
 * (SMS.ru / Unisender / ЮKassa-уведомления и т.п., выбор — SERVER.md §7 "до запуска решить").
 */
export class InMemoryNotifier implements Notifier {
  public sentOtp: { via: 'sms' | 'email'; to: string; code: string }[] = [];
  public sentReset: { via: 'sms' | 'email'; to: string; code: string }[] = [];

  async sendOtp(via: 'sms' | 'email', to: string, code: string): Promise<void> {
    this.sentOtp.push({ via, to, code });
  }

  async sendPasswordReset(via: 'sms' | 'email', to: string, code: string): Promise<void> {
    this.sentReset.push({ via, to, code });
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
}
