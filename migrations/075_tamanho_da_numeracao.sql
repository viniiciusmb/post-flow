-- Tamanho do adesivo "Parte N", escolhido pelo cliente.
--
-- Ele era um número fixo no código (56px num quadro de 1080x1920) e nunca foi
-- escolha de ninguém. Relato do fundador em 01/09/2026: "está muito pequeno e
-- quase não aparece nos vídeos". 56px é menor que a metade da legenda (96-112)
-- num quadro que é assistido no celular, então some mesmo.
--
-- Guardado em PORCENTAGEM, não em pixels. Duas razões:
--   1. O cliente não pensa em pixel de um quadro que ele nunca vê; "120%" é
--      relativo a um tamanho que já foi escolhido para ficar legível.
--   2. Se um dia o tamanho-base mudar (fonte nova, quadro maior), a escolha do
--      cliente continua valendo. Um valor em pixels ficaria congelado num
--      quadro que não existe mais.
--
-- O padrão é 100 — que agora aponta para um tamanho-base MAIOR (ver
-- TAMANHO_BASE_DA_NUMERACAO em videoEditingService). Quem já usa a numeração
-- vai ver o adesivo crescer sem precisar mexer em nada, que é o pedido.
ALTER TABLE client_video_settings
  ADD COLUMN part_label_size_percent SMALLINT NOT NULL DEFAULT 100
    CHECK (part_label_size_percent BETWEEN 50 AND 200);

COMMENT ON COLUMN client_video_settings.part_label_size_percent IS
  'Tamanho do adesivo "Parte N" em % do tamanho-base (ver TAMANHO_BASE_DA_NUMERACAO). 50 a 200.';
