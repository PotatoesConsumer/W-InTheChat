/**
 * profile.js
 *
 * The streamer's profile and stream history, kept in this browser (localStorage), and
 * whether the stream is live. No DOM: the pages (home.js, main.js, profilePage.js) draw
 * it, and the tests pass their own storage.
 *
 * - profile: a display name (chat calls the player by it, and the prompts use it), an
 *   avatar colour and a short bio. Empty name: the channel is "W-InTheChat" and the
 *   prompts say "the streamer".
 * - subtitles: whether the stream page shows what the mic hears as subtitles over the
 *   video (off by default; the profile page's switch). Chat hears the mic either way.
 * - live: true while the stream page is live (Go live until End stream or leaving the
 *   page), so the other pages can show LIVE or OFFLINE.
 * - streams: one record per stream (Go live to End stream), newest first, with a summary
 *   of its chat: lines per persona and the first reply to each of the player's messages
 *   (up to CHAT_SUMMARY.maxReplies). Plain counts and lines, no model call. The stream in
 *   progress is saved as it goes, so a crash doesn't lose it: the next page load ends it
 *   at its last update.
 *
 * The study's links (`?session=`) and the benchmark bot (`?bot=`) don't use any of this:
 * they're always live, with no name and no history.
 */

import { STREAMER_NAME } from "../ai/contextBuilder.js";

export const CHANNEL_NAME = "W-InTheChat";
/** Avatar colours: the accent first, then a few of Twitch's. */
export const AVATAR_COLORS = Object.freeze([
  "#9147ff",
  "#eb0400",
  "#1e90ff",
  "#00a3a3",
  "#f0b429",
  "#ff69b4",
]);
export const PROFILE_LIMITS = Object.freeze({ maxBio: 160, maxStreams: 50, minStreamMs: 10_000 });
export const CHAT_SUMMARY = Object.freeze({ maxReplies: 5, maxLineLength: 200 });
const PERSONAS = ["fan", "hater", "backseat", "lurker"];
export const DEFAULT_PROFILE = Object.freeze({ name: "", color: AVATAR_COLORS[0], bio: "" });

const KEYS = Object.freeze({
  profile: "witc.profile",
  live: "witc.live",
  streams: "witc.streams",
  current: "witc.stream",
  subtitles: "witc.subtitles",
});

/**
 * Checks a profile from the form.
 * @param {{name?: string, color?: string, bio?: string}} input
 * @returns {{ok: true, profile: object} | {ok: false, errors: {field: string, message: string}[]}}
 */
export function checkProfile(input = {}) {
  const name = String(input.name ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const bio = String(input.bio ?? "").trim();
  const color = AVATAR_COLORS.includes(input.color) ? input.color : DEFAULT_PROFILE.color;
  const errors = [];
  if (name && !STREAMER_NAME.test(name)) {
    errors.push({
      field: "name",
      message: "Use up to 25 letters, numbers, spaces, _ . or -, starting with a letter or number.",
    });
  }
  if (bio.length > PROFILE_LIMITS.maxBio) {
    errors.push({ field: "bio", message: `Keep it under ${PROFILE_LIMITS.maxBio} characters.` });
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, profile: Object.freeze({ name, color, bio }) };
}

/** The channel's name: the display name, or W-InTheChat. */
export const channelName = (profile) => profile.name || CHANNEL_NAME;

/** The avatar's letter. */
export const avatarLetter = (profile) => [...channelName(profile)][0].toUpperCase();

/**
 * A stream record after one bus event.
 * @param {object} record - The stream in progress.
 * @param {Readonly<object>} event - A bus event.
 * @param {{followers: number, donated: number, game?: string}} now - The stats after the
 *   event, the donation it brought ($, 0 if none) and the game being played.
 */
export function tallyStream(record, event, { followers, donated, game }) {
  const games = game && !record.games.includes(game) ? [...record.games, game] : record.games;
  const cleared = event.kind === "game" && event.name === "win" ? Number(event.data?.wave) || 0 : 0;
  return {
    ...record,
    games,
    followers,
    donations: Math.round((record.donations + donated) * 100) / 100,
    bestWave: Math.max(record.bestWave, cleared),
    messages: record.messages + (event.kind === "chat" ? 1 : 0),
  };
}

/** An empty chat summary for a new stream. */
export function emptyChat() {
  return { lines: 0, byPersona: Object.fromEntries(PERSONAS.map((p) => [p, 0])), replies: [] };
}

/**
 * A stream record after one finished chat line from the service.
 * @param {object} record - The stream in progress.
 * @param {{done: boolean, persona: string, viewer: string, text: string, eventId: string|null}} message
 * @param {string} [you] - The player's message this line answers, if it answers one.
 */
export function tallyChat(record, message, you) {
  if (!message.done) return record;
  const chat = record.chat ?? emptyChat();
  const byPersona = { ...chat.byPersona };
  if (message.persona in byPersona) byPersona[message.persona]++;
  let replies = chat.replies;
  const first = you !== undefined && !replies.some((r) => r.eventId === message.eventId);
  if (first && replies.length < CHAT_SUMMARY.maxReplies) {
    const cut = (text) => String(text).slice(0, CHAT_SUMMARY.maxLineLength);
    replies = [
      ...replies,
      {
        eventId: message.eventId,
        you: cut(you),
        viewer: message.viewer,
        persona: message.persona,
        text: cut(message.text),
      },
    ];
  }
  return { ...record, chat: { lines: chat.lines + 1, byPersona, replies } };
}

/** Totals over the history. */
export function summarize(streams) {
  return streams.reduce(
    (sum, s) => ({
      count: sum.count + 1,
      totalMs: sum.totalMs + Math.max(0, s.endedAt - s.startedAt),
      bestWave: Math.max(sum.bestWave, s.bestWave),
      followers: sum.followers + s.followers,
      donations: Math.round((sum.donations + s.donations) * 100) / 100,
    }),
    { count: 0, totalMs: 0, bestWave: 0, followers: 0, donations: 0 },
  );
}

/** The live pill's clock: "0:42", "12:05", "1:02:09". */
export function formatUptime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const two = (n) => String(n).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/** "45 s", "12 min", "1 h 05 min". */
export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/**
 * @param {Pick<Storage, "getItem" | "setItem" | "removeItem">} [storage] - localStorage
 *   by default; a page with no storage (private window, blocked) still works, it just
 *   forgets.
 */
export function createProfileStore(storage = browserStorage()) {
  function read(key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      if (value === undefined) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked: the page keeps working, this just isn't remembered.
    }
  }

  function end(record, endedAt) {
    const done = { ...record, endedAt };
    delete done.updatedAt;
    write(KEYS.current, undefined);
    // Gone live by mistake (seconds long, nobody said anything): not worth a row.
    const empty = !done.messages && !done.chat?.lines;
    if (empty && endedAt - done.startedAt < PROFILE_LIMITS.minStreamMs) return null;
    const streams = [done, ...read(KEYS.streams, [])].slice(0, PROFILE_LIMITS.maxStreams);
    write(KEYS.streams, streams);
    return done;
  }

  return {
    profile() {
      const saved = checkProfile(read(KEYS.profile, {}));
      return saved.ok ? saved.profile : DEFAULT_PROFILE;
    },
    /** Saves the profile if it's valid; returns checkProfile's result. */
    saveProfile(input) {
      const result = checkProfile(input);
      if (result.ok) write(KEYS.profile, result.profile);
      return result;
    },

    /** Whether the stream page shows subtitles of what the mic hears. Off by default. */
    subtitles() {
      return read(KEYS.subtitles, false) === true;
    },
    setSubtitles(on) {
      write(KEYS.subtitles, Boolean(on));
    },

    /** Whether the stream page is live right now. */
    isLive() {
      return read(KEYS.live, false) === true;
    },
    setLive(live) {
      write(KEYS.live, Boolean(live));
    },

    /** Past streams, newest first. */
    streams() {
      const streams = read(KEYS.streams, []);
      return Array.isArray(streams) ? streams : [];
    },
    clearHistory() {
      write(KEYS.streams, undefined);
    },

    /** The stream in progress, or null. */
    current() {
      return read(KEYS.current, null);
    },
    startStream(now) {
      const record = {
        id: `stream-${now}`,
        startedAt: now,
        updatedAt: now,
        games: [],
        bestWave: 0,
        followers: 0,
        donations: 0,
        messages: 0,
        chat: emptyChat(),
      };
      write(KEYS.current, record);
      return record;
    },
    /** Saves the stream in progress as it is now. */
    saveStream(record, now) {
      const saved = { ...record, updatedAt: now };
      write(KEYS.current, saved);
      return saved;
    },
    /**
     * Ends the stream in progress and adds it to the history. Null if there is none, or
     * if it was shorter than minStreamMs with nothing said (not saved).
     */
    endStream(now) {
      const record = read(KEYS.current, null);
      return record ? end(record, now) : null;
    },
    /**
     * Ends a stream left over from a closed tab, at its last update. Call on page load.
     * @returns the record, or null
     */
    recover() {
      const record = read(KEYS.current, null);
      return record ? end(record, record.updatedAt ?? record.startedAt) : null;
    },
  };
}

function browserStorage() {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // Blocked (sandboxed frame, privacy settings).
  }
  const memory = new Map();
  return {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };
}
