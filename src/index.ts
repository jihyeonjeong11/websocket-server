import { DurableObject } from 'cloudflare:workers';

export interface Env {
	WEBSOCKET_HIBERNATION_SERVER: DurableObjectNamespace<WebSocketHibernationServer>;
	FINNHUB_API_KEY: string;
}

// Worker
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// maintain it for now,
		// const corsHeaders = {
		// 	'Access-Control-Allow-Origin': '*',
		// 	'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
		// 	'Access-Control-Max-Age': '86400',
		// };

		// Handle CORS preflight request
		// if (request.method === 'OPTIONS') {
		// 	return new Response(null, {
		// 		status: 204,
		// 		headers: corsHeaders,
		// 	});
		// }

		if (request.url.endsWith('/websocket')) {
			// Expect to receive a WebSocket Upgrade request.
			// If there is one, accept the request and return a WebSocket Response.
			const upgradeHeader = request.headers.get('Upgrade');
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				return new Response('Durable Object expected Upgrade: websocket', {
					status: 426,
				});
			}

			// This example will refer to the same Durable Object,
			// since the name "foo" is hardcoded.
			let id = env.WEBSOCKET_HIBERNATION_SERVER.idFromName('foo');
			let stub = env.WEBSOCKET_HIBERNATION_SERVER.get(id);

			return stub.fetch(request);
		}

		return new Response(null, {
			status: 400,
			statusText: 'Bad Request',
			headers: {
				'Content-Type': 'text/plain',
			},
		});
	},
};

// Durable Object
export class WebSocketHibernationServer extends DurableObject {
	env: Env;

	constructor(private state: DurableObjectState, env: Env) {
		super(state, env);
		this.env = env;
	}

	async fetch(request: Request): Promise<Response> {
		// Creates two ends of a WebSocket connection.
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		// Calling `acceptWebSocket()` informs the runtime that this WebSocket is to begin terminating
		// request within the Durable Object. It has the effect of "accepting" the connection,
		// and allowing the WebSocket to send and receive messages.
		// Unlike `ws.accept()`, `state.acceptWebSocket(ws)` informs the Workers Runtime that the WebSocket
		// is "hibernatable", so the runtime does not need to pin this Durable Object to memory while
		// the connection is open. During periods of inactivity, the Durable Object can be evicted
		// from memory, but the WebSocket connection will remain open. If at some later point the
		// WebSocket receives a message, the runtime will recreate the Durable Object
		// (run the `constructor`) and deliver the message to the appropriate handler.
		this.ctx.acceptWebSocket(server);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	async fetchStockPrice(symbol: string, apiKey: string): Promise<number | null> {
		const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`;
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
			},
		});

		if (!response.ok) return null;

		const data = (await response.json()) as any;
		return data;
	}

	async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
		// Upon receiving a message from the client, the server replies with the same message,
		// and the total number of connections with the "[Durable Object]: " prefix

		const priceJson = await this.fetchStockPrice(message as string, this.env.FINNHUB_API_KEY);

		if (priceJson === null) {
			ws.send(`[Error] Could not fetch price for ${message}`);
		} else {
			ws.send(JSON.stringify(priceJson));
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
		// If the client closes the connection, the runtime will invoke the webSocketClose() handler.
		ws.close(code, 'Durable Object is closing WebSocket');
	}
}
