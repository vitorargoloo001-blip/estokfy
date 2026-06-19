import { SO_STATUS_COLOR, SO_STATUS_LABEL, ServiceOrderStatus } from '@/lib/serviceOrderStatus';
import { cn } from '@/lib/utils';

export function StatusBadge({ status, className }: { status: ServiceOrderStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', SO_STATUS_COLOR[status], className)}>
      {SO_STATUS_LABEL[status]}
    </span>
  );
}
