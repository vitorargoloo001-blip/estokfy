import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, X, Maximize2, Grid3x3, Play,
  Package, ShoppingCart, Wallet, BarChart3, Gift, FileText,
  TrendingUp, Sparkles, Check, AlertTriangle, ArrowRight, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/* ========================================================================
   ESTOKFY — Apresentação Comercial Interativa Fullscreen
   Renderiza em 1920x1080 e escala via transform para qualquer tela.
======================================================================== */

const SLIDE_W = 1920;
const SLIDE_H = 1080;

// ============== UI atoms ==============
const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-blue-500/40 bg-blue-500/10 text-blue-300 text-[14px] font-bold tracking-widest uppercase">
    {children}
  </div>
);

const SectionTitle = ({ eyebrow, title }: { eyebrow: string; title: string }) => (
  <div className="space-y-5">
    <Eyebrow>{eyebrow}</Eyebrow>
    <h2 className="text-[64px] font-bold text-white leading-[1.05] tracking-tight">{title}</h2>
    <div className="flex gap-2">
      <div className="h-1 w-20 bg-blue-500 rounded" />
      <div className="h-1 w-8 bg-cyan-400 rounded" />
    </div>
  </div>
);

const SlideBg = ({ children, dark = true }: { children: React.ReactNode; dark?: boolean }) => (
  <div
    className={`relative w-full h-full overflow-hidden ${dark ? "bg-[#0A0F1E]" : "bg-white"}`}
    style={{
      backgroundImage: dark
        ? "radial-gradient(circle at 85% 95%, rgba(59,130,246,0.18), transparent 55%), radial-gradient(circle at 5% 5%, rgba(6,182,212,0.12), transparent 55%)"
        : undefined,
    }}
  >
    {dark && (
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />
    )}
    <div className="relative w-full h-full">{children}</div>
  </div>
);

const Logo = ({ size = 42 }: { size?: number }) => (
  <div className="inline-flex items-center gap-3">
    <div
      className="relative bg-blue-600 rounded-xl"
      style={{ width: size, height: size }}
    >
      <div
        className="absolute bg-cyan-400 rounded-md"
        style={{
          right: size * 0.1,
          bottom: size * 0.1,
          width: size * 0.45,
          height: size * 0.45,
        }}
      />
    </div>
    <span className="text-white font-bold tracking-tight" style={{ fontSize: size * 0.5 }}>
      ESTOKFY
    </span>
  </div>
);

const MockWindow = ({
  title, children,
}: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-[#1E2D52] bg-[#0B1424] overflow-hidden shadow-2xl">
    <div className="flex items-center gap-3 px-5 py-3 bg-[#0E1A30] border-b border-[#1E2D52]">
      <span className="w-3 h-3 rounded-full bg-red-500" />
      <span className="w-3 h-3 rounded-full bg-amber-500" />
      <span className="w-3 h-3 rounded-full bg-green-500" />
      <div className="mx-auto px-4 py-1 rounded-md bg-[#172446] text-slate-400 text-xs">
        {title}
      </div>
    </div>
    <div className="p-6">{children}</div>
  </div>
);

// ============== SLIDES ==============

// 1 — CAPA
const SlideCover = () => (
  <SlideBg>
    <div className="absolute right-[5%] top-[10%] text-[520px] font-black text-blue-500/[0.06] leading-none select-none">
      E
    </div>
    <div className="absolute top-16 left-20"><Logo size={50} /></div>
    <div className="absolute right-20 top-20 text-slate-400 text-base tracking-widest">
      EDIÇÃO 2026 · PREMIUM SAAS
    </div>
    <div className="absolute left-20 top-1/2 -translate-y-1/2 max-w-3xl">
      <h1 className="text-[180px] font-black text-white tracking-tighter leading-none">ESTOKFY</h1>
      <div className="flex gap-2 mt-4 mb-10">
        <div className="h-2 w-56 bg-blue-500 rounded" />
        <div className="h-2 w-20 bg-cyan-400 rounded" />
      </div>
      <p className="text-3xl text-slate-300 leading-snug max-w-2xl">
        Sistema inteligente de gestão para distribuidoras<br />e lojas de peças para celular.
      </p>
      <div className="flex flex-wrap gap-3 mt-10">
        {["Estoque", "Vendas", "Financeiro", "Relatórios", "Fidelidade"].map((t) => (
          <span key={t} className="px-5 py-2.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-sm font-bold">
            {t}
          </span>
        ))}
      </div>
      <button className="mt-10 inline-flex items-center gap-3 px-10 py-5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xl shadow-[0_20px_60px_-15px_rgba(59,130,246,0.6)] transition-all">
        Apresentação Comercial <ArrowRight size={22} />
      </button>
    </div>
  </SlideBg>
);

// 2 — PROBLEMA
const SlideProblem = () => {
  const pains = [
    "Estoque bagunçado e desatualizado",
    "Vendas perdidas por falta de produto",
    "Clientes devendo sem cobrança",
    "Controle manual em planilhas frágeis",
    "Ausência de relatórios confiáveis",
    "Erros financeiros diários",
    "Lucro escapando sem ninguém ver",
  ];
  const gains = [
    "Estoque sincronizado em tempo real",
    "Vendas rápidas, à vista e a prazo",
    "Cobrança automática e organizada",
    "Sistema robusto, multi-usuário",
    "Relatórios PDF inteligentes",
    "Financeiro 100% rastreável",
    "Lucro visível, decisões certeiras",
  ];
  return (
    <SlideBg>
      <div className="p-20 h-full flex flex-col">
        <SectionTitle eyebrow="01 · O DESAFIO" title="Sua operação está perdendo dinheiro." />
        <div className="grid grid-cols-2 gap-12 mt-14 flex-1">
          <div className="rounded-3xl bg-[#121C33] border border-red-500/30 p-10">
            <div className="text-red-400 text-sm font-bold tracking-widest mb-3">■ HOJE · SEM ESTOKFY</div>
            <h3 className="text-4xl font-bold text-white mb-8">Caos operacional</h3>
            <ul className="space-y-4">
              {pains.map((p) => (
                <li key={p} className="flex items-start gap-4 text-slate-200 text-xl">
                  <X className="text-red-400 mt-1 shrink-0" size={22} /> {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl bg-[#172446] border border-blue-500/40 p-10">
            <div className="text-blue-300 text-sm font-bold tracking-widest mb-3">■ COM ESTOKFY</div>
            <h3 className="text-4xl font-bold text-white mb-8">Operação no controle</h3>
            <ul className="space-y-4">
              {gains.map((g) => (
                <li key={g} className="flex items-start gap-4 text-slate-200 text-xl">
                  <Check className="text-green-400 mt-1 shrink-0" size={22} /> {g}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </SlideBg>
  );
};

// 3 — SOLUÇÃO (hub)
const SlideSolution = () => {
  const mods = [
    { name: "Estoque", desc: "Controle inteligente", icon: Package, x: -380, y: -180 },
    { name: "Vendas", desc: "Rápidas e auditadas", icon: ShoppingCart, x: 380, y: -180 },
    { name: "Financeiro", desc: "Caixa em tempo real", icon: Wallet, x: -480, y: 0 },
    { name: "Relatórios", desc: "PDFs profissionais", icon: FileText, x: 480, y: 0 },
    { name: "Fidelidade", desc: "Crédito automático", icon: Gift, x: -380, y: 180 },
    { name: "Cobrança", desc: "Central a receber", icon: BarChart3, x: 380, y: 180 },
  ];
  return (
    <SlideBg>
      <div className="p-20 h-full">
        <SectionTitle eyebrow="02 · A SOLUÇÃO" title="Tudo que sua loja precisa, integrado." />
        <div className="relative w-full" style={{ height: 700 }}>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="relative w-[340px] h-[340px] flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-cyan-500/20 animate-pulse" />
              <div className="absolute inset-6 rounded-full bg-blue-600 shadow-[0_0_80px_rgba(59,130,246,0.6)] flex flex-col items-center justify-center">
                <Logo size={56} />
                <div className="text-cyan-200 text-sm tracking-widest mt-3">ERP INTEGRADO</div>
              </div>
            </div>
          </div>
          {mods.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.name}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ transform: `translate(calc(-50% + ${m.x}px), calc(-50% + ${m.y}px))` }}
              >
                <div className="w-[280px] rounded-2xl border border-[#1E2D52] bg-[#172446] p-5 hover:border-blue-500/50 hover:-translate-y-1 transition-all">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                      <Icon className="text-blue-300" size={20} />
                    </div>
                    <div className="text-xl font-bold text-white">{m.name}</div>
                  </div>
                  <div className="text-sm text-slate-400">{m.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SlideBg>
  );
};

// 4 — DASHBOARD
const SlideDashboard = () => {
  const kpis = [
    { l: "VENDAS HOJE", v: "R$ 12.480", c: "border-l-blue-500" },
    { l: "RECEBIDO", v: "R$ 9.230", c: "border-l-green-500" },
    { l: "PENDENTE", v: "R$ 3.250", c: "border-l-amber-500" },
    { l: "LUCRO", v: "R$ 4.180", c: "border-l-cyan-500" },
  ];
  const bars = [40, 55, 38, 72, 60, 85, 68];
  const days = ["S", "T", "Q", "Q", "S", "S", "D"];
  const stock = [
    { n: "Tela iPhone 11", q: 2, c: "text-red-400" },
    { n: "Bateria S22", q: 4, c: "text-amber-400" },
    { n: "Conector Type-C", q: 6, c: "text-amber-400" },
    { n: "Fone Lightning", q: 1, c: "text-red-400" },
  ];
  return (
    <SlideBg>
      <div className="p-20 h-full grid grid-cols-[400px_1fr] gap-16">
        <div className="flex flex-col">
          <SectionTitle eyebrow="03 · DASHBOARD" title="Sua operação em uma única tela." />
          <div className="mt-12 space-y-8">
            {[
              { t: "Vendas do dia", d: "Faturamento em tempo real" },
              { t: "Estoque crítico", d: "Alertas automáticos de produtos em falta" },
              { t: "Métricas chave", d: "Lucro, recebido, pendente, devoluções" },
              { t: "Visão geral", d: "Decisões com dados, não achismos" },
            ].map((b) => (
              <div key={b.t} className="flex gap-4">
                <div className="w-9 h-9 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center shrink-0">
                  <Check className="text-blue-300" size={16} />
                </div>
                <div>
                  <div className="text-xl font-bold text-white">{b.t}</div>
                  <div className="text-base text-slate-400">{b.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center">
          <MockWindow title="estokfy.app/dashboard">
            <div className="grid grid-cols-4 gap-4 mb-6">
              {kpis.map((k) => (
                <div key={k.l} className={`rounded-xl bg-[#0F1B33] border border-[#1E2D52] border-l-4 ${k.c} p-5`}>
                  <div className="text-xs text-slate-400 font-bold tracking-wider">{k.l}</div>
                  <div className="text-3xl text-white font-bold mt-2">{k.v}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[1.6fr_1fr] gap-4">
              <div className="rounded-xl bg-[#0F1B33] border border-[#1E2D52] p-5">
                <div className="text-white font-bold mb-4">Vendas — últimos 7 dias</div>
                <div className="flex items-end gap-3 h-44">
                  {bars.map((b, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-2">
                      <div className="w-full rounded-t-md bg-gradient-to-t from-blue-600 to-cyan-400" style={{ height: `${b}%` }} />
                      <div className="text-xs text-slate-500">{days[i]}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-[#0F1B33] border border-[#1E2D52] p-5">
                <div className="text-white font-bold mb-4">Estoque crítico</div>
                <ul className="space-y-3">
                  {stock.map((s) => (
                    <li key={s.n} className="flex justify-between items-center text-sm">
                      <span className="text-slate-300">{s.n}</span>
                      <span className={`font-bold ${s.c}`}>{s.q} un</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </MockWindow>
        </div>
      </div>
    </SlideBg>
  );
};

// 5 — ESTOQUE
const SlideStock = () => {
  const rows = [
    ["Tela iPhone 13 Pro", "Telas", 12, "R$ 890,00", "ok"],
    ["Bateria Galaxy S22", "Baterias", 4, "R$ 145,00", "warn"],
    ["Cabo Lightning 1m", "Cabos", 87, "R$ 28,00", "ok"],
    ["Conector Type-C", "Conectores", 2, "R$ 18,00", "danger"],
    ["Fone Bluetooth Pro", "Áudio", 23, "R$ 219,00", "ok"],
    ["Tela Moto G54", "Telas", 9, "R$ 320,00", "ok"],
    ["Película Vidro 6.7\"", "Películas", 156, "R$ 12,00", "ok"],
  ] as const;
  const feats = [
    { i: "⌘", t: "Cadastro inteligente", d: "Adicione produtos em segundos com busca avançada" },
    { i: "↑", t: "Importação Excel", d: "Migre milhares de produtos em poucos cliques" },
    { i: "≡", t: "Edição em massa", d: "Atualize preços e categorias de uma só vez" },
    { i: "⊙", t: "Estoque mínimo", d: "Alertas antes de perder vendas" },
    { i: "◷", t: "Histórico completo", d: "Rastreie toda movimentação por usuário" },
  ];
  const badge = (s: string) =>
    s === "danger" ? "bg-red-500/20 text-red-400" : s === "warn" ? "bg-amber-500/20 text-amber-400" : "bg-green-500/20 text-green-400";
  return (
    <SlideBg>
      <div className="p-20 h-full flex flex-col">
        <SectionTitle eyebrow="04 · ESTOQUE" title="Controle inteligente do seu inventário." />
        <div className="grid grid-cols-[1.4fr_1fr] gap-10 mt-10 flex-1">
          <MockWindow title="estokfy.app/produtos">
            <div className="grid grid-cols-[2fr_1fr_0.6fr_0.8fr] gap-4 px-3 py-3 text-xs font-bold text-slate-400 tracking-wider border-b border-[#1E2D52]">
              <div>PRODUTO</div><div>CATEGORIA</div><div>ESTOQUE</div><div>PREÇO</div>
            </div>
            {rows.map(([n, c, q, p, s]) => (
              <div key={n as string} className="grid grid-cols-[2fr_1fr_0.6fr_0.8fr] gap-4 items-center px-3 py-4 border-b border-[#1E2D52]/60">
                <div className="text-white">{n}</div>
                <div className="text-slate-400">{c}</div>
                <div><span className={`px-3 py-1 rounded-md text-sm font-bold ${badge(s as string)}`}>{q}</span></div>
                <div className="text-white font-bold">{p}</div>
              </div>
            ))}
          </MockWindow>
          <div className="space-y-4">
            {feats.map((f) => (
              <div key={f.t} className="rounded-2xl bg-[#121C33] border border-[#1E2D52] p-6 flex gap-5 items-center hover:border-blue-500/40 transition-all">
                <div className="w-14 h-14 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-300 text-2xl font-bold shrink-0">
                  {f.i}
                </div>
                <div>
                  <div className="text-xl font-bold text-white">{f.t}</div>
                  <div className="text-sm text-slate-400">{f.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SlideBg>
  );
};

// 6 — VENDAS
const SlideSales = () => {
  const products = [
    ["Tela iPhone 13 Pro", 1, "R$ 890,00"],
    ["Cabo Lightning 1m", 2, "R$ 56,00"],
    ["Película Vidro 6.7\"", 1, "R$ 12,00"],
  ] as const;
  const feats = [
    ["Vendas em segundos", "Fluxo otimizado para alta rotatividade"],
    ["À vista ou a prazo", "Parcelamento e múltiplas formas de pagamento"],
    ["Edição auditada", "Toda alteração rastreada por usuário"],
    ["Vendas retroativas", "Lance vendas antigas sem perder histórico"],
    ["Observações livres", "Anote condições especiais por venda"],
  ];
  return (
    <SlideBg>
      <div className="p-20 h-full flex flex-col">
        <SectionTitle eyebrow="05 · VENDAS" title="Venda mais. Venda melhor." />
        <div className="grid grid-cols-[1.3fr_1fr] gap-12 mt-10 flex-1">
          <MockWindow title="estokfy.app/nova-venda">
            <div className="text-white font-bold text-xl mb-5">Nova venda · Cliente: João Silva</div>
            <div className="space-y-3">
              {products.map(([n, q, p]) => (
                <div key={n as string} className="rounded-xl bg-[#0F1B33] border border-[#1E2D52] p-4 flex items-center justify-between">
                  <div>
                    <div className="text-white font-bold">{n}</div>
                    <div className="text-xs text-slate-400">Qtd: {q}</div>
                  </div>
                  <div className="text-blue-300 font-bold text-lg">{p}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl bg-[#11203D] border border-blue-500/40 p-6 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400 font-bold tracking-wider">TOTAL</div>
                <div className="text-4xl text-white font-bold mt-1">R$ 958,00</div>
              </div>
              <button className="px-7 py-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold inline-flex items-center gap-2">
                Finalizar venda <ArrowRight size={18} />
              </button>
            </div>
          </MockWindow>
          <div className="space-y-7 self-center">
            {feats.map(([t, d]) => (
              <div key={t} className="flex gap-4">
                <div className="text-cyan-400 text-2xl leading-none">▸</div>
                <div>
                  <div className="text-2xl font-bold text-white">{t}</div>
                  <div className="text-base text-slate-400 mt-1">{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SlideBg>
  );
};

// 7 — CONTAS A RECEBER
const SlideReceivable = () => {
  const customers = [
    ["João Silva", "R$ 1.840", false],
    ["Maria Costa", "R$ 920", false],
    ["Pedro Lima", "R$ 3.250", true],
    ["Lojão Cell", "R$ 5.180", false],
    ["Ana Souza", "R$ 720", false],
  ] as const;
  const sales = [
    ["12/04/2026", "Venda #2841", "VENCIDA", "R$ 1.250", "danger"],
    ["28/04/2026", "Venda #2890", "A VENCER", "R$ 980", "warn"],
    ["03/05/2026", "Venda #2912", "A VENCER", "R$ 1.020", "warn"],
  ] as const;
  return (
    <SlideBg>
      <div className="p-20 h-full">
        <SectionTitle eyebrow="06 · CONTAS A RECEBER" title="Central inteligente de cobrança." />
        <div className="grid grid-cols-3 gap-5 mt-10">
          {[
            ["Total a receber", "R$ 18.420", "bg-blue-500"],
            ["Vencido", "R$ 4.180", "bg-red-500"],
            ["Pendentes", "23 contas", "bg-amber-500"],
          ].map(([l, v, c]) => (
            <div key={l} className="rounded-2xl bg-[#172446] border border-[#1E2D52] p-7 relative overflow-hidden">
              <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${c}`} />
              <div className="text-xs text-slate-400 font-bold tracking-wider uppercase">{l}</div>
              <div className="text-4xl text-white font-bold mt-3">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <MockWindow title="estokfy.app/contas-a-receber">
            <div className="grid grid-cols-[1fr_1.6fr] gap-4">
              <div className="rounded-xl bg-[#0F1B33] border border-[#1E2D52] p-4">
                <div className="text-white font-bold mb-3">Clientes devedores</div>
                {customers.map(([n, v, sel]) => (
                  <div key={n as string} className={`flex items-center justify-between p-3 rounded-lg mb-1 ${sel ? "bg-blue-500/15 border border-blue-500/30" : ""}`}>
                    <div>
                      <div className="text-white font-bold text-sm">{n}</div>
                      <div className="text-xs text-slate-500">Total pendente</div>
                    </div>
                    <div className={`font-bold text-sm ${sel ? "text-red-400" : "text-blue-300"}`}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl bg-[#0F1B33] border border-[#1E2D52] p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-white font-bold text-lg">Pedro Lima · 3 contas em aberto</div>
                  <div className="text-2xl text-red-400 font-bold">R$ 3.250,00</div>
                </div>
                <div className="space-y-3">
                  {sales.map(([d, r, st, v, c]) => (
                    <div key={r as string} className="rounded-lg bg-[#11203D] border border-[#1E2D52] p-3 flex items-center gap-4">
                      <div className="flex-1">
                        <div className="text-xs text-slate-500">{d}</div>
                        <div className="text-white font-bold">{r}</div>
                      </div>
                      <span className={`px-3 py-1 rounded-md text-xs font-bold ${c === "danger" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>{st}</span>
                      <div className="text-white font-bold">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </MockWindow>
        </div>
      </div>
    </SlideBg>
  );
};

// 8 — FIDELIDADE
const SlideLoyalty = () => (
  <SlideBg>
    <div className="p-20 h-full flex flex-col">
      <SectionTitle eyebrow="07 · FIDELIDADE" title="Transforme clientes em recorrência." />
      <div className="rounded-3xl bg-[#172446] border border-cyan-500/40 p-12 mt-10 relative overflow-hidden">
        <div className="text-cyan-300 text-sm font-bold tracking-widest mb-3">PROGRAMA DE CRÉDITO AUTOMÁTICO</div>
        <h3 className="text-6xl font-bold text-white">A cada R$ 1.000 → R$ 80 de crédito.</h3>
        <p className="text-xl text-slate-400 mt-4 max-w-3xl">
          Crédito gerado automaticamente quando a venda é paga.<br />
          Cliente volta. Fatura cresce. Margem aumenta.
        </p>
        <div className="absolute right-12 top-1/2 -translate-y-1/2 text-right">
          <div className="text-[180px] font-black text-blue-500 leading-none">8%</div>
          <div className="text-slate-400 text-base mt-2">cashback efetivo</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-6 mt-10">
        {[
          ["Crédito automático", "Calculado e creditado sem ação manual"],
          ["Ranking de clientes", "Identifique seus top compradores"],
          ["Recorrência garantida", "Estímulo real para recompra"],
        ].map(([t, d], i) => (
          <div key={t} className="rounded-2xl bg-[#121C33] border border-[#1E2D52] p-7">
            <div className="w-10 h-10 rounded-full bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center text-cyan-300 font-bold mb-4">
              {i + 1}
            </div>
            <div className="text-2xl font-bold text-white">{t}</div>
            <div className="text-base text-slate-400 mt-2">{d}</div>
          </div>
        ))}
      </div>
    </div>
  </SlideBg>
);

// 9 — RELATÓRIOS
const SlideReports = () => {
  const lines = [
    ["Vendas realizadas", "R$ 12.480,00"],
    ["Recebido em caixa", "R$ 9.230,00"],
    ["Lucro bruto", "R$ 4.180,00"],
    ["Despesas", "R$ 720,00"],
    ["Devoluções", "R$ 320,00"],
    ["Saldo do dia", "R$ 8.190,00"],
  ];
  const top = [
    ["Tela iPhone 13", 5],
    ["Cabo Lightning", 12],
    ["Película 6.7\"", 18],
    ["Bateria S22", 3],
  ] as const;
  return (
    <SlideBg>
      <div className="p-20 h-full grid grid-cols-[480px_1fr] gap-16">
        <div className="rounded-2xl bg-slate-50 overflow-hidden shadow-2xl self-center">
          <div className="bg-slate-900 text-white p-6 flex items-center justify-between">
            <div>
              <div className="text-xl font-bold">RELATÓRIO DIÁRIO</div>
              <div className="text-xs text-slate-400 mt-1">07 de Maio de 2026 · Estokfy</div>
            </div>
            <div className="w-9 h-9 rounded-full bg-blue-500" />
          </div>
          <div className="p-7 space-y-3">
            {lines.map(([l, v]) => (
              <div key={l} className="flex justify-between border-b border-slate-200 pb-2.5">
                <span className="text-slate-600">{l}</span>
                <span className="text-slate-900 font-bold">{v}</span>
              </div>
            ))}
            <div className="text-slate-900 font-bold mt-5">Top produtos</div>
            {top.map(([n, q]) => (
              <div key={n as string} className="flex items-center gap-3">
                <div className="text-xs text-slate-600 w-32">{n}</div>
                <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500" style={{ width: `${(q as number) * 5}%` }} />
                </div>
                <div className="text-xs text-slate-500 font-bold w-12">{q} un</div>
              </div>
            ))}
          </div>
        </div>
        <div className="self-center">
          <SectionTitle eyebrow="08 · RELATÓRIOS" title="Relatórios PDF que vendem por você." />
          <p className="text-xl text-slate-400 mt-6 max-w-2xl">
            Relatórios diários, mensais e personalizados gerados em 1 clique. Layout limpo, profissional, pronto para enviar a sócios e contadores.
          </p>
          <div className="grid grid-cols-2 gap-x-10 gap-y-5 mt-10">
            {["Vendas detalhadas", "Caixa e fluxo", "Lucro por categoria", "Top produtos vendidos", "Formas de pagamento", "Resumo financeiro"].map((f) => (
              <div key={f} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center">
                  <Check className="text-cyan-300" size={16} />
                </div>
                <div className="text-lg font-bold text-white">{f}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SlideBg>
  );
};

// 10 — FINANCEIRO
const SlideFinance = () => {
  const blocks = [
    { t: "Contas a pagar", v: "R$ 6.840", s: "12 contas", c: "bg-red-500", text: "text-red-400" },
    { t: "Contas a receber", v: "R$ 18.420", s: "23 contas", c: "bg-blue-500", text: "text-blue-400" },
    { t: "Caixa atual", v: "R$ 24.180", s: "Saldo real", c: "bg-green-500", text: "text-green-400" },
    { t: "Despesas do mês", v: "R$ 3.220", s: "Operacional", c: "bg-amber-500", text: "text-amber-400" },
  ];
  return (
    <SlideBg>
      <div className="p-20 h-full flex flex-col">
        <SectionTitle eyebrow="09 · FINANCEIRO" title="Caixa real. Decisão certeira." />
        <div className="grid grid-cols-2 gap-7 mt-12 flex-1 content-start">
          {blocks.map((b) => (
            <div key={b.t} className="relative rounded-3xl bg-[#121C33] border border-[#1E2D52] p-9 overflow-hidden h-[230px]">
              <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${b.c}`} />
              <div className="text-xs text-slate-400 font-bold tracking-widest uppercase">{b.t}</div>
              <div className="text-6xl font-black text-white mt-4">{b.v}</div>
              <div className={`text-base mt-4 ${b.text}`}>{b.s}</div>
            </div>
          ))}
        </div>
      </div>
    </SlideBg>
  );
};

// 11 — DIFERENCIAIS
const SlideDifferentials = () => {
  const items = [
    ["01", "Velocidade real", "Operação fluida, sem travamentos, com sincronização instantânea."],
    ["02", "Interface premium", "Design pensado para uso intenso no dia a dia da loja."],
    ["03", "Automações nativas", "Cobrança, crédito, alertas e relatórios sem trabalho manual."],
    ["04", "Pensado para distribuidoras", "Funcionalidades específicas do mercado de peças."],
    ["05", "Tudo integrado", "Estoque, vendas, financeiro e relatórios em um só sistema."],
    ["06", "Suporte humano", "Equipe dedicada para garantir sua operação no ar."],
  ];
  return (
    <SlideBg>
      <div className="p-20 h-full flex flex-col">
        <SectionTitle eyebrow="10 · DIFERENCIAIS" title="Por que Estokfy é diferente." />
        <div className="grid grid-cols-3 gap-6 mt-12 flex-1 content-start">
          {items.map(([n, t, d]) => (
            <div key={t} className="rounded-2xl bg-[#121C33] border border-[#1E2D52] p-7 hover:border-blue-500/40 transition-all">
              <div className="text-blue-500/60 text-5xl font-black">{n}</div>
              <div className="text-2xl font-bold text-white mt-3">{t}</div>
              <div className="text-base text-slate-400 mt-2">{d}</div>
            </div>
          ))}
        </div>
      </div>
    </SlideBg>
  );
};

// 12 — RESULTADOS
const SlideResults = () => {
  const stats = [
    ["+47%", "controle operacional", "text-blue-400"],
    ["-68%", "erros financeiros", "text-green-400"],
    ["3x", "mais velocidade", "text-cyan-400"],
    ["100%", "rastreabilidade", "text-blue-300"],
  ];
  return (
    <SlideBg>
      <div className="p-20 h-full flex flex-col">
        <SectionTitle eyebrow="11 · RESULTADOS" title="O que muda na sua operação." />
        <div className="grid grid-cols-4 gap-6 mt-16">
          {stats.map(([big, lbl, col]) => (
            <div key={lbl} className="rounded-3xl bg-[#172446] border border-[#1E2D52] p-10 text-center">
              <div className={`text-7xl font-black ${col}`}>{big}</div>
              <div className="text-base text-slate-400 mt-3">{lbl}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-6 mt-auto pb-4">
          {["Mais lucro", "Menos retrabalho", "Crescimento organizado", "Profissionalismo real"].map((b) => (
            <div key={b} className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <div className="text-xl font-bold text-white">{b}</div>
            </div>
          ))}
        </div>
      </div>
    </SlideBg>
  );
};

// 13 — CTA
const SlideCTA = () => (
  <SlideBg>
    <div className="absolute top-16 left-1/2 -translate-x-1/2"><Logo size={50} /></div>
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-20">
      <h2 className="text-7xl font-bold text-white leading-tight">Sua operação merece</h2>
      <h2 className="text-7xl font-bold mt-3">
        <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent">um sistema profissional.</span>
      </h2>
      <p className="text-2xl text-slate-400 mt-8">Transforme sua distribuidora com o Estokfy.</p>
      <button className="mt-12 inline-flex items-center gap-3 px-12 py-6 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-2xl shadow-[0_25px_80px_-15px_rgba(59,130,246,0.7)] transition-all">
        Vamos implementar na sua empresa <ArrowRight size={26} />
      </button>
      <div className="mt-10 text-slate-500 text-base">
        estokfy.app · contato@estokfy.com · Atibaia/SP
      </div>
    </div>
  </SlideBg>
);

// ============== Slide registry ==============
const SLIDES = [
  { id: 1, title: "Capa", component: SlideCover },
  { id: 2, title: "O Desafio", component: SlideProblem },
  { id: 3, title: "A Solução", component: SlideSolution },
  { id: 4, title: "Dashboard", component: SlideDashboard },
  { id: 5, title: "Estoque", component: SlideStock },
  { id: 6, title: "Vendas", component: SlideSales },
  { id: 7, title: "Contas a Receber", component: SlideReceivable },
  { id: 8, title: "Fidelidade", component: SlideLoyalty },
  { id: 9, title: "Relatórios", component: SlideReports },
  { id: 10, title: "Financeiro", component: SlideFinance },
  { id: 11, title: "Diferenciais", component: SlideDifferentials },
  { id: 12, title: "Resultados", component: SlideResults },
  { id: 13, title: "CTA", component: SlideCTA },
];

// ============== Scaled slide stage ==============
function ScaledSlide({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      setScale(Math.min(clientWidth / SLIDE_W, clientHeight / SLIDE_H));
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <div
        className="absolute"
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          left: "50%",
          top: "50%",
          marginLeft: -SLIDE_W / 2,
          marginTop: -SLIDE_H / 2,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ============== Page ==============
export default function Presentation() {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [showGrid, setShowGrid] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, SLIDES.length - 1)), []);
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev(); }
      else if (e.key === "Escape") { setShowGrid(false); }
      else if (e.key.toLowerCase() === "g") { setShowGrid((v) => !v); }
      else if (e.key === "F5" || e.key.toLowerCase() === "f") { e.preventDefault(); toggleFs(); }
      else if (e.key === "Home") { setIndex(0); }
      else if (e.key === "End") { setIndex(SLIDES.length - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  const toggleFs = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  useEffect(() => {
    const handler = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const Current = SLIDES[index].component;

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-5 py-3 bg-[#05080F]/90 backdrop-blur border-b border-white/5">
        <div className="flex items-center gap-3">
          <Logo size={28} />
          <span className="text-slate-500 text-sm hidden md:inline">· Apresentação Comercial</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowGrid((v) => !v)} className="text-slate-300 hover:text-white">
            <Grid3x3 size={16} className="mr-2" /> Slides
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleFs} className="text-slate-300 hover:text-white">
            <Maximize2 size={16} className="mr-2" /> {isFs ? "Sair" : "Fullscreen"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="text-slate-300 hover:text-white">
            <X size={16} />
          </Button>
        </div>
      </div>

      {/* Stage */}
      <div className="flex-1 relative bg-black">
        <ScaledSlide>
          <Current />
        </ScaledSlide>

        {/* Side nav */}
        <button
          onClick={prev}
          disabled={index === 0}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-white flex items-center justify-center disabled:opacity-30 transition-all"
        >
          <ChevronLeft />
        </button>
        <button
          onClick={next}
          disabled={index === SLIDES.length - 1}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-white flex items-center justify-center disabled:opacity-30 transition-all"
        >
          <ChevronRight />
        </button>

        {/* Bottom progress */}
        <div className="absolute left-0 right-0 bottom-0">
          <div className="h-1 bg-white/5">
            <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500"
                 style={{ width: `${((index + 1) / SLIDES.length) * 100}%` }} />
          </div>
          <div className="flex items-center justify-between px-5 py-3 text-xs text-slate-400 bg-[#05080F]/90 backdrop-blur">
            <div>{SLIDES[index].title}</div>
            <div className="flex gap-1">
              {SLIDES.map((_, i) => (
                <button key={i} onClick={() => setIndex(i)}
                  className={`h-1.5 rounded-full transition-all ${i === index ? "w-8 bg-blue-500" : "w-2 bg-white/15 hover:bg-white/30"}`} />
              ))}
            </div>
            <div className="font-bold text-white">{String(index + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}</div>
          </div>
        </div>
      </div>

      {/* Grid overlay */}
      {showGrid && (
        <div className="absolute inset-0 z-20 bg-[#05080F]/95 backdrop-blur-md p-10 overflow-auto">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-2xl font-bold text-white">Todos os slides</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowGrid(false)} className="text-slate-300">
              <X size={16} className="mr-2" /> Fechar (Esc)
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {SLIDES.map((s, i) => {
              const C = s.component;
              return (
                <button
                  key={s.id}
                  onClick={() => { setIndex(i); setShowGrid(false); }}
                  className={`group rounded-xl overflow-hidden border transition-all text-left ${i === index ? "border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.4)]" : "border-white/10 hover:border-blue-500/50"}`}
                >
                  <div className="aspect-video bg-black relative">
                    <ScaledSlide><C /></ScaledSlide>
                  </div>
                  <div className="px-4 py-3 bg-[#0B1424] flex items-center justify-between">
                    <div className="text-white text-sm font-bold">{String(i + 1).padStart(2, "0")} · {s.title}</div>
                    {i === index && <Play size={14} className="text-blue-400" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
