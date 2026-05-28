import noormLogoPath from '../assets/noorm-logo.svg' with { type: 'file' };

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
  subtitle: 'Write SQL. Skip the ORM.',
  copyright: { holder: 'Noorm Ignatius', year: new Date().getFullYear() },
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
