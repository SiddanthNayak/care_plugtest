import { AlertCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { request } from "@/apis/request";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  ProductKnowledgeCreate,
  ProductKnowledgeStatus,
} from "@/types/inventory/productKnowledge/productKnowledge";
import { type ImportResults } from "@/utils/importHelpers";
import {
  normalizeProductKnowledgeName,
  parseProductKnowledgeCsv,
  resolveProductKnowledgeDatapoint,
  type ProductKnowledgeProcessedRow,
} from "@/utils/masterImport/productKnowledge";
import { upsertResourceCategories } from "@/utils/resourceCategory";

type ProcessedRow = ProductKnowledgeProcessedRow;

interface ProductKnowledgeCsvImportProps {
  facilityId?: string;
  initialCsvText: string;
  onBack: () => void;
}

export default function ProductKnowledgeCsvImport({
  facilityId,
  initialCsvText,
  onBack,
}: ProductKnowledgeCsvImportProps) {
  const [currentStep, setCurrentStep] = useState<
    "review" | "importing" | "done"
  >("review");
  const [processedRows] = useState<ProcessedRow[]>(() =>
    parseProductKnowledgeCsv(initialCsvText),
  );
  const [results, setResults] = useState<ImportResults | null>(null);

  const summary = useMemo(() => {
    const valid = processedRows.filter((row) => row.errors.length === 0).length;
    const invalid = processedRows.length - valid;
    return { total: processedRows.length, valid, invalid };
  }, [processedRows]);

  const validRows = useMemo(
    () => processedRows.filter((row) => row.errors.length === 0),
    [processedRows],
  );

  const runImport = async () => {
    if (!facilityId) return;

    if (validRows.length === 0) {
      setResults({
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
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
      skipped: 0,
      failed: 0,
      failures: [],
    });

    const resourceCategories = [
      ...new Set(validRows.map((row) => row.normalized!.resourceCategory)),
    ];

    const categorySlugMap = await upsertResourceCategories({
      facilityId,
      categories: resourceCategories,
      resourceType: ResourceCategoryResourceType.product_knowledge,
      slugPrefix: "pk",
    });

    for (const row of validRows) {
      const datapoint = await resolveProductKnowledgeDatapoint(row.normalized!);

      const categorySlug =
        categorySlugMap.get(
          normalizeProductKnowledgeName(datapoint.resourceCategory),
        ) || "";
      const productKnowledge: ProductKnowledgeCreate = {
        slug_value: datapoint.slug,
        name: datapoint.name,
        facility: facilityId,
        product_type: datapoint.productType,
        status: ProductKnowledgeStatus.active,
        base_unit: datapoint.baseUnit,
        category: categorySlug,
        names: [],
        storage_guidelines: [],
        is_instance_level: false,
      };

      if (datapoint.code) {
        productKnowledge.code = datapoint.code;
      }

      if (datapoint.dosageForm) {
        productKnowledge.definitional = {
          dosage_form: datapoint.dosageForm,
          intended_routes: datapoint.intendedRoutes,
          ingredients: [],
          nutrients: [],
          drug_characteristic: [],
        };
      }

      if (datapoint.alternateIdentifier) {
        productKnowledge.alternate_identifier = datapoint.alternateIdentifier;
      }

      if (datapoint.alternateNameType && datapoint.alternateNameValue) {
        productKnowledge.names = [
          {
            name_type: datapoint.alternateNameType,
            name: datapoint.alternateNameValue,
          },
        ];
      }

      try {
        await request("/api/v1/product_knowledge/", {
          method: "POST",
          body: JSON.stringify(productKnowledge),
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
                  {
                    rowIndex: row.rowIndex,
                    name: datapoint.name,
                    reason,
                  },
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
            <CardTitle>Product Knowledge Import — CSV Review</CardTitle>
            <CardDescription>
              Review and validate product knowledge before importing
            </CardDescription>
            <div className="mt-4">
              <Progress value={100} className="h-2" />
            </div>
          </CardHeader>
          <CardContent>
            <div>
              <h3 className="text-lg font-semibold mb-4">
                Review All Product Knowledge
              </h3>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="max-h-80 overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-4 py-2 text-left">Row</th>
                        <th className="px-4 py-2 text-left">Name</th>
                        <th className="px-4 py-2 text-left">Type</th>
                        <th className="px-4 py-2 text-left">Status</th>
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
                          <td className="px-4 py-2">
                            {row.normalized?.name || "—"}
                          </td>
                          <td className="px-4 py-2">
                            {row.normalized?.productType || "—"}
                          </td>
                          <td className="px-4 py-2">
                            {row.errors.length === 0 ? (
                              <span className="text-green-600">Valid</span>
                            ) : (
                              <span className="text-red-600">
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
            </div>
            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={onBack}>
                Back
              </Button>
              <Button onClick={runImport} disabled={validRows.length === 0}>
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
    return (
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Importing Product Knowledge</CardTitle>
            <CardDescription>
              {results?.processed ?? 0}/{summary.valid} processed
            </CardDescription>
            <div className="mt-4">
              <Progress
                value={
                  summary.valid
                    ? ((results?.processed ?? 0) / summary.valid) * 100
                    : 0
                }
                className="h-2"
              />
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // done
  return (
    <div className="max-w-4xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Product Knowledge Import Complete</CardTitle>
          <CardDescription>
            Created: {results?.created ?? 0} · Failed: {results?.failed ?? 0}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {results && results.failures.length > 0 && (
            <Alert className="mb-4" variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {results.failures.map((failure) => (
                  <div key={`${failure.rowIndex}-${failure.name}`}>
                    Row {failure.rowIndex}: {failure.reason}
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
