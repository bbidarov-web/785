import { InProgressCabinet } from '@/components/InProgressCabinet';

export default function PlatformPanelPage() {
  return (
    <InProgressCabinet
      title="Панель платформы"
      allowedRoles={['platform_admin', 'methodist', 'sales_manager', 'sales_head']}
      referenceFile="reference/prototype/Админ-панель.dc.html"
    />
  );
}
