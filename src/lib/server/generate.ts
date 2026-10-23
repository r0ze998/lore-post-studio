import { z } from "zod";
import { Angle, DraftVersion, type Post } from "@/lib/domain/schema";
import { buildPrompt, relayText } from "@/lib/generation/prompt";
import { parseOutput, ParseError } from "@/lib/generation/parse";
import { templateAngles, templateDraft } from "@/lib/generation/template";
import { costOf, estimateCost } from "@/lib/generation/pricing";
import { GenerationTask, ProviderId, type AnglesOutput, type DraftOutput, type PromptPackage } from "@/lib/generation/types";
import { newId, nowIso } from "@/lib/util";
import { ANTHROPIC_MAX_TOKENS, anthropicModel, providerInfo, runAnthropic, runMock } from "./providers";
import * as store from "./store";
import { StoreError } from "./store";

export const GenerateRequest = z.object({
  action: z.enum(["preview", "run", "import"]),
  task: GenerationTask,
  provider: ProviderId,
  postId: z.string(),
  angleId: z.string().optional(),
  includeInternalIds: z.array(z.string()).default([]),
  extraInstruction: z.string().max(2000).default(""),
  /** preview で返した hash。run 時に一致しないと送信しない。 */
  confirmHash: z.string().optional(),
  /** relay の貼り戻し本文。 */
  raw: z.string().max(200_000).optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

async function load(projectId: string, postId: string) {
  const project = await store.getProject(projectId);
  if (!project) throw new StoreError("プロジェクトが見つかりません", 404);
  const [entries, posts, learnings, assets] = await Promise.all([
    store.listEntries(projectId),
    store.listPosts(projectId),
    store.listLearnings(projectId),
    store.listAssets(projectId),
  ]);
  const post = posts.find((p) => p.id === postId);
  if (!post) throw new StoreError("投稿が見つかりません", 404);
  return { project, entries, posts, learnings, assets, post };
}

export interface PreviewResponse {
  prompt: PromptPackage;
  relayText?: string;
  estimate?: ReturnType<typeof estimateCost>;
  provider: ReturnType<typeof providerInfo>;
  allowExternal: boolean;
}

export async function handleGenerate(projectId: string, req: GenerateRequest): Promise<unknown> {
  const data = await load(projectId, req.postId);
  const info = providerInfo(req.provider);
  if (!info) throw new StoreError("この提供元は使えません");

  const pkg = buildPrompt({ ...data, task: req.task, angleId: req.angleId, includeInternalIds: req.includeInternalIds, extraInstruction: req.extraInstruction });

  if (req.action === "preview") {
    const res: PreviewResponse = {
      prompt: pkg,
      provider: info,
      allowExternal: data.project.settings.allowExternalModel,
      relayText: req.provider === "relay" ? relayText(pkg) : undefined,
      estimate: req.provider === "anthropic" ? estimateCost(anthropicModel(), pkg.system + pkg.user, req.task, ANTHROPIC_MAX_TOKENS) : undefined,
    };
    return res;
  }

  const knownIds = new Set(data.entries.map((e) => e.id));
  let output: AnglesOutput | DraftOutput;
  let generator = info.label;
  let origin: "template" | "model" | "relay" = "model";

  if (req.action === "import") {
    if (req.provider !== "relay") throw new StoreError("貼り戻しは手動中継でのみ使えます");
    if (!req.raw?.trim()) throw new StoreError("貼り戻す内容が空です");
    try {
      output = parseOutput(req.task, req.raw, knownIds);
    } catch (e) {
      if (e instanceof ParseError) throw new StoreError(e.message);
      throw e;
    }
    origin = "relay";
    generator = "手動中継";
    await store.appendSendLog(projectId, {
      provider: "relay",
      model: "（利用者が選んだ外部サービス）",
      task: req.task,
      postId: req.postId,
      entryIds: pkg.included.map((i) => i.id),
      excludedEntryIds: pkg.excluded.map((i) => i.id),
      promptChars: pkg.chars,
      ok: true,
      error: "",
    });
  } else if (req.provider === "template") {
    origin = "template";
    output = req.task === "angles" ? templateAngles(data) : templateDraft(data, data.post.angles.find((a) => a.id === (req.angleId || data.post.chosenAngleId)));
  } else if (req.provider === "mock") {
    if (!info.available) throw new StoreError("モックは無効です");
    output = parseOutput(req.task, runMock(pkg).rawText, knownIds);
    generator = "mock";
  } else if (req.provider === "anthropic") {
    if (!info.available) throw new StoreError(info.reason || "Anthropic API は使えません");
    if (!data.project.settings.allowExternalModel) {
      throw new StoreError("このプロジェクトは外部モデルへの送信が許可されていません（プロジェクト設定で変更できます）", 403);
    }
    if (!req.confirmHash || req.confirmHash !== pkg.hash) {
      throw new StoreError("送信内容が確認時から変わりました。もう一度「送信内容を確認」してください。", 409);
    }
    const model = anthropicModel();
    try {
      const r = await runAnthropic(pkg);
      output = parseOutput(req.task, r.rawText, knownIds);
      generator = `Anthropic API / ${r.model}`;
      await store.appendSendLog(projectId, {
        provider: "anthropic",
        model: r.model,
        task: req.task,
        postId: req.postId,
        entryIds: pkg.included.map((i) => i.id),
        excludedEntryIds: pkg.excluded.map((i) => i.id),
        promptChars: pkg.chars,
        usage: r.usage,
        estimatedCostUsd: r.usage ? costOf(r.model, r.usage) : undefined,
        ok: true,
        error: "",
      });
    } catch (e) {
      await store.appendSendLog(projectId, {
        provider: "anthropic",
        model,
        task: req.task,
        postId: req.postId,
        entryIds: pkg.included.map((i) => i.id),
        excludedEntryIds: pkg.excluded.map((i) => i.id),
        promptChars: pkg.chars,
        ok: false,
        error: e instanceof Error ? e.message.slice(0, 500) : String(e),
      });
      if (e instanceof ParseError) throw new StoreError(`モデルの出力を読み取れませんでした: ${e.message}`, 502);
      throw new StoreError(`Anthropic API の呼び出しに失敗しました: ${e instanceof Error ? e.message : String(e)}`, 502);
    }
  } else {
    throw new StoreError("手動中継はプロンプトをコピーして、結果を貼り戻してください");
  }

  const post = applyOutput(data.post, req.task, output, origin, generator);
  return store.updatePost(projectId, post.id, post);
}

function applyOutput(post: Post, task: GenerationTask, output: AnglesOutput | DraftOutput, origin: "template" | "model" | "relay", generator: string): Post {
  if (task === "angles") {
    const angles = (output as AnglesOutput).angles.map((a) => Angle.parse({ id: newId("ang"), ...a, origin }));
    return { ...post, angles: [...post.angles, ...angles] };
  }
  const d = output as DraftOutput;
  const draft = DraftVersion.parse({
    id: newId("drf"),
    createdAt: nowIso(),
    origin,
    generator,
    language: post.brief.language,
    creativeNotes: d.creativeNotes,
    segments: d.segments.map((s) => ({
      id: newId("seg"),
      text: s.text,
      voice: s.voice,
      jaGloss: s.jaGloss,
      assetIds: [],
      provenance: s.provenance,
    })),
  });
  return {
    ...post,
    drafts: [...post.drafts, draft],
    currentDraftId: draft.id,
    status: post.status === "idea" ? "drafting" : post.status,
  };
}
