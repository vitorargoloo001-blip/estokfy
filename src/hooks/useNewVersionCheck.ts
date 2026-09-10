import { useEffect } from 'react';
import { toast } from 'sonner';

// Avisa quando um deploy novo entrou no ar enquanto a aba estava aberta.
//
// Por que existe: o app é uma SPA sem service worker, então uma aba deixada
// aberta continua rodando o bundle que baixou quando foi carregada — por dias,
// se ninguém recarregar. Em 2026-08 isso segurou uma vendedora sem conseguir
// registrar venda por 4 dias DEPOIS da correção já estar publicada: a tela
// dela ainda executava o código antigo. Aqui o navegador compara o bundle que
// está rodando com o que o servidor entrega agora.
//
// Comparar o nome do arquivo (que carrega o hash do conteúdo) evita precisar
// de versão injetada no build ou de endpoint dedicado.
const INTERVALO_MS = 10 * 60 * 1000;

function bundleEmUso(): string | null {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'));
  const principal = scripts.map(s => s.src).find(src => /\/assets\/index-[A-Za-z0-9_-]+\.js/.test(src));
  return principal ? (principal.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/) || [null])[0] : null;
}

export function useNewVersionCheck() {
  useEffect(() => {
    const emUso = bundleEmUso();
    // Em dev o bundle não tem hash; não há o que comparar.
    if (!emUso) return;

    let avisado = false;

    const verificar = async () => {
      if (avisado || document.hidden) return;
      try {
        const html = await fetch(`/index.html?v=${Date.now()}`, { cache: 'no-store' }).then(r => r.text());
        const noServidor = (html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/) || [null])[0];
        if (!noServidor || noServidor === emUso) return;

        avisado = true;
        toast.info('Uma versão nova do Estokfy está disponível.', {
          description: 'Esta aba ainda está rodando a versão anterior. Atualize para evitar erros já corrigidos.',
          duration: Infinity,
          action: { label: 'Atualizar', onClick: () => window.location.reload() },
        });
      } catch {
        // offline ou rede instável: tenta de novo no próximo ciclo
      }
    };

    const id = setInterval(verificar, INTERVALO_MS);
    window.addEventListener('focus', verificar);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', verificar);
    };
  }, []);
}
