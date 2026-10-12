"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { ChipInput } from "@/components/ui/chip-input";
import { Input } from "@/components/ui/field";

export interface SkillValue {
  name: string;
  aliases?: string[];
}

/** One row per skill: its name plus alternative spellings that count as the same skill. */
export function SkillListEditor({
  value,
  onChange,
  max,
  disabled,
  addLabel,
}: {
  value: SkillValue[];
  onChange: (next: SkillValue[]) => void;
  max: number;
  disabled?: boolean;
  addLabel: string;
}) {
  const baseId = useId();
  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && <p className="text-[13px] text-muted">None yet.</p>}
      {value.map((skill, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-control border border-line p-2 sm:flex-row sm:items-start"
        >
          <div className="sm:w-48">
            <label htmlFor={`${baseId}-name-${index}`} className="sr-only">
              Skill {index + 1} name
            </label>
            <Input
              id={`${baseId}-name-${index}`}
              value={skill.name}
              placeholder="Skill, e.g. React"
              disabled={disabled}
              onChange={(event) =>
                onChange(value.map((s, i) => (i === index ? { ...s, name: event.target.value } : s)))
              }
            />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor={`${baseId}-aliases-${index}`} className="sr-only">
              Alternative spellings for skill {index + 1}
            </label>
            <ChipInput
              id={`${baseId}-aliases-${index}`}
              value={skill.aliases ?? []}
              max={20}
              placeholder="Also matches (Enter to add)"
              onChange={(aliases) => onChange(value.map((s, i) => (i === index ? { ...s, aliases } : s)))}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            aria-label={`Remove skill ${skill.name || index + 1}`}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || value.length >= max}
          onClick={() => onChange([...value, { name: "", aliases: [] }])}
        >
          <Plus />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

/** Groups of terms that must all appear together (at least one group must match). */
export function CombinationEditor({
  value,
  onChange,
  disabled,
}: {
  value: string[][];
  onChange: (next: string[][]) => void;
  disabled?: boolean;
}) {
  const baseId = useId();
  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && <p className="text-[13px] text-muted">None. Any job may match.</p>}
      {value.map((combo, index) => (
        <div key={index} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`${baseId}-combo-${index}`} className="sr-only">
              Combination {index + 1}
            </label>
            <ChipInput
              id={`${baseId}-combo-${index}`}
              value={combo}
              max={10}
              placeholder="Terms that must all appear (at least 2)"
              onChange={(terms) => onChange(value.map((c, i) => (i === index ? terms : c)))}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            aria-label={`Remove combination ${index + 1}`}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || value.length >= 20}
          onClick={() => onChange([...value, []])}
        >
          <Plus />
          Add combination
        </Button>
      </div>
    </div>
  );
}

/** Fixed exchange rates: units of the profile currency per one unit of another currency. */
export function RatesEditor({
  value,
  onChange,
  currency,
  disabled,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  currency: string;
  disabled?: boolean;
}) {
  const baseId = useId();
  const rows = Object.entries(value);
  function update(index: number, code: string, rate: string) {
    const next = rows.map(([c, r], i) => (i === index ? [code, rate] : [c, r]) as [string, string]);
    onChange(Object.fromEntries(next));
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([code, rate], index) => (
        <div key={index} className="flex flex-wrap items-center gap-2 text-sm">
          <span>1</span>
          <label htmlFor={`${baseId}-code-${index}`} className="sr-only">
            Currency code
          </label>
          <Input
            id={`${baseId}-code-${index}`}
            value={code}
            maxLength={3}
            className="w-20 uppercase"
            disabled={disabled}
            onChange={(event) => update(index, event.target.value.toUpperCase(), rate)}
          />
          <span>=</span>
          <label htmlFor={`${baseId}-rate-${index}`} className="sr-only">
            Rate
          </label>
          <Input
            id={`${baseId}-rate-${index}`}
            value={rate}
            inputMode="decimal"
            className="w-28"
            disabled={disabled}
            onChange={(event) => update(index, code, event.target.value)}
          />
          <span>{currency}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            onClick={() => onChange(Object.fromEntries(rows.filter((_, i) => i !== index)))}
            aria-label={`Remove rate ${code || index + 1}`}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          // Rates are a map keyed by currency: only one blank row can exist at a time.
          disabled={disabled || "" in value}
          onClick={() => onChange({ ...value, "": "" })}
        >
          <Plus />
          Add exchange rate
        </Button>
      </div>
    </div>
  );
}
