-- Por que um vídeo está parado esperando cobrança.
--
-- O status `aguardando_creditos` já existia, mas ele agora cobre duas
-- situações que pedem mensagens bem diferentes na tela do cliente:
--
--   sem_credito     - acabou a cota e não há cartão cadastrado. A saída é
--                     comprar crédito, assinar um plano maior, ou esperar a
--                     virada da semana.
--   cobranca_falhou - há cartão, mas ele foi recusado. A saída é trocar o
--                     cartão. Dizer "sem crédito" aqui mandaria a pessoa pro
--                     lugar errado.
--
-- Guardado como coluna separada, não como status novo: um valor novo de status
-- precisa ser mapeado em vários lugares do frontend e já quebrou uma tela
-- inteira antes quando faltou um deles.

ALTER TABLE source_videos
  ADD COLUMN IF NOT EXISTS billing_block_reason TEXT
    CHECK (billing_block_reason IS NULL OR billing_block_reason IN ('sem_credito', 'cobranca_falhou'));

-- A cobrança por vídeo passou a acontecer ANTES do processamento, então o
-- lançamento de excedente nasce já pago (ou nem nasce). Estas colunas guardam
-- o resultado dessa cobrança imediata.
ALTER TABLE client_overage_charges
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS charged_at TIMESTAMPTZ;
