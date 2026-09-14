import type { Component } from "solid-js";

export interface StatusBadgeProps {
	status: string;
}

const COLORS: Record<string, string> = {
	new: "badge-new",
	open: "badge-open",
	pending: "badge-pending",
	on_hold: "badge-on-hold",
	resolved: "badge-resolved",
	closed: "badge-closed",
};

export const StatusBadge: Component<StatusBadgeProps> = (props) => (
	<span class={`status-badge ${COLORS[props.status] ?? "badge-unknown"}`}>
		{props.status}
	</span>
);
