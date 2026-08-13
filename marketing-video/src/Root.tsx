import { Composition } from 'remotion';
import { FluxoAutomatico } from './FluxoAutomatico';
import { TutorialPassoAPasso, TUTORIAL_DURATION } from './TutorialPassoAPasso';

export const FPS = 30;
export const DURATION_IN_FRAMES = 240;

// As duas composicoes abaixo tem coordenadas internas pensadas pra uma tela
// de 1700px de largura (FluxoAutomatico) / 1700x1080 (Tutorial) - mexer
// nelas de novo a cada ajuste de enquadramento arrisca quebrar posicionamento
// já calibrado. Em vez disso, cada wrapper aqui embaixo MEDE onde o
// conteudo de verdade fica (bounding box real, medido pixel a pixel - ver
// scripts que geraram esses numeros) e so desloca+corta a MOLDURA por fora,
// como um crop de foto: a composicao original continua do tamanho antigo,
// só que deslocada pra tras de uma janela menor com overflow escondido.
function CropWindow({
  children,
  innerWidth,
  innerHeight,
  shiftX,
  shiftY,
  outerWidth,
  outerHeight,
}: {
  children: React.ReactNode;
  innerWidth: number;
  innerHeight: number;
  shiftX: number;
  shiftY: number;
  outerWidth: number;
  outerHeight: number;
}) {
  return (
    <div style={{ position: 'absolute', width: outerWidth, height: outerHeight, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: shiftX, top: shiftY, width: innerWidth, height: innerHeight }}>
        {children}
      </div>
    </div>
  );
}

// Medido com um script que varre os frames renderizados atras de pixel
// "nao-branco" (tolerancia 248/255) e junta o bounding box de varios pontos
// da linha do tempo - ver out/bbox e out/bbox2 (nao versionados, so o
// resultado importa). bbox real: x=[87,1604] y=[90,786] numa tela de
// 1700x840. Aqui sobra so ~16px de respiro de cada lado.
export const FLUXO_INNER_WIDTH = 1700;
export const FLUXO_INNER_HEIGHT = 840;
export const FLUXO_WIDTH = 1550;
export const FLUXO_HEIGHT = 730;
const FLUXO_SHIFT_X = -71;
const FLUXO_SHIFT_Y = -74;

// bbox real do Tutorial: x=[55,1644] y=[78,1042] numa tela de 1700x1080.
export const TUTORIAL_INNER_WIDTH = 1700;
export const TUTORIAL_INNER_HEIGHT = 1080;
export const TUTORIAL_WIDTH = 1620;
export const TUTORIAL_HEIGHT = 1000;
const TUTORIAL_SHIFT_X = -39;
const TUTORIAL_SHIFT_Y = -62;

const FluxoAutomaticoCortado: React.FC = () => (
  <CropWindow
    innerWidth={FLUXO_INNER_WIDTH}
    innerHeight={FLUXO_INNER_HEIGHT}
    shiftX={FLUXO_SHIFT_X}
    shiftY={FLUXO_SHIFT_Y}
    outerWidth={FLUXO_WIDTH}
    outerHeight={FLUXO_HEIGHT}
  >
    <FluxoAutomatico />
  </CropWindow>
);

const TutorialPassoAPassoCortado: React.FC = () => (
  <CropWindow
    innerWidth={TUTORIAL_INNER_WIDTH}
    innerHeight={TUTORIAL_INNER_HEIGHT}
    shiftX={TUTORIAL_SHIFT_X}
    shiftY={TUTORIAL_SHIFT_Y}
    outerWidth={TUTORIAL_WIDTH}
    outerHeight={TUTORIAL_HEIGHT}
  >
    <TutorialPassoAPasso />
  </CropWindow>
);

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="FluxoAutomatico"
        component={FluxoAutomaticoCortado}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={FLUXO_WIDTH}
        height={FLUXO_HEIGHT}
      />
      <Composition
        id="TutorialPassoAPasso"
        component={TutorialPassoAPassoCortado}
        durationInFrames={TUTORIAL_DURATION}
        fps={FPS}
        width={TUTORIAL_WIDTH}
        height={TUTORIAL_HEIGHT}
      />
    </>
  );
};
