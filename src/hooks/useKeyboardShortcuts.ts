import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;

      // Alt+N → Nova Venda (always)
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        navigate('/vendas/nova');
        return;
      }

      // / → Focus global search (only when not in input)
      if (e.key === '/' && !isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('[data-global-search]');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // Ctrl+Enter → Submit on NewSale page
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && location.pathname === '/vendas/nova') {
        e.preventDefault();
        const submitBtn = document.querySelector<HTMLButtonElement>('[data-submit-sale]');
        if (submitBtn && !submitBtn.disabled) {
          submitBtn.click();
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, location.pathname]);
}
