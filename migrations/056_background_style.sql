-- Estilo do fundo do corte.
--
-- Até agora só havia uma escolha implícita: ou o cliente enviava uma imagem de
-- template, ou o fundo era o próprio vídeo desfocado. Quem quisesse um fundo
-- liso (preto ou branco) tinha que criar uma imagem de 1080x1920 preenchida de
-- uma cor só e enviar como template — o que é trabalho por um resultado que o
-- sistema poderia gerar sozinho.
--
-- Agora o fundo é uma escolha explícita entre quatro:
--
--   blur     - o próprio vídeo desfocado atrás (é o que já acontecia)
--   black    - fundo preto liso
--   white    - fundo branco liso
--   template - a imagem que o cliente enviou
--
-- Os controles de altura e posição do vídeo, que hoje só apareciam com
-- template, passam a valer para os quatro: eles definem onde o vídeo fica
-- dentro do quadro, e o fundo preenche o resto.

ALTER TABLE client_video_settings
  ADD COLUMN IF NOT EXISTS background_style TEXT NOT NULL DEFAULT 'blur'
    CHECK (background_style IN ('blur', 'black', 'white', 'template'));

-- Quem já tinha template enviado continua com template selecionado. Sem isto,
-- a migração desligaria em silêncio o template de quem já configurou.
UPDATE client_video_settings
   SET background_style = 'template'
 WHERE background_template_path IS NOT NULL;
