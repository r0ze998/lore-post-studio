import { describe, expect, it } from "vitest";
import { parseImportText } from "@/lib/domain/import-text";

describe("資料の取り込み解析", () => {
  it("## 見出しごとに 1 項目", () => {
    const r = parseImportText("前置き\n## 白海\n干上がった海。\n二行目\n\n## 塩札\n通貨", "term");
    expect(r).toEqual([
      { title: "白海", body: "干上がった海。\n二行目", kind: "term" },
      { title: "塩札", body: "通貨", kind: "term" },
    ]);
  });
  it("見出しがなければ段落ごと（1 行目が名前）", () => {
    expect(parseImportText("白海\n干上がった海\n\n塩札\n通貨", "lore").map((x) => x.title)).toEqual(["白海", "塩札"]);
  });
  it("JSON 配列も読む。種類が不正なら指定の種類にする", () => {
    const r = parseImportText('[{"title":"A","body":"x","kind":"character"},{"title":"B","kind":"nope"},{"nottitle":1}]', "lore");
    expect(r.map((x) => [x.title, x.kind])).toEqual([
      ["A", "character"],
      ["B", "lore"],
    ]);
  });
});
