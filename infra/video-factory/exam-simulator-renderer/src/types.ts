export type Subtitle = {scene: number; start_ms: number; end_ms: number; text: string};
export type Props = {sceneFrames: number[]; screens: [string, string, string, string]; subs: Subtitle[]; logo: string};
