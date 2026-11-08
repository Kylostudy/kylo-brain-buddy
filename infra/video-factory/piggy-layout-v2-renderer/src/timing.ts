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