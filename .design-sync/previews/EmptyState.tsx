import { EmptyState } from "cydi";

const noop = () => {};

/** Message plus a primary action - the usual form. */
export const WithAction = () => (
  <div style={{ maxWidth: 420 }}>
    <EmptyState message="You haven't created any challenges yet." actionLabel="Create a challenge" onAction={noop} />
  </div>
);

/** Message only: the action is omitted when there is nothing useful to do. */
export const MessageOnly = () => (
  <div style={{ maxWidth: 420 }}>
    <EmptyState message="No scores yet - be the first to play today's shape!" />
  </div>
);
