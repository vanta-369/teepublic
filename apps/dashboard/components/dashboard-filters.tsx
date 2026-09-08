"use client";

import * as React from "react";
import { CalendarDays, Check, ChevronDown, Layers, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RANGE_OPTIONS } from "@/lib/dashboard-data";
import type { RangeKey } from "@/lib/dashboard-types";

/**
 * The one filter row. It sits above everything it scopes — never inside a chart
 * card, never per-chart — so every tile, chart and table below re-renders
 * against the same slice and the numbers always agree.
 *
 * Date range comes first: it's the control every reader reaches for. Presets
 * are rows rather than a calendar grid, because nobody wants to fight a grid
 * for "last 30 days".
 */
export function DashboardFilters({
  range,
  onRangeChange,
  productTypes,
  productType,
  onProductTypeChange,
  onReplaceFile,
  rangeSummary,
}: {
  range: RangeKey;
  onRangeChange: (range: RangeKey) => void;
  productTypes: string[];
  /** `null` = every product type. */
  productType: string | null;
  onProductTypeChange: (type: string | null) => void;
  onReplaceFile: () => void;
  rangeSummary: string;
}) {
  const activeRange = RANGE_OPTIONS.find((o) => o.key === range) ?? RANGE_OPTIONS[1];

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <CalendarDays className="h-4 w-4" aria-hidden />
            {activeRange.label}
            <ChevronDown className="h-4 w-4 opacity-60" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[13rem]">
          <DropdownMenuLabel>Date range</DropdownMenuLabel>
          {RANGE_OPTIONS.map((option) => (
            <DropdownMenuItem key={option.key} onSelect={() => onRangeChange(option.key)}>
              {/* 16px bold check marks selection; hover stays a ghost wash so
                  the two states never compete. */}
              <span className="flex h-4 w-4 items-center justify-center">
                {option.key === range && <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}
              </span>
              {option.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <p className="px-2 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">{rangeSummary}</p>
        </DropdownMenuContent>
      </DropdownMenu>

      {productTypes.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Layers className="h-4 w-4" aria-hidden />
              {productType ?? "All products"}
              <ChevronDown className="h-4 w-4 opacity-60" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            <DropdownMenuLabel>Product type</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onProductTypeChange(null)}>
              <span className="flex h-4 w-4 items-center justify-center">
                {productType === null && <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}
              </span>
              All products
            </DropdownMenuItem>
            {productTypes.map((type) => (
              <DropdownMenuItem key={type} onSelect={() => onProductTypeChange(type)}>
                <span className="flex h-4 w-4 items-center justify-center">
                  {productType === type && <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}
                </span>
                {type}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <div className="ml-auto">
        <Button variant="ghost" size="sm" className="gap-2" onClick={onReplaceFile}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Replace file
        </Button>
      </div>
    </div>
  );
}
