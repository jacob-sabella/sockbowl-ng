/**
 * GraphQL-only owner view of a packet (questions' `type PacketOwner`).
 *
 * The generated `Packet` (packet-types.generated.ts, from the Java model's
 * JSON Schema) has flat `ownerId`/`ownerDisplayName`, but the GraphQL `Packet`
 * type never exposes those: it exposes `owner { id name }`, and `owner.id` is
 * redacted to null unless the caller may read the packet in full (Q-M2-01,
 * D2). Every packet this app reads comes from GraphQL, so ownership checks
 * must read `owner.id`, never `ownerId`. This augments the generated
 * interface without editing it, so `npm run codegen` keeps working.
 */
export interface PacketOwner {
  id: string | null;
  name: string | null;
}

declare module './packet-types.generated' {
  interface Packet {
    owner?: PacketOwner | null;
  }
}
