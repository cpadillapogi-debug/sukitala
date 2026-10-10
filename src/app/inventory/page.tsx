"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import {
  getInventoryProducts,
  getInventoryHistory,
  restockProductAction,
  adjustStockAction,
  updateProductAction,
  createProductAction,
  archiveProductAction,
} from "./actions";
import type { Product } from "@/lib/finance/types";
import type { ProductStockHistoryEntry } from "@/lib/data/finance";
import { stockStatus, inventoryCostValue, potentialSalesValue, potentialGrossProfit, summarizeInventory } from "@/lib/finance/inventory";
import { formatPHP } from "@/lib/money/money";

type PanelKind = "restock" | "adjust" | "edit" | "history" | null;

// Explicit tri-state so the UI can distinguish "still loading", "the
// request failed", and "loaded successfully but genuinely has 0 rows" —
// three different situations that look the same if you just use `null`.
type HistoryState = { status: "loading" } | { status: "error" } | { status: "loaded"; entries: ProductStockHistoryEntry[] };

export default function InventoryPage() {
  const [productsState, setProductsState] = useState<{ status: "loading" } | { status: "error" } | { status: "loaded"; products: Product[] }>({
    status: "loading",
  });
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelKind>(null);
  const [history, setHistory] = useState<HistoryState>({ status: "loading" });
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmingArchiveId, setConfirmingArchiveId] = useState<string | null>(null);

  // Restock form state
  const [restockQty, setRestockQty] = useState("");
  const [restockCost, setRestockCost] = useState("");
  // Adjust form state
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  // Edit form state
  const [editName, setEditName] = useState("");
  const [editSku, setEditSku] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editThreshold, setEditThreshold] = useState("");
  // New product form state
  const [showNewProductForm, setShowNewProductForm] = useState(false);
  const [newProductError, setNewProductError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCost, setNewCost] = useState("");
  const [newStock, setNewStock] = useState("");
  const [newThreshold, setNewThreshold] = useState("");

  const refresh = useCallback(() => {
    startTransition(async () => {
      try {
        const products = await getInventoryProducts();
        setProductsState({ status: "loaded", products });
      } catch {
        setProductsState({ status: "error" });
      }
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function openPanel(product: Product, kind: PanelKind) {
    setOpenProductId(product.id);
    setPanel(kind);
    setFormError(null);
    setConfirmingArchiveId(null);
    setRestockQty("");
    setRestockCost("");
    setAdjustQty(String(product.stockQty));
    setAdjustReason("");
    setEditName(product.name);
    setEditSku(product.sku ?? "");
    setEditPrice((product.sellingPrice / 100).toFixed(2));
    setEditCost((product.unitCogs / 100).toFixed(2));
    setEditThreshold(String(product.reorderThreshold));
    if (kind === "history") {
      setHistory({ status: "loading" });
      startTransition(async () => {
        try {
          const entries = await getInventoryHistory(product.id);
          setHistory({ status: "loaded", entries });
        } catch {
          setHistory({ status: "error" });
        }
      });
    }
  }

  function closePanel() {
    setOpenProductId(null);
    setPanel(null);
    setFormError(null);
    setConfirmingArchiveId(null);
  }

  function openNewProductForm() {
    setShowNewProductForm(true);
    setNewProductError(null);
    setNewName("");
    setNewPrice("");
    setNewCost("");
    setNewStock("");
    setNewThreshold("5");
  }

  function submitNewProduct() {
    const stock = parseInt(newStock, 10);
    const threshold = parseInt(newThreshold, 10);
    if (!newName.trim()) {
      setNewProductError("Enter a product name.");
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      setNewProductError("Enter a starting stock quantity (0 or more).");
      return;
    }
    startTransition(async () => {
      const result = await createProductAction({
        name: newName.trim(),
        sellingPricePesos: newPrice,
        costPricePesos: newCost || "0",
        initialStock: stock,
        reorderThreshold: Number.isInteger(threshold) && threshold >= 0 ? threshold : 5,
      });
      if (!result.ok) {
        setNewProductError(result.message);
        return;
      }
      setShowNewProductForm(false);
      refresh();
    });
  }

  function submitRestock(product: Product) {
    const qty = parseInt(restockQty, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      setFormError("Enter how many units you're adding.");
      return;
    }
    startTransition(async () => {
      const result = await restockProductAction({
        productId: product.id,
        quantity: qty,
        newCostPesos: restockCost.trim() || undefined,
      });
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      closePanel();
      refresh();
    });
  }

  function submitAdjust(product: Product) {
    const qty = parseInt(adjustQty, 10);
    if (!Number.isInteger(qty) || qty < 0) {
      setFormError("Enter the actual current stock (0 or more).");
      return;
    }
    if (!adjustReason.trim()) {
      setFormError("Please enter a reason for this adjustment.");
      return;
    }
    startTransition(async () => {
      const result = await adjustStockAction({ productId: product.id, newQuantity: qty, reason: adjustReason.trim() });
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      closePanel();
      refresh();
    });
  }

  function submitEdit(product: Product) {
    startTransition(async () => {
      const result = await updateProductAction({
        productId: product.id,
        name: editName.trim() || undefined,
        sku: editSku,
        sellingPricePesos: editPrice.trim() || undefined,
        costPricePesos: editCost.trim() || undefined,
        reorderThreshold: editThreshold.trim() ? parseInt(editThreshold, 10) : undefined,
      });
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      closePanel();
      refresh();
    });
  }

  function submitArchive(product: Product) {
    if (confirmingArchiveId !== product.id) {
      setConfirmingArchiveId(product.id);
      return;
    }
    startTransition(async () => {
      const result = await archiveProductAction(product.id);
      if (!result.ok) {
        setFormError(result.message);
        setConfirmingArchiveId(null);
        return;
      }
      setConfirmingArchiveId(null);
      closePanel();
      refresh();
    });
  }

  if (productsState.status === "loading") {
    return (
      <main className="mx-auto max-w-2xl p-4">
        <p className="text-sm text-gray-500">Loading inventory...</p>
      </main>
    );
  }

  if (productsState.status === "error") {
    return (
      <main className="mx-auto max-w-2xl p-4">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load your inventory right now.
          <button onClick={refresh} className="ml-2 underline">
            Try again
          </button>
        </div>
      </main>
    );
  }

  // getInventoryProducts() (via getProducts()) already filters to active
  // products only — archiving a product removes it from this list
  // entirely rather than requiring a client-side filter here too.
  const products = productsState.products;
  const summary = summarizeInventory(products);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Inventory</h1>
        <button onClick={() => (showNewProductForm ? setShowNewProductForm(false) : openNewProductForm())} className="text-sm text-gray-600 underline">
          {showNewProductForm ? "Cancel" : "+ Add product"}
        </button>
      </div>

      {showNewProductForm && (
        <div className="mb-4 space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <label className="block text-xs text-gray-500">
            Product name
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" placeholder="e.g. T-shirt" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-gray-500">
              Selling price (₱)
              <input type="number" step="0.01" min="0.01" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" placeholder="350.00" />
            </label>
            <label className="block text-xs text-gray-500">
              Cost per unit (₱)
              <input type="number" step="0.01" min="0" value={newCost} onChange={(e) => setNewCost(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" placeholder="180.00" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-gray-500">
              Starting stock
              <input type="number" min="0" value={newStock} onChange={(e) => setNewStock(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" placeholder="12" />
            </label>
            <label className="block text-xs text-gray-500">
              Low-stock alert at
              <input type="number" min="0" value={newThreshold} onChange={(e) => setNewThreshold(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" />
            </label>
          </div>
          {newProductError && <p className="text-xs text-red-600">{newProductError}</p>}
          <button disabled={isPending} onClick={submitNewProduct} className="w-full rounded-lg bg-gray-900 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {isPending ? "Saving..." : "Add product"}
          </button>
        </div>
      )}

      {products.length === 0 && !showNewProductForm ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
          <p className="text-sm text-gray-600">No products yet.</p>
          <button onClick={openNewProductForm} className="mt-2 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white">
            Add your first product
          </button>
        </div>
      ) : products.length > 0 ? (
        <>
          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Money tied up in inventory</h2>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{formatPHP(summary.totalCostValue)}</p>
            <p className="mt-1 text-xs text-gray-500">
              This is the recorded cost of the {products.length} product{products.length === 1 ? "" : "s"} you
              currently have in stock — not cash, and not counted twice against revenue.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500">Potential sales</span>
                <p className="font-medium text-gray-900">{formatPHP(summary.totalPotentialSalesValue)}</p>
              </div>
              <div>
                <span className="text-gray-500">Potential gross profit</span>
                <p className="font-medium text-gray-900">{formatPHP(summary.totalPotentialGrossProfit)}</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              &quot;Potential&quot; means if everything currently in stock sold at today&apos;s listed prices — not
              realized revenue or profit until an actual sale happens.
            </p>
            {(summary.outOfStockCount > 0 || summary.lowStockCount > 0) && (
              <p className="mt-3 text-xs text-amber-700">
                {summary.outOfStockCount > 0 && `${summary.outOfStockCount} out of stock. `}
                {summary.lowStockCount > 0 && `${summary.lowStockCount} running low.`}
              </p>
            )}
          </div>

          <ul className="space-y-3">
            {products.map((product) => {
              const status = stockStatus(product);
              const isOpen = openProductId === product.id;
              return (
                <li key={product.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{product.name}</p>
                      <p className="text-sm text-gray-500">
                        {product.stockQty} in stock
                        {status === "OUT_OF_STOCK" && <span className="ml-2 text-red-600">Out of stock</span>}
                        {status === "LOW_STOCK" && <span className="ml-2 text-amber-600">Low stock</span>}
                      </p>
                    </div>
                    <div className="text-right text-sm text-gray-500">
                      <p>Cost: {formatPHP(product.unitCogs)}</p>
                      <p>Price: {formatPHP(product.sellingPrice)}</p>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-600">
                    <div>
                      <span className="block text-gray-400">Money tied up</span>
                      {formatPHP(inventoryCostValue(product))}
                    </div>
                    <div>
                      <span className="block text-gray-400">Potential sales</span>
                      {formatPHP(potentialSalesValue(product))}
                    </div>
                    <div>
                      <span className="block text-gray-400">Potential profit</span>
                      {formatPHP(potentialGrossProfit(product))}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => (isOpen && panel === "restock" ? closePanel() : openPanel(product, "restock"))} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white">
                      Restock
                    </button>
                    <button onClick={() => (isOpen && panel === "adjust" ? closePanel() : openPanel(product, "adjust"))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700">
                      Adjust stock
                    </button>
                    <button onClick={() => (isOpen && panel === "edit" ? closePanel() : openPanel(product, "edit"))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700">
                      Edit
                    </button>
                    <button onClick={() => (isOpen && panel === "history" ? closePanel() : openPanel(product, "history"))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700">
                      History
                    </button>
                  </div>

                  {isOpen && panel === "restock" && (
                    <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <label className="block text-xs text-gray-500">
                        How many units are you adding?
                        <input type="number" min="1" value={restockQty} onChange={(e) => setRestockQty(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" placeholder="e.g. 20" />
                      </label>
                      <label className="block text-xs text-gray-500">
                        New cost per unit (₱, optional — leave blank to keep {formatPHP(product.unitCogs)})
                        <input type="number" step="0.01" min="0" value={restockCost} onChange={(e) => setRestockCost(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" placeholder="0.00" />
                      </label>
                      {formError && <p className="text-xs text-red-600">{formError}</p>}
                      <button disabled={isPending} onClick={() => submitRestock(product)} className="w-full rounded-lg bg-gray-900 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                        {isPending ? "Saving..." : "Save restock"}
                      </button>
                    </div>
                  )}

                  {isOpen && panel === "adjust" && (
                    <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <label className="block text-xs text-gray-500">
                        Actual current stock
                        <input type="number" min="0" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" />
                      </label>
                      <label className="block text-xs text-gray-500">
                        Reason (required)
                        <input type="text" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" placeholder="e.g. Physical count, damaged item" />
                      </label>
                      {formError && <p className="text-xs text-red-600">{formError}</p>}
                      <button disabled={isPending} onClick={() => submitAdjust(product)} className="w-full rounded-lg bg-gray-900 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                        {isPending ? "Saving..." : "Save adjustment"}
                      </button>
                    </div>
                  )}

                  {isOpen && panel === "edit" && (
                    <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <label className="block text-xs text-gray-500">
                        Product name
                        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" />
                      </label>
                      <label className="block text-xs text-gray-500">
                        SKU / reference (optional)
                        <input type="text" value={editSku} onChange={(e) => setEditSku(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" placeholder="e.g. TSHIRT-BLK-M" />
                      </label>
                      <label className="block text-xs text-gray-500">
                        Selling price (₱)
                        <input type="number" step="0.01" min="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" />
                      </label>
                      <label className="block text-xs text-gray-500">
                        Cost per unit (₱)
                        <input type="number" step="0.01" min="0" value={editCost} onChange={(e) => setEditCost(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" />
                      </label>
                      <label className="block text-xs text-gray-500">
                        Low-stock threshold
                        <input type="number" min="0" value={editThreshold} onChange={(e) => setEditThreshold(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" />
                      </label>
                      {formError && <p className="text-xs text-red-600">{formError}</p>}
                      <button disabled={isPending} onClick={() => submitEdit(product)} className="w-full rounded-lg bg-gray-900 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                        {isPending ? "Saving..." : "Save changes"}
                      </button>
                      <button
                        disabled={isPending}
                        onClick={() => submitArchive(product)}
                        className={`w-full rounded-lg border py-1.5 text-xs font-medium disabled:opacity-50 ${
                          confirmingArchiveId === product.id
                            ? "border-red-600 bg-red-600 text-white"
                            : "border-red-300 text-red-700"
                        }`}
                      >
                        {confirmingArchiveId === product.id ? "Tap again to confirm archiving" : "Archive this product"}
                      </button>
                      <p className="text-center text-[11px] text-gray-400">
                        Hides it from your active list. Its sales and stock history are kept.
                      </p>
                    </div>
                  )}

                  {isOpen && panel === "history" && (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      {history.status === "loading" && <p className="text-xs text-gray-500">Loading history...</p>}
                      {history.status === "error" && (
                        <p className="text-xs text-red-600">
                          Could not load history right now.{" "}
                          <button onClick={() => openPanel(product, "history")} className="underline">
                            Try again
                          </button>
                        </p>
                      )}
                      {history.status === "loaded" && history.entries.length === 0 && (
                        <p className="text-xs text-gray-500">No stock changes recorded yet.</p>
                      )}
                      {history.status === "loaded" && history.entries.length > 0 && (
                        <ul className="space-y-2 text-xs">
                          {history.entries.map((entry) => (
                            <li key={entry.id} className="flex justify-between border-b border-gray-200 pb-1 last:border-0">
                              <span>
                                {entry.changeQty > 0 ? "+" : ""}
                                {entry.changeQty} —{" "}
                                {entry.reason === "RESTOCK" ? "Restock" : entry.reason === "SALE" ? "Sale" : "Manual adjustment"}
                                {entry.note ? ` (${entry.note})` : ""}
                              </span>
                              <span className="text-gray-400">{new Date(entry.createdAt).toLocaleDateString()}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </main>
  );
}
