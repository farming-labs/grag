import { describe, expect, it } from "vitest";
import { source } from "../src/index.js";

describe("source factories", () => {
  it("preserves built-in discriminators even when runtime config carries a type field", () => {
    expect(
      source.repo({ url: "./app", type: "database" } as unknown as Parameters<typeof source.repo>[0]).type
    ).toBe("repo");
    expect(
      source.document({ content: [], type: "repo" } as unknown as Parameters<typeof source.document>[0]).type
    ).toBe("document");
    expect(
      source.database({ tableName: "support_tickets", rows: [], type: "url" } as unknown as Parameters<typeof source.database>[0]).type
    ).toBe("database");
    expect(
      source.url({ urls: ["https://example.com"], type: "document" } as unknown as Parameters<typeof source.url>[0]).type
    ).toBe("url");
  });
});
