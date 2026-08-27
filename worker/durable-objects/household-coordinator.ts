import type { BroadcastRequest } from '../domain/sync-event';
import type { Env } from '../env';
import { jsonResponse } from '../http';

const DEVICE_HEADER = 'x-family-shopping-device-id';

export class HouseholdCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    void this.env;
    const url = new URL(request.url);
    if (url.pathname === '/connect') return this.connect(request);
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const message = (await request.json()) as BroadcastRequest;
      const serialized = JSON.stringify(message.event);
      for (const socket of this.state.getWebSockets()) {
        const sourceTag = `device:${message.sourceDeviceId}`;
        if (!this.state.getTags(socket).includes(sourceTag)) socket.send(serialized);
      }
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Ruta no disponible.' } }, 404);
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'PING') socket.send(JSON.stringify({ version: 1, type: 'PONG' }));
  }

  webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean): void {
    void wasClean;
    socket.close(code, reason);
  }

  private connect(request: Request): Response {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return jsonResponse(
        { error: { code: 'UPGRADE_REQUIRED', message: 'Se necesita una conexión WebSocket.' } },
        426,
      );
    }
    const deviceId = request.headers.get(DEVICE_HEADER);
    if (!deviceId) {
      return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'No autorizado.' } }, 401);
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server, [`device:${deviceId}`]);
    return new Response(null, {
      status: 101,
      headers: { 'sec-websocket-protocol': 'family-shopping' },
      webSocket: client,
    });
  }
}
