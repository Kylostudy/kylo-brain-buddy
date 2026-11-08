import {test, expect} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {coinHitFrames, sceneAt, textDirection, validateSceneFrames} from './timing';
import {stageVerified} from './files';
test('exact seven finite positive integers',()=>{
  for(const value of [[],[1,2],Array(7).fill(0),Array(7).fill(NaN),Array(7).fill(Infinity),Array(7).fill(1.5)]) expect(()=>validateSceneFrames(value)).toThrow();
  expect(validateSceneFrames([120,300,120,300,150,90,90]).reduce((a,b)=>a+b,0)).toBe(1170);
});
test('counter and total scene windows do not overlap',()=>{
  const lens=[120,300,120,300,150,90,90];
  expect(sceneAt(419,lens).index).toBe(1);expect(sceneAt(420,lens).index).toBe(2);
});
test('coin impacts follow each language scene lengths',()=>{
  expect(coinHitFrames([120,300,120,300,150,90,90])).toEqual([70,150,210,270,330]);
  const longer=[240,600,120,300,150,90,90];
  expect(coinHitFrames(longer)).toEqual([140,300,420,540,660]);
  expect(()=>coinHitFrames([1,2,3,4,5,6])).toThrow();
});
test('arabic renders right-to-left, others left-to-right',()=>{
  expect(textDirection('ar')).toBe('rtl');
  for(const lang of ['en','de','ja','ko','zh','hi','ru','el']) expect(textDirection(lang)).toBe('ltr');
});
test('checksum and safe file paths are independently enforced',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'piggy-data-'));
  try {
    const source=path.join(root,'recipe'),stage=path.join(root,'stage');fs.mkdirSync(source);fs.mkdirSync(stage);fs.writeFileSync(path.join(source,'audio'), 'data');
    const file={key:'audio',bytes:4,sha256:createHash('sha256').update('data').digest('hex')};
    expect(()=>stageVerified('../audio',[file],source,stage)).toThrow();
    expect(()=>stageVerified('audio',[{...file,sha256:'0'.repeat(64)}],source,stage)).toThrow();
    fs.symlinkSync(path.join(source,'audio'),path.join(source,'link'));
    expect(()=>stageVerified('link',[{...file,key:'link'}],source,stage)).toThrow();
    expect(fs.readFileSync(stageVerified('audio',[file],source,stage),'utf8')).toBe('data');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
