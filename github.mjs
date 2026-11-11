import { publishingBranch, repository, samplePhotos, passwordCheck } from "./config.js?v=weekdays1";

const api = "https://api.github.com/repos/" + repository;
const catalogFile = "Assets/Fotos/katalog.json";
const catalogURL = new URL(catalogFile, import.meta.url);
const encodePath = value => value.split("/").map(encodeURIComponent).join("/");
const branch = encodePath(publishingBranch);
const samples = new Map(samplePhotos.map(photo => [photo.id, { ...photo, revision: "original", static: true }]));

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

function manualPhoto(path) {
  const match = /^Assets\/Fotos\/(Freitag|Samstag|Sonntag)\/(.+\.(?:jpe?g|png|webp))$/i.exec(path);
  if (!match) return null;
  const day = ["Freitag", "Samstag", "Sonntag"].find(value => value === match[1]);
  if (!day) return null;
  return {
    id: "file:" + path, name: path.split("/").at(-1), day,
    source: path, thumbnail: path, revision: "original"
  };
}

function withoutTags(photo) {
  const { tags: ignored, ...entry } = photo;
  return entry;
}

function mergePhotos(catalog, files) {
  const photos = new Map(samples);
  for (const path of files) {
    const photo = manualPhoto(path);
    if (photo) photos.set(photo.id, photo);
  }
  for (const photo of catalog.photos) {
    if (photo.deleted) photos.delete(photo.id);
    else if (!photo.id.startsWith("file:") || photos.has(photo.id) || photo.source !== photo.id.slice(5)) {
      photos.set(photo.id, withoutTags(photo));
    }
  }
  return photos;
}

async function branchSnapshot(token) {
  const { object } = await github("/git/ref/heads/" + branch, { token });
  const [commit, file] = await Promise.all([
    github("/git/commits/" + object.sha, { token }),
    github("/contents/" + catalogFile + "?ref=" + object.sha, { token })
  ]);
  const result = await github("/git/trees/" + commit.tree.sha + "?recursive=1", { token });
  if (result.truncated) throw failure(503, "Die Liste der Fotos konnte nicht vollständig geladen werden.");
  const files = result.tree.filter(entry => entry.type === "blob").map(entry => entry.path);
  const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, "")), value => value.charCodeAt(0));
  const catalog = JSON.parse(new TextDecoder().decode(bytes));
  return { commit, catalog, files };
}

export function photoURL(path) {
  return new URL(encodePath(path), import.meta.url).href;
}

export async function publicPhotos() {
  const [response, filesResponse] = await Promise.all([
    fetch(catalogURL, { cache: "no-store" }),
    fetch(new URL("Assets/Fotos/dateien.json", import.meta.url), { cache: "no-store" })
  ]);
  if (!response.ok) throw failure(response.status, "Der Fotokatalog konnte nicht geladen werden.");
  if (!filesResponse.ok) throw failure(filesResponse.status, "Die Fotoordner konnten nicht geladen werden.");
  const index = await filesResponse.text();
  // A plain local web server delivers the Jekyll source template.
  const files = index.startsWith("---") && ["127.0.0.1", "localhost"].includes(location.hostname)
    ? [] : JSON.parse(index);
  return { photos: [...mergePhotos(await response.json(), files).values()] };
}

export async function adminPhotos(token) {
  const { catalog, files } = await branchSnapshot(token);
  return { photos: [...mergePhotos(catalog, files).values()] };
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

async function prepareMedia(form, token) {
  const original = form.get("image");
  const preview = form.get("preview");
  const extension = original.name.split(".").at(-1).toLowerCase();
  if (!["jpg", "jpeg", "png", "webp"].includes(extension) || !original.size || original.size > 20 * 1024 * 1024) {
    throw failure(400, "Wähle JPG, PNG oder WebP bis 20 MB.");
  }
  const previewExtension = preview.type === "image/webp" ? "webp" : "png";
  const version = crypto.randomUUID();
  const source = "Assets/Fotos/Originale/" + version + "." + extension;
  const thumbnail = "Assets/Fotos/Vorschau/" + version + "." + previewExtension;
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
    const { commit, catalog, files: existingPaths } = await branchSnapshot(token);
    const photos = mergePhotos(catalog, existingPaths);
    const overrides = new Map(catalog.photos.map(photo => [photo.id, withoutTags(photo)]));
    const files = [];
    for (const change of changes) {
      const previous = photos.get(change.id);
      if (change.kind === "create" && (previous || overrides.has(change.id))) continue;
      if (change.kind !== "create") revisionMatches(previous, change.revision);
      if (change.kind === "delete" || change.media) {
        if (previous) files.push(...originalPaths(previous).filter(path => existingPaths.includes(path)).map(path => treeFile(path, null)));
      }
      if (change.kind === "delete") {
        if (change.id.startsWith("file:")) overrides.delete(change.id);
        else overrides.set(change.id, { id: change.id, deleted: true });
      } else {
        const { files: addedFiles, ...media } = change.media || {};
        if (addedFiles) files.push(...addedFiles);
        overrides.set(change.id, {
          ...previous, ...media, id: change.id, day: change.day, revision: change.nextRevision
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
      id, kind: "create", day: form.get("day"),
      nextRevision: crypto.randomUUID(), media: await prepareMedia(form, token)
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
      nextRevision: crypto.randomUUID(),
      media: form.has("image") ? await prepareMedia(form, token) : undefined
    });
  }
  await commitChanges(token, changes, "Fotobox: Fotos verwalten");
}

export function adminPreview(photo) {
  return "https://raw.githubusercontent.com/" + repository + "/" + branch + "/" + encodePath(photo.thumbnail)
    + "?v=" + encodeURIComponent(photo.revision);
}
