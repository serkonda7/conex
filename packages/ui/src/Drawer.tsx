import type { Component, JSX } from "solid-js";
import { Show } from "solid-js";

export interface DrawerProps {
  open: boolean;
  onClose?: () => void;
  children: JSX.Element;
}

export const Drawer: Component<DrawerProps> = (props) => (
  <Show when={props.open}>
    <aside role="dialog" aria-modal="true">
      <button type="button" onClick={() => props.onClose?.()}>
        Close
      </button>
      {props.children}
    </aside>
  </Show>
);
