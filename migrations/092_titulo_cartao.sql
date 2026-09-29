-- Novo estilo de titulo "cartao" (caixa de cantos arredondados, sombra e
-- degrade da cor escolhida - videoEditingService, pedido de 29/09/2026).
-- So ACRESCENTA a opcao: nenhum estilo existente muda, e ninguem passa a
-- usar o cartao sem escolher.
ALTER TABLE client_video_settings
  DROP CONSTRAINT client_video_settings_title_style_check,
  ADD CONSTRAINT client_video_settings_title_style_check
    CHECK (title_style IN (
      'classic', 'bold', 'minimal', 'bubble_dark', 'bubble_purple',
      'neon_verde', 'vermelho_forte', 'amarelo_caixa', 'branco_caixa',
      'contorno_grosso', 'caixa_colorida', 'papel_rasgado', 'cartao'
    ));
