import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BrainCircuit, Send, Loader2, RefreshCw, Lightbulb, TrendingUp, Package, Users, Landmark, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent?: string;
  ts: Date;
}

const SUGGESTIONS = [
  { icon: TrendingUp, label: "Quanto entrou hoje?", category: "Financeiro" },
  { icon: TrendingUp, label: "Qual meu lucro do mês?", category: "Financeiro" },
  { icon: TrendingUp, label: "Quem mais está devendo?", category: "Financeiro" },
  { icon: BarChart3, label: "Qual produto vendeu mais?", category: "Vendas" },
  { icon: BarChart3, label: "Quem foi o melhor vendedor?", category: "Vendas" },
  { icon: Package, label: "Quais produtos estão acabando?", category: "Estoque" },
  { icon: Package, label: "Quais produtos estão parados?", category: "Estoque" },
  { icon: Users, label: "Quais clientes compram mais?", category: "Clientes" },
  { icon: Users, label: "Quais clientes pararam de comprar?", category: "Clientes" },
  { icon: Landmark, label: "Quanto foi conciliado?", category: "Connect" },
  { icon: BrainCircuit, label: "Como está a saúde da minha empresa?", category: "Geral" },
];

const INTENT_LABEL: Record<string, string> = {
  financial_summary: "Financeiro",
  cashflow: "Fluxo de Caixa",
  receivables_ranking: "A Receber",
  profit_analysis: "Lucro",
  sales_summary: "Vendas",
  top_products: "Produtos",
  sales_today: "Vendas Hoje",
  ticket_medio: "Ticket Médio",
  employee_performance: "Equipe",
  low_stock: "Estoque",
  idle_products: "Estoque Parado",
  purchase_suggestion: "Compras",
  inventory_value: "Valor Estoque",
  top_customers: "Clientes",
  churned_customers: "Clientes Perdidos",
  delinquency_detail: "Inadimplência",
  connect_summary: "Connect",
  health_score: "Saúde",
};

export default function AIAssistant() {
  const { profile, session } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const storeId = profile?.store_id;
  const role = profile?.role ?? "";

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Role gate
  if (!["owner", "admin", "manager"].includes(role)) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-sm p-6 text-center">
          <BrainCircuit className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">Acesso restrito</p>
          <p className="text-sm text-muted-foreground mt-1">O Copiloto IA está disponível para proprietários, administradores e gerentes.</p>
        </Card>
      </div>
    );
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = useCallback(async (question: string) => {
    if (!storeId || !question.trim() || loading) return;
    const q = question.trim();
    setInput("");
    setLoading(true);

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: q, ts: new Date() };
    setMessages((m) => [...m, userMsg]);

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ store_id: storeId, question: q }),
        }
      );
      const json = await res.json() as { answer?: string; intent?: string; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? "Erro ao processar");

      const aiMsg: Message = {
        id: crypto.randomUUID(), role: "assistant",
        content: json.answer ?? "Sem resposta.", intent: json.intent, ts: new Date(),
      };
      setMessages((m) => [...m, aiMsg]);
    } catch (e) {
      toast({ title: "Erro ao contatar a IA", description: (e as Error).message, variant: "destructive" });
      setMessages((m) => m.filter((msg) => msg.id !== userMsg.id));
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [storeId, loading, session]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  const cleared = () => setMessages([]);

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-4rem)] p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-violet-600" />
            Copiloto Estokfy IA
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Pergunte sobre vendas, estoque, financeiro, clientes ou conciliação.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/ai/insights")}>
            <Lightbulb className="h-4 w-4 mr-1" /> Insights
          </Button>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={cleared}>
              <RefreshCw className="h-4 w-4 mr-1" /> Nova conversa
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <Card className="flex-1 overflow-hidden">
        <ScrollArea className="h-full p-4">
          {messages.length === 0 ? (
            <div className="py-4">
              <p className="text-center text-muted-foreground text-sm mb-6">
                Olá! Sou o Copiloto do Estokfy. O que você gostaria de saber sobre sua empresa?
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {SUGGESTIONS.map(({ icon: Icon, label, category }) => (
                  <button
                    key={label}
                    onClick={() => send(label)}
                    className="flex items-center gap-2.5 text-left p-3 rounded-xl border hover:bg-muted/60 hover:border-primary/40 transition-all text-sm"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground block">{category}</span>
                      <span className="font-medium">{label}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted rounded-bl-sm"
                    }`}
                  >
                    {msg.role === "assistant" && msg.intent && msg.intent !== "unknown" && (
                      <Badge variant="secondary" className="mb-2 text-[10px]">
                        {INTENT_LABEL[msg.intent] ?? msg.intent}
                      </Badge>
                    )}
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    <p className={`text-[10px] mt-1.5 ${msg.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {msg.ts.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Analisando dados da sua loja...</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>
      </Card>

      {/* Input */}
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pergunte sobre vendas, estoque, financeiro..."
          disabled={loading}
          className="flex-1"
        />
        <Button onClick={() => send(input)} disabled={!input.trim() || loading} size="icon">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
