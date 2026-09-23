export default function Home() {
  const cabinets = [
    { href: '/executor', title: 'Кабинет исполнителя', status: 'готово', desc: 'Медсестра / исполнитель — документы, проверки, журналы по назначению.' },
    { href: '/clinic', title: 'Личный кабинет ВКК', status: 'готово', desc: 'Этапы и документы с оплатой (по порядку, с приёмкой платформой), сотрудники и матрица ответственных, план проверок, годовой цикл, филиалы, оборудование, сводный отчёт, самообследование, находки → корректирующие мероприятия.' },
    { href: '/walk', title: 'Мобильный обход', status: 'готово (аудиты)', desc: 'Чек-листы с ответами, комментариями и фото, офлайн-очередь. Оборудование и сводный отчёт — в переносе.' },
    { href: '/panel', title: 'Кабинет администратора платформы', status: 'готово', desc: 'Заявки на доступ и роли, публикация эталонов, тарифы, подписки, массовые операции, финансовый дашборд, вторая рука на все семь операций — полный доступ.' },
    { href: '/panel/methodist', title: 'Кабинет методиста', status: 'готово', desc: 'Публикация каталогов и годового цикла (через вторую руку), приёмка оплаченных этапов, массовое применение годового цикла.' },
    { href: '/panel/manager', title: 'Кабинет менеджера по продажам', status: 'готово', desc: 'Подтверждение оплаты этапов, тарифы и подписки клиник, массовые операции по подпискам.' },
    { href: '/panel/head', title: 'Кабинет руководителя продаж', status: 'готово', desc: 'То же, что у менеджера, плюс подтверждение чужих запросов на тарифы и крупные суммы (вторая рука).' },
  ];

  return (
    <div style={{ minHeight: '100vh', padding: '48px 20px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 720, width: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-caption)' }}>Контур 785</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 0' }}>Внутренний контроль качества и безопасности медицинской деятельности</h1>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cabinets.map((c) => (
            <a
              key={c.href}
              href={c.href}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                background: 'var(--bg-card)', border: '1px solid var(--border-1)', borderRadius: 12,
                padding: '16px 18px', textDecoration: 'none', color: 'var(--text-primary)',
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 800 }}>{c.title}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginTop: 2 }}>{c.desc}</div>
              </div>
              <span
                style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, whiteSpace: 'nowrap',
                  color: c.status.startsWith('готово') ? 'var(--accent-hover)' : 'var(--warn)',
                  background: c.status.startsWith('готово') ? 'var(--accent-bg-light)' : 'var(--warn-bg)',
                }}
              >
                {c.status}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
