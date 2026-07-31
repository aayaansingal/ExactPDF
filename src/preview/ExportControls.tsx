/**
 * The export controls.
 *
 * Grouped as segmented button rows rather than dropdowns: there are few enough
 * options in each group that showing them all is faster than opening a menu,
 * and it makes the available tradeoffs visible rather than hidden.
 */

import { normalizeUserFilename } from '../shared/filename.js';
import type {
  BackgroundMode,
  ExportOptions,
  MarginPreset,
  Orientation,
  PageSize,
  QualityPreset,
  RenderMode,
} from '../shared/types.js';

interface Props {
  readonly options: ExportOptions;
  /** Document captures cannot offer Exact mode: there is no raster to show. */
  readonly isDocument: boolean;
  readonly onChange: (options: ExportOptions) => void;
}

interface Choice<T> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

const RENDER_MODES: Choice<RenderMode>[] = [
  {
    value: 'exact',
    label: 'Exact',
    hint: 'Looks exactly like the page. Larger file, text is not selectable.',
  },
  {
    value: 'document',
    label: 'Document',
    hint: 'Searchable text and clean pages. Simplifies complex styling.',
  },
];

const PAGE_SIZES: Choice<PageSize>[] = [
  { value: 'original', label: 'Original' },
  { value: 'continuous', label: 'Continuous' },
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
];

const ORIENTATIONS: Choice<Orientation>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

const MARGINS: Choice<MarginPreset>[] = [
  { value: 'zero', label: 'None' },
  { value: 'narrow', label: 'Narrow' },
  { value: 'standard', label: 'Standard' },
  { value: 'custom', label: 'Custom' },
];

const BACKGROUNDS: Choice<BackgroundMode>[] = [
  { value: 'preserve', label: 'Preserve' },
  { value: 'forceLight', label: 'Force light' },
  { value: 'transparent', label: 'Transparent' },
];

const QUALITIES: Choice<QualityPreset>[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'maximum', label: 'Maximum' },
];

export function ExportControls({ options, isDocument, onChange }: Props): preact.JSX.Element {
  const update = (patch: Partial<ExportOptions>): void => {
    onChange({ ...options, ...patch });
  };

  const activeMode = RENDER_MODES.find((choice) => choice.value === options.renderMode);

  return (
    <div class="controls">
      {!isDocument && (
        <Group label="Mode">
          <Segmented
            name="renderMode"
            choices={RENDER_MODES}
            value={options.renderMode}
            onSelect={(renderMode) => {
              update({ renderMode });
            }}
          />
          {activeMode?.hint !== undefined && <p class="controls__hint">{activeMode.hint}</p>}
        </Group>
      )}

      <Group label="Page size">
        <Segmented
          name="pageSize"
          choices={PAGE_SIZES}
          value={options.pageSize}
          onSelect={(pageSize) => {
            update({ pageSize });
          }}
        />
      </Group>

      <Group label="Orientation">
        <Segmented
          name="orientation"
          choices={ORIENTATIONS}
          value={options.orientation}
          onSelect={(orientation) => {
            update({ orientation });
          }}
        />
      </Group>

      <Group label="Margins">
        <Segmented
          name="marginPreset"
          choices={MARGINS}
          value={options.marginPreset}
          onSelect={(marginPreset) => {
            update({ marginPreset });
          }}
        />
        {options.marginPreset === 'custom' && (
          <div class="controls__margins">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <label key={side} class="controls__margin">
                <span class="controls__marginLabel">{side}</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={options.customMargins[side]}
                  onInput={(event) => {
                    const raw = Number(event.currentTarget.value);
                    update({
                      customMargins: {
                        ...options.customMargins,
                        [side]: Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0,
                      },
                    });
                  }}
                />
                <span class="controls__unit">mm</span>
              </label>
            ))}
          </div>
        )}
      </Group>

      {!isDocument && (
        <Group label="Background">
          <Segmented
            name="background"
            choices={BACKGROUNDS}
            value={options.background}
            onSelect={(background) => {
              update({ background });
            }}
          />
        </Group>
      )}

      {!isDocument && (
        <Group label="Quality">
          <Segmented
            name="quality"
            choices={QUALITIES}
            value={options.quality}
            onSelect={(quality) => {
              update({ quality });
            }}
          />
        </Group>
      )}

      <Group label="Filename">
        <div class="controls__filename">
          <input
            type="text"
            class="controls__input"
            value={options.filename.replace(/\.pdf$/i, '')}
            aria-label="File name"
            onInput={(event) => {
              update({ filename: event.currentTarget.value });
            }}
            onBlur={(event) => {
              update({
                filename: normalizeUserFilename(event.currentTarget.value),
              });
            }}
          />
          <span class="controls__extension">.pdf</span>
        </div>
      </Group>

      <Group label="Include">
        <div class="controls__checks">
          <Check
            label="Page title"
            checked={options.metadata.includeTitle}
            onToggle={(includeTitle) => {
              update({ metadata: { ...options.metadata, includeTitle } });
            }}
          />
          <Check
            label="Source URL"
            checked={options.metadata.includeSourceUrl}
            onToggle={(includeSourceUrl) => {
              update({ metadata: { ...options.metadata, includeSourceUrl } });
            }}
          />
          <Check
            label="Capture date"
            checked={options.metadata.includeCaptureDate}
            onToggle={(includeCaptureDate) => {
              update({ metadata: { ...options.metadata, includeCaptureDate } });
            }}
          />
          <Check
            label="Footer on every page"
            checked={options.metadata.includeFooter}
            onToggle={(includeFooter) => {
              update({ metadata: { ...options.metadata, includeFooter } });
            }}
          />
        </div>
      </Group>
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: preact.ComponentChildren;
}): preact.JSX.Element {
  return (
    <fieldset class="controls__group">
      <legend class="controls__legend">{label}</legend>
      {children}
    </fieldset>
  );
}

function Segmented<T extends string>({
  name,
  choices,
  value,
  onSelect,
}: {
  name: string;
  choices: Choice<T>[];
  value: T;
  onSelect: (value: T) => void;
}): preact.JSX.Element {
  return (
    <div class="segmented" role="radiogroup" aria-label={name}>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={value === choice.value}
          class={`segmented__option${value === choice.value ? ' segmented__option--active' : ''}`}
          onClick={() => {
            onSelect(choice.value);
          }}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

function Check({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}): preact.JSX.Element {
  return (
    <label class="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onToggle(event.currentTarget.checked);
        }}
      />
      <span>{label}</span>
    </label>
  );
}
