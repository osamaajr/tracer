export function extractJsonLdObjects(document: Document): unknown[] {
  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  );

  return scripts.flatMap((script) => parseJsonLd(script.textContent ?? ""));
}

export function jsonLdHasType(value: unknown, typeName: string): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const type = value["@type"];

  if (Array.isArray(type)) {
    return type.some((item) => String(item).toLowerCase() === typeName.toLowerCase());
  }

  return String(type).toLowerCase() === typeName.toLowerCase();
}

export function findJsonLdByType(objects: unknown[], typeName: string): Record<string, unknown> | null {
  for (const object of flattenJsonLd(objects)) {
    if (isRecord(object) && jsonLdHasType(object, typeName)) {
      return object;
    }
  }

  return null;
}

export function flattenJsonLd(values: unknown[]): unknown[] {
  const flattened: unknown[] = [];

  for (const value of values) {
    if (Array.isArray(value)) {
      flattened.push(...flattenJsonLd(value));
      continue;
    }

    flattened.push(value);

    if (isRecord(value) && Array.isArray(value["@graph"])) {
      flattened.push(...flattenJsonLd(value["@graph"]));
    }
  }

  return flattened;
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const string = readString(item);

      if (string) {
        return string;
      }
    }

    return null;
  }

  return readString(value);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function parseJsonLd(text: string): unknown[] {
  if (!text.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);

    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
