-- Limites de segurança do "Clipar sempre que estiver ao vivo" (14/10/2026).
--
-- Um cliente deixou o automático ligado numa live de 9 horas e ela gastou os
-- 180 créditos da semana inteira numa noite. Agora, ao ligar o automático, o
-- cliente escolhe quando cada live para de ser clipada: depois de N horas,
-- depois de N cortes, ou ao gastar N% da cota da semana. NULL = sem aquele
-- limite. Vale por live: a seguinte começa do zero.
ALTER TABLE live_channel_follows
  ADD COLUMN limite_horas numeric(4,1) CHECK (limite_horas IS NULL OR (limite_horas >= 0.5 AND limite_horas <= 24)),
  ADD COLUMN limite_cortes integer CHECK (limite_cortes IS NULL OR (limite_cortes >= 1 AND limite_cortes <= 500)),
  ADD COLUMN limite_pct_cota integer CHECK (limite_pct_cota IS NULL OR (limite_pct_cota >= 5 AND limite_pct_cota <= 100));

-- Por live (linha de cobrança da sessão): quando e por que parou, e se o
-- cliente mandou continuar mesmo assim ("Continuar clipando esta live").
ALTER TABLE live_credit_usage
  ADD COLUMN parado_por_limite_at timestamptz,
  ADD COLUMN motivo_limite text CHECK (motivo_limite IS NULL OR motivo_limite IN ('horas', 'cortes', 'cota')),
  ADD COLUMN limites_ignorados boolean NOT NULL DEFAULT false;

-- Quem já clipa sempre ganha a trava padrão (a mesma que a janela sugere):
-- 4 horas por live e metade da cota da semana. O cliente muda no cartão.
UPDATE live_channel_follows SET limite_horas = 4, limite_pct_cota = 50 WHERE paused_at IS NULL;
