'use client';

import { PlatformPanelShell } from '../PanelShell';

/** Самостоятельный кабинет руководителя продаж — тот же функционал и вид панели платформы, вход только по роли sales_head. */
export default function SalesHeadPanelPage() {
  return <PlatformPanelShell allowedRoles={['sales_head']} heading="Кабинет руководителя продаж" />;
}
