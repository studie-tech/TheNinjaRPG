import {
  createSectorWorkerHandler,
  type SectorWorkerReply,
  type SectorWorkerRequest,
} from "@/libs/rendering/sectorGeneration";

/** Worker entry for travel sector generation; see `sectorGenerationClient.ts`. */
const handle = createSectorWorkerHandler();
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SectorWorkerRequest>) => void) | null;
  postMessage: (message: SectorWorkerReply, transfer: Transferable[]) => void;
};

scope.onmessage = ({ data }) => {
  const { reply, transfer } = handle(data);
  scope.postMessage(reply, transfer);
};
