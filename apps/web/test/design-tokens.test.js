import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');
const TOKENS = join(SRC, 'ui', 'tokens.css');
const css = readFileSync(TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Values of `--name: #hex;` declarations inside the first rule whose selector matches. */
function block(selectorPattern) {
  const values = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorPattern.test(match[1].trim())) continue;
    for (const [, name, value] of match[2].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      values[name] = value;
    }
  }
  return values;
}

const root = block(/^:root$/);
const themes = {
  dark: { ...root, ...block(/^:root,\s*\[data-theme='dark'\]$/) },
  light: { ...root, ...block(/^\[data-theme='light'\]$/) },
};
themes.field = {
  ...themes.light,
  ...block(/^:root\[data-theme='light'\]\[data-surface='field'\]$/),
};

function luminance(hex) {
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** [foreground token, background token, minimum ratio]. 4.5 = text (WCAG 1.4.3), 3 = UI/graphics (1.4.11). */
const pairs = [
  ['fg', 'canvas', 4.5],
  ['fg', 'surface', 4.5],
  ['fg', 'raised', 4.5],
  ['fg', 'sunken', 4.5],
  ['fg-2', 'surface', 4.5],
  ['fg-2', 'sunken', 4.5],
  ['fg-3', 'canvas', 4.5],
  ['fg-3', 'surface', 4.5],
  ['fg-3', 'sunken', 4.5],
  ['fg', 'accent-soft', 4.5],
  ['accent-fg', 'accent', 4.5],
  ['accent-fg', 'accent-hover', 4.5],
  ['accent-text', 'surface', 4.5],
  ['accent-text', 'canvas', 4.5],
  ['accent-text', 'accent-soft', 4.5],
  ['danger-fg', 'danger-solid', 4.5],
  ['success', 'success-soft', 4.5],
  ['success', 'surface', 4.5],
  ['warning', 'warning-soft', 4.5],
  ['warning', 'surface', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['danger', 'surface', 4.5],
  ['info', 'info-soft', 4.5],
  ['info', 'surface', 4.5],
  ['fg', 'heat-0', 4.5],
  ['fg', 'heat-1', 4.5],
  ['fg', 'heat-2', 4.5],
  ['fg', 'heat-3', 4.5],
  // Non-text: form control borders, focus ring, chart series against the surface.
  ['control', 'surface', 3],
  ['focus', 'surface', 3],
  ['focus', 'canvas', 3],
  ['chart-1', 'surface', 3],
  ['chart-2', 'surface', 3],
  ['chart-3', 'surface', 3],
  ['chart-4', 'surface', 3],
  ['chart-5', 'surface', 3],
  ['chart-6', 'surface', 3],
];

describe('token contrast (WCAG 2.1 AA)', () => {
  for (const [theme, tokens] of Object.entries(themes)) {
    describe(theme, () => {
      for (const [foreground, background, minimum] of pairs) {
        it(`${foreground} on ${background} ≥ ${minimum}:1`, () => {
          expect(tokens[foreground], `--${foreground} is defined`).toBeDefined();
          expect(tokens[background], `--${background} is defined`).toBeDefined();
          expect(contrast(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(minimum);
        });
      }
    });
  }

  it('map scales step monotonically in lightness, so classes can be told apart', () => {
    for (const [name, tokens] of Object.entries({ dark: themes.dark, light: themes.light })) {
      const lightness = [1, 2, 3, 4, 5].map((step) => luminance(tokens['scale-' + step]));
      for (let index = 1; index < lightness.length; index += 1) {
        const gap = lightness[index] - lightness[index - 1];
        expect(name === 'dark' ? gap : -gap, name + ' step ' + index).toBeGreaterThan(0.02);
      }
      // The polygon outline and the selection ring are visible against every fill they touch.
      expect(contrast(tokens['map-select'], tokens.surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it('spring-700 is readable as text on white (≥ 4.5:1) while raw spring is not', () => {
    expect(contrast(root['spring-700'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(root.spring, '#ffffff')).toBeLessThan(3);
  });

  it('danger is told apart from the brand green by lightness as well as hue', () => {
    for (const tokens of [themes.dark, themes.light]) {
      const gap = Math.abs(luminance(tokens.danger) - luminance(tokens.accent));
      expect(gap).toBeGreaterThan(0.1);
    }
  });
});

/** Every source file under apps/web/src except the tokens file. */
function sourceFiles(directory = SRC) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'assets' ? [] : sourceFiles(path);
    return /\.(jsx?|css|html)$/.test(name) && path !== TOKENS ? [path] : [];
  });
}

describe('token discipline', () => {
  const files = sourceFiles();

  it('has no raw hex colors outside ui/tokens.css', () => {
    const offenders = files.filter((file) =>
      /(^|[^\w&])#[0-9a-fA-F]{3,8}\b/.test(
        readFileSync(file, 'utf8')
          // `&#39;` style entities and URL fragments are not colors.
          .replace(/&#\d+;/g, '')
          .replace(/href="#[\w-]*"/g, ''),
      ),
    );
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });

  it('has no raw Tailwind palette classes (use the semantic tokens)', () => {
    const palette =
      /\b(?:bg|text|border|ring|divide|fill|stroke|from|to|via|outline|placeholder|accent|shadow)-(?:slate|gray|zinc|neutral|stone|red|rose|amber|yellow|orange|emerald|green|lime|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink)-\d{2,3}\b/;
    const offenders = files.filter((file) => palette.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });

  it('uses only the approved font weights (400/500/600/700)', () => {
    const offenders = files.filter((file) =>
      /\bfont-(thin|extralight|light|extrabold|black)\b/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });
});
