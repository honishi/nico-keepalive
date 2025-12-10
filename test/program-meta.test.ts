import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseProgramMetaFromHtml,
  parseProgramMetaFromPropsJson,
} from "../src/shared/program-meta";

const fixturePath = (...paths: string[]) => join(__dirname, "fixtures", ...paths);

describe("extractProviderInfo", () => {
  it("ライブ視聴ページの埋め込みデータから放送者名とIDを取得できる", () => {
    const html = readFileSync(fixturePath("html", "live-onair.html"), "utf-8");
    const info = parseProgramMetaFromHtml(html);
    expect(info.providerName).toBe("贅肉ちゃん");
    expect(info.providerId).toBe("52553742");
    expect(info.isOnAir).toBe(true);
  });

  it("supplier 情報が無い場合は undefined を返す", () => {
    const html = readFileSync(fixturePath("html", "live-onair.html"), "utf-8");
    const mutated = removeSupplier(html);
    const info = parseProgramMetaFromHtml(mutated);
    expect(info.providerName).toBeUndefined();
    expect(info.providerId).toBeUndefined();
    expect(info.isOnAir).toBe(true);
  });

  it("props JSON から直接抽出できる", () => {
    const props = JSON.stringify({
      program: { supplier: { name: "テスト", id: 123 }, status: "ON_AIR" },
    });
    const info = parseProgramMetaFromPropsJson(props);
    expect(info.providerName).toBe("テスト");
    expect(info.providerId).toBe("123");
    expect(info.isOnAir).toBe(true);
  });

  it("ステータスが ENDED の場合 isOnAir は false", () => {
    const props = JSON.stringify({
      program: { supplier: { name: "テスト", id: 123 }, status: "ENDED" },
    });
    const info = parseProgramMetaFromPropsJson(props);
    expect(info.isOnAir).toBe(false);
  });
});

function removeSupplier(html: string): string {
  const match = html.match(/data-props='([^']+)'/s) || html.match(/data-props="([^"]+)"/s);
  if (!match) throw new Error("data-props not found in fixture");
  const props = JSON.parse(match[1]);
  if (props?.program?.supplier) {
    delete props.program.supplier;
  }
  const replaced = html.replace(match[1], JSON.stringify(props));
  return replaced;
}
