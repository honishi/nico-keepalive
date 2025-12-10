export type ProgramMeta = {
  providerId?: string;
  providerName?: string;
  isOnAir?: boolean;
};

type Supplier = {
  programProviderId?: unknown;
  id?: unknown;
  name?: unknown;
};

type ProgramJson = {
  program?: {
    supplier?: Supplier;
    status?: unknown;
  };
};

/**
 * data-props の JSON から放送者情報を抽出する
 */
export function parseProgramMetaFromPropsJson(json: string): ProgramMeta {
  const parsed = JSON.parse(json) as ProgramJson;
  const supplier: Supplier = parsed.program?.supplier ?? {};
  const status = parsed.program?.status;

  const rawId =
    typeof supplier?.programProviderId !== "undefined" ? supplier.programProviderId : supplier?.id;

  const providerId =
    typeof rawId === "number" ? String(rawId) : typeof rawId === "string" ? rawId : undefined;

  const providerName =
    typeof supplier?.name === "string" && supplier.name.trim().length > 0
      ? supplier.name
      : undefined;

  const isOnAir = typeof status === "string" ? status === "ON_AIR" : undefined;

  return { providerId, providerName, isOnAir };
}

/**
 * HTML 文字列から #embedded-data の data-props を抜き出し、放送者情報を返す
 */
export function parseProgramMetaFromHtml(html: string): ProgramMeta {
  const props = extractEmbeddedDataProps(html);
  if (!props) return {};
  try {
    return parseProgramMetaFromPropsJson(props);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("failed to parse provider info from html", err);
    return {};
  }
}

/**
 * Document から #embedded-data の data-props を読み、放送者情報を返す
 */
export function parseProgramMetaFromDocument(doc: Document): ProgramMeta {
  const embedded = doc.getElementById("embedded-data");
  const props = embedded?.getAttribute("data-props");
  if (!props) return {};
  try {
    return parseProgramMetaFromPropsJson(props);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("failed to parse provider info from document", err);
    return {};
  }
}

function extractEmbeddedDataProps(html: string): string | null {
  // data-props は通常シングルクオートで囲まれている
  const singleQuoted = html.match(/id=["']embedded-data["'][^>]*data-props='([^']+)'/s);
  if (singleQuoted?.[1]) return singleQuoted[1];

  const doubleQuoted = html.match(/id=["']embedded-data["'][^>]*data-props="([^"]+)"/s);
  if (doubleQuoted?.[1]) return doubleQuoted[1];

  return null;
}
