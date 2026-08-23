-- Simplifica a configuracao de corte, a pedido do fundador (23/08/2026).
--
-- 1) Proporcao, enquadramento e qualidade deixam de ser escolha do cliente.
--    - A proporcao e sempre 9:16: o produto so publica em TikTok/Reels, e as
--      outras tres opcoes geravam arquivo que nenhum destino do sistema aceita.
--    - O enquadramento (crop / blur_pad) virou obsoleto quando o "estilo do
--      corte" passou a decidir fundo, altura e zoom continuo: eram dois
--      controles disputando a mesma decisao, e o do estilo sempre vencia.
--    - A qualidade de render some por ora; fica um preset unico no codigo.
--
-- 2) 'full_video' (o video inteiro virava UM corte so) vira 'full_parts':
--    o video inteiro e fatiado em partes sequenciais de duracao media
--    escolhida pelo cliente (full_parts_minutes). Quem estava em 'full_video'
--    passa a fatiar - e o que a opcao sempre quis dizer na cabeca de quem a
--    escolhia.
--
-- 3) Nesse modo a numeracao "Parte 1, Parte 2..." e obrigatoria: sem ela as
--    partes chegam no TikTok sem ordem nenhuma e o espectador nao sabe qual
--    ver primeiro. Ligada aqui pra quem ja estava no modo antigo.

ALTER TABLE client_video_settings
  DROP COLUMN aspect_ratio,
  DROP COLUMN framing,
  DROP COLUMN quality;

ALTER TABLE client_video_settings
  ADD COLUMN full_parts_minutes SMALLINT NOT NULL DEFAULT 3
    CHECK (full_parts_minutes BETWEEN 1 AND 10);

-- A ordem importa: a constraint antiga so aceita 'full_video' e a nova so
-- aceita 'full_parts', entao nao existe momento em que os dois valores passem.
-- Trocar o valor antes de soltar a constraint (ou depois de por a nova) faz a
-- migration quebrar em qualquer base que ja tenha alguem nesse modo - foi
-- exatamente o que aconteceu ao testar contra dados de verdade.
ALTER TABLE client_video_settings DROP CONSTRAINT client_video_settings_clip_mode_check;

UPDATE client_video_settings SET clip_mode = 'full_parts' WHERE clip_mode = 'full_video';

ALTER TABLE client_video_settings
  ADD CONSTRAINT client_video_settings_clip_mode_check
    CHECK (clip_mode IN ('ai_choice', 'full_parts', 'fixed_count')),
  ALTER COLUMN clip_mode SET DEFAULT 'ai_choice';

UPDATE client_video_settings SET show_part_label = true WHERE clip_mode = 'full_parts';
