-- 1) O retry automatico de video NUNCA disparou desde que a mensagem tecnica
--    saiu da tela do cliente.
--
--    findTransientErrorsForAutoRetry decidia "isso parece passageiro?" casando
--    uma expressao regular contra source_videos.error_message - coluna que
--    passou a ser gravada sempre como NULL (a mensagem vive em system_errors).
--    Resultado: 3 de 3 videos em erro na producao com error_message nula, e
--    nenhum deles jamais reprocessado. Em 25/08/2026 um video novo de canal
--    monitorado falhou com "The page needs to be reloaded" do YouTube - erro
--    classicamente passageiro - e ficou parado pra sempre.
--
--    A correcao guarda o VEREDITO, decidido no momento da falha com o objeto
--    de erro em maos, em vez de tentar reconstitui-lo depois a partir de um
--    texto que nao existe mais. Mesmo padrao ja usado na postagem
--    (src/lib/erroDePostagem.js).
ALTER TABLE source_videos ADD COLUMN error_transient BOOLEAN;

-- 2) Evitar "engarrafamento" de fila: so pegar video novo quando a fila de
--    postagem daquele canal estiver quase vazia.
--
--    Sem isso, um canal que publica todo dia gera cortes mais rapido do que a
--    fila publica, e a fila cresce sem parar - quando um corte finalmente sai,
--    o assunto dele ja e velho. Ligado por padrao: e o comportamento que a
--    maioria quer, e quem preferir processar tudo sempre pode desmarcar.
ALTER TABLE youtube_channels
  ADD COLUMN process_only_when_queue_clear BOOLEAN NOT NULL DEFAULT true;
