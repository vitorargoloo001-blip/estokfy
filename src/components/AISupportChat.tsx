import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import {
  Drawer, DrawerContent,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MessageCircle, Send, X, CheckCircle, XCircle, Bot, Sparkles,
  Maximize2, Minimize2, Plus, ShoppingCart, RotateCcw, Package,
  BarChart3, Wallet, Truck, Receipt, ArrowRight, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { detectIntent, getIntent, type IntentId } from '@/lib/aiIntents';

interface NavLink { route: string; label: string }
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  action?: string;
  event_id?: string;
  needs_confirm?: boolean;
  /** True quando a mensagem é resposta automática de uma intenção */
  isIntent?: boolean;
  /** Link de navegação contextual (resultado de uma query da IA) */
  nav_link?: NavLink;
}

const QUICK_SUGGESTIONS: { label: string; intent: IntentId; icon: typeof ShoppingCart }[] = [
  { label: 'Registrar venda', intent: 'registrar_venda', icon: ShoppingCart },
  { label: 'Registrar troca', intent: 'registrar_troca', icon: RotateCcw },
  { label: 'Estoque baixo', intent: 'ver_estoque_baixo', icon: Package },
  { label: 'Relatório de hoje', intent: 'ver_relatorio_diario', icon: BarChart3 },
  { label: 'Fechar caixa', intent: 'fechar_caixa', icon: Wallet },
  { label: 'Adicionar despesa', intent: 'registrar_despesa', icon: Receipt },
  { label: 'Nova entrega', intent: 'registrar_entrega', icon: Truck },
];

const WELCOME_MESSAGE = `Olá! 👋

Sou o **Estok**, seu assistente operacional.

Posso **executar ações** automaticamente:
- 🛒 Abrir nova venda ou troca
- 📦 Consultar estoque baixo / nova entrada
- 💰 Lançar despesa ou fechar caixa
- 📊 Abrir relatório diário ou mensal
- 🚚 Gerenciar entregas

Também respondo perguntas como _"quantas vendas fiz hoje?"_ ou _"qual foi meu lucro?"_.

É só digitar ou usar uma sugestão abaixo.`;

export default function AISupportChat() {
  const { profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  /** Executa uma intenção: mostra feedback, navega após pequeno delay e fecha o drawer. */
  const executeIntent = (intentId: IntentId, originalText?: string) => {
    const intent = getIntent(intentId);
    if (!intent) return;

    if (originalText) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', content: originalText }]);
    }
    setMessages(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `⚡ ${intent.feedback}`,
        isIntent: true,
      },
    ]);
    setInput('');

    // Delay curto para o usuário ver o feedback antes da navegação
    setTimeout(() => {
      navigate(`${intent.route}${intent.search || ''}`);
      setOpen(false);
    }, 700);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading || !profile) return;

    // 1. Detecta intenção localmente — sem custo de IA
    const intent = detectIntent(text);
    if (intent) {
      executeIntent(intent.id, text);
      return;
    }

    // 2. Sem intenção → encaminha para a IA
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    const assistantId = crypto.randomUUID();
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

    try {
      const resp = await invokeEdgeFunction<Response>('ai-support-chat', {
        raw: true,
        body: {
          message: text,
          route: location.pathname,
          conversation_id: conversationId,
          stream: true,
        },
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.reply || errData.error || 'Erro');
      }
      if (!resp.body) throw new Error('No stream body');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let pendingAction: { action?: string; event_id?: string; needs_confirm?: boolean } = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nlIdx: number;
        while ((nlIdx = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;

          try {
            const parsed = JSON.parse(payload);
            if (parsed.conversation_id) { setConversationId(parsed.conversation_id); continue; }
            if (parsed.delta) {
              fullContent += parsed.delta;
              let displayContent = fullContent;
              try {
                const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  const j = JSON.parse(jsonMatch[0]);
                  if (j.reply) displayContent = j.reply;
                }
              } catch { /* partial json */ }
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: displayContent } : m));
            }
            if (parsed.action) {
              pendingAction = { action: parsed.action, event_id: parsed.event_id, needs_confirm: parsed.needs_confirm };
            }
            if (parsed.query_summary) {
              setMessages(prev => [...prev, {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: parsed.query_summary,
                nav_link: parsed.nav_link,
              }]);
            }
            if (parsed.handoff) toast.info('Conversa encaminhada para a equipe de suporte.');
          } catch { /* skip */ }
        }
      }

      if (pendingAction.action) {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, ...pendingAction } : m));
      }
      // Auto-execute navigation actions (no confirmation needed)
      try {
        const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const j = JSON.parse(jsonMatch[0]);
          if (j.action === 'navigate' && j.action_payload?.route) {
            const route = String(j.action_payload.route);
            if (route.startsWith('/')) {
              toast.info(`Abrindo ${route}...`);
              setTimeout(() => navigate(route), 400);
            }
          }
        }
      } catch { /* not a JSON */ }
      if (!fullContent.trim()) {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: 'Sem resposta.' } : m));
      }
    } catch (e: any) {
      console.error('AI chat error:', e);
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: e.message || 'Erro ao processar. Tente novamente.' } : m));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (eventId: string, confirmed: boolean) => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-support-chat', {
        body: { message: confirmed ? 'Confirmo' : 'Cancelo', conversation_id: conversationId, confirm_action: { event_id: eventId, confirmed } },
      });
      if (error) throw error;
      setMessages(prev => prev.map(m => m.event_id === eventId ? { ...m, needs_confirm: false } : m));
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: data.reply || (confirmed ? '✅ Ação executada.' : 'Ação cancelada.') }]);
      if (data.action_success) toast.success('Ação executada com sucesso!');
    } catch (e) {
      console.error('Confirm error:', e);
      toast.error('Erro ao processar confirmação.');
    } finally {
      setLoading(false);
    }
  };

  const handleNewChat = () => { setMessages([]); setConversationId(null); };

  const showWelcome = messages.length === 0;
  const isStreaming = loading && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content;

  const ChatPanel = (
    <div className="flex h-full flex-col bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      {/* HEADER */}
      <header className="flex-shrink-0 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-full bg-blue-500/40 blur-md animate-pulse" />
              <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 ring-2 ring-blue-400/30">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-950" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold leading-tight truncate">Estok — Assistente Inteligente</h2>
              <p className="text-[11px] text-slate-400 leading-tight truncate">Sempre pronto para ajudar na sua operação</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={handleNewChat}
              className="text-xs h-8 text-slate-300 hover:text-white hover:bg-slate-800 gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Nova</span>
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setFullscreen(f => !f)}
              className="h-8 w-8 text-slate-300 hover:text-white hover:bg-slate-800 hidden md:inline-flex">
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)}
              className="h-8 w-8 text-slate-300 hover:text-white hover:bg-slate-800">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* MESSAGES */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
        <div className={cn('mx-auto space-y-4', fullscreen ? 'max-w-3xl' : 'max-w-full')}>
          {showWelcome && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
              className="flex gap-3">
              <div className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 ring-1 ring-blue-400/40">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 rounded-2xl rounded-tl-sm bg-slate-900/80 border border-slate-800 px-4 py-3 text-sm text-slate-100 shadow-lg">
                <ReactMarkdown components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                  ul: ({ children }) => <ul className="space-y-1 my-2">{children}</ul>,
                  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                  strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
                }}>{WELCOME_MESSAGE}</ReactMarkdown>
              </div>
            </motion.div>
          )}

          <AnimatePresence initial={false}>
            {messages.map(msg => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 ring-1 ring-blue-400/40">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                )}
                <div className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-lg break-words',
                  msg.role === 'user'
                    ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-tr-sm'
                    : 'bg-slate-900/80 text-slate-100 border border-slate-800 rounded-tl-sm',
                )}>
                  {msg.content ? (
                    <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-p:leading-relaxed prose-ul:my-1.5 prose-li:my-0.5 prose-strong:text-white">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <TypingDots />
                  )}
                  {msg.nav_link && (
                    <div className="mt-3 pt-3 border-t border-slate-700/60">
                      <Button size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                        onClick={() => { navigate(msg.nav_link!.route); setOpen(false); }}>
                        <ArrowRight className="h-3 w-3" /> {msg.nav_link.label}
                      </Button>
                    </div>
                  )}
                  {msg.needs_confirm && msg.event_id && (
                    <div className="flex gap-2 mt-3 pt-3 border-t border-slate-700/60">
                      <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => handleConfirm(msg.event_id!, true)} disabled={loading}>
                        <CheckCircle className="h-3 w-3" /> Confirmar
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-slate-700 text-slate-200 hover:bg-slate-800"
                        onClick={() => handleConfirm(msg.event_id!, false)} disabled={loading}>
                        <XCircle className="h-3 w-3" /> Cancelar
                      </Button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={endRef} />
        </div>
      </div>

      {/* QUICK SUGGESTIONS */}
      <div className="flex-shrink-0 border-t border-slate-800/80 bg-slate-950/60 backdrop-blur px-3 py-2.5">
        <div className={cn('mx-auto', fullscreen ? 'max-w-3xl' : 'max-w-full')}>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {QUICK_SUGGESTIONS.map(s => {
              const Icon = s.icon;
              return (
                <button
                  key={s.label}
                  onClick={() => executeIntent(s.intent)}
                  disabled={loading}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:border-blue-500 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* INPUT */}
      <div className="flex-shrink-0 border-t border-slate-800/80 bg-slate-950 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
          className={cn('mx-auto flex gap-2', fullscreen ? 'max-w-3xl' : 'max-w-full')}
        >
          <Input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Digite sua pergunta..."
            disabled={loading}
            className="h-12 flex-1 rounded-xl border-slate-800 bg-slate-900/80 text-sm text-white placeholder:text-slate-500 focus-visible:ring-blue-500 focus-visible:ring-offset-slate-950"
          />
          <Button
            type="submit"
            size="icon"
            disabled={loading || !input.trim()}
            className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white hover:from-blue-600 hover:to-blue-800 shadow-lg shadow-blue-900/40 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-40 md:bottom-24 right-4 md:right-6 z-40 group flex items-center gap-2 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 px-4 py-3 text-white shadow-xl shadow-blue-900/40 hover:shadow-blue-900/60 transition-all hover:scale-105"
        aria-label="Estok — Assistente IA"
      >
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-white/30 blur animate-pulse" />
          <Sparkles className="relative h-5 w-5" />
        </div>
        <span className="text-sm font-semibold hidden md:inline">Estok IA</span>
      </button>

      <Drawer open={open} onOpenChange={setOpen} direction="right">
        <DrawerContent
          className={cn(
            'fixed inset-y-0 right-0 left-auto rounded-none border-l border-slate-800 p-0 bg-slate-950 transition-[width] duration-300',
            fullscreen ? 'w-full' : 'w-full sm:w-[440px]',
          )}
        >
          {ChatPanel}
        </DrawerContent>
      </Drawer>
    </>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1">
      <span className="text-xs text-slate-400 mr-1">digitando</span>
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-slate-400"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  );
}
