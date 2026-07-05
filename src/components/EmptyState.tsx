import Button from "./Button";

type EmptyStateProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export default function EmptyState({ message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p>{message}</p>
      {actionLabel && onAction && <Button onClick={onAction}>{actionLabel}</Button>}
    </div>
  );
}
