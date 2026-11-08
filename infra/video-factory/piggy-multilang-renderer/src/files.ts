import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export type InputFile = {key:string; bytes:number; sha256:string};
export function stageVerified(key:string, files: InputFile[], root='/recipe', stage='/tmp/stage') {
  const f = files.find(item => item.key === key);
  if (!f || !/^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/.test(key) || !Number.isSafeInteger(f.bytes) || f.bytes < 1 || f.bytes > 40*1024*1024 || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('piggy_unsafe_recipe_key');
  let src = root;
  for (const part of key.split('/')) {src=path.join(src,part); if(fs.lstatSync(src).isSymbolicLink()) throw new Error('piggy_symlink_recipe_key');}
  if (!fs.realpathSync(src).startsWith(fs.realpathSync(root)+path.sep) || !fs.statSync(src).isFile()) throw new Error('piggy_unsafe_recipe_path');
  const fd = fs.openSync(src, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes: Buffer;
  try { if(fs.fstatSync(fd).size !== f.bytes) throw new Error('piggy_media_checksum_failed'); bytes=fs.readFileSync(fd); } finally {fs.closeSync(fd);}
  if (createHash('sha256').update(bytes).digest('hex') !== f.sha256) throw new Error('piggy_media_checksum_failed');
  const target = path.join(stage,key); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,bytes,{flag:'wx'}); return target;
}