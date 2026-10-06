import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

// Execute the real Edge Function with only its external database/auth replaced.
// This keeps regression coverage on its actual filters, totals and response contract.
export type Row = Record<string, any>;
export function reportDatabase(tables: Record<string, Row[]>, failingTable?: string) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } }, error: null }) },
    from(table: string) {
      let rows = (tables[table] || []).map(row => ({ ...row }));
      let columns = '*'; let error: unknown = table === failingTable ? { message: 'database unavailable' } : null;
      let start = 0; let end = 999; let single = false;
      if (table === 'sale_items' || table === 'payments') rows = rows.map(r => ({ ...r, sales: tables.sales?.find(s => s.id === r.sale_id) ?? null }));
      if (table === 'return_items') rows = rows.map(r => ({ ...r, returns: tables.returns?.find(s => s.id === r.return_id) ?? null }));
      const value = (row: Row, key: string) => key.split('.').reduce((v, k) => v?.[k], row);
      const q = {
        select(c: string) { columns = c; return q; },
        eq(k: string, v: unknown) { rows = rows.filter(r => value(r, k) === v); return q; },
        is(k: string, v: unknown) { rows = rows.filter(r => (value(r, k) ?? null) === v); return q; },
        in(k: string, v: unknown[]) { rows = rows.filter(r => v.includes(value(r, k))); return q; },
        gte(k: string, v: string) { rows = rows.filter(r => value(r, k) >= v); return q; },
        lte(k: string, v: string) { rows = rows.filter(r => value(r, k) <= v); return q; },
        lt(k: string, v: string) { rows = rows.filter(r => value(r, k) < v); return q; },
        filter(_k: string, _op: string, v: string) { if (v === 'minimum_stock') error = { message: 'invalid input syntax for type numeric: minimum_stock' }; return q; },
        order(k: string, options?: { ascending?: boolean }) { rows.sort((a,b) => String(value(a,k)).localeCompare(String(value(b,k))) * (options?.ascending === false ? -1 : 1)); return q; },
        limit(n: number) { end = n - 1; return q; },
        range(a: number, b: number) { start = a; end = b; return q; },
        single() { single = true; return q; },
        maybeSingle() { single = true; return q; },
        then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
          const selected = columns === '*' ? null : columns.split(/,(?![^()]*\))/).map(c => c.trim().replace(/!inner/, '').split('(')[0]);
          const result = rows.slice(start, end + 1).map(r => selected ? Object.fromEntries(selected.map(k => [k, r[k]])) : r);
          return Promise.resolve({ data: error ? null : single ? result[0] ?? null : result, error }).then(onFulfilled, onRejected);
        },
      };
      return q;
    },
  };
}

export async function runReport(tables: Record<string, Row[]>, params = 'from=2026-10-01&to=2026-10-02', failingTable?: string, name = 'reports-detailed') {
  const client = reportDatabase(tables, failingTable);
  let handler!: (r: Request) => Promise<Response>;
  const deno = { env: { get: () => 'fixture' }, serve: (fn: typeof handler) => { handler = fn; } };
  const load = (path: string): Record<string, unknown> => {
    const source = readFileSync(path, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const exports = {};
    const require = (specifier: string) => specifier.startsWith('https:') ? { createClient: () => client } : load(resolve(dirname(path), specifier));
    new Function('require', 'Deno', 'exports', compiled.outputText)(require, deno, exports);
    return exports;
  };
  load(resolve(`supabase/functions/${name}/index.ts`));
  const response = await handler(new Request(`https://test.invalid/?${params}`, { headers: { Authorization: 'Bearer fixture' } }));
  return { status: response.status, data: await response.json() };
}

export function reportFixture(): Record<string, Row[]> {
  return {
    profiles: [{ id: 'seller', auth_user_id: 'user', store_id: 'store', is_active: true, role: 'owner' }],
    sales: [{ id: 'sale', store_id: 'store', created_at: '2026-10-02T16:00:00Z', registered_at: '2026-10-02T16:00:00Z', sale_date: '2026-10-01', status: 'paid', deleted_at: null, customer_id: 'customer', created_by: 'seller', gross_total: 120, discount_total: 0, shipping_fee: 0, net_total: 120, profit_gross: 50, amount_paid: 70, amount_pending: 50, payment_status: 'partial' }],
    sale_items: [{ id: 'item-1', sale_id: 'sale', product_id: 'screen', qty: 2, unit_price: 50, line_total: 100, product_name_snapshot: 'Tela vendida', product_sku_snapshot: 'TELA', product_category_snapshot: 'Telas' }, { id: 'item-2', sale_id: 'sale', product_id: 'cable', qty: 1, unit_price: 20, line_total: 20 }],
    payments: [{ id: 'payment', store_id: 'store', sale_id: 'sale', created_by: 'seller', method: 'pix', amount: 70, paid_at: '2026-10-02T16:00:00Z' }],
    products: [{ id: 'screen', store_id: 'store', name: 'Tela renomeada', sku: 'NEW', on_hand: 0, minimum_stock: 1, is_active: true }, { id: 'cable', store_id: 'store', name: 'Cabo USB', sku: 'CABO', on_hand: 3, minimum_stock: 1, is_active: true }],
    customers: [{ id: 'customer', store_id: 'store', name: 'Cliente comprador' }],
    returns: [], return_items: [], stock_movements: [], cash_entries: [], suppliers: [],
  };
}
