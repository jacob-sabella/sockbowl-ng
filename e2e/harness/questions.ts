import { QUESTIONS_BASE } from './config.js';

/**
 * A tiny GraphQL helper against the questions service, for e2e harness
 * cleanup only (M3 plan E1). Not a full client: the ng app itself talks to
 * questions through `GraphqlClientService`; this is just enough to delete a
 * packet the spec created, with or without a bearer token.
 */
async function graphqlRequest<T = any>(
  query: string,
  variables: Record<string, unknown>,
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${QUESTIONS_BASE}/graphql`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body?.errors?.length) {
    throw new Error(`questions GraphQL ${res.status}: ${JSON.stringify(body?.errors ?? body)}`);
  }
  return body.data as T;
}

/**
 * Deletes a packet by id, as its author (or with auth off, as anyone). Best
 * effort: a spec's cleanup should never fail the test over a leftover fixture
 * packet, so failures are logged, not thrown.
 */
export async function deletePacket(id: string, token?: string | null): Promise<void> {
  try {
    await graphqlRequest<{ deletePacket: boolean }>(
      `mutation ($id: ID!) { deletePacket(id: $id) }`,
      { id },
      token,
    );
  } catch (err) {
    console.warn(`[e2e] cleanup: failed to delete packet ${id}: ${(err as Error).message}`);
  }
}
