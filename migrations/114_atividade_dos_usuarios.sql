-- Registro de atividade de quem usa o painel (12/10/2026), pedido do fundador
-- pra acompanhar se tudo está funcionando de verdade antes e depois de abrir
-- as novidades pra todos.
--
-- Uma linha por PÁGINA aberta e por AÇÃO (toda requisição que muda alguma
-- coisa: conectar rede, mandar cortar, salvar estilo, pagar...), com o
-- resultado - deu certo, foi recusada (a tela explicou o motivo) ou quebrou -
-- e a mensagem que o cliente viu quando não deu certo. NUNCA o conteúdo
-- enviado (senha, cartão, texto digitado): só a rota, sem os números de id.
--
-- Fica 90 dias (limpeza no worker). O usuário apagado NÃO apaga o histórico:
-- vira linha sem dono, igual ao livro de custo.
CREATE TABLE user_activity (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  tipo         TEXT NOT NULL CHECK (tipo IN ('pagina', 'acao')),
  metodo       TEXT NOT NULL,
  -- Rota com os ids trocados por :id (/api/client/source-videos/:id/enqueue).
  rota         TEXT NOT NULL,
  -- O primeiro id que estava na rota (o vídeo, a conta, o canal), pra achar
  -- o item na hora de investigar.
  recurso_id   BIGINT,
  status       INTEGER NOT NULL,
  -- ok: deu certo; recusada: 4xx (a tela mostrou o porquê); falhou: 5xx.
  resultado    TEXT NOT NULL CHECK (resultado IN ('ok', 'recusada', 'falhou')),
  duracao_ms   INTEGER,
  -- O que o cliente viu quando não deu certo (o `error` da resposta, ou o
  -- motivo que voltou na URL de uma conexão).
  mensagem     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_activity_data ON user_activity (created_at DESC);
CREATE INDEX idx_user_activity_usuario ON user_activity (user_id, created_at DESC);
CREATE INDEX idx_user_activity_rota ON user_activity (rota, created_at DESC);
