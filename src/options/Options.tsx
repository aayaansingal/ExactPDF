/**
 * Settings and help.
 *
 * Help lives on the same page as the settings rather than behind a link to a
 * website, so the limitations section is available offline and cannot drift out
 * of step with the build the user actually has installed.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { STORAGE_KEYS } from '../shared/constants.js';
import { DEFAULT_SETTINGS, migrateSettings, type Settings } from '../shared/settings.js';
import { PERMISSION_JUSTIFICATIONS } from '../manifest.config.js';
import type { PageSize, QualityPreset, RenderMode } from '../shared/types.js';

export function Options(): preact.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
      setSettings(migrateSettings(stored[STORAGE_KEYS.settings]));
    })();
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((previous) => {
      if (previous === null) {
        return previous;
      }
      const next = { ...previous, ...patch };
      void chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
      setSavedAt(Date.now());
      return next;
    });
  }, []);

  if (settings === null) {
    return <main class="options" />;
  }

  return (
    <main class="options">
      <header class="options__header">
        <h1>ExactPDF</h1>
        <p class="options__tagline">Select and save web content as PDF.</p>
      </header>

      <section class="options__section" aria-labelledby="defaults">
        <h2 id="defaults">Export defaults</h2>
        <p class="options__note">
          These are the settings the preview opens with. Every capture can still be adjusted before it is
          saved.
        </p>

        <Row label="Output mode" hint="Exact keeps the page's appearance; Document keeps searchable text.">
          <select
            value={settings.defaultRenderMode}
            onChange={(event) => {
              update({ defaultRenderMode: event.currentTarget.value as RenderMode });
            }}
          >
            <option value="exact">Exact</option>
            <option value="document">Document</option>
          </select>
        </Row>

        <Row label="Page size">
          <select
            value={settings.defaultPageSize}
            onChange={(event) => {
              update({ defaultPageSize: event.currentTarget.value as PageSize });
            }}
          >
            <option value="original">Original size</option>
            <option value="continuous">Continuous (one page)</option>
            <option value="a4">A4</option>
            <option value="letter">Letter</option>
          </select>
        </Row>

        <Row label="Quality" hint="Higher quality means a sharper but larger file.">
          <select
            value={settings.defaultQuality}
            onChange={(event) => {
              update({ defaultQuality: event.currentTarget.value as QualityPreset });
            }}
          >
            <option value="compact">Compact</option>
            <option value="balanced">Balanced</option>
            <option value="maximum">Maximum</option>
          </select>
        </Row>

        <Toggle
          label="Add a time to file names"
          hint="Avoids Chrome's (1), (2) suffixes when you capture the same page repeatedly."
          checked={settings.timestampSuffix}
          onToggle={(timestampSuffix) => {
            update({ timestampSuffix });
          }}
        />

        <Toggle
          label="Warn before capturing very long pages"
          checked={settings.warnOnLongPages}
          onToggle={(warnOnLongPages) => {
            update({ warnOnLongPages });
          }}
        />

        <button
          type="button"
          class="button"
          onClick={() => {
            update(DEFAULT_SETTINGS);
          }}
        >
          Reset to defaults
        </button>

        {savedAt !== null && (
          <p class="options__saved" role="status">
            Settings saved.
          </p>
        )}
      </section>

      <section class="options__section" id="help" aria-labelledby="help-heading">
        <h2 id="help-heading">How it works</h2>
        <ol class="options__steps">
          <li>Open ExactPDF from the toolbar, the right-click menu, or a keyboard shortcut.</li>
          <li>Choose Select Element, Select Region, Full Page, or Clean Document.</li>
          <li>Adjust page size, margins and the file name in the preview.</li>
          <li>Save. The PDF is created on your device and downloaded.</li>
        </ol>

        <h3>Exact or Document?</h3>
        <dl class="options__definitions">
          <dt>Exact</dt>
          <dd>
            Reproduces what was on screen, pixel for pixel. Best for diagrams, charts, interfaces and unusual
            layouts. The file is larger and its text cannot be selected or searched.
          </dd>
          <dt>Document</dt>
          <dd>
            Rebuilds the page as a clean, searchable document with real text and working links. Best for
            articles, documentation and conversations. Complex styling is simplified.
          </dd>
        </dl>
      </section>

      <section class="options__section" aria-labelledby="limits">
        <h2 id="limits">Known limitations</h2>
        <ul class="options__list">
          <li>
            Chrome blocks extensions from reading its own pages, such as <code>chrome://</code>
            addresses and parts of the Chrome Web Store. Those pages cannot be captured at all.
          </li>
          <li>
            Content inside a frame from another website may not be readable; a region capture still works
            because it photographs what is on screen.
          </li>
          <li>
            Very long and infinite-scrolling pages are captured up to a defined limit rather than forever.
          </li>
          <li>
            Document mode uses the fonts built into every PDF reader, which cover Latin scripts. Other writing
            systems are preserved by Exact mode instead.
          </li>
          <li>Charts drawn on a canvas have no underlying text, so they are captured visually.</li>
        </ul>
      </section>

      <section class="options__section" aria-labelledby="privacy">
        <h2 id="privacy">Privacy</h2>
        <p>
          Captures are converted on this device. No page content, screenshot, extracted text, URL, page title
          or PDF is sent to the developer or to any other service. ExactPDF has no server and no account.
        </p>
        <p>
          Only your export preferences are stored. A capture in progress is held in session storage and
          removed once it has been saved or the preview is closed.
        </p>

        <h3>Permissions</h3>
        <dl class="options__definitions">
          {PERMISSION_JUSTIFICATIONS.map((entry) => (
            <>
              <dt key={`${entry.permission}-t`}>
                <code>{entry.permission}</code>
              </dt>
              <dd key={`${entry.permission}-d`}>{entry.justification}</dd>
            </>
          ))}
        </dl>
      </section>

      <section class="options__section" aria-labelledby="use">
        <h2 id="use">Acceptable use</h2>
        <p>
          ExactPDF captures content that is already visible to you in your browser. You are responsible for
          respecting copyright, confidentiality and the terms of the websites you capture. It is not a tool
          for bypassing paywalls, login restrictions or download controls, and it does not extract protected
          audio or video.
        </p>
      </section>
    </main>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: preact.ComponentChildren;
}): preact.JSX.Element {
  return (
    <label class="options__row">
      <span class="options__rowText">
        <span class="options__rowLabel">{label}</span>
        {hint !== undefined && <span class="options__rowHint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onToggle,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}): preact.JSX.Element {
  return (
    <label class="options__row options__row--toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onToggle(event.currentTarget.checked);
        }}
      />
      <span class="options__rowText">
        <span class="options__rowLabel">{label}</span>
        {hint !== undefined && <span class="options__rowHint">{hint}</span>}
      </span>
    </label>
  );
}
