import { InProgressCabinet } from '@/components/InProgressCabinet';

export default function MobileWalkPage() {
  return (
    <InProgressCabinet
      title="Мобильный обход"
      allowedRoles={['auditor', 'nurse']}
      referenceFile="reference/prototype/Обход - мобильный.dc.html"
    />
  );
}
