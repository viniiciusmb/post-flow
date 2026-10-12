-- Limites por plano das novidades que vão abrir pra todos os clientes, e o
-- registro completo de cada erro (pedidos do fundador, 12/10/2026).

-- 1. Contas por rede social (Instagram, Facebook, Threads, LinkedIn, Pinterest,
--    Bluesky, YouTube): o número vale pra CADA rede. Starter 1, Pro 3, Max 6.
--    O TikTok continua com o limite próprio (max_tiktok_accounts + extras).
--    NULL = sem limite (não há plano assim hoje).
--
--    Lives: quantos canais o cliente acompanha e quantas lives são clipadas
--    pra ele ao mesmo tempo. O segundo número existe porque o render é feito
--    por cliente, e a VPS de 2 núcleos sustenta ~2 lives clipadas ao todo.
ALTER TABLE subscription_plans
  ADD COLUMN max_contas_por_rede INTEGER,
  ADD COLUMN max_canais_de_live INTEGER,
  ADD COLUMN max_lives_ao_mesmo_tempo INTEGER;

UPDATE subscription_plans SET max_contas_por_rede = 1, max_canais_de_live = 1, max_lives_ao_mesmo_tempo = 1 WHERE key = 'starter';
UPDATE subscription_plans SET max_contas_por_rede = 3, max_canais_de_live = 2, max_lives_ao_mesmo_tempo = 1 WHERE key = 'pro';
UPDATE subscription_plans SET max_contas_por_rede = 6, max_canais_de_live = 3, max_lives_ao_mesmo_tempo = 1 WHERE key = 'max';

-- 2. Por que um canal acompanhado não está sendo clipado PRA ESTE cliente.
--    Calculado pelo supervisor das lives a cada volta (ver
--    limitesDasLivesService). NULL = sem bloqueio.
--      fora_do_plano: o cliente acompanha mais canais do que o plano dá (trocou
--                     pra um plano menor ou cancelou) - nada é apagado;
--      outra_live:    o plano clipa N lives por vez e N outras já estão sendo
--                     clipadas pra ele.
ALTER TABLE live_channel_follows
  ADD COLUMN bloqueio TEXT CHECK (bloqueio IN ('fora_do_plano', 'outra_live'));

-- 3. Por que um canal ao vivo não está sendo gravado (servidor cheio, disco
--    cheio, horas do dia esgotadas). Antes isso só ia pro log, e a tela
--    mostrava "ao vivo" sem corte nenhum chegando.
ALTER TABLE live_channels
  ADD COLUMN motivo_sem_gravar TEXT CHECK (motivo_sem_gravar IN ('servidor_cheio', 'disco_cheio', 'limite_de_horas')),
  ADD COLUMN sem_gravar_desde TIMESTAMPTZ;

-- 4. Cada ocorrência de cada erro, com todo o contexto (conta, rede, arquivo,
--    resposta crua da API, etapa, tentativa...). system_errors agrupa: o mesmo
--    erro 200 vezes é UMA linha, e o detalhe guardado ali é só o último. Aqui
--    fica cada vez, pra dar pra investigar o que mudou entre uma e outra.
CREATE TABLE system_error_events (
  id              BIGSERIAL PRIMARY KEY,
  error_id        BIGINT NOT NULL REFERENCES system_errors(id) ON DELETE CASCADE,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  message         TEXT NOT NULL,
  detail          TEXT,
  contexto        JSONB
);
CREATE INDEX idx_system_error_events_erro ON system_error_events (error_id, occurred_at DESC);
CREATE INDEX idx_system_error_events_data ON system_error_events (occurred_at);
