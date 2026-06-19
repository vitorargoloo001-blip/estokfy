import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Landmark, Info } from "lucide-react";

export default function ConnectBankFlow() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Conexões Bancárias</CardTitle>
          <CardDescription>
            Gerencie as contas bancárias da sua loja
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-dashed rounded-lg p-8 text-center space-y-4">
            <Landmark className="h-12 w-12 mx-auto text-primary" />
            <div>
              <h3 className="font-semibold">Gerenciar contas</h3>
              <p className="text-sm text-muted-foreground">
                Cadastre e acompanhe as contas bancárias na tela de Bancos.
              </p>
            </div>
            <Button asChild size="lg">
              <Link to="/connect/bancos">Ir para Bancos</Link>
            </Button>
          </div>

          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>
              A conexão automática por OAuth (importação de extrato em tempo real) será
              habilitada na integração com o provedor bancário. Por enquanto, as contas são
              cadastradas manualmente.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
