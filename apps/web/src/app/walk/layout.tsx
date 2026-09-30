import type { Metadata } from 'next';

// Манифест и мета для PWA — только на этом маршруте (README «Что дальше»: «мобильный обход
// как PWA»), а не на весь сайт: устанавливать имеет смысл именно обход, не панели платформы.
export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Контур 785' },
};

export default function WalkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
