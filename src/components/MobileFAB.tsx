import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, ShoppingCart, Package, Boxes, DollarSign, RotateCcw, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';

const actions = [
  { icon: ShoppingCart, label: 'Nova venda', to: '/vendas/nova', color: 'bg-primary text-primary-foreground' },
  { icon: Package, label: 'Novo produto', to: '/produtos', color: 'bg-emerald-500 text-white' },
  { icon: Boxes, label: 'Entrada estoque', to: '/estoque', color: 'bg-amber-500 text-white' },
  { icon: DollarSign, label: 'Novo gasto', to: '/financeiro', color: 'bg-red-500 text-white' },
  { icon: RotateCcw, label: 'Nova troca', to: '/trocas', color: 'bg-purple-500 text-white' },
  { icon: Truck, label: 'Nova entrega', to: '/entregas', color: 'bg-blue-500 text-white' },
];

export default function MobileFAB() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="fixed bottom-20 right-4 z-50 md:hidden">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col-reverse gap-3 mb-3"
          >
            {actions.map((action, idx) => (
              <motion.button
                key={action.label}
                initial={{ opacity: 0, y: 16, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.85 }}
                transition={{ delay: idx * 0.04, type: 'spring', stiffness: 380, damping: 26 }}
                onClick={() => { navigate(action.to); setOpen(false); }}
                className="flex items-center gap-3"
              >
                <span className="text-sm font-medium bg-card text-foreground px-3 py-1.5 rounded-xl shadow-md border border-border whitespace-nowrap">
                  {action.label}
                </span>
                <span className={cn('h-11 w-11 rounded-full flex items-center justify-center shadow-lg', action.color)}>
                  <action.icon className="h-5 w-5" />
                </span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main FAB */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => setOpen(!open)}
        className={cn(
          'h-14 w-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-200',
          open
            ? 'bg-muted text-foreground rotate-45'
            : 'bg-gradient-primary text-primary-foreground shadow-glow-accent'
        )}
      >
        {open ? <X className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
      </motion.button>

      {/* Backdrop */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-foreground/10 backdrop-blur-[2px] -z-10"
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
