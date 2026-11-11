const days = ["Freitag", "Samstag", "Sonntag"];
const maxImageBytes = 20 * 1024 * 1024;
const maxPreviewBytes = 4 * 1024 * 1024;
const encoder = new TextEncoder();
const photoRoute = /^\/photos\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function error(message, status) {
  return json({ message }, status);
}

async function authorized(request, secret) {
  const supplied = request.headers.get("X-Upload-Password");
  if (!secret || !supplied || supplied.length > 3072) return false;
  let value;
  try {
    value = decodeURIComponent(supplied);
  } catch {
    return false;
  }
  const [a, b] = await Promise.all([value, secret].map(async candidate =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(candidate)))
  ));
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

function publicPhoto(object) {
  return {
    id: object.key.slice("photos/".length),
    name: object.customMetadata.name,
    day: object.customMetadata.day,
    tags: JSON.parse(object.customMetadata.tags),
    uploaded: object.uploaded.toISOString()
  };
}

async function catalog(bucket) {
  const photos = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: "photos/", include: ["customMetadata"], cursor });
    photos.push(...page.objects.map(publicPhoto));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return json({ photos: photos.sort((a, b) => b.uploaded.localeCompare(a.uploaded)) });
}

async function imageType(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const matches = (offset, signature) => signature.every((byte, index) => bytes[offset + index] === byte);
  if (matches(0, [0xff, 0xd8, 0xff])) return ["image/jpeg", "jpg"];
  if (matches(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ["image/png", "png"];
  if (matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80])) return ["image/webp", "webp"];
  return null;
}

function readTags(input) {
  let tags;
  try {
    tags = JSON.parse(input);
  } catch {
    return null;
  }
  if (!Array.isArray(tags) || tags.length > 8) return null;
  if (tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 32 || /[\x00-\x1f\x7f]/.test(tag))) return null;
  const normalized = new Map();
  const reserved = days.map(day => day.toLowerCase());
  for (const value of tags) {
    const tag = value.trim().replace(/\s+/g, " ").normalize("NFC");
    if (reserved.includes(tag.toLocaleLowerCase("de"))) return null;
    normalized.set(tag.toLocaleLowerCase("de"), tag);
  }
  return [...normalized.values()];
}

async function storePhoto(request, bucket, id) {
  if (Number(request.headers.get("Content-Length")) > maxImageBytes + maxPreviewBytes + 65536) {
    return error("Dieses Foto ist zu groß.", 413);
  }
  const key = "photos/" + id;
  const existing = await bucket.head(key);
  if (existing) return json({ photo: publicPhoto(existing) });

  let body;
  try {
    body = await request.formData();
  } catch {
    return error("Die Fotodaten konnten nicht gelesen werden.", 400);
  }
  const file = body.get("image");
  const preview = body.get("preview");
  const day = body.get("day");
  const tags = readTags(body.get("tags"));
  if (!days.includes(day)) return error("Wähle Freitag, Samstag oder Sonntag.", 400);
  if (!tags) return error("Prüfe die Tags für dieses Foto.", 400);
  if (!(file instanceof File) || !file.size || file.size > maxImageBytes) {
    return error("Wähle ein Foto bis 20 MB.", 400);
  }
  if (!(preview instanceof File) || !preview.size || preview.size > maxPreviewBytes) {
    return error("Die Vorschau ist ungültig.", 400);
  }
  const [originalType, previewType] = await Promise.all([imageType(file), imageType(preview)]);
  if (!originalType || !previewType) return error("Erlaubt sind JPG, PNG und WebP.", 415);

  const base = file.name.replace(/\.[^.]+$/, "").replace(/[\\/:\x00-\x1f\x7f]/g, "_").trim();
  const name = (Array.from(base).slice(0, 100).join("") || "Foto") + "." + originalType[1];
  await bucket.put("previews/" + id, preview, {
    httpMetadata: { contentType: previewType[0] }
  });
  const saved = await bucket.put(key, file, {
    httpMetadata: { contentType: originalType[0] },
    customMetadata: { name, day, tags: JSON.stringify(tags) }
  });
  return json({ photo: publicPhoto(saved) }, 201);
}

async function servePhoto(url, bucket, id) {
  const preview = url.searchParams.has("preview");
  const download = url.searchParams.has("download") && !preview;
  const object = await bucket.get((preview ? "previews/" : "photos/") + id);
  if (!object) return error("Dieses Foto ist nicht verfügbar.", 404);
  const headers = new Headers({
    "Content-Type": object.httpMetadata.contentType,
    "Content-Length": String(object.size),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=3600"
  });
  if (download) {
    const filename = encodeURIComponent(object.customMetadata.name).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16));
    headers.set("Content-Disposition", "attachment; filename*=UTF-8''" + filename);
  }
  return new Response(object.body, { headers });
}

async function route(request, env, originAllowed) {
  const url = new URL(request.url);
  const id = url.pathname.match(photoRoute)?.[1];
  if (request.method === "OPTIONS") return new Response(null, { status: originAllowed ? 204 : 403 });
  if (request.method === "GET" && url.pathname === "/photos") return catalog(env.PHOTOS);
  if (request.method === "GET" && id) return servePhoto(url, env.PHOTOS, id);

  const unlock = request.method === "POST" && url.pathname === "/auth";
  const publish = request.method === "PUT" && id;
  if (unlock || publish) {
    if (!originAllowed && request.headers.has("Origin")) return error("Diese Website darf keine Fotos hochladen.", 403);
    if (!env.UPLOAD_PASSWORD) return error("Der Upload ist noch nicht eingerichtet.", 503);
    if (!await authorized(request, env.UPLOAD_PASSWORD)) return error("Das Upload-Passwort stimmt nicht.", 401);
    if (unlock) return json({ ok: true });
    return storePhoto(request, env.PHOTOS, id);
  }
  return error("Diese Adresse gibt es nicht.", 404);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowed = (env.SITE_ORIGINS || "").split(",").map(value => value.trim());
    const originAllowed = Boolean(origin && allowed.includes(origin));
    let response;
    try {
      response = await route(request, env, originAllowed);
    } catch (failure) {
      console.error(failure);
      response = error("Der Fotodienst hat gerade ein Problem. Versuche es noch einmal.", 500);
    }
    const headers = new Headers(response.headers);
    headers.set("Vary", "Origin");
    if (originAllowed) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type, X-Upload-Password");
      headers.set("Access-Control-Max-Age", "600");
    }
    return new Response(response.body, { status: response.status, headers });
  }
};
