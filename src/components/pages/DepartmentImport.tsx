import { AlertCircle, Upload } from "lucide-react";
import { useState } from "react";

import { request } from "@/apis/request";
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

interface DepartmentImportProps {
  facilityId?: string;
}

interface DepartmentNode {
  name: string;
  children: DepartmentNode[];
}

interface DepartmentRow {
  name: string;
  parent?: string;
}

interface DepartmentImportFailure {
  departmentName: string;
  reason: string;
}

interface DepartmentImportResults {
  processed: number;
  created: number;
  failed: number;
  failures: DepartmentImportFailure[];
}

const REQUIRED_HEADERS = ["name", "parent"] as const;

const normalizeHeader = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const buildHeaderMap = (headers: string[]) => {
  const headerMap: Record<"name" | "parent", number | undefined> = {
    name: undefined,
    parent: undefined,
  };
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized === "name" || normalized === "department") {
      headerMap.name = index;
    }
    if (normalized === "parent" || normalized === "parentdepartment") {
      headerMap.parent = index;
    }
  });
  return headerMap;
};

const buildDepartmentTree = (rows: DepartmentRow[]) => {
  const nodesByName = new Map<string, DepartmentNode>();
  const roots: DepartmentNode[] = [];

  const getOrCreateNode = (name: string) => {
    const existing = nodesByName.get(name);
    if (existing) return existing;
    const node = { name, children: [] };
    nodesByName.set(name, node);
    return node;
  };

  rows.forEach((row) => {
    const name = row.name.trim();
    if (!name) return;
    const node = getOrCreateNode(name);
    const parentName = row.parent?.trim();
    if (parentName) {
      const parentNode = getOrCreateNode(parentName);
      if (!parentNode.children.find((child) => child.name === node.name)) {
        parentNode.children.push(node);
      }
    } else if (!roots.find((root) => root.name === node.name)) {
      roots.push(node);
    }
  });

  return roots;
};

export default function DepartmentImport({
  facilityId,
}: DepartmentImportProps) {
  const [currentStep, setCurrentStep] = useState<
    "upload" | "review" | "importing" | "done"
  >("upload");
  const [uploadError, setUploadError] = useState<string>("");
  const [departments, setDepartments] = useState<DepartmentNode[]>([]);
  const [departmentRows, setDepartmentRows] = useState<DepartmentRow[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importProcessed, setImportProcessed] = useState(0);
  const [results, setResults] = useState<DepartmentImportResults | null>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
      setUploadError("Please upload a valid CSV file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target?.result as string;
        const rows = csvText
          .split("\n")
          .map((row) => row.trim())
          .filter(Boolean);

        if (rows.length === 0) {
          setUploadError("CSV is empty or missing headers");
          return;
        }

        const headers = rows[0]
          .split(",")
          .map((h) => h.trim().replace(/"/g, ""));
        const headerMap = buildHeaderMap(headers);

        const missingHeaders = REQUIRED_HEADERS.filter(
          (header) => headerMap[header] === undefined,
        );
        if (missingHeaders.length > 0) {
          setUploadError(
            `Missing required headers: ${missingHeaders.join(", ")}`,
          );
          return;
        }

        const dataRows: DepartmentRow[] = [];
        for (let i = 1; i < rows.length; i++) {
          if (!rows[i]) continue;
          const values = rows[i]
            .split(",")
            .map((value) => value.trim().replace(/"/g, ""));
          const name = values[headerMap.name!] ?? "";
          const parent =
            headerMap.parent !== undefined
              ? values[headerMap.parent]
              : undefined;

          if (name.trim()) {
            dataRows.push({ name, parent });
          }
        }

        setUploadError("");
        setDepartmentRows(dataRows);
        setDepartments(buildDepartmentTree(dataRows));
        setCurrentStep("review");
      } catch (error) {
        setUploadError("Error processing CSV file");
      }
    };
    reader.readAsText(file);
  };

  const saveDepartments = async () => {
    if (!facilityId) return;
    if (departmentRows.length === 0) return;

    setCurrentStep("importing");
    setImportTotal(departmentRows.length);
    setImportProcessed(0);
    setImportProgress(0);
    setResults({
      processed: 0,
      created: 0,
      failed: 0,
      failures: [],
    });

    const normalizeName = (value: string) => value.trim().toLowerCase();
    const rowsByKey = new Map<string, DepartmentRow>();
    const duplicateIssues: DepartmentImportFailure[] = [];

    const buildCompositeKey = (name: string, parent?: string) => {
      const parentKey = normalizeName(parent ?? "");
      const nameKey = normalizeName(name);
      return `${parentKey}::${nameKey}`;
    };

    departmentRows.forEach((row) => {
      const compositeKey = buildCompositeKey(row.name, row.parent);
      const existing = rowsByKey.get(compositeKey);
      if (existing) {
        duplicateIssues.push({
          departmentName: row.name,
          reason: `Duplicate department under parent: ${row.parent ?? "(root)"}`,
        });
      } else {
        rowsByKey.set(compositeKey, row);
      }
    });

    if (duplicateIssues.length > 0) {
      setResults((prev) =>
        prev
          ? {
              ...prev,
              processed: prev.processed + duplicateIssues.length,
              failed: prev.failed + duplicateIssues.length,
              failures: [...prev.failures, ...duplicateIssues],
            }
          : prev,
      );
    }

    const existingResponse = await request<{
      results: { id: string; name: string }[];
    }>(`/api/v1/facility/${facilityId}/organizations/?limit=500`, {
      method: "GET",
    });
    const existingByName = new Map<string, string>();
    existingResponse.results.forEach((org) => {
      const key = normalizeName(org.name);
      if (!existingByName.has(key)) {
        existingByName.set(key, org.id);
      }
    });

    const createdByName = new Map<string, string>();
    const visited = new Set<string>();

    const ensureDepartment = async (row: DepartmentRow): Promise<string> => {
      const nameKey = normalizeName(row.name);
      const compositeKey = buildCompositeKey(row.name, row.parent);
      const parentKey = normalizeName(row.parent ?? "");
      if (createdByName.has(compositeKey)) {
        return createdByName.get(compositeKey)!;
      }
      if (parentKey === "" && existingByName.has(nameKey)) {
        const id = existingByName.get(nameKey)!;
        createdByName.set(compositeKey, id);
        return id;
      }
      if (visited.has(compositeKey)) {
        throw new Error(`Circular parent reference for ${row.name}`);
      }

      visited.add(compositeKey);
      let parentId: string | undefined;
      const parentName = row.parent?.trim();
      if (parentName) {
        const resolvedParentKey = normalizeName(parentName);
        const parentCompositeKey = buildCompositeKey(parentName);
        if (createdByName.has(parentCompositeKey)) {
          parentId = createdByName.get(parentCompositeKey);
        } else if (existingByName.has(resolvedParentKey)) {
          parentId = existingByName.get(resolvedParentKey);
          if (parentId) createdByName.set(parentCompositeKey, parentId);
        } else {
          const parentRow = rowsByKey.get(buildCompositeKey(parentName));
          const parentRowFallback =
            parentRow ??
            Array.from(rowsByKey.values()).find(
              (entry) => normalizeName(entry.name) === resolvedParentKey,
            );
          if (!parentRowFallback) {
            throw new Error(`Parent not found: ${parentName}`);
          }
          parentId = await ensureDepartment(parentRowFallback);
        }
      }

      const created = await createDepartment(facilityId, row.name, parentId);
      createdByName.set(compositeKey, created);
      visited.delete(compositeKey);
      return created;
    };

    const rowsToProcess = Array.from(rowsByKey.values());
    for (let index = 0; index < rowsToProcess.length; index++) {
      const row = rowsToProcess[index];
      try {
        await ensureDepartment(row);
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
                    departmentName: row.name,
                    reason,
                  },
                ],
              }
            : prev,
        );
      }

      const processedCount = index + 1;
      setImportProcessed(processedCount);
      setImportProgress(
        Math.round((processedCount / rowsToProcess.length) * 100),
      );
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
              Import Departments from CSV
            </CardTitle>
            <CardDescription>
              Upload a CSV file to import departments with parent-child
              relationships preserved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
                id="dept-csv-upload"
              />
              <label htmlFor="dept-csv-upload" className="cursor-pointer">
                <div className="flex flex-col items-center gap-4">
                  <Upload className="h-12 w-12 text-gray-400" />
                  <div>
                    <p className="text-lg font-medium">
                      Click to upload CSV file
                    </p>
                    <p className="text-sm text-gray-500">or drag and drop</p>
                  </div>
                  <p className="text-xs text-gray-400">
                    Expected columns: name, parent
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    Leave parent empty for top-level departments.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const sampleCSV = `Name,Parent
Dep1,
SubDep1,Dep1
SS2,SubDep1
SD2,Dep1`;
                      const blob = new Blob([sampleCSV], { type: "text/csv" });
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "sample_departments.csv";
                      a.click();
                      window.URL.revokeObjectURL(url);
                    }}
                  >
                    Download Sample CSV
                  </Button>
                </div>
              </label>
            </div>

            {uploadError && (
              <Alert className="mt-4" variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{uploadError}</AlertDescription>
              </Alert>
            )}

            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-sm mb-2">Example hierarchy:</h4>
              <div className="flex flex-wrap gap-2">
                {["Dep1", "Dep1 > SubDep1", "Dep1 > SubDep1 > SS2"].map(
                  (label) => (
                    <Badge key={label} variant="outline" className="text-xs">
                      {label}
                    </Badge>
                  ),
                )}
              </div>
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
            <CardTitle>Importing Departments</CardTitle>
            <CardDescription>
              {importProcessed}/{importTotal} processed
            </CardDescription>
            <div className="mt-4">
              <Progress value={importProgress} className="h-2" />
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (currentStep === "done") {
    return (
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Department Import Complete</CardTitle>
            <CardDescription>
              Created: {results?.created ?? 0} · Failed: {results?.failed ?? 0}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {results && results.failures.length > 0 && (
              <Alert className="mb-4" variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {results.failures.slice(0, 5).map((failure) => (
                    <div key={`${failure.departmentName}-${failure.reason}`}>
                      {failure.departmentName}: {failure.reason}
                    </div>
                  ))}
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => setCurrentStep("upload")}
              >
                Import Another File
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const renderDepartmentNode = (
    node: DepartmentNode,
    level = 0,
  ): React.ReactElement => (
    <div
      key={`${node.name}-${level}`}
      className={level === 0 ? "border-b border-gray-100 p-3" : "pl-4"}
    >
      <div className="flex items-center justify-between">
        <span
          className={
            level === 0 ? "font-medium text-gray-900" : "text-sm text-gray-600"
          }
        >
          {node.name}
        </span>
        <Badge variant="outline" className="text-xs">
          {level === 0 ? "Department" : "Sub Department"}
        </Badge>
      </div>
      {node.children.length > 0 && (
        <div className="mt-2 space-y-1">
          {node.children.map((child) => renderDepartmentNode(child, level + 1))}
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Department Import Wizard</CardTitle>
          <CardDescription>
            Review and validate departments before importing
          </CardDescription>
          <div className="mt-4">
            <Progress value={100} className="h-2" />
          </div>
        </CardHeader>
        <CardContent>
          <div>
            <h3 className="text-lg font-semibold mb-4">
              Review All Departments
            </h3>
            <div className="border rounded-lg bg-white">
              {departments.map((department) =>
                renderDepartmentNode(department),
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <Button className="mt-4" onClick={saveDepartments}>
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

async function createDepartment(
  facilityId: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const payload = {
    name,
    description: "",
    org_type: "dept",
    parent: parentId ?? undefined,
    facility: facilityId,
  };

  const created = (await request<{ id?: string }>(
    `/api/v1/facility/${facilityId}/organizations/`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  )) as { id?: string } | null;

  if (!created?.id) {
    throw new Error(`Failed to create department: ${name}`);
  }

  return created.id;
}
