/**
 * profilePage.js
 *
 * The profile page (profile.html): the channel header, totals over every stream, the
 * past streams (each opens to its chat summary) and the edit form. Everything is in this
 * browser (profile.js). The new name reaches the prompts the next time the stream page
 * connects to the service.
 */

import {
  AVATAR_COLORS,
  PROFILE_LIMITS,
  createProfileStore,
  formatDuration,
  summarize,
} from "./profile.js";
import { showChannel } from "./channel.js";
import { PERSONA_LABELS } from "./chatOverlay.js";

const store = createProfileStore();
const $ = (id) => document.getElementById(id);
const form = $("profile-form");
let profile = store.profile();

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const money = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

function showProfile() {
  const live = store.isLive();
  showChannel(document, profile, { live });
  $("banner").style.backgroundColor = profile.color;
  $("profile-bio").textContent = profile.bio || "No bio yet.";
  $("profile-bio").classList.toggle("muted", !profile.bio);
  const goLive = $("go-live");
  goLive.href = live ? "stream.html" : "stream.html#live";
  goLive.textContent = live ? "Watch stream" : "Go live";
}

function showStreams() {
  const streams = store.streams();
  const totals = summarize(streams);
  $("total-streams").textContent = totals.count;
  $("total-time").textContent = formatDuration(totals.totalMs);
  $("total-wave").textContent = totals.bestWave;
  $("total-followers").textContent = totals.followers;
  $("total-donations").textContent = money(totals.donations);

  const rows = streams.flatMap((s) => {
    const row = document.createElement("tr");
    const cells = [
      [dateFormat.format(s.startedAt)],
      [formatDuration(s.endedAt - s.startedAt)],
      [s.games.join(", ") || "Just chatting"],
      [s.bestWave, "num"],
      [`+${s.followers}`, "num"],
      [money(s.donations), "num"],
      [s.messages, "num"],
    ];
    for (const [value, className] of cells) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      if (className) cell.className = className;
      row.append(cell);
    }

    // The chat column opens a row under this one with the stream's chat summary.
    const detail = document.createElement("tr");
    detail.className = "chat-detail";
    detail.hidden = true;
    const detailCell = document.createElement("td");
    detailCell.colSpan = cells.length + 1;
    detailCell.append(chatSummary(s.chat));
    detail.append(detailCell);

    const toggleCell = document.createElement("td");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "chat-toggle";
    toggle.textContent = s.chat ? `${s.chat.lines} lines` : "—";
    toggle.disabled = !s.chat;
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      detail.hidden = !detail.hidden;
      toggle.setAttribute("aria-expanded", String(!detail.hidden));
    });
    toggleCell.append(toggle);
    row.append(toggleCell);
    return [row, detail];
  });
  $("streams").replaceChildren(...rows);
  $("no-streams").hidden = streams.length > 0;
  $("streams").closest(".table-wrap").hidden = streams.length === 0;
  $("clear-history").hidden = streams.length === 0;
}

/** One stream's chat: lines per persona and the replies to the player's messages. */
function chatSummary(chat) {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const box = el("div", "chat-summary");
  if (!chat) return box;

  const counts = el("p", "persona-counts");
  counts.append(el("span", "count-total", `${chat.lines} chat lines`));
  for (const [persona, n] of Object.entries(chat.byPersona)) {
    const count = el("span", `count persona-${persona}`);
    count.append(el("span", "count-name", PERSONA_LABELS[persona] ?? persona), ` ${n}`);
    counts.append(count);
  }
  box.append(counts);

  box.append(el("h3", "summary-title", "Replies to you"));
  if (chat.replies.length === 0) {
    box.append(el("p", "summary-empty", "You didn't talk to chat this stream."));
    return box;
  }
  const list = el("ol", "replies");
  for (const reply of chat.replies) {
    const item = el("li", "reply");
    item.append(el("span", "reply-you", reply.you));
    const answer = el("span", `reply-answer persona-${reply.persona}`);
    answer.append(el("span", "reply-name", reply.viewer), `: ${reply.text}`);
    item.append(answer);
    list.append(item);
  }
  box.append(list);
  return box;
}

// The form, filled from the saved profile.
form.elements.name.value = profile.name;
form.elements.bio.value = profile.bio;
const swatches = AVATAR_COLORS.map((color, i) => {
  const label = document.createElement("label");
  label.className = "swatch";
  label.style.backgroundColor = color;
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "color";
  input.value = color;
  input.checked = color === profile.color;
  input.setAttribute("aria-label", `Colour ${i + 1}`);
  label.append(input);
  return label;
});
$("swatches").replaceChildren(...swatches);

function countBio() {
  $("bio-count").textContent = form.elements.bio.value.length;
}
form.elements.bio.addEventListener("input", countBio);
form.elements.bio.maxLength = PROFILE_LIMITS.maxBio;
countBio();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = store.saveProfile({
    name: form.elements.name.value,
    color: form.elements.color.value,
    bio: form.elements.bio.value,
  });
  for (const field of ["name", "bio"]) {
    const error = result.ok ? null : result.errors.find((e) => e.field === field);
    $(`${field}-error`).hidden = !error;
    $(`${field}-error`).textContent = error?.message ?? "";
    form.elements[field].setAttribute("aria-invalid", String(Boolean(error)));
  }
  if (!result.ok) {
    $("saved").textContent = "";
    return;
  }
  profile = result.profile;
  form.elements.name.value = profile.name;
  showProfile();
  $("saved").textContent = "Saved. Chat uses the new name next time you open the stream.";
});

$("clear-history").addEventListener("click", () => {
  if (!window.confirm("Clear every past stream from this browser? This can't be undone.")) return;
  store.clearHistory();
  showStreams();
});

showProfile();
showStreams();
