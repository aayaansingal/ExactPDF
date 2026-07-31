/** Content-script side of the message contracts. */

import type { ExtensionRequest, ExtensionResponse } from '../../shared/messages.js';

/**
 * Sends a request to the service worker.
 *
 * Rejections are swallowed on purpose: a content script that throws while the
 * user is mid-selection leaves an overlay stranded on the page, and every
 * message this side sends is a notification the service worker is free to
 * ignore (a cancelled selection, a completed one).
 */
export async function sendToBackground<R extends ExtensionRequest>(
  request: R,
): Promise<ExtensionResponse<R> | null> {
  try {
    const response: unknown = await chrome.runtime.sendMessage(request);
    return response as ExtensionResponse<R>;
  } catch {
    return null;
  }
}

/**
 * Prevents a second injection of the same content script from creating a
 * duplicate overlay when the user re-invokes a capture on the same tab.
 * `chrome.scripting.executeScript` will happily run a file twice.
 */
export function claimInjectionSlot(name: string): boolean {
  const key = `__exactpdf_${name}__`;
  const scope = window as unknown as Record<string, boolean | undefined>;
  if (scope[key] === true) {
    return false;
  }
  scope[key] = true;
  return true;
}

export function releaseInjectionSlot(name: string): void {
  const scope = window as unknown as Record<string, boolean | undefined>;
  scope[`__exactpdf_${name}__`] = undefined;
}
