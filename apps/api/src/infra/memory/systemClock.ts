import type { Clock } from '../../domain/ports.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Управляемые часы для тестов: можно перематывать время без setTimeout. */
export class TestClock implements Clock {
  constructor(private current: Date = new Date('2026-01-01T00:00:00.000Z')) {}
  now(): Date {
    return this.current;
  }
  set(date: Date): void {
    this.current = date;
  }
  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
