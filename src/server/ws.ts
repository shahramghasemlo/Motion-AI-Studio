import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyBearerToken } from '../middleware/auth.ts';
import { getUserByUid } from '../db/users.ts';

interface StudioSocket extends WebSocket {
  userId?: number;
  uid?: string;
  subscribedProjectId?: number;
  isAlive?: boolean;
}

class StudioWebSocketHub {
  private wss: WebSocketServer | null = null;
  private clients = new Set<StudioSocket>();

  attach(server: HttpServer): void {
    if (this.wss) return;
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: StudioSocket) => {
      ws.isAlive = true;
      this.clients.add(ws);

      ws.send(
        JSON.stringify({
          type: 'connection:ready',
          timestamp: new Date().toISOString(),
        })
      );

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as {
            type: string;
            token?: string;
            projectId?: number;
          };

          if (msg.type === 'auth' && msg.token) {
            try {
              const decoded = await verifyBearerToken(msg.token);
              const dbUser = await getUserByUid(decoded.uid);
              ws.uid = decoded.uid;
              ws.userId = dbUser?.id;
              ws.send(
                JSON.stringify({
                  type: 'auth:ok',
                  userId: dbUser?.id ?? null,
                })
              );
            } catch {
              ws.send(JSON.stringify({ type: 'auth:error', message: 'Invalid token' }));
            }
          } else if (msg.type === 'subscribe:project' && typeof msg.projectId === 'number') {
            ws.subscribedProjectId = msg.projectId;
            ws.send(
              JSON.stringify({
                type: 'subscribed',
                projectId: msg.projectId,
              })
            );
          } else if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } catch {
          // Ignore malformed client payloads
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });

    const interval = setInterval(() => {
      for (const client of this.clients) {
        if (client.isAlive === false) {
          client.terminate();
          this.clients.delete(client);
          continue;
        }
        client.isAlive = false;
        client.ping();
      }
    }, 30000);
    interval.unref();

    this.wss.on('close', () => {
      clearInterval(interval);
    });

    server.on('close', () => {
      this.close();
    });
  }

  close(): void {
    for (const client of this.clients) {
      client.terminate();
    }
    this.clients.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  emitToUser(userId: number, eventType: string, payload: Record<string, unknown>): void {
    const message = JSON.stringify({
      type: eventType,
      payload,
      timestamp: new Date().toISOString(),
    });
    for (const client of this.clients) {
      if (client.userId === userId && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  getConnectedCount(): number {
    return this.clients.size;
  }
}

export const studioWsHub = new StudioWebSocketHub();
