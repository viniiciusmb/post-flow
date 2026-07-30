-- Tailscale por cliente (substitui a ideia antiga de 1 aparelho do dono do
-- sistema compartilhado por todos - agora cada cliente conecta o proprio
-- aparelho, e o sistema usa o IP dele so quando processa video daquele
-- cliente). Ver CLAUDE.md pra explicacao completa da arquitetura (rele
-- compartilhado, trocado de alvo a cada video, ja que so 1 video processa
-- por vez no sistema inteiro).
CREATE TABLE client_tailscale_connections (
  id BIGSERIAL PRIMARY KEY,
  client_user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tailscale_hostname TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_test_result JSONB,
  last_tested_at TIMESTAMPTZ
);
