import { z } from "zod";
import { Basis, SegmentVoice } from "@/lib/domain/schema";

export const GenerationTask = z.enum(["angles", "draft"]);
export type GenerationTask = z.infer<typeof GenerationTask>;

export const ProviderId = z.enum(["template", "relay", "anthropic", "mock"]);
export type ProviderId = z.infer<typeof ProviderId>;

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** external: 外部サービスに資料を送る */
  kind: "local" | "manual" | "external";
  available: boolean;
  reason: string;
  description: string;
  model?: string;
}

/* モデルからの出力（JSON）。手動中継の貼り戻しも同じ形。 */
export const AnglesOutput = z.object({
  angles: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        approach: z.string().max(600).default(""),
        why: z.string().max(600).default(""),
      }),
    )
    .min(1)
    .max(8),
});
export type AnglesOutput = z.infer<typeof AnglesOutput>;

export const DraftOutput = z.object({
  segments: z
    .array(
      z.object({
        text: z.string().min(1).max(2000),
        voice: SegmentVoice,
        jaGloss: z.string().max(2000).default(""),
        provenance: z
          .array(
            z.object({
              quote: z.string().max(400).default(""),
              basis: Basis,
              refIds: z.array(z.string()).default([]),
              note: z.string().max(400).default(""),
            }),
          )
          .default([]),
      }),
    )
    .min(1)
    .max(25),
  creativeNotes: z.string().max(2000).default(""),
});
export type DraftOutput = z.infer<typeof DraftOutput>;

export interface ContextItem {
  id: string;
  kind: string;
  title: string;
  status: string;
  reason?: string;
  /** 未公開だが本人が今回送ると選んだ項目。 */
  internal?: boolean;
}

export interface PromptPackage {
  task: GenerationTask;
  system: string;
  user: string;
  /** 送信する正本項目。 */
  included: ContextItem[];
  /** 送信しない正本項目と理由。 */
  excluded: ContextItem[];
  /** 自由文（企画・学び・過去の下書きなど）から伏せた未公開の名前。 */
  redactions: { where: string; count: number }[];
  chars: number;
  hash: string;
}
