'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

/**
 * Экраны учётной записи, до сих пор доступные только через API: самостоятельная
 * регистрация клиники, сброс пароля по коду и смена пароля из кабинета.
 * Сообщения об ошибках приходят с сервера дословно (правила пароля, занятый логин).
 */

const inputStyle: React.CSSProperties = { padding: '12px 13px', border: '1px solid var(--border-1)', borderRadius: 8, fontSize: 15, fontWeight: 600, width: '100%' };
const primaryBtn: React.CSSProperties = { padding: 14, borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 15, fontWeight: 700 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--accent-hover)', cursor: 'pointer', textAlign: 'left' };
const errBox: React.CSSProperties = { background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 9, padding: '11px 13px', fontSize: 12.5, fontWeight: 700, color: 'var(--error)' };
const okBox: React.CSSProperties = { background: 'var(--accent-bg-light)', borderRadius: 9, padding: '11px 13px', fontSize: 12.5, fontWeight: 700, color: 'var(--accent-hover)' };

type Result = { ok: true; [k: string]: unknown } | { ok: false; error: string };

export function RegisterClinicForm({ onBack }: { onBack: () => void }) {
  const [f, setF] = useState({ inn: '', org: '', fio: '', login: '', phone: '', email: '', password: '', password2: '' });
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit() {
    const body = { ...f, side: 'clinic' as const, role: 'clinic_admin', phone: f.phone || undefined, email: f.email || undefined };
    const r = await api.post<{ ok: true; pending: boolean; warn: string } | { ok: false; error: string }>('/api/auth/register', body);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({
      kind: 'ok',
      text: r.pending
        ? 'Клиника с этим ИНН уже зарегистрирована. Заявка отправлена администратору клиники — войти можно после его подтверждения.'
        : `Клиника зарегистрирована — можно входить.${r.warn ? ' ' + r.warn : ''}`,
    });
  }

  return (
    <>
      <div style={{ fontSize: 19, fontWeight: 800 }}>Регистрация клиники</div>
      {msg && <div style={msg.kind === 'err' ? errBox : okBox}>{msg.text}</div>}
      <input value={f.inn} onChange={set('inn')} placeholder="ИНН клиники (10 или 12 цифр)" style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
      <input value={f.org} onChange={set('org')} placeholder="Название организации" style={inputStyle} />
      <input value={f.fio} onChange={set('fio')} placeholder="ФИО администратора" style={inputStyle} />
      <input value={f.login} onChange={set('login')} placeholder="Логин" style={inputStyle} />
      <input value={f.phone} onChange={set('phone')} placeholder="Телефон (для кода сброса пароля)" style={inputStyle} />
      <input value={f.email} onChange={set('email')} placeholder="Email (для кода сброса пароля)" style={inputStyle} />
      <input type="password" value={f.password} onChange={set('password')} placeholder="Пароль" style={inputStyle} />
      <input type="password" value={f.password2} onChange={set('password2')} placeholder="Повторите пароль" style={inputStyle} />
      <button onClick={submit} className="k785-tap-target" style={primaryBtn}>Зарегистрироваться</button>
      <button onClick={onBack} style={linkBtn}>← ко входу</button>
    </>
  );
}

export function ResetPasswordForm({ onBack, defaultInn = '' }: { onBack: () => void; defaultInn?: string }) {
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [f, setF] = useState({ inn: defaultInn, login: '', code: '', password: '', password2: '' });
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function request() {
    if (!f.inn.trim() || !f.login.trim()) { setMsg({ kind: 'err', text: 'Введите ИНН и логин' }); return; }
    await api.post<Result>('/api/auth/password/request-reset', { inn: f.inn, login: f.login });
    // ответ сервера одинаков для существующей и несуществующей записи — не выдаём, есть ли такой логин
    setMsg({ kind: 'ok', text: 'Если такая учётная запись есть, код отправлен на телефон или почту, указанные при регистрации.' });
    setStep('confirm');
  }

  async function confirm() {
    const r = await api.post<Result>('/api/auth/password/confirm-reset', f);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: 'Пароль изменён — можно входить с новым паролем.' });
  }

  return (
    <>
      <div style={{ fontSize: 19, fontWeight: 800 }}>Сброс пароля</div>
      {msg && <div style={msg.kind === 'err' ? errBox : okBox}>{msg.text}</div>}
      <input value={f.inn} onChange={set('inn')} placeholder="ИНН" style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
      <input value={f.login} onChange={set('login')} placeholder="Логин" style={inputStyle} />
      {step === 'request' ? (
        <button onClick={request} className="k785-tap-target" style={primaryBtn}>Получить код</button>
      ) : (
        <>
          <input value={f.code} onChange={set('code')} placeholder="Код из сообщения" style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
          <input type="password" value={f.password} onChange={set('password')} placeholder="Новый пароль" style={inputStyle} />
          <input type="password" value={f.password2} onChange={set('password2')} placeholder="Повторите новый пароль" style={inputStyle} />
          <button onClick={confirm} className="k785-tap-target" style={primaryBtn}>Сменить пароль</button>
          <button onClick={request} style={linkBtn}>Отправить код ещё раз</button>
        </>
      )}
      <button onClick={onBack} style={linkBtn}>← ко входу</button>
    </>
  );
}

export function ChangePasswordDialog({ onClose, forced = false, onChanged }: { onClose: () => void; forced?: boolean; onChanged?: () => void }) {
  const [f, setF] = useState({ oldPassword: '', newPassword: '', newPassword2: '' });
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit() {
    const r = await api.post<Result>('/api/auth/password/change', f);
    setMsg(r.ok ? { kind: 'ok', text: 'Пароль изменён' } : { kind: 'err', text: r.error });
    if (r.ok) { setF({ oldPassword: '', newPassword: '', newPassword2: '' }); onChanged?.(); }
  }

  return (
    <div onClick={forced ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,32,31,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, maxWidth: 380, width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{forced ? 'Смените временный пароль' : 'Смена пароля'}</div>
        {forced && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Пароль выдан администратором. Пока вы его не смените, кабинет недоступен.</div>}
        {msg && <div style={msg.kind === 'err' ? errBox : okBox}>{msg.text}</div>}
        <input type="password" value={f.oldPassword} onChange={set('oldPassword')} placeholder="Текущий пароль" style={inputStyle} />
        <input type="password" value={f.newPassword} onChange={set('newPassword')} placeholder="Новый пароль" style={inputStyle} />
        <input type="password" value={f.newPassword2} onChange={set('newPassword2')} placeholder="Повторите новый пароль" style={inputStyle} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={submit} style={{ ...primaryBtn, padding: '10px 14px', fontSize: 13 }}>Сменить</button>
          {!forced && <button onClick={onClose} style={{ ...linkBtn, marginLeft: 'auto' }}>Закрыть</button>}
        </div>
      </div>
    </div>
  );
}

export { linkBtn as authLinkBtn };
