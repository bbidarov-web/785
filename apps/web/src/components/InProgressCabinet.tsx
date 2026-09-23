'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface SessionInfo {
  role: string;
  side: 'platform' | 'clinic';
  fio: string;
  inn: string;
}

/**
 * Честная заглушка для экранов, ещё не перенесённых с пикселя на React
 * (SERVER.md §6 переносит их в порядке: исполнитель → обход → клиника → панель).
 * Проверка сессии уже настоящая — роль читается из cookie, а не из UI-переключателя.
 */
export function InProgressCabinet({
  title,
  allowedRoles,
  referenceFile,
}: {
  title: string;
  allowedRoles: string[];
  referenceFile: string;
}) {
  const [checked, setChecked] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    (async () => {
      const r = await api.get<{ ok: true; session: SessionInfo | null }>('/api/auth/session');
      setSession(r.ok ? r.session : null);
      setChecked(true);
    })();
  }, []);

  if (!checked) return null;

  if (!session) {
    return (
      <Shell title={title}>
        <p>Требуется вход. Экран входа для этого кабинета переносится следующим по плану (SERVER.md §6).</p>
      </Shell>
    );
  }

  if (!allowedRoles.includes(session.role)) {
    return (
      <Shell title={title}>
        <p>Ваша роль ({session.role}) не открывает этот кабинет — чужая роль в кабинет не пускается (README, «Кабинеты и роли»).</p>
      </Shell>
    );
  }

  return (
    <Shell title={title}>
      <p>
        Вход выполнен: {session.fio || session.inn}. Разметка и логика этого экрана переносятся из{' '}
        <code>{referenceFile}</code> — эталон вида и поведения (CLAUDE.md).
      </p>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 520, background: 'var(--bg-card)', border: '1px solid var(--border-1)', borderRadius: 16, padding: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-caption)' }}>Контур 785</div>
        <h1 style={{ fontSize: 19, fontWeight: 800, margin: '4px 0 12px' }}>{title}</h1>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{children}</div>
        <a href="/" style={{ display: 'inline-block', marginTop: 16, fontSize: 12.5, fontWeight: 700 }}>
          ← на главную
        </a>
      </div>
    </div>
  );
}
