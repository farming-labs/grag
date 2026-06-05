import docsConfig from "@/docs.config";
import { LlmsTocAction } from "@/app/components/llms-toc-action";
import { createNextDocsLayout, createNextDocsMetadata } from "@farming-labs/next/layout";

export const metadata = createNextDocsMetadata(docsConfig);

const DocsLayout = createNextDocsLayout(docsConfig);

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout>
      {children}
      <LlmsTocAction />
    </DocsLayout>
  );
}
