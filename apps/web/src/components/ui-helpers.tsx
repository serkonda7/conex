import type { JSX } from "solid-js";

/** Plain column type structurally compatible with @conex/ui Table. */
export type Col = {
  key: string;
  header: string;
  render?: (row: Record<string, unknown>) => JSX.Element;
};

export function Field(props: {
  label: string;
  error?: string;
  hint?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      {props.children}
      {props.error ? (
        <span class="field-error">{props.error}</span>
      ) : props.hint ? (
        <span class="field-hint">{props.hint}</span>
      ) : null}
    </label>
  );
}

export function LoadingState(props: { label?: string }): JSX.Element {
  return <p class="muted">{props.label ?? "Loading…"}</p>;
}

export function ErrorState(props: {
  message: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <div class="state state-error" role="alert">
      <p>{props.message}</p>
      {props.onRetry ? (
        <button type="button" class="btn" onClick={props.onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState(props: {
  title: string;
  hint?: string;
  action?: JSX.Element;
}): JSX.Element {
  return (
    <div class="state">
      <p class="state-title">{props.title}</p>
      {props.hint ? <p class="muted">{props.hint}</p> : null}
      {props.action}
    </div>
  );
}
