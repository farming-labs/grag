import { describe, expect, it } from "vitest";
import {
  DataSourceLoader,
  MemoryGraphRagStore,
  createGraphRagService,
  loadDatabaseSource,
  source,
  type RelationalRow,
} from "../src/index.js";

type SupportTicket = RelationalRow & {
  ticket_id: string;
  customer: string;
  subject: string;
  body: string;
  severity: "sev1" | "sev2" | "sev3";
  status: "open" | "resolved" | "spam";
  created_at: Date;
  tags: string[];
};

describe("database sources", () => {
  it("loads async support-ticket rows into citeable documents and retrieval evidence", async () => {
    const rows: SupportTicket[] = [
      {
        ticket_id: "TCK-1001",
        customer: "Acme",
        subject: "Billing export checksum mismatch after migration",
        body: [
          "Acme reports that the billing export fails after the Postgres migration.",
          "The generated CSV has a checksum mismatch in the invoice totals column.",
          "The workaround is to rerun the export job after clearing the stale ledger cache.",
        ].join(" "),
        severity: "sev1",
        status: "open",
        created_at: new Date("2026-05-12T10:15:00.000Z"),
        tags: ["billing", "export", "migration"],
      },
      {
        ticket_id: "TCK-1002",
        customer: "Globex",
        subject: "Password reset delivery delay",
        body: "Globex users receive password reset emails after a five minute delay from the transactional email queue.",
        severity: "sev3",
        status: "resolved",
        created_at: new Date("2026-05-14T08:30:00.000Z"),
        tags: ["auth", "email"],
      },
      {
        ticket_id: "TCK-1003",
        customer: "SpamCo",
        subject: "Promotional spam",
        body: "This row should not be indexed because the source query filters spam tickets.",
        severity: "sev3",
        status: "spam",
        created_at: new Date("2026-05-15T09:00:00.000Z"),
        tags: ["spam"],
      },
    ];
    let queryCount = 0;

    const tickets = source.database<SupportTicket>({
      label: "Production support tickets",
      tableName: "support_tickets",
      loadRows: async () => {
        queryCount += 1;
        return rows.filter((row) => row.status !== "spam");
      },
      idColumn: "ticket_id",
      titleColumn: "subject",
      textColumn: "body",
      attributeColumns: ["customer", "severity", "status", "created_at", "tags"],
    });

    const loader = new DataSourceLoader([tickets], { chunkSize: 80, overlap: 0 });
    const loaded = await loader.load();

    expect(queryCount).toBe(1);
    expect(loaded.sourceCount).toBe(1);
    expect(loaded.documentCount).toBe(2);
    expect(loaded.documents.map((doc) => doc.humanReadableId)).toEqual([
      "support_tickets:TCK-1001",
      "support_tickets:TCK-1002",
    ]);

    const billingDoc = loaded.documents.find(
      (doc) => doc.humanReadableId === "support_tickets:TCK-1001",
    );
    expect(billingDoc).toBeDefined();
    expect(billingDoc?.title).toBe("Billing export checksum mismatch after migration");
    expect(billingDoc?.text).toContain("checksum mismatch");
    expect(billingDoc?.attributes).toMatchObject({
      customer: "Acme",
      severity: "sev1",
      status: "open",
      created_at: "2026-05-12T10:15:00.000Z",
      tags: ["billing", "export", "migration"],
      sourceKind: "database",
      sourceLabel: "Production support tickets",
      sourcePath: "database:support_tickets:TCK-1001",
      sourceRowId: "TCK-1001",
      sourceTable: "support_tickets",
    });
    expect(billingDoc?.rawData).toMatchObject({
      ticket_id: "TCK-1001",
      customer: "Acme",
      created_at: "2026-05-12T10:15:00.000Z",
    });

    const billingChunk = loaded.textUnits.find((unit) => unit.documentId === billingDoc?.id);
    expect(billingChunk?.attributes).toMatchObject({
      documentTitle: "Billing export checksum mismatch after migration",
      sourcePath: "database:support_tickets:TCK-1001",
      sourceTable: "support_tickets",
      sourceRowId: "TCK-1001",
    });

    const store = new MemoryGraphRagStore();
    await store.upsertGraph({
      documents: loaded.documents,
      textUnits: loaded.textUnits,
    });
    const service = createGraphRagService({ store });

    const result = await service.searchGraph(
      "Which customer has a billing export checksum mismatch?",
      {
        limit: 4,
      },
    );

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]?.sourcePaths).toContain("database:support_tickets:TCK-1001");
    expect(result.citations[0]?.sourcePaths).toContain("database:support_tickets:TCK-1001");
    expect(result.context).toContain("[S1]");
    expect(result.context).toContain("checksum mismatch");
  });

  it("rejects ambiguous or missing database row mappings", async () => {
    await expect(
      loadDatabaseSource(source.database({ tableName: "support_tickets" })),
    ).rejects.toThrow(/rows or loadRows/);

    await expect(
      loadDatabaseSource(
        source.database({
          tableName: "support_tickets",
          rows: [{ id: "TCK-1", body: "Ticket body" }],
          textColumn: "body",
          textColumns: ["body"],
        }),
      ),
    ).rejects.toThrow(/either textColumn or textColumns/);

    await expect(
      loadDatabaseSource(
        source.database({
          tableName: "support_tickets",
          rows: [{ id: "TCK-1", subject: "Missing body" }] as RelationalRow[],
          textColumn: "body",
        }),
      ),
    ).rejects.toThrow(/textColumn "body" is missing from row 0/);
  });
});
