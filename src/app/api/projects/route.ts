import { z } from "zod";
import { handle } from "@/lib/server/http";
import * as store from "@/lib/server/store";
import { ProjectKind } from "@/lib/domain/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => ({ projects: await store.listProjects(), broken: store.getBrokenProjects() }));
}

const CreateBody = z.object({ name: z.string().trim().min(1).max(120), kind: ProjectKind, description: z.string().max(2000).default("") });

export async function POST(req: Request) {
  return handle(async () => store.createProject(CreateBody.parse(await req.json())), 201);
}
