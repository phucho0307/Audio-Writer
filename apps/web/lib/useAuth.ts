'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  fetchProviders,
  getServerSnapshot,
  getSnapshot,
  refresh,
  signIn,
  signOut,
  subscribe,
  type Providers,
} from './auth';

let bootstrapped = false;

/**
 * Reads the auth store.
 *
 * `useSyncExternalStore` rather than context: the store has to be reachable
 * from `call()` in api.ts, which is a plain function and cannot read context.
 * Given the store exists anyway, a provider would just be a second copy of the
 * same state to keep in sync.
 */
export function useAuth() {
  const { user, ready } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    // Once per page load, not once per component. The access token does not
    // survive a reload, so this is what turns the refresh cookie back into a
    // signed-in session.
    if (bootstrapped) return;
    bootstrapped = true;
    void refresh();
  }, []);

  return { user, ready, signIn, signOut };
}

export function useProviders(): Providers | null {
  const [providers, setProviders] = useState<Providers | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchProviders().then((p) => alive && setProviders(p));
    return () => {
      alive = false;
    };
  }, []);

  return providers;
}
