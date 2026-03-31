/**
 * Allowed filter operators for ValueSet compose entries.
 */
export const VALUESET_FILTER_OPS = [
  "=",
  "is-a",
  "descendent-of",
  "is-not-a",
  "regex",
  "in",
  "not-in",
  "generalizes",
  "child-of",
  "descendent-leaf",
  "exists",
] as const;

export type ValueSetFilterOp = (typeof VALUESET_FILTER_OPS)[number];

/**
 * Allowed code systems.
 */
export const VALUESET_CODE_SYSTEMS = [
  "http://loinc.org",
  "http://snomed.info/sct",
  "http://unitsofmeasure.org",
] as const;

export type CodeSystem = (typeof VALUESET_CODE_SYSTEMS)[number];

export const CODE_SYSTEM_LABELS: Record<CodeSystem, string> = {
  "http://loinc.org": "LOINC",
  "http://snomed.info/sct": "SNOMED CT",
  "http://unitsofmeasure.org": "Units of Measure",
};

export interface ValueSetConcept {
  code: string;
  display: string;
}

export interface ValueSetFilter {
  property: string;
  op: ValueSetFilterOp;
  value: string;
}

export interface ValueSetComposeItem {
  system: CodeSystem;
  concept: ValueSetConcept[];
  filter: ValueSetFilter[];
}

export interface ValueSetCompose {
  include: ValueSetComposeItem[];
  exclude: ValueSetComposeItem[];
}

export interface ValueSetCreate {
  name: string;
  slug: string;
  description: string;
  status: "active";
  is_system_defined: boolean;
  compose: ValueSetCompose;
}

export interface ValueSetRead extends ValueSetCreate {
  id: string;
}
