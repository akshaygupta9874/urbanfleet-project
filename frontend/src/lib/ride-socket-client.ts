/**
 * Production-hardened Native W3C WebSocket Client for UrbanFleet.
 * Features:
 * - Ping/Pong heartbeat keepalive
 * - Exponential backoff reconnection
 * - Authoritative State Rehydration on connect/reconnect (GET /api/ride/current)
 */
export class RideSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000;
  private heartbeatTimer: any = null;
  private isExplicitlyClosed = false;

  constructor(
    private gatewayUrl: string, // E.g., 'ws://localhost:3001/ws/ride'
    private token: string,
    private onStateRehydrate: () => Promise<void>,
    private onMessage: (event: string, data: any) => void
  ) {}

  public connect(): void {
    this.isExplicitlyClosed = false;
    const url = `${this.gatewayUrl}?token=${encodeURIComponent(this.token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = async () => {
      console.log('[WS] Connected to UrbanFleet Gateway via Kong');
      this.reconnectAttempts = 0;
      this.startHeartbeat();

      // State rehydration hook against PostgreSQL source of truth
      try {
        await this.onStateRehydrate();
      } catch (err) {
        console.error('[WS] State rehydration failed on connect:', err);
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'pong') return;
        this.onMessage(payload.event, payload.data);
      } catch (e) {
        console.warn('[WS] Non-JSON payload received:', event.data);
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.stopHeartbeat();
      if (!this.isExplicitlyClosed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error('[WS] Socket error encountered:', error);
      this.ws?.close();
    };
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000); // 25s keepalive ping
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    setTimeout(() => this.connect(), delay);
  }

  public send(event: string, data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    } else {
      console.warn('[WS] Cannot send message, socket not OPEN');
    }
  }

  public disconnect(): void {
    this.isExplicitlyClosed = true;
    this.stopHeartbeat();
    this.ws?.close();
  }
}
