import { defaultTags, samplePhotos } from "./config.js";
import { $, catalogChannel, chip, days, element, icon, renderDayToggle, tagKey } from "./client.mjs";
import { publicPhotos, reportLink } from "./github.mjs";
import { reportReasons } from "./upload/report-reasons.mjs";

const photos = new Map(samplePhotos.map(photo => [photo.id, photo]));
const selection = new Set();
const activeTags = new Set();
let activeDay = days[0];
let visiblePhotos = [];
let viewerPhotos = [];
const canShareFiles = typeof navigator.share === "function" && typeof navigator.canShare === "function";
let sharePreparation;
let shareFiles = [];
let viewIndex = 0;
let catalogRequest = 0;
let catalogSnapshot;
let reportTarget;
let touchStart = null;
let toastTimer;

function availableTags(additional = []) {
  const labels = new Map();
  for (const tag of [...defaultTags, ...[...photos.values()].flatMap(photo => photo.tags), ...additional]) {
    const key = tagKey(tag);
    if (!labels.has(key)) labels.set(key, tag);
  }
  return [...labels.values()].sort((a, b) => a.localeCompare(b, "de"));
}

function renderDayFilters() {
  renderDayToggle($("day-filters"), activeDay, day => {
    if (activeDay === day) return;
    activeDay = day;
    renderPhotos();
  });
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

function renderCatalog() {
  for (const id of selection) {
    if (!photos.has(id)) selection.delete(id);
  }
  renderSelection();

  if ($("viewer").open) {
    const current = viewerPhotos[viewIndex];
    viewerPhotos = viewerPhotos.map(photo => photos.get(photo.id)).filter(Boolean);
    const index = viewerPhotos.findIndex(photo => photo.id === current.id);
    if (index < 0) {
      if ($("report-dialog").open) $("report-dialog").close();
      $("viewer").close();
    } else {
      showPhoto(index);
    }
  }
  renderTagFilters();
  renderPhotos();
}

async function loadCatalog() {
  const version = ++catalogRequest;
  try {
    const { photos: entries } = await publicPhotos();
    if (version !== catalogRequest) return;
    $("catalog-error").hidden = true;
    const snapshot = JSON.stringify(entries);
    if (snapshot === catalogSnapshot) return;
    catalogSnapshot = snapshot;
    photos.clear();
    for (const photo of entries) photos.set(photo.id, photo);
    renderCatalog();
  } catch {
    if (version === catalogRequest) $("catalog-error").hidden = false;
  }
}

function openReport() {
  reportTarget = viewerPhotos[viewIndex];
  if (!reportTarget) return;
  $("report-form").reset();
  $("report-dialog").showModal();
}

function submitReport(event) {
  event.preventDefault();
  const reason = new FormData(event.currentTarget).get("reason");
  if (!reportTarget || !Object.hasOwn(reportReasons, reason)) return;
  window.open(reportLink(reportTarget.id, reason), "_blank", "noopener,noreferrer");
  $("report-dialog").close();
}

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

}

$("report-reason").append(...Object.entries(reportReasons).map(([value, label]) => new Option(label, value)));

$("open-report").hidden = false;
$("open-report").addEventListener("click", openReport);
$("close-report").addEventListener("click", () => $("report-dialog").close());
$("report-form").addEventListener("submit", submitReport);
catalogChannel?.addEventListener("message", loadCatalog);
window.addEventListener("pageshow", event => { if (event.persisted) loadCatalog(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadCatalog(); });
setInterval(() => { if (!document.hidden) loadCatalog(); }, 90_000);

renderDayFilters();
renderTagFilters();
renderPhotos();
loadCatalog();
