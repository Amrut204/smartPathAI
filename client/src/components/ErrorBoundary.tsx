import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

// Vite provides import.meta.env in runtime, but this repo doesn't currently type it.
// Cast keeps the component TS-safe without changing global typings.
const IS_DEV = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

/**
 * Generic React error boundary that catches render errors in its subtree and shows
 * a fallback UI instead of crashing the entire app shell.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message ?? "Unknown error" };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Avoid leaking details in production; local dev still needs a stack trace.
    if (IS_DEV) {
      console.error("[ErrorBoundary]", error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: "" });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="error-boundary-fallback">
        <div className="error-boundary-icon">!</div>
        <h2>{this.props.fallbackTitle ?? "Something went wrong"}</h2>
        <p className="error-boundary-message">
          This section encountered an unexpected error and couldn't render.
          Try reloading the page.
        </p>

        {IS_DEV && this.state.errorMessage ? (
          <details className="error-boundary-details">
            <summary>Technical details (dev only)</summary>
            <code>{this.state.errorMessage}</code>
          </details>
        ) : null}

        <div className="error-boundary-actions">
          <button className="ui-button primary" onClick={this.handleReset}>
            Try Again
          </button>
          <button className="ui-button ghost" onClick={() => window.location.reload()}>
            Reload Page
          </button>
        </div>
      </div>
    );
  }
}
