import { Composition } from "remotion";
import { Film } from "./Film";
import T from "./timeline.json";
export const Root = () => <Composition id="Film" component={Film} width={1920} height={1080} fps={60} durationInFrames={Math.round(T.total * 60)} />;
