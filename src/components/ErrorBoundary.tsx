import { Component, type ErrorInfo, type ReactNode } from "react";
import { logger } from "../lib/logger";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render-time errors in the subtree so a single component throw shows a
 * fallback instead of white-screening the whole app, and routes the error to the
 * logger (the seam where real telemetry — Sentry, etc. — would be wired).
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error("React render error", {
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="card empty-state" role="alert">
            <p>
              Something went wrong rendering this view. Please reload the page.
            </p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
