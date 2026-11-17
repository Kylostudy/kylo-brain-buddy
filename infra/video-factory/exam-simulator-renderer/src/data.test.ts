import {test, expect} from 'bun:test';
import {blackOutroFrame, validateSceneFrames} from './timing';
test('exactly seven integer scenes, each long enough for the fades', () => {
  for (const v of [[], [80, 80], Array(7).fill(0), Array(7).fill(16), Array(7).fill(1.5), Array(7).fill(NaN), Array(7).fill(300)]) expect(() => validateSceneFrames(v)).toThrow();
  expect(validateSceneFrames([80, 80, 130, 119, 90, 94, 240]).reduce((a, b) => a + b, 0)).toBe(833);
});
test('black outro starts at 55% of the real scene 7', () => {
  expect(blackOutroFrame([80, 80, 130, 119, 90, 94, 240])).toBe(725); // 24167 ms in timing-hu.json
});
