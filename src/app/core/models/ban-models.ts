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
