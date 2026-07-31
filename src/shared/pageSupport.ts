import { BLOCKED_HOSTS, BLOCKED_URL_PREFIXES } from './constants.js';

/**
 * Whether Chrome will let a content script run on this URL.
 *
 * This mirrors the browser's own restrictions rather than any policy of ours,
 * so the popup can explain the limitation before the user tries to capture and
 * hits an opaque injection failure.
 */
export function isCapturableUrl(url: string): boolean {
  if (url === '') {
    return false;
  }
  const lower = url.toLowerCase();

  if (BLOCKED_URL_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return false;
  }
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
    return false;
  }
  return !BLOCKED_HOSTS.some((host) => lower.includes(host));
}

/** Hostname for display in the popup. Falls back to the raw URL fragment. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 40);
  }
}
