-- Registro do aceite dos Termos de Uso no cadastro.
--
-- Antes, o formulario de cadastro nao pedia aceite nenhum - havia, no maximo,
-- um link solto no rodape. Um checkbox sozinho na tela tambem nao resolveria:
-- o que tem valor e o REGISTRO de que aquela conta, naquele momento, aceitou
-- aquela versao do documento.
--
-- NULL nas contas que ja existiam (elas se cadastraram antes de existir o
-- aceite) - assim da pra distinguir "nunca aceitou" de "aceitou".

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  -- Guarda QUAL versao foi aceita. Quando os termos mudarem, a data no
  -- publicController muda junto e da pra saber quem aceitou o texto antigo.
  ADD COLUMN IF NOT EXISTS terms_version TEXT;
