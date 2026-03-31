import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { APIError, request } from "@/apis/request";
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
import type { CodeSystem } from "@/types/valueset/valueset";
import { CODE_SYSTEM_LABELS } from "@/types/valueset/valueset";
import type {
  ProcessedValueSetRow,
  ValueSetImportResults,
} from "@/utils/valuesetHelpers";
import {
  applyVerificationResults,
  buildValueSetPayload,
  groupRowsBySlug,
  parseValueSetCsv,
  verifyAllCodes,
} from "@/utils/valuesetHelpers";

interface ValueSetCsvImportProps {
  csvText: string;
  fileName: string;
  facilityId?: string;
  onBack: () => void;
}

type Step = "review" | "verifying" | "verified" | "importing" | "done";

export default function ValueSetCsvImport({
  csvText,
  fileName,
  facilityId,
  onBack,
}: ValueSetCsvImportProps) {
  const [step, setStep] = useState<Step>("review");
  const [rows, setRows] = useState<ProcessedValueSetRow[]>(() => {
    const { rows: parsed } = parseValueSetCsv(csvText);
    return parsed;
  });
  const [verifyProgress, setVerifyProgress] = useState({ done: 0, total: 0 });
  const [importResults, setImportResults] =
    useState<ValueSetImportResults | null>(null);

  const groups = useMemo(() => groupRowsBySlug(rows), [rows]);

  // Build slug → name map so every row can show the valueset name
  const slugToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      if (g.name) map.set(g.slug, g.name);
    }
    return map;
  }, [groups]);

  const summary = useMemo(() => {
    const totalRows = rows.length;
    const validRows = rows.filter((r) => r.errors.length === 0).length;
    const invalidRows = totalRows - validRows;
    const totalValueSets = groups.length;
    const validValueSets = groups.filter(
      (g) =>
        g.errors.length === 0 && g.rows.every((r) => r.errors.length === 0),
    ).length;
    return {
      totalRows,
      validRows,
      invalidRows,
      totalValueSets,
      validValueSets,
    };
  }, [rows, groups]);

  // -----------------------------------------------------------------------
  // Code Verification
  // -----------------------------------------------------------------------

  const handleVerify = useCallback(async () => {
    setStep("verifying");
    setVerifyProgress({ done: 0, total: 0 });

    const verificationMap = await verifyAllCodes(rows, (done, total) => {
      setVerifyProgress({ done, total });
    });

    const updatedRows = applyVerificationResults(rows, verificationMap);
    setRows(updatedRows);
    setStep("verified");
  }, [rows]);

  // -----------------------------------------------------------------------
  // Import
  // -----------------------------------------------------------------------

  const handleImport = useCallback(async () => {
    if (!facilityId) return;

    setStep("importing");
    setImportResults({
      processed: 0,
      created: 0,
      updated: 0,
      failed: 0,
      failures: [],
    });

    const validGroups = groups.filter(
      (g) =>
        g.errors.length === 0 && g.rows.every((r) => r.errors.length === 0),
    );

    for (const group of validGroups) {
      try {
        const payload = buildValueSetPayload(group);
        const detailUrl = `/api/v1/valueset/${group.slug}/`;

        let exists = false;
        try {
          await request(detailUrl, { method: "GET" });
          exists = true;
        } catch (error) {
          if (error instanceof APIError && error.status === 404) {
            exists = false;
          } else {
            throw error;
          }
        }

        if (exists) {
          await request(detailUrl, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          setImportResults((prev) =>
            prev
              ? {
                  ...prev,
                  processed: prev.processed + 1,
                  updated: prev.updated + 1,
                }
              : prev,
          );
        } else {
          await request("/api/v1/valueset/", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          setImportResults((prev) =>
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
        setImportResults((prev) =>
          prev
            ? {
                ...prev,
                processed: prev.processed + 1,
                failed: prev.failed + 1,
                failures: [
                  ...prev.failures,
                  { slug: group.slug, name: group.name, reason },
                ],
              }
            : prev,
        );
      }
    }

    setStep("done");
  }, [facilityId, groups]);

  // -----------------------------------------------------------------------
  // Render: Review
  // -----------------------------------------------------------------------

  if (step === "review") {
    return (
      <div className="max-w-7xl mx-auto space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Review Value Set Import</CardTitle>
            <CardDescription>
              File: {fileName} · {summary.totalRows} rows ·{" "}
              {summary.totalValueSets} value set(s) detected
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Badge variant="secondary">{summary.validRows} valid rows</Badge>
              {summary.invalidRows > 0 && (
                <Badge className="bg-red-100 text-red-800">
                  {summary.invalidRows} invalid rows
                </Badge>
              )}
              <Badge variant="secondary">
                {summary.validValueSets} / {summary.totalValueSets} valid value
                sets
              </Badge>
            </div>

            {/* Group-level errors */}
            {groups
              .filter((g) => g.errors.length > 0)
              .map((g) => (
                <Alert key={g.slug} variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>{g.name || g.slug}:</strong> {g.errors.join("; ")}
                  </AlertDescription>
                </Alert>
              ))}

            {/* Row-level table */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="max-h-96 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Row</th>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">System</th>
                      <th className="px-3 py-2 text-left">Entry</th>
                      <th className="px-3 py-2 text-left">Code / Filter</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.rowIndex}
                        className="border-t border-gray-100"
                      >
                        <td className="px-3 py-2 text-gray-500">
                          {row.rowIndex}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {slugToName.get(row.data.slug) || row.data.slug}
                        </td>
                        <td className="px-3 py-2">{row.data.compose_type}</td>
                        <td className="px-3 py-2 text-xs">
                          {CODE_SYSTEM_LABELS[row.data.system as CodeSystem] ??
                            row.data.system}
                        </td>
                        <td className="px-3 py-2">{row.data.entry_type}</td>
                        <td className="px-3 py-2 text-xs">
                          {row.data.entry_type === "concept"
                            ? row.data.code
                            : `${row.data.filter_property} ${row.data.filter_op} ${row.data.filter_value}`}
                        </td>
                        <td className="px-3 py-2">
                          {row.errors.length === 0 ? (
                            <span className="text-green-600 text-xs">
                              Valid
                            </span>
                          ) : (
                            <span className="text-red-600 text-xs">
                              {row.errors.join("; ")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={onBack}>
                Back
              </Button>
              <Button onClick={handleVerify} disabled={summary.validRows === 0}>
                Verify Codes & Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Verifying codes
  // -----------------------------------------------------------------------

  if (step === "verifying") {
    const pct =
      verifyProgress.total > 0
        ? Math.round((verifyProgress.done / verifyProgress.total) * 100)
        : 0;

    return (
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Verifying Codes
            </CardTitle>
            <CardDescription>
              Checking {verifyProgress.done} / {verifyProgress.total} unique
              codes against the server…
            </CardDescription>
            <div className="mt-4">
              <Progress value={pct} className="h-2" />
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Verified — show final review before import
  // -----------------------------------------------------------------------

  if (step === "verified") {
    const verifiedSummary = {
      validRows: rows.filter((r) => r.errors.length === 0).length,
      invalidRows: rows.filter((r) => r.errors.length > 0).length,
      validGroups: groups.filter(
        (g) =>
          g.errors.length === 0 && g.rows.every((r) => r.errors.length === 0),
      ).length,
    };

    return (
      <div className="max-w-7xl mx-auto space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Code Verification Complete
            </CardTitle>
            <CardDescription>
              {verifiedSummary.validGroups} value set(s) ready to import
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Badge variant="secondary">
                {verifiedSummary.validRows} valid rows
              </Badge>
              {verifiedSummary.invalidRows > 0 && (
                <Badge className="bg-red-100 text-red-800">
                  {verifiedSummary.invalidRows} invalid rows
                </Badge>
              )}
            </div>

            {/* Show rows with verification errors */}
            {rows.filter((r) => r.errors.length > 0).length > 0 && (
              <div className="border border-red-200 rounded-lg overflow-hidden">
                <div className="max-h-60 overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-red-50 text-red-700 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">Row</th>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Code</th>
                        <th className="px-3 py-2 text-left">Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows
                        .filter((r) => r.errors.length > 0)
                        .map((row) => (
                          <tr
                            key={row.rowIndex}
                            className="border-t border-red-100"
                          >
                            <td className="px-3 py-2">{row.rowIndex}</td>
                            <td className="px-3 py-2 text-xs">
                              {slugToName.get(row.data.slug) || row.data.slug}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {row.data.code || "—"}
                            </td>
                            <td className="px-3 py-2 text-red-600 text-xs">
                              {row.errors.join("; ")}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Show resolved displays for valid concept rows */}
            {rows.filter((r) => r.errors.length === 0 && r.resolvedDisplay)
              .length > 0 && (
              <div className="border border-green-200 rounded-lg overflow-hidden">
                <div className="max-h-60 overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-green-50 text-green-700 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">Row</th>
                        <th className="px-3 py-2 text-left">System</th>
                        <th className="px-3 py-2 text-left">Code</th>
                        <th className="px-3 py-2 text-left">
                          Resolved Display
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows
                        .filter(
                          (r) => r.errors.length === 0 && r.resolvedDisplay,
                        )
                        .map((row) => (
                          <tr
                            key={row.rowIndex}
                            className="border-t border-green-100"
                          >
                            <td className="px-3 py-2">{row.rowIndex}</td>
                            <td className="px-3 py-2 text-xs">
                              {CODE_SYSTEM_LABELS[
                                row.data.system as CodeSystem
                              ] ?? row.data.system}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {row.data.code}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {row.resolvedDisplay}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={onBack}>
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={verifiedSummary.validGroups === 0}
              >
                Import {verifiedSummary.validGroups} Value Set(s)
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Importing
  // -----------------------------------------------------------------------

  if (step === "importing") {
    const validGroupCount = groups.filter(
      (g) =>
        g.errors.length === 0 && g.rows.every((r) => r.errors.length === 0),
    ).length;
    const pct =
      validGroupCount > 0
        ? Math.round(((importResults?.processed ?? 0) / validGroupCount) * 100)
        : 0;

    return (
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Importing Value Sets
            </CardTitle>
            <CardDescription>
              {importResults?.processed ?? 0} / {validGroupCount} processed
            </CardDescription>
            <div className="mt-4">
              <Progress value={pct} className="h-2" />
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Done
  // -----------------------------------------------------------------------

  return (
    <div className="max-w-4xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Value Set Import Complete
          </CardTitle>
          <CardDescription>
            Created: {importResults?.created ?? 0} · Updated:{" "}
            {importResults?.updated ?? 0} · Failed: {importResults?.failed ?? 0}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {importResults && importResults.failures.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {importResults.failures.slice(0, 10).map((f) => (
                  <div key={f.slug}>
                    <strong>{f.name || f.slug}:</strong> {f.reason}
                  </div>
                ))}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onBack}>
              Import Another File
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
