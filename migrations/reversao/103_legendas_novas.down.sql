UPDATE client_video_settings SET caption_style = 'classic' WHERE caption_style IN ('simples', 'sombra_dura', 'amarelo_fino', 'preto_borda_branca', 'caixa_alta', 'maiusculo_amarelo', 'gigante', 'verde_contorno', 'rosa_contorno', 'azul_contorno', 'laranja_contorno', 'brilho_rosa', 'brilho_azul', 'brilho_verde', 'roxo_caixa', 'verde_caixa');
ALTER TABLE client_video_settings
  DROP CONSTRAINT client_video_settings_caption_style_check,
  ADD CONSTRAINT client_video_settings_caption_style_check
    CHECK (caption_style IN ('none', 'classic', 'bold', 'minimal', 'bubble_dark', 'bubble_purple',
      'neon_verde', 'vermelho_forte', 'amarelo_caixa', 'branco_caixa', 'contorno_grosso', 'caixa_colorida'));
