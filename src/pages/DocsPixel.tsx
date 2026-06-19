import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Check, Copy, Zap, Code, Globe, Shield, ArrowRight, BookOpen, Terminal, AlertTriangle, ChevronLeft, Menu } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const BASE_URL = import.meta.env.VITE_SUPABASE_URL;

function CopyBlock({ code, language = "javascript" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Copiado!");
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <pre className="bg-zinc-900 text-zinc-100 rounded-lg p-4 pr-12 text-xs sm:text-sm overflow-x-auto font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button
        size="sm"
        variant="ghost"
        className="absolute top-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700"
        onClick={copy}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function SectionTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-xl sm:text-2xl font-bold text-foreground mt-8 sm:mt-10 mb-3 sm:mb-4 scroll-mt-20">
      {children}
    </h2>
  );
}

function SubSection({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h3 id={id} className="text-lg font-semibold text-foreground mt-6 mb-3 scroll-mt-20">
      {children}
    </h3>
  );
}

const NAV_ITEMS = [
  { id: "intro", label: "Introdução" },
  { id: "instalacao", label: "Instalação" },
  { id: "autenticacao", label: "Autenticação" },
  { id: "eventos", label: "Eventos" },
  { id: "payloads", label: "Payloads" },
  { id: "respostas", label: "Respostas" },
  { id: "idempotencia", label: "Idempotência" },
  { id: "exemplos", label: "Exemplos" },
  { id: "faq", label: "FAQ" },
];

export default function DocsPixel() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const scrollTo = (id: string) => {
    setMobileNavOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/login")} className="mr-1 h-8 w-8 sm:h-9 sm:w-9">
              <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
            <Zap className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            <span className="font-bold text-base sm:text-lg">Estokfy Pixel</span>
            <Badge variant="secondary" className="text-xs hidden sm:inline-flex">Docs</Badge>
          </div>
          <div className="flex items-center gap-2">
            {isMobile && (
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64 p-0">
                  <div className="p-4 border-b">
                    <div className="flex items-center gap-2">
                      <Zap className="h-5 w-5 text-primary" />
                      <span className="font-bold">Navegação</span>
                    </div>
                  </div>
                  <nav className="p-3 space-y-1">
                    {NAV_ITEMS.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => scrollTo(item.id)}
                        className="block w-full text-left px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors touch-target"
                      >
                        {item.label}
                      </button>
                    ))}
                  </nav>
                </SheetContent>
              </Sheet>
            )}
            <Button size="sm" className="text-xs sm:text-sm" onClick={() => navigate("/login")}>
              Acessar o sistema
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          {/* Sidebar nav - desktop only */}
          <aside className="hidden lg:block w-56 flex-shrink-0">
            <nav className="sticky top-24 space-y-1">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => scrollTo(item.id)}
                  className="block w-full text-left px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0 max-w-3xl">
            {/* Hero */}
            <div className="mb-10">
              <div className="flex items-center gap-2 mb-3">
                <Badge className="bg-primary/10 text-primary border-0">API v1</Badge>
                <Badge variant="outline" className="text-xs">REST</Badge>
              </div>
              <h1 className="text-2xl sm:text-4xl font-bold text-foreground mb-3 sm:mb-4">
                Documentação do Estokfy Pixel
              </h1>
              <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
                Integre seu site, e-commerce ou plataforma de infoprodutos com o Estokfy.
                Receba vendas, cancelamentos, trocas e dados de clientes automaticamente
                na sua conta — sem esforço manual.
              </p>
            </div>

            {/* Quick Start Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-8 sm:mb-10">
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => scrollTo("instalacao")}>
                <CardContent className="p-4 flex items-start gap-3">
                  <Code className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Instalar</p>
                    <p className="text-xs text-muted-foreground">Copie o snippet para seu site</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => scrollTo("eventos")}>
                <CardContent className="p-4 flex items-start gap-3">
                  <Zap className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Eventos</p>
                    <p className="text-xs text-muted-foreground">8 tipos de eventos suportados</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => scrollTo("exemplos")}>
                <CardContent className="p-4 flex items-start gap-3">
                  <Terminal className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Exemplos</p>
                    <p className="text-xs text-muted-foreground">Código pronto para copiar</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Introdução */}
            <SectionTitle id="intro">O que é o Estokfy Pixel?</SectionTitle>
            <p className="text-muted-foreground mb-4 leading-relaxed">
              O Estokfy Pixel é um sistema de integração que permite que sites externos
              enviem eventos de vendas, cancelamentos, devoluções e dados de clientes
              diretamente para sua conta no Estokfy.
            </p>
            <p className="text-muted-foreground mb-4 leading-relaxed">
              Funciona de forma similar ao Meta Pixel ou Google Tag, mas com foco
              <strong className="text-foreground"> operacional</strong>: cada evento recebido é transformado em dados reais
              dentro do seu sistema — vendas, clientes, devoluções e histórico financeiro.
            </p>

            <Card className="bg-primary/5 border-primary/20 mb-6">
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <Shield className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm mb-1">Multi-tenant seguro</p>
                    <p className="text-xs text-muted-foreground">
                      Cada conta possui um pixel exclusivo. Os dados nunca se misturam
                      entre lojas — o isolamento é total.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Instalação */}
            <SectionTitle id="instalacao">Instalação</SectionTitle>
            <p className="text-muted-foreground mb-4 leading-relaxed">
              Para começar a receber eventos, você precisa instalar o snippet do Estokfy Pixel
              no seu site. Vá em <strong className="text-foreground">Configurações → Integrações → Estokfy Pixel</strong> para
              obter seu snippet personalizado.
            </p>

            <SubSection>1. Obtenha suas credenciais</SubSection>
            <p className="text-muted-foreground mb-3">
              No painel do Estokfy, acesse <code className="bg-muted px-1.5 py-0.5 rounded text-xs">Configurações → Integrações → Estokfy Pixel</code> e
              copie seu <code className="bg-muted px-1.5 py-0.5 rounded text-xs">Pixel ID</code> e <code className="bg-muted px-1.5 py-0.5 rounded text-xs">Secret Key</code>.
            </p>

            <SubSection>2. Instale o snippet</SubSection>
            <p className="text-muted-foreground mb-3">
              Cole o seguinte código no <code className="bg-muted px-1.5 py-0.5 rounded text-xs">&lt;head&gt;</code> do seu site,
              substituindo os valores de exemplo pelas suas credenciais reais:
            </p>
            <CopyBlock code={`<script>
  window.ControlixPixel = {
    pixelId: "SEU_PIXEL_ID",
    secretKey: "SEU_SECRET_KEY",
    endpoint: "${BASE_URL}/functions/v1/pixel-events"
  };

  window.ctrlx = function(eventType, data) {
    fetch(window.ControlixPixel.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pixel-id": window.ControlixPixel.pixelId,
        "x-pixel-key": window.ControlixPixel.secretKey
      },
      body: JSON.stringify({
        event_type: eventType,
        external_event_id: data.external_event_id || null,
        external_order_id: data.external_order_id || null,
        external_customer_id: data.external_customer_id || null,
        payload: data
      })
    });
  };
</script>`} />

            <SubSection>3. Envie eventos</SubSection>
            <p className="text-muted-foreground mb-3">
              Após instalar o snippet, use a função <code className="bg-muted px-1.5 py-0.5 rounded text-xs">ctrlx()</code> para
              enviar eventos:
            </p>
            <CopyBlock code={`// Compra aprovada
ctrlx("purchase_approved", {
  external_order_id: "ORD-12345",
  external_event_id: "EVT-001",
  total_amount: 199.90,
  payment_method: "pix",
  customer: {
    name: "João Silva",
    email: "joao@email.com",
    phone: "11999998888"
  }
});`} />

            {/* Autenticação */}
            <SectionTitle id="autenticacao">Autenticação</SectionTitle>
            <p className="text-muted-foreground mb-4 leading-relaxed">
              Toda requisição deve incluir dois headers de autenticação:
            </p>

            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">Header</th>
                    <th className="text-left py-2 px-3 font-medium">Descrição</th>
                    <th className="text-left py-2 px-3 font-medium">Obrigatório</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-2 px-3"><code className="bg-muted px-1.5 py-0.5 rounded text-xs">x-pixel-id</code></td>
                    <td className="py-2 px-3 text-muted-foreground">Seu Pixel ID único</td>
                    <td className="py-2 px-3"><Badge className="bg-red-100 text-red-700 border-0 text-xs">Sim</Badge></td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 px-3"><code className="bg-muted px-1.5 py-0.5 rounded text-xs">x-pixel-key</code></td>
                    <td className="py-2 px-3 text-muted-foreground">Sua chave secreta (secret key)</td>
                    <td className="py-2 px-3"><Badge className="bg-red-100 text-red-700 border-0 text-xs">Sim</Badge></td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 px-3"><code className="bg-muted px-1.5 py-0.5 rounded text-xs">Content-Type</code></td>
                    <td className="py-2 px-3 text-muted-foreground">application/json</td>
                    <td className="py-2 px-3"><Badge className="bg-red-100 text-red-700 border-0 text-xs">Sim</Badge></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 mb-6">
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm mb-1 text-amber-800 dark:text-amber-200">Proteja sua Secret Key</p>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Nunca exponha sua secret key em repositórios públicos. Em produção,
                      use variáveis de ambiente no servidor para armazenar a chave.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Domínios autorizados */}
            <SubSection>Domínios autorizados</SubSection>
            <p className="text-muted-foreground mb-4">
              Você pode restringir quais domínios podem enviar eventos para seu pixel.
              Configure os domínios em <code className="bg-muted px-1.5 py-0.5 rounded text-xs">Configurações → Integrações → Estokfy Pixel</code>.
              Se nenhum domínio for configurado, requisições de qualquer origem serão aceitas.
            </p>

            {/* Eventos */}
            <SectionTitle id="eventos">Eventos Suportados</SectionTitle>
            <p className="text-muted-foreground mb-4 leading-relaxed">
              O endpoint aceita os seguintes tipos de eventos:
            </p>

            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">Evento</th>
                    <th className="text-left py-2 px-3 font-medium">Descrição</th>
                    <th className="text-left py-2 px-3 font-medium">Ação no Estokfy</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["purchase_approved", "Compra aprovada", "Cria venda + cliente"],
                    ["purchase_cancelled", "Compra cancelada", "Cancela a venda original"],
                    ["refund_created", "Reembolso solicitado", "Cria devolução (pendente)"],
                    ["refund_completed", "Reembolso concluído", "Cria devolução (aprovada)"],
                    ["exchange_created", "Troca solicitada", "Cria devolução (troca)"],
                    ["customer_created", "Novo cliente", "Cria/atualiza cliente"],
                    ["payment_approved", "Pagamento aprovado", "Cria venda + pagamento"],
                    ["payment_failed", "Pagamento falhou", "Registra evento (log)"],
                  ].map(([evt, desc, action]) => (
                    <tr key={evt} className="border-b">
                      <td className="py-2 px-3">
                        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{evt}</code>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{desc}</td>
                      <td className="py-2 px-3 text-muted-foreground">{action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Payloads */}
            <SectionTitle id="payloads">Estrutura do Payload</SectionTitle>

            <SubSection>Endpoint</SubSection>
            <CopyBlock code={`POST ${BASE_URL}/functions/v1/pixel-events`} />

            <SubSection>Corpo da requisição</SubSection>
            <CopyBlock code={`{
  "event_type": "purchase_approved",
  "external_event_id": "EVT-UNIQUE-001",
  "external_order_id": "ORD-12345",
  "external_customer_id": "CUST-789",
  "payload": {
    "total_amount": 299.90,
    "discount": 10.00,
    "shipping_fee": 15.00,
    "payment_method": "pix",
    "customer": {
      "name": "Maria Santos",
      "email": "maria@email.com",
      "phone": "11988887777",
      "doc_id": "123.456.789-00"
    }
  }
}`} />

            <SubSection>Campos do body</SubSection>
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">Campo</th>
                    <th className="text-left py-2 px-3 font-medium">Tipo</th>
                    <th className="text-left py-2 px-3 font-medium">Obrigatório</th>
                    <th className="text-left py-2 px-3 font-medium">Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["event_type", "string", "Sim", "Tipo do evento (ver tabela acima)"],
                    ["external_event_id", "string", "Não*", "ID único do evento (idempotência)"],
                    ["external_order_id", "string", "Não", "ID do pedido no seu sistema"],
                    ["external_customer_id", "string", "Não", "ID do cliente no seu sistema"],
                    ["payload", "object", "Não", "Dados adicionais do evento"],
                  ].map(([campo, tipo, obr, desc]) => (
                    <tr key={campo} className="border-b">
                      <td className="py-2 px-3"><code className="bg-muted px-1.5 py-0.5 rounded text-xs">{campo}</code></td>
                      <td className="py-2 px-3 text-muted-foreground">{tipo}</td>
                      <td className="py-2 px-3">
                        <Badge className={obr === "Sim" ? "bg-red-100 text-red-700 border-0 text-xs" : "bg-zinc-100 text-zinc-600 border-0 text-xs"}>
                          {obr}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground mb-6">
              * Recomendado: envie <code className="bg-muted px-1 py-0.5 rounded">external_event_id</code> para
              garantir idempotência e evitar duplicatas.
            </p>

            <SubSection>Campos do payload.customer</SubSection>
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">Campo</th>
                    <th className="text-left py-2 px-3 font-medium">Tipo</th>
                    <th className="text-left py-2 px-3 font-medium">Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["name", "string", "Nome do cliente"],
                    ["email", "string", "E-mail (prioridade 1 para identificação)"],
                    ["phone", "string", "Telefone (prioridade 2)"],
                    ["doc_id", "string", "CPF/CNPJ (prioridade 3)"],
                    ["external_id", "string", "ID externo do cliente"],
                  ].map(([campo, tipo, desc]) => (
                    <tr key={campo} className="border-b">
                      <td className="py-2 px-3"><code className="bg-muted px-1.5 py-0.5 rounded text-xs">{campo}</code></td>
                      <td className="py-2 px-3 text-muted-foreground">{tipo}</td>
                      <td className="py-2 px-3 text-muted-foreground">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Respostas */}
            <SectionTitle id="respostas">Respostas da API</SectionTitle>

            <Tabs defaultValue="success" className="mb-6">
              <TabsList>
                <TabsTrigger value="success">Sucesso</TabsTrigger>
                <TabsTrigger value="duplicate">Duplicado</TabsTrigger>
                <TabsTrigger value="error">Erro</TabsTrigger>
              </TabsList>
              <TabsContent value="success">
                <div className="flex items-center gap-2 mb-2 mt-3">
                  <Badge className="bg-green-100 text-green-700 border-0">200</Badge>
                  <span className="text-sm text-muted-foreground">Evento processado com sucesso</span>
                </div>
                <CopyBlock code={`{
  "status": "success",
  "event_id": "uuid-do-evento"
}`} />
              </TabsContent>
              <TabsContent value="duplicate">
                <div className="flex items-center gap-2 mb-2 mt-3">
                  <Badge className="bg-blue-100 text-blue-700 border-0">200</Badge>
                  <span className="text-sm text-muted-foreground">Evento já foi processado anteriormente</span>
                </div>
                <CopyBlock code={`{
  "status": "duplicate_event",
  "event_id": "uuid-do-evento-original",
  "processing_status": "processed"
}`} />
              </TabsContent>
              <TabsContent value="error">
                <div className="space-y-3 mt-3">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className="bg-red-100 text-red-700 border-0">401</Badge>
                      <span className="text-sm text-muted-foreground">Credenciais inválidas</span>
                    </div>
                    <CopyBlock code={`{ "error": "invalid_pixel", "message": "Pixel not found" }
{ "error": "invalid_signature", "message": "Invalid secret key" }`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className="bg-red-100 text-red-700 border-0">403</Badge>
                      <span className="text-sm text-muted-foreground">Pixel inativo ou domínio não autorizado</span>
                    </div>
                    <CopyBlock code={`{ "error": "pixel_inactive", "message": "Pixel is inactive" }
{ "error": "domain_not_allowed", "message": "Origin domain not authorized" }`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className="bg-red-100 text-red-700 border-0">400</Badge>
                      <span className="text-sm text-muted-foreground">Evento inválido</span>
                    </div>
                    <CopyBlock code={`{ "error": "invalid_event_type", "message": "Supported: purchase_approved, ..." }`} />
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            {/* Idempotência */}
            <SectionTitle id="idempotencia">Idempotência</SectionTitle>
            <p className="text-muted-foreground mb-4 leading-relaxed">
              O Estokfy Pixel implementa proteção contra duplicatas usando o campo
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs mx-1">external_event_id</code>.
            </p>
            <p className="text-muted-foreground mb-4 leading-relaxed">
              Se você enviar o mesmo <code className="bg-muted px-1.5 py-0.5 rounded text-xs">external_event_id</code> duas vezes
              para a mesma loja:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground mb-6">
              <li>A venda <strong className="text-foreground">não</strong> será duplicada</li>
              <li>O cliente <strong className="text-foreground">não</strong> será criado novamente</li>
              <li>A API retorna <code className="bg-muted px-1.5 py-0.5 rounded text-xs">duplicate_event</code> com o ID do evento original</li>
            </ul>

            <Card className="bg-primary/5 border-primary/20 mb-6">
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <BookOpen className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">Recomendação:</strong> Sempre envie um{" "}
                    <code className="bg-muted px-1 py-0.5 rounded text-xs">external_event_id</code>{" "}
                    único para cada evento. Isso garante que retries e webhooks duplicados
                    não criem dados duplicados no Estokfy.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Exemplos */}
            <SectionTitle id="exemplos">Exemplos Completos</SectionTitle>

            <Tabs defaultValue="js" className="mb-6">
              <TabsList>
                <TabsTrigger value="js">JavaScript</TabsTrigger>
                <TabsTrigger value="curl">cURL</TabsTrigger>
                <TabsTrigger value="php">PHP</TabsTrigger>
                <TabsTrigger value="python">Python</TabsTrigger>
              </TabsList>

              <TabsContent value="js" className="mt-3">
                <SubSection>Compra aprovada</SubSection>
                <CopyBlock code={`fetch("${BASE_URL}/functions/v1/pixel-events", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-pixel-id": "SEU_PIXEL_ID",
    "x-pixel-key": "SEU_SECRET_KEY"
  },
  body: JSON.stringify({
    event_type: "purchase_approved",
    external_event_id: "EVT-" + Date.now(),
    external_order_id: "ORD-12345",
    payload: {
      total_amount: 199.90,
      discount: 0,
      shipping_fee: 12.90,
      payment_method: "credit_card",
      customer: {
        name: "João Silva",
        email: "joao@email.com",
        phone: "11999998888",
        doc_id: "123.456.789-00"
      }
    }
  })
})`} />

                <SubSection>Cancelamento</SubSection>
                <CopyBlock code={`ctrlx("purchase_cancelled", {
  external_order_id: "ORD-12345",
  external_event_id: "EVT-CANCEL-001"
});`} />

                <SubSection>Devolução</SubSection>
                <CopyBlock code={`ctrlx("refund_completed", {
  external_order_id: "ORD-12345",
  external_event_id: "EVT-REFUND-001"
});`} />
              </TabsContent>

              <TabsContent value="curl" className="mt-3">
                <CopyBlock language="bash" code={`curl -X POST \\
  ${BASE_URL}/functions/v1/pixel-events \\
  -H "Content-Type: application/json" \\
  -H "x-pixel-id: SEU_PIXEL_ID" \\
  -H "x-pixel-key: SEU_SECRET_KEY" \\
  -d '{
    "event_type": "purchase_approved",
    "external_event_id": "EVT-001",
    "external_order_id": "ORD-12345",
    "payload": {
      "total_amount": 199.90,
      "payment_method": "pix",
      "customer": {
        "name": "João Silva",
        "email": "joao@email.com"
      }
    }
  }'`} />
              </TabsContent>

              <TabsContent value="php" className="mt-3">
                <CopyBlock language="php" code={`<?php
$ch = curl_init("${BASE_URL}/functions/v1/pixel-events");

curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    "Content-Type: application/json",
    "x-pixel-id: SEU_PIXEL_ID",
    "x-pixel-key: SEU_SECRET_KEY"
  ],
  CURLOPT_POSTFIELDS => json_encode([
    "event_type" => "purchase_approved",
    "external_event_id" => "EVT-" . uniqid(),
    "external_order_id" => "ORD-12345",
    "payload" => [
      "total_amount" => 199.90,
      "payment_method" => "pix",
      "customer" => [
        "name" => "João Silva",
        "email" => "joao@email.com"
      ]
    ]
  ])
]);

$response = curl_exec($ch);
curl_close($ch);

echo $response;`} />
              </TabsContent>

              <TabsContent value="python" className="mt-3">
                <CopyBlock language="python" code={`import requests
import uuid

response = requests.post(
    "${BASE_URL}/functions/v1/pixel-events",
    headers={
        "Content-Type": "application/json",
        "x-pixel-id": "SEU_PIXEL_ID",
        "x-pixel-key": "SEU_SECRET_KEY"
    },
    json={
        "event_type": "purchase_approved",
        "external_event_id": f"EVT-{uuid.uuid4()}",
        "external_order_id": "ORD-12345",
        "payload": {
            "total_amount": 199.90,
            "payment_method": "pix",
            "customer": {
                "name": "João Silva",
                "email": "joao@email.com"
            }
        }
    }
)

print(response.json())`} />
              </TabsContent>
            </Tabs>

            {/* FAQ */}
            <SectionTitle id="faq">Perguntas Frequentes</SectionTitle>

            <Accordion type="single" collapsible className="mb-10">
              <AccordionItem value="q1">
                <AccordionTrigger className="text-sm">Como obtenho meu Pixel ID e Secret Key?</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">
                  Acesse o Estokfy, vá em <strong>Configurações → Integrações → Estokfy Pixel</strong>.
                  Clique em "Criar Pixel" se ainda não tiver um. Suas credenciais serão exibidas na tela.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="q2">
                <AccordionTrigger className="text-sm">Posso usar o pixel em mais de um site?</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">
                  Sim! Instale o mesmo snippet em quantos sites quiser. Se necessário, adicione os domínios
                  na lista de domínios autorizados. Todas as vendas entrarão na mesma conta do Estokfy.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="q3">
                <AccordionTrigger className="text-sm">O que acontece se eu enviar o mesmo evento duas vezes?</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">
                  Se o evento tiver o mesmo <code className="bg-muted px-1 py-0.5 rounded">external_event_id</code>,
                  o sistema reconhece como duplicata e não processa novamente. A API retorna o status do evento original.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="q4">
                <AccordionTrigger className="text-sm">O pixel funciona com WordPress / Shopify / sistemas próprios?</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">
                  Sim. O pixel é agnóstico de plataforma — basta ter a capacidade de fazer requisições HTTP POST.
                  Funciona com qualquer site, CMS ou backend que suporte JavaScript ou chamadas API.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="q5">
                <AccordionTrigger className="text-sm">Como sei se os eventos estão sendo recebidos?</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">
                  No painel do Estokfy, acesse <strong>Configurações → Integrações → Estokfy Pixel</strong> na
                  aba "Eventos". Lá você verá os últimos eventos recebidos, com status de processamento e
                  mensagens de erro, se houver.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="q6">
                <AccordionTrigger className="text-sm">Preciso enviar todos os campos do payload?</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">
                  Não. Os únicos campos obrigatórios são <code className="bg-muted px-1 py-0.5 rounded">event_type</code> e
                  as credenciais nos headers. Recomendamos enviar o máximo de informações possível para
                  enriquecer seus dados no Estokfy.
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Footer */}
            <div className="border-t pt-8 pb-20 sm:pb-16 text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Precisa de ajuda? Acesse o suporte dentro do sistema.
              </p>
              <Button onClick={() => navigate("/login")}>
                Acessar o Estokfy <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
