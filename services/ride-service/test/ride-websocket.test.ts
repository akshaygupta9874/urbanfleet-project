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

  const mockGeoService: any = {
    updateDriverLocation: async () => {},
  };

  const mockRedis: any = {
    set: async () => "OK",
    publish: async () => 1,
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

  it("rejects connection if path is not /ws/ride", async () => {
    const token = jwt.sign(
      { userId: "usr-1", role: "RIDER" },
      privateKey,
      { algorithm: "RS256", issuer: "urbanfleet-auth", audience: "urbanfleet-api" }
    );
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/wrong-path?token=${token}`);
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
        type: "location_update",
        latitude: 12.9716,
        longitude: 77.5946,
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
