import type { Request } from "express";
import type { CryptoService } from "../common/crypto/crypto.service";
import { ChatService } from "./chat.service";

/**
 * Who a web visitor is, and where they came from (ADR-0004).
 *
 * - `visitorId`: the identity. `vd_<HMAC>` of the widget's device ID. Consent,
 *   erasure and unique-visitor analytics all key on it.
 * - `ipHash`: `vh_<HMAC>` of the client IP. An attribute only, never an
 *   identity: carrier NAT puts many people behind one IP.
 */
export interface VisitorIdentity {
  visitorId?: string;
  ipHash?: string;
}

/** Build the visitor identity for a public widget/voice request. */
export function resolveWebVisitor(
  crypto: CryptoService,
  req: Request,
): VisitorIdentity {
  const header = req.headers["x-device-id"];
  const deviceId = Array.isArray(header) ? header[0] : header;
  return {
    visitorId: crypto.hashVisitorDevice(deviceId),
    ipHash: crypto.hashVisitorIp(ChatService.extractVisitorIp(req)),
  };
}
