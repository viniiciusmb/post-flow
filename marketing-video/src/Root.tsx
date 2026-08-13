import { Composition } from 'remotion';
import { FluxoAutomatico } from './FluxoAutomatico';

export const FPS = 30;
export const DURATION_IN_FRAMES = 240;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="FluxoAutomatico"
        component={FluxoAutomatico}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    </>
  );
};
