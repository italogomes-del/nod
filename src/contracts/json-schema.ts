/** Subconjunto de JSON Schema que o proxy expõe em tools/list e valida em tools/call. */
export type JsonSchema = {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  enum?: readonly string[];
  items?: JsonSchema;
  minLength?: number;
  minItems?: number;
};

