/**
 * ローカルファイルの保存先（PC 用）。書き込みは一時ファイル経由で、途中で落ちても壊れたファイルを残さない。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Backend, DocRecord } from "./types";

export class CorruptDoc extends Error {}

export function createFileBackend(rootDir: string): Backend {
  const root = path.resolve(rootDir);
  const abs = (key: string) => {
    const p = path.resolve(root, key);
    if (p !== root && !p.startsWith(root + path.sep)) throw new Error("不正なキーです");
    return p;
  };
  const exists = async (p: string) =>
    fs
      .access(p)
      .then(() => true)
      .catch(() => false);

  return {
    kind: "file",
    maxAssetBytes: 200 * 1024 * 1024,
    directTransfer: false,
    describe: () => root,

    async readDoc(key): Promise<DocRecord | null> {
      let raw: string;
      try {
        raw = await fs.readFile(abs(key), "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
      try {
        return { data: JSON.parse(raw), version: 0 };
      } catch {
        throw new CorruptDoc(key);
      }
    },

    async writeDoc(key, data) {
      const file = abs(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
      await fs.rename(tmp, file);
    },

    async listProjectIds() {
      try {
        const names = await fs.readdir(abs("projects"));
        const out: string[] = [];
        for (const n of names) if (await exists(path.join(abs("projects"), n, "project.json"))) out.push(n);
        return out;
      } catch {
        return [];
      }
    },

    async moveTree(fromPrefix, toPrefix) {
      const from = abs(fromPrefix.replace(/\/$/, ""));
      const to = abs(toPrefix.replace(/\/$/, ""));
      if (!(await exists(from))) return;
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
    },

    async hasTree(prefix) {
      return exists(abs(prefix.replace(/\/$/, "")));
    },

    async putFile(key, data) {
      const file = abs(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data);
    },

    async getFile(key) {
      try {
        return await fs.readFile(abs(key));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },

    async moveFile(fromKey, toKey) {
      const to = abs(toKey);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(abs(fromKey), to).catch(() => undefined);
    },

    async fileSize(key) {
      try {
        return (await fs.stat(abs(key))).size;
      } catch {
        return null;
      }
    },

    async removeFile(key) {
      await fs.rm(abs(key), { force: true });
    },

    async listFiles(prefix) {
      const base = abs(prefix.replace(/\/$/, ""));
      const out: string[] = [];
      const walk = async (d: string) => {
        let names: import("node:fs").Dirent[] = [];
        try {
          names = await fs.readdir(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const n of names) {
          const full = path.join(d, n.name);
          if (n.isDirectory()) await walk(full);
          else out.push(path.relative(root, full).split(path.sep).join("/"));
        }
      };
      await walk(base);
      return out;
    },
  };
}
