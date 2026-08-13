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

// Mesmas cores de FluxoAutomatico.tsx / public.css.
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
  sucesso: '#15803d',
};

// Versao vertical do FluxoAutomatico.tsx - mesmo conteudo (YouTube -> Post
// Flow -> TikTok), mesma logica de animacao, so que o eixo de progressao
// trocou de X (colunas lado a lado) pra Y (etapas empilhadas) - pensada pra
// caber na tela do celular em pe, sem precisar de rolagem horizontal (que
// era o problema real: a versao horizontal, forcada a caber na largura do
// celular, ficava com o texto minusculo). Canvas 900x1600 (proporcao de
// tela de celular), cortado tight no final do jeito que FluxoAutomatico e
// TutorialPassoAPasso ja foram.
const HUB_X = 190;
const ROW_Y = [260, 760, 1320];
const HUB_SIZE = 140;
const TEXT_LEFT = HUB_X + HUB_SIZE / 2 + 46;
const TEXT_WIDTH = 900 - TEXT_LEFT - 60;

const clip = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const ease = Easing.inOut(Easing.quad);

function RowHeader({
  y,
  frame,
  delay,
  title,
  paragraph,
}: {
  y: number;
  frame: number;
  delay: number;
  title: string;
  paragraph: string;
}) {
  const local = frame - delay;
  const enter = spring({ frame: local, fps: 30, config: { damping: 200 }, durationInFrames: 22 });
  const translateX = interpolate(enter, [0, 1], [18, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        left: TEXT_LEFT,
        top: y,
        width: TEXT_WIDTH,
        transform: `translate(${translateX}px, -50%)`,
        opacity: enter,
      }}
    >
      <div style={{ fontFamily, fontWeight: 700, fontSize: 32, color: COLOR.ink, letterSpacing: '-0.01em', lineHeight: 1.15 }}>
        {title}
      </div>
      <div style={{ fontFamily, fontWeight: 500, fontSize: 20, color: COLOR.muted, marginTop: 10, lineHeight: 1.45 }}>
        {paragraph}
      </div>
    </div>
  );
}

function Hub({ y, icon, background, pulseFrame }: { y: number; icon: React.ReactNode; background: string; pulseFrame: number | null }) {
  const scale = pulseFrame === null ? 1 : 1 + 0.12 * Math.max(0, 1 - Math.abs(pulseFrame) / 10);
  return (
    <div
      style={{
        position: 'absolute',
        left: HUB_X - HUB_SIZE / 2,
        top: y - HUB_SIZE / 2,
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

// Linha vertical entre dois hubs, com seta apontando pra baixo - mesma
// tecnica de stroke-dashoffset do original, só transposta.
function Arrow({ fromY, toY, progress }: { fromY: number; toY: number; progress: number }) {
  const x = HUB_X;
  const y1 = fromY + HUB_SIZE / 2 + 16;
  const y2 = toY - HUB_SIZE / 2 - 16;
  const length = y2 - y1;
  const dash = interpolate(progress, [0, 1], [length, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <svg style={{ position: 'absolute', left: 0, top: 0 }} width={900} height={1750}>
      <line x1={x} y1={y1} x2={x} y2={y2} stroke={COLOR.line} strokeWidth={4} />
      <line
        x1={x}
        y1={y1}
        x2={x}
        y2={y2}
        stroke={COLOR.acento}
        strokeWidth={4}
        strokeDasharray={length}
        strokeDashoffset={dash}
      />
      {progress > 0.02 && (
        <polygon
          points={`${x - 8},${y2 - dash} ${x},${y2 - dash + 14} ${x + 8},${y2 - dash}`}
          fill={COLOR.acento}
          opacity={progress < 1 ? 1 : 0}
        />
      )}
    </svg>
  );
}

// O video-fonte descendo do YouTube ate o hub do Post Flow (mesma logica do
// original, só que o "salto" perpendicular agora e' lateral, nao vertical -
// perpendicular ao eixo de viagem, que virou Y).
function TravelingVideoCard({ frame }: { frame: number }) {
  if (frame < 0) return null;
  const t = interpolate(frame, [0, 34], [0, 1], { easing: ease, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (t >= 1) return null;

  const y = interpolate(t, [0, 1], [ROW_Y[0], ROW_Y[1]]);
  const x = HUB_X + interpolate(Math.sin(t * Math.PI), [0, 1], [0, 70]);
  const scale = interpolate(t, [0, 0.15, 0.85, 1], [0.001, 1, 1, 0.3]);
  const opacity = interpolate(t, [0, 0.08, 0.9, 1], [0, 1, 1, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        left: x - 52,
        top: y - 34,
        width: 104,
        height: 68,
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 60 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: COLOR.ink,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PlayIcon size={12} />
        </div>
      </div>
    </div>
  );
}

// dx pequeno (nao 100+ como no original horizontal) porque aqui o texto
// fica do LADO do hub, nao em cima - um leque largo invadiria as
// palavras. dy grande empurra as 3 abas pra baixo do circulo do hub, longe
// do icone e do texto ao lado.
const CLIP_FAN = [
  { dx: -36, dy: 165, rot: -6 },
  { dx: 0, dy: 205, rot: 0 },
  { dx: 36, dy: 165, rot: 6 },
];

const CLIP_GRADIENTS = [
  `linear-gradient(160deg, ${COLOR.ttCiano}, ${COLOR.acento})`,
  `linear-gradient(160deg, ${COLOR.acento}, ${COLOR.ttRosa})`,
  `linear-gradient(160deg, ${COLOR.ttRosa}, #ff8a3d)`,
];

// Um dos 3 cortes verticais: nasce no hub do Post Flow, abre em leque, desce
// ate o hub do TikTok e recebe o selo de "publicado".
function ClipCard({ frame, index }: { frame: number; index: number }) {
  const fan = CLIP_FAN[index];
  const spawnDelay = index * 7;
  const travelDelay = 34 + index * 9;
  const arriveDelay = travelDelay + 30;

  const localSpawn = frame - spawnDelay;
  const bornAt = spring({ frame: localSpawn, fps: 30, config: { damping: 13 }, durationInFrames: 20 });

  if (frame < spawnDelay) return null;

  const fanX = HUB_X + fan.dx;
  const fanY = ROW_Y[1] + fan.dy;
  const landX = HUB_X + fan.dx * 0.85;
  const landY = ROW_Y[2] + fan.dy * 0.85;

  const travelT = clip(
    interpolate(frame, [travelDelay, travelDelay + 30], [0, 1], { easing: ease, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    0,
    1
  );

  const x = frame < travelDelay ? interpolate(bornAt, [0, 1], [HUB_X, fanX]) : interpolate(travelT, [0, 1], [fanX, landX]);
  const y = frame < travelDelay ? interpolate(bornAt, [0, 1], [ROW_Y[1], fanY]) : interpolate(travelT, [0, 1], [fanY, landY]);
  const rotate = frame < travelDelay ? interpolate(bornAt, [0, 1], [0, fan.rot]) : interpolate(travelT, [0, 1], [fan.rot, fan.rot * 0.6]);
  const scale = frame < travelDelay ? interpolate(bornAt, [0, 1], [0.2, 1]) : interpolate(travelT, [0, 1], [1, 0.78]);

  const badgeIn = spring({ frame: frame - arriveDelay, fps: 30, config: { damping: 11 }, durationInFrames: 16 });

  return (
    <div
      style={{
        position: 'absolute',
        left: x - 44,
        top: y - 76,
        width: 88,
        height: 152,
        borderRadius: 16,
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
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <PlayIcon size={14} />
      </div>

      {arriveDelay < frame && (
        <div
          style={{
            position: 'absolute',
            top: -9,
            right: -9,
            width: 30,
            height: 30,
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
          <CheckIcon size={14} />
        </div>
      )}
    </div>
  );
}

export const FluxoAutomaticoVertical: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 16, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const globalOpacity = Math.min(fadeIn, fadeOut);

  const arrow1Progress = interpolate(frame, [26, 60], [0, 1], { easing: ease, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const arrow2Progress = interpolate(frame, [116, 150], [0, 1], { easing: ease, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const pulseHub2 = frame >= 58 && frame <= 68 ? frame - 63 : null;
  const pulseHub3 = frame >= 144 && frame <= 154 ? frame - 149 : null;

  return (
    <AbsoluteFill style={{ background: COLOR.paper }}>
      <AbsoluteFill style={{ opacity: globalOpacity }}>
        <RowHeader
          y={ROW_Y[0]}
          frame={frame}
          delay={4}
          title="Você publica no YouTube"
          paragraph="Um vídeo longo: podcast, live, aula, entrevista."
        />
        <RowHeader
          y={ROW_Y[1]}
          frame={frame}
          delay={12}
          title="O Post Flow faz o trabalho"
          paragraph="Detecta, corta no vertical e legenda. Sem ninguém clicar em nada."
        />
        <RowHeader
          y={ROW_Y[2]}
          frame={frame}
          delay={20}
          title="Sai no seu TikTok"
          paragraph="Publicado no seu perfil, no horário que você escolheu."
        />

        <Arrow fromY={ROW_Y[0]} toY={ROW_Y[1]} progress={arrow1Progress} />
        <Arrow fromY={ROW_Y[1]} toY={ROW_Y[2]} progress={arrow2Progress} />

        <Hub y={ROW_Y[0]} icon={<YouTubeIcon size={50} />} background={COLOR.paper} pulseFrame={null} />
        <Hub y={ROW_Y[1]} icon={<BrandMarkIcon size={54} color={COLOR.paper} />} background={COLOR.ink} pulseFrame={pulseHub2} />
        <Hub y={ROW_Y[2]} icon={<TikTokIcon size={48} />} background={COLOR.paper} pulseFrame={pulseHub3} />

        <TravelingVideoCard frame={frame - 26} />
        <ClipCard frame={frame - 60} index={0} />
        <ClipCard frame={frame - 60} index={1} />
        <ClipCard frame={frame - 60} index={2} />

        <div
          style={{
            position: 'absolute',
            bottom: 46,
            left: 40,
            right: 40,
            textAlign: 'center',
            opacity: interpolate(frame, [180, 200], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}
        >
          <div style={{ fontFamily, fontWeight: 700, fontSize: 24, color: COLOR.ink, letterSpacing: '-0.01em', lineHeight: 1.3 }}>
            Tudo acontece sem você precisar dar nem um clique
          </div>
          <div style={{ fontFamily, fontWeight: 600, fontSize: 15, letterSpacing: '0.04em', color: COLOR.muted, marginTop: 8 }}>
            POSTFLOWCLIPS.COM
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
