-- Configuracoes ajustaveis sem precisar mexer no codigo ou redeployar.
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
  ('drive_poll_interval_minutes', '5'),
  ('post_stagger_seconds', '120');
