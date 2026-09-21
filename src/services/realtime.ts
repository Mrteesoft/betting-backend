import { EventEmitter } from "events";

const bus = new EventEmitter();
bus.setMaxListeners(500);
export const publishOddsUpdate = (payload: unknown) => bus.emit("odds", payload);
export const subscribeToOdds = (listener: (payload: unknown) => void) => {
  bus.on("odds", listener);
  return () => bus.off("odds", listener);
};
