import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";

export class OutboundBlockedError extends Error {
  constructor(public readonly reason: string) {
    super(`Outbound request blocked: ${reason}`);
    this.name = "OutboundBlockedError";
  }
}

export type OutboundPolicy = { allowPrivate: boolean };

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, includes cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function inV4Block(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

function expandV6(ip: string): number[] {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone);
  // Embedded IPv4 tail, e.g. ::ffff:10.0.0.1
  const v4Match = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const n = v4ToInt(v4Match[1]);
    addr = addr.replace(v4Match[1], `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const [head, tail] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const fill = tail !== undefined ? 8 - h.length - t.length : 0;
  const parts = [...h, ...Array(fill).fill("0"), ...t].map((p) => parseInt(p || "0", 16));
  return parts.length === 8 ? parts : [];
}

export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return V4_BLOCKS.some(([b, bits]) => inV4Block(ip, b, bits));
  if (family === 6) {
    const p = expandV6(ip);
    if (p.length !== 8) return true;
    if (p.every((x) => x === 0)) return true; // ::
    if (p.slice(0, 7).every((x) => x === 0) && p[7] === 1) return true; // ::1
    if (p.slice(0, 5).every((x) => x === 0) && p[5] === 0xffff) {
      // IPv4-mapped
      const v4 = `${p[6] >> 8}.${p[6] & 0xff}.${p[7] >> 8}.${p[7] & 0xff}`;
      return isPrivateAddress(v4);
    }
    if (p[0] === 0x64 && p[1] === 0xff9b) return true; // NAT64
    if ((p[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    if ((p[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((p[0] & 0xff00) === 0xff00) return true; // multicast
    if (p[0] === 0x2001 && p[1] === 0x0db8) return true; // documentation
    return false;
  }
  return true;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

/** Static checks on the URL string. DNS results are checked again at connect time. */
export function validateOutboundUrl(raw: string, policy: OutboundPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundBlockedError("invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new OutboundBlockedError("only http and https are allowed");
  if (url.username || url.password) throw new OutboundBlockedError("credentials in URL are not allowed");
  if (!policy.allowPrivate) {
    if (url.protocol !== "https:") throw new OutboundBlockedError("https is required");
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
      throw new OutboundBlockedError("hostname is not allowed");
    }
    if (net.isIP(host) && isPrivateAddress(host)) throw new OutboundBlockedError("private address");
  }
  return url;
}

function guardedLookup(policy: OutboundPolicy): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = (addresses as unknown as LookupAddress[]) ?? [];
      if (list.length === 0) return callback(new Error("DNS returned no addresses"), "", 0);
      if (!policy.allowPrivate) {
        const bad = list.find((a) => isPrivateAddress(a.address));
        if (bad) return callback(new OutboundBlockedError("hostname resolves to a private address"), "", 0);
      }
      if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

export type SafeResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: AsyncIterable<Buffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
};

export type SafeRequestInit = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  connectTimeoutMs?: number;
  /** Idle time allowed between response bytes. */
  idleTimeoutMs?: number;
  maxResponseBytes?: number;
};

/**
 * Outbound HTTP that pins the DNS answer it validated, refuses redirects,
 * and caps time and size. Every provider call goes through here.
 */
export function safeRequest(rawUrl: string, init: SafeRequestInit, policy: OutboundPolicy): Promise<SafeResponse> {
  const url = validateOutboundUrl(rawUrl, policy);
  const lib = url.protocol === "https:" ? https : http;
  const maxBytes = init.maxResponseBytes ?? 20 * 1024 * 1024;
  const host = url.hostname.replace(/^\[|\]$/g, "");

  return new Promise((resolve, reject) => {
    if (net.isIP(host) && !policy.allowPrivate && isPrivateAddress(host)) {
      return reject(new OutboundBlockedError("private address"));
    }
    const req = lib.request(
      url,
      {
        method: init.method ?? "GET",
        headers: { "user-agent": "agent-hub/0.1", ...init.headers },
        lookup: guardedLookup(policy),
        signal: init.signal,
        timeout: init.connectTimeoutMs ?? 10_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return reject(new OutboundBlockedError(`redirects are not followed (status ${status})`));
        }
        res.setTimeout(init.idleTimeoutMs ?? 60_000, () => res.destroy(new Error("Response idle timeout")));
        let received = 0;
        async function* iterate(): AsyncIterable<Buffer> {
          for await (const chunk of res as AsyncIterable<Buffer>) {
            received += chunk.length;
            if (received > maxBytes) {
              res.destroy();
              throw new Error("Response exceeded size limit");
            }
            yield chunk;
          }
        }
        let consumed = false;
        const body = {
          [Symbol.asyncIterator]() {
            if (consumed) throw new Error("Body already consumed");
            consumed = true;
            return iterate()[Symbol.asyncIterator]();
          },
        };
        const text = async () => {
          const parts: Buffer[] = [];
          for await (const c of body) parts.push(c);
          return Buffer.concat(parts).toString("utf8");
        };
        resolve({
          status,
          headers: res.headers,
          body,
          text,
          json: async () => JSON.parse(await text()) as unknown,
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Connection timeout")));
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
