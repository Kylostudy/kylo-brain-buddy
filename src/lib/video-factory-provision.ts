import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const payloadSchema = z.object({
  workerId: z.literal('worker-1'),
  publicKey: z.string().max(4096).startsWith('-----BEGIN PUBLIC KEY-----'),
}).strict();

export async function provisionFactory(request: Request, token: string | undefined, secret: string | undefined, authorizedDeployment: () => Promise<boolean>) {
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
  const fail = (status: number) => new Response(JSON.stringify({ ok: false }), { status, headers });
  const provided = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!token || !provided || provided.length > 512) return fail(401);
  const a = Buffer.from(provided);
  const b = Buffer.from(token.trim());
  if (a.length !== b.length || !timingSafeEqual(a, b)) return fail(401);
  if (!await authorizedDeployment()) return fail(403);
  if (!secret) return fail(503);
  try {
    const text = await request.text();
    if (text.length > 8192) return fail(400);
    const body = payloadSchema.parse(JSON.parse(text));
    const encoded = body.publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
    const key = await crypto.subtle.importKey('spki', Uint8Array.from(atob(encoded), c => c.charCodeAt(0)),
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const algorithm = key.algorithm as RsaKeyAlgorithm;
    if (algorithm.modulusLength < 2048 || algorithm.modulusLength > 4096) return fail(400);
    const ciphertext = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(secret));
    return new Response(JSON.stringify({ encrypted: Buffer.from(ciphertext).toString('base64') }), { headers });
  } catch {
    return fail(400);
  }
}