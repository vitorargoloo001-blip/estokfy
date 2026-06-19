import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Plug } from "lucide-react";
import { useConnectModuleAccess } from "@/hooks/useConnectModuleAccess";
import ConnectOverview from "./ConnectOverview";

export default function ConnectIndex() {
  const { canAccess, isLoading, error } = useConnectModuleAccess();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <Card className="border-orange-200 bg-orange-50">
        <CardContent className="pt-8 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-orange-600 mx-auto" />
          <div>
            <h3 className="text-lg font-semibold text-orange-900">
              Estokfy Connect não ativado
            </h3>
            <p className="text-sm text-orange-700 mt-2">
              {error || "Este módulo não está disponível para sua loja. Entre em contato com o proprietário para ativar."}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Plug className="h-8 w-8" />
          Estokfy Connect
        </h1>
        <p className="text-muted-foreground mt-2">
          Conciliação bancária automática com inteligência em 3 passes
        </p>
      </div>
      <ConnectOverview />
    </div>
  );
}
