import type { Metadata, Viewport } from 'next';
import { Manrope, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

export const metadata: Metadata = {
  title: 'Контур 785',
  description: 'Внутренний контроль качества и безопасности медицинской деятельности (Приказ Минздрава №785н)',
};

// Явно, а не полагаясь на умолчание Next.js: viewport-fit=cover под чёлку/скругления экрана
// (safe-area-inset учитываются кнопкой обхода, см. globals.css), maximumScale не ограничен —
// зумить страницу пальцами должно быть можно (доступность), только поля не увеличивают iOS сами.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// next/font вместо <link> на fonts.googleapis.com (README «Дизайн-токены»): те же начертания,
// но шрифт самохостится и встраивается в CSS через переменные — без внешнего запроса на клиенте
// и без предупреждения ESLint no-page-custom-font (шрифт, подключённый вне _document, грузится
// только на одной странице — в App Router это в принципе неприменимо, но правило всё равно светит).
const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${manrope.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
