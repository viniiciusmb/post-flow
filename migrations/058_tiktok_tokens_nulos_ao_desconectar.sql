-- Desconectar uma conta do TikTok passa a APAGAR os tokens.
--
-- Ate agora "Desconectar" so marcava is_active = false. Os tokens continuavam
-- guardados (criptografados, mas guardados) numa linha que ninguem mais usa, e
-- a autorizacao continuava concedida do lado da TikTok. Duas coisas erradas:
--
--   1. a Politica de Privacidade promete, com estas palavras, que "ao
--      desconectar, apagamos os tokens de acesso e o servico para de agir
--      naquela conta imediatamente". A segunda metade era verdade; a primeira
--      nao. Guardar credencial que ninguem vai usar so aumenta o estrago de um
--      vazamento futuro;
--
--   2. sem revogar do lado da TikTok, reconectar depois pulava a tela de
--      permissoes - a TikTok trata como reautorizacao silenciosa. Isso
--      atrapalhou ate gravar a demonstracao do app pra propria TikTok, onde a
--      tela de permissoes e justamente o que o revisor precisa ver.
--
-- As colunas eram NOT NULL desde a migration 002, quando nao existia a ideia de
-- desconectar. Agora elas admitem NULL, que e o estado correto de uma conta
-- desconectada: sem credencial nenhuma.
--
-- Conta ATIVA continua obrigada a ter token - isso passa a ser garantido por um
-- CHECK em vez do NOT NULL, que e o que a regra realmente diz.

ALTER TABLE tiktok_accounts
  ALTER COLUMN access_token_encrypted DROP NOT NULL,
  ALTER COLUMN access_token_iv DROP NOT NULL,
  ALTER COLUMN refresh_token_encrypted DROP NOT NULL,
  ALTER COLUMN refresh_token_iv DROP NOT NULL;

ALTER TABLE tiktok_accounts
  DROP CONSTRAINT IF EXISTS ck_tiktok_ativa_tem_token;

ALTER TABLE tiktok_accounts
  ADD CONSTRAINT ck_tiktok_ativa_tem_token
  CHECK (
    is_active = false
    OR (access_token_encrypted IS NOT NULL AND refresh_token_encrypted IS NOT NULL)
  );

-- Contas ja desconectadas antes desta migration continuam com o token velho
-- guardado. Como elas nunca mais serao usadas (reconectar cria tokens novos),
-- limpar agora e o mesmo resultado que teriam se a regra sempre tivesse
-- existido.
UPDATE tiktok_accounts
   SET access_token_encrypted = NULL,
       access_token_iv = NULL,
       refresh_token_encrypted = NULL,
       refresh_token_iv = NULL
 WHERE is_active = false;
