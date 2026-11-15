/**
 * ErrorBoundary: stops a single page (e.g. a broken wizard step) from blanking
 * the whole app. Shows a friendly fallback with a "Try again" button that
 * remounts the children.
 */
import * as React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export function ErrorBoundary({ children, fallback }: Props) {
  return <Impl children={children} fallback={fallback} />;
}

/** React error capture only works in class components. */
class Impl extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, _info: React.ErrorInfo) {
    // Errors are surfaced in the fallback UI; also log for debugging.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", _error);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      const fallbackEl =
        this.props.fallback ??
        (
          <div className="flex flex-col items-center justify-center min-h-[400px] text-muted-foreground">
            <h2 className="text-sm font-semibold">Something broke on this screen</h2>
            <p className="mt-1 text-xs max-w-md text-center">{this.state.error?.message ?? "unknown error"}</p>
            <button
              onClick={this.reset}
              className="mt-3 h-9 px-3 rounded-xl border border-input bg-input text-sm hover:bg-accent"
            >
              Try again
            </button>
          </div>
        );
      return <>{fallbackEl}</>;
    }
    return this.props.children;
  }
}
