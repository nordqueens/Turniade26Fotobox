import { apiBase } from "./config.js";

export const days = ["Freitag", "Samstag", "Sonntag"];
export const $ = id => document.getElementById(id);
const localUpload = ["localhost", "127.0.0.1"].includes(location.hostname)
  && new URLSearchParams(location.search).get("upload") === "local";
export const endpoint = localUpload ? "http://127.0.0.1:8787" : apiBase.replace(/\/$/, "");

export const modeQuery = localUpload ? "?upload=local" : "";
const channelName = "fotobox:" + new URL(".", location.href).pathname + ":" + endpoint;
export const catalogChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel(channelName) : null;

export function renderDayToggle(container, selected, onChange) {
  container.replaceChildren(...days.map(day => {
    const button = chip(day, day === selected, () => {
      for (const option of container.children) option.setAttribute("aria-pressed", String(option.dataset.day === day));
      onChange(day);
    }, "day-tab");
    button.dataset.day = day;
    return button;
  }));
}

export function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", "#i-" + name);
  svg.append(use);
  return svg;
}

export function chip(text, pressed, action, className = "chip") {
  const button = element("button", className, text);
  button.type = "button";
  button.setAttribute("aria-pressed", String(pressed));
  button.addEventListener("click", () => action(button));
  return button;
}

export function tagKey(tag) {
  return tag.normalize("NFC").toLocaleLowerCase("de");
}

export async function request(path, options = {}, parse = response => response.json()) {
  const response = await fetch(endpoint + path, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const failure = new Error(error.message || "Der Fotodienst ist gerade nicht erreichbar.");
    failure.status = response.status;
    throw failure;
  }
  return parse(response);
}

