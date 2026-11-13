// obf.js — mirror of pipeline.obfuscate(): XOR(UTF-8 JSON, key) → base64.
// Only stops casual peeking at answers in DevTools; not a security mechanism.
const KEY = new TextEncoder().encode('hgvf-earnings');
export function deobfuscate(s) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ KEY[i % KEY.length];
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function obfuscate(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ^ KEY[i % KEY.length]);
  return btoa(bin);
}
