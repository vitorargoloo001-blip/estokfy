import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { OfflineProvider } from "@/contexts/OfflineContext";
import OfflineIndicator from "@/components/OfflineIndicator";
import OnboardingWizard from "@/components/OnboardingWizard";
import InteractiveGuide from "@/components/InteractiveGuide";
import { useStoreAccess } from "@/hooks/useStoreAccess";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

import Login from "./pages/Login";
import AppLayout from "./components/AppLayout";
import RequireRoleRoute from "./components/RequireRoleRoute";
import RequireConnectModule from "./components/RequireConnectModule";
import ErrorBoundary from "./components/ErrorBoundary";

// Lazy-loaded routes — reduce initial bundle (FCP)
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Products = lazy(() => import("./pages/Products"));
const Stock = lazy(() => import("./pages/Stock"));
const Sales = lazy(() => import("./pages/Sales"));
const NewSale = lazy(() => import("./pages/NewSale"));
const AccountsReceivable = lazy(() => import("./pages/AccountsReceivable"));
const AccountsPayable = lazy(() => import("./pages/AccountsPayable"));
const IdleProducts = lazy(() => import("./pages/IdleProducts"));
const Customers = lazy(() => import("./pages/Customers"));
const Deliveries = lazy(() => import("./pages/Deliveries"));
const Returns = lazy(() => import("./pages/Returns"));
const Finance = lazy(() => import("./pages/Finance"));
const Reports = lazy(() => import("./pages/Reports"));
const PurchasesReport = lazy(() => import("./pages/PurchasesReport"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const Categories = lazy(() => import("./pages/Categories"));
const AuditHistory = lazy(() => import("./pages/AuditHistory"));
const PixelSettings = lazy(() => import("./pages/PixelSettings"));
const NotFound = lazy(() => import("./pages/NotFound"));
const AccessSuspended = lazy(() => import("./pages/AccessSuspended"));
const PaymentVerification = lazy(() => import("./pages/PaymentVerification"));
const SuperAdminLayout = lazy(() => import("./pages/super-admin/SuperAdminLayout"));
const SuperAdminDashboard = lazy(() => import("./pages/super-admin/SuperAdminDashboard"));
const SuperAdminStores = lazy(() => import("./pages/super-admin/SuperAdminStores"));
const SuperAdminStoreDetail = lazy(() => import("./pages/super-admin/SuperAdminStoreDetail"));
const SuperAdminPaymentVerifications = lazy(() => import("./pages/super-admin/SuperAdminPaymentVerifications"));
const DocsPixel = lazy(() => import("./pages/DocsPixel"));
const Loyalty = lazy(() => import("./pages/Loyalty"));
const CustomerCredits = lazy(() => import("./pages/CustomerCredits"));
const TrocasReport = lazy(() => import("./pages/TrocasReport"));
const Presentation = lazy(() => import("./pages/Presentation"));
const Employees = lazy(() => import("./pages/Employees"));
const Help = lazy(() => import("./pages/Help"));
const ServiceOrdersIndex = lazy(() => import("./pages/ServiceOrders/Index"));
const ServiceOrderNew = lazy(() => import("./pages/ServiceOrders/New"));
const ServiceOrderDetail = lazy(() => import("./pages/ServiceOrders/Detail"));
// Estokfy Connect (premium module — gated by license via RequireConnectModule)
const ConnectIndex = lazy(() => import("./pages/Connect/Index"));
const ConnectConnections = lazy(() => import("./pages/Connect/Connections"));
const ConnectTransactions = lazy(() => import("./pages/Connect/Transactions"));
const ConnectReconciliation = lazy(() => import("./pages/Connect/ConnectReconciliation"));
const ConnectReports = lazy(() => import("./pages/Connect/ConnectReports"));
const ConnectAlerts = lazy(() => import("./pages/Connect/ConnectAlerts"));
const ConnectDiscrepancies = lazy(() => import("./pages/Connect/Discrepancies"));
const ConnectAudit = lazy(() => import("./pages/Connect/ConnectAudit"));
const ConnectSettings = lazy(() => import("./pages/Connect/Settings"));
const ConnectLicenses = lazy(() => import("./pages/Connect/ConnectLicenses"));
const ConnectHealth = lazy(() => import("./pages/Connect/ConnectionHealth"));
const ConnectAIInsights = lazy(() => import("./pages/Connect/AIInsights"));
const ConnectCashFlow = lazy(() => import("./pages/Connect/CashFlowForecast"));
const ConnectMasterDashboard = lazy(() => import("./pages/Connect/MasterDashboard"));
const ConnectAI = lazy(() => import("./pages/Connect/ConnectAI"));
const ConnectAutomations = lazy(() => import("./pages/Connect/ConnectAutomations"));
// Finance Platform (Block 8)
const FinanceDashboard = lazy(() => import("./pages/Finance/FinanceDashboard"));
// AI Copilot (Block 9)
const AIAssistant = lazy(() => import("./pages/AI/AIAssistant"));
const AIInsights = lazy(() => import("./pages/AI/AIInsights"));
const CEODashboard = lazy(() => import("./pages/AI/CEODashboard"));
const SuperAdminAI = lazy(() => import("./pages/super-admin/SuperAdminAI"));
const FluxoCaixa = lazy(() => import("./pages/Finance/FluxoCaixa"));
const DRE = lazy(() => import("./pages/Finance/DRE"));
const Metas = lazy(() => import("./pages/Finance/Metas"));
const SuperAdminModuleLicensing = lazy(() => import("./pages/super-admin/SuperAdminModuleLicensing"));
const FinancialDashboard = lazy(() => import("./pages/super-admin/FinancialDashboard"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

function ProtectedRoutes() {
  const { session, loading, bootstrapping, showGuide, setShowGuide } = useAuth();
  const { accessEnabled, needsPayment, loading: accessLoading } = useStoreAccess();
  const { isSuperAdmin, loading: saLoading } = useSuperAdmin();
  useRealtimeSync();

  if (loading || bootstrapping || accessLoading || saLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          {bootstrapping && <p className="text-sm text-muted-foreground">Configurando sua loja...</p>}
        </div>
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  if (needsPayment && !isSuperAdmin) return <Navigate to="/verificacao-pagamento" replace />;
  if (!accessEnabled && !isSuperAdmin) return <Navigate to="/acesso-suspenso" replace />;

  return (
    <>
      <OnboardingWizard />
      {/* <InteractiveGuide open={showGuide} onClose={() => setShowGuide(false)} /> */}
      <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="produtos" element={<RequireRoleRoute><Products /></RequireRoleRoute>} />
            <Route path="estoque" element={<RequireRoleRoute><Stock /></RequireRoleRoute>} />
            <Route path="vendas" element={<RequireRoleRoute><Sales /></RequireRoleRoute>} />
            <Route path="vendas/nova" element={<RequireRoleRoute><NewSale /></RequireRoleRoute>} />
            <Route path="contas-a-receber" element={<RequireRoleRoute><AccountsReceivable /></RequireRoleRoute>} />
            <Route path="contas-a-pagar" element={<RequireRoleRoute><AccountsPayable /></RequireRoleRoute>} />
            <Route path="produtos-parados" element={<RequireRoleRoute><IdleProducts /></RequireRoleRoute>} />
            <Route path="clientes" element={<RequireRoleRoute><Customers /></RequireRoleRoute>} />
            <Route path="fidelidade" element={<RequireRoleRoute><Loyalty /></RequireRoleRoute>} />
            <Route path="entregas" element={<RequireRoleRoute><Deliveries /></RequireRoleRoute>} />
            <Route path="trocas" element={<RequireRoleRoute><Returns /></RequireRoleRoute>} />
            <Route path="creditos" element={<RequireRoleRoute><CustomerCredits /></RequireRoleRoute>} />
            <Route path="financeiro" element={<RequireRoleRoute><Finance /></RequireRoleRoute>} />
            <Route path="relatorios" element={<RequireRoleRoute><Reports /></RequireRoleRoute>} />
            <Route path="relatorios/compras" element={<RequireRoleRoute><PurchasesReport /></RequireRoleRoute>} />
            <Route path="relatorios/trocas" element={<RequireRoleRoute><TrocasReport /></RequireRoleRoute>} />
            <Route path="configuracoes" element={<RequireRoleRoute><SettingsPage /></RequireRoleRoute>} />
            <Route path="categorias" element={<RequireRoleRoute><Categories /></RequireRoleRoute>} />
            <Route path="historico" element={<RequireRoleRoute><AuditHistory /></RequireRoleRoute>} />
            <Route path="pixel" element={<RequireRoleRoute><PixelSettings /></RequireRoleRoute>} />
            <Route path="funcionarios" element={<RequireRoleRoute><Employees /></RequireRoleRoute>} />
            <Route path="os" element={<RequireRoleRoute><ServiceOrdersIndex /></RequireRoleRoute>} />
            <Route path="os/nova" element={<RequireRoleRoute><ServiceOrderNew /></RequireRoleRoute>} />
            <Route path="os/:id" element={<RequireRoleRoute><ServiceOrderDetail /></RequireRoleRoute>} />
            {/* Estokfy Connect — premium module, gated by store license (RequireConnectModule) */}
            <Route path="connect" element={<RequireConnectModule><ConnectIndex /></RequireConnectModule>} />
            <Route path="connect/bancos" element={<RequireConnectModule><ConnectConnections /></RequireConnectModule>} />
            <Route path="connect/transacoes" element={<RequireConnectModule><ConnectTransactions /></RequireConnectModule>} />
            <Route path="connect/conciliacao" element={<RequireConnectModule><ConnectReconciliation /></RequireConnectModule>} />
            <Route path="connect/divergencias" element={<RequireConnectModule><ConnectDiscrepancies /></RequireConnectModule>} />
            <Route path="connect/auditoria" element={<RequireConnectModule><ConnectAudit /></RequireConnectModule>} />
            <Route path="connect/configuracoes" element={<RequireConnectModule><ConnectSettings /></RequireConnectModule>} />
            <Route path="connect/relatorios" element={<RequireConnectModule><ConnectReports /></RequireConnectModule>} />
            <Route path="connect/alertas" element={<RequireConnectModule><ConnectAlerts /></RequireConnectModule>} />
            <Route path="connect/saude" element={<RequireConnectModule><ConnectHealth /></RequireConnectModule>} />
            <Route path="connect/insights" element={<RequireConnectModule><ConnectAIInsights /></RequireConnectModule>} />
            <Route path="connect/fluxo" element={<RequireConnectModule><ConnectCashFlow /></RequireConnectModule>} />
            <Route path="connect/ia" element={<RequireConnectModule><ConnectAI /></RequireConnectModule>} />
            <Route path="connect/automacoes" element={<RequireConnectModule><ConnectAutomations /></RequireConnectModule>} />
            {/* Finance Platform */}
            <Route path="finance/dashboard" element={<RequireRoleRoute><FinanceDashboard /></RequireRoleRoute>} />
            <Route path="finance/fluxo-caixa" element={<RequireRoleRoute><FluxoCaixa /></RequireRoleRoute>} />
            <Route path="finance/dre" element={<RequireRoleRoute><DRE /></RequireRoleRoute>} />
            <Route path="finance/metas" element={<RequireRoleRoute><Metas /></RequireRoleRoute>} />
            {/* AI Copilot */}
            <Route path="ai" element={<RequireRoleRoute><AIAssistant /></RequireRoleRoute>} />
            <Route path="ai/insights" element={<RequireRoleRoute><AIInsights /></RequireRoleRoute>} />
            <Route path="ai/ceo" element={<RequireRoleRoute><CEODashboard /></RequireRoleRoute>} />
            <Route path="ajuda" element={<Help />} />
          </Route>
          <Route path="apresentacao" element={<Presentation />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </>
  );
}

function AuthRoutes() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Navigate to="/" replace />;
  return <Login />;
}

function PaymentVerificationRoute() {
  const { session, loading } = useAuth();
  const { needsPayment, loading: accessLoading } = useStoreAccess();
  const { isSuperAdmin, loading: saLoading } = useSuperAdmin();
  if (loading || accessLoading || saLoading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (!needsPayment || isSuperAdmin) return <Navigate to="/" replace />;
  return (
    <Suspense fallback={<RouteFallback />}>
      <PaymentVerification />
    </Suspense>
  );
}

function SuspendedRoute() {
  const { session, loading } = useAuth();
  const { accessEnabled, needsPayment, loading: accessLoading } = useStoreAccess();
  const { isSuperAdmin, loading: saLoading } = useSuperAdmin();
  if (loading || accessLoading || saLoading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (needsPayment && !isSuperAdmin) return <Navigate to="/verificacao-pagamento" replace />;
  if (accessEnabled || isSuperAdmin) return <Navigate to="/" replace />;
  return (
    <Suspense fallback={<RouteFallback />}>
      <AccessSuspended />
    </Suspense>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <OfflineProvider>
            <OfflineIndicator />
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/login" element={<AuthRoutes />} />
                <Route path="/docs/pixel" element={<DocsPixel />} />
                <Route path="/verificacao-pagamento" element={<PaymentVerificationRoute />} />
                <Route path="/acesso-suspenso" element={<SuspendedRoute />} />
                <Route path="/super-admin" element={<ErrorBoundary label="super-admin"><SuperAdminLayout /></ErrorBoundary>}>
                  <Route index element={<SuperAdminDashboard />} />
                  <Route path="stores" element={<SuperAdminStores />} />
                  <Route path="stores/:id" element={<SuperAdminStoreDetail />} />
                  <Route path="modules" element={<SuperAdminModuleLicensing />} />
                  <Route path="connect/licenses" element={<ConnectLicenses />} />
                  <Route path="connect/master" element={<ConnectMasterDashboard />} />
                  <Route path="financeiro" element={<FinancialDashboard />} />
                  <Route path="ai" element={<SuperAdminAI />} />
                  <Route path="payment-verifications" element={<SuperAdminPaymentVerifications />} />
                </Route>
                <Route path="/*" element={<ProtectedRoutes />} />
              </Routes>
            </Suspense>
          </OfflineProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
