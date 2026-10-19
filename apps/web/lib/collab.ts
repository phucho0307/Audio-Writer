import { API } from './env';

/**
 * The draft room's socket, derived from the API URL rather than configured
 * twice. `http://host/api` becomes `ws://host/collab`, so moving the API moves
 * the room with it and the two cannot drift apart in an env file.
 */
export function collabUrl(): string {
  const url = new URL(API, typeof window === 'undefined' ? 'http://localhost' : window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/collab';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

export function roomFor(branchId: string): string {
  return `branch:${branchId}`;
}

/**
 * A stable colour per person, so the same writer keeps the same cursor for as
 * long as the room is open. Hue from the handle; the rest fixed, so every
 * cursor sits at the same weight against both themes instead of one person
 * getting a colour nobody can see on paper.
 */
export function colorFor(handle: string): string {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) % 360;
  return `hsl(${h} 62% 48%)`;
}
