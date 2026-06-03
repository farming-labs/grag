import type { JsonObject, JsonValue } from "../model.js";

export function encodeJson(value: JsonValue | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.stringify(value);
}

export function decodeJson<T extends JsonValue>(value: string | undefined | null, fallback: T): T {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return JSON.parse(value) as T;
}

export function decodeJsonObject(value: string | undefined | null): JsonObject | undefined {
  return decodeJson<JsonObject | null>(value, null) ?? undefined;
}
