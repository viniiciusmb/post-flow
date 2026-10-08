-- Modelos de estilo de corte salvos pelo cliente (08/10/2026).
--
-- O cliente configura o estilo de um canal, salva como modelo com um nome e
-- aplica o mesmo modelo em outros canais com um clique. `campos` guarda só o
-- que faz parte do estilo (ver src/lib/modelosDeCorte.js): idioma do áudio,
-- descrição e imagem de fundo enviada ficam de fora de propósito, porque são
-- de cada canal.
--
-- Aplicar COPIA os valores para o canal (não aponta pro modelo): mudar ou
-- apagar o modelo depois não mexe no que já foi aplicado.
CREATE TABLE clip_style_models (
  id             BIGSERIAL PRIMARY KEY,
  client_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  campos         JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_clip_style_models_nome ON clip_style_models (client_user_id, lower(btrim(name)));
