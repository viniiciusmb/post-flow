-- Assinatura do cliente (1:1 com users). plan_id NULL = cliente ainda sem
-- plano nenhum (bloqueado ate o admin atribuir manualmente pela tela de
-- admin - nao depende da Stripe pra isso, ver clientSubscriptionsRepository).
-- Trocar de plano atualiza plan_id na hora (vale pra limite de canais/contas
-- e prioridade de fila imediatamente); a COTA de credito so muda no proximo
-- reset semanal (ver client_credits abaixo e creditWeeklyResetJob).
CREATE TABLE client_subscriptions (
  client_user_id                  BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id                         BIGINT REFERENCES subscription_plans(id),
  status                          TEXT NOT NULL DEFAULT 'sem_plano'
                                     CHECK (status IN ('sem_plano', 'ativo', 'inadimplente', 'cancelado')),
  stripe_customer_id              TEXT,
  stripe_subscription_id          TEXT,
  overage_card_enabled            BOOLEAN NOT NULL DEFAULT false,
  stripe_default_payment_method_id TEXT,
  cycle_anchor_dow                SMALLINT CHECK (cycle_anchor_dow BETWEEN 0 AND 6),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Saldo de credito do cliente (1:1 com users). quota_* e a cota da semana
-- atual, congelada ate o reset (nao acumula sobra); extra_* e credito avulso
-- comprado, nunca expira sozinho, carrega de ciclo em ciclo. Disponivel em
-- cada bolso = (quota - used) + extra - ver creditsService pro debito
-- atomico que usa essas 4 colunas.
CREATE TABLE client_credits (
  client_user_id  BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  quota_normal    INTEGER NOT NULL DEFAULT 0,
  quota_bonus     INTEGER NOT NULL DEFAULT 0,
  used_normal     INTEGER NOT NULL DEFAULT 0,
  used_bonus      INTEGER NOT NULL DEFAULT 0,
  extra_normal    INTEGER NOT NULL DEFAULT 0,
  extra_bonus     INTEGER NOT NULL DEFAULT 0,
  cycle_start_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
