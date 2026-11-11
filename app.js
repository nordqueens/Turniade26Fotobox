import { apiBase, defaultTags, samplePhotos } from "./config.js";

const days = ["Freitag", "Samstag", "Sonntag"];
const $ = id => document.getElementById(id);
const endpoint = apiBase.replace(/\/$/, "");
const maxPhotoSize = 20 * 1024 * 1024;
const maxTags = 8;
const photos = new Map(samplePhotos.map(photo => [photo.id, photo]));
const selection = new Set();
const activeTags = new Set();
const uploadTags = new Set();
const newTags = new Set();
const queuedFiles = [];
let activeDay = days[0];
let visiblePhotos = [];
let viewerPhotos = [];
let slidePhoto;
let slideTimer;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const canShareFiles = typeof navigator.share === "function" && typeof navigator.canShare === "function";
let sharePreparation;
let shareFiles = [];
let viewIndex = 0;
let catalogUpdatedWhileViewing = false;
let touchStart = null;
let password = "";
let uploading = false;
let toastTimer;

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", "#i-" + name);
  svg.append(use);
  return svg;
}

function chip(text, pressed, action, className = "chip") {
  const button = element("button", className, text);
  button.type = "button";
  button.setAttribute("aria-pressed", String(pressed));
  button.addEventListener("click", () => action(button));
  return button;
}

function availableTags(additional = []) {
  const labels = new Map();
  for (const tag of [...defaultTags, ...[...photos.values()].flatMap(photo => photo.tags), ...additional]) {
    const key = tagKey(tag);
    if (!labels.has(key)) labels.set(key, tag);
  }
  return [...labels.values()].sort((a, b) => a.localeCompare(b, "de"));
}

function tagKey(tag) {
  return tag.normalize("NFC").toLocaleLowerCase("de");
}

function renderDayFilters() {
  const filters = $("day-filters");
  filters.replaceChildren(...days.map(day => {
    const button = chip(day, day === activeDay, () => {
      if (day === activeDay) return;
      activeDay = day;
      for (const option of filters.children) option.setAttribute("aria-pressed", String(option.dataset.day === activeDay));
      renderPhotos();
    }, "day-tab");
    button.dataset.day = day;
    return button;
  }));
}

function renderTagFilters() {
  const tags = availableTags();
  const filter = $("tag-filter");
  filter.replaceChildren(...tags.map(tag => {
    const key = tagKey(tag);
    return chip(tag, activeTags.has(key), button => {
      if (activeTags.has(key)) activeTags.delete(key);
      else activeTags.add(key);
      button.setAttribute("aria-pressed", String(activeTags.has(key)));
      renderPhotos();
    });
  }));
  $("tag-row").hidden = !tags.length;
}

function resetFilters() {
  activeTags.clear();
  for (const button of $("tag-filter").children) button.setAttribute("aria-pressed", "false");
  renderPhotos();
  $("clear-filters").focus();
}

function labelsFor(photo) {
  const day = element("span", "photo-tag day", photo.day);
  day.dataset.day = photo.day;
  return [day, ...photo.tags.map(tag => element("span", "photo-tag", tag))];
}

function setDownload(link, photo) {
  link.href = photo.download || photo.source;
  link.download = photo.name;
}

function photoCard(photo, index) {
  const card = element("article", "photo-card");
  const open = element("button", "photo-open");
  const image = element("img");
  const description = photo.alt || photo.name;
  open.type = "button";
  open.setAttribute("aria-label", "Foto öffnen: " + description);
  image.src = photo.thumbnail;
  image.alt = description;
  image.decoding = "async";
  image.loading = index < 3 ? "eager" : "lazy";
  image.addEventListener("error", () => { image.src = photo.source; }, { once: true });
  open.append(image);
  open.addEventListener("click", () => openViewer(visiblePhotos, index));

  const select = element("button", "select-photo");
  select.type = "button";
  select.setAttribute("aria-label", "Foto für den Download auswählen: " + description);
  select.append(icon("check"));
  function showSelection() {
    const selected = selection.has(photo.id);
    select.setAttribute("aria-pressed", String(selected));
    card.classList.toggle("is-selected", selected);
  }
  showSelection();
  select.addEventListener("click", () => {
    if (selection.has(photo.id)) selection.delete(photo.id);
    else selection.add(photo.id);
    showSelection();
    renderSelection();
  });

  const download = element("a", "icon-button photo-download");
  download.setAttribute("aria-label", "Foto herunterladen: " + description);
  download.append(icon("down"));
  setDownload(download, photo);
  card.append(open, select, download);
  return card;
}

function photosByDay() {
  return days.flatMap(day => [...photos.values()].filter(photo => photo.day === day));
}

function renderPhotos() {
  visiblePhotos = [...photos.values()].filter(photo => {
    if (photo.day !== activeDay) return false;
    const keys = photo.tags.map(tagKey);
    return [...activeTags].every(tag => keys.includes(tag));
  });

  $("photo-count").textContent = visiblePhotos.length === 1 ? "1 Foto" : visiblePhotos.length + " Fotos";
  const container = $("photo-groups");
  container.replaceChildren();
  $("empty-state").hidden = visiblePhotos.length > 0;
  $("reset-filters").hidden = activeTags.size === 0;
  if (!visiblePhotos.length) return;

  const group = element("section", "photo-group");
  const title = element("h2", "day-heading", activeDay);
  const grid = element("div", "photo-grid");
  group.dataset.day = activeDay;
  title.id = "group-" + activeDay.toLowerCase();
  group.setAttribute("aria-labelledby", title.id);
  grid.append(...visiblePhotos.map(photoCard));
  group.append(title, grid);
  container.append(group);
}

function openViewer(photosToShow, index) {
  viewerPhotos = photosToShow;
  showPhoto(index);
  $("viewer").showModal();
  $("viewer-close").focus();
}

function showPhoto(index) {
  viewIndex = (index + viewerPhotos.length) % viewerPhotos.length;
  const photo = viewerPhotos[viewIndex];
  $("viewer-image").src = photo.source;
  $("viewer-image").alt = photo.alt || photo.name;
  $("viewer-count").textContent = (viewIndex + 1) + " / " + viewerPhotos.length;
  $("viewer-tags").replaceChildren(...labelsFor(photo));
  $("viewer-prev").hidden = viewerPhotos.length < 2;
  $("viewer-next").hidden = viewerPhotos.length < 2;
  setDownload($("viewer-download"), photo);
}

function advanceSlideshow() {
  const choices = [...photos.values()].filter(photo => photo.id !== slidePhoto?.id);
  if (!choices.length) return;
  slidePhoto = choices[Math.floor(Math.random() * choices.length)];
  const image = $("slide-image");
  image.alt = slidePhoto.alt || slidePhoto.name;
  image.src = slidePhoto.thumbnail;
}

function syncSlideshow() {
  clearInterval(slideTimer);
  $("slideshow").hidden = !photos.size;
  if (!slidePhoto) advanceSlideshow();

  if (photos.size > 1 && !reducedMotion.matches) {
    slideTimer = setInterval(() => {
      if (!document.hidden && !document.querySelector("dialog[open]") && !$("slide-open").matches(":focus-visible")) {
        advanceSlideshow();
      }
    }, 5000);
  }
}

function notify(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 5000);
}

function renderSelection() {
  $("selection-bar").hidden = !selection.size;
  $("selection-count").textContent = selection.size === 1 ? "1 Foto gewählt" : selection.size + " Fotos gewählt";
}

async function downloadSelection() {
  const selected = [...selection].map(id => photos.get(id));
  if (!selected.length) return;
  const button = $("download-selection");
  button.disabled = true;
  try {
    for (const [index, photo] of selected.entries()) {
      if (index > 0) await new Promise(resolve => setTimeout(resolve, 350));
      const link = element("a");
      setDownload(link, photo);
      document.body.append(link);
      link.click();
      link.remove();
    }
    const restoreFocus = $("selection-bar").contains(document.activeElement);
    for (const photo of selected) selection.delete(photo.id);
    renderSelection();
    renderPhotos();
    if (restoreFocus && !selection.size) {
      $("photo-groups").querySelector(".select-photo")?.focus({ preventScroll: true });
    }
    notify(selected.length === 1 ? "Download gestartet." : "Downloads gestartet.");
  } finally {
    button.disabled = false;
  }
}

async function prepareShare(selected) {
  if (!selected.length) return;
  const dialog = $("save-dialog");
  const status = $("save-status");
  const shareButton = $("open-share-sheet");
  const controller = new AbortController();
  sharePreparation?.abort();
  sharePreparation = controller;
  shareFiles = [];
  shareButton.hidden = true;
  status.textContent = "Fotos werden vorbereitet …";
  dialog.showModal();

  try {
    const files = [];
    for (const photo of selected) {
      const response = await fetch(photo.source, { signal: controller.signal });
      if (!response.ok) throw new Error("Ein Foto konnte nicht geladen werden.");
      const blob = await response.blob();
      files.push(new File([blob], photo.name, { type: blob.type }));
    }
    if (controller.signal.aborted || !dialog.open) return;
    if (!navigator.canShare({ files })) {
      status.textContent = "Dein Browser kann diese Auswahl nicht teilen. Wähle weniger Bilder oder nutze den Download-Pfeil.";
      return;
    }
    shareFiles = files;
    status.textContent = "Wähle im Teilen-Menü „Bild sichern“ oder „Bilder sichern“, falls dein Handy das anbietet.";
    shareButton.hidden = false;
    shareButton.focus();
  } catch {
    if (!controller.signal.aborted) status.textContent = "Die Fotos konnten nicht geladen werden. Versuche es erneut oder nutze den Download-Pfeil.";
  }
}

async function openShareSheet() {
  const button = $("open-share-sheet");
  button.disabled = true;
  try {
    await navigator.share({ files: shareFiles });
    $("save-dialog").close();
  } catch (error) {
    if (error.name !== "AbortError") $("save-status").textContent = "Das Teilen-Menü konnte nicht geöffnet werden. Nutze den Download-Pfeil.";
  } finally {
    button.disabled = false;
  }
}

async function request(path, options = {}) {
  const response = await fetch(endpoint + path, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Der Fotodienst ist gerade nicht erreichbar.");
  }
  return response.json();
}

function addUploadedPhoto(photo) {
  const source = endpoint + "/photos/" + encodeURIComponent(photo.id);
  photos.set(photo.id, {
    ...photo, source,
    thumbnail: source + "?preview=1",
    download: source + "?download=1"
  });
}

async function loadCatalog() {
  if (!endpoint) return;
  try {
    const { photos: uploaded } = await request("/photos", { cache: "no-store" });
    uploaded.forEach(addUploadedPhoto);
    syncSlideshow();
    $("catalog-error").hidden = true;
    if ($("viewer").open) catalogUpdatedWhileViewing = true;
    else {
      renderTagFilters();
      renderPhotos();
    }
  } catch {
    $("catalog-error").hidden = false;
  }
}

function uploadFeedback(message, isError = false) {
  const feedback = $("upload-feedback");
  feedback.textContent = message;
  feedback.hidden = !message;
  feedback.classList.toggle("error", isError);
}

function openUploader() {
  $("upload-unavailable").hidden = Boolean(endpoint);
  $("unlock-form").hidden = !endpoint;
  $("upload-form").hidden = true;
  $("uploader").showModal();
  if (endpoint) $("password").focus();
}

function resetUploader() {
  password = "";
  $("unlock-form").reset();
  $("upload-form").reset();
  queuedFiles.length = 0;
  uploadTags.clear();
  newTags.clear();
  uploadFeedback("");
  renderQueue();
}

function authHeaders(value) {
  return { "X-Upload-Password": encodeURIComponent(value) };
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
    await request("/auth", { method: "POST", headers: authHeaders(candidate) });
    if (!$("uploader").open || input.value !== candidate) return;
    password = candidate;
    form.reset();
    form.hidden = true;
    $("upload-form").hidden = false;
    renderUploadTags();
    $("upload-files").focus();
  } catch (error) {
    if ($("uploader").open && input.value === candidate) {
      uploadFeedback(error.message, true);
      input.select();
    }
  } finally {
    button.disabled = false;
  }
}

function renderUploadTags() {
  $("upload-tags").replaceChildren(...availableTags(newTags).map(tag => chip(tag, uploadTags.has(tag), button => {
    if (uploadTags.has(tag)) uploadTags.delete(tag);
    else if (uploadTags.size < maxTags) uploadTags.add(tag);
    else {
      uploadFeedback("Wähle höchstens " + maxTags + " Tags pro Foto.", true);
      return;
    }
    button.setAttribute("aria-pressed", String(uploadTags.has(tag)));
    uploadFeedback("");
  })));
}

function addTag() {
  const input = $("new-tag");
  const tag = input.value.trim().replace(/\s+/g, " ").normalize("NFC");
  if (!tag) return;
  if (days.some(day => tagKey(day) === tagKey(tag))) {
    uploadFeedback("Freitag, Samstag und Sonntag stehen bereits bei „Tag“.", true);
    return;
  }
  const knownTag = availableTags(newTags).find(item => tagKey(item) === tagKey(tag));
  const label = knownTag || tag;
  if (!uploadTags.has(label) && uploadTags.size >= maxTags) {
    uploadFeedback("Wähle höchstens " + maxTags + " Tags pro Foto.", true);
    return;
  }
  if (!knownTag) newTags.add(label);
  uploadTags.add(label);
  input.value = "";
  renderUploadTags();
  uploadFeedback("");
  input.focus();
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

function queueFiles() {
  const input = $("upload-files");
  const rejected = [];
  for (const file of input.files) {
    if (!file.size || file.size > maxPhotoSize || !/\.(jpe?g|png|webp)$/i.test(file.name)) {
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
  if (uploading || !password) return;
  if (!queuedFiles.length) {
    uploadFeedback("Wähle zuerst mindestens ein Foto aus.", true);
    $("upload-files").focus();
    return;
  }
  const day = $("upload-day").value;
  const tags = [...uploadTags];
  const batch = [...queuedFiles];
  const failures = [];
  const form = $("upload-form");
  const button = $("publish-photos");
  uploading = true;
  form.inert = true;
  button.disabled = true;
  $("close-upload").disabled = true;
  try {
    for (const [index, item] of batch.entries()) {
      uploadFeedback("Foto " + (index + 1) + " von " + batch.length + " wird hochgeladen …");
      try {
        const body = new FormData();
        body.set("image", item.file);
        body.set("preview", await createPreview(item.file), "preview");
        body.set("day", day);
        body.set("tags", JSON.stringify(tags));
        const { photo } = await request("/photos/" + item.id, { method: "PUT", headers: authHeaders(password), body });
        addUploadedPhoto(photo);
        queuedFiles.splice(queuedFiles.indexOf(item), 1);
      } catch (error) {
        failures.push(item.file.name + " – " + error.message);
      }
    }
    renderQueue();
    syncSlideshow();
    renderTagFilters();
    renderPhotos();
    if (failures.length) {
      uploadFeedback((batch.length - failures.length) + " von " + batch.length + " veröffentlicht. " + failures.join(" · "), true);
    } else {
      $("uploader").close();
      notify(batch.length === 1 ? "Dein Foto wurde veröffentlicht." : batch.length + " Fotos wurden veröffentlicht.");
    }
  } finally {
    uploading = false;
    form.inert = false;
    button.disabled = false;
    $("close-upload").disabled = false;
    if ($("uploader").open) button.focus();
  }
}

$("slide-open").addEventListener("click", () => {
  const order = photosByDay();
  openViewer(order, order.findIndex(photo => photo.id === slidePhoto.id));
});
$("slide-image").addEventListener("load", event => {
  $("slide-backdrop").src = event.target.currentSrc;
  if (!reducedMotion.matches) event.target.animate([{ opacity: .65 }, { opacity: 1 }], 260);
});
$("slide-image").addEventListener("error", event => {
  if (slidePhoto && event.target.getAttribute("src") !== slidePhoto.source) event.target.src = slidePhoto.source;
});
reducedMotion.addEventListener("change", syncSlideshow);
$("open-help").addEventListener("click", () => $("help").showModal());
$("close-help").addEventListener("click", () => $("help").close());
$("reset-filters").addEventListener("click", resetFilters);
$("clear-filters").addEventListener("click", resetFilters);
$("retry-catalog").addEventListener("click", loadCatalog);
$("download-selection").addEventListener("click", downloadSelection);
$("share-selection").hidden = !canShareFiles;
$("share-viewer").hidden = !canShareFiles;
$("share-selection").addEventListener("click", () => prepareShare([...selection].map(id => photos.get(id))));
$("share-viewer").addEventListener("click", () => prepareShare([viewerPhotos[viewIndex]]));
$("open-share-sheet").addEventListener("click", openShareSheet);
$("close-save").addEventListener("click", () => $("save-dialog").close());
$("save-dialog").addEventListener("close", () => {
  sharePreparation?.abort();
  shareFiles = [];
});
$("viewer-close").addEventListener("click", () => $("viewer").close());
$("viewer").addEventListener("close", renderPhotosAfterViewer);
$("viewer-prev").addEventListener("click", () => showPhoto(viewIndex - 1));
$("viewer-next").addEventListener("click", () => showPhoto(viewIndex + 1));
$("viewer").addEventListener("keydown", event => {
  if (event.target.closest("#viewer-tags")) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    showPhoto(viewIndex + (event.key === "ArrowLeft" ? -1 : 1));
  }
});
$("viewer-image").addEventListener("touchstart", event => { touchStart = event.changedTouches[0].clientX; }, { passive: true });
$("viewer-image").addEventListener("touchend", event => {
  if (touchStart === null) return;
  const distance = event.changedTouches[0].clientX - touchStart;
  touchStart = null;
  if (Math.abs(distance) > 45) showPhoto(viewIndex + (distance > 0 ? -1 : 1));
}, { passive: true });

function renderPhotosAfterViewer() {
  $("viewer-image").removeAttribute("src");
  viewerPhotos = [];
  touchStart = null;
  if (!catalogUpdatedWhileViewing) return;
  catalogUpdatedWhileViewing = false;
  renderTagFilters();
  renderPhotos();
}

$("open-upload").addEventListener("click", openUploader);
$("close-upload").addEventListener("click", () => $("uploader").close());
$("uploader").addEventListener("close", () => {
  resetUploader();
  $("open-upload").focus();
});
$("uploader").addEventListener("cancel", event => { if (uploading) event.preventDefault(); });
$("unlock-form").addEventListener("submit", unlock);
$("upload-form").addEventListener("submit", publish);
$("upload-files").addEventListener("change", queueFiles);
$("add-tag").addEventListener("click", addTag);
$("new-tag").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    addTag();
  }
});

renderDayFilters();
renderTagFilters();
renderPhotos();
syncSlideshow();
loadCatalog();
