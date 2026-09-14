import type { Component, JSX } from "solid-js";
import { For } from "solid-js";

export interface TableColumn<T> {
	key: string;
	header: string;
	render?: (row: T) => JSX.Element;
}

export interface TableProps<T> {
	columns: TableColumn<T>[];
	rows: T[];
}

/** Minimal table primitive — styling is the web app's job for now. */
export const Table = (<T,>(props: TableProps<T>): JSX.Element => (
	<table>
		<thead>
			<tr>
				<For each={props.columns}>{(col) => <th>{col.header}</th>}</For>
			</tr>
		</thead>
		<tbody>
			<For each={props.rows}>
				{(row) => (
					<tr>
						<For each={props.columns}>
							{(col) => (
								<td>
									{col.render
										? col.render(row)
										: String(
												(
													row as Record<
														string,
														unknown
													>
												)[col.key] ?? "",
											)}
								</td>
							)}
						</For>
					</tr>
				)}
			</For>
		</tbody>
	</table>
)) as Component<TableProps<Record<string, unknown>>>;
