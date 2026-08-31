import { AsyncLocalStorage } from 'node:async_hooks';
import type { User } from '@prisma/client';

export interface RequestContext {
  /** Set when a valid access token was presented. */
  userId: string | null;
  /** Memoised per request so two services asking do not cost two queries. */
  user?: User;
}

/**
 * Who is making the current request.
 *
 * `CurrentUserService` is injected into four singleton services. Making it
 * request-scoped so it could read the request would cascade request scope
 * through all of them and instantiate the lot per call.
 *
 * AsyncLocalStorage avoids that entirely: middleware stores the caller here,
 * anything downstream reads it, and every service stays a singleton. Node
 * keeps the store attached across awaits, so it survives the async chain
 * without being threaded through any signatures.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return requestContext.getStore();
}
