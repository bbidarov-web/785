import { InProgressCabinet } from '@/components/InProgressCabinet';

export default function ClinicCabinetPage() {
  return (
    <InProgressCabinet
      title="Личный кабинет ВКК"
      allowedRoles={['clinic_admin', 'vkk_lead', 'auditor', 'observer']}
      referenceFile="reference/prototype/Личный кабинет ВКК.dc.html"
    />
  );
}
