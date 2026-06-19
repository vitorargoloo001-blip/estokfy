import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ShimmerSkeletonProps {
  className?: string;
}

/**
 * Skeleton loader com shimmer animado via framer-motion.
 * Usa gradiente sobre bg-muted para efeito premium em tema claro/escuro.
 */
export function ShimmerSkeleton({ className }: ShimmerSkeletonProps) {
  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-muted/60', className)}>
      <motion.div
        className="absolute inset-0 -translate-x-full"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, hsl(var(--foreground) / 0.06) 50%, transparent 100%)',
        }}
        animate={{ x: ['-100%', '200%'] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  );
}

interface ShimmerListProps {
  count?: number;
  rowClassName?: string;
  className?: string;
}

export function ShimmerList({ count = 4, rowClassName = 'h-16 w-full', className }: ShimmerListProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <ShimmerSkeleton key={i} className={rowClassName} />
      ))}
    </div>
  );
}

export function ShimmerCardGrid({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-3 md:gap-4 grid-cols-2 md:grid-cols-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <ShimmerSkeleton className="h-3 w-20" />
          <ShimmerSkeleton className="h-7 w-24" />
          <ShimmerSkeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
