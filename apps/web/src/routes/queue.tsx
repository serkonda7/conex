import { StatusBadge } from "@conex/ui";
import type { Component } from "solid-js";

const QueuePage: Component = () => (
  <main>
    <h1>Queue</h1>
    <p>Dispatcher view placeholder. Server state via TanStack Query.</p>
    <StatusBadge status="open" />
  </main>
);

export default QueuePage;
