-- Pedido da Utmify no PIX Automático (26/09/2026), no mesmo desenho que o
-- Interactive Live já usa.
--
-- A venda por PIX Automático não passa por `asaas_payments`: a primeira
-- cobrança só nasce quando o cliente paga o QR, e sem ela não havia id para
-- anunciar "aguardando pagamento". Resultado: quem gerava o QR e não pagava
-- nunca aparecia no funil, e quem pagava surgia na Utmify já como paga.
--
-- utmify_order_id: identidade do pedido, criada quando o QR é gerado. Uma
--   nova tentativa do mesmo plano nas 24h seguintes reaproveita o mesmo id, senão
--   três QR gerados em cinco minutos viram três vendas pendentes (aconteceu no
--   Interactive Live em 31/08/2026). A aprovação e a recusa fecham ESTE pedido.
-- customer_ip: IP de quem gerou o QR. A Utmify recusa venda com IP nulo e o
--   aviso de pagamento chega pelo webhook, que não tem o IP em mãos.
--
-- Só acrescenta colunas: pode rodar ANTES do deploy (o código antigo nomeia as
-- colunas no INSERT e não é afetado).
ALTER TABLE asaas_pix_authorizations
  ADD COLUMN IF NOT EXISTS utmify_order_id TEXT,
  ADD COLUMN IF NOT EXISTS customer_ip TEXT;

CREATE INDEX IF NOT EXISTS idx_asaas_pix_authorizations_utmify_order
  ON asaas_pix_authorizations (utmify_order_id)
  WHERE utmify_order_id IS NOT NULL;
