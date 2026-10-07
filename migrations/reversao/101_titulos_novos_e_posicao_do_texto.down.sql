UPDATE client_video_settings SET title_style = 'classic'
 WHERE title_style IN ('simples', 'sombra_dura', 'amarelo_fino', 'preto_borda_branca', 'espacado',
   'brilho_rosa', 'brilho_azul', 'destaque_amarelo', 'destaque_verde', 'faixa_preta', 'faixa_branca', 'faixa_colorida');
ALTER TABLE client_video_settings
  DROP CONSTRAINT client_video_settings_title_style_check,
  ADD CONSTRAINT client_video_settings_title_style_check
    CHECK (title_style IN (
      'classic', 'bold', 'minimal', 'bubble_dark', 'bubble_purple',
      'neon_verde', 'vermelho_forte', 'amarelo_caixa', 'branco_caixa',
      'contorno_grosso', 'caixa_colorida', 'papel_rasgado', 'cartao'
    ));
DELETE FROM live_costs WHERE kind = 'posicao_texto';
ALTER TABLE live_costs DROP CONSTRAINT live_costs_kind_check;
ALTER TABLE live_costs ADD CONSTRAINT live_costs_kind_check
  CHECK (kind IN ('transcricao', 'triagem', 'selecao', 'legenda', 'clipar_agora', 'juiz', 'ajuste_fino', 'camera', 'revisao', 'monitor_transcricao'));
