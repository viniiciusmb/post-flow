-- Cortes de lives tambem da Kick (pedido de 30/09/2026). So o CHECK da
-- plataforma muda; o resto (sessoes, pedacos, transcricao, cortes) ja era
-- independente de plataforma. Canal existente continua 'twitch'.
ALTER TABLE live_channels DROP CONSTRAINT live_channels_platform_check;
ALTER TABLE live_channels ADD CONSTRAINT live_channels_platform_check
  CHECK (platform IN ('twitch', 'kick'));
