import { Composition } from 'remotion';
import { FluxoAutomatico } from './FluxoAutomatico';
import { TutorialPassoAPasso, TUTORIAL_DURATION } from './TutorialPassoAPasso';

export const FPS = 30;
export const DURATION_IN_FRAMES = 240;

// Cada composicao tem o proprio tamanho de tela, ajustado ao conteudo dela -
// nao e 16:9 de proposito. Um canvas generico deixava sobra de branco em
// volta do que realmente importa (reclamacao real: "o video em si esta
// concentrado apenas no centro"). Ver comentarios de cada arquivo pra saber
// por que cada dimensao foi escolhida.
export const FLUXO_WIDTH = 1700;
export const FLUXO_HEIGHT = 840;
export const TUTORIAL_WIDTH = 1700;
export const TUTORIAL_HEIGHT = 1080;

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="FluxoAutomatico"
        component={FluxoAutomatico}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={FLUXO_WIDTH}
        height={FLUXO_HEIGHT}
      />
      <Composition
        id="TutorialPassoAPasso"
        component={TutorialPassoAPasso}
        durationInFrames={TUTORIAL_DURATION}
        fps={FPS}
        width={TUTORIAL_WIDTH}
        height={TUTORIAL_HEIGHT}
      />
    </>
  );
};
