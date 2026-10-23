/**
 * 保存先（バックエンド）の共通インターフェース。
 *
 * キーはパス風の文字列（例: "projects/<id>/entries.json", "projects/<id>/assets/<storedName>"）。
 * - file     : ローカルのファイル（DATA_DIR）。PC で使う既定。
 * - supabase : Postgres（文書）＋ Supabase Storage（素材ファイル）。Web（Vercel）で使う。
 */

/** 環境変数などの設定不足（画面にそのまま表示する）。 */
export class ConfigError extends Error {}

export class VersionConflict extends Error {
  constructor(key: string) {
    super(`同時に更新されました: ${key}`);
  }
}

export interface DocRecord {
  data: unknown;
  /** 楽観的排他用の版番号（file バックエンドは 0 固定）。 */
  version: number;
}

export interface Backend {
  kind: "file" | "supabase";
  /** 1 ファイルあたりの素材の上限（バイト）。 */
  maxAssetBytes: number;
  /** ブラウザと保存先の間で直接ファイルを受け渡すか（Vercel の 4.5MB 制限を避けるため）。 */
  directTransfer: boolean;
  /** 人が読める保存先の説明。 */
  describe(): string;

  readDoc(key: string): Promise<DocRecord | null>;
  /**
   * expectedVersion: undefined = 無条件に書く / 0 = まだ存在しない時だけ書く / n = 版が n の時だけ書く
   * 条件に合わなければ VersionConflict。
   */
  writeDoc(key: string, data: unknown, expectedVersion?: number): Promise<void>;
  /** "projects/<id>/project.json" がある id の一覧。 */
  listProjectIds(): Promise<string[]>;
  /** 接頭辞以下の文書・ファイルを、別の接頭辞へまとめて移す（削除＝trash への移動、置き換え取り込みに使う）。 */
  moveTree(fromPrefix: string, toPrefix: string): Promise<void>;
  /** 接頭辞以下に文書が 1 つでもあるか。 */
  hasTree(prefix: string): Promise<boolean>;

  putFile(key: string, data: Buffer, mime: string): Promise<void>;
  getFile(key: string): Promise<Buffer | null>;
  moveFile(fromKey: string, toKey: string): Promise<void>;
  /** ファイルの大きさ（存在しなければ null）。 */
  fileSize(key: string): Promise<number | null>;
  removeFile(key: string): Promise<void>;
  /** 接頭辞以下のファイルのキー（再帰）。 */
  listFiles(prefix: string): Promise<string[]>;

  /** directTransfer のとき：短時間有効なダウンロード URL。 */
  signedDownloadUrl?(key: string, downloadName?: string, expiresInSec?: number): Promise<string>;
  /** directTransfer のとき：ブラウザから直接アップロードする URL。 */
  signedUploadUrl?(key: string): Promise<string>;
}
