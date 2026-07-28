-- Usuarios do sistema (admin e clientes na mesma tabela, diferenciados por "role").
CREATE TABLE users (
  id             BIGSERIAL PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT,                 -- pode ser nulo se o usuario so usar login com Google (Fase 4)
  role           TEXT NOT NULL CHECK (role IN ('admin', 'client')),
  business_name  TEXT,                 -- nome de exibicao, principalmente para clientes
  google_id      TEXT UNIQUE,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON users (role);
