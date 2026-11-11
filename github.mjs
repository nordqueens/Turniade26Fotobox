import { publishingBranch, repository, samplePhotos, passwordCheck } from "./config.js?v=github1";
import { reportReasons } from "./upload/report-reasons.mjs";

const api = "https://api.github.com/repos/" + repository;
const catalogFile = "Assets/Fotos/katalog.json";
const catalogURL = new URL(catalogFile, import.meta.url);
const encodePath = value => value.split("/").map(encodeURIComponent).join("/");
const branch = encodePath(publishingBranch);
const samples = new Map(samplePhotos.map(photo => [photo.id, { ...photo, revision: "original", static: true }]));
const reportPattern = /^\[Fotobox\] (probe-\d+|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}) ([a-z_]+)$/;
let publicReportCache;

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

async function github(path, { token, method = "GET", body, signal } = {}) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(api + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const message = response.status === 401 || (token && response.status === 403 && !response.headers.has("Retry-After"))
      ? "GitHub-Schlüssel prüfen. Er braucht Zugriff auf dieses Repository und die unten genannten Berechtigungen."
      : detail.message || "GitHub ist gerade nicht erreichbar.";
    throw failure(response.status, message);
  }
  return response.json();
}

function mergePhotos(catalog) {
  const photos = new Map(samples);
  for (const photo of catalog.photos) {
    if (photo.deleted) photos.delete(photo.id);
    else photos.set(photo.id, photo);
  }
  return photos;
}

async function readReports(token) {
  const reports = new Map();
  for (let page = 1; ; page++) {
    const issues = await github("/issues?state=open&per_page=100&page=" + page, { token });
    for (const issue of issues) {
      const match = !issue.pull_request && issue.title.match(reportPattern);
      if (!match || !Object.hasOwn(reportReasons, match[2])) continue;
      const [, id, reason] = match;
      const current = reports.get(id) || { reason, numbers: [] };
      current.numbers.push(issue.number);
      reports.set(id, current);
    }
    if (issues.length < 100) return reports;
  }
}

async function publicReports() {
  if (publicReportCache && Date.now() - publicReportCache.time < 90_000) return publicReportCache.reports;
  try {
    publicReportCache = { time: Date.now(), reports: await readReports() };
  } catch {
    publicReportCache = { time: Date.now(), reports: publicReportCache?.reports || new Map() };
  }
  return publicReportCache.reports;
}

async function branchSnapshot(token) {
  const { object } = await github("/git/ref/heads/" + branch, { token });
  const commit = await github("/git/commits/" + object.sha, { token });
  const file = await github("/contents/" + catalogFile + "?ref=" + object.sha, { token });
  const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, "")), value => value.charCodeAt(0));
  const catalog = JSON.parse(new TextDecoder().decode(bytes));
  return { commit, catalog };
}

export async function publicPhotos() {
  const [response, reports] = await Promise.all([fetch(catalogURL, { cache: "no-store" }), publicReports()]);
  if (!response.ok) throw failure(response.status, "Der Fotokatalog konnte nicht geladen werden.");
  const photos = [...mergePhotos(await response.json()).values()].filter(photo => !reports.has(photo.id));
  return { photos };
}

export async function adminPhotos(token) {
  const [{ catalog }, reports] = await Promise.all([branchSnapshot(token), readReports(token)]);
  return { photos: [...mergePhotos(catalog).values()].map(photo => {
    const report = reports.get(photo.id);
    return { ...photo, status: report ? "reported" : "visible", reportReason: report?.reason };
  }) };
}

export function reportLink(id, reason) {
  const query = new URLSearchParams({
    title: "[Fotobox] " + id + " " + reason,
    body: "Meldegrund: " + reportReasons[reason] + "\n\nBitte keine Namen oder persönlichen Daten hier eintragen."
  });
  return "https://github.com/" + repository + "/issues/new?" + query;
}

export async function checkPassword(password) {
  const [salt, expected] = passwordCheck.split(".");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bytes = new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", iterations: 100_000,
    salt: Uint8Array.from(salt.match(/../g), value => Number.parseInt(value, 16))
  }, key, 256));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("") === expected;
}

async function createBlob(file, token) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let content;
  if (bytes.toBase64) content = bytes.toBase64();
  else {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    content = btoa(binary);
  }
  const { sha } = await github("/git/blobs", { token, method: "POST", body: { content, encoding: "base64" } });
  return sha;
}

function treeFile(path, sha) {
  return { path, sha, mode: "100644", type: "blob" };
}

async function prepareMedia(id, form, token) {
  const original = form.get("image");
  const preview = form.get("preview");
  const extension = original.name.split(".").at(-1).toLowerCase();
  if (!["jpg", "jpeg", "png", "webp"].includes(extension) || !original.size || original.size > 20 * 1024 * 1024) {
    throw failure(400, "Wähle JPG, PNG oder WebP bis 20 MB.");
  }
  const previewExtension = preview.type === "image/webp" ? "webp" : "png";
  const version = crypto.randomUUID();
  const source = "Assets/Fotos/Originale/" + id + "-" + version + "." + extension;
  const thumbnail = "Assets/Fotos/Vorschau/" + id + "-" + version + "." + previewExtension;
  const sourceBlob = await createBlob(original, token);
  const previewBlob = await createBlob(preview, token);
  return {
    source, thumbnail, name: original.name, static: false, alt: undefined,
    files: [treeFile(source, sourceBlob), treeFile(thumbnail, previewBlob)]
  };
}

function originalPaths(photo) {
  return [...new Set([photo.source, photo.thumbnail])];
}

function revisionMatches(photo, revision) {
  if (!photo || photo.revision !== revision) throw failure(409, "Das Foto wurde inzwischen geändert. Lade die Übersicht neu.");
}

async function commitChanges(token, changes, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { commit, catalog } = await branchSnapshot(token);
    const photos = mergePhotos(catalog);
    const overrides = new Map(catalog.photos.map(photo => [photo.id, photo]));
    const files = [];
    for (const change of changes) {
      const previous = photos.get(change.id);
      if (change.kind === "create" && (previous || overrides.has(change.id))) continue;
      if (change.kind !== "create") revisionMatches(previous, change.revision);
      if (change.kind === "delete" || change.media) {
        if (previous) files.push(...originalPaths(previous).map(path => treeFile(path, null)));
      }
      if (change.kind === "delete") {
        overrides.set(change.id, { id: change.id, deleted: true });
      } else {
        const { files: addedFiles, ...media } = change.media || {};
        if (addedFiles) files.push(...addedFiles);
        overrides.set(change.id, {
          ...previous, ...media, id: change.id, day: change.day, tags: change.tags, revision: change.nextRevision
        });
      }
    }
    const content = JSON.stringify({ photos: [...overrides.values()] }, null, 2) + "\n";
    if (!files.length && content === JSON.stringify(catalog, null, 2) + "\n") return;
    const tree = await github("/git/trees", {
      token, method: "POST", body: { base_tree: commit.tree.sha, tree: [
        ...files, { path: catalogFile, mode: "100644", type: "blob", content }
      ] }
    });
    const next = await github("/git/commits", {
      token, method: "POST", body: { message, tree: tree.sha, parents: [commit.sha] }
    });
    try {
      await github("/git/refs/heads/" + branch, { token, method: "PATCH", body: { sha: next.sha, force: false } });
      return;
    } catch (error) {
      if (error.status !== 409 && error.status !== 422) throw error;
      const head = await github("/git/ref/heads/" + branch, { token });
      if (head.object.sha === next.sha) return;
      if (head.object.sha === commit.sha) throw error;
    }
  }
  throw failure(409, "Auf GitHub wurde gleichzeitig etwas geändert. Versuche es noch einmal.");
}

export async function publishPhotos(token, batch) {
  const changes = [];
  for (const { id, form } of batch) {
    changes.push({
      id, kind: "create", day: form.get("day"), tags: JSON.parse(form.get("tags")),
      nextRevision: crypto.randomUUID(), media: await prepareMedia(id, form, token)
    });
  }
  await commitChanges(token, changes, "Fotobox: Fotos hochladen");
}

export async function editPhotos(token, edits) {
  const changes = [];
  for (const { id, form, revision } of edits) {
    if (!form) changes.push({ id, kind: "delete", revision });
    else changes.push({
      id, kind: "edit", revision: form.get("revision"), day: form.get("day"),
      tags: JSON.parse(form.get("tags")), nextRevision: crypto.randomUUID(),
      media: form.has("image") ? await prepareMedia(id, form, token) : undefined
    });
  }
  await commitChanges(token, changes, "Fotobox: Fotos verwalten");
}

export async function dismissReports(token, id) {
  const reports = await readReports(token);
  for (const number of reports.get(id)?.numbers || []) {
    await github("/issues/" + number, { token, method: "PATCH", body: { state: "closed" } });
  }
}

export function adminPreview(photo) {
  return "https://raw.githubusercontent.com/" + repository + "/" + branch + "/" + encodePath(photo.thumbnail)
    + "?v=" + encodeURIComponent(photo.revision);
}
