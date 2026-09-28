/**
 * Models for the admin ban-management API.
 */

export interface Ban {
  id: string;
  bannedKeycloakId: string;
  reason: string | null;
  bannedBy: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface CreateBanRequest {
  bannedKeycloakId: string;
  reason?: string;
  expiresAt?: string | null;
}

/**
 * An IP/CIDR ban (M4-AB-02, `GET/POST /api/v1/admin/bans/ip`, `DELETE
 * /api/v1/admin/bans/ip/{id}`). Contract from WP-G4's audit notes: the
 * canonical CIDR has its host bits cleared, and a single host is written
 * as `/32` (IPv4) or `/128` (IPv6).
 */
export interface IpBan {
  id: string;
  cidr: string;
  reason: string | null;
  bannedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

/**
 * Exactly one of `ttlSeconds` or `expiresAt` is required. The server
 * rejects a range broader than `/16` (IPv4) or `/48` (IPv6), and a TTL or
 * expiry past `sockbowl.ipban.max-ttl` (30 days).
 */
export interface CreateIpBanRequest {
  cidr: string;
  reason?: string;
  ttlSeconds?: number;
  expiresAt?: string;
}
