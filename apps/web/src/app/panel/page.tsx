'use client';

import { PlatformPanelShell } from './PanelShell';

/**
 * Кабинет администратора платформы. Три остальные роли платформы теперь
 * входят через свои самостоятельные кабинеты (README «Панель платформы»):
 * `/panel/methodist` (методист), `/panel/manager` (менеджер по продажам),
 * `/panel/head` (руководитель продаж) — тот же функционал и вид, что и
 * раньше в общей панели, только вход разделён по ролям.
 */
export default function PlatformPanelPage() {
  return <PlatformPanelShell allowedRoles={['platform_admin']} heading="Кабинет администратора платформы" />;
}
