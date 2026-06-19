import { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  hasError: boolean;
  message: string;
}

/**
 * Catches render-time errors in a subtree and shows a friendly message instead of a
 * white screen or "[object Object]". The error is always coerced to a readable string.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    let message = 'Erro inesperado.';
    if (error instanceof Error) message = error.message;
    else if (typeof error === 'string') message = error;
    else {
      try { message = JSON.stringify(error); } catch { message = String(error); }
    }
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: unknown) {
    // Surface the real error in the console (never mask it)
    console.error(`[ErrorBoundary${this.props.label ? '/' + this.props.label : ''}]`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h2 className="text-lg font-semibold">Algo deu errado nesta tela</h2>
          <p className="max-w-md text-sm text-muted-foreground break-words">
            {this.state.message || 'Erro inesperado.'}
          </p>
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Recarregar
            </button>
            <button
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
