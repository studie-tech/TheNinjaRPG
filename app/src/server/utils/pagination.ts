/**
 * Offset pagination over page-number cursors. A full page may have a successor,
 * so `cursorAfter` returns the next page unless the rows came back short.
 */
export const offsetPage = (input: { cursor?: number | null; limit: number }) => {
  const page = input.cursor ?? 0;
  return {
    skip: page * input.limit,
    cursorAfter: (rows: readonly unknown[]) =>
      rows.length < input.limit ? null : page + 1,
  };
};
