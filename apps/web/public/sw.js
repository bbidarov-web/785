// Service worker мобильного обхода (README «Что дальше»: «PWA»). Намеренно ничего не кэширует —
// офлайн-очередь уже устроена в localStorage (walk/page.tsx) и сама повторяет неподтверждённые
// операции по opId; подменять сетевые ответы кешем в надзорном продукте опаснее, чем не иметь
// офлайн-кеша вовсе (устаревший план/чек-лист выглядел бы как настоящий). Единственная задача
// этого файла — сделать страницу устанавливаемой (Chrome требует зарегистрированный SW
// с обработчиком fetch для события beforeinstallprompt).
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
