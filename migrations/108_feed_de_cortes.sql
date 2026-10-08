-- "Gostei" do Feed de cortes (08/10/2026).
--
-- O cliente passa pelos cortes gerados na conta dele como num feed de rede
-- social e marca os que gostou; a aba "Gostei" lista só esses. Uma linha por
-- (cliente, corte): marcar duas vezes não duplica, desmarcar apaga a linha.
-- Some junto com o corte (ON DELETE CASCADE): corte apagado pela retenção não
-- deixa "gostei" apontando pro nada.
CREATE TABLE clip_likes (
  client_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clip_id        BIGINT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_user_id, clip_id)
);

CREATE INDEX idx_clip_likes_clip ON clip_likes (clip_id);
