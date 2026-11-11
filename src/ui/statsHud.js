/**
 * statsHud.js
 *
 * The stream's stats in the top bar: follower and donation counters and the hype meter.
 * Each change shows a short "+3" pop-up next to the counter. Renders with textContent
 * only, like the chat overlay.
 */

import { statChanges } from "../game/stats.js";

/** 1234 -> "1,234"; 12345 -> "12.3K". */
export function formatCount(n) {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 10_000) return `${trim(n / 1_000)}K`;
  return n.toLocaleString("en-US");
}

export function formatMoney(n) {
  return `$${formatCount(n)}`;
}

/** Hype label for the meter, so the number means something at a glance. */
export function hypeLabel(hype) {
  if (hype >= 80) return "ON FIRE";
  if (hype >= 50) return "HYPED";
  if (hype >= 20) return "WARM";
  return "CHILL";
}

function trim(v) {
  return v.toFixed(1).replace(/\.0$/, "");
}

/**
 * @param {HTMLElement} root - Empty container; the HUD builds its own markup inside.
 * @param {{followers: number, donations: number, hype: number}} initial
 */
export function createStatsHud(root, initial) {
  const doc = root.ownerDocument;
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  root.classList.add("stats-hud");

  function counter(label) {
    const box = el("div", "stat");
    const value = el("span", "stat-value");
    box.append(el("span", "stat-label", label), value);
    return { box, value };
  }

  const followers = counter("followers");
  const donations = counter("donations");

  const hype = el("div", "stat hype");
  const bar = el("div", "hype-bar");
  const fill = el("div", "hype-fill");
  const label = el("span", "hype-label");
  bar.setAttribute("role", "meter");
  bar.setAttribute("aria-label", "Hype");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.append(fill);
  hype.append(el("span", "stat-label", "hype"), bar, label);

  root.append(followers.box, donations.box, hype);

  function pop(box, text, kind) {
    const node = el("span", `stat-pop ${kind}`, text);
    box.append(node);
    node.addEventListener("animationend", () => node.remove());
  }

  let shown = initial;

  function render(state) {
    followers.value.textContent = formatCount(state.followers);
    donations.value.textContent = formatMoney(state.donations);
    fill.style.width = `${state.hype}%`;
    fill.dataset.level = hypeLabel(state.hype).toLowerCase().replace(" ", "-");
    label.textContent = hypeLabel(state.hype);
    bar.setAttribute("aria-valuenow", String(state.hype));
  }

  render(initial);

  return {
    /** Shows a new stats state, with pop-ups for what went up. */
    set(state) {
      const diff = statChanges(shown, state);
      shown = state;
      render(state);
      if (diff.followers > 0) pop(followers.box, `+${diff.followers}`, "up");
      if (diff.donations > 0) pop(donations.box, `+${formatMoney(diff.donations)}`, "money");
    },
  };
}
