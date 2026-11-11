import { samplePhotos } from "./sample-photos.mjs";

const days = ["Freitag", "Samstag", "Sonntag"];
const maxImageBytes = 20 * 1024 * 1024;
const maxPreviewBytes = 4 * 1024 * 1024;
const samples = new Map(samplePhotos.map(({ source, thumbnail, ...photo }) => [photo.id, {
  ...photo, uploaded: "", status: "visible"
}]));

export class PhotoError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const missing = () => new PhotoError(404, "Dieses Foto ist nicht verfügbar.");
const conflict = () => new PhotoError(409, "Das Foto wurde inzwischen geändert. Öffne es bitte erneut.");
const stateKey = id => "catalog/" + id;

function legacyPhoto(object) {
  const id = object.key.slice("photos/".length);
  return {
    id, name: object.customMetadata.name, day: object.customMetadata.day,
    tags: JSON.parse(object.customMetadata.tags), uploaded: object.uploaded.toISOString(),
    status: "visible", mediaKey: id, legacy: true
  };
}

function statePhoto(object) {
  return { ...JSON.parse(object.customMetadata.photo), revision: object.etag };
}

async function findPhoto(bucket, id) {
  const state = await bucket.head(stateKey(id));
  if (state) return statePhoto(state);
  if (samples.has(id)) return { ...samples.get(id), revision: "original" };
  const original = await bucket.head("photos/" + id);
  return original ? { ...legacyPhoto(original), revision: "original" } : null;
}

async function list(bucket, prefix) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, include: ["customMetadata"] });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

function photoInfo(photo, admin = false) {
  const { id, name, day, tags, alt, revision, status, reportedAt, reportReason } = photo;
  return {
    id, name, day, tags, alt, revision, static: !photo.mediaKey,
    ...(admin ? { status, reportedAt, reportReason } : {})
  };
}

export async function listPhotos(bucket, admin = false) {
  const [originals, states] = await Promise.all([list(bucket, "photos/"), list(bucket, "catalog/")]);
  const photos = new Map([...samples].map(([id, photo]) => [id, { ...photo, revision: "original" }]));
  for (const object of originals) {
    const photo = legacyPhoto(object);
    photos.set(photo.id, { ...photo, revision: "original" });
  }
  for (const object of states) {
    const photo = statePhoto(object);
    photos.set(photo.id, photo);
  }
  return [...photos.values()]
    .filter(photo => photo.status === "visible" || (admin && photo.status === "reported"))
    .sort((a, b) => b.uploaded.localeCompare(a.uploaded))
    .map(photo => photoInfo(photo, admin));
}

async function saveState(bucket, photo, revision) {
  const { revision: ignored, ...data } = photo;
  const condition = revision === "original" || !revision ? { etagDoesNotMatch: "*" } : { etagMatches: revision };
  const saved = await bucket.put(stateKey(photo.id), crypto.randomUUID(), {
    onlyIf: condition, customMetadata: { photo: JSON.stringify(data) }
  });
  return saved ? statePhoto(saved) : null;
}

function mediaKeys(photo) {
  return photo.legacy
    ? ["photos/" + photo.mediaKey, "previews/" + photo.mediaKey]
    : ["media/" + photo.mediaKey, "thumbnails/" + photo.mediaKey];
}

async function deleteMedia(bucket, photo) {
  if (photo.mediaKey) await bucket.delete(mediaKeys(photo));
}

async function discardMedia(bucket, photo) {
  try {
    await deleteMedia(bucket, photo);
  } catch (error) {
    console.error("Could not clean up old photo media", error);
  }
}

async function imageType(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const matches = (offset, signature) => signature.every((byte, index) => bytes[offset + index] === byte);
  if (matches(0, [0xff, 0xd8, 0xff])) return ["image/jpeg", "jpg"];
  if (matches(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ["image/png", "png"];
  if (matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80])) return ["image/webp", "webp"];
  return null;
}

function metadata(body) {
  const day = body.get("day");
  if (!days.includes(day)) throw new PhotoError(400, "Wähle Freitag, Samstag oder Sonntag.");
  let values;
  try {
    values = JSON.parse(body.get("tags"));
  } catch {
    throw new PhotoError(400, "Prüfe die Kategorien für dieses Foto.");
  }
  if (!Array.isArray(values) || values.length > 8) throw new PhotoError(400, "Wähle höchstens acht Kategorien.");
  const tags = new Map();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim() || value.length > 32 || /[\x00-\x1f\x7f]/.test(value)) {
      throw new PhotoError(400, "Prüfe die Kategorien für dieses Foto.");
    }
    const tag = value.trim().replace(/\s+/g, " ").normalize("NFC");
    if (days.some(item => item.toLowerCase() === tag.toLowerCase())) {
      throw new PhotoError(400, "Wochentage werden im eigenen Feld ausgewählt.");
    }
    tags.set(tag.toLocaleLowerCase("de"), tag);
  }
  return { day, tags: [...tags.values()] };
}

async function formData(request) {
  if (Number(request.headers.get("Content-Length")) > maxImageBytes + maxPreviewBytes + 65536) {
    throw new PhotoError(413, "Dieses Foto ist zu groß.");
  }
  try {
    return await request.formData();
  } catch {
    throw new PhotoError(400, "Die Fotodaten konnten nicht gelesen werden.");
  }
}

async function saveMedia(bucket, id, body) {
  const file = body.get("image");
  const preview = body.get("preview");
  if (!(file instanceof File) || !file.size || file.size > maxImageBytes) {
    throw new PhotoError(400, "Wähle ein Foto bis 20 MB.");
  }
  if (!(preview instanceof File) || !preview.size || preview.size > maxPreviewBytes) {
    throw new PhotoError(400, "Die Vorschau ist ungültig.");
  }
  const [originalType, previewType] = await Promise.all([imageType(file), imageType(preview)]);
  if (!originalType || !previewType) throw new PhotoError(415, "Erlaubt sind JPG, PNG und WebP.");
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[\\/:\x00-\x1f\x7f]/g, "_").trim();
  const photo = {
    mediaKey: id + "/" + crypto.randomUUID(), legacy: false, alt: undefined,
    name: (Array.from(base).slice(0, 80).join("") || "Foto") + "." + originalType[1]
  };
  const [originalKey, previewKey] = mediaKeys(photo);
  try {
    await bucket.put(originalKey, file, { httpMetadata: { contentType: originalType[0] } });
    await bucket.put(previewKey, preview, { httpMetadata: { contentType: previewType[0] } });
  } catch (error) {
    await discardMedia(bucket, photo);
    throw error;
  }
  return photo;
}

export async function createPhoto(request, bucket, id) {
  const existing = await findPhoto(bucket, id);
  if (existing?.status === "visible") return { photo: photoInfo(existing), created: false };
  if (existing) throw conflict();
  const body = await formData(request);
  const details = metadata(body);
  const media = await saveMedia(bucket, id, body);
  const saved = await saveState(bucket, {
    id, ...details, ...media, status: "visible", uploaded: new Date().toISOString()
  });
  if (saved) return { photo: photoInfo(saved), created: true };
  await discardMedia(bucket, media);
  const current = await findPhoto(bucket, id);
  if (current?.status === "visible") return { photo: photoInfo(current), created: false };
  throw conflict();
}

export async function reportPhoto(bucket, id, reason, limit, address) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const photo = await findPhoto(bucket, id);
    if (photo?.status === "reported") return;
    if (photo?.status !== "visible") throw missing();
    if (attempt === 0 && !(await limit.limit({ key: address })).success) {
      throw new PhotoError(429, "Du hast gerade mehrere Fotos gemeldet. Warte kurz und versuche es erneut.");
    }
    const saved = await saveState(bucket, {
      ...photo, status: "reported", reportedAt: new Date().toISOString(), reportReason: reason
    }, photo.revision);
    if (saved) return;
  }
  throw conflict();
}

export async function updatePhoto(request, bucket, id) {
  const current = await findPhoto(bucket, id);
  if (!current || current.status === "deleted") throw missing();
  const body = await formData(request);
  if (body.get("revision") !== current.revision) throw conflict();
  const details = metadata(body);
  const replacement = body.has("image") ? await saveMedia(bucket, id, body) : null;
  const saved = await saveState(bucket, { ...current, ...details, ...replacement }, current.revision);
  if (!saved) {
    if (replacement) await discardMedia(bucket, replacement);
    throw conflict();
  }
  if (replacement) await discardMedia(bucket, current);
  return photoInfo(saved, true);
}

export async function dismissReport(bucket, id, revision) {
  const photo = await findPhoto(bucket, id);
  if (!photo || photo.status === "deleted") throw missing();
  if (photo.revision !== revision || photo.status !== "reported") throw conflict();
  const saved = await saveState(bucket, {
    ...photo, status: "visible", reportedAt: undefined, reportReason: undefined
  }, revision);
  if (!saved) throw conflict();
}

export async function deletePhoto(bucket, id, revision) {
  const photo = await findPhoto(bucket, id);
  if (!photo) throw missing();
  if (photo.status === "deleted") {
    await deleteMedia(bucket, photo);
    return;
  }
  if (photo.revision !== revision) throw conflict();
  const { mediaKey, legacy } = photo;
  const saved = await saveState(bucket, { id, status: "deleted", mediaKey, legacy }, revision);
  if (!saved) throw conflict();
  await deleteMedia(bucket, saved);
}

export async function servePhoto(bucket, id, url, admin = false) {
  const photo = await findPhoto(bucket, id);
  if (!photo?.mediaKey || photo.status === "deleted" || (!admin && photo.status !== "visible")) throw missing();
  const preview = url.searchParams.has("preview");
  const object = await bucket.get(mediaKeys(photo)[Number(preview)]);
  if (!object) throw missing();
  const headers = new Headers({
    "Content-Type": object.httpMetadata.contentType,
    "Content-Length": String(object.size),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store"
  });
  if (url.searchParams.has("download") && !preview) {
    const name = encodeURIComponent(photo.name).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16));
    headers.set("Content-Disposition", "attachment; filename*=UTF-8''" + name);
  }
  return new Response(object.body, { headers });
}
