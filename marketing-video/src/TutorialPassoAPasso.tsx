import React from 'react';
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import { BrandMarkIcon, CheckIcon, TikTokIcon, YouTubeIcon } from './icons';

const { fontFamily } = loadFont('normal', { weights: ['500', '600', '700', '800'], subsets: ['latin'] });

const COLOR = {
  paper: '#ffffff',
  ink: '#08090a',
  muted: '#6b7075',
  line: '#e7e7ea',
  mist: '#fafafa',
  yt: '#ff0000',
  ttCiano: '#25f4ee',
  ttRosa: '#fe2c55',
  acento: '#4f46e5',
  sucesso: '#15803d',
  destrutivo: '#d3302f',
};

const STEP_DURATION = 180;
const STEP3_DURATION = 150;
const OUTRO_DURATION = 90;

// Cartao com moldura de "janela" (3 bolinhas no topo, como um browser) em
// volta do print de verdade - deixa claro que aquilo e a tela real do
// produto, nao uma ilustracao.
function ScreenshotCard({
  src,
  width,
  glow,
  opacity,
  scale,
}: {
  src: string;
  width: number;
  glow: string;
  opacity: number;
  scale: number;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        // Fixo, nao 50% da tela inteira - o cabecalho (badge+titulo+subtitulo)
        // ocupa os primeiros ~300px. Centralizar na tela toda fazia o print
        // mais alto (passo2-estilo-fundo, quase quadrado) invadir o titulo.
        top: 630,
        width,
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity,
        borderRadius: 16,
        overflow: 'hidden',
        background: COLOR.paper,
        border: `1px solid ${COLOR.line}`,
        boxShadow: `0 30px 70px -25px rgba(8,9,10,0.35), 0 0 0 18px ${glow}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 7,
          padding: '12px 16px',
          borderBottom: `1px solid ${COLOR.line}`,
          background: COLOR.mist,
        }}
      >
        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840' }} />
      </div>
      <Img src={src} style={{ display: 'block', width: '100%', height: 'auto' }} />
    </div>
  );
}

// Icones simples, estilo linha (mesmo espirito dos tabler-icons usados de
// verdade no cartao de conta do TikTok no painel) - inline aqui porque sao
// usados só neste cartão, não vale colocar em icons.tsx pra um uso só.
function UsersIcon({ size = 24, color = COLOR.muted }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 5.5a3 3 0 0 1 0 5.8" />
      <path d="M21 20c0-2.8-2-5.1-4.6-5.8" />
    </svg>
  );
}
function HeartIcon({ size = 24, color = COLOR.muted }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20.2S3.5 15 3.5 9.1A4.6 4.6 0 0 1 12 6.4a4.6 4.6 0 0 1 8.5 2.7c0 5.9-8.5 11.1-8.5 11.1Z" />
    </svg>
  );
}
function FilmIcon({ size = 24, color = COLOR.muted }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="15" rx="2.4" />
      <path d="M8.5 4.5v15M15.5 4.5v15M3 9.5h5.5M15.5 9.5H21M3 14.5h5.5M15.5 14.5H21" />
    </svg>
  );
}
function TrashIcon({ size = 24, color = COLOR.destrutivo }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9.5 7V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7M6.5 7l.9 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-12" />
    </svg>
  );
}
function ClockIcon({ size = 24, color = COLOR.muted }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}

// Reproducao a mao (vetor, nao print) do cartao real de "Contas TikTok" do
// painel (web-client/src/pages/TikTokAccountPage.tsx, componente AccountBox) -
// mesmas cores/tokens de src/web-client/src/styles/globals.css, so que
// escalado ~2.2x pra caber bem no video. Motivo de nao usar um print de
// verdade aqui: a tela real desse cartao é bem curta (só a linha da conta +
// stats), então um print dela sozinho ficava com muito espaco em branco em
// cima/embaixo dentro do canvas do video - desenhando a mao a gente controla
// a altura e ainda ganha nitidez vetorial (print raster reamostrado perdia
// definicao).
function TikTokAccountCard({ opacity, scale }: { opacity: number; scale: number }) {
  const stat = (icon: React.ReactNode, valor: string, rotulo: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      {icon}
      <span style={{ fontFamily, fontWeight: 700, fontSize: 30, color: COLOR.ink }}>{valor}</span>
      <span style={{ fontFamily, fontWeight: 500, fontSize: 22, color: COLOR.muted }}>{rotulo}</span>
    </div>
  );

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: 630,
        width: 1500,
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity,
        borderRadius: 16,
        overflow: 'hidden',
        background: COLOR.paper,
        border: `1px solid ${COLOR.line}`,
        boxShadow: '0 30px 70px -25px rgba(8,9,10,0.35), 0 0 0 18px rgba(254,44,85,0.08)',
      }}
    >
      <div style={{ display: 'flex', gap: 7, padding: '12px 16px', borderBottom: `1px solid ${COLOR.line}`, background: COLOR.mist }}>
        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840' }} />
      </div>

      <div style={{ padding: 52, display: 'flex', flexDirection: 'column', gap: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
            <div
              style={{
                width: 100,
                height: 100,
                borderRadius: '50%',
                background: COLOR.ink,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
              }}
            >
              <TikTokIcon size={44} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontFamily, fontWeight: 700, fontSize: 36, color: COLOR.ink }}>Aqueles Clipes</span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 18px',
                    borderRadius: 999,
                    background: '#e9f7ee',
                    color: COLOR.sucesso,
                    fontFamily,
                    fontWeight: 700,
                    fontSize: 18,
                  }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'currentColor' }} />
                  Conectada
                </span>
              </div>
              <div style={{ marginTop: 8, fontFamily, fontWeight: 500, fontSize: 22, color: COLOR.muted }}>
                Conectada em 29/07/2026
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: COLOR.destrutivo, fontFamily, fontWeight: 600, fontSize: 22 }}>
            <TrashIcon size={26} color={COLOR.destrutivo} />
            Desconectar
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 56, borderTop: `1px solid ${COLOR.line}`, paddingTop: 40 }}>
          {stat(<UsersIcon size={30} />, '762', 'seguidores')}
          {stat(<HeartIcon size={30} />, '63,6mil', 'curtidas')}
          {stat(<FilmIcon size={30} />, '9', 'vídeos no perfil')}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${COLOR.line}`, paddingTop: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontFamily, fontWeight: 500, fontSize: 22, color: COLOR.muted }}>
            <ClockIcon size={28} />
            3 cortes na fila
            <span style={{ color: COLOR.line }}>·</span>
            <CheckIcon size={20} color={COLOR.sucesso} />
            <span style={{ color: COLOR.sucesso, fontWeight: 600 }}>128 já publicados</span>
          </div>
          <div
            style={{
              padding: '14px 26px',
              borderRadius: 10,
              border: `1px solid ${COLOR.line}`,
              fontFamily,
              fontWeight: 600,
              fontSize: 20,
              color: COLOR.ink,
            }}
          >
            Configurar postagens
          </div>
        </div>
      </div>
    </div>
  );
}

// Ponto que pulsa e "clica" - sugere alguem realmente usando a tela, sem
// precisar de um cursor de mouse desenhado (que ia parecer falso).
function ClickRipple({ x, y, frame, delay }: { x: number; y: number; frame: number; delay: number }) {
  const local = frame - delay;
  if (local < 0) return null;
  const cycle = local % 50;
  const ripple = interpolate(cycle, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
  const dotIn = spring({ frame: local, fps: 30, config: { damping: 200 }, durationInFrames: 10 });

  return (
    <div style={{ position: 'absolute', left: x, top: y, opacity: dotIn }}>
      <div
        style={{
          position: 'absolute',
          left: -18,
          top: -18,
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: `2px solid ${COLOR.acento}`,
          opacity: interpolate(ripple, [0, 1], [0.9, 0]),
          transform: `scale(${interpolate(ripple, [0, 1], [0.3, 1.6])})`,
        }}
      />
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: COLOR.acento, boxShadow: '0 2px 8px rgba(79,70,229,0.6)' }} />
    </div>
  );
}

function StepBadge({ n, frame, color }: { n: number; frame: number; color: string }) {
  const enter = spring({ frame, fps: 30, config: { damping: 200 }, durationInFrames: 18 });
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 16px 7px 10px',
        borderRadius: 999,
        background: color,
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [14, 0])}px)`,
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.25)',
          color: COLOR.paper,
          fontFamily,
          fontWeight: 800,
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {n}
      </div>
      <span style={{ fontFamily, fontWeight: 700, fontSize: 15, color: COLOR.paper, letterSpacing: '0.02em' }}>
        PASSO {n}
      </span>
    </div>
  );
}

function StepHeader({
  frame,
  n,
  color,
  title,
  subtitle,
}: {
  frame: number;
  n: number;
  color: string;
  title: string;
  subtitle: string;
}) {
  const textIn = spring({ frame: frame - 4, fps: 30, config: { damping: 200 }, durationInFrames: 20 });
  return (
    <div style={{ position: 'absolute', top: 78, left: 0, right: 0, textAlign: 'center' }}>
      <StepBadge n={n} frame={frame} color={color} />
      <div
        style={{
          marginTop: 22,
          fontFamily,
          fontWeight: 800,
          fontSize: 46,
          color: COLOR.ink,
          letterSpacing: '-0.02em',
          opacity: textIn,
          transform: `translateY(${interpolate(textIn, [0, 1], [16, 0])}px)`,
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily,
          fontWeight: 500,
          fontSize: 22,
          color: COLOR.muted,
          opacity: textIn,
        }}
      >
        {subtitle}
      </div>
    </div>
  );
}

function FollowUpCaption({ frame, delay, color, children }: { frame: number; delay: number; color: string; children: React.ReactNode }) {
  const local = frame - delay;
  const enter = spring({ frame: local, fps: 30, config: { damping: 200 }, durationInFrames: 18 });
  if (local < -5) return null;
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 55,
        left: '50%',
        transform: `translate(-50%, ${interpolate(enter, [0, 1], [14, 0])}px)`,
        opacity: Math.max(0, enter),
        maxWidth: 980,
        textAlign: 'center',
        background: COLOR.paper,
        border: `1px solid ${COLOR.line}`,
        borderRadius: 14,
        padding: '16px 28px',
        boxShadow: '0 16px 32px -18px rgba(8,9,10,0.25)',
      }}
    >
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 10 }} />
      <span style={{ fontFamily, fontWeight: 600, fontSize: 19, color: COLOR.ink, lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

function Step1() {
  const frame = useCurrentFrame();
  const shotAOpacity = interpolate(frame, [18, 34, 78, 96], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shotAScale = interpolate(frame, [18, 34], [0.94, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shotBOpacity = interpolate(frame, [88, 106], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shotBScale = interpolate(frame, [88, 160], [0.98, 1.03], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <>
      <StepHeader
        frame={frame}
        n={1}
        color={COLOR.yt}
        title="Adicione o canal que você quer clipar"
        subtitle="Cole o link do canal do YouTube. Só isso."
      />
      <div style={{ position: 'absolute', inset: 0 }}>
        {shotAOpacity > 0 && (
          <>
            <ScreenshotCard src={staticFile('screenshots/passo1-adicionar-canal.png')} width={1450} glow="rgba(255,0,0,0.06)" opacity={shotAOpacity} scale={shotAScale} />
            <ClickRipple x={1484} y={684} frame={frame} delay={40} />
          </>
        )}
        {shotBOpacity > 0 && (
          <ScreenshotCard src={staticFile('screenshots/passo1-canal-ativo.png')} width={1500} glow="rgba(255,0,0,0.06)" opacity={shotBOpacity} scale={shotBScale} />
        )}
      </div>
      <FollowUpCaption frame={frame} delay={112} color={COLOR.yt}>
        Sempre que esse canal postar um vídeo novo, o Post Flow já detecta sozinho — sem você precisar avisar.
      </FollowUpCaption>
    </>
  );
}

function Step2() {
  const frame = useCurrentFrame();
  const shotAOpacity = interpolate(frame, [18, 34, 70, 88], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shotAScale = interpolate(frame, [18, 34], [0.94, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shotBOpacity = interpolate(frame, [80, 98], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shotBScale = interpolate(frame, [80, 160], [0.98, 1.03], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <>
      <StepHeader
        frame={frame}
        n={2}
        color={COLOR.acento}
        title="Configure o estilo de corte desse canal"
        subtitle="Enquadramento, fundo, legenda e título — do seu jeito."
      />
      <div style={{ position: 'absolute', inset: 0 }}>
        {shotAOpacity > 0 && (
          <ScreenshotCard src={staticFile('screenshots/passo2-estilo-fundo.png')} width={1050} glow="rgba(79,70,229,0.08)" opacity={shotAOpacity} scale={shotAScale} />
        )}
        {shotBOpacity > 0 && (
          <>
            <ScreenshotCard src={staticFile('screenshots/passo2-estilo-legenda.png')} width={1180} glow="rgba(79,70,229,0.08)" opacity={shotBOpacity} scale={shotBScale} />
            <ClickRipple x={849} y={588} frame={frame} delay={106} />
          </>
        )}
      </div>
      <FollowUpCaption frame={frame} delay={122} color={COLOR.acento}>
        Escolha entre os estilos prontos ou deixe automático. Vale pra cada corte novo desse canal, sem repetir nada.
      </FollowUpCaption>
    </>
  );
}

function Step3() {
  const frame = useCurrentFrame();
  const shotOpacity = interpolate(frame, [18, 36], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shotScale = interpolate(frame, [18, STEP3_DURATION], [0.95, 1.02], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <>
      <StepHeader
        frame={frame}
        n={3}
        color={COLOR.ttRosa}
        title="Conecte sua conta do TikTok"
        subtitle="Autorização oficial, direto do seu perfil."
      />
      <div style={{ position: 'absolute', inset: 0 }}>
        <TikTokAccountCard opacity={shotOpacity} scale={shotScale} />
      </div>
      <FollowUpCaption frame={frame} delay={56} color={COLOR.ttRosa}>
        A partir daqui os cortes saem publicados sozinhos, no horário que você escolher — sem mais um clique.
      </FollowUpCaption>
    </>
  );
}

function Outro() {
  const frame = useCurrentFrame();
  const enter = spring({ frame, fps: 30, config: { damping: 200 }, durationInFrames: 20 });
  const iconsIn = spring({ frame: frame - 14, fps: 30, config: { damping: 14 }, durationInFrames: 18 });

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [18, 0])}px)` }}>
        <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginBottom: 30, opacity: iconsIn, transform: `scale(${interpolate(iconsIn, [0, 1], [0.7, 1])})` }}>
          {[
            { bg: COLOR.mist, icon: <YouTubeIcon size={28} /> },
            { bg: COLOR.ink, icon: <BrandMarkIcon size={24} color={COLOR.paper} /> },
            { bg: COLOR.mist, icon: <TikTokIcon size={24} /> },
          ].map((item, i) => (
            <div
              key={i}
              style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                background: item.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 10px 24px -10px rgba(8,9,10,0.3)',
              }}
            >
              {item.icon}
            </div>
          ))}
        </div>
        <div style={{ fontFamily, fontWeight: 800, fontSize: 48, color: COLOR.ink, letterSpacing: '-0.02em' }}>
          3 passos. Depois disso, é tudo automático.
        </div>
        <div
          style={{
            marginTop: 18,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontFamily,
            fontWeight: 600,
            fontSize: 18,
            color: COLOR.sucesso,
          }}
        >
          <CheckIcon size={16} color={COLOR.sucesso} />
          Zero esforço depois de configurar uma vez
        </div>
        <div style={{ marginTop: 26, fontFamily, fontWeight: 600, fontSize: 16, letterSpacing: '0.04em', color: COLOR.muted }}>
          POSTFLOWCLIPS.COM
        </div>
      </div>
    </AbsoluteFill>
  );
}

export const TutorialPassoAPasso: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 16, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const globalOpacity = Math.min(fadeIn, fadeOut);

  return (
    // Mesma separacao de fundo-solido / conteudo-que-esmaece do outro video:
    // .mp4 nao tem canal alfa, entao opacidade no fundo vira preto exportado.
    <AbsoluteFill style={{ background: COLOR.paper }}>
      <AbsoluteFill style={{ opacity: globalOpacity }}>
        <Sequence from={0} durationInFrames={STEP_DURATION} premountFor={15}>
          <Step1 />
        </Sequence>
        <Sequence from={STEP_DURATION} durationInFrames={STEP_DURATION} premountFor={15}>
          <Step2 />
        </Sequence>
        <Sequence from={STEP_DURATION * 2} durationInFrames={STEP3_DURATION} premountFor={15}>
          <Step3 />
        </Sequence>
        <Sequence from={STEP_DURATION * 2 + STEP3_DURATION} durationInFrames={OUTRO_DURATION} premountFor={15}>
          <Outro />
        </Sequence>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const TUTORIAL_DURATION = STEP_DURATION * 2 + STEP3_DURATION + OUTRO_DURATION;
