export const SIM_DESIGN_FRAMES = [105, 120, 135, 105, 105, 120, 210];
export const MIN_SCENE_FRAMES = 17; // every scene fades 8 frames in and 8 out
export function validateSceneFrames(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 7 || value.some(n => typeof n !== 'number' || !Number.isSafeInteger(n) || n < MIN_SCENE_FRAMES) || value.reduce((a, b) => a + b, 0) > 1800) {
    throw new Error('sim_invalid_scene_frames');
  }
  return value;
}
export function blackOutroFrame(lens: number[]): number {
  const v = validateSceneFrames(lens); const start = v.slice(0, 6).reduce((a, b) => a + b, 0);
  return start + Math.round(v[6] * 0.55);
}
