import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PipelineField, PipelineOptions } from "@/lib/api";

export interface PipelineRunFieldValues {
  url?: string;
  tier?: string;
  pages?: string[];
  mode?: string;
  contentSiteUuid?: string;
  designSiteUuid?: string;
}

interface PipelineRunFieldsProps {
  options: PipelineOptions;
  runType: "full" | "stage";
  selectedStage: string;
  scope: "homepage" | "full" | "custom";
  runTag: string;
  values: PipelineRunFieldValues;
  isPending: boolean;
  error: Error | null;
  submitLabel?: string;
  onRunTypeChange: (runType: "full" | "stage") => void;
  onSelectedStageChange: (stage: string) => void;
  onScopeChange: (scope: "homepage" | "full" | "custom") => void;
  onValuesChange: (values: PipelineRunFieldValues) => void;
  onRunTagChange: (runTag: string) => void;
  onSubmit: () => void;
}

export function PipelineRunFields({
  options,
  runType,
  selectedStage,
  scope,
  runTag,
  values,
  isPending,
  error,
  submitLabel = "Run pipeline",
  onRunTypeChange,
  onSelectedStageChange,
  onScopeChange,
  onValuesChange,
  onRunTagChange,
  onSubmit,
}: PipelineRunFieldsProps) {
  const visibleFields = useMemo(
    () =>
      options.fields.filter((field) => {
        if (!field.dependsOn) return true;
        return values[field.dependsOn.key as keyof PipelineRunFieldValues] === field.dependsOn.value;
      }),
    [options.fields, values],
  );

  function updateField(key: keyof PipelineRunFieldValues, value: unknown) {
    onValuesChange({ ...values, [key]: value });
  }

  function setScope(next: "homepage" | "full" | "custom") {
    onScopeChange(next);
    if (next === "homepage") {
      updateField("pages", ["/"]);
    } else if (next === "full") {
      const nextValues = { ...values };
      delete nextValues.pages;
      onValuesChange(nextValues);
    } else {
      updateField("pages", values.pages?.length ? values.pages : [""]);
    }
  }

  function updatePages(index: number, value: string) {
    const pages = [...(values.pages ?? [])];
    pages[index] = value;
    updateField("pages", pages);
  }

  function removePage(index: number) {
    const pages = [...(values.pages ?? [])];
    pages.splice(index, 1);
    updateField("pages", pages);
  }

  function addPage() {
    updateField("pages", [...(values.pages ?? []), ""]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="runType"
            checked={runType === "full"}
            onChange={() => onRunTypeChange("full")}
          />
          Full pipeline run
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="runType"
            checked={runType === "stage"}
            onChange={() => onRunTypeChange("stage")}
          />
          Single stage
        </label>
        {runType === "stage" && (
          <select
            className="rounded border bg-background px-2 py-1 text-sm"
            value={selectedStage}
            onChange={(e) => onSelectedStageChange(e.target.value)}
          >
            {options.stages.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Scope</label>
        <div className="flex flex-wrap gap-4">
          {[
            { key: "homepage", label: "Homepage only" },
            { key: "full", label: "All discovered pages" },
            { key: "custom", label: "Custom page list" },
          ].map((choice) => (
            <label key={choice.key} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="scope"
                checked={scope === (choice.key as typeof scope)}
                onChange={() => setScope(choice.key as typeof scope)}
              />
              {choice.label}
            </label>
          ))}
        </div>
        {scope === "custom" && (
          <div className="space-y-2 pt-2">
            {(values.pages ?? []).map((page, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={page}
                  onChange={(e) => updatePages(i, e.target.value)}
                  placeholder="/path"
                  className="flex-1 rounded border bg-background px-2 py-1 text-sm"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => removePage(i)}>
                  Remove
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addPage}>
              Add page
            </Button>
          </div>
        )}
      </div>

      {visibleFields.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          value={values[field.key as keyof PipelineRunFieldValues]}
          onChange={(value) => updateField(field.key as keyof PipelineRunFieldValues, value)}
        />
      ))}

      <div className="space-y-1">
        <label htmlFor="runTag" className="text-sm font-medium">
          Run tag
        </label>
        <input
          id="runTag"
          type="text"
          value={runTag}
          onChange={(e) => onRunTagChange(e.target.value)}
          placeholder="Optional label for your notes"
          className="w-full rounded border bg-background px-2 py-1 text-sm"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Enqueueing…" : submitLabel}
        </Button>
        {runTag && <Badge variant="secondary">{runTag}</Badge>}
      </div>

      {error && <div className="text-sm text-destructive">{error.message}</div>}
    </form>
  );
}

interface FieldInputProps {
  field: PipelineField;
  value: unknown;
  onChange: (value: unknown) => void;
}

function FieldInput({ field, value, onChange }: FieldInputProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={field.key} className="text-sm font-medium">
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
      </label>
      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
      {field.type === "select" && field.options ? (
        <select
          id={field.key}
          required={field.required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border bg-background px-2 py-1 text-sm"
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : field.type === "number" ? (
        <input
          id={field.key}
          type="number"
          required={field.required}
          value={(value as number | string) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full rounded border bg-background px-2 py-1 text-sm"
        />
      ) : field.type === "multiselect" ? (
        <input
          id={field.key}
          type="text"
          required={field.required}
          value={Array.isArray(value) ? value.join(", ") : (value as string) ?? ""}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder="Comma-separated paths"
          className="w-full rounded border bg-background px-2 py-1 text-sm"
        />
      ) : (
        <input
          id={field.key}
          type={field.type === "uuid" ? "text" : "text"}
          required={field.required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border bg-background px-2 py-1 text-sm"
        />
      )}
    </div>
  );
}
