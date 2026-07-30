-- Tunel SSH reverso por cliente (substitui a tentativa de Tailscale, que
-- ficou pausada por custo - ver migration 029, ainda existe mas nao esta
-- ligada a nada). Ideia: por padrao o download sai pela internet do dono
-- do sistema (owner_type='founder', fallback sempre presente); quando um
-- cliente instala o programa de bandeja, o download DAQUELE cliente passa
-- a sair pela internet dele (owner_type='client'). Ver CLAUDE.md pra
-- explicacao completa da arquitetura (container postflow_ssh-relay).
CREATE TABLE download_tunnels (
  id BIGSERIAL PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('founder', 'client')),
  client_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  label TEXT,
  public_key TEXT,
  assigned_port INTEGER NOT NULL UNIQUE,
  pairing_code TEXT,
  pairing_code_expires_at TIMESTAMPTZ,
  connected BOOLEAN NOT NULL DEFAULT false,
  last_checked_at TIMESTAMPTZ,
  last_test_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_download_tunnels_owner_consistency CHECK (
    (owner_type = 'founder' AND client_user_id IS NULL) OR
    (owner_type = 'client' AND client_user_id IS NOT NULL) OR
    -- Linha pendente de pareamento: programa de bandeja ja gerou a chave e
    -- registrou, mas o cliente ainda nao colou o codigo no painel pra
    -- vincular a propria conta.
    (owner_type = 'client' AND client_user_id IS NULL AND pairing_code IS NOT NULL)
  )
);

-- No maximo 1 tunel ativo por cliente, e so pode existir 1 tunel de founder.
CREATE UNIQUE INDEX uq_download_tunnels_client ON download_tunnels (client_user_id) WHERE owner_type = 'client';
CREATE UNIQUE INDEX uq_download_tunnels_founder ON download_tunnels ((owner_type = 'founder')) WHERE owner_type = 'founder';

-- So um pairing_code pendente por vez (usado pra achar a linha certa quando
-- o cliente cola o codigo no painel).
CREATE UNIQUE INDEX uq_download_tunnels_pairing_code ON download_tunnels (pairing_code) WHERE pairing_code IS NOT NULL;
