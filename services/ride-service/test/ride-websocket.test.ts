import http from "node:http";
import { once } from "node:events";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { WebSocket } from "ws";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { initRideWebSocketServer } from "../src/websocket/ride-socket.server.js";

describe("Ride WebSocket Gateway Integration Suite", () => {
  let server: http.Server;
  let serverPort: number;
  let privateKey: string;
  let publicKey: string;
  let publicKeyBase64: string;
  const activeSockets: WebSocket[] = [];

  const redisStore = new Map<string, string>();
  const mockRedis: any = {
    get: async (key: string) => redisStore.get(key) || null,
    set: async (key: string, val: string) => {
      redisStore.set(key, val);
      return "OK";
    },
    del: async (key: string) => {
      const existed = redisStore.has(key);
      redisStore.delete(key);
      return existed ? 1 : 0;
    },
    exists: async (key: string) => (redisStore.has(key) ? 1 : 0),
    publish: async () => 1,
  };

  const mockGeoService: any = {
    updateDriverLocation: async () => {},
    removeDriverLocation: async () => {},
    setPresenceService: () => {},
  };

  beforeAll(async () => {
    const { publicKey: pub, privateKey: priv } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    publicKey = pub;
    privateKey = priv;
    publicKeyBase64 = Buffer.from(pub).toString("base64");

    server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end("OK");
    });

    initRideWebSocketServer(server, mockRedis, mockGeoService, publicKeyBase64);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    for (const ws of activeSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("closes connection on missing access token in upgrade URL", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/ride`);
    activeSockets.push(ws);
    const [err] = await once(ws, "error");
    expect(err).toBeDefined();
  });

  it("rejects connection with invalid or expired token", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/ride?token=invalid.jwt.token`);
    activeSockets.push(ws);
    const [err] = await once(ws, "error");
    expect(err).toBeDefined();
  });

  it("rejects connection if path is not supported", async () => {
    const token = jwt.sign(
      { userId: "usr-1", role: "RIDER" },
      privateKey,
      { algorithm: "RS256", issuer: "urbanfleet-auth", audience: "urbanfleet-api" }
    );
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/unsupported-route?token=${token}`);
    activeSockets.push(ws);
    const [err] = await once(ws, "error");
    expect(err).toBeDefined();
  });

  it("accepts authenticated rider connection when token is valid RS256", async () => {
    const token = jwt.sign(
      { userId: "rider-123", role: "RIDER" },
      privateKey,
      { algorithm: "RS256", issuer: "urbanfleet-auth", audience: "urbanfleet-api" }
    );

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/ride?token=${token}`);
    activeSockets.push(ws);
    await once(ws, "open");
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("accepts authenticated driver and handles ping/pong keep-alive messages", async () => {
    const token = jwt.sign(
      { userId: "driver-456", role: "DRIVER" },
      privateKey,
      { algorithm: "RS256", issuer: "urbanfleet-auth", audience: "urbanfleet-api" }
    );

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/ride?token=${token}`);
    activeSockets.push(ws);
    await once(ws, "open");

    ws.send(JSON.stringify({ type: "ping" }));
    const [msg] = await once(ws, "message");
    const payload = JSON.parse(msg.toString());
    expect(payload.type).toBe("pong");

    ws.close();
  });

  it("handles driver:go-online and responds with server:driver-status ONLINE", async () => {
    const token = jwt.sign(
      { userId: "driver-presence-1", role: "DRIVER" },
      privateKey,
      { algorithm: "RS256", issuer: "urbanfleet-auth", audience: "urbanfleet-api" }
    );

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/ride?token=${token}`);
    activeSockets.push(ws);
    await once(ws, "open");

    ws.send(JSON.stringify({ event: "driver:go-online", data: {} }));
    const [msg] = await once(ws, "message");
    const payload = JSON.parse(msg.toString());

    expect(payload.event).toBe("server:driver-status");
    expect(payload.data.status).toBe("ONLINE");
    expect(payload.data.isOnline).toBe(true);
    expect(payload.data.isAvailable).toBe(false);
    expect(payload.data.driverId).toBe("driver-presence-1");

    // Check Redis presence
    const presenceData = redisStore.get("ride:driver:presence:driver-presence-1");
    expect(presenceData).toBeDefined();
    const presence = JSON.parse(presenceData!);
    expect(presence.online).toBe(true);
    expect(presence.available).toBe(false);

    ws.close();
  });

  it("handles driver:set-available and updates Redis presence to AVAILABLE", async () => {
    const token = jwt.sign(
      { userId: "driver-avail-2", role: "DRIVER" },
      privateKey,
      { algorithm: "RS256", issuer: "urbanfleet-auth", audience: "urbanfleet-api" }
    );

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/ride?token=${token}`);
    activeSockets.push(ws);
    await once(ws, "open");

    // 1. Set Available: true
    ws.send(JSON.stringify({ event: "driver:set-available", data: { available: true } }));
    const [msg1] = await once(ws, "message");
    const payload1 = JSON.parse(msg1.toString());

    expect(payload1.event).toBe("server:driver-status");
    expect(payload1.data.status).toBe("AVAILABLE");
    expect(payload1.data.isOnline).toBe(true);
    expect(payload1.data.isAvailable).toBe(true);

    const presence1 = JSON.parse(redisStore.get("ride:driver:presence:driver-avail-2")!);
    expect(presence1.online).toBe(true);
    expect(presence1.available).toBe(true);

    // 2. Set Available: false (remains ONLINE)
    ws.send(JSON.stringify({ event: "driver:set-available", data: { available: false } }));
    const [msg2] = await once(ws, "message");
    const payload2 = JSON.parse(msg2.toString());

    expect(payload2.event).toBe("server:driver-status");
    expect(payload2.data.status).toBe("ONLINE");
    expect(payload2.data.isAvailable).toBe(false);

    const presence2 = JSON.parse(redisStore.get("ride:driver:presence:driver-avail-2")!);
    expect(presence2.available).toBe(false);

    ws.close();
  });

  it("handles driver:set-busy and driver:go-offline transitions", async () => {
    const token = jwt.sign(
      { userId: "driver-busy-3", role: "DRIVER" },
      privateKey,
      { algorithm: "RS256", issuer: "urbanfleet-auth", audience: "urbanfleet-api" }
    );

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/ride?token=${token}`);
    activeSockets.push(ws);
    await once(ws, "open");

    // 1. Set Busy
    ws.send(JSON.stringify({ event: "driver:set-busy", data: {} }));
    const [msgBusy] = await once(ws, "message");
    const payloadBusy = JSON.parse(msgBusy.toString());

    expect(payloadBusy.event).toBe("server:driver-status");
    expect(payloadBusy.data.status).toBe("BUSY");
    expect(payloadBusy.data.isOnline).toBe(true);
    expect(payloadBusy.data.isAvailable).toBe(false);

    // 2. Go Offline
    ws.send(JSON.stringify({ event: "driver:go-offline", data: {} }));
    const [msgOffline] = await once(ws, "message");
    const payloadOffline = JSON.parse(msgOffline.toString());

    expect(payloadOffline.event).toBe("server:driver-status");
    expect(payloadOffline.data.status).toBe("OFFLINE");
    expect(payloadOffline.data.isOnline).toBe(false);
    expect(payloadOffline.data.isAvailable).toBe(false);

    // Redis presence key should be deleted
    expect(redisStore.has("ride:driver:presence:driver-busy-3")).toBe(false);

    ws.close();
  });

  it("handles driver:heartbeat and returns heartbeat-ack", async () => {
    const token = jwt.sign(
      { userId: "driver-hb-4", role: "DRIVER" },
      privateKey,
      { algorithm: "RS256", issuer: "urbanfleet-auth", audience: "urbanfleet-api" }
    );

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/ride?token=${token}`);
    activeSockets.push(ws);
    await once(ws, "open");

    // Go online first
    ws.send(JSON.stringify({ event: "driver:go-online", data: {} }));
    await once(ws, "message");

    // Send heartbeat
    ws.send(JSON.stringify({ event: "driver:heartbeat", data: {} }));
    const [msgHb] = await once(ws, "message");
    const payloadHb = JSON.parse(msgHb.toString());

    expect(payloadHb.event).toBe("server:heartbeat-ack");
    expect(payloadHb.data.timestamp).toBeDefined();
    expect(payloadHb.data.isOnline).toBe(true);

    ws.close();
  });

  it("automatically cleans up presence when driver WebSocket disconnects", async () => {
    let removedDriverId: string | null = null;
    mockGeoService.removeDriverLocation = async (id: string) => {
      removedDriverId = id;
    };

    const token = jwt.sign(
      { userId: "driver-disconnect-5", role: "DRIVER" },
      privateKey,
      { algorithm: "RS256", issuer: "urbanfleet-auth", audience: "urbanfleet-api" }
    );

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/ride?token=${token}`);
    activeSockets.push(ws);
    await once(ws, "open");

    // Go online
    ws.send(JSON.stringify({ event: "driver:go-online", data: {} }));
    await once(ws, "message");
    expect(redisStore.has("ride:driver:presence:driver-disconnect-5")).toBe(true);

    // Close socket connection
    ws.close();
    await once(ws, "close");

    // Allow event loop to process close handler
    await new Promise((r) => setTimeout(r, 60));

    expect(redisStore.has("ride:driver:presence:driver-disconnect-5")).toBe(false);
    expect(removedDriverId).toBe("driver-disconnect-5");
  });

  it("processes driver GPS location updates over WebSocket", async () => {
    let capturedLocation: any = null;
    mockGeoService.updateDriverLocation = async (id: string, lat: number, lon: number) => {
      capturedLocation = { id, lat, lon };
    };

    const token = jwt.sign(
      { userId: "driver-geo-789", role: "DRIVER" },
      privateKey,
      { algorithm: "RS256", issuer: "urbanfleet-auth", audience: "urbanfleet-api" }
    );

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/ride?token=${token}`);
    activeSockets.push(ws);
    await once(ws, "open");

    ws.send(
      JSON.stringify({
        event: "driver:update-location",
        data: {
          latitude: 12.9716,
          longitude: 77.5946,
        },
      })
    );

    await new Promise((r) => setTimeout(r, 60));
    expect(capturedLocation).toEqual({
      id: "driver-geo-789",
      lat: 12.9716,
      lon: 77.5946,
    });

    ws.close();
  });
});
