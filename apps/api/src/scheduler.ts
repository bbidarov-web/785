import type { Container } from './container.js';

/**
 * Планировщик фоновых задач (README «Что дальше» → «доставка напоминаний»,
 * закрыто минимально жизнеспособно): раз в час проверяет, не пора ли
 * отправить дайджест очереди работы, и шлёт его сам — раньше это происходило
 * только по нажатию «Отправить сейчас» в панели. `WorkQueueService.runScheduledDigest`
 * сам не шлёт повторно в тот же день, поэтому частый тик безопасен.
 *
 * Однопроцессный setInterval, а не внешний cron: сервер сейчас разворачивается
 * одним инстансом (infra/docker-compose.yml), при масштабировании на несколько
 * процессов это нужно будет заменить на распределённый лок или внешний cron,
 * чтобы дайджест не ушёл N раз.
 */
const TICK_MS = 60 * 60 * 1000; // раз в час — расписание всё равно только "раз в день", смысла чаще нет

export function startScheduler(container: Container): () => void {
  const tick = async () => {
    try {
      await container.queue.runScheduledDigest();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[scheduler] сбой автоматической отправки дайджеста:', err);
    }
    try {
      await container.reminders.run();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[scheduler] сбой рассылки напоминаний по срокам:', err);
    }
  };
  container.bulk.failInterruptedJobs().catch((err) => console.error('[scheduler] не удалось пометить прерванные пачки:', err));
  void tick(); // не ждать первый час на свежем сервере
  const timer = setInterval(tick, TICK_MS);
  return () => clearInterval(timer);
}
