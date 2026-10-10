"use server";

import {
  getProducts,
  createProduct,
  restockProduct,
  adjustProductStock,
  updateProduct,
  setProductActive,
  getProductStockHistory,
  type ProductStockHistoryEntry,
} from "@/lib/data/finance";
import { pesosToNonNegativeCentavos, pesosToPositiveCentavos, MoneyError } from "@/lib/money/money";
import { resolveSessionContext } from "@/lib/data/sessionContext";
import type { Product } from "@/lib/finance/types";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function createProductAction(params: {
  name: string;
  sellingPricePesos: string;
  costPricePesos: string;
  initialStock: number;
  reorderThreshold: number;
  sku?: string;
}): Promise<ActionResult> {
  const ctx = await resolveSessionContext();
  if (!ctx.ok) return { ok: false, message: ctx.message };

  if (!params.name.trim()) {
    return { ok: false, message: "Enter a product name." };
  }
  if (!Number.isInteger(params.initialStock) || params.initialStock < 0) {
    return { ok: false, message: "Starting stock must be a whole number, 0 or more." };
  }
  if (!Number.isInteger(params.reorderThreshold) || params.reorderThreshold < 0) {
    return { ok: false, message: "Low-stock threshold must be a whole number, 0 or more." };
  }

  let sellingPrice, cost;
  try {
    sellingPrice = pesosToPositiveCentavos(params.sellingPricePesos, "Selling price");
    cost = pesosToNonNegativeCentavos(params.costPricePesos, "Cost per unit");
  } catch (err) {
    if (err instanceof MoneyError) return { ok: false, message: err.message };
    throw err;
  }

  try {
    await createProduct(ctx.userId, {
      businessId: ctx.businessId,
      name: params.name.trim(),
      sku: params.sku?.trim() || null,
      unitCogsCentavos: cost,
      sellingPriceCentavos: sellingPrice,
      initialStock: params.initialStock,
      reorderThreshold: params.reorderThreshold,
    });
    return { ok: true, message: "Product added." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not add this product." };
  }
}

export async function archiveProductAction(productId: string): Promise<ActionResult> {
  const ctx = await resolveSessionContext();
  if (!ctx.ok) return { ok: false, message: ctx.message };
  try {
    await setProductActive(ctx.userId, { businessId: ctx.businessId, productId, active: false });
    return { ok: true, message: "Product archived. It's hidden from your active list, but its history is kept." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not archive this product." };
  }
}

export async function getInventoryProducts(): Promise<Product[]> {
  const ctx = await resolveSessionContext();
  if (!ctx.ok) return [];
  return getProducts(ctx.userId, ctx.businessId);
}

export async function getInventoryHistory(productId: string): Promise<ProductStockHistoryEntry[]> {
  const ctx = await resolveSessionContext();
  if (!ctx.ok) return [];
  // getProductStockHistory is itself RLS-scoped (withUserContext), and
  // additionally filtered by ctx.businessId here — a productId for another
  // tenant's product simply returns no rows, never another business's data.
  return getProductStockHistory(ctx.userId, ctx.businessId, productId);
}

export async function restockProductAction(params: {
  productId: string;
  quantity: number;
  newCostPesos?: string;
  note?: string;
}): Promise<ActionResult> {
  const ctx = await resolveSessionContext();
  if (!ctx.ok) return { ok: false, message: ctx.message };

  if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
    return { ok: false, message: "Enter how many units you're adding — a whole number greater than 0." };
  }

  let newCost;
  try {
    newCost = params.newCostPesos?.trim() ? pesosToNonNegativeCentavos(params.newCostPesos, "Cost per unit") : undefined;
  } catch (err) {
    if (err instanceof MoneyError) return { ok: false, message: err.message };
    throw err;
  }

  try {
    const result = await restockProduct(ctx.userId, {
      businessId: ctx.businessId,
      productId: params.productId,
      quantity: params.quantity,
      newUnitCogsCentavos: newCost,
      note: params.note?.trim() || undefined,
    });
    return { ok: true, message: `Restocked. New stock: ${result.newStockQty}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not restock this product." };
  }
}

export async function adjustStockAction(params: {
  productId: string;
  newQuantity: number;
  reason: string;
}): Promise<ActionResult> {
  const ctx = await resolveSessionContext();
  if (!ctx.ok) return { ok: false, message: ctx.message };

  if (!Number.isInteger(params.newQuantity) || params.newQuantity < 0) {
    return { ok: false, message: "Enter the actual current stock — a whole number, 0 or more." };
  }
  if (!params.reason.trim()) {
    return { ok: false, message: "Please enter a reason for this adjustment." };
  }

  try {
    const result = await adjustProductStock(ctx.userId, {
      businessId: ctx.businessId,
      productId: params.productId,
      newQuantity: params.newQuantity,
      reason: params.reason.trim(),
    });
    return { ok: true, message: `Stock updated to ${result.newStockQty}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not adjust stock for this product." };
  }
}

export async function updateProductAction(params: {
  productId: string;
  name?: string;
  sku?: string | null;
  sellingPricePesos?: string;
  costPricePesos?: string;
  reorderThreshold?: number;
}): Promise<ActionResult> {
  const ctx = await resolveSessionContext();
  if (!ctx.ok) return { ok: false, message: ctx.message };

  let sellingPrice, cost;
  try {
    sellingPrice = params.sellingPricePesos?.trim()
      ? pesosToPositiveCentavos(params.sellingPricePesos, "Selling price")
      : undefined;
    cost = params.costPricePesos?.trim() ? pesosToNonNegativeCentavos(params.costPricePesos, "Cost per unit") : undefined;
  } catch (err) {
    if (err instanceof MoneyError) return { ok: false, message: err.message };
    throw err;
  }

  if (params.reorderThreshold !== undefined && (!Number.isInteger(params.reorderThreshold) || params.reorderThreshold < 0)) {
    return { ok: false, message: "Low-stock threshold must be a whole number, 0 or more." };
  }

  try {
    await updateProduct(ctx.userId, {
      businessId: ctx.businessId,
      productId: params.productId,
      name: params.name?.trim() || undefined,
      sku: params.sku !== undefined ? params.sku?.trim() || null : undefined,
      sellingPriceCentavos: sellingPrice,
      unitCogsCentavos: cost,
      reorderThreshold: params.reorderThreshold,
    });
    return { ok: true, message: "Product updated." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not update this product." };
  }
}
