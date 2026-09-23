'use client';

import { PlatformPanelShell } from '../PanelShell';

/** Самостоятельный кабинет методиста — тот же функционал и вид панели платформы, вход только по роли methodist. */
export default function MethodistPanelPage() {
  return <PlatformPanelShell allowedRoles={['methodist']} heading="Кабинет методиста" />;
}
