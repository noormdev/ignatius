import { isAbsolute, resolve as resolvePath } from 'path';

import noormLogoPath from '../../assets/noorm-logo.svg' with { type: 'file' };

export type LogoPair = {
  dark: string;
  light: string;
};

export type CopyrightConfig = {
  holder: string;
  year: number;
};

export type Branding = {
  logo: LogoPair;
  title: string;
  subtitle: string;
  copyright: CopyrightConfig;
  poweredBy: boolean;
};

// Read the embedded SVG at module load and build a data URI.
// WHY: `with { type: "file" }` embeds the file into the compiled binary at
// $bunfs/ — Bun.file().arrayBuffer() works both in dev and in the binary.
const noormSvgBytes = new Uint8Array(await Bun.file(noormLogoPath).arrayBuffer());
const NOORM_DEFAULT_LOGO = `data:image/svg+xml;base64,${Buffer.from(noormSvgBytes).toString('base64')}`;

export const defaultBranding: Branding = {
  logo: { dark: NOORM_DEFAULT_LOGO, light: NOORM_DEFAULT_LOGO },
  title: 'Noorm Ignatius',
  subtitle: 'Visualize your data model',
  get copyright(): CopyrightConfig {
    return { holder: 'Noorm Ignatius', year: new Date().getFullYear() };
  },
  poweredBy: true,
};

type RawLogoInput = string | { dark?: string; light?: string };

type RawBrandingInput = Partial<{
  logo: RawLogoInput;
  title: string;
  subtitle: string;
  copyright: Partial<CopyrightConfig>;
  poweredBy: boolean;
}>;

// WHY: explicit `null` in object-form logo falls through to the embedded default by design.
function normalizeLogo(input: RawLogoInput): LogoPair {
  if (typeof input === 'string') {
    return { dark: input, light: input };
  }
  const dark = input.dark ?? input.light ?? NOORM_DEFAULT_LOGO;
  const light = input.light ?? input.dark ?? NOORM_DEFAULT_LOGO;
  return { dark, light };
}

export function mergeBranding(userInput: RawBrandingInput): Branding {
  const title = userInput.title ?? defaultBranding.title;
  const subtitle = userInput.subtitle ?? defaultBranding.subtitle;

  if (title.length > 50) {
    throw new Error(`branding.title exceeds 50 characters (actual length: ${title.length})`);
  }
  if (subtitle.length > 50) {
    throw new Error(`branding.subtitle exceeds 50 characters (actual length: ${subtitle.length})`);
  }

  return {
    logo: userInput.logo !== undefined ? normalizeLogo(userInput.logo) : defaultBranding.logo,
    title,
    subtitle,
    copyright: {
      holder: userInput.copyright?.holder ?? defaultBranding.copyright.holder,
      year: userInput.copyright?.year ?? defaultBranding.copyright.year,
    },
    poweredBy: userInput.poweredBy ?? defaultBranding.poweredBy,
  };
}

const LOGO_MIME_BY_EXT: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Read one logo path into a data URI, resolved against the model root.
 *
 * WHY: a value that is already a data: or remote URI is passed through, and
 * anything unreadable falls back to the embedded default. A broken <img> in
 * an exported file is worse than the noorm mark, and parse has no findings
 * channel at the point branding is merged.
 */
async function inlineLogo(value: string, modelRoot: string): Promise<string> {
  if (value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }

  const dot = value.lastIndexOf('.');
  const mime = dot === -1 ? undefined : LOGO_MIME_BY_EXT[value.slice(dot).toLowerCase()];

  if (mime === undefined) return NOORM_DEFAULT_LOGO;

  const file = Bun.file(isAbsolute(value) ? value : resolvePath(modelRoot, value));

  if (!(await file.exists())) return NOORM_DEFAULT_LOGO;

  const bytes = new Uint8Array(await file.arrayBuffer());

  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * Embed branding logos so a model renders without its asset folder.
 *
 * WHY: `branding.logo` takes a path, but both the served app and `export`
 * hand it straight to an <img src>. A relative path resolves against the
 * page rather than the model, so a branded export mailed to a stakeholder
 * showed a broken image, and the served app 404'd. Only the built-in mark
 * was ever a data URI.
 */
export async function inlineBrandingLogos(branding: Branding, modelRoot: string): Promise<Branding> {
  const [dark, light] = await Promise.all([
    inlineLogo(branding.logo.dark, modelRoot),
    inlineLogo(branding.logo.light, modelRoot),
  ]);

  return { ...branding, logo: { dark, light } };
}
