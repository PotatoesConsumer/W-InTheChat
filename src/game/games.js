/**
 * games.js
 *
 * The games in the hub, in the order they're shown. To add a game, write a module with
 * the interface in hub.js (src/game/shooter/index.js is the example), add it here, and
 * add any new events it sends to the catalog (src/events/schema.js).
 */

import { waveSurvival } from "./shooter/index.js";

export const GAMES = Object.freeze([
  waveSurvival,
  Object.freeze({
    id: "coming-soon",
    title: "More games",
    blurb: "Coming soon",
    comingSoon: true,
  }),
]);
