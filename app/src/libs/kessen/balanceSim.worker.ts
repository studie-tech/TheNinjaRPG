import {
  createSimHandler,
  type KessenSimReply,
  type KessenSimRequest,
} from "@/libs/kessen/balanceSimRunner";

/** Worker entry for Kessen balance simulations; see `balanceSimRunner.ts`. */
const handle = createSimHandler();
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<KessenSimRequest>) => void) | null;
  postMessage: (message: KessenSimReply) => void;
};

scope.onmessage = ({ data }) => {
  const reply = handle(data);
  if (reply) scope.postMessage(reply);
};
