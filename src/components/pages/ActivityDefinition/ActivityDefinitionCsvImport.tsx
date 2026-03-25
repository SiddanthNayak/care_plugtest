import { queryString, request } from "@/apis/request";
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
import {
  fetchExistingId,
  normalizeName,
  type ImportResults,
  type PaginatedResponse,
} from "@/utils/importHelpers";
import { parseActivityDefinitionCsv } from "@/utils/masterImport/activityDefinition";
import { upsertResourceCategories } from "@/utils/resourceCategory";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  stripMappingErrors,
  type ProcessedRow,
  type ResolvedRow,
} from "@/utils/activityDefinitionHelper";

interface ActivityDefinitionCsvImportProps {
  facilityId?: string;
  initialCsvText: string;
  onBack: () => void;
}

export default function ActivityDefinitionCsvImport({
  facilityId,
  initialCsvText,
  onBack,
}: ActivityDefinitionCsvImportProps) {
  const [currentStep, setCurrentStep] = useState<
    "review" | "importing" | "done"
  >("review");
  const [processedRows, setProcessedRows] = useState<ProcessedRow[]>(() =>
    parseActivityDefinitionCsv(initialCsvText),
  );
  const [results, setResults] = useState<ImportResults | null>(null);
  const [totalToImport, setTotalToImport] = useState(0);
  const [mappingStatus, setMappingStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const lastMappingSignatureRef = useRef("");
  const [uploadError, setUploadError] = useState("");

  const summary = useMemo(() => {
    const valid = processedRows.filter((row) => row.errors.length === 0).length;
    const invalid = processedRows.length - valid;
    return { total: processedRows.length, valid, invalid };
  }, [processedRows]);

  // All valid rows are always selected — no row selection in CSV flow
  const validRows = useMemo(
    () => processedRows.filter((row) => row.errors.length === 0),
    [processedRows],
  );

  const uniqueSpecimenSlugs = useMemo(() => {
    const unique = new Set<string>();
    processedRows.forEach((row) => {
      row.data.specimen_slugs.forEach((slug) => unique.add(slug.trim()));
    });
    return Array.from(unique).sort();
  }, [processedRows]);

  const uniqueObservationSlugs = useMemo(() => {
    const unique = new Set<string>();
    processedRows.forEach((row) => {
      row.data.observation_slugs.forEach((slug) => unique.add(slug.trim()));
    });
    return Array.from(unique).sort();
  }, [processedRows]);

  const uniqueChargeItemSlugs = useMemo(() => {
    const unique = new Set<string>();
    processedRows.forEach((row) => {
      row.data.charge_item_slugs.forEach((slug) => unique.add(slug.trim()));
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
      `${uniqueSpecimenSlugs.join("|")}::${uniqueObservationSlugs.join("|")}::${uniqueChargeItemSlugs.join("|")}::${uniqueLocationNames.join("|")}::${uniqueHealthcareServiceNames.join("|")}`,
    [
      uniqueSpecimenSlugs,
      uniqueObservationSlugs,
      uniqueChargeItemSlugs,
      uniqueLocationNames,
      uniqueHealthcareServiceNames,
    ],
  );

  const resolveMappings = async () => {
    if (!facilityId) return;
    if (!mappingSignature) {
      setMappingStatus("error");
      return;
    }

    setMappingStatus("loading");

    const issues: string[] = [];
    const validSpecimenSlugs = new Set<string>();
    const validObservationSlugs = new Set<string>();
    const validChargeItemSlugs = new Set<string>();
    const locationMap: Record<string, string> = {};
    const healthcareServiceMap: Record<string, string> = {};

    try {
      await Promise.all(
        uniqueSpecimenSlugs.map(async (slug) => {
          try {
            await request(
              `/api/v1/facility/${facilityId}/specimen_definition/f-${facilityId}-${slug}/`,
              { method: "GET" },
            );
            validSpecimenSlugs.add(slug);
          } catch {
            issues.push(`Specimen slug not found: ${slug}`);
          }
        }),
      );

      await Promise.all(
        uniqueObservationSlugs.map(async (slug) => {
          try {
            await request(
              `/api/v1/observation_definition/f-${facilityId}-${slug}/`,
              { method: "GET" },
            );
            validObservationSlugs.add(slug);
          } catch {
            issues.push(`Observation slug not found: ${slug}`);
          }
        }),
      );

      await Promise.all(
        uniqueChargeItemSlugs.map(async (slug) => {
          try {
            await request(
              `/api/v1/facility/${facilityId}/charge_item_definition/f-${facilityId}-${slug}/`,
              { method: "GET" },
            );
            validChargeItemSlugs.add(slug);
          } catch {
            issues.push(`Charge item slug not found: ${slug}`);
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
    } catch {
      issues.push("Failed to resolve reference data.");
    }

    setMappingStatus(issues.length ? "error" : "ready");
    lastMappingSignatureRef.current = mappingSignature;

    setProcessedRows((prevRows) =>
      prevRows.map((row) => {
        const updatedErrors = stripMappingErrors(row.errors);
        const resolved: ResolvedRow = {
          specimenSlugs: [],
          observationSlugs: [],
          chargeItemSlugs: [],
          locationIds: [],
        };

        row.data.specimen_slugs.forEach((slug) => {
          if (!validSpecimenSlugs.has(slug)) {
            updatedErrors.push(`Specimen slug not found: ${slug}`);
          } else {
            resolved.specimenSlugs.push(slug);
          }
        });

        row.data.observation_slugs.forEach((slug) => {
          if (!validObservationSlugs.has(slug)) {
            updatedErrors.push(`Observation slug not found: ${slug}`);
          } else {
            resolved.observationSlugs.push(slug);
          }
        });

        row.data.charge_item_slugs.forEach((slug) => {
          if (!validChargeItemSlugs.has(slug)) {
            updatedErrors.push(`Charge item slug not found: ${slug}`);
          } else {
            resolved.chargeItemSlugs.push(slug);
          }
        });

        row.data.location_names.forEach((name) => {
          const key = normalizeName(name);
          const id = locationMap[key];
          if (!id) {
            updatedErrors.push(`Location not found: ${name}`);
          } else {
            resolved.locationIds.push(id);
          }
        });

        if (row.data.healthcare_service_name) {
          const key = normalizeName(row.data.healthcare_service_name);
          const id = healthcareServiceMap[key];
          if (!id) {
            updatedErrors.push(
              `Healthcare service not found: ${row.data.healthcare_service_name}`,
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
  };

  // Auto-resolve mappings when rows are loaded
  useEffect(() => {
    if (currentStep !== "review") return;
    if (!facilityId) return;
    if (!mappingSignature) return;
    if (mappingSignature === lastMappingSignatureRef.current) return;

    resolveMappings();
  }, [currentStep, facilityId, mappingSignature]);

  const runImport = async () => {
    if (!facilityId) {
      setUploadError("Select a facility to import activity definitions");
      return;
    }

    const rowsToImport = validRows;
    setTotalToImport(rowsToImport.length);

    if (rowsToImport.length === 0) {
      setResults({
        processed: 0,
        created: 0,
        updated: 0,
        failed: 0,
        skipped: summary.invalid,
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
      skipped: summary.invalid,
      failures: [],
    });

    const categorySlugMap = await upsertResourceCategories({
      facilityId,
      categories: rowsToImport.map((row) => row.data.category_name),
      resourceType: ResourceCategoryResourceType.activity_definition,
      slugPrefix: "ad",
    });

    for (const row of rowsToImport) {
      try {
        const slug = row.data.slug_value;
        const detailSlug = `f-${facilityId}-${slug}`;
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

        const detailPath = `/api/v1/facility/${facilityId}/activity_definition/${detailSlug}/`;
        const upsertPath = `/api/v1/facility/${facilityId}/activity_definition/upsert/`;
        const existingId = await fetchExistingId(detailPath);
        const datapoint = existingId
          ? { ...payload, id: `f-${facilityId}-${slug}` }
          : payload;
        await request(upsertPath, {
          method: "POST",
          body: JSON.stringify({ datapoints: [datapoint] }),
        });
        if (existingId) {
          setResults((prev) =>
            prev
              ? {
                  ...prev,
                  processed: prev.processed + 1,
                  updated: prev.updated + 1,
                }
              : prev,
          );
        } else {
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

  if (currentStep === "review") {
    const isResolving = mappingStatus === "idle" || mappingStatus === "loading";

    return (
      <div className="max-w-7xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Activity Definition Import — CSV Review</CardTitle>
            <CardDescription>
              Review and validate activity definitions before importing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isResolving ? (
              <div className="flex flex-col items-center justify-center py-16 gap-4 text-gray-500">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm">
                  Validating references — specimens, observations, charge items,
                  locations, and healthcare services…
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-4 mb-4">
                  <Badge variant="outline">Total: {summary.total}</Badge>
                  <Badge variant="primary">Valid: {summary.valid}</Badge>
                  <Badge variant="secondary">Invalid: {summary.invalid}</Badge>
                </div>

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
                            className={
                              row.errors.length === 0
                                ? "border-t border-gray-100"
                                : "border-t border-gray-100 bg-gray-50 text-gray-400"
                            }
                          >
                            <td className="px-4 py-2 text-gray-500">
                              {row.rowIndex}
                            </td>
                            <td className="px-4 py-2">{row.data.title}</td>
                            <td className="px-4 py-2">
                              {row.data.category_name}
                            </td>
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
                              {row.errors.length > 0
                                ? row.errors.join("; ")
                                : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {uploadError && (
                  <Alert className="mt-4" variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{uploadError}</AlertDescription>
                  </Alert>
                )}
              </>
            )}

            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={onBack}>
                Back
              </Button>
              <Button
                onClick={runImport}
                disabled={validRows.length === 0 || isResolving}
              >
                Import {validRows.length} Valid Row
                {validRows.length !== 1 ? "s" : ""}
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

  // done
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
            <Button variant="outline" onClick={onBack}>
              Upload Another File
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
