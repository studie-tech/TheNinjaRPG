import { type LadderJob, playLadderGames } from "./aiHelpers";

declare const self: Worker;

/** Plays one share of the ladder games off the test thread. */
self.onmessage = (event: MessageEvent<LadderJob>) => {
  postMessage(playLadderGames(event.data));
};
