'use client';

import { PlatformPanelShell } from '../PanelShell';

/** Самостоятельный кабинет менеджера по продажам — тот же функционал и вид панели платформы, вход только по роли sales_manager. */
export default function SalesManagerPanelPage() {
  return <PlatformPanelShell allowedRoles={['sales_manager']} heading="Кабинет менеджера по продажам" />;
}
