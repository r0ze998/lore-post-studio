import { ProjectShell } from "@/components/shell";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  return <ProjectShell pid={pid}>{children}</ProjectShell>;
}
