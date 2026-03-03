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

interface ValueSetsImportProps {
  facilityId?: string;
}

export default function ValueSetsImport({ facilityId }: ValueSetsImportProps) {
  void facilityId;
  const [uploadError, setUploadError] = useState<string>("");
  const [uploadedFileName, setUploadedFileName] = useState<string>("");

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
      setUploadError("Please upload a valid CSV file");
      setUploadedFileName("");
      return;
    }

    setUploadError("");
    setUploadedFileName(file.name);
  };

  const downloadSample = () => {
    return;
  };

  return (
    <div className="max-w-4xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Value Sets from CSV
          </CardTitle>
          <CardDescription>
            Upload a CSV file to create value sets. Implementation coming soon.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              id="valuesets-csv-upload"
            />
            <label htmlFor="valuesets-csv-upload" className="cursor-pointer">
              <div className="flex flex-col items-center gap-4">
                <Upload className="h-12 w-12 text-gray-400" />
                <div>
                  <p className="text-lg font-medium">
                    Click to upload CSV file
                  </p>
                  <p className="text-sm text-gray-500">or drag and drop</p>
                </div>
                <p className="text-xs text-gray-400">
                  CSV import will be enabled in a follow-up update.
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
