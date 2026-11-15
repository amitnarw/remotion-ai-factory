/**
 * Stand-alone Remotion entry for the QA scalp test.
 *   npx remotion still src/compositions/qa/index.ts ScalpTest out/scalp-test.png --scale 1
 */
import { Composition, registerRoot } from "remotion";
import { ScalpTest } from "./ScalpTest";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

const QARoot: React.FC = () => (
  <>
    <Composition
      id="ScalpTest"
      component={ScalpTest as unknown as React.ComponentType<Record<string, unknown>>}
      durationInFrames={1}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{}}
    />
  </>
);

registerRoot(QARoot);
