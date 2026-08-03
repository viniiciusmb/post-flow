-- Painel único de erros do sistema.
--
-- Hoje cada falha vai pra um lugar diferente: log do servidor (que ninguém lê
-- até alguém reclamar), mensagem técnica na tela do cliente (que não ajuda o
-- cliente e ainda assusta), e coluna de erro espalhada em várias tabelas. Não
-- existe um lugar onde dê pra olhar e responder "o que está quebrando?".
--
-- Esta tabela é esse lugar. Toda falha de operação - minha ou de qualquer
-- cliente - cai aqui, e a tela do admin tem uma ação só: tentar de novo.

CREATE TABLE IF NOT EXISTS system_errors (
  id               BIGSERIAL PRIMARY KEY,

  -- Que operação falhou. É o que decide como o "tentar de novo" funciona,
  -- então é texto livre por escolha (não enum): incluir uma operação nova não
  -- pode exigir migration, senão a tentação vira "deixa sem registrar".
  operation        TEXT NOT NULL,

  -- A qual coisa o erro se refere (vídeo, corte, canal, conta do TikTok...).
  -- Guardar tipo + id em vez de FK de propósito: uma FK impediria registrar o
  -- erro de algo que foi apagado depois, que é justamente quando o histórico
  -- de erro mais importa.
  entity_type      TEXT,
  entity_id        BIGINT,

  -- De quem é a conta afetada. NULL = erro do sistema, sem dono (checagem de
  -- canal do próprio fundador, job de manutenção, backup).
  client_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,

  -- Uma linha, em português, do que aconteceu. É o que aparece na lista.
  message          TEXT NOT NULL,
  -- O texto cru do erro (stack, saída do yt-dlp, resposta da API). Fica
  -- escondido atrás de "ver detalhe" - é o que vai ser copiado e mandado pra
  -- correção.
  detail           TEXT,

  -- Agrupamento: o mesmo erro repetindo 200 vezes é UMA linha com contador, não
  -- 200 linhas. Sem isso a tela vira um log e perde a serventia.
  fingerprint      TEXT NOT NULL,
  occurrences      INTEGER NOT NULL DEFAULT 1,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Ciclo de vida do "tentar de novo".
  status           TEXT NOT NULL DEFAULT 'aberto'
                     CHECK (status IN ('aberto', 'retentando', 'resolvido')),
  retry_count      INTEGER NOT NULL DEFAULT 0,
  last_retry_at    TIMESTAMPTZ,
  resolved_at      TIMESTAMPTZ
);

-- Um erro aberto por assinatura. É esta restrição que faz o agrupamento
-- funcionar: o INSERT usa ON CONFLICT pra somar no contador em vez de criar
-- linha nova. Índice PARCIAL porque erro já resolvido não deve bloquear o
-- registro do mesmo problema acontecendo de novo semanas depois - isso seria
-- esconder uma reincidência.
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_errors_abertos
  ON system_errors (fingerprint)
  WHERE status <> 'resolvido';

-- Ordem da tela: mais recente primeiro, resolvidos fora do caminho.
CREATE INDEX IF NOT EXISTS idx_system_errors_lista
  ON system_errors (status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_errors_cliente
  ON system_errors (client_user_id, last_seen_at DESC);
