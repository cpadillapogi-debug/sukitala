"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  parseQuickAddInput,
  resolveQuickSaleItems,
  createProductFromQuickAdd,
  confirmSale,
  confirmExpense,
  type ParseResult,
  type ResolvedSaleLine,
  type ConfirmResult,
} from "./actions";
import type { DraftTransaction } from "@/lib/ai/schema";

type Step = "input" | "resolving-sale" | "expense-confirm" | "done";

export default function QuickAddPage() {
  const [text, setText] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [saleLines, setSaleLines] = useState<ResolvedSaleLine[]>([]);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);
  const [step, setStep] = useState<Step>("input");
  const [isPending, startTransition] = useTransition();
  const [paymentStatus, setPaymentStatus] = useState<"PAID" | "UNPAID">("PAID");
  const [customerName, setCustomerName] = useState("");
  const [newProductLineIndex, setNewProductLineIndex] = useState<number | null>(null);
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductCogs, setNewProductCogs] = useState("");
  const [newProductError, setNewProductError] = useState<string | null>(null);

  function handleParse() {
    startTransition(async () => {
      setConfirmResult(null);
      const r = await parseQuickAddInput(text);
      setParseResult(r);
      if (r.draft?.intent === "CREATE_SALE") {
        const resolved = await resolveQuickSaleItems(r.draft);
        setSaleLines(resolved.lines);
        setPaymentStatus(r.draft.paymentStatus === "UNPAID" ? "UNPAID" : "PAID");
        setCustomerName(r.draft.customerName ?? "");
        setStep("resolving-sale");
      } else if (r.draft?.intent === "CREATE_EXPENSE") {
        setStep("expense-confirm");
      } else {
        setStep("input");
      }
    });
  }

  function reset() {
    setParseResult(null);
    setSaleLines([]);
    setConfirmResult(null);
    setPaymentStatus("PAID");
    setCustomerName("");
    setStep("input");
  }

  const allLinesMatched = saleLines.length > 0 && saleLines.every((l) => l.resolution.status === "MATCHED");
  const canConfirmSale = allLinesMatched && (paymentStatus === "PAID" || customerName.trim().length > 0);

  function handleConfirmSale() {
    if (!canConfirmSale) return;
    startTransition(async () => {
      const items = saleLines.map((l) => {
        if (l.resolution.status !== "MATCHED") throw new Error("unreachable");
        return { productId: l.resolution.product.id, quantity: l.quantity };
      });
      const channel = parseResult?.draft && parseResult.draft.intent === "CREATE_SALE" ? parseResult.draft.channel : "UNKNOWN";
      const r = await confirmSale(items, channel, paymentStatus, paymentStatus === "UNPAID" ? customerName.trim() : undefined);
      setConfirmResult(r);
      setStep("done");
    });
  }

  function handleConfirmExpense(draft: DraftTransaction) {
    startTransition(async () => {
      const r = await confirmExpense(draft);
      setConfirmResult(r);
      setStep("done");
    });
  }

  function openNewProductForm(i: number, line: ResolvedSaleLine) {
    setNewProductLineIndex(i);
    setNewProductPrice(line.fallbackUnitPrice != null ? String(line.fallbackUnitPrice) : "");
    setNewProductCogs("");
    setNewProductError(null);
  }

  function closeNewProductForm() {
    setNewProductLineIndex(null);
    setNewProductPrice("");
    setNewProductCogs("");
    setNewProductError(null);
  }

  function handleCreateProduct(line: ResolvedSaleLine) {
    const sellingPrice = parseFloat(newProductPrice);
    if (Number.isNaN(sellingPrice) || sellingPrice <= 0) {
      setNewProductError("Selling price must be a number greater than ₱0.");
      return;
    }
    let cogs: number | null = null;
    if (newProductCogs.trim() !== "") {
      cogs = parseFloat(newProductCogs);
      if (Number.isNaN(cogs) || cogs < 0) {
        setNewProductError("COGS can't be negative.");
        return;
      }
    }
    setNewProductError(null);

    startTransition(async () => {
      const result = await createProductFromQuickAdd({
        name: line.productQuery,
        sellingPricePesos: sellingPrice,
        cogsPesos: cogs,
      });
      if (!result.ok) {
        setNewProductError(result.message);
        return;
      }
      closeNewProductForm();
      if (parseResult?.draft?.intent === "CREATE_SALE") {
        const resolved = await resolveQuickSaleItems(parseResult.draft);
        setSaleLines(resolved.lines);
      }
    });
  }

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <Link href="/dashboard" className="text-sm text-gray-500">
        ← Back
      </Link>
      <h1 className="text-lg font-semibold text-gray-900">Quick add</h1>

      {step === "input" && (
        <>
          <p className="text-sm text-gray-500">
            Type it naturally — e.g. &ldquo;2 Heavy Tee to Juan ₱800 GCash&rdquo; or &ldquo;Lalamove ₱180&rdquo;.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-gray-300 p-3 text-sm"
            placeholder="2 Heavy Tee to Juan ₱800 GCash"
          />
          <button
            onClick={handleParse}
            disabled={isPending || !text.trim()}
            className="w-full rounded-xl bg-emerald-600 py-3 font-medium text-white disabled:opacity-50"
          >
            {isPending ? "Reading..." : "Parse"}
          </button>
          {parseResult?.error && <p className="text-sm text-red-600">{parseResult.error}</p>}
          {parseResult?.usedMockProvider && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              Integration not connected: no real AI/OCR provider is configured, so this uses a
              minimal placeholder parser for local development only. See ANTHROPIC_INTEGRATION.md.
            </p>
          )}
        </>
      )}

      {step === "resolving-sale" && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-900">Matching products…</p>
          {saleLines.map((line, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="text-sm text-gray-500">
                &ldquo;{line.productQuery}&rdquo; × {line.quantity}
              </p>
              {line.resolution.status === "MATCHED" && (
                <p className="mt-1 text-sm font-medium text-emerald-700">
                  ✓ Matched: {line.resolution.product.name} — selling ₱
                  {(line.resolution.product.sellingPrice / 100).toFixed(2)}, COGS ₱
                  {(line.resolution.product.unitCogs / 100).toFixed(2)}
                </p>
              )}
              {line.resolution.status === "AMBIGUOUS" && (
                <div className="mt-2">
                  <p className="text-sm text-amber-700">Which product did you mean?</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {line.resolution.candidates.map((c) => (
                      <button
                        key={c.id}
                        onClick={() =>
                          setSaleLines((prev) =>
                            prev.map((l, idx) =>
                              idx === i ? { ...l, resolution: { status: "MATCHED", product: c } } : l
                            )
                          )
                        }
                        className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {line.resolution.status === "NOT_FOUND" && newProductLineIndex !== i && (
                <div className="mt-2">
                  <p className="text-sm text-amber-700">No matching product yet.</p>
                  <button
                    onClick={() => openNewProductForm(i, line)}
                    className="mt-1 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    + Create &ldquo;{line.productQuery}&rdquo; as a product
                  </button>
                </div>
              )}
              {line.resolution.status === "NOT_FOUND" && newProductLineIndex === i && (
                <div className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                  <p className="text-xs font-medium text-gray-700">
                    New product: &ldquo;{line.productQuery}&rdquo;
                  </p>
                  <div>
                    <label className="text-xs text-gray-500">Selling price per unit (₱, required)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      value={newProductPrice}
                      onChange={(e) => setNewProductPrice(e.target.value)}
                      placeholder="0.00"
                      className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">
                      COGS (cost) per unit (₱, optional — leave blank to assume ₱0 profit)
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={newProductCogs}
                      onChange={(e) => setNewProductCogs(e.target.value)}
                      placeholder="0.00"
                      className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                    />
                  </div>
                  {newProductError && <p className="text-xs text-red-600">{newProductError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCreateProduct(line)}
                      disabled={isPending || newProductPrice.trim() === ""}
                      className="flex-1 rounded-lg bg-gray-900 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {isPending ? "Creating..." : "Create product"}
                    </button>
                    <button
                      onClick={closeNewProductForm}
                      className="flex-1 rounded-lg border border-gray-300 py-1.5 text-xs font-medium text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-sm font-medium text-gray-900">Payment</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => setPaymentStatus("PAID")}
                className={`flex-1 rounded-lg py-2 text-sm font-medium ${
                  paymentStatus === "PAID" ? "bg-emerald-600 text-white" : "border border-gray-300 text-gray-700"
                }`}
              >
                Paid now
              </button>
              <button
                onClick={() => setPaymentStatus("UNPAID")}
                className={`flex-1 rounded-lg py-2 text-sm font-medium ${
                  paymentStatus === "UNPAID" ? "bg-amber-600 text-white" : "border border-gray-300 text-gray-700"
                }`}
              >
                Utang (customer owes)
              </button>
            </div>
            {paymentStatus === "UNPAID" && (
              <div className="mt-3">
                <label className="text-xs text-gray-500">Customer name (required)</label>
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Maria Santos"
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                />
                <p className="mt-1 text-xs text-amber-700">
                  This sale won&apos;t add to Spendable Cash until {customerName.trim() || "the customer"} actually
                  pays. It&apos;ll show up on the /utang page as an outstanding balance.
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleConfirmSale}
              disabled={!canConfirmSale || isPending}
              className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isPending ? "Saving..." : paymentStatus === "UNPAID" ? "Confirm Utang Sale" : "Confirm Sale"}
            </button>
            <button onClick={reset} className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700">
              Cancel
            </button>
          </div>
          {!allLinesMatched && (
            <p className="text-xs text-gray-500">
              Every line needs a matched product before this can be confirmed — nothing is guessed.
            </p>
          )}
        </div>
      )}

      {step === "expense-confirm" && parseResult?.draft?.intent === "CREATE_EXPENSE" && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-medium text-gray-900">We understood this as an expense:</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs">
            {JSON.stringify(parseResult.draft, null, 2)}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => handleConfirmExpense(parseResult.draft!)}
              disabled={isPending}
              className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Confirm"}
            </button>
            <button onClick={reset} className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "done" && confirmResult && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className={`text-sm ${confirmResult.persisted ? "text-emerald-700" : "text-amber-700"}`}>
            {confirmResult.persisted ? "✓ " : "⚠ "}
            {confirmResult.message}
          </p>
          <button onClick={reset} className="mt-3 w-full rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700">
            Add another
          </button>
        </div>
      )}
    </main>
  );
}
