/**
 * channel.js
 *
 * Puts the profile on a page: every `[data-channel="name"]` gets the channel name, every
 * `[data-channel="avatar"]` the avatar letter and colour, and every `[data-live]` the
 * live state (`.offline` and an OFFLINE tag when the stream is off). Shared by the home,
 * stream and profile pages.
 */

import { avatarLetter, channelName } from "./profile.js";

/**
 * @param {Document} doc
 * @param {{name: string, color: string}} profile
 * @param {{live?: boolean}} [opts]
 */
export function showChannel(doc, profile, { live } = {}) {
  for (const el of doc.querySelectorAll('[data-channel="name"]')) {
    el.textContent = channelName(profile);
  }
  for (const el of doc.querySelectorAll('[data-channel="avatar"]')) {
    el.textContent = avatarLetter(profile);
    el.style.backgroundColor = profile.color;
  }
  if (live === undefined) return;
  for (const el of doc.querySelectorAll("[data-live]")) {
    el.classList.toggle("offline", !live);
    if (el.dataset.live === "tag") el.textContent = live ? "LIVE" : "OFFLINE";
  }
}
