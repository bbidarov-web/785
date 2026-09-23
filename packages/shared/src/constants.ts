/** Пороги «второй руки» — константы прототипа `SECOND_BULK` и `SECOND_SUM` (SERVER.md §7: утвердить до запуска). */
export const SECOND_BULK = 20; // массовая операция больше 20 клиник требует подтверждения
export const SECOND_SUM = 100_000; // подтверждение оплаты от 100 000 ₽ требует второй руки

export const OTP_TTL_MS = 5 * 60 * 1000; // код 2FA живёт 5 минут
export const RESET_TTL_MS = 30 * 60 * 1000; // код сброса пароля живёт 30 минут
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // сессия — 12 часов
