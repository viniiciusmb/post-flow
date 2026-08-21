-- PIX Automático: mensalidade debitada sozinha, sem cartão.
--
-- O cliente lê UM QR Code que faz duas coisas ao mesmo tempo — paga a
-- primeira mensalidade e autoriza as próximas. Dali em diante o Asaas cobra
-- sozinho, como débito automático. É a resposta para o público que não usa
-- cartão de crédito, que no Brasil é grande.
--
-- Diferença importante para o checkout de cartão: ali o Asaas cria o cliente
-- e coleta os dados dele na própria tela. Aqui NÃO — a autorização exige um
-- customerId que já exista, e criar cliente no Asaas exige CPF/CNPJ. Ou seja,
-- este é o único caminho de pagamento em que precisamos do documento.
ALTER TABLE users
  -- Guardado sem máscara (é o formato que o Asaas espera) e só preenchido
  -- quando o cliente escolhe pagar por PIX Automático. Quem paga com cartão
  -- nunca informa CPF para nós.
  ADD COLUMN cpf_cnpj TEXT;

CREATE TABLE asaas_pix_authorizations (
  id                     BIGSERIAL PRIMARY KEY,
  asaas_authorization_id TEXT NOT NULL UNIQUE,
  client_user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                BIGINT NOT NULL REFERENCES subscription_plans(id),
  asaas_customer_id      TEXT NOT NULL,
  amount_cents           INTEGER NOT NULL,

  -- 'criada' = QR gerado, esperando o cliente pagar no app do banco.
  -- 'ativa'  = pagou e autorizou; daí em diante o Asaas cobra sozinho.
  -- O resto são finais: sem autorização ativa não há cobrança nenhuma.
  status                 TEXT NOT NULL DEFAULT 'criada'
                           CHECK (status IN ('criada', 'ativa', 'recusada', 'expirada', 'cancelada')),
  activated_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_asaas_pix_auth_client ON asaas_pix_authorizations (client_user_id, created_at DESC);

-- A assinatura que o Asaas cria a partir da autorização. Guardada para que a
-- renovação mensal (que chega como pagamento ligado a essa assinatura) seja
-- reconhecida pelo mesmo caminho da assinatura por cartão.
ALTER TABLE client_subscriptions
  ADD COLUMN asaas_pix_authorization_id TEXT;

ALTER TABLE client_subscriptions
  DROP CONSTRAINT IF EXISTS client_subscriptions_subscription_provider_check;
ALTER TABLE client_subscriptions
  ADD CONSTRAINT client_subscriptions_subscription_provider_check
    CHECK (subscription_provider IN ('stripe', 'asaas', 'asaas_pix'));
