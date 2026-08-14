-- Teto de 10 publicações por dia, por conta do TikTok.
--
-- Antes o limite era 20 no modo automático, e o modo manual não tinha limite
-- nenhum: dava pra cadastrar 30 horários e o sistema tentaria publicar 30 vezes
-- ao dia na mesma conta.
--
-- Dois motivos para o teto, e o segundo é o que pesa:
--
--   1. A TikTok trabalha com um teto por criador (na casa de 15/dia) e trata
--      volume alto como sinal de automação abusiva.
--   2. Publicar demais no mesmo perfil derruba o alcance do próprio criador —
--      o algoritmo distribui menos quando o perfil despeja conteúdo. Ou seja,
--      o limite existe a favor do cliente, não contra ele.
--
-- Quem estiver acima do novo teto é ajustado para 10 (e não bloqueado): a
-- constraint entraria em conflito com a linha existente e a migração falharia
-- no meio, deixando o banco pela metade.
UPDATE posting_schedule_settings SET videos_per_day = 10 WHERE videos_per_day > 10;

ALTER TABLE posting_schedule_settings
  DROP CONSTRAINT IF EXISTS posting_schedule_settings_videos_per_day_check;

ALTER TABLE posting_schedule_settings
  ADD CONSTRAINT posting_schedule_settings_videos_per_day_check
    CHECK (videos_per_day BETWEEN 1 AND 10);
