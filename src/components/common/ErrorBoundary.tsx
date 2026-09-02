import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logDev } from '../../lib/utils';
import { Button } from './Button';
import { Card } from './Card';

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { failed: boolean };

/**
 * The floor under a render-time throw. React unmounts the whole tree when one
 * escapes, so without this the app becomes a blank page carrying no message — on
 * a field phone there is no console to read the reason from either.
 *
 * Deliberately the only boundary, wrapped around the whole app: a per-screen one
 * would have to guess which subtree can fail, and the failure this catches is by
 * definition the one nobody predicted. Reloading is the offered way out because
 * the state that produced the throw is gone with it.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logDev('Render failed', `${error.message}\n${info.componentStack ?? ''}`);
  }

  render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <main className="mobile-shell auth-shell">
        <Card className="login-panel">
          <h1>This screen could not be shown</h1>
          <p className="muted">
            Nothing recorded on this device has been lost. Reload to continue, and if it happens again, report what
            you were doing when it did.
          </p>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </Card>
      </main>
    );
  }
}
