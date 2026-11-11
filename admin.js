import { defaultTags } from "./config.js?v=github1";
import { $, catalogChannel, chip, days, element, icon, renderDayToggle, tagKey } from "./client.mjs?v=github1";
import { adminPhotos as fetchAdminPhotos, adminPreview, checkPassword, dismissReports, editPhotos, publishPhotos } from "./github.mjs?v=github1";
import { reportReasonLabel } from "./upload/report-reasons.mjs";

const maxPhotoSize = 20 * 1024 * 1024;
const maxTags = 8;
const uploadTags = new Set();
const newTags = new Set();
const editTags = new Set();
const queuedFiles = [];
const sessionKey = "fotobox-github:" + location.pathname;
const today = new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "Europe/Berlin" }).format();
let uploadDay = days.includes(today) ? today : days[0];
let uploadToken = readSession();
let adminView = ["upload", "reported", "all"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "upload";
let adminPhotos = [];
let adminLoaded = false;
let adminListRequest = 0;
let editPhoto;
let uploading = false;
const adminSelection = new Set();
function uploadFeedback(message, isError = false) {
  const feedback = $("upload-feedback");
  feedback.textContent = message;
  feedback.hidden = !message;
  feedback.classList.toggle("error", isError);
}

function readSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(sessionKey) || "null");
    if (session?.until > Date.now()) return session.token;
    sessionStorage.removeItem(sessionKey);
  } catch {
    // The upload remains usable when browser storage is unavailable.
  }
  return "";
}

function saveSession(token) {
  uploadToken = token;
  try {
    if (token) sessionStorage.setItem(sessionKey, JSON.stringify({ token, until: Date.now() + 30 * 60_000 }));
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
    if (!await checkPassword(candidate)) throw new Error("Das Admin-Passwort stimmt nicht.");
    const token = $("github-key").value.trim();
    await fetchAdminPhotos(token);
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
  $("admin-list").replaceChildren();
  $("sign-out").hidden = true;
  $("admin-nav").hidden = true;
  $("upload-form").hidden = true;
  $("admin-library").hidden = true;
  $("edit-photo-form").hidden = true;
  $("unlock-form").hidden = false;
  $("password").focus();
}

function clearEditor() {
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
      $("admin-list").replaceChildren();
    renderTagPicker("upload-tags", uploadTags);
  } else {
    renderAdminLibrary();
  }
}

function renderAdminSelection() {
  $("admin-batch").hidden = adminSelection.size === 0;
  $("admin-selection-count").textContent = adminSelection.size + (adminSelection.size === 1 ? " Foto gewählt" : " Fotos gewählt");
}

function renderAdminLibrary() {
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
    image.src = adminPreview(photo);
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
    const { photos: entries } = await fetchAdminPhotos(uploadToken);
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

function openEditor(photo) {
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
  image.src = adminPreview(photo);
}

async function mutatePhoto(action) {
  if (uploading || !editPhoto) return;
  const photo = editPhoto;
  const form = $("edit-photo-form");
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
      await editPhotos(uploadToken, [{ id: photo.id, form: body }]);
      success = "Änderungen gespeichert.";
    } else if (action === "dismiss") {
      await dismissReports(uploadToken, photo.id);
      success = "Das Foto ist wieder in der Galerie sichtbar.";
    } else {
      await editPhotos(uploadToken, [{ id: photo.id, revision: photo.revision }]);
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
  const form = $("upload-form");
  const button = $("publish-photos");
  uploading = true;
  form.inert = true;
  button.disabled = true;
  $("admin-nav").inert = true;
  try {
    const pending = [];
    for (const [index, item] of batch.entries()) {
      uploadFeedback("Foto " + (index + 1) + " von " + batch.length + " wird vorbereitet …");
      const body = new FormData();
      body.set("image", item.file);
      body.set("preview", await createPreview(item.file), "preview");
      body.set("day", day);
      body.set("tags", JSON.stringify(tags));
      pending.push({ id: item.id, form: body });
    }
    uploadFeedback("Fotos werden in GitHub gespeichert …");
    await publishPhotos(uploadToken, pending);
    queuedFiles.length = 0;
    renderQueue();
    catalogChannel?.postMessage("catalog");
    loadAdminPhotos();
    uploadFeedback("Fotos gespeichert. GitHub Pages veröffentlicht die Änderungen in Kürze.");
  } catch (error) {
    if (error.status === 401) requireAdminLogin();
    uploadFeedback(error.message, true);
  } finally {
    uploading = false;
    form.inert = false;
    button.disabled = false;
    $("admin-nav").inert = false;
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
    ? batchPhotos.length + " ausgewählte Fotos wirklich löschen?" + (batchPhotos.length ? " Im Git-Verlauf können die Dateien weiter abrufbar sein." : "")
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
  try {
    const edits = selected.map(photo => {
      if (deleting) return { id: photo.id, revision: photo.revision };
      const tags = photo.tags.filter(tag => tagKey(tag) !== tagKey(category));
      if (!remove) tags.push(photo.tags.find(tag => tagKey(tag) === tagKey(category)) || category);
      if (tags.length > maxTags) throw new Error(photo.name + " hat bereits acht Kategorien.");
      const form = new FormData();
      form.set("revision", photo.revision);
      form.set("day", photo.day);
      form.set("tags", JSON.stringify(tags));
      return { id: photo.id, form };
    });
    await editPhotos(uploadToken, edits);
    for (const photo of selected) adminSelection.delete(photo.id);
    $("batch-dialog").close();
    catalogChannel?.postMessage("catalog");
    renderAdminLibrary();
    loadAdminPhotos();
    uploadFeedback(selected.length + (deleting ? " Fotos gelöscht." : " Fotos bearbeitet."));
  } catch (error) {
    if (error.status === 401) {
      $("batch-dialog").close();
      requireAdminLogin();
      uploadFeedback(error.message, true);
    } else {
      $("batch-error").textContent = error.message;
      $("batch-error").hidden = false;
      if (error.status === 409) loadAdminPhotos();
    }
  } finally {
    uploading = false;
    $("batch-form").inert = false;
    $("close-batch").disabled = false;
  }
}

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
setInterval(() => { if (!document.hidden) loadAdminPhotos(); }, 30_000);
