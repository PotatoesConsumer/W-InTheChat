/**
 * Prints the study's counterbalanced schedule: participant id, condition order and the
 * game URL for each half. Protocol: docs/study/protocol.md.
 *
 *   npm run study:order                         20 participants, P01-P20
 *   npm run study:order -- --participants 4 --prefix T     pilot sessions, T01-T04
 *   npm run study:order -- --csv > study-logs/schedule.csv
 */

import { parseArgs } from "node:util";
import { studySchedule, sessionUrl } from "../src/study/order.js";
import { CONDITION_LABELS } from "../src/ui/studyPanel.js";

const { values } = parseArgs({
  options: {
    participants: { type: "string", default: "20" },
    start: { type: "string", default: "1" },
    prefix: { type: "string", default: "P" },
    game: { type: "string", default: "http://localhost:5173/" },
    csv: { type: "boolean", default: false },
  },
});

const schedule = studySchedule(Number(values.participants), {
  start: Number(values.start),
  prefix: values.prefix,
});

if (values.csv) {
  console.log("participant,first,second,first_url,second_url");
  for (const { participant, order } of schedule) {
    const urls = order.map((c) => sessionUrl(participant, c, values.game));
    console.log([participant, ...order, ...urls].join(","));
  }
} else {
  console.log("| Participant | First | Second | First URL | Second URL |");
  console.log("|---|---|---|---|---|");
  for (const { participant, order } of schedule) {
    const [a, b] = order;
    console.log(
      `| ${participant} | ${CONDITION_LABELS[a]} | ${CONDITION_LABELS[b]} | ` +
        `${sessionUrl(participant, a, values.game)} | ${sessionUrl(participant, b, values.game)} |`,
    );
  }
}
