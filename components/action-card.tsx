import Link from "next/link";

export type HomeAction = {
  itemId: string;
  name: string;
  label: string;
  description: string;
  href: string;
  priority: number;
  sortAt: string;
};

export function ActionCard({ action }: { action: HomeAction }) {
  return (
    <Link className="action-card" href={action.href} aria-label={`${action.name} ${action.label}`}>
      <div className="action-card-copy">
        <span className="action-label">{action.label}</span>
        <strong data-action-item-name>{action.name}</strong>
        <span className="action-description">{action.description}</span>
      </div>
      <span className="action-arrow" aria-hidden="true">→</span>
    </Link>
  );
}
