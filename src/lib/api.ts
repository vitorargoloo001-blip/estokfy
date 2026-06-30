import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

const BASE_URL = import.meta.env.VITE_SUPABASE_URL;
const API_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const isDev = import.meta.env.DEV;
const DEFAULT_TIMEOUT = 15_000;
const MAX_RETRIES = 1;

// --- Request dedup lock ---
const inflightRequests = new Set<string>();

interface InvokeOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown> | null;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  /** If true, returns raw Response (for streaming). Skips JSON parse, retry, and dedup. */
  raw?: boolean;
  /** Timeout in ms. Default 15s. */
  timeout?: number;
  /** Unique key for dedup. Auto-generated from functionName+method if omitted. */
  dedupKey?: string;
}

export interface ApiResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// --- Friendly error mapping ---
const BUSINESS_ERRORS: Record<string, string> = {
  estoque_insuficiente: 'Estoque insuficiente para um ou mais itens.',
  payload_invalido: 'Dados da requisição inválidos. Revise os campos.',
  produto_invalido: 'Produto não encontrado ou inativo.',
  qty_invalida: 'Quantidade inválida.',
  idempotency_conflict: 'A operação já está sendo processada. Aguarde alguns segundos.',
  missing_token: 'Sessão expirada. Faça login novamente.',
  sem_permissao: 'Você não tem permissão para executar esta ação.',
  sem_permissao_para_vender: 'Você não tem permissão para registrar vendas.',
  sem_permissao_para_troca: 'Você não tem permissão para registrar trocas.',
  sem_permissao_para_quitar: 'Você não tem permissão para quitar vendas.',
  store_invalida: 'Loja inválida.',
  perfil_nao_encontrado: 'Perfil não encontrado. Faça login novamente.',
  usuario_inativo: 'Usuário inativo. Contate o administrador.',
  venda_nao_encontrada: 'Venda não encontrada.',
  venda_ja_quitada: 'Esta venda já está quitada.',
  metodo_invalido: 'Método de pagamento inválido para esta operação.',
  pagamento_invalido: 'Valor de pagamento inválido.',
  observacao_muito_longa: 'A observação pode ter no máximo 500 caracteres.',
  data_futura_invalida: 'Não é possível registrar uma venda em data futura.',
  acesso_loja_desativado: 'O acesso da loja está desativado. Contate o administrador.',
  internal_error: 'Não foi possível concluir a operação. Tente novamente em instantes.',
};


function maskHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const normalized = key.toLowerCase();
      if (normalized === 'authorization') return [key, 'Bearer ***'];
      if (normalized === 'apikey') return [key, value ? `${value.slice(0, 8)}***` : value];
      return [key, value];
    }),
  );
}

function resolveBusinessMessage(serverCode?: string, serverMsg?: string): string | null {
  const source = `${serverCode || ''} ${serverMsg || ''}`.trim();
  if (!source) return null;

  for (const [key, msg] of Object.entries(BUSINESS_ERRORS)) {
    if (source.includes(key)) return msg;
  }

  return null;
}

function friendlyMessage(status: number, serverMsg?: string, serverCode?: string): string {
  const businessMessage = resolveBusinessMessage(serverCode, serverMsg);
  if (businessMessage) return businessMessage;

  switch (status) {
    case 401: return 'Sessão expirada. Faça login novamente.';
    case 403: return 'Você não tem permissão para esta ação.';
    case 404: return 'Serviço não encontrado.';
    case 429: return 'Muitas requisições. Aguarde um momento.';
    case 500: return 'Erro interno no servidor.';
    default: return serverMsg || 'Erro ao processar a requisição.';
  }
}

async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

async function getToken(): Promise<string> {
  const session = await getSession();
  const token = session?.access_token;
  if (!session?.user || !token) throw new Error('Sessão expirada. Faça login novamente.');
  return token;
}

async function validateUserProfile(): Promise<void> {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('missing_token');

    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('id, is_active')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (pErr || !profile) throw new Error('perfil_nao_encontrado');
    if (!profile.is_active) throw new Error('usuario_inativo');
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('perfil')) throw new Error('Perfil não encontrado. Faça login novamente.');
    if (msg.includes('inativo')) throw new Error('Usuário inativo. Contate o administrador.');
    throw new Error('Sessão expirada. Faça login novamente.');
  }
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return false; // timeout
  return err instanceof TypeError; // Failed to fetch / network error
}

function logRequest(functionName: string, method: string, url: string, headers: Record<string, string>, body?: Record<string, unknown> | null) {
  if (!isDev) return;

  console.group(`[Edge Function Call] ${functionName}`);
  console.log('Calling edge function:', functionName);
  console.log('Request URL:', url);
  console.log('Request method:', method);
  console.log('Request headers:', maskHeaders(headers));
  console.log('Request payload:', body ?? null);
  console.groupEnd();
}

async function logResponse(functionName: string, response: Response) {
  if (!isDev) return;

  const rawText = await response.clone().text().catch(() => '');

  console.group(`[Edge Function Response] ${functionName}`);
  console.log('Response status:', response.status);
  console.log('Response ok:', response.ok);
  console.log('Response headers:', [...response.headers.entries()]);
  console.log('Raw response text:', rawText);
  console.groupEnd();
}

async function doFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Central helper to call Supabase Edge Functions.
 * Features: auto timeout, retry on network error, request dedup, dev logging,
 * friendly error messages, JSON validation, standardized return shape.
 */
export async function invokeEdgeFunction<T = unknown>(
  functionName: string,
  options: InvokeOptions = {},
): Promise<T> {
  const {
    method = 'POST',
    body,
    headers: extraHeaders,
    params,
    raw,
    timeout = DEFAULT_TIMEOUT,
    dedupKey,
  } = options;

  // --- Dedup (skip for raw/streaming) ---
  const lockKey = dedupKey || `${functionName}:${method}`;
  if (!raw) {
    if (inflightRequests.has(lockKey)) {
      logger.warn('invokeEdgeFunction', `Duplicate call blocked: ${lockKey}`);
      throw new Error('Requisição já em andamento. Aguarde.');
    }
    inflightRequests.add(lockKey);
  }

  try {
    if (!BASE_URL || !API_KEY) {
      logger.error('invokeEdgeFunction', 'Missing backend runtime configuration');
      throw new Error('Serviço de backend não configurado.');
    }

    const token = await getToken();

    let url = `${BASE_URL}/functions/v1/${functionName}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      apikey: API_KEY,
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchInit: RequestInit = {
      method,
      headers,
      body: body && ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body) : undefined,
    };

    logger.group(`${method} ${functionName}`, {
      url,
      headers: maskHeaders(headers),
      payload: body || '(none)',
    });
    logRequest(functionName, method, url, headers, body);

    // --- Fetch with retry ---
    let res: Response | undefined;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= (raw ? 0 : MAX_RETRIES); attempt++) {
      try {
        res = await doFetch(url, fetchInit, timeout);
        break;
      } catch (err) {
        lastErr = err;
        if (err instanceof DOMException && err.name === 'AbortError') {
          logger.error('invokeEdgeFunction', `Timeout after ${timeout}ms: ${functionName}`);
          throw new Error('Tempo limite excedido. Tente novamente.');
        }
        if (isNetworkError(err) && attempt < MAX_RETRIES) {
          logger.warn('invokeEdgeFunction', `Network error, retrying (${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        logger.error('invokeEdgeFunction', `Network error calling ${functionName}:`, err);
        throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão.');
      }
    }

    if (!res) {
      logger.error('invokeEdgeFunction', 'No response after retries:', lastErr);
      throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão.');
    }

    // --- Raw mode (streaming) ---
    if (raw) return res as unknown as T;

    await logResponse(functionName, res);

    // --- Validate content-type ---
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok && !contentType.includes('application/json')) {
      const text = await res.text().catch(() => '');
      logger.error('invokeEdgeFunction', `Non-JSON error response (${res.status}):`, text);
      throw new Error(friendlyMessage(res.status));
    }

    let data: any;
    if (contentType.includes('application/json')) {
      try {
        data = await res.json();
      } catch {
        logger.error('invokeEdgeFunction', 'Failed to parse JSON response');
        if (res.ok) return {} as T;
        throw new Error('Resposta inválida do servidor.');
      }
    } else if (res.ok) {
      return {} as T;
    } else {
      throw new Error('Resposta inválida do servidor.');
    }

    if (!res.ok) {
      const serverCode = data?.error || '';
      const serverMsg = data?.message || serverCode || '';
      const msg = friendlyMessage(res.status, serverMsg, serverCode);
      logger.error('invokeEdgeFunction', `${functionName} ${res.status}:`, { serverCode, serverMsg, data });
      throw new Error(msg);
    }

    logger.group(`${functionName} response`, { status: res.status, data });

    return data as T;
  } finally {
    inflightRequests.delete(lockKey);
  }
}

export { validateUserProfile };
