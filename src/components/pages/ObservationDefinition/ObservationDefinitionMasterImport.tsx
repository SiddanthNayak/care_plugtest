import { CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";

import { queryString, request } from "@/apis/request";
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
import { fetchExistingId, type ImportResults } from "@/utils/importHelpers";
import {
  parseObservationDefinitionCsv,
  type ObservationProcessedRow,
} from "@/utils/masterImport/observationDefinition";

interface ObservationDefinitionMasterImportProps {
  facilityId?: string;
  initialCsvText: string;
  onBack: () => void;
}

export default function ObservationDefinitionMasterImport({
  facilityId,
  initialCsvText,
  onBack,
}: ObservationDefinitionMasterImportProps) {
  const [currentStep, setCurrentStep] = useState<
    "review" | "importing" | "done"
  >("review");
  const [processedRows] = useState<ObservationProcessedRow[]>(() =>
    parseObservationDefinitionCsv(initialCsvText),
  );
  const [selectedRowIds, setSelectedRowIds] = useState<Set<number>>(
    () =>
      new Set(
        parseObservationDefinitionCsv(initialCsvText)
          .filter((row) => row.errors.length === 0)
          .map((row) => row.rowIndex),
      ),
  );
  const [results, setResults] = useState<ImportResults | null>(null);
  const [totalToImport, setTotalToImport] = useState(0);

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
        const slug = row.data.slug_value;
        const payload = {
          slug_value: slug,
          title: row.data.title,
          status: row.data.status,
          description: row.data.description,
          category: row.data.category,
          code: row.data.code,
          permitted_data_type: row.data.permitted_data_type,
          component: row.data.component,
          body_site: row.data.body_site,
          method: row.data.method,
          permitted_unit: row.data.permitted_unit,
          derived_from_uri: row.data.derived_from_uri || undefined,
          facility: facilityId,
          qualified_ranges: row.data.qualified_ranges ?? [],
        };

        const detailPath = `/api/v1/observation_definition/f-${facilityId}-${slug}/${queryString({ facility: facilityId })}`;
        const upsertPath = "/api/v1/observation_definition/upsert/";
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
    return (
      <div className="max-w-7xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Observation Definition Import — Master Review</CardTitle>
            <CardDescription>
              Review and validate observation definitions before importing.
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
                  id="observation-definition-master-select-all"
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
                <label htmlFor="observation-definition-master-select-all">
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
                        <td className="px-4 py-2">{row.data.category}</td>
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
              <Button variant="outline" onClick={onBack}>
                Back
              </Button>
              <Button onClick={runImport} disabled={selectedValidCount === 0}>
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
            <CardTitle>Importing Observation Definitions</CardTitle>
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
          <CardTitle>Observation Definition Import Results</CardTitle>
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
