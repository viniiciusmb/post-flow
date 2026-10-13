-- Conexões extras, ajuste de 12/10/2026 (decisão do fundador):
--   - conta extra do TikTok passa a custar o mesmo que as outras redes,
--     R$ 9,90/mês, em TODOS os planos (era R$ 29,90, só no plano maior);
--   - canal extra do YouTube continua R$ 14,90/mês, agora também em todos os
--     planos (era só no plano maior);
--   - o desconto do "par" (canal + conta por R$ 39,90) deixa de existir: com os
--     preços novos ele sairia MAIS CARO que comprar separado (R$ 24,80).
--     extra_both_price_cents NULL = sem combo (ver lib/precoDasConexoesExtras).
--
-- Ninguém tinha conexão extra comprada quando isto foi aplicado, então nenhuma
-- mensalidade em andamento muda de valor.
UPDATE subscription_plans
   SET extra_channel_price_cents = 1490,
       extra_tiktok_price_cents = 990,
       extra_both_price_cents = NULL
 WHERE key IN ('starter', 'pro', 'max');
