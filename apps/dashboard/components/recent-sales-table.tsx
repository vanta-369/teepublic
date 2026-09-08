"use client";

import { Badge } from "@/components/ui/badge";
import { DesignTitleLink } from "@/components/design-title-link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SaleRow } from "@/lib/dashboard-types";
import { formatCurrency, formatDayLong } from "@/lib/formatters";

/** The most recent sale lines in the window, newest first. */
export function RecentSalesTable({ sales, currency }: { sales: SaleRow[]; currency: string }) {
  return (
    <Card className="viz-root">
      <CardHeader>
        <CardTitle className="text-base">Recent sales</CardTitle>
        <CardDescription>The latest lines in your export.</CardDescription>
      </CardHeader>

      {sales.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-zinc-500 dark:text-zinc-400">No sales in this range.</p>
      ) : (
        <div className="px-2 pb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Design</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Earnings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((s, i) => (
                <TableRow key={`${s.orderId ?? "row"}-${s.day}-${i}`}>
                  <TableCell className="whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    {formatDayLong(s.day)}
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    <DesignTitleLink design={s.design} designId={s.designId} />
                    {/* The design id disambiguates listings that share a title. */}
                    {s.designId && (
                      <span className="font-mono text-[11px] text-zinc-400">#{s.designId}</span>
                    )}
                    {s.country && (
                      <span className="ml-2 text-xs text-zinc-400">{s.country}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge>{s.productType}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.quantity}</TableCell>
                  <TableCell
                    className="text-right font-bold tabular-nums text-accent-600 dark:text-accent-400"
                    // A refund is a negative line; the sign plus the colour keeps
                    // it from reading as ordinary revenue.
                    style={s.earnings < 0 ? { color: "var(--viz-down)" } : undefined}
                  >
                    {formatCurrency(s.earnings, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
