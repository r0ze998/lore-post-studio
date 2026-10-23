/**
 * 正本（設定）に関する純粋関数。矛盾は検出して提示するだけで、自動では統合しない。
 */
import { KIND_DOMAIN, type Entry } from "./schema";
import { norm } from "./match";

/** その項目を本文中で指す名前（タイトル + 別名）。 */
export function namesOf(e: Entry): string[] {
  const xs = [e.title, ...e.aliases].map((s) => s.trim()).filter(Boolean);
  return Array.from(new Set(xs));
}

export interface ConflictCandidate {
  key: string;
  entryIds: string[];
  sharedName: string;
  reason: string;
}

/**
 * 同じ名前（タイトル・別名）を持つ、廃止されていない項目の組を「矛盾候補」として返す。
 * - 種類の領域（世界／表現／現実）が同じものだけを比べる
 * - supersedes（置き換え）関係や「矛盾ではない」と判断済みの組は除く
 * 内容の意味的な矛盾は判定しない（人が読んで判断する）。
 */
export function findConflictCandidates(entries: Entry[]): ConflictCandidate[] {
  const active = entries.filter((e) => e.status !== "deprecated");
  const byName = new Map<string, Entry[]>();
  for (const e of active) {
    for (const n of namesOf(e)) {
      const k = `${KIND_DOMAIN[e.kind]}::${norm(n)}`;
      const list = byName.get(k) ?? [];
      if (!list.includes(e)) list.push(e);
      byName.set(k, list);
    }
  }
  const out = new Map<string, ConflictCandidate>();
  for (const [k, list] of byName) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.supersedes.includes(b.id) || b.supersedes.includes(a.id)) continue;
        if (a.notConflictingWith.includes(b.id) || b.notConflictingWith.includes(a.id)) continue;
        const ids = [a.id, b.id].sort();
        const key = ids.join("|");
        if (out.has(key)) continue;
        const sharedName = k.split("::")[1];
        const both = a.status === "confirmed" && b.status === "confirmed";
        out.set(key, {
          key,
          entryIds: ids,
          sharedName,
          reason: both
            ? `確定済みの項目が同じ名前「${sharedName}」を持っています。内容が食い違っていないか確認し、片方を廃止するか「矛盾ではない」と記録してください。`
            : `同じ名前「${sharedName}」を持つ項目があります（${a.status === "proposed" || b.status === "proposed" ? "提案中の項目を含む" : ""}）。採用する方を決めるまで、提案側は確定扱いになりません。`,
        });
      }
    }
  }
  return Array.from(out.values());
}

/** 置き換え元（supersedes で指された項目）が廃止されていない場合の注意。 */
export function staleSuperseded(entries: Entry[]): { entry: Entry; replacedBy: Entry }[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out: { entry: Entry; replacedBy: Entry }[] = [];
  for (const e of entries) {
    if (e.status !== "confirmed") continue;
    for (const sid of e.supersedes) {
      const old = byId.get(sid);
      if (old && old.status !== "deprecated") out.push({ entry: old, replacedBy: e });
    }
  }
  return out;
}

export function entryLabel(e: Entry): string {
  return e.title;
}
