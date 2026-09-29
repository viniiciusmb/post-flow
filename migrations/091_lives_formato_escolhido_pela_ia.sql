-- Enquadramento dos cortes de live: nova opcao "a IA escolhe o formato"
-- (liveFormatoService), agora o padrao. Pedido do fundador em 29/09/2026:
-- cada live tem um jeito (tela + webcam, uma pessoa num canto, duas pessoas
-- nas pontas, tres lado a lado, VTubers...) e um modelo fixo deixa gente de
-- fora. As outras duas continuam valendo:
--   auto      = sempre destacar a webcam do streamer (formato fixo);
--   desligado = estilo normal do corte, sem enquadramento especial.
ALTER TABLE live_clip_settings DROP CONSTRAINT live_clip_settings_camera_modo_check;
ALTER TABLE live_clip_settings ADD CONSTRAINT live_clip_settings_camera_modo_check
  CHECK (camera_modo IN ('ia', 'auto', 'desligado'));
ALTER TABLE live_clip_settings ALTER COLUMN camera_modo SET DEFAULT 'ia';
-- Quem estava no padrao antigo passa pro novo padrao (so contas de teste ate aqui).
UPDATE live_clip_settings SET camera_modo = 'ia' WHERE camera_modo = 'auto';
