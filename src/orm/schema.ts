import { decimal, defineSchema, id, integer, model, string } from "@farming-labs/orm";
import type { OrmClient } from "@farming-labs/orm";

const nullableString = () => string().nullable();
const nullableInteger = () => integer().nullable();
const nullableDecimal = () => decimal().nullable();

export const graphRagOrmSchema = defineSchema({
  document: model({
    table: "grag_documents",
    fields: {
      id: id(),
      humanReadableId: nullableString().map("human_readable_id"),
      title: string(),
      type: string().default("text"),
      text: string(),
      attributesJson: nullableString().map("attributes_json"),
      rawDataJson: nullableString().map("raw_data_json"),
      createdAt: nullableString().map("created_at")
    },
    constraints: {
      indexes: [["title"]]
    }
  }),
  textUnit: model({
    table: "grag_text_units",
    fields: {
      id: id(),
      humanReadableId: nullableString().map("human_readable_id"),
      text: string(),
      nTokens: nullableInteger().map("n_tokens"),
      documentId: nullableString().map("document_id"),
      attributesJson: nullableString().map("attributes_json"),
      createdAt: nullableString().map("created_at")
    },
    constraints: {
      indexes: [["documentId"]]
    }
  }),
  entity: model({
    table: "grag_entities",
    fields: {
      id: id(),
      humanReadableId: nullableString().map("human_readable_id"),
      title: string(),
      type: nullableString(),
      description: nullableString(),
      descriptionEmbeddingJson: nullableString().map("description_embedding_json"),
      nameEmbeddingJson: nullableString().map("name_embedding_json"),
      frequency: nullableInteger(),
      degree: nullableInteger(),
      rank: nullableDecimal(),
      attributesJson: nullableString().map("attributes_json"),
      createdAt: nullableString().map("created_at")
    },
    constraints: {
      indexes: [["title"]]
    }
  }),
  relationship: model({
    table: "grag_relationships",
    fields: {
      id: id(),
      humanReadableId: nullableString().map("human_readable_id"),
      source: string(),
      target: string(),
      description: nullableString(),
      descriptionEmbeddingJson: nullableString().map("description_embedding_json"),
      weight: decimal().default("1"),
      combinedDegree: nullableInteger().map("combined_degree"),
      rank: nullableDecimal(),
      attributesJson: nullableString().map("attributes_json"),
      createdAt: nullableString().map("created_at")
    },
    constraints: {
      indexes: [["source", "target"]]
    }
  }),
  covariate: model({
    table: "grag_covariates",
    fields: {
      id: id(),
      humanReadableId: nullableString().map("human_readable_id"),
      covariateType: string().default("claim").map("covariate_type"),
      type: nullableString(),
      description: nullableString(),
      subjectId: string().map("subject_id"),
      subjectType: string().default("entity").map("subject_type"),
      objectId: nullableString().map("object_id"),
      status: nullableString(),
      startDate: nullableString().map("start_date"),
      endDate: nullableString().map("end_date"),
      sourceText: nullableString().map("source_text"),
      attributesJson: nullableString().map("attributes_json"),
      createdAt: nullableString().map("created_at")
    },
    constraints: {
      indexes: [["subjectType", "subjectId"]]
    }
  }),
  community: model({
    table: "grag_communities",
    fields: {
      id: id(),
      humanReadableId: nullableString().map("human_readable_id"),
      community: integer(),
      level: integer(),
      parent: nullableInteger(),
      childrenJson: string().default("[]").map("children_json"),
      title: string(),
      attributesJson: nullableString().map("attributes_json"),
      period: nullableString(),
      size: nullableInteger(),
      createdAt: nullableString().map("created_at")
    },
    constraints: {
      indexes: [["level"], ["community"]]
    }
  }),
  communityReport: model({
    table: "grag_community_reports",
    fields: {
      id: id(),
      humanReadableId: nullableString().map("human_readable_id"),
      community: integer(),
      level: integer(),
      parent: nullableInteger(),
      childrenJson: string().default("[]").map("children_json"),
      title: string(),
      summary: string().default(""),
      fullContent: string().default("").map("full_content"),
      rank: decimal().default("1"),
      ratingExplanation: nullableString().map("rating_explanation"),
      findingsJson: string().default("[]").map("findings_json"),
      fullContentJson: nullableString().map("full_content_json"),
      fullContentEmbeddingJson: nullableString().map("full_content_embedding_json"),
      attributesJson: nullableString().map("attributes_json"),
      period: nullableString(),
      size: nullableInteger(),
      createdAt: nullableString().map("created_at")
    },
    constraints: {
      indexes: [["level"], ["community"], ["rank"]]
    }
  }),
  embedding: model({
    table: "grag_embeddings",
    fields: {
      id: id(),
      humanReadableId: nullableString().map("human_readable_id"),
      targetKind: string().map("target_kind"),
      targetId: string().map("target_id"),
      vectorJson: string().map("vector_json"),
      model: nullableString(),
      dimensions: nullableInteger(),
      text: nullableString(),
      metadataJson: nullableString().map("metadata_json"),
      createdAt: nullableString().map("created_at")
    },
    constraints: {
      indexes: [["targetKind", "targetId"], ["model"]]
    }
  }),
  documentTextUnit: model({
    table: "grag_document_text_units",
    fields: {
      documentId: string().map("document_id"),
      textUnitId: string().map("text_unit_id"),
      position: integer().default(0)
    },
    constraints: {
      unique: [["documentId", "textUnitId"]],
      indexes: [["documentId"], ["textUnitId"]]
    }
  }),
  textUnitEntity: model({
    table: "grag_text_unit_entities",
    fields: {
      textUnitId: string().map("text_unit_id"),
      entityId: string().map("entity_id"),
      position: integer().default(0)
    },
    constraints: {
      unique: [["textUnitId", "entityId"]],
      indexes: [["textUnitId"], ["entityId"]]
    }
  }),
  textUnitRelationship: model({
    table: "grag_text_unit_relationships",
    fields: {
      textUnitId: string().map("text_unit_id"),
      relationshipId: string().map("relationship_id"),
      position: integer().default(0)
    },
    constraints: {
      unique: [["textUnitId", "relationshipId"]],
      indexes: [["textUnitId"], ["relationshipId"]]
    }
  }),
  textUnitCovariate: model({
    table: "grag_text_unit_covariates",
    fields: {
      textUnitId: string().map("text_unit_id"),
      covariateId: string().map("covariate_id"),
      position: integer().default(0)
    },
    constraints: {
      unique: [["textUnitId", "covariateId"]],
      indexes: [["textUnitId"], ["covariateId"]]
    }
  }),
  entityCommunity: model({
    table: "grag_entity_communities",
    fields: {
      entityId: string().map("entity_id"),
      communityId: string().map("community_id"),
      position: integer().default(0)
    },
    constraints: {
      unique: [["entityId", "communityId"]],
      indexes: [["entityId"], ["communityId"]]
    }
  }),
  entityTextUnit: model({
    table: "grag_entity_text_units",
    fields: {
      entityId: string().map("entity_id"),
      textUnitId: string().map("text_unit_id"),
      position: integer().default(0)
    },
    constraints: {
      unique: [["entityId", "textUnitId"]],
      indexes: [["entityId"], ["textUnitId"]]
    }
  }),
  relationshipTextUnit: model({
    table: "grag_relationship_text_units",
    fields: {
      relationshipId: string().map("relationship_id"),
      textUnitId: string().map("text_unit_id"),
      position: integer().default(0)
    },
    constraints: {
      unique: [["relationshipId", "textUnitId"]],
      indexes: [["relationshipId"], ["textUnitId"]]
    }
  }),
  covariateTextUnit: model({
    table: "grag_covariate_text_units",
    fields: {
      covariateId: string().map("covariate_id"),
      textUnitId: string().map("text_unit_id"),
      position: integer().default(0)
    },
    constraints: {
      unique: [["covariateId", "textUnitId"]],
      indexes: [["covariateId"], ["textUnitId"]]
    }
  }),
  communityEntity: model({
    table: "grag_community_entities",
    fields: {
      communityId: string().map("community_id"),
      entityId: string().map("entity_id"),
      position: integer().default(0)
    },
    constraints: {
      unique: [["communityId", "entityId"]],
      indexes: [["communityId"], ["entityId"]]
    }
  }),
  communityRelationship: model({
    table: "grag_community_relationships",
    fields: {
      communityId: string().map("community_id"),
      relationshipId: string().map("relationship_id"),
      position: integer().default(0)
    },
    constraints: {
      unique: [["communityId", "relationshipId"]],
      indexes: [["communityId"], ["relationshipId"]]
    }
  }),
  communityTextUnit: model({
    table: "grag_community_text_units",
    fields: {
      communityId: string().map("community_id"),
      textUnitId: string().map("text_unit_id"),
      position: integer().default(0)
    },
    constraints: {
      unique: [["communityId", "textUnitId"]],
      indexes: [["communityId"], ["textUnitId"]]
    }
  }),
  communityCovariate: model({
    table: "grag_community_covariates",
    fields: {
      communityId: string().map("community_id"),
      covariateId: string().map("covariate_id"),
      position: integer().default(0)
    },
    constraints: {
      unique: [["communityId", "covariateId"]],
      indexes: [["communityId"], ["covariateId"]]
    }
  })
});

export type GraphRagOrmSchema = typeof graphRagOrmSchema;
export type GraphRagOrmClient = OrmClient<GraphRagOrmSchema>;
