import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import { BrandMarkIcon, CheckIcon, PlayIcon, TikTokIcon, YouTubeIcon } from './icons';

const { fontFamily } = loadFont('normal', { weights: ['500', '600', '700'], subsets: ['latin'] });

// Mesmas cores de src/web/public/css/public.css - o video precisa ficar
// identico ao resto do site, nao so parecido.
const COLOR = {
  paper: '#ffffff',
  ink: '#08090a',
  muted: '#6b7075',
  line: '#e7e7ea',
  mist2: '#f4f4f5',
  yt: '#ff0000',
  ttCiano: '#25f4ee',
  ttRosa: '#fe2c55',
  acento: '#4f46e5',
  acentoLavagem: '#eef0ff',
  sucesso: '#15803d',
};

// Canvas 1700x840 (nao 1920x1080) - ajustado ao conteudo de proposito, ver
// Root.tsx. Colunas quase encostando nas bordas (antes tinham ~380px de
// sobra de cada lado); HUB_Y deixando folga igual em cima (cabecalho) e
// embaixo (legenda final).
const COL_X = [320, 850, 1380];
const HUB_Y = 470;
const HUB_SIZE = 180;

const clip = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Empurra a curva pra dentro/fora nas pontas - movimento de camera, nao de
// interface plana. Usado em toda transicao de posicao entre hubs.
const ease = Easing.inOut(Easing.quad);

function ColumnHeader({
  x,
  frame,
  delay,
  icon,
  iconBg,
  title,
  titleSize,
  paragraph,
}: {
  x: number;
  frame: number;
  delay: number;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  titleSize?: number;
  paragraph: string;
}) {
  const local = frame - delay;
  const enter = spring({ frame: local, fps: 30, config: { damping: 200 }, durationInFrames: 22 });
  const translateY = interpolate(enter, [0, 1], [24, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        left: x - 320,
        top: 90,
        width: 640,
        textAlign: 'center',
        opacity: enter,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 22px',
          boxShadow: '0 8px 20px -8px rgba(8,9,10,0.25)',
        }}
      >
        {icon}
      </div>
      <div style={{ fontFamily, fontWeight: 700, fontSize: titleSize || 34, color: COLOR.ink, letterSpacing: '-0.01em' }}>
        {title}
      </div>
      <div
        style={{
          fontFamily,
          fontWeight: 500,
          fontSize: 21,
          color: COLOR.muted,
          marginTop: 10,
          lineHeight: 1.5,
          maxWidth: 480,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
      >
        {paragraph}
      </div>
    </div>
  );
}

function Hub({ x, icon, background, pulseFrame }: { x: number; icon: React.ReactNode; background: string; pulseFrame: number | null }) {
  const scale = pulseFrame === null ? 1 : 1 + 0.12 * Math.max(0, 1 - Math.abs(pulseFrame) / 10);
  return (
    <div
      style={{
        position: 'absolute',
        left: x - HUB_SIZE / 2,
        top: HUB_Y - HUB_SIZE / 2,
        width: HUB_SIZE,
        height: HUB_SIZE,
        borderRadius: '50%',
        background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${scale})`,
        boxShadow: '0 24px 48px -20px rgba(8,9,10,0.35)',
      }}
    >
      {icon}
    </div>
  );
}

// Linha entre dois hubs que "desenha" com stroke-dashoffset - progress 0 a 1.
function Arrow({ fromX, toX, progress }: { fromX: number; toX: number; progress: number }) {
  const y = HUB_Y;
  const x1 = fromX + HUB_SIZE / 2 + 18;
  const x2 = toX - HUB_SIZE / 2 - 18;
  const length = x2 - x1;
  const dash = interpolate(progress, [0, 1], [length, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <svg
      style={{ position: 'absolute', left: 0, top: 0 }}
      width={1700}
      height={840}
    >
      <line
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        stroke={COLOR.line}
        strokeWidth={4}
      />
      <line
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        stroke={COLOR.acento}
        strokeWidth={4}
        strokeDasharray={length}
        strokeDashoffset={dash}
      />
      {progress > 0.02 && (
        <polygon
          points={`${x2 - dash},${y - 8} ${x2 - dash + 14},${y} ${x2 - dash},${y + 8}`}
          fill={COLOR.acento}
          opacity={progress < 1 ? 1 : 0}
        />
      )}
    </svg>
  );
}

// O video-fonte viajando do YouTube ate o hub do Post Flow.
function TravelingVideoCard({ frame }: { frame: number }) {
  if (frame < 0) return null;
  const t = interpolate(frame, [0, 34], [0, 1], { easing: ease, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (t >= 1) return null;

  const x = interpolate(t, [0, 1], [COL_X[0], COL_X[1]]);
  const y = HUB_Y - interpolate(Math.sin(t * Math.PI), [0, 1], [0, 90]);
  const scale = interpolate(t, [0, 0.15, 0.85, 1], [0.001, 1, 1, 0.3]);
  const opacity = interpolate(t, [0, 0.08, 0.9, 1], [0, 1, 1, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        left: x - 58,
        top: y - 38,
        width: 116,
        height: 76,
        borderRadius: 12,
        background: COLOR.paper,
        border: `2px solid ${COLOR.line}`,
        boxShadow: '0 16px 32px -14px rgba(8,9,10,0.3)',
        opacity,
        transform: `scale(${scale})`,
        overflow: 'hidden',
      }}
    >
      <div style={{ height: 8, background: COLOR.yt }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 68 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: COLOR.ink,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PlayIcon size={14} />
        </div>
      </div>
    </div>
  );
}

const CLIP_FAN = [
  { dx: -108, dy: 46, rot: -7 },
  { dx: 0, dy: 76, rot: 0 },
  { dx: 108, dy: 46, rot: 7 },
];

const CLIP_GRADIENTS = [
  `linear-gradient(160deg, ${COLOR.ttCiano}, ${COLOR.acento})`,
  `linear-gradient(160deg, ${COLOR.acento}, ${COLOR.ttRosa})`,
  `linear-gradient(160deg, ${COLOR.ttRosa}, #ff8a3d)`,
];

// Um dos 3 cortes verticais: nasce no hub do Post Flow, abre em leque, depois
// viaja ate o hub do TikTok e recebe o selo de "publicado".
function ClipCard({ frame, index }: { frame: number; index: number }) {
  const fan = CLIP_FAN[index];
  const spawnDelay = index * 7;
  const travelDelay = 34 + index * 9;
  const arriveDelay = travelDelay + 30;

  const localSpawn = frame - spawnDelay;
  const bornAt = spring({ frame: localSpawn, fps: 30, config: { damping: 13 }, durationInFrames: 20 });

  if (frame < spawnDelay) return null;

  const fanX = COL_X[1] + fan.dx;
  const fanY = HUB_Y + fan.dy;
  // Leque de chegada no hub do TikTok - sem isso os 3 cortes pousavam todos
  // no mesmo pixel exato (centro do hub), um escondendo o outro atras.
  const landX = COL_X[2] + fan.dx * 0.85;
  const landY = HUB_Y + fan.dy * 0.85;

  const travelT = clip(
    interpolate(frame, [travelDelay, travelDelay + 30], [0, 1], { easing: ease, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    0,
    1
  );

  const x = frame < travelDelay ? interpolate(bornAt, [0, 1], [COL_X[1], fanX]) : interpolate(travelT, [0, 1], [fanX, landX]);
  const y = frame < travelDelay ? interpolate(bornAt, [0, 1], [HUB_Y, fanY]) : interpolate(travelT, [0, 1], [fanY, landY]);
  const rotate = frame < travelDelay ? interpolate(bornAt, [0, 1], [0, fan.rot]) : interpolate(travelT, [0, 1], [fan.rot, fan.rot * 0.6]);
  const scale = frame < travelDelay ? interpolate(bornAt, [0, 1], [0.2, 1]) : interpolate(travelT, [0, 1], [1, 0.78]);

  const badgeIn = spring({ frame: frame - arriveDelay, fps: 30, config: { damping: 11 }, durationInFrames: 16 });

  return (
    <div
      style={{
        position: 'absolute',
        left: x - 48,
        top: y - 84,
        width: 96,
        height: 168,
        borderRadius: 18,
        background: CLIP_GRADIENTS[index],
        transform: `rotate(${rotate}deg) scale(${scale})`,
        boxShadow: '0 20px 40px -16px rgba(8,9,10,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <PlayIcon size={16} />
      </div>

      {arriveDelay < frame && (
        <div
          style={{
            position: 'absolute',
            top: -10,
            right: -10,
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: COLOR.sucesso,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: badgeIn,
            transform: `scale(${interpolate(badgeIn, [0, 1], [0.4, 1])})`,
            boxShadow: '0 6px 14px -4px rgba(21,128,61,0.6)',
          }}
        >
          <CheckIcon size={16} />
        </div>
      )}
    </div>
  );
}

export const FluxoAutomatico: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 16, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const globalOpacity = Math.min(fadeIn, fadeOut);

  // extrapolateLeft/Right precisam estar DENTRO do interpolate (nao so no
  // clip() por fora) - com easing, um frame fora do intervalo [26,60] passa
  // um valor fora de [0,1] pra dentro da formula do easing (que so faz
  // sentido nesse dominio), e ela pode devolver qualquer coisa (o quad
  // "explode" pra valores bem maiores que 1 com entrada negativa) - o clip()
  // por fora so via o resultado ja errado.
  const arrow1Progress = interpolate(frame, [26, 60], [0, 1], {
    easing: ease,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const arrow2Progress = interpolate(frame, [116, 150], [0, 1], {
    easing: ease,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const pulseHub2 = frame >= 58 && frame <= 68 ? frame - 63 : null;
  const pulseHub3 = frame >= 144 && frame <= 154 ? frame - 149 : null;

  return (
    // Fundo branco SEM opacidade, sempre solido - separado do conteudo (que
    // esmaece por baixo dele). Antes o opacity ficava no AbsoluteFill de
    // fora, junto com o fundo: como .mp4 nao tem canal alfa, "opacity 0" no
    // fundo virava preto na exportacao em vez de branco, e cada ponta do
    // video (comeco e fim) piscava uma tela escura.
    <AbsoluteFill style={{ background: COLOR.paper }}>
    <AbsoluteFill style={{ opacity: globalOpacity }}>
      <ColumnHeader
        x={COL_X[0]}
        frame={frame}
        delay={4}
        icon={<YouTubeIcon size={30} />}
        iconBg={COLOR.mist2}
        title="Vídeo novo no canal monitorado"
        titleSize={28}
        paragraph="Post Flow percebe na hora, sem você precisar avisar."
      />
      <ColumnHeader
        x={COL_X[1]}
        frame={frame}
        delay={12}
        icon={<BrandMarkIcon size={26} color={COLOR.paper} />}
        iconBg={COLOR.ink}
        title="O Post Flow faz o trabalho"
        paragraph="Detecta, corta no vertical e legenda. Sem ninguém clicar em nada."
      />
      <ColumnHeader
        x={COL_X[2]}
        frame={frame}
        delay={20}
        icon={<TikTokIcon size={26} />}
        iconBg={COLOR.mist2}
        title="Sai no seu TikTok"
        paragraph="Publicado direto no seu perfil, no horário que você escolheu."
      />

      <Arrow fromX={COL_X[0]} toX={COL_X[1]} progress={arrow1Progress} />
      <Arrow fromX={COL_X[1]} toX={COL_X[2]} progress={arrow2Progress} />

      <Hub x={COL_X[0]} icon={<YouTubeIcon size={64} />} background={COLOR.paper} pulseFrame={null} />
      <Hub x={COL_X[1]} icon={<BrandMarkIcon size={68} color={COLOR.paper} />} background={COLOR.ink} pulseFrame={pulseHub2} />
      <Hub x={COL_X[2]} icon={<TikTokIcon size={60} />} background={COLOR.paper} pulseFrame={pulseHub3} />

      <TravelingVideoCard frame={frame - 26} />
      <ClipCard frame={frame - 60} index={0} />
      <ClipCard frame={frame - 60} index={1} />
      <ClipCard frame={frame - 60} index={2} />

      <div
        style={{
          position: 'absolute',
          bottom: 50,
          left: 0,
          right: 0,
          textAlign: 'center',
          opacity: interpolate(frame, [180, 200], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        }}
      >
        <div
          style={{
            fontFamily,
            fontWeight: 700,
            fontSize: 26,
            color: COLOR.ink,
            letterSpacing: '-0.01em',
          }}
        >
          Tudo acontece sem você precisar dar nem um clique
        </div>
        <div
          style={{
            fontFamily,
            fontWeight: 600,
            fontSize: 16,
            letterSpacing: '0.04em',
            color: COLOR.muted,
            marginTop: 8,
          }}
        >
          POSTFLOWCLIPS.COM
        </div>
      </div>
    </AbsoluteFill>
    </AbsoluteFill>
  );
};
