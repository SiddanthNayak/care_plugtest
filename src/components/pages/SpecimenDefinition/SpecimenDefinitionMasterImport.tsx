import { useCallback, useEffect, useMemo, useState } from "react";

import { request } from "@/apis/request";
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
import { fetchExistingId } from "@/utils/importHelpers";
import {
  parseSpecimenDefinitionCsv,
  type SpecimenProcessedRow,
} from "@/utils/masterImport/specimenDefinition";

import {
  CodeReference,
  ContainerSpec,
  ImportResults,
  Preference,
  SpecimenDefinitionCreate,
  TypeTestedSpec,
} from "@/types/emr/specimenDefinition/specimenDefinition";

const CODE_ERROR_PREFIX = "Invalid code:";

const stripLookupErrors = (errors: string[]) =>
  errors.filter((error) => !error.startsWith(CODE_ERROR_PREFIX));

interface SpecimenDefinitionMasterImportProps {
  facilityId?: string;
  initialCsvText: string;
  onBack: () => void;
}

export default function SpecimenDefinitionMasterImport({
  facilityId,
  initialCsvText,
  onBack,
}: SpecimenDefinitionMasterImportProps) {
  const [currentStep, setCurrentStep] = useState<
    "review" | "importing" | "done"
  >("review");
  const [processedRows, setProcessedRows] = useState<SpecimenProcessedRow[]>(
    () => parseSpecimenDefinitionCsv(initialCsvText),
  );
  const [selectedRowIds, setSelectedRowIds] = useState<Set<number>>(
    () =>
      new Set(
        parseSpecimenDefinitionCsv(initialCsvText)
          .filter((row) => row.errors.length === 0)
          .map((row) => row.rowIndex),
      ),
  );
  const [results, setResults] = useState<ImportResults | null>(null);
  const [totalToImport, setTotalToImport] = useState(0);
  const [lookupStatus, setLookupStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [lastLookupSignature, setLastLookupSignature] = useState<string>("");

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

  const uniqueCodeReferences = useMemo(() => {
    const map = new Map<string, CodeReference>();
    processedRows.forEach((row) => {
      row.codeReferences.forEach((ref) => {
        if (!map.has(ref.signature)) {
          map.set(ref.signature, ref);
        }
      });
    });
    return Array.from(map.values());
  }, [processedRows]);

  const lookupSignature = useMemo(
    () => uniqueCodeReferences.map((ref) => ref.signature).join("||"),
    [uniqueCodeReferences],
  );

  const resolveCodeLookups = useCallback(async () => {
    if (!lookupSignature) {
      setLookupStatus("ready");
      return;
    }

    setLookupStatus("loading");
    const invalidSignatures = new Set<string>();
    const issues: string[] = [];

    await Promise.all(
      uniqueCodeReferences.map(async (ref) => {
        try {
          await request("/api/v1/valueset/lookup_code/", {
            method: "POST",
            body: JSON.stringify({
              system: ref.code.system,
              code: ref.code.code,
            }),
          });
        } catch {
          invalidSignatures.add(ref.signature);
          issues.push(`${ref.label}: ${ref.code.system} | ${ref.code.code}`);
        }
      }),
    );

    setLookupStatus(issues.length ? "error" : "ready");
    setLastLookupSignature(lookupSignature);

    setProcessedRows((prevRows) =>
      prevRows.map((row) => {
        const updatedErrors = stripLookupErrors(row.errors);
        row.codeReferences.forEach((ref) => {
          if (invalidSignatures.has(ref.signature)) {
            updatedErrors.push(
              `${CODE_ERROR_PREFIX} ${ref.label} (${ref.code.system} | ${ref.code.code})`,
            );
          }
        });
        return {
          ...row,
          errors: updatedErrors,
        };
      }),
    );
  }, [lookupSignature, uniqueCodeReferences]);

  useEffect(() => {
    if (currentStep !== "review") return;
    if (!lookupSignature) {
      setLookupStatus("ready");
      return;
    }
    if (lookupStatus === "loading") return;
    if (lookupSignature === lastLookupSignature) return;

    resolveCodeLookups();
  }, [
    currentStep,
    lookupSignature,
    lookupStatus,
    lastLookupSignature,
    resolveCodeLookups,
  ]);

  const cleanContainerData = (container?: ContainerSpec | null) => {
    if (!container) return undefined;
    const hasContent =
      container.description ||
      container.preparation ||
      container.capacity ||
      container.cap ||
      container.minimum_volume?.quantity ||
      container.minimum_volume?.string;

    if (!hasContent) return undefined;

    const cleaned = { ...container };
    if (
      container.minimum_volume &&
      !container.minimum_volume.quantity &&
      !container.minimum_volume.string
    ) {
      delete cleaned.minimum_volume;
    }

    return cleaned;
  };

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

    for (const row of validRows) {
      try {
        const slug = row.data.slug_value!;

        const hasTypeTested =
          row.data.is_derived !== undefined ||
          row.data.preference !== undefined ||
          row.data.single_use !== undefined ||
          row.data.requirement ||
          row.data.retention_time ||
          row.data.container;

        const typeTested: TypeTestedSpec | undefined = hasTypeTested
          ? {
              is_derived: row.data.is_derived ?? false,
              preference: row.data.preference ?? Preference.preferred,
              single_use: row.data.single_use ?? false,
              requirement: row.data.requirement || undefined,
              retention_time: row.data.retention_time || undefined,
              container: cleanContainerData(row.data.container),
            }
          : undefined;

        const payload: SpecimenDefinitionCreate = {
          slug_value: slug,
          title: row.data.title,
          status: row.data.status,
          description: row.data.description,
          derived_from_uri: row.data.derived_from_uri || undefined,
          type_collected: row.data.type_collected,
          patient_preparation: [],
          collection: row.data.collection || undefined,
          type_tested: typeTested,
        };

        const detailSlug = `f-${facilityId}-${slug}`;
        const detailPath = `/api/v1/facility/${facilityId}/specimen_definition/${detailSlug}/`;
        const upsertPath = `/api/v1/facility/${facilityId}/specimen_definition/upsert/`;
        const existingId = await fetchExistingId(detailPath);
        const datapoint = existingId
          ? { ...payload, id: `f-${facilityId}-${slug}` }
          : payload;

        await request(upsertPath, {
          method: "POST",
          body: JSON.stringify({ datapoints: [datapoint] }),
        });

        setResults((prev) =>
          prev
            ? {
                ...prev,
                processed: prev.processed + 1,
                updated: prev.updated + (existingId ? 1 : 0),
                created: prev.created + (existingId ? 0 : 1),
              }
            : prev,
        );
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
    return (
      <div className="max-w-7xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Specimen Definition Import — Master Review</CardTitle>
            <CardDescription>
              Review and validate specimen definitions before importing.
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
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
              <div>
                Selected {selectedValidCount} of {summary.valid} valid rows
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="specimen-definition-master-select-all"
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
                <label htmlFor="specimen-definition-master-select-all">
                  Select all valid rows
                </label>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-2 text-left w-14">Select</th>
                    <th className="px-4 py-2 text-left w-14">Row</th>
                    <th className="px-4 py-2 text-left w-1/3">Title</th>
                    <th className="px-4 py-2 text-left w-24">Status</th>
                    <th className="px-4 py-2 text-left">Message</th>
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
                      <td className="px-4 py-2 align-top">
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
                      <td className="px-4 py-2 text-gray-500 align-top">
                        {row.rowIndex}
                      </td>
                      <td className="px-4 py-2 align-top whitespace-normal break-words">
                        {row.data.title}
                      </td>
                      <td className="px-4 py-2 align-top">
                        {row.errors.length === 0 ? (
                          <span className="text-emerald-700">Valid</span>
                        ) : (
                          <span className="text-red-600">Invalid</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600 align-top whitespace-normal break-words">
                        {row.errors.length > 0
                          ? row.errors.join("; ")
                          : "All checks passed"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={onBack}>
                Back
              </Button>
              <Button
                onClick={runImport}
                disabled={
                  selectedValidCount === 0 || lookupStatus === "loading"
                }
              >
                Import {selectedValidCount} Selected Row
                {selectedValidCount !== 1 ? "s" : ""}
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
            <CardTitle>Importing Specimen Definitions</CardTitle>
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
          <CardTitle>Specimen Definition Import Results</CardTitle>
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
              Import Another File
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
