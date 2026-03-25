import { csvEscape } from "@/utils/importHelpers";

/**
 * Constants and sample data for Observation Definition CSV imports.
 */

export const OBSERVATION_DEFINITION_CSV_HEADERS = [
  "title",
  "slug_value",
  "description",
  "category",
  "status",
  "code_system",
  "code_value",
  "code_display",
  "permitted_data_type",
  "body_site_system",
  "body_site_code",
  "body_site_display",
  "method_system",
  "method_code",
  "method_display",
  "permitted_unit_system",
  "permitted_unit_code",
  "permitted_unit_display",
  "derived_from_uri",
  // Flat component columns follow dynamically
] as const;

/**
 * Build the full set of flat component/interpretation/range column headers
 * for the given dimensions.
 */
export const buildComponentHeaders = (
  maxComponents: number,
  maxInterpretations: number,
  maxRanges: number,
): string[] => {
  const headers: string[] = [];
  for (let c = 1; c <= maxComponents; c++) {
    headers.push(
      `c${c}_code_system`,
      `c${c}_code_value`,
      `c${c}_code_display`,
      `c${c}_permitted_data_type`,
      `c${c}_unit_system`,
      `c${c}_unit_code`,
      `c${c}_unit_display`,
    );
    for (let i = 1; i <= maxInterpretations; i++) {
      headers.push(
        `c${c}_i${i}_age_min`,
        `c${c}_i${i}_age_max`,
        `c${c}_i${i}_age_op`,
        `c${c}_i${i}_gender`,
      );
      for (let r = 1; r <= maxRanges; r++) {
        headers.push(
          `c${c}_i${i}_r${r}_display`,
          `c${c}_i${i}_r${r}_min`,
          `c${c}_i${i}_r${r}_max`,
        );
      }
    }
  }
  return headers;
};

/**
 * Sample CSV rows for the flat component format.
 *
 * Row 1: "Complete Blood Count" — a panel with 2 components (Hemoglobin,
 *         Hematocrit). Hemoglobin has 2 interpretation sets showing
 *         age + gender conditions. Hematocrit has 2 unconditional sets.
 * Row 2: "Fasting Blood Sugar" — a simple OD with no components.
 */
export const SAMPLE_CSV_ROWS = {
  /**
   * Dimensions used for the sample — determines how many c/i/r headers
   * are generated.
   */
  dimensions: { components: 2, interpretations: 2, ranges: 3 },

  row1: {
    base: [
      "Complete Blood Count",
      "complete-blood-count",
      "CBC panel with Hemoglobin and Hematocrit",
      "laboratory",
      "active",
      "http://loinc.org",
      "58410-2",
      "CBC panel",
      "quantity",
      "", // body_site_system
      "", // body_site_code
      "", // body_site_display
      "", // method_system
      "", // method_code
      "", // method_display
      "", // permitted_unit_system
      "", // permitted_unit_code
      "", // permitted_unit_display
      "", // derived_from_uri
    ],
    components: [
      // ── Component 1: Hemoglobin ──
      "http://loinc.org",
      "LP32067-8",
      "Hemoglobin",
      "quantity",
      "http://unitsofmeasure.org",
      "g/dL",
      "gram per deciliter",

      // c1_i1: Male, age 12–18 years
      "12", // c1_i1_age_min
      "18", // c1_i1_age_max
      "years", // c1_i1_age_op
      "male", // c1_i1_gender
      // c1_i1 range bands
      "Low",
      "",
      "12.00", // r1: max=12
      "Normal",
      "12.00",
      "16.00", // r2: 12–16
      "High",
      "16.00",
      "", // r3: min=16

      // c1_i2: Female, age 12–18 years
      "12", // c1_i2_age_min
      "18", // c1_i2_age_max
      "years", // c1_i2_age_op
      "female", // c1_i2_gender
      "Low",
      "",
      "14.00",
      "Normal",
      "14.00",
      "18.00",
      "High",
      "18.00",
      "",

      // ── Component 2: Hematocrit (no age/gender conditions) ──
      "http://loinc.org",
      "LP15101-6",
      "Hematocrit",
      "quantity",
      "http://unitsofmeasure.org",
      "%",
      "percent",

      // c2_i1: unconditional
      "", // c2_i1_age_min
      "", // c2_i1_age_max
      "", // c2_i1_age_op
      "", // c2_i1_gender
      "Low",
      "",
      "36.00",
      "Normal",
      "36.00",
      "48.00",
      "High",
      "48.00",
      "",

      // c2_i2: unconditional
      "", // c2_i2_age_min
      "", // c2_i2_age_max
      "", // c2_i2_age_op
      "", // c2_i2_gender
      "Low",
      "",
      "40.00",
      "Normal",
      "40.00",
      "52.00",
      "High",
      "52.00",
      "",
    ],
  },

  row2: {
    base: [
      "Fasting Blood Sugar",
      "fasting-blood-sugar",
      "Fasting blood glucose",
      "laboratory",
      "active",
      "http://loinc.org",
      "1558-6",
      "Glucose [Moles/volume] in Serum or Plasma",
      "quantity",
      "",
      "",
      "", // body_site
      "",
      "",
      "", // method
      "http://unitsofmeasure.org",
      "mmol/L",
      "mmol/L",
      "", // derived_from_uri
    ],
    // No components — all component columns empty
    components: [] as string[],
  },
};

/**
 * Generate the full sample CSV string for download.
 */
export const generateSampleCsv = (): string => {
  const { dimensions, row1, row2 } = SAMPLE_CSV_ROWS;
  const componentHeaders = buildComponentHeaders(
    dimensions.components,
    dimensions.interpretations,
    dimensions.ranges,
  );

  const allHeaders = [
    ...OBSERVATION_DEFINITION_CSV_HEADERS,
    ...componentHeaders,
  ];

  const totalColumns = allHeaders.length;

  const padRow = (base: string[], components: string[]): string[] => {
    const full = [...base, ...components];
    // Pad with empty strings so every row has the same number of columns
    while (full.length < totalColumns) {
      full.push("");
    }
    return full.map(csvEscape);
  };

  const rows = [
    padRow(row1.base as string[], row1.components),
    padRow(row2.base as string[], row2.components),
  ];

  return `${allHeaders.join(",")}\n${rows.map((r) => r.join(",")).join("\n")}`;
};
