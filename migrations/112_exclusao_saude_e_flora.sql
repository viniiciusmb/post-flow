-- Três coisas pedidas juntas pelo fundador (12/10/2026). Tudo isto vale só
-- pro painel novo (admin e Rise Style) por enquanto.

-- 1. Exclusão de conta pelo próprio cliente. A linha do usuário NÃO é apagada:
--    apagar levaria em cascata os pagamentos dele e as comissões que os
--    afiliados ganharam com ele. A conta é anonimizada (e-mail, nome, CPF/CNPJ
--    e login somem) e todo o conteúdo é apagado; o que a lei manda guardar
--    (pagamentos, receita) fica, sem nome. Ver exclusaoDeContaService.
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;

-- 2. Saúde das contas de rede social. A conta do Instagram de 09/10 continuou
--    "conectada" na tela com a autorização já cancelada pelo Instagram, e só se
--    descobriu na hora de publicar. Agora a conexão é conferida de tempos em
--    tempos (e no botão "Testar conexão"), e a tela pede pra reconectar ANTES
--    de um corte falhar.
ALTER TABLE social_accounts
  ADD COLUMN conferida_em TIMESTAMPTZ,
  ADD COLUMN precisa_reconectar_em TIMESTAMPTZ,
  ADD COLUMN motivo_reconectar TEXT;

-- 3. A conversa com a Flora se encerra sozinha depois de um tempo sem
--    mensagens. A próxima mensagem começa uma conversa nova (histórico curto =
--    resposta mais barata e sem contexto velho confundindo a IA).
ALTER TABLE support_conversations DROP CONSTRAINT IF EXISTS support_conversations_status_check;
ALTER TABLE support_conversations ADD CONSTRAINT support_conversations_status_check
  CHECK (status IN ('aberta', 'encaminhada', 'resolvida', 'encerrada'));
ALTER TABLE support_conversations ADD COLUMN closed_at TIMESTAMPTZ;
