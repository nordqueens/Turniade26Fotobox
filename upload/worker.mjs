import { checkUploadPassword, checkUploadToken, issueUploadToken, readUploadSecret } from "./auth.mjs";

import { createPhoto, deletePhoto, dismissReport, listPhotos, PhotoError, reportPhoto, servePhoto, updatePhoto } from "./photos.mjs";

import { reportReasons } from "./report-reasons.mjs";

const uploadId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const photoId = id => uploadId.test(id) || /^probe-[0-9]+$/.test(id);

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function error(message, status) {
  return json({ message }, status);
}

async function authenticate(request, env, secret) {
  const address = request.headers.get("CF-Connecting-IP") || "local";
  const { success } = await env.UPLOAD_LOGIN_LIMIT.limit({ key: address });
  if (!success) return error("Zu viele Anmeldeversuche. Warte kurz und versuche es erneut.", 429);
  if (Number(request.headers.get("Content-Length")) > 4096) return error("Ungültige Anmeldedaten.", 400);

  let credentials;
  try {
    credentials = await request.json();
  } catch {
    return error("Ungültige Anmeldedaten.", 400);
  }
  if (!await checkUploadPassword(credentials?.password, secret)) {
    return error("Das Upload-Passwort stimmt nicht.", 401);
  }
  return json({ token: await issueUploadToken(secret) });
}

async function route(request, env, originAllowed) {
  const url = new URL(request.url);
  const [area, section, id, action, extra] = url.pathname.slice(1).split("/");
  const { method } = request;
  const bucket = env.PHOTOS;

  if (method === "OPTIONS") return new Response(null, { status: originAllowed ? 204 : 403 });
  if (method === "GET" && url.pathname === "/photos") return json({ photos: await listPhotos(bucket) });
  if (method === "GET" && area === "photos" && photoId(section) && !id) {
    return servePhoto(bucket, section, url);
  }
  if (!originAllowed && request.headers.has("Origin")) return error("Diese Website darf den Fotodienst nicht verwalten.", 403);

  if (method === "POST" && area === "reports" && photoId(section) && !id) {
    if (!readUploadSecret(env.UPLOAD_AUTH)) return error("Der Fotodienst ist noch nicht eingerichtet.", 503);
    const report = await request.json().catch(() => null);
    if (typeof report?.reason !== "string" || (report.reason !== "privacy" && !Object.hasOwn(reportReasons, report.reason))) {
      return error("Wähle bitte einen Grund für die Meldung.", 400);
    }
    await reportPhoto(bucket, section, report.reason, env.PHOTO_REPORT_LIMIT, request.headers.get("CF-Connecting-IP") || "local");
    return json({ ok: true });
  }

  const login = method === "POST" && url.pathname === "/auth";
  const upload = method === "PUT" && area === "photos" && uploadId.test(section) && !id;
  const admin = area === "admin" && section === "photos" && !extra;
  if (!login && !upload && !admin) return error("Diese Adresse gibt es nicht.", 404);
  const secret = readUploadSecret(env.UPLOAD_AUTH);
  if (!secret) return error("Der Admin-Bereich ist noch nicht eingerichtet.", 503);
  if (login) return authenticate(request, env, secret);
  if (!await checkUploadToken(request.headers.get("Authorization"), secret)) {
    return error("Bitte melde dich erneut an.", 401);
  }
  if (upload) {
    const { photo, created } = await createPhoto(request, bucket, section);
    return json({ photo }, created ? 201 : 200);
  }
  if (method === "GET" && !id) return json({ photos: await listPhotos(bucket, true) });
  if (!photoId(id)) return error("Diese Adresse gibt es nicht.", 404);
  if (method === "GET" && action === "image") return servePhoto(bucket, id, url, true);
  if (method === "PUT" && !action) return json({ photo: await updatePhoto(request, bucket, id) });
  const revision = request.headers.get("If-Match");
  if (method === "POST" && action === "dismiss") {
    await dismissReport(bucket, id, revision);
    return json({ ok: true });
  }
  if (method === "DELETE" && !action) {
    await deletePhoto(bucket, id, revision);
    return json({ ok: true });
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
      if (failure instanceof PhotoError) {
        response = error(failure.message, failure.status);
      } else {
        console.error(failure);
        response = error("Der Fotodienst hat gerade ein Problem. Versuche es noch einmal.", 500);
      }
    }
    const headers = new Headers(response.headers);
    headers.set("Vary", "Origin");
    if (originAllowed) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, If-Match");
      headers.set("Access-Control-Max-Age", "600");
    }
    return new Response(response.body, { status: response.status, headers });
  }
};
