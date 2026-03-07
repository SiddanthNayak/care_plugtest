import { APIError, queryString, request } from "@/apis/request";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ResourceCategoryResourceType } from "@/types/base/resourceCategory/resourceCategory";
import { parseCsvText } from "@/utils/csv";
import { upsertResourceCategories } from "@/utils/resourceCategory";
import { createSlug } from "@/utils/slug";
import { AlertCircle, CheckCircle2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface ActivityDefinitionImportProps {
  facilityId?: string;
}

type CodePayload = {
  system: string;
  code: string;
  display: string;
};

type ActivityRow = {
  title: string;
  slug_value?: string;
  description: string;
  usage: string;
  status: string;
  classification: string;
  kind: string;
  code: CodePayload;
  body_site: CodePayload | null;
  diagnostic_report_codes: CodePayload[];
  derived_from_uri?: string;
  category_name: string;
  specimen_names: string[];
  observation_names: string[];
  charge_item_names: string[];
  location_names: string[];
  healthcare_service_name?: string;
};

interface ResolvedRow {
  categorySlug?: string;
  specimenSlugs: string[];
  observationSlugs: string[];
  chargeItemSlugs: string[];
  locationIds: string[];
  healthcareServiceId?: string | null;
}

interface ProcessedRow {
  rowIndex: number;
  data: ActivityRow;
  errors: string[];
  resolved?: ResolvedRow;
}

interface ImportResults {
  processed: number;
  created: number;
  updated: number;
  failed: number;
  skipped: number;
  failures: { rowIndex: number; title?: string; reason: string }[];
}

interface PaginatedResponse<T> {
  results: T[];
  count?: number;
}

const REQUIRED_HEADERS = [
  "title",
  "description",
  "usage",
  "status",
  "classification",
  "category_name",
  "code_system",
  "code_value",
  "code_display",
] as const;

const ACTIVITY_STATUSES = ["draft", "active", "retired", "unknown"] as const;
const ACTIVITY_CLASSIFICATIONS = [
  "laboratory",
  "imaging",
  "surgical_procedure",
  "counselling",
] as const;
const ACTIVITY_KIND = "service_request";

const normalizeHeader = (header: string) =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "");

const normalizeName = (value: string) => value.trim().toLowerCase();

const splitCellValues = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const isNonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0;

const buildOptionalCode = (
  system: string | undefined,
  code: string | undefined,
  display: string | undefined,
  errors: string[],
  label: string,
  defaultSystem?: string,
) => {
  const trimmedCode = code?.trim();
  const trimmedDisplay = display?.trim();
  if (!trimmedCode && !trimmedDisplay) {
    return null;
  }
  if (!trimmedCode || !trimmedDisplay) {
    errors.push(`${label} requires both code and display if provided`);
    return null;
  }
  const resolvedSystem = system?.trim() || defaultSystem;
  if (!resolvedSystem) {
    errors.push(`${label} requires system if provided`);
    return null;
  }
  return { system: resolvedSystem, code: trimmedCode, display: trimmedDisplay };
};

const getCellValue = (
  row: string[],
  headerMap: Record<string, number>,
  key: string,
) => {
  const index = headerMap[normalizeHeader(key)];
  return index === undefined ? "" : (row[index] ?? "");
};

const csvEscape = (value: string) => `"${value.replace(/"/g, '""')}"`;

const stripMappingErrors = (errors: string[]) =>
  errors.filter(
    (error) =>
      !error.startsWith("Unknown specimen:") &&
      !error.startsWith("Unknown observation:") &&
      !error.startsWith("Unknown charge item:") &&
      !error.startsWith("Unknown location:") &&
      !error.startsWith("Unknown healthcare service:"),
  );

export default function ActivityDefinitionImport({
  facilityId,
}: ActivityDefinitionImportProps) {
  const [currentStep, setCurrentStep] = useState<
    "upload" | "review" | "importing" | "done"
  >("upload");
  const [uploadError, setUploadError] = useState<string>("");
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const [processedRows, setProcessedRows] = useState<ProcessedRow[]>([]);
  const [results, setResults] = useState<ImportResults | null>(null);
  const [totalToImport, setTotalToImport] = useState(0);
  const [mappingStatus, setMappingStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [mappingIssues, setMappingIssues] = useState<string[]>([]);
  const [lastMappingSignature, setLastMappingSignature] = useState<string>("");

  const summary = useMemo(() => {
    const valid = processedRows.filter((row) => row.errors.length === 0).length;
    const invalid = processedRows.length - valid;
    return { total: processedRows.length, valid, invalid };
  }, [processedRows]);

  const uniqueSpecimenNames = useMemo(() => {
    const unique = new Set<string>();
    processedRows.forEach((row) => {
      row.data.specimen_names.forEach((name) => unique.add(name.trim()));
    });
    return Array.from(unique).sort();
  }, [processedRows]);

  const uniqueObservationNames = useMemo(() => {
    const unique = new Set<string>();
    processedRows.forEach((row) => {
      row.data.observation_names.forEach((name) => unique.add(name.trim()));
    });
    return Array.from(unique).sort();
  }, [processedRows]);

  const uniqueChargeItemNames = useMemo(() => {
    const unique = new Set<string>();
    processedRows.forEach((row) => {
      row.data.charge_item_names.forEach((name) => unique.add(name.trim()));
    });
    return Array.from(unique).sort();
  }, [processedRows]);

  const uniqueLocationNames = useMemo(() => {
    const unique = new Set<string>();
    processedRows.forEach((row) => {
      row.data.location_names.forEach((name) => unique.add(name.trim()));
    });
    return Array.from(unique).sort();
  }, [processedRows]);

  const uniqueHealthcareServiceNames = useMemo(() => {
    const unique = new Set<string>();
    processedRows.forEach((row) => {
      if (row.data.healthcare_service_name) {
        unique.add(row.data.healthcare_service_name.trim());
      }
    });
    return Array.from(unique).sort();
  }, [processedRows]);

  const mappingSignature = useMemo(
    () =>
      `${uniqueSpecimenNames.join("|")}::${uniqueObservationNames.join("|")}::${uniqueChargeItemNames.join("|")}::${uniqueLocationNames.join("|")}::${uniqueHealthcareServiceNames.join("|")}`,
    [
      uniqueSpecimenNames,
      uniqueObservationNames,
      uniqueChargeItemNames,
      uniqueLocationNames,
      uniqueHealthcareServiceNames,
    ],
  );

  const resolveMappings = useCallback(async () => {
    if (!facilityId) return;
    if (!mappingSignature) {
      setMappingIssues(["No reference data found in CSV."]);
      setMappingStatus("error");
      return;
    }

    setMappingStatus("loading");
    setMappingIssues([]);

    const issues: string[] = [];
    const specimenMap: Record<string, string> = {};
    const observationMap: Record<string, string> = {};
    const chargeItemMap: Record<string, string> = {};
    const locationMap: Record<string, string> = {};
    const healthcareServiceMap: Record<string, string> = {};

    try {
      await Promise.all(
        uniqueSpecimenNames.map(async (name) => {
          const response = await request<
            PaginatedResponse<{ title: string; slug: string }>
          >(
            `/api/v1/facility/${facilityId}/specimen_definition/${queryString({
              title: name,
              limit: 10,
            })}`,
            { method: "GET" },
          );
          const match = response.results.find(
            (item) => normalizeName(item.title) === normalizeName(name),
          );
          if (match) {
            specimenMap[normalizeName(name)] = match.slug;
          } else {
            issues.push(`Specimen not found: ${name}`);
          }
        }),
      );

      await Promise.all(
        uniqueObservationNames.map(async (name) => {
          const response = await request<
            PaginatedResponse<{ title: string; slug: string }>
          >(
            `/api/v1/observation_definition/${queryString({
              facility: facilityId,
              title: name,
              limit: 10,
            })}`,
            { method: "GET" },
          );
          const match = response.results.find(
            (item) => normalizeName(item.title) === normalizeName(name),
          );
          if (match) {
            observationMap[normalizeName(name)] = match.slug;
          } else {
            issues.push(`Observation not found: ${name}`);
          }
        }),
      );

      await Promise.all(
        uniqueChargeItemNames.map(async (name) => {
          const response = await request<
            PaginatedResponse<{ title: string; slug: string }>
          >(
            `/api/v1/facility/${facilityId}/charge_item_definition/${queryString(
              {
                title: name,
                limit: 10,
              },
            )}`,
            { method: "GET" },
          );
          const match = response.results.find(
            (item) => normalizeName(item.title) === normalizeName(name),
          );
          if (match) {
            chargeItemMap[normalizeName(name)] = match.slug;
          } else {
            issues.push(`Charge item not found: ${name}`);
          }
        }),
      );

      await Promise.all(
        uniqueLocationNames.map(async (name) => {
          const response = await request<
            PaginatedResponse<{ name: string; id: string }>
          >(
            `/api/v1/facility/${facilityId}/location/${queryString({
              name,
              limit: 50,
            })}`,
            { method: "GET" },
          );
          const match = response.results.find(
            (item) => normalizeName(item.name) === normalizeName(name),
          );
          if (match) {
            locationMap[normalizeName(name)] = match.id;
          } else {
            issues.push(`Location not found: ${name}`);
          }
        }),
      );

      await Promise.all(
        uniqueHealthcareServiceNames.map(async (name) => {
          const response = await request<
            PaginatedResponse<{ name: string; id: string }>
          >(
            `/api/v1/facility/${facilityId}/healthcare_service/${queryString({
              name,
              limit: 10,
            })}`,
            { method: "GET" },
          );
          const match = response.results.find(
            (item) => normalizeName(item.name) === normalizeName(name),
          );
          if (match) {
            healthcareServiceMap[normalizeName(name)] = match.id;
          } else {
            issues.push(`Healthcare service not found: ${name}`);
          }
        }),
      );
    } catch (error) {
      issues.push("Failed to resolve reference data.");
    }

    setMappingIssues(issues);
    setMappingStatus(issues.length ? "error" : "ready");
    setLastMappingSignature(mappingSignature);

    setProcessedRows((prevRows) =>
      prevRows.map((row) => {
        const updatedErrors = stripMappingErrors(row.errors);
        const resolved: ResolvedRow = {
          specimenSlugs: [],
          observationSlugs: [],
          chargeItemSlugs: [],
          locationIds: [],
        };

        row.data.specimen_names.forEach((name) => {
          const key = normalizeName(name);
          const slug = specimenMap[key];
          if (!slug) {
            updatedErrors.push(`Unknown specimen: ${name}`);
          } else {
            resolved.specimenSlugs.push(slug);
          }
        });

        row.data.observation_names.forEach((name) => {
          const key = normalizeName(name);
          const slug = observationMap[key];
          if (!slug) {
            updatedErrors.push(`Unknown observation: ${name}`);
          } else {
            resolved.observationSlugs.push(slug);
          }
        });

        row.data.charge_item_names.forEach((name) => {
          const key = normalizeName(name);
          const slug = chargeItemMap[key];
          if (!slug) {
            updatedErrors.push(`Unknown charge item: ${name}`);
          } else {
            resolved.chargeItemSlugs.push(slug);
          }
        });

        row.data.location_names.forEach((name) => {
          const key = normalizeName(name);
          const id = locationMap[key];
          if (!id) {
            updatedErrors.push(`Unknown location: ${name}`);
          } else {
            resolved.locationIds.push(id);
          }
        });

        if (row.data.healthcare_service_name) {
          const key = normalizeName(row.data.healthcare_service_name);
          const id = healthcareServiceMap[key];
          if (!id) {
            updatedErrors.push(
              `Unknown healthcare service: ${row.data.healthcare_service_name}`,
            );
          } else {
            resolved.healthcareServiceId = id;
          }
        }

        return {
          ...row,
          errors: updatedErrors,
          resolved,
        };
      }),
    );
  }, [
    facilityId,
    mappingSignature,
    uniqueSpecimenNames,
    uniqueObservationNames,
    uniqueChargeItemNames,
    uniqueLocationNames,
    uniqueHealthcareServiceNames,
  ]);

  useEffect(() => {
    if (currentStep !== "review") return;
    if (!facilityId) return;
    if (!mappingSignature) return;
    if (mappingStatus === "loading") return;
    if (mappingSignature === lastMappingSignature) return;

    resolveMappings();
  }, [
    currentStep,
    facilityId,
    mappingSignature,
    mappingStatus,
    lastMappingSignature,
    resolveMappings,
  ]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
      setUploadError("Please upload a valid CSV file");
      setUploadedFileName("");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target?.result as string;
        const { headers, rows } = parseCsvText(csvText);

        if (headers.length === 0) {
          setUploadError("CSV is empty or missing headers");
          return;
        }

        const headerMap = headers.reduce<Record<string, number>>(
          (acc, header, index) => {
            acc[normalizeHeader(header)] = index;
            return acc;
          },
          {},
        );

        const missingHeaders = REQUIRED_HEADERS.filter(
          (header) => headerMap[normalizeHeader(header)] === undefined,
        );

        if (missingHeaders.length > 0) {
          setUploadError(
            `Missing required headers: ${missingHeaders.join(", ")}`,
          );
          return;
        }

        const processed = rows.map((row, index) => {
          const errors: string[] = [];
          const title = getCellValue(row, headerMap, "title").trim();
          const description = getCellValue(
            row,
            headerMap,
            "description",
          ).trim();
          const usage = getCellValue(row, headerMap, "usage").trim();
          const status = getCellValue(row, headerMap, "status").trim();
          const classification = getCellValue(
            row,
            headerMap,
            "classification",
          ).trim();
          const categoryName = getCellValue(
            row,
            headerMap,
            "category_name",
          ).trim();
          const codeSystem = getCellValue(row, headerMap, "code_system").trim();
          const codeValue = getCellValue(row, headerMap, "code_value").trim();
          const codeDisplay = getCellValue(
            row,
            headerMap,
            "code_display",
          ).trim();

          if (!title) errors.push("Missing title");
          if (!description) errors.push("Missing description");
          if (!usage) errors.push("Missing usage");
          if (!categoryName) errors.push("Missing category name");
          if (!codeValue || !codeDisplay) {
            errors.push("Missing code value/display");
          }

          const resolvedStatus = status || "active";
          if (!ACTIVITY_STATUSES.includes(resolvedStatus as never)) {
            errors.push("Invalid status value");
          }

          const resolvedClassification = classification || "laboratory";
          if (
            !ACTIVITY_CLASSIFICATIONS.includes(resolvedClassification as never)
          ) {
            errors.push("Invalid classification value");
          }

          const resolvedCodeSystem =
            codeSystem.trim() || "http://snomed.info/sct";

          const bodySite = buildOptionalCode(
            getCellValue(row, headerMap, "body_site_system").trim(),
            getCellValue(row, headerMap, "body_site_code").trim(),
            getCellValue(row, headerMap, "body_site_display").trim(),
            errors,
            "Body site",
          );

          const diagnosticRaw = getCellValue(
            row,
            headerMap,
            "diagnostic_report_codes",
          ).trim();
          const diagnosticReportCodes = diagnosticRaw
            ? diagnosticRaw
                .split(",")
                .map((code) => code.trim())
                .filter(Boolean)
                .map((code) => ({
                  system: "http://loinc.org",
                  code,
                  display: code,
                }))
            : [];

          const data: ActivityRow = {
            title,
            slug_value: getCellValue(row, headerMap, "slug_value").trim(),
            description,
            usage,
            status: resolvedStatus,
            classification: resolvedClassification,
            kind: getCellValue(row, headerMap, "kind").trim() || ACTIVITY_KIND,
            code: {
              system: resolvedCodeSystem,
              code: codeValue,
              display: codeDisplay,
            },
            body_site: bodySite,
            diagnostic_report_codes: diagnosticReportCodes,
            derived_from_uri: getCellValue(
              row,
              headerMap,
              "derived_from_uri",
            ).trim(),
            category_name: categoryName,
            specimen_names: splitCellValues(
              getCellValue(row, headerMap, "specimen_names").trim(),
            ),
            observation_names: splitCellValues(
              getCellValue(row, headerMap, "observation_names").trim(),
            ),
            charge_item_names: splitCellValues(
              getCellValue(row, headerMap, "charge_item_names").trim(),
            ),
            location_names: splitCellValues(
              getCellValue(row, headerMap, "location_names").trim(),
            ),
            healthcare_service_name: getCellValue(
              row,
              headerMap,
              "healthcare_service_name",
            ).trim(),
          };

          if (!isNonEmptyString(data.kind)) {
            errors.push("Missing kind");
          }

          return {
            rowIndex: index + 2,
            data,
            errors,
          };
        });

        setUploadError("");
        setUploadedFileName(file.name);
        setProcessedRows(processed);
        setResults(null);
        setMappingIssues([]);
        setMappingStatus("idle");
        setLastMappingSignature("");
        setCurrentStep("review");
      } catch {
        setUploadError("Error processing CSV file");
      }
    };
    reader.readAsText(file);
  };

  const downloadSample = () => {
    const headers = [
      "title",
      "slug_value",
      "description",
      "usage",
      "status",
      "classification",
      "category_name",
      "code_system",
      "code_value",
      "code_display",
      "diagnostic_report_codes",
      "specimen_names",
      "observation_names",
      "charge_item_names",
      "location_names",
      "healthcare_service_name",
      "derived_from_uri",
      "body_site_system",
      "body_site_code",
      "body_site_display",
    ];

    const rows = [
      [
        "Complete Blood Count",
        "",
        "Complete blood count test",
        "Order CBC for baseline evaluation",
        "active",
        "laboratory",
        "Hematology",
        "http://snomed.info/sct",
        "26604007",
        "Complete blood count",
        "718-7,6690-2",
        "Whole Blood",
        "Hemoglobin, Platelet Count",
        "CBC Charge Item",
        "Main Lab",
        "General Medicine",
        "",
        "",
        "",
        "",
      ].map(csvEscape),
    ];

    const sampleCSV = `${headers.join(",")}\n${rows
      .map((row) => row.join(","))
      .join("\n")}`;
    const blob = new Blob([sampleCSV], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sample_activity_definition.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const runImport = async () => {
    if (!facilityId) {
      setUploadError("Select a facility to import activity definitions");
      setCurrentStep("upload");
      return;
    }

    const validRows = processedRows.filter((row) => row.errors.length === 0);
    const invalidRows = processedRows.length - validRows.length;
    setTotalToImport(validRows.length);

    if (validRows.length === 0) {
      setResults({
        processed: 0,
        created: 0,
        updated: 0,
        failed: 0,
        skipped: invalidRows,
        failures: [],
      });
      setCurrentStep("done");
      return;
    }

    setCurrentStep("importing");
    setResults({
      processed: 0,
      created: 0,
      updated: 0,
      failed: 0,
      skipped: invalidRows,
      failures: [],
    });

    const categorySlugMap = await upsertResourceCategories({
      facilityId,
      categories: validRows.map((row) => row.data.category_name),
      resourceType: ResourceCategoryResourceType.activity_definition,
      slugPrefix: "ad",
    });

    for (const row of validRows) {
      try {
        const slug = row.data.slug_value?.trim()
          ? row.data.slug_value.trim()
          : await createSlug(row.data.title, 25);

        const categorySlug =
          categorySlugMap.get(normalizeName(row.data.category_name)) || "";
        const payload = {
          slug_value: slug,
          title: row.data.title,
          status: row.data.status,
          description: row.data.description,
          usage: row.data.usage,
          classification: row.data.classification,
          kind: row.data.kind,
          code: row.data.code,
          body_site: row.data.body_site,
          diagnostic_report_codes: row.data.diagnostic_report_codes,
          derived_from_uri: row.data.derived_from_uri || undefined,
          facility: facilityId,
          specimen_requirements: row.resolved?.specimenSlugs ?? [],
          observation_result_requirements: row.resolved?.observationSlugs ?? [],
          charge_item_definitions: row.resolved?.chargeItemSlugs ?? [],
          locations: row.resolved?.locationIds ?? [],
          category: categorySlug,
          healthcare_service: row.resolved?.healthcareServiceId ?? null,
        };

        const detailPath = `/api/v1/facility/${facilityId}/activity_definition/${slug}/`;
        const listPath = `/api/v1/facility/${facilityId}/activity_definition/`;

        try {
          await request(detailPath, { method: "GET" });
          await request(detailPath, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          setResults((prev) =>
            prev
              ? {
                  ...prev,
                  processed: prev.processed + 1,
                  updated: prev.updated + 1,
                }
              : prev,
          );
        } catch (error) {
          if (error instanceof APIError && error.status !== 404) {
            throw error;
          }

          await request(listPath, {
            method: "POST",
            body: JSON.stringify(payload),
          });
          setResults((prev) =>
            prev
              ? {
                  ...prev,
                  processed: prev.processed + 1,
                  created: prev.created + 1,
                }
              : prev,
          );
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        setResults((prev) =>
          prev
            ? {
                ...prev,
                processed: prev.processed + 1,
                failed: prev.failed + 1,
                failures: [
                  ...prev.failures,
                  { rowIndex: row.rowIndex, title: row.data.title, reason },
                ],
              }
            : prev,
        );
      }
    }

    setCurrentStep("done");
  };

  if (currentStep === "upload") {
    return (
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Activity Definitions from CSV
            </CardTitle>
            <CardDescription>
              Upload a CSV file to create activity definitions and validate them
              before import.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
                id="activity-definition-csv-upload"
              />
              <label
                htmlFor="activity-definition-csv-upload"
                className="cursor-pointer"
              >
                <div className="flex flex-col items-center gap-4">
                  <Upload className="h-12 w-12 text-gray-400" />
                  <div>
                    <p className="text-lg font-medium">
                      Click to upload CSV file
                    </p>
                    <p className="text-sm text-gray-500">or drag and drop</p>
                  </div>
                  <p className="text-xs text-gray-400">
                    Required columns: title, description, usage, status,
                    classification, category_name, code_system, code_value,
                    code_display
                  </p>
                  <Button variant="outline" size="sm" onClick={downloadSample}>
                    Download Sample CSV
                  </Button>
                </div>
              </label>
            </div>

            {uploadedFileName && (
              <p className="mt-3 text-sm text-gray-600">
                Selected file: {uploadedFileName}
              </p>
            )}

            {uploadError && (
              <Alert className="mt-4" variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{uploadError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (currentStep === "review") {
    return (
      <div className="max-w-7xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Activity Definition Import Wizard</CardTitle>
            <CardDescription>
              Review and validate activity definitions before importing.
            </CardDescription>
            <div className="mt-4">
              <Progress value={100} className="h-2" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 mb-4">
              <Badge variant="outline">Total: {summary.total}</Badge>
              <Badge variant="primary">Valid: {summary.valid}</Badge>
              <Badge variant="secondary">Invalid: {summary.invalid}</Badge>
            </div>

            {(mappingStatus === "loading" || mappingIssues.length > 0) && (
              <Alert
                className="mb-4"
                variant={mappingIssues.length > 0 ? "destructive" : "default"}
              >
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {mappingStatus === "loading" &&
                    "Resolving specimens, observations, charge items, locations, healthcare services, and categories..."}
                  {mappingIssues.length > 0 && (
                    <div className="space-y-1">
                      {mappingIssues.map((issue) => (
                        <div key={issue}>{issue}</div>
                      ))}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="max-h-80 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-4 py-2 text-left">Row</th>
                      <th className="px-4 py-2 text-left">Title</th>
                      <th className="px-4 py-2 text-left">Category</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-left">Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processedRows.map((row) => (
                      <tr
                        key={row.rowIndex}
                        className="border-t border-gray-100"
                      >
                        <td className="px-4 py-2 text-gray-500">
                          {row.rowIndex}
                        </td>
                        <td className="px-4 py-2">{row.data.title}</td>
                        <td className="px-4 py-2">{row.data.category_name}</td>
                        <td className="px-4 py-2">
                          {row.errors.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircle2 className="h-4 w-4" />
                              Valid
                            </span>
                          ) : (
                            <span className="text-red-600">Invalid</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-600">
                          {row.errors.length > 0 ? row.errors.join("; ") : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-between mt-6">
              <Button
                variant="outline"
                onClick={() => setCurrentStep("upload")}
              >
                Back
              </Button>
              <Button
                onClick={runImport}
                disabled={summary.valid === 0 || mappingStatus === "loading"}
              >
                Import
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (currentStep === "importing") {
    const processed = results?.processed ?? 0;
    const progress = totalToImport
      ? Math.round((processed / totalToImport) * 100)
      : 0;

    return (
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Importing Activity Definitions</CardTitle>
            <CardDescription>
              Please keep this window open while we import your data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={progress} className="h-2" />
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <Badge variant="outline">Processed: {processed}</Badge>
              <Badge variant="primary">Created: {results?.created ?? 0}</Badge>
              <Badge variant="secondary">
                Updated: {results?.updated ?? 0}
              </Badge>
              <Badge variant="secondary">Failed: {results?.failed ?? 0}</Badge>
              <Badge variant="outline">Skipped: {results?.skipped ?? 0}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Activity Definition Import Results</CardTitle>
          <CardDescription>
            Import completed. Review the summary and any failed rows below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 mb-6">
            <Badge variant="primary">Created: {results?.created ?? 0}</Badge>
            <Badge variant="secondary">Updated: {results?.updated ?? 0}</Badge>
            <Badge variant="secondary">Failed: {results?.failed ?? 0}</Badge>
            <Badge variant="outline">Skipped: {results?.skipped ?? 0}</Badge>
          </div>

          {results?.failures.length ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="max-h-64 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-4 py-2 text-left">Row</th>
                      <th className="px-4 py-2 text-left">Title</th>
                      <th className="px-4 py-2 text-left">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.failures.map((failure) => (
                      <tr
                        key={`${failure.rowIndex}-${failure.title}`}
                        className="border-t border-gray-100"
                      >
                        <td className="px-4 py-2 text-gray-500">
                          {failure.rowIndex}
                        </td>
                        <td className="px-4 py-2">{failure.title ?? "-"}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">
                          {failure.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-600">No failed rows 🎉</p>
          )}

          <div className="flex justify-end mt-6">
            <Button
              variant="outline"
              onClick={() => {
                setProcessedRows([]);
                setResults(null);
                setUploadedFileName("");
                setUploadError("");
                setMappingIssues([]);
                setMappingStatus("idle");
                setLastMappingSignature("");
                setCurrentStep("upload");
              }}
            >
              Upload Another File
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
