import { defaultTags, samplePhotos } from "./config.js";
import { $, catalogChannel, chip, days, element, endpoint, icon, modeQuery, renderDayToggle, request, tagKey } from "./client.mjs";
import { reportReasonLabel } from "./upload/report-reasons.mjs";

const samples = new Map(samplePhotos.map(photo => [photo.id, photo]));
const maxPhotoSize = 20 * 1024 * 1024;
const maxTags = 8;
const uploadTags = new Set();
const newTags = new Set();
const editTags = new Set();
const queuedFiles = [];
const sessionKey = "fotobox-admin:" + location.pathname + ":" + endpoint;
const today = new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "Europe/Berlin" }).format();
let uploadDay = days.includes(today) ? today : days[0];
let uploadToken = readSession();
let adminView = ["upload", "reported", "all"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "upload";
let adminPhotos = [];
let adminLoaded = false;
let adminListRequest = 0;
let editPhoto;
let editImageURL;
let editImageRequest;
let uploading = false;
const adminSelection = new Set();
const previewURLs = new Set();
const previewPhotos = new WeakMap();
let previewRequests = new AbortController();
const previewObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    previewObserver.unobserve(entry.target);
    loadAdminPreview(entry.target, previewPhotos.get(entry.target));
  }
}, { rootMargin: "120px" });

function uploadFeedback(message, isError = false) {
  const feedback = $("upload-feedback");
  feedback.textContent = message;
  feedback.hidden = !message;
  feedback.classList.toggle("error", isError);
}

function readSession() {
  try {
    const token = sessionStorage.getItem(sessionKey);
    if (Number(token?.split(".")[0]) * 1000 > Date.now()) return token;
    sessionStorage.removeItem(sessionKey);
  } catch {
    // The upload remains usable when browser storage is unavailable.
  }
  return "";
}

function saveSession(token) {
  uploadToken = token;
  try {
    if (token) sessionStorage.setItem(sessionKey, token);
    else sessionStorage.removeItem(sessionKey);
  } catch {
    // Keep the current session in memory if storage is unavailable.
  }
}

function showAdminSession() {
  $("unlock-form").hidden = true;
  $("admin-nav").hidden = false;
  $("sign-out").hidden = false;
  showAdminView(adminView);
  loadAdminPhotos();
}

async function unlock(event) {
  event.preventDefault();
  const form = $("unlock-form");
  const input = $("password");
  const button = form.querySelector("button");
  const candidate = input.value;
  button.disabled = true;
  uploadFeedback("");
  try {
    const { token } = await request("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: candidate })
    });
    if (input.value !== candidate) return;
    saveSession(token);
    form.reset();
    showAdminSession();
    if (adminView === "upload") (queuedFiles.length ? $("publish-photos") : $("upload-files")).focus();
  } catch (error) {
    if (input.value === candidate) {
      uploadFeedback(error.message, true);
      input.select();
    }
  } finally {
    button.disabled = false;
  }
}

function tagChoices(selected) {
  const labels = new Map();
  for (const category of [...defaultTags, ...adminPhotos.flatMap(photo => photo.tags), ...selected, ...newTags]) {
    if (!labels.has(tagKey(category))) labels.set(tagKey(category), category);
  }
  return [...labels.values()].sort((a, b) => a.localeCompare(b, "de"));
}

function renderTagPicker(container, selected) {
  $(container).replaceChildren(...tagChoices(selected).map(tag => {
    const selectedLabel = () => [...selected].find(value => tagKey(value) === tagKey(tag));
    return chip(tag, Boolean(selectedLabel()), button => {
      const existing = selectedLabel();
      if (existing) selected.delete(existing);
      else if (selected.size < maxTags) selected.add(tag);
      else {
        uploadFeedback("Wähle höchstens " + maxTags + " Kategorien pro Foto.", true);
        return;
      }
      button.setAttribute("aria-pressed", String(Boolean(selectedLabel())));
      uploadFeedback("");
    });
  }));
}

function addTag(input, selected, container) {
  const tag = input.value.trim().replace(/\s+/g, " ").normalize("NFC");
  if (!tag) return;
  if (days.some(day => tagKey(day) === tagKey(tag))) {
    uploadFeedback("Wochentage wählst du im eigenen Feld aus.", true);
    return;
  }
  if (![...selected].some(value => tagKey(value) === tagKey(tag))) {
    if (selected.size >= maxTags) {
      uploadFeedback("Wähle höchstens " + maxTags + " Kategorien pro Foto.", true);
      return;
    }
    const known = tagChoices(selected).find(value => tagKey(value) === tagKey(tag));
    if (!known) newTags.add(tag);
    selected.add(known || tag);
  }
  input.value = "";
  renderTagPicker(container, selected);
  uploadFeedback("");
  input.focus();
}

function requireAdminLogin() {
  saveSession("");
  adminListRequest++;
  clearEditor();
  clearAdminPreviews();
  $("admin-list").replaceChildren();
  $("sign-out").hidden = true;
  $("admin-nav").hidden = true;
  $("upload-form").hidden = true;
  $("admin-library").hidden = true;
  $("edit-photo-form").hidden = true;
  $("unlock-form").hidden = false;
  $("password").focus();
}

async function adminRequest(path, options = {}, parse) {
  const headers = { ...options.headers, Authorization: "Bearer " + uploadToken };
  return request(path, { ...options, headers }, parse);
}

function clearEditor() {
  editImageRequest?.abort();
  editImageRequest = undefined;
  if (editImageURL) URL.revokeObjectURL(editImageURL);
  editImageURL = undefined;
  $("edit-image").removeAttribute("src");
  $("edit-image").hidden = true;
  $("edit-photo-form").reset();
  $("confirm-delete-photo").hidden = true;
  editTags.clear();
  editPhoto = undefined;
}

function showAdminView(view) {
  if (uploading) return;
  if (adminView !== view) adminSelection.clear();
  adminView = view;
  history.replaceState(null, "", "#" + view);
  clearEditor();
  for (const button of $("admin-nav").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.adminView === view));
  }
  $("edit-photo-form").hidden = true;
  $("upload-form").hidden = view !== "upload";
  $("admin-library").hidden = view === "upload";
  uploadFeedback("");
  if (view === "upload") {
    clearAdminPreviews();
    $("admin-list").replaceChildren();
    renderTagPicker("upload-tags", uploadTags);
  } else {
    renderAdminLibrary();
  }
}

function clearAdminPreviews() {
  previewObserver.disconnect();
  previewRequests.abort();
  previewRequests = new AbortController();
  for (const url of previewURLs) URL.revokeObjectURL(url);
  previewURLs.clear();
}

async function loadAdminPreview(image, photo) {
  const signal = previewRequests.signal;
  try {
    const blob = await adminRequest("/admin/photos/" + encodeURIComponent(photo.id) + "/image?preview=1",
      { signal }, response => response.blob());
    if (signal.aborted) return;
    const url = URL.createObjectURL(blob);
    previewURLs.add(url);
    image.src = url;
  } catch {
    if (!signal.aborted) image.alt = "Vorschau nicht verfügbar";
  }
}

function renderAdminSelection() {
  $("admin-batch").hidden = adminSelection.size === 0;
  $("admin-selection-count").textContent = adminSelection.size + (adminSelection.size === 1 ? " Foto gewählt" : " Fotos gewählt");
}

function renderAdminLibrary() {
  clearAdminPreviews();
  const shown = adminView === "reported" ? adminPhotos.filter(photo => photo.status === "reported") : adminPhotos;
  const ids = new Set(shown.map(photo => photo.id));
  for (const id of adminSelection) if (!ids.has(id)) adminSelection.delete(id);
  renderAdminSelection();
  $("admin-list-status").textContent = !adminLoaded ? "Fotos werden geladen …"
    : shown.length ? shown.length + (shown.length === 1 ? " Foto" : " Fotos")
    : adminView === "reported" ? "Keine offenen Meldungen." : "Noch keine Fotos.";
  $("admin-list").replaceChildren(...shown.map(photo => {
    const row = element("li", "admin-photo-card");
    row.dataset.day = photo.day;
    if (adminView === "all" && photo.status === "reported") row.classList.add("is-reported");
    const open = element("button", "admin-photo-open");
    open.type = "button";
    open.setAttribute("aria-label", "Foto bearbeiten: " + (photo.alt || photo.name));
    const image = element("img");
    image.alt = photo.alt || photo.name;
    image.loading = "lazy";
    if (photo.static) {
      image.src = samples.get(photo.id).thumbnail;
    } else if (photo.status === "reported") {
      previewPhotos.set(image, photo);
      previewObserver.observe(image);
    } else {
      image.src = endpoint + "/photos/" + encodeURIComponent(photo.id) + "?preview=1&v=" + encodeURIComponent(photo.revision);
    }
    open.append(image);
    open.addEventListener("click", () => openEditor(photo));
    if (adminView === "reported") {
      row.append(open);
      return row;
    }
    const select = element("button", "select-photo");
    select.type = "button";
    select.setAttribute("aria-label", "Foto auswählen: " + (photo.alt || photo.name));
    select.append(icon("check"));
    const markSelection = () => {
      const checked = adminSelection.has(photo.id);
      select.setAttribute("aria-pressed", String(checked));
      row.classList.toggle("is-selected", checked);
    };
    markSelection();
    select.addEventListener("click", () => {
      if (adminSelection.has(photo.id)) adminSelection.delete(photo.id);
      else adminSelection.add(photo.id);
      markSelection();
      renderAdminSelection();
    });
    const info = element("div", "admin-photo-info");
    const label = element("span", "photo-tag day", photo.day);
    label.dataset.day = photo.day;
    info.append(label);
    if (photo.status === "reported") info.append(element("span", "admin-report-badge", "Gemeldet"));
    row.append(open, select, info);
    return row;
  }));
}

async function loadAdminPhotos() {
  if (!uploadToken) return;
  const version = ++adminListRequest;
  try {
    const { photos: entries } = await adminRequest("/admin/photos", { cache: "no-store" });
    if (version !== adminListRequest) return;
    const changed = !adminLoaded || JSON.stringify(entries) !== JSON.stringify(adminPhotos);
    adminPhotos = entries;
    adminLoaded = true;
    $("retry-admin-list").hidden = true;
    const count = entries.filter(photo => photo.status === "reported").length;
    $("admin-nav").querySelector('[data-admin-view="reported"]').textContent = "Gemeldet (" + count + ")";
    if (changed && !uploading) {
      if (adminView === "upload") renderTagPicker("upload-tags", uploadTags);
      else if (!editPhoto) renderAdminLibrary();
    }
  } catch (error) {
    if (version !== adminListRequest || uploading) return;
    if (error.status === 401) {
      requireAdminLogin();
      uploadFeedback(error.message, true);
    } else if (adminView !== "upload") {
      $("admin-list-status").textContent = error.message;
      $("retry-admin-list").hidden = false;
    }
  }
}

async function openEditor(photo) {
  clearEditor();
  editPhoto = photo;
  for (const tag of photo.tags) editTags.add(tag);
  const reported = photo.status === "reported";
  $("edit-name").textContent = photo.name;
  $("edit-name").hidden = reported;
  $("edit-day").value = photo.day;
  $("edit-report").hidden = !reported;
  $("edit-report-reason").textContent = reportReasonLabel(photo.reportReason);
  $("dismiss-report").hidden = !reported;
  $("admin-library").hidden = true;
  $("edit-photo-form").hidden = false;
  renderTagPicker("edit-tags", editTags);
  $("admin-back").focus();
  uploadFeedback("");

  const image = $("edit-image");
  image.alt = photo.alt || photo.name;
  image.hidden = false;
  if (photo.static) {
    const sample = samples.get(photo.id);
    if (sample) {
      image.src = sample.thumbnail;
    }
    return;
  }
  const controller = new AbortController();
  editImageRequest = controller;
  try {
    const blob = await adminRequest("/admin/photos/" + encodeURIComponent(photo.id) + "/image?preview=1",
      { signal: controller.signal }, response => response.blob());
    if (controller.signal.aborted) return;
    editImageURL = URL.createObjectURL(blob);
    image.src = editImageURL;
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error.status === 401) requireAdminLogin();
    uploadFeedback(error.message, true);
  }
}

async function mutatePhoto(action) {
  if (uploading || !editPhoto) return;
  const photo = editPhoto;
  const path = "/admin/photos/" + encodeURIComponent(photo.id);
  const form = $("edit-photo-form");
  const headers = { "If-Match": photo.revision };
  uploading = true;
  form.inert = true;
  $("admin-nav").inert = true;
  uploadFeedback("");
  let success;
  let failure;
  try {
    if (action === "save") {
      const body = new FormData();
      body.set("revision", photo.revision);
      body.set("day", $("edit-day").value);
      body.set("tags", JSON.stringify([...editTags]));
      const file = $("edit-replacement").files[0];
      if (file) {
        if (!validUpload(file)) throw new Error("Wähle JPG, PNG oder WebP bis 20 MB.");
        body.set("image", file);
        body.set("preview", await createPreview(file), "preview");
      }
      await adminRequest(path, { method: "PUT", body });
      success = "Änderungen gespeichert.";
    } else if (action === "dismiss") {
      await adminRequest(path + "/dismiss", { method: "POST", headers });
      success = "Das Foto ist wieder in der Galerie sichtbar.";
    } else {
      await adminRequest(path, { method: "DELETE", headers });
      success = "Foto gelöscht.";
    }
  } catch (error) {
    failure = error;
  } finally {
    uploading = false;
    form.inert = false;
    $("admin-nav").inert = false;
  }
  if (success || failure?.status === 409 || failure?.status === 404) {
    showAdminView(adminView);
    loadAdminPhotos();
    if (success) catalogChannel?.postMessage("catalog");
  } else if (failure?.status === 401) {
    requireAdminLogin();
  }
  uploadFeedback(success || failure.message, Boolean(failure));
}

function renderQueue() {
  $("upload-list").hidden = !queuedFiles.length;
  $("upload-list").replaceChildren(...queuedFiles.map(item => {
    const row = element("li", "", item.file.name);
    const remove = element("button", "text-button", "Entfernen");
    remove.type = "button";
    remove.setAttribute("aria-label", item.file.name + " entfernen");
    remove.addEventListener("click", () => {
      queuedFiles.splice(queuedFiles.indexOf(item), 1);
      renderQueue();
      $("upload-files").focus();
    });
    row.append(remove);
    return row;
  }));
}

function validUpload(file) {
  return file.size > 0 && file.size <= maxPhotoSize && /\.(jpe?g|png|webp)$/i.test(file.name);
}

function queueFiles() {
  const input = $("upload-files");
  const rejected = [];
  for (const file of input.files) {
    if (!validUpload(file)) {
      rejected.push(file.name);
      continue;
    }
    if (!queuedFiles.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) {
      queuedFiles.push({ id: crypto.randomUUID(), file });
    }
  }
  input.value = "";
  renderQueue();
  uploadFeedback(rejected.length ? "Bitte wähle JPG, PNG oder WebP bis 20 MB. Übersprungen: " + rejected.join(", ") : "", rejected.length > 0);
}

async function createPreview(file) {
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 960 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Vorschau konnte nicht erstellt werden.")), "image/webp", .76);
    });
  } finally {
    image.close();
  }
}

async function publish(event) {
  event.preventDefault();
  if (uploading || !uploadToken) return;
  if (!queuedFiles.length) {
    uploadFeedback("Wähle zuerst mindestens ein Foto aus.", true);
    $("upload-files").focus();
    return;
  }
  const day = uploadDay;
  const tags = [...uploadTags];
  const batch = [...queuedFiles];
  const failures = [];
  let sessionExpired = false;
  const form = $("upload-form");
  const button = $("publish-photos");
  uploading = true;
  form.inert = true;
  button.disabled = true;
  $("admin-nav").inert = true;
  try {
    for (const [index, item] of batch.entries()) {
      uploadFeedback("Foto " + (index + 1) + " von " + batch.length + " wird hochgeladen …");
      try {
        const body = new FormData();
        body.set("image", item.file);
        body.set("preview", await createPreview(item.file), "preview");
        body.set("day", day);
        body.set("tags", JSON.stringify(tags));
        await adminRequest("/photos/" + item.id, { method: "PUT", body });
        queuedFiles.splice(queuedFiles.indexOf(item), 1);
      } catch (error) {
        if (error.status === 401) {
          sessionExpired = true;
          break;
        }
        failures.push(item.file.name + " – " + error.message);
      }
    }
    const published = batch.length - queuedFiles.length;
    renderQueue();
    if (published) {
      catalogChannel?.postMessage("catalog");
      loadAdminPhotos();
    }
    if (sessionExpired) {
      requireAdminLogin();
      uploadFeedback(published + " von " + batch.length + " veröffentlicht. Melde dich erneut an, um die übrigen Fotos hochzuladen.", true);
    } else if (failures.length) {
      uploadFeedback(published + " von " + batch.length + " veröffentlicht. " + failures.join(" · "), true);
    } else {
      uploadFeedback(batch.length === 1 ? "Dein Foto wurde veröffentlicht." : batch.length + " Fotos wurden veröffentlicht.");
    }
  } finally {
    uploading = false;
    form.inert = false;
    button.disabled = false;
    $("admin-nav").inert = false;
    if (!sessionExpired) button.focus();
  }
}

$("unlock-form").addEventListener("submit", unlock);
$("upload-form").addEventListener("submit", publish);
$("upload-files").addEventListener("change", queueFiles);
for (const [buttonId, inputId, selected, container] of [
  ["add-tag", "new-tag", uploadTags, "upload-tags"],
  ["add-edit-tag", "edit-new-tag", editTags, "edit-tags"]
]) {
  const input = $(inputId);
  const add = () => addTag(input, selected, container);
  $(buttonId).addEventListener("click", add);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  });
}

for (const button of $("admin-nav").querySelectorAll("button")) {
  button.addEventListener("click", () => showAdminView(button.dataset.adminView));
}
$("retry-admin-list").addEventListener("click", loadAdminPhotos);
$("admin-back").addEventListener("click", () => showAdminView(adminView));
$("edit-photo-form").addEventListener("submit", event => {
  event.preventDefault();
  mutatePhoto("save");
});
$("dismiss-report").addEventListener("click", () => mutatePhoto("dismiss"));
$("ask-delete-photo").addEventListener("click", () => {
  $("static-delete-note").hidden = !editPhoto.static;
  $("confirm-delete-photo").hidden = false;
  $("cancel-delete-photo").focus();
});
$("cancel-delete-photo").addEventListener("click", () => {
  $("confirm-delete-photo").hidden = true;
  $("ask-delete-photo").focus();
});
$("delete-photo").addEventListener("click", () => mutatePhoto("delete"));


let batchAction;
let batchPhotos = [];

function renderBatchCategories() {
  const select = $("batch-category");
  const add = $("batch-operation").value === "add";
  const prior = select.value;
  const categories = add
    ? tagChoices(new Set())
    : [...new Map(batchPhotos.flatMap(photo => photo.tags).map(tag => [tagKey(tag), tag])).values()]
      .sort((a, b) => a.localeCompare(b, "de"));
  select.replaceChildren(...categories.map(label => new Option(label, label)));
  if (add) select.append(new Option("Neue Kategorie …", ""));
  else if (!categories.length) select.append(new Option("Keine Kategorien vorhanden", ""));
  if ([...select.options].some(option => option.value === prior)) select.value = prior;
  toggleBatchNewCategory();
}

function toggleBatchNewCategory() {
  const create = $("batch-operation").value === "add" && !$("batch-category").value;
  $("batch-new-row").hidden = !create;
  $("batch-new-category").required = create && batchAction === "categories";
}

function openBatch(action) {
  if (!adminSelection.size) return;
  batchAction = action;
  batchPhotos = adminPhotos.filter(photo => adminSelection.has(photo.id));
  const deleting = action === "delete";
  $("batch-form").reset();
  $("batch-title").textContent = deleting ? "Auswahl löschen" : "Kategorien ändern";
  $("batch-summary").textContent = deleting
    ? batchPhotos.length + " ausgewählte Fotos wirklich löschen?" + (batchPhotos.some(photo => photo.static)
      ? " Statische Testfotos verschwinden aus der Galerie. Die Dateien bleiben im GitHub-Repository." : "")
    : "Die Änderung gilt für die " + batchPhotos.length + " ausgewählten Fotos.";
  $("batch-category-fields").hidden = deleting;
  $("batch-category-fields").disabled = deleting;
  $("batch-error").hidden = true;
  $("confirm-batch").textContent = deleting ? "Endgültig löschen" : "Anwenden";
  $("confirm-batch").classList.toggle("danger-button", deleting);
  if (!deleting) renderBatchCategories();
  $("batch-dialog").showModal();
}

async function applyBatch(event) {
  event.preventDefault();
  if (uploading) return;
  const selected = batchPhotos;
  const deleting = batchAction === "delete";
  const remove = $("batch-operation").value === "remove";
  const choice = $("batch-category").value;
  const category = (!remove && !choice ? $("batch-new-category").value : choice)
    .trim().replace(/\s+/g, " ").normalize("NFC");
  if (!deleting && (!category || days.some(day => tagKey(day) === tagKey(category)))) {
    $("batch-error").textContent = "Wähle eine Kategorie oder gib einen gültigen Namen ein.";
    $("batch-error").hidden = false;
    return;
  }
  if (!selected.length) {
    $("batch-dialog").close();
    return;
  }

  uploading = true;
  $("batch-form").inert = true;
  $("close-batch").disabled = true;
  $("batch-error").hidden = true;
  const failed = [];
  let completed = 0;
  let expired = false;
  for (const photo of selected) {
    try {
      const path = "/admin/photos/" + encodeURIComponent(photo.id);
      if (deleting) {
        await adminRequest(path, { method: "DELETE", headers: { "If-Match": photo.revision } });
      } else {
        const tags = photo.tags.filter(tag => tagKey(tag) !== tagKey(category));
        if (!remove) tags.push(photo.tags.find(tag => tagKey(tag) === tagKey(category)) || category);
        if (tags.length > maxTags) throw new Error("höchstens acht Kategorien");
        if (JSON.stringify(tags) !== JSON.stringify(photo.tags)) {
          const body = new FormData();
          body.set("revision", photo.revision);
          body.set("day", photo.day);
          body.set("tags", JSON.stringify(tags));
          await adminRequest(path, { method: "PUT", body });
        }
      }
      adminSelection.delete(photo.id);
      completed++;
    } catch (error) {
      if (error.status === 401) {
        expired = true;
        break;
      }
      failed.push(photo.name + " · " + error.message);
    }
  }
  uploading = false;
  $("batch-form").inert = false;
  $("close-batch").disabled = false;
  $("batch-dialog").close();
  if (completed) catalogChannel?.postMessage("catalog");
  if (expired) requireAdminLogin();
  else {
    renderAdminLibrary();
    loadAdminPhotos();
  }
  const message = completed + " von " + selected.length + (deleting ? " Fotos gelöscht." : " Fotos bearbeitet.");
  uploadFeedback(message + (expired ? " Bitte melde dich erneut an." : failed.length ? " " + failed.join(" · ") : ""), expired || Boolean(failed.length));
}

$("brand-gallery").href = "./" + modeQuery;
$("back-gallery").href = "./" + modeQuery;
$("sign-out").addEventListener("click", () => {
  if (uploading) return;
  adminSelection.clear();
  adminPhotos = [];
  adminLoaded = false;
  queuedFiles.length = 0;
  uploadTags.clear();
  newTags.clear();
  $("upload-form").reset();
  renderQueue();
  requireAdminLogin();
  uploadFeedback("Abgemeldet.");
});
renderDayToggle($("upload-days"), uploadDay, day => { uploadDay = day; });
$("clear-admin-selection").addEventListener("click", () => {
  adminSelection.clear();
  renderAdminLibrary();
});
$("open-batch-categories").addEventListener("click", () => openBatch("categories"));
$("open-batch-delete").addEventListener("click", () => openBatch("delete"));
$("batch-operation").addEventListener("change", renderBatchCategories);
$("batch-category").addEventListener("change", toggleBatchNewCategory);
$("batch-form").addEventListener("submit", applyBatch);
$("close-batch").addEventListener("click", () => $("batch-dialog").close());
$("batch-dialog").addEventListener("cancel", event => {
  if (uploading) event.preventDefault();
});

if (!endpoint) {
  $("upload-unavailable").hidden = false;
} else {
  if (uploadToken) showAdminSession();
  else $("unlock-form").hidden = false;
  catalogChannel?.addEventListener("message", loadAdminPhotos);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadAdminPhotos(); });
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    const stored = readSession();
    if (stored === uploadToken) loadAdminPhotos();
    else if (stored) {
      uploadToken = stored;
      showAdminSession();
    } else {
      requireAdminLogin();
    }
  });
  setInterval(() => { if (!document.hidden) loadAdminPhotos(); }, 12_000);
}
