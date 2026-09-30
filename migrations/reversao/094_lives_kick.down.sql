-- Antes de reverter, os canais da Kick precisam sair (senao o CHECK antigo
-- recusa as linhas): as sessoes e cortes deles caem em cascata.
DELETE FROM live_channels WHERE platform = 'kick';
ALTER TABLE live_channels DROP CONSTRAINT live_channels_platform_check;
ALTER TABLE live_channels ADD CONSTRAINT live_channels_platform_check
  CHECK (platform IN ('twitch'));
