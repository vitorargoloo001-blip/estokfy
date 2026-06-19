import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { Upload, CheckCircle2, Clock, Mail, CreditCard, Loader2, FileImage, ArrowRight, ShieldCheck, RefreshCw, AlertTriangle, MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type PaymentStatus = 'pending' | 'under_review' | 'waiting_admin_approval' | 'approved_by_admin' | 'rejected' | 'needs_resubmission';

interface Verification {
  id: string;
  payment_status: PaymentStatus;
  uploaded_file_url: string | null;
  ai_reason: string | null;
  plan_id: string;
  expected_amount: number;
}

const STEPS = [
  { icon: Mail, label: 'Criar conta' },
  { icon: CheckCircle2, label: 'Verificar e-mail' },
  { icon: Upload, label: 'Enviar comprovante' },
  { icon: ShieldCheck, label: 'Aprovação do admin' },
  { icon: ArrowRight, label: 'Acesso liberado' },
];

const STATUS_MESSAGES: Record<PaymentStatus, string> = {
  pending: 'Seu comprovante ainda não foi enviado.',
  under_review: 'Seu comprovante foi recebido e está sendo analisado.',
  waiting_admin_approval: 'Seu comprovante foi recebido e está aguardando validação final do administrador.',
  approved_by_admin: 'Pagamento aprovado pelo administrador! Redirecionando para o sistema...',
  rejected: 'Seu comprovante não foi aprovado. Você pode enviar novamente ou entrar em contato com o suporte.',
  needs_resubmission: 'O administrador solicitou um novo comprovante. Por favor, envie novamente.',
};

function getActiveStep(emailVerified: boolean, status: PaymentStatus): number {
  if (!emailVerified) return 1;
  if (status === 'pending' || status === 'rejected' || status === 'needs_resubmission') return 2;
  if (status === 'under_review' || status === 'waiting_admin_approval') return 3;
  if (status === 'approved_by_admin') return 4;
  return 2;
}

export default function PaymentVerification() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [verification, setVerification] = useState<Verification | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const emailVerified = !!user?.email_confirmed_at;

  const fetchVerification = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('payment_verifications')
      .select('id, payment_status, uploaded_file_url, ai_reason, plan_id, expected_amount')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setVerification(data as Verification | null);
    setLoading(false);
    return data as Verification | null;
  }, [user]);

  useEffect(() => { fetchVerification(); }, [fetchVerification]);

  const handleRefreshStatus = async () => {
    setRefreshing(true);
    try {
      const updated = await fetchVerification();

      // Only redirect if admin has manually approved AND store access is enabled
      if (user && updated?.payment_status === 'approved_by_admin') {
        const { data: profile } = await supabase
          .from('profiles')
          .select('store_id')
          .eq('auth_user_id', user.id)
          .limit(1)
          .maybeSingle();

        if (profile?.store_id) {
          const { data: store } = await supabase
            .from('stores')
            .select('access_enabled')
            .eq('id', profile.store_id)
            .single();

          if (store?.access_enabled) {
            toast.success('Acesso liberado pelo administrador! Redirecionando...');
            setTimeout(() => navigate('/', { replace: true }), 1000);
            return;
          }
        }
      }

      const currentStatus = (updated?.payment_status || 'pending') as PaymentStatus;
      if (currentStatus === 'waiting_admin_approval') {
        toast.info('Seu comprovante está aguardando aprovação do administrador.');
      } else if (currentStatus === 'under_review') {
        toast.info('Seu comprovante ainda está sendo analisado.');
      } else if (currentStatus === 'rejected') {
        toast.error('Comprovante não aprovado. Tente enviar novamente.');
      } else if (currentStatus === 'needs_resubmission') {
        toast.warning('O administrador solicitou um novo comprovante.');
      } else {
        toast.info('Status atualizado.');
      }
    } catch {
      toast.error('Não foi possível atualizar o status agora. Tente novamente.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 10MB.');
      return;
    }
    setFile(f);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  };

  const handleSubmit = async () => {
    if (!file || !verification || !user) return;

    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const filePath = `${user.id}/${verification.id}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('payment-receipts')
        .upload(filePath, file, { upsert: true });

      if (upErr) throw new Error('Erro ao enviar arquivo: ' + upErr.message);

      setUploading(false);
      setAnalyzing(true);

      await invokeEdgeFunction<{ status: string; reason: string; confidence: number }>(
        'verify-payment',
        { body: { verification_id: verification.id, file_url: filePath }, timeout: 60000 }
      );

      toast.success('Comprovante enviado! Aguardando aprovação do administrador.');
      await fetchVerification();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao processar comprovante');
    } finally {
      setUploading(false);
      setAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const status = (verification?.payment_status || 'pending') as PaymentStatus;
  const activeStep = getActiveStep(emailVerified, status);
  const canUpload = status === 'pending' || status === 'rejected' || status === 'needs_resubmission';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Stepper */}
        <div className="flex items-center justify-between px-2">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const done = i < activeStep;
            const active = i === activeStep;
            return (
              <div key={i} className="flex flex-col items-center gap-1 flex-1">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors ${
                  done ? 'bg-primary border-primary text-primary-foreground' :
                  active ? 'border-primary text-primary' :
                  'border-muted text-muted-foreground'
                }`}>
                  <Icon className="h-4 w-4" />
                </div>
                <span className={`text-[10px] text-center leading-tight ${done || active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Approved by admin */}
        {status === 'approved_by_admin' && (
          <Card className="border-green-500/50 shadow-lg">
            <CardContent className="pt-6 text-center space-y-3">
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
              <h2 className="text-xl font-bold">Acesso liberado!</h2>
              <p className="text-muted-foreground">{STATUS_MESSAGES.approved_by_admin}</p>
              <Button onClick={() => navigate('/', { replace: true })} className="w-full">
                Entrar no sistema
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Waiting admin approval */}
        {status === 'waiting_admin_approval' && (
          <Card className="border-amber-500/50 shadow-lg">
            <CardContent className="pt-6 text-center space-y-4">
              <Clock className="h-16 w-16 text-amber-500 mx-auto" />
              <h2 className="text-xl font-bold">Aguardando aprovação</h2>
              <p className="text-muted-foreground">{STATUS_MESSAGES.waiting_admin_approval}</p>
              <Button
                variant="outline"
                onClick={handleRefreshStatus}
                disabled={refreshing}
                className="gap-2"
              >
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {refreshing ? 'Consultando...' : 'Atualizar status'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Under review (AI analyzing) */}
        {status === 'under_review' && (
          <Card className="border-blue-500/50 shadow-lg">
            <CardContent className="pt-6 text-center space-y-4">
              <Loader2 className="h-16 w-16 text-blue-500 mx-auto animate-spin" />
              <h2 className="text-xl font-bold">Analisando comprovante</h2>
              <p className="text-muted-foreground">{STATUS_MESSAGES.under_review}</p>
              <Button
                variant="outline"
                onClick={handleRefreshStatus}
                disabled={refreshing}
                className="gap-2"
              >
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {refreshing ? 'Consultando...' : 'Atualizar status'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Rejected */}
        {status === 'rejected' && (
          <Card className="border-red-500/50 shadow-lg">
            <CardHeader className="text-center pb-2">
              <AlertTriangle className="h-14 w-14 text-red-500 mx-auto mb-2" />
              <CardTitle className="text-xl">Comprovante não aprovado</CardTitle>
              <CardDescription>
                {verification?.ai_reason && (
                  <span className="block text-red-500 mb-2">{verification.ai_reason}</span>
                )}
                {STATUS_MESSAGES.rejected}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <UploadArea file={file} preview={preview} emailVerified={emailVerified} onFileChange={handleFileChange} />
              <Button className="w-full" size="lg" disabled={!file || !emailVerified || uploading || analyzing} onClick={handleSubmit}>
                <SubmitLabel uploading={uploading} analyzing={analyzing} label="Enviar novamente" />
              </Button>
              <Button variant="outline" className="w-full gap-2" onClick={handleRefreshStatus} disabled={refreshing}>
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {refreshing ? 'Consultando...' : 'Atualizar status'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Needs resubmission */}
        {status === 'needs_resubmission' && (
          <Card className="border-orange-500/50 shadow-lg">
            <CardHeader className="text-center pb-2">
              <Upload className="h-14 w-14 text-orange-500 mx-auto mb-2" />
              <CardTitle className="text-xl">Novo comprovante solicitado</CardTitle>
              <CardDescription>
                {verification?.ai_reason && (
                  <span className="block text-orange-600 mb-2">{verification.ai_reason}</span>
                )}
                {STATUS_MESSAGES.needs_resubmission}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <UploadArea file={file} preview={preview} emailVerified={emailVerified} onFileChange={handleFileChange} />
              <Button className="w-full" size="lg" disabled={!file || !emailVerified || uploading || analyzing} onClick={handleSubmit}>
                <SubmitLabel uploading={uploading} analyzing={analyzing} label="Enviar novo comprovante" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Pending — show upload */}
        {status === 'pending' && (
          <Card className="shadow-lg">
            <CardHeader className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <CreditCard className="h-7 w-7" />
              </div>
              <CardTitle className="text-xl">Verificação de Pagamento</CardTitle>
              <CardDescription>
                Envie o comprovante de pagamento Pix para liberar seu acesso.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!emailVerified && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-400">
                  ⚠️ Verifique seu e-mail antes de enviar o comprovante.
                </div>
              )}
              <div className="rounded-lg bg-muted p-4 space-y-2 text-sm">
                <p className="font-semibold">Dados para pagamento via Pix:</p>
                <p><span className="text-muted-foreground">Nome:</span> VITOR DE OLIVEIRA ARGOLO</p>
                <p><span className="text-muted-foreground">Chave Pix (CPF):</span> 587.686.978-30</p>
                <p><span className="text-muted-foreground">Banco:</span> BANCO INTER</p>
              </div>
              <UploadArea file={file} preview={preview} emailVerified={emailVerified} onFileChange={handleFileChange} />
              <Button className="w-full" size="lg" disabled={!file || !emailVerified || uploading || analyzing} onClick={handleSubmit}>
                <SubmitLabel uploading={uploading} analyzing={analyzing} label="Enviar comprovante" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Support */}
        {(status !== 'pending' && status !== 'approved_by_admin') && (
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">Precisa de ajuda?</p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" size="sm" className="gap-1.5"
                onClick={() => window.open(
                  `https://wa.me/5511999999999?text=${encodeURIComponent(`Olá, preciso de ajuda com a verificação de pagamento. ID: ${verification?.id}`)}`,
                  '_blank'
                )}
              >
                <MessageCircle className="h-3.5 w-3.5" />WhatsApp
              </Button>
              <Button variant="outline" size="sm"
                onClick={() => window.open(
                  `mailto:suporte@lojadepecas.com?subject=Verificação de pagamento&body=${encodeURIComponent(`ID: ${verification?.id}\nE-mail: ${user?.email}`)}`,
                  '_blank'
                )}
              >
                E-mail
              </Button>
            </div>
          </div>
        )}

        <div className="text-center">
          <button onClick={() => supabase.auth.signOut()} className="text-sm text-muted-foreground hover:underline">
            Sair da conta
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadArea({ file, preview, emailVerified, onFileChange }: {
  file: File | null; preview: string | null; emailVerified: boolean;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label htmlFor="receipt-upload"
        className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 p-6 cursor-pointer hover:border-primary/50 transition-colors">
        {preview ? (
          <img src={preview} alt="Preview" className="max-h-48 rounded-lg object-contain" />
        ) : file ? (
          <><FileImage className="h-10 w-10 text-muted-foreground" /><span className="text-sm text-muted-foreground">{file.name}</span></>
        ) : (
          <><Upload className="h-10 w-10 text-muted-foreground" /><span className="text-sm text-muted-foreground">Clique para enviar o comprovante</span><span className="text-xs text-muted-foreground">JPG, PNG ou PDF (máx 10MB)</span></>
        )}
      </label>
      <input id="receipt-upload" type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={onFileChange} disabled={!emailVerified} />
    </div>
  );
}

function SubmitLabel({ uploading, analyzing, label }: { uploading: boolean; analyzing: boolean; label: string }) {
  if (uploading) return <><Loader2 className="h-4 w-4 animate-spin mr-2" />Enviando...</>;
  if (analyzing) return <><Loader2 className="h-4 w-4 animate-spin mr-2" />Analisando comprovante...</>;
  return <>{label}</>;
}
