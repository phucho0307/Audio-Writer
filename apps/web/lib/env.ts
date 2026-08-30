/**
 * Lives apart from `api.ts` only to keep the import graph acyclic: `api.ts`
 * needs the auth store for its token, and the auth store needs this URL.
 */
export const API =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
