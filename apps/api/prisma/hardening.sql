-- Защита журнала действий на уровне БД (CLAUDE.md: "Журнал действий — только добавление").
-- Приложение и так не вызывает UPDATE/DELETE на audit_log, но это не защита сама по себе —
-- рабочая роль подключения к БД физически не должна иметь такой возможности.
-- Выполнять один раз после `prisma migrate deploy`, от имени владельца БД:
--   psql "$DATABASE_URL" -f prisma/hardening.sql

-- 1) Триггер: любая попытка изменить или удалить строку — отказ на уровне БД,
--    даже если её сделает суперпользователь по ошибке в консоли.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log только на добавление: % на строке % запрещён', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit_log;
CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- 2) Права роли приложения: явный REVOKE как второй рубеж защиты.
--    Замените kontur785_app на реальное имя роли подключения приложения.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontur785_app') THEN
    REVOKE UPDATE, DELETE ON audit_log FROM kontur785_app;
    GRANT SELECT, INSERT ON audit_log TO kontur785_app;
  END IF;
END $$;
