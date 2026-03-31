import { AlertCircle, Upload } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  generateSampleValueSetCsv,
  parseValueSetCsv,
} from "@/utils/valuesetHelpers";

import ValueSetCsvImport from "./ValueSetCsvImport";

interface ValueSetImportProps {
  facilityId?: string;
}

export default function ValueSetImport({ facilityId }: ValueSetImportProps) {
  const [activeView, setActiveView] = useState<
    { kind: "upload" } | { kind: "csv"; csvText: string }
  >({ kind: "upload" });
  const [uploadError, setUploadError] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");

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
        const { rows, error } = parseValueSetCsv(csvText);

        if (error) {
          setUploadError(error);
          return;
        }

        if (rows.length === 0) {
          setUploadError("CSV has no data rows");
          return;
        }

        setUploadError("");
        setUploadedFileName(file.name);
        setActiveView({ kind: "csv", csvText });
      } catch {
        setUploadError("Error processing CSV file");
      }
    };
    reader.readAsText(file);
  };

  const downloadSample = () => {
    const csvText = generateSampleValueSetCsv();
    const blob = new Blob([csvText], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sample_valueset_import.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (activeView.kind === "csv") {
    return (
      <ValueSetCsvImport
        csvText={activeView.csvText}
        fileName={uploadedFileName}
        facilityId={facilityId}
        onBack={() => setActiveView({ kind: "upload" })}
      />
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Value Sets from CSV
          </CardTitle>
          <CardDescription>
            Upload a CSV file to create or update value sets. Each row
            represents a concept or filter entry. Rows are grouped by slug to
            form complete value sets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              id="valueset-csv-upload"
            />
            <label htmlFor="valueset-csv-upload" className="cursor-pointer">
              <div className="flex flex-col items-center gap-4">
                <Upload className="h-12 w-12 text-gray-400" />
                <div>
                  <p className="text-lg font-medium">
                    Click to upload CSV file
                  </p>
                  <p className="text-sm text-gray-500">or drag and drop</p>
                </div>
                <p className="text-xs text-gray-400">
                  Expected columns: name, slug, description, compose_type,
                  system, entry_type, code, display (optional), filter_property,
                  filter_op, filter_value
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    downloadSample();
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
        </CardContent>
      </Card>
    </div>
  );
}
