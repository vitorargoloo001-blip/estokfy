import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useMasterUser } from "@/hooks/useMasterUser";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

interface RequireMasterUserProps {
  children: ReactNode;
}

export default function RequireMasterUser({ children }: RequireMasterUserProps) {
  const { isMaster, loading } = useMasterUser();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isMaster) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="border-red-200 bg-red-50 max-w-md">
          <CardContent className="pt-8 text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-red-600 mx-auto" />
            <div>
              <h3 className="text-lg font-semibold text-red-900">
                Acesso Restrito
              </h3>
              <p className="text-sm text-red-700 mt-2">
                Esta seção é visível apenas para o usuário master.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
