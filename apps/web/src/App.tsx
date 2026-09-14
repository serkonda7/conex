import { A, Route, Router } from "@solidjs/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import type { Component } from "solid-js";
import "./app.css";
import ClientDetailPage from "./routes/client-detail.js";
import ClientsPage from "./routes/clients.js";
import PeoplePage from "./routes/people.js";
import QueuePage from "./routes/queue.js";

const queryClient = new QueryClient();

const App: Component = () => (
	<QueryClientProvider client={queryClient}>
		<Router>
			<header class="topnav">
				<A href="/queue" class="brand">
					CONEX
				</A>
				<nav>
					<A href="/queue">Queue</A>
					<A href="/clients">Clients</A>
					<A href="/people">People</A>
				</nav>
			</header>
			<Route path="/" component={QueuePage} />
			<Route path="/queue" component={QueuePage} />
			<Route path="/clients" component={ClientsPage} />
			<Route path="/clients/:id" component={ClientDetailPage} />
			<Route path="/people" component={PeoplePage} />
		</Router>
	</QueryClientProvider>
);

export default App;
