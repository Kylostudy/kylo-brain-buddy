// Existing Kylo motion-video palette; shared by every object in this family.
export const theme = {
  background: '#050C18', panel: '#12264A', ink: '#1B2A44',
  paper: '#F4F0E6', gold: '#E9B44C', goldLight: '#FFE3A3',
  pink: '#F2A7B5', pinkDark: '#D97D90', green: '#3FBF7F',
  blue: '#6CA9DC', white: '#E8EEF7', black: '#000000',
};
export type Story = 'hajo' | 'auto' | 'repulo' | 'ust' | 'szamlatorony' | 'hatizsak' | 'malacpersely-uj';
export type Subtitle = {start_ms: number; end_ms: number; text: string};
export type MasterProps = {story: Story; sceneFrames: number[]; dogAsset: string; subtitles: Subtitle[]};