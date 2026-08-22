-- Sincroniza as travas de estilo com os presets que o codigo oferece.
--
-- Bug real: a tela de "Estilo visual do corte" mostrava 11 modelos de legenda
-- e 12 de titulo (incluindo o papel rasgado), mas o banco so aceitava os 5
-- antigos. Escolher qualquer modelo novo derrubava a gravacao com erro
-- generico ("Algo deu errado"), e como a tela inteira e salva num PUT so, o
-- cliente perdia TAMBEM as alturas, as cores e as fontes que tinha acabado de
-- escolher - sem entender por que.
--
-- Passou despercebido porque background_style nao tem trava nenhuma: o fundo
-- salvava normalmente enquanto o resto era recusado, o que fazia parecer que
-- "algumas coisas salvam e outras nao".

ALTER TABLE client_video_settings
  DROP CONSTRAINT client_video_settings_caption_style_check,
  ADD CONSTRAINT client_video_settings_caption_style_check
    CHECK (caption_style IN (
      'none',
      'classic', 'bold', 'minimal', 'bubble_dark', 'bubble_purple',
      'neon_verde', 'vermelho_forte', 'amarelo_caixa', 'branco_caixa',
      'contorno_grosso', 'caixa_colorida'
    ));

ALTER TABLE client_video_settings
  DROP CONSTRAINT client_video_settings_title_style_check,
  ADD CONSTRAINT client_video_settings_title_style_check
    CHECK (title_style IN (
      'classic', 'bold', 'minimal', 'bubble_dark', 'bubble_purple',
      'neon_verde', 'vermelho_forte', 'amarelo_caixa', 'branco_caixa',
      'contorno_grosso', 'caixa_colorida', 'papel_rasgado'
    ));
