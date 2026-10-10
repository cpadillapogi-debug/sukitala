"use server";

import { z } from "zod";
import { getUnpaidReceivablesWithCustomer, recordReceivablePayment, type ReceivableWithCustomer } from "@/lib/data/finance";
import { OverpaymentError, InvalidPaymentAmountError } from "@/lib/finance/receivables";
import { pesosToCentavos, centavosToPesos } from "@/lib/money/money";
import { resolveSessionContext } from "@/lib/data/sessionContext";
import { demoReceivablesWithCustomer } from "@/lib/demo/demoData";

export interface UtangListResult {
  receivables: ReceivableWithCustomer[];
  isDemoData: boolean;
  requiresAuth: boolean;
  message: string | null;
}

export async function getUtangList(): Promise<UtangListResult> {
  const ctx = await resolveSessionContext();
  if (!ctx.ok) {
    return {
      receivables: demoReceivablesWithCustomer,
      isDemoData: true,
      requiresAuth: ctx.requiresAuth ?? false,
      message: ctx.requiresAuth ? null : ctx.message,
    };
  }
  const receivables = await getUnpaidReceivablesWithCustomer(ctx.userId, ctx.businessId);
  return { receivables, isDemoData: false, requiresAuth: false, message: null };
}

export interface RecordPaymentResult {
  ok: boolean;
  message: string;
}

const paymentAmountSchema = z.number().positive();

export async function recordUtangPayment(receivableId: string, amountPesos: number): Promise<RecordPaymentResult> {
  const parsedAmount = paymentAmountSchema.safeParse(amountPesos);
  if (!parsedAmount.success) {
    return { ok: false, message: "Enter a valid positive amount." };
  }
  const ctx = await resolveSessionContext();
  if (!ctx.ok) return { ok: false, message: ctx.message };

  try {
    const result = await recordReceivablePayment(ctx.userId, {
      businessId: ctx.businessId,
      receivableId,
      accountId: ctx.accountId,
      amountCentavos: pesosToCentavos(parsedAmount.data),
    });
    const remainingPesos = centavosToPesos(result.remainingBalance);
    return {
      ok: true,
      message:
        remainingPesos > 0
          ? `Payment recorded. ₱${remainingPesos.toFixed(2)} still remaining (status: ${result.status}).`
          : `Payment recorded. Fully settled.`,
    };
  } catch (err) {
    if (err instanceof OverpaymentError) {
      return { ok: false, message: err.message };
    }
    if (err instanceof InvalidPaymentAmountError) {
      return { ok: false, message: err.message };
    }
    throw err;
  }
}
