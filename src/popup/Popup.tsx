/**
 * The toolbar popup: four capture modes presented as peers.
 *
 * The plan is explicit that the modes must read as equally understandable
 * actions, so each is a full-width row with a plain-language description, and
 * the most recently used one is merely highlighted rather than promoted above
 * the others.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { LONG_PAGE_WARNING_CSS_PX } from '../shared/constants.js';
import { migrateSettings, type Settings } from '../shared/settings.js';
import { STORAGE_KEYS } from '../shared/constants.js';
import type { ExactPdfError } from '../shared/errors.js';
import type { CaptureMode } from '../shared/types.js';
import type { ExtensionRequest, ExtensionResponse, TabAvailability } from '../shared/messages.js';

interface ModeOption {
  readonly mode: CaptureMode;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
}

const MODES: readonly ModeOption[] = [
  {
    mode: 'element',
    label: 'Select Element',
    description: 'Point at a diagram, table or section and capture just that.',
    icon: 'M4 4h7v7H4zM13 13h7v7h-7z',
  },
  {
    mode: 'region',
    label: 'Select Region',
    description: 'Draw a box around any part of the screen.',
    icon: 'M3 3h18v18H3zM7 7h10v10H7z',
  },
  {
    mode: 'fullPage',
    label: 'Full Page',
    description: 'Capture the whole page, scrolling for you.',
    icon: 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h5',
  },
  {
    mode: 'document',
    label: 'Clean Document',
    description: 'Keep the article as searchable text, drop the page furniture.',
    icon: 'M6 3h9l3 3v15H6zM9 12h6M9 16h6',
  },
];

async function send<R extends ExtensionRequest>(request: R): Promise<ExtensionResponse<R>> {
  const response: unknown = await chrome.runtime.sendMessage(request);
  return response as ExtensionResponse<R>;
}

export function Popup(): preact.JSX.Element {
  const [availability, setAvailability] = useState<TabAvailability | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState<CaptureMode | null>(null);
  const [error, setError] = useState<ExactPdfError | null>(null);
  const [pendingLongPage, setPendingLongPage] = useState(false);

  useEffect(() => {
    void (async () => {
      const [result, stored] = await Promise.all([
        send({ type: 'getTabAvailability' }),
        chrome.storage.local.get(STORAGE_KEYS.settings),
      ]);
      setSettings(migrateSettings(stored[STORAGE_KEYS.settings]));
      if (result.ok) {
        setAvailability(result.value);
      } else {
        setError(result.error);
      }
    })();
  }, []);

  const start = useCallback(
    async (mode: CaptureMode) => {
      if (settings === null) {
        return;
      }
      setBusy(mode);
      setError(null);

      const result = await send({ type: 'startCapture', mode, quality: settings.defaultQuality });

      if (!result.ok) {
        setError(result.error);
        setBusy(null);
        return;
      }
      // Element and region modes hand control to an on-page overlay, so the
      // popup must close for the user to interact with the page at all.
      window.close();
    },
    [settings],
  );

  const onModeClick = useCallback(
    (mode: CaptureMode) => {
      if (mode === 'fullPage' && settings?.warnOnLongPages === true && !pendingLongPage) {
        setPendingLongPage(true);
        return;
      }
      setPendingLongPage(false);
      void start(mode);
    },
    [settings, pendingLongPage, start],
  );

  const supported = availability?.supported ?? false;
  const blocked = availability !== null && !availability.supported;

  return (
    <div class="popup">
      <header class="popup__header">
        <h1 class="popup__title">ExactPDF</h1>
        {availability !== null && availability.tabHost !== '' && (
          <p class="popup__host" title={availability.tabHost}>
            {availability.tabHost}
          </p>
        )}
      </header>

      {blocked && (
        <p class="notice notice--warning" role="status">
          {availability.reason?.message ??
            'Chrome does not allow extensions to read this page, so it cannot be captured.'}
        </p>
      )}

      {error !== null && (
        <p class="notice notice--error" role="alert">
          {error.message}
        </p>
      )}

      {pendingLongPage && (
        <div class="notice notice--info" role="status">
          <p class="popup__warningText">
            Long pages can take a moment and produce a large file. Capture continues up to about{' '}
            {Math.round(LONG_PAGE_WARNING_CSS_PX / 1000)}k pixels of height.
          </p>
          <div class="popup__warningActions">
            <button
              type="button"
              class="button button--primary"
              onClick={() => {
                void start('fullPage');
              }}
            >
              Capture anyway
            </button>
            <button
              type="button"
              class="button"
              onClick={() => {
                setPendingLongPage(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ul class="popup__modes">
        {MODES.map((option) => (
          <li key={option.mode}>
            <button
              type="button"
              class={`mode${settings?.lastCaptureMode === option.mode ? ' mode--recent' : ''}`}
              disabled={!supported || busy !== null}
              onClick={() => {
                onModeClick(option.mode);
              }}
            >
              <svg class="mode__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d={option.icon} fill="none" stroke="currentColor" stroke-width="1.6" />
              </svg>
              <span class="mode__text">
                <span class="mode__label">
                  {option.label}
                  {settings?.lastCaptureMode === option.mode && <span class="mode__badge">Last used</span>}
                </span>
                <span class="mode__description">{option.description}</span>
              </span>
              {busy === option.mode && <span class="mode__spinner" aria-label="Working" />}
            </button>
          </li>
        ))}
      </ul>

      <footer class="popup__footer">
        <button
          type="button"
          class="popup__link"
          onClick={() => {
            void chrome.runtime.openOptionsPage();
          }}
        >
          Settings
        </button>
        <span class="popup__separator" aria-hidden="true">
          ·
        </span>
        <button
          type="button"
          class="popup__link"
          onClick={() => {
            void chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html#help') });
          }}
        >
          Help
        </button>
        <span class="popup__privacy">Processed locally</span>
      </footer>
    </div>
  );
}
