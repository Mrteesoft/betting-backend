let pending: Promise<unknown> = Promise.resolve();
export const serialize = <T>(work: () => Promise<T>): Promise<T> => {
  const result = pending.then(work);
  pending = result.catch(() => {});
  return result;
};
