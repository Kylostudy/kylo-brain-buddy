export function sceneAt(frame: number, lens: number[]) {
  if (lens.length !== 7 || lens.some(n => !Number.isSafeInteger(n) || n <= 0)) throw new Error('seven_invalid_scene_frames');
  let start = 0;
  for (let i = 0; i < lens.length; i++) {
    const n = lens[i];
    if (n === undefined) throw new Error('seven_missing_scene');
    if (frame < start + n) return {index: i, local: frame-start};
    start += n;
  }
  throw new Error('seven_frame_outside_story');
}

export function displayText(text: string) {
  return text.replaceAll('Kylóban', 'Kylo-ban').replaceAll('Kylóval', 'Kylo-val').replaceAll('Kájló', 'Kylo');
}