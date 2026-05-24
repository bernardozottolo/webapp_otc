export interface DocumentTypeConfig {
  type: string;
  pattern?: string;
}

export type DocumentValidationError = "required" | "invalid";

export function getDocumentTypeLabels(configs: DocumentTypeConfig[]): string[] {
  return configs.map((item) => item.type);
}

export function findDocumentTypeConfig(configs: DocumentTypeConfig[], documentType: string) {
  const normalizedType = documentType.trim();
  return configs.find((item) => item.type === normalizedType);
}

export function validateDocumentNumberForType(
  configs: DocumentTypeConfig[],
  documentType: string,
  documentNumber: string,
  normalize: (value: string) => string = (value) => value.replace(/\D/g, "") || value.trim()
): DocumentValidationError | null {
  const normalizedType = documentType.trim();
  if (!normalizedType) {
    return "required";
  }

  const normalizedNumber = normalize(documentNumber);
  if (!normalizedNumber) {
    return "required";
  }

  const config = findDocumentTypeConfig(configs, normalizedType);
  const pattern = config?.pattern?.trim();
  if (!pattern) {
    return null;
  }

  try {
    const regex = new RegExp(pattern);
    return regex.test(normalizedNumber) ? null : "invalid";
  } catch {
    return null;
  }
}
