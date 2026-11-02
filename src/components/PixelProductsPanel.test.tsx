import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import PixelProductsPanel, { describePixelProductError } from './PixelProductsPanel';

const state = vi.hoisted(() => ({
  logs: [] as unknown[],
  logsError: null as unknown,
  productCount: 0,
  queries: [] as Array<{ table: string; filters: string[] }>,
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    const filters: string[] = [];
    const q: Record<string, unknown> = {};
    for (const name of ['select', 'order', 'limit']) q[name] = () => q;
    for (const name of ['eq', 'not']) q[name] = (...args: unknown[]) => { filters.push(`${name}:${args.join(':')}`); return q; };
    q.then = (resolve: (v: unknown) => void) => {
      state.queries.push({ table, filters });
      const result = table === 'audit_logs'
        ? { data: state.logs, error: state.logsError }
        : { data: null, count: state.productCount, error: null };
      return Promise.resolve(result).then(resolve);
    };
    return q;
  },
} }));

const sync = (id: string, after: Record<string, unknown>) => ({
  id, created_at: '2026-11-02T18:00:00Z', after_json: { created: 0, updated: 0, errors: 0, items: 0, errors_detail: [], ...after },
});

describe('PixelProductsPanel', () => {
  let root: Root;
  let container: HTMLDivElement;

  const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
  const render = async () => {
    await act(async () => root.render(<PixelProductsPanel storeId="store-1" />));
    await flush();
  };
  const text = () => container.textContent ?? '';
  const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.includes(label));

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    state.logs = [];
    state.logsError = null;
    state.productCount = 0;
    state.queries = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('mostra o total de produtos recebidos e a data do último envio', async () => {
    state.productCount = 12;
    state.logs = [sync('s1', { created: 3, updated: 1, items: 4 })];
    await render();

    expect(text()).toContain('Produtos recebidos da loja online');
    expect(text()).toContain('12');
    expect(text()).toContain(new Date('2026-11-02T18:00:00Z').toLocaleString('pt-BR'));
  });

  it('lista os envios com as contagens e só oferece "Ver motivos" quando houve erro', async () => {
    state.logs = [
      sync('ok', { created: 2, updated: 1, items: 3 }),
      sync('erro', { created: 1, updated: 1, errors: 2, items: 4, errors_detail: [
        { external_id: 'A', error: 'nome_obrigatorio' }, { external_id: 'B', error: 'nome_obrigatorio' },
      ] }),
    ];
    await render();

    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('3');
    expect(container.querySelectorAll('button')).toHaveLength(2);
    expect(text().match(/Ver motivos/g)).toHaveLength(1);
  });

  it('traduz o motivo do erro para o texto da loja', async () => {
    state.logs = [sync('erro', {
      errors: 1, items: 2, created: 1,
      errors_detail: [{ external_id: 'EXT-9', error: 'sku_ja_ligado_a_outro_produto_da_loja_online' }],
    })];
    await render();

    await act(async () => { button('Ver motivos')!.click(); });
    expect(text()).toContain('EXT-9');
    expect(text()).toContain('SKU já usado por outro produto da loja online');
    expect(text()).not.toContain('sku_ja_ligado_a_outro_produto_da_loja_online');
  });

  it('mostra o estado vazio quando a loja ainda não enviou produtos', async () => {
    await render();
    expect(text()).toContain('Nenhum envio de produtos recebido ainda');
    expect(text()).toContain('Nenhum envio ainda');
  });

  it('busca só os envios de produtos desta loja', async () => {
    await render();
    const logsQuery = state.queries.find(q => q.table === 'audit_logs');
    expect(logsQuery?.filters).toEqual(expect.arrayContaining([
      'eq:store_id:store-1',
      'eq:action:pixel_products_sync',
    ]));
  });

  it('describePixelProductError traduz códigos conhecidos e devolve o resto como veio', () => {
    expect(describePixelProductError('nome_obrigatorio')).toBe('Produto sem nome.');
    expect(describePixelProductError('invalid input syntax for type integer: "1.5"')).toContain('número inteiro');
    expect(describePixelProductError('mensagem desconhecida')).toBe('mensagem desconhecida');
  });
});
