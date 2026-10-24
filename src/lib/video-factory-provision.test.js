import { test, expect } from 'bun:test';
import { provisionFactory } from './video-factory-provision';

test('unauthorized caller cannot provision', async () => {
  const response = await provisionFactory(new Request('https://example.test', { method: 'POST' }), 'test-worker-token', 'synthetic-test-secret', async () => true);
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

test('only approved worker can provision', async () => {
  const response = await provisionFactory(new Request('https://example.test', { method: 'POST',
    headers: { Authorization: 'Bearer test-worker-token' }, body: JSON.stringify({ workerId: 'other-worker', publicKey: '-----BEGIN PUBLIC KEY-----' }) }), 'test-worker-token', 'synthetic-test-secret', async () => true);
  expect(response.status).toBe(400);
});

test('approved VPS receives only ciphertext decryptable by its private key', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const publicKey = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(spki).toString('base64')}\n-----END PUBLIC KEY-----`;
  const response = await provisionFactory(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test-worker-token' }, body: JSON.stringify({ workerId: 'worker-1', publicKey }) }), 'test-worker-token', 'synthetic-test-secret', async () => true);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text.includes('synthetic-test-secret')).toBe(false);
  const payload = JSON.parse(text);
  const plain = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, pair.privateKey, Buffer.from(payload.encrypted, 'base64'));
  expect(new TextDecoder().decode(plain)).toBe('synthetic-test-secret');
});

test('provisioning is blocked outside an active deployment', async () => {
  const response = await provisionFactory(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test-worker-token' } }), 'test-worker-token', 'synthetic-test-secret', async () => false);
  expect(response.status).toBe(403);
});