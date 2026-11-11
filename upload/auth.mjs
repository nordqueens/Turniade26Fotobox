const encoder = new TextEncoder();
const sessionSeconds = 30 * 60;
const passwordAlgorithm = { name: "PBKDF2", hash: "SHA-256", iterations: 100_000 };
const signatureAlgorithm = { name: "HMAC", hash: "SHA-256" };
const toHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const fromHex = hex => Uint8Array.from(hex.match(/../g), pair => Number.parseInt(pair, 16));

async function derivePassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ ...passwordAlgorithm, salt }, key, 256));
}

export async function createUploadSecret(password) {
  if (typeof password !== "string" || !password || password.length > 256) throw new Error("Ungültiges Upload-Passwort.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const signingKey = crypto.getRandomValues(new Uint8Array(32));
  const hash = await derivePassword(password, salt);
  return [salt, hash, signingKey].map(toHex).join(".");
}

export function readUploadSecret(value) {
  const fields = value?.match(/^([a-f0-9]{32})\.([a-f0-9]{64})\.([a-f0-9]{64})$/);
  if (!fields) return null;
  const [salt, hash, signingKey] = fields.slice(1).map(fromHex);
  return { salt, hash, signingKey };
}

export async function checkUploadPassword(password, secret) {
  if (typeof password !== "string" || !password || password.length > 256) return false;
  const candidate = await derivePassword(password, secret.salt);
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(candidate, secret.hash);
  let difference = 0;
  for (let i = 0; i < candidate.length; i++) difference |= candidate[i] ^ secret.hash[i];
  return difference === 0;
}

async function sessionKey(secret, usage) {
  return crypto.subtle.importKey("raw", secret.signingKey, signatureAlgorithm, false, [usage]);
}

export async function issueUploadToken(secret) {
  const expires = Math.floor(Date.now() / 1000) + sessionSeconds;
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const payload = expires + "." + nonce;
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(secret, "sign"), encoder.encode(payload));
  return payload + "." + toHex(new Uint8Array(signature));
}

export async function checkUploadToken(header, secret) {
  const fields = header?.match(/^Bearer (\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/);
  if (!fields || Number(fields[1]) <= Math.floor(Date.now() / 1000)) return false;
  const [, expires, nonce, signature] = fields;
  return crypto.subtle.verify("HMAC", await sessionKey(secret, "verify"), fromHex(signature), encoder.encode(expires + "." + nonce));
}
