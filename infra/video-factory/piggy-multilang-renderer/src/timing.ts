export const PIGGY_DESIGN_FRAMES = [120, 300, 120, 300, 150, 90, 90];

export function validateSceneFrames(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 7 || value.some(n => typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > 18000) || value.reduce((a, b) => a + b, 0) > 18000) {
    throw new Error('piggy_invalid_scene_frames');
  }
  return value;
}
export function sceneAt(frame: number, lens: number[]) {
  let start = 0;
  for (let i = 0; i < lens.length; i++) {
    if (frame < start + lens[i]) return {index: i, local: frame - start, start};
    start += lens[i];
  }
  throw new Error('piggy_frame_outside_scenes');
}
// Coin impacts follow the animation of each language's own scene lengths:
// design frame 70 of scene 1 and design frames 30/90/150/210 of scene 2, scaled proportionally.
export function coinHitFrames(lens: number[]): number[] {
  const v = validateSceneFrames(lens);
  const scale = (i: number, f: number) => Math.round(f * v[i] / PIGGY_DESIGN_FRAMES[i]);
  return [scale(0, 70), ...[30, 90, 150, 210].map(h => v[0] + scale(1, h))];
}
// Arabic renders right-to-left; every other approved language is left-to-right.
export function textDirection(language: string): 'ltr' | 'rtl' {
  return language === 'ar' ? 'rtl' : 'ltr';
}
