/**
 * studyPanel.js
 *
 * The researcher's controls for the evaluation: which chat condition runs (AI chat or
 * the scripted baseline). Hidden by default and toggled with F2, so participants don't
 * see which condition they're in; the rest of the interface is the same in both
 * (proposal: same game, events and persona labels).
 *
 * Picking a condition reloads the page with `?condition=...`, so stats, chat and the
 * round start fresh for the next session, and the service restarts its pipeline.
 */

export const CONDITION_LABELS = Object.freeze({ ai: "AI chat", scripted: "Scripted chat" });

/** The study session label in the URL (`?session=P07`), or null. Same rule as the service's. */
export function sessionFromUrl(search) {
  const value = new URLSearchParams(search).get("session");
  return value && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : null;
}

/** The condition asked for in the URL, or null to keep whatever the service runs. */
export function conditionFromUrl(search) {
  const value = new URLSearchParams(search).get("condition");
  return Object.hasOwn(CONDITION_LABELS, value) ? value : null;
}

/**
 * @param {HTMLElement} root - Empty container.
 * @param {{onPick: (condition: string) => void}} opts
 */
export function createStudyPanel(root, { onPick }) {
  const doc = root.ownerDocument;
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  root.classList.add("study-panel");
  root.hidden = true;
  root.setAttribute("aria-label", "Study controls");

  const title = el("div", "study-title", "Study controls (F2 to hide)");
  const current = el("div", "study-current", "Condition: checking…");
  const buttons = el("div", "study-buttons");
  const byCondition = {};
  for (const [condition, label] of Object.entries(CONDITION_LABELS)) {
    const button = el("button", "study-button", label);
    button.type = "button";
    button.addEventListener("click", () => onPick(condition));
    byCondition[condition] = button;
    buttons.append(button);
  }
  const note = el("div", "study-note", "Switching restarts the stream: stats and chat reset.");
  const error = el("div", "study-error");
  error.hidden = true;
  root.append(title, current, buttons, note, error);

  return {
    toggle() {
      root.hidden = !root.hidden;
    },
    show() {
      root.hidden = false;
    },
    /** @param {string|null} condition - What the service is running, null if unknown. */
    setCondition(condition) {
      current.textContent = `Condition: ${CONDITION_LABELS[condition] ?? "unknown"}`;
      for (const [c, button] of Object.entries(byCondition)) {
        button.classList.toggle("active", c === condition);
        button.setAttribute("aria-pressed", String(c === condition));
      }
    },
    /** @param {string|null} message - null clears it. */
    setError(message) {
      error.textContent = message ?? "";
      error.hidden = !message;
    },
  };
}
