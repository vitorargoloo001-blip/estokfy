import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ShieldOff, LogOut, Mail } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function AccessSuspended() {
  const { signOut } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-8 pb-6 text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <ShieldOff className="w-8 h-8 text-destructive" />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-bold text-foreground">Acesso Suspenso</h1>
            <p className="text-muted-foreground text-sm">
              Seu acesso ao sistema foi temporariamente desativado.
              Para regularizar sua conta, entre em contato com o suporte responsável.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Button variant="outline" asChild>
              <a href="mailto:vitorargoloo001@gmail.com">
                <Mail className="mr-2 h-4 w-4" />
                Contato de suporte
              </a>
            </Button>
            <Button variant="ghost" onClick={() => signOut()}>
              <LogOut className="mr-2 h-4 w-4" />
              Sair da conta
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
