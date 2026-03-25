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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  type HealthcareServiceOption,
  type ProcessedRow,
  type ResolvedRow,
} from "@/utils/activityDefinitionHelper";

interface ActivityDefinitionMasterImportProps {
  facilityId?: string;
  initialCsvText: string;
  onBack: () => void;
}

export default function ActivityDefinitionMasterImport({
  facilityId,
  initialCsvText,
  onBack,
}: ActivityDefinitionMasterImportProps) {
  const [currentStep, setCurrentStep] = useState<
    "review" | "mapping" | "confirm" | "importing" | "done"
  >("review");
  const [processedRows, setProcessedRows] = useState<ProcessedRow[]>(() =>
    parseActivityDefinitionCsv(initialCsvText),
  );
  const [selectedRowIds, setSelectedRowIds] = useState<Set<number>>(
    () =>
      new Set(
        parseActivityDefinitionCsv(initialCsvText)
          .filter((row) => row.errors.length === 0)
          .map((row) => row.rowIndex),
      ),
  );
  const [results, setResults] = useState<ImportResults | null>(null);
  const [totalToImport, setTotalToImport] = useState(0);
  const [masterValidationStatus, setMasterValidationStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [categoryMappings, setCategoryMappings] = useState<
    Record<string, string>
  >({});
  const [healthcareServices, setHealthcareServices] = useState<
    HealthcareServiceOption[]
  >([]);
  const lastMasterValidationSignatureRef = useRef("");

  const summary = useMemo(() => {
    const valid = processedRows.filter((row) => row.errors.length === 0).length;
    const invalid = processedRows.length - valid;
    return { total: processedRows.length, valid, invalid };
  }, [processedRows]);

  const validRowIds = useMemo(
    () =>
      processedRows
        .filter((row) => row.errors.length === 0)
        .map((row) => row.rowIndex),
    [processedRows],
  );

  const selectedValidCount = useMemo(
    () => validRowIds.filter((rowId) => selectedRowIds.has(rowId)).length,
    [selectedRowIds, validRowIds],
  );

  const allValidSelected =
    validRowIds.length > 0 && selectedValidCount === validRowIds.length;

  const masterValidationSignature = useMemo(() => {
    const titles = processedRows
      .map((row) => row.data.title.trim())
      .filter(Boolean);
    return `${facilityId}::${titles.join("|")}`;
  }, [processedRows, facilityId]);

  const resolveMasterMappings = async (
    rows: ProcessedRow[],
    includeHealthcareService = true,
  ) => {
    if (!facilityId) return { resolvedRows: rows, issues: [] as string[] };

    const issues: string[] = [];
    const validSpecimenSlugs = new Set<string>();
    const validObservationSlugs = new Set<string>();
    const chargeItemMap: Record<string, string> = {};
    const locationMap: Record<string, string> = {};

    const uniqueSpecimenSlugs = new Set<string>();
    const uniqueObservationSlugs = new Set<string>();
    const uniqueActivityTitles = new Set<string>();
    const uniqueLocations = new Set<string>();

    rows.forEach((row) => {
      row.data.specimen_slugs.forEach((slug) =>
        uniqueSpecimenSlugs.add(slug),
      );
      row.data.observation_slugs.forEach((slug) =>
        uniqueObservationSlugs.add(slug),
      );
      const activityTitle = row.data.title.trim();
      if (activityTitle) {
        uniqueActivityTitles.add(activityTitle);
      }
      row.data.location_names.forEach((name) => uniqueLocations.add(name));
    });

    await Promise.all(
      Array.from(uniqueSpecimenSlugs).map(async (slug) => {
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
      Array.from(uniqueObservationSlugs).map(async (slug) => {
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
      Array.from(uniqueActivityTitles).map(async (title) => {
        const response = await request<
          PaginatedResponse<{ title: string; slug: string }>
        >(
          `/api/v1/facility/${facilityId}/charge_item_definition/${queryString({
            title,
            limit: 10,
          })}`,
          { method: "GET" },
        );
        const match = response.results.find(
          (item) => normalizeName(item.title) === normalizeName(title),
        );
        if (match) {
          chargeItemMap[normalizeName(title)] = match.slug;
        } else {
          issues.push(
            `Charge item not found for activity definition: ${title}`,
          );
        }
      }),
    );

    await Promise.all(
      Array.from(uniqueLocations).map(async (name) => {
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

    const resolvedRows = rows.map((row) => {
      const updatedErrors = stripMappingErrors(row.errors);
      const resolved: ResolvedRow = {
        specimenSlugs: [],
        observationSlugs: [],
        chargeItemSlugs: [],
        locationIds: [],
        healthcareServiceId: categoryMappings[row.data.category_name] ?? null,
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

      row.data.location_names.forEach((name) => {
        const id = locationMap[normalizeName(name)];
        if (!id) {
          updatedErrors.push(`Location not found: ${name}`);
        } else {
          resolved.locationIds.push(id);
        }
      });

      const activityTitle = row.data.title.trim();
      if (activityTitle) {
        const slug = chargeItemMap[normalizeName(activityTitle)];
        if (!slug) {
          updatedErrors.push(
            `Charge item not found for activity definition: ${activityTitle}`,
          );
        } else {
          resolved.chargeItemSlugs.push(slug);
        }
      }

      if (includeHealthcareService) {
        const healthcareServiceId = resolved.healthcareServiceId;
        if (!healthcareServiceId) {
          updatedErrors.push(
            `Healthcare service not found: ${row.data.category_name}`,
          );
        }
      }

      return {
        ...row,
        errors: updatedErrors,
        resolved,
      };
    });

    return { resolvedRows, issues };
  };

  // Master validation effect — runs when on review step
  useEffect(() => {
    if (currentStep !== "review") return;
    if (!facilityId) return;
    if (!masterValidationSignature) return;
    if (masterValidationSignature === lastMasterValidationSignatureRef.current)
      return;

    let cancelled = false;

    const runValidation = async () => {
      setMasterValidationStatus("loading");
      lastMasterValidationSignatureRef.current = masterValidationSignature;

      try {
        const allRows = processedRows.filter((row) =>
          selectedRowIds.has(row.rowIndex),
        );
        const validRows = allRows.filter((row) => row.errors.length === 0);
        const { resolvedRows, issues } = await resolveMasterMappings(
          validRows,
          false,
        );

        if (cancelled) return;

        const resolvedMap = new Map(
          resolvedRows.map((row) => [row.rowIndex, row]),
        );
        setProcessedRows((prevRows) =>
          prevRows.map((row) => resolvedMap.get(row.rowIndex) ?? row),
        );
        setMasterValidationStatus(issues.length ? "error" : "ready");
      } catch {
        if (cancelled) return;
        setMasterValidationStatus("error");
      }
    };

    runValidation();

    return () => {
      cancelled = true;
      lastMasterValidationSignatureRef.current = "";
    };
  }, [currentStep, facilityId, masterValidationSignature]);

  // Derive activity categories from rows
  const activityCategories = useMemo(() => {
    const categories = new Set<string>();
    processedRows.forEach((row) => {
      const name = row.data.category_name.trim();
      if (name) categories.add(name);
    });
    return Array.from(categories).sort();
  }, [processedRows]);

  // Sync category mappings when categories change
  useEffect(() => {
    setCategoryMappings((prev) => {
      const next = { ...prev };
      activityCategories.forEach((category) => {
        if (!next[category]) {
          next[category] = "";
        }
      });
      Object.keys(next).forEach((category) => {
        if (!activityCategories.includes(category)) {
          delete next[category];
        }
      });
      return next;
    });
  }, [activityCategories]);

  // Load healthcare services when entering mapping step
  useEffect(() => {
    if (currentStep !== "mapping") return;
    if (!facilityId) return;

    const loadHealthcareServices = async () => {
      try {
        const response = await request<{ results: HealthcareServiceOption[] }>(
          `/api/v1/facility/${facilityId}/healthcare_service/${queryString({
            limit: 200,
          })}`,
          { method: "GET" },
        );
        setHealthcareServices(response.results || []);
      } catch {
        setHealthcareServices([]);
      }
    };

    loadHealthcareServices();
  }, [currentStep, facilityId]);

  const canContinueFromMapping = useMemo(() => {
    if (!activityCategories.length) return false;
    return activityCategories.every((category) => categoryMappings[category]);
  }, [activityCategories, categoryMappings]);

  const runImport = async () => {
    if (!facilityId) return;

    const selectedRows = processedRows.filter((row) =>
      selectedRowIds.has(row.rowIndex),
    );
    const validRows = selectedRows.filter((row) => row.errors.length === 0);
    const invalidRows = selectedRows.length - validRows.length;
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

    const { resolvedRows: rowsForImport } =
      await resolveMasterMappings(validRows);
    const skippedRows = rowsForImport.filter((row) => row.errors.length > 0);
    const finalRows = rowsForImport.filter((row) => row.errors.length === 0);
    setTotalToImport(finalRows.length);
    setResults((prev) =>
      prev
        ? {
            ...prev,
            skipped: skippedRows.length,
          }
        : prev,
    );

    for (const row of finalRows) {
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
    const isValidating =
      masterValidationStatus === "idle" || masterValidationStatus === "loading";

    return (
      <div className="max-w-7xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>
              Activity Definition Import — Master Data Review
            </CardTitle>
            <CardDescription>
              Review master data rows, select which to import, then configure
              category mappings.
            </CardDescription>
            <div className="mt-4">
              <Progress value={33} className="h-2" />
            </div>
          </CardHeader>
          <CardContent>
            {isValidating ? (
              <div className="flex flex-col items-center justify-center py-16 gap-4 text-gray-500">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm">
                  Validating references — specimens, observations, charge items,
                  and locations…
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-4 mb-4">
                  <Badge variant="outline">Total: {summary.total}</Badge>
                  <Badge variant="primary">Valid: {summary.valid}</Badge>
                  <Badge variant="secondary">Invalid: {summary.invalid}</Badge>
                </div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
                  <div>
                    Selected {selectedValidCount} of {summary.valid} valid rows
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id="master-select-all"
                      type="checkbox"
                      checked={allValidSelected}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedRowIds(new Set(validRowIds));
                        } else {
                          setSelectedRowIds(new Set());
                        }
                      }}
                      disabled={validRowIds.length === 0}
                    />
                    <label htmlFor="master-select-all">
                      Select all valid rows
                    </label>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="max-h-80 overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="px-4 py-2 text-left">Select</th>
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
                            <td className="px-4 py-2">
                              <input
                                type="checkbox"
                                checked={selectedRowIds.has(row.rowIndex)}
                                onChange={(event) => {
                                  if (row.errors.length > 0) return;
                                  setSelectedRowIds((prev) => {
                                    const next = new Set(prev);
                                    if (event.target.checked) {
                                      next.add(row.rowIndex);
                                    } else {
                                      next.delete(row.rowIndex);
                                    }
                                    return next;
                                  });
                                }}
                                disabled={row.errors.length > 0}
                              />
                            </td>
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
              </>
            )}

            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={onBack}>
                Back
              </Button>
              <Button
                onClick={() => setCurrentStep("mapping")}
                disabled={selectedValidCount === 0 || isValidating}
              >
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (currentStep === "mapping") {
    return (
      <div className="max-w-5xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Map Activity Categories</CardTitle>
            <CardDescription>
              Assign a Healthcare Service for each Activity Definition category.
            </CardDescription>
            <div className="mt-4">
              <Progress value={60} className="h-2" />
            </div>
          </CardHeader>
          <CardContent>
            {activityCategories.length === 0 ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No categories detected in the Activity Definition dataset.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4">
                {activityCategories.map((category) => (
                  <div
                    key={category}
                    className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <p className="text-sm font-semibold">{category}</p>
                      <p className="text-xs text-gray-500">
                        Select healthcare service for this category.
                      </p>
                    </div>
                    <Select
                      value={categoryMappings[category] ?? ""}
                      onValueChange={(value) =>
                        setCategoryMappings((prev) => ({
                          ...prev,
                          [category]: value,
                        }))
                      }
                    >
                      <SelectTrigger className="w-full md:w-72">
                        <SelectValue placeholder="Select healthcare service" />
                      </SelectTrigger>
                      <SelectContent>
                        {healthcareServices.map((service) => (
                          <SelectItem key={service.id} value={service.id}>
                            {service.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}

            {!canContinueFromMapping && (
              <Alert className="mt-4" variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Assign a healthcare service for every category to continue.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-between mt-6">
              <Button
                variant="outline"
                onClick={() => setCurrentStep("review")}
              >
                Back
              </Button>
              <Button
                onClick={() => setCurrentStep("confirm")}
                disabled={!canContinueFromMapping}
              >
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (currentStep === "confirm") {
    return (
      <div className="max-w-5xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Confirm Master Import</CardTitle>
            <CardDescription>
              Review the selected rows before starting the import.
            </CardDescription>
            <div className="mt-4">
              <Progress value={80} className="h-2" />
            </div>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This action will overwrite existing activity definitions for the
                selected rows. Ensure your data is correct before continuing.
              </AlertDescription>
            </Alert>

            <div className="mt-6 flex justify-between">
              <Button
                variant="outline"
                onClick={() => setCurrentStep("mapping")}
              >
                Back
              </Button>
              <Button onClick={runImport}>Start Import</Button>
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
