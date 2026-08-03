-- Entrar com Google.
--
-- Guardamos o "sub" do Google, não o e-mail, como identidade permanente da
-- conta. O e-mail de uma conta Google pode mudar (troca de domínio, mudança de
-- nome numa conta corporativa); o `sub` nunca muda e nunca é reaproveitado por
-- outra pessoa. Ligar a conta pelo e-mail funcionaria hoje e quebraria calado
-- no dia em que alguém trocasse o endereço.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_sub TEXT,
  -- Qual conta Google está ligada. É só pra mostrar na tela ("você entra com
  -- fulano@gmail.com"); quem identifica é o google_sub.
  ADD COLUMN IF NOT EXISTS google_email TEXT;

-- Um "sub" do Google pertence a uma conta só. Índice parcial porque a imensa
-- maioria das contas não usa Google e ficaria com NULL - e vários NULLs num
-- índice único comum não dariam conflito, mas o índice ficaria à toa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_sub
  ON users (google_sub)
  WHERE google_sub IS NOT NULL;
