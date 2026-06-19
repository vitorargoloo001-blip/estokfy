import { useCapabilities } from '@/hooks/useCapabilities';

export function useCanViewCost(): boolean {
  const { canViewCostPrice } = useCapabilities();
  return canViewCostPrice;
}
