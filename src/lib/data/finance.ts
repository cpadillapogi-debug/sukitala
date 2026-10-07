import type { PoolClient } from "pg";
import { withUserContext } from "./db";
import { centavos, assertPositiveCentavos, type Centavos } from "../money/money";
import type {
  CashAccount,
  LedgerEntry,
  CommittedObligation,
  Receivable,
  Order,
  Expense,
  Product,
} from "../finance/types";
import { resolveProduct, type ProductResolution } from "../finance/productResolution";
import { applyReceivablePayment, OverpaymentError } from "../finance/receivables";

export { OverpaymentError };

/**
 * Real data-access layer, backed by Postgres/Supabase. Every function here
 * requires a userId and a businessId; RLS (see db/migrations/) is the actual
 * enforcement of "this user may only see this business's rows" — these
 * functions do not additionally filter by business_id in application code,
 * specifically so a bug here can't accidentally leak data that RLS would
 * have blocked. If RLS is ever misconfigured, these queries fail closed
 * (return nothing), not open.
 */

function toCentavos(value: string | number): Centavos {
  // node-pg returns bigint columns as strings by default to avoid silent
  // precision loss; parse explicitly rather than letting JS coerce it.
  return centavos(typeof value === "string" ? parseInt(value, 10) : value);
}

/**
 * Resolves the business(es) a real authenticated user belongs to, via the
 * `memberships` table. This is the actual replacement for the old
 * KIRACASH_DEV_BUSINESS_ID env var — a real user's business is derived from
 * their own membership rows, never trusted from client input, and RLS
 * itself enforces that a user can only ever see their own membership rows
 * (see db/migrations/0001_core.sql, "member can view own memberships").
 *
 * Returns the first membership if multiple exist — this scaffold has no
 * multi-business-per-user UI yet (business switcher), so "first" is a
 * documented simplification, not a security issue: RLS still prevents
 * seeing any business the user isn't a member of, regardless of which one
 * gets picked here.
 */
export async function getPrimaryBusinessIdForUser(userId: string): Promise<string | null> {
  return withUserContext(userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select business_id from memberships where user_id = $1 order by created_at limit 1`,
      [userId]
    );
    return rows[0]?.business_id ?? null;
  });
}

export async function getCashAccounts(userId: string, businessId: string): Promise<CashAccount[]> {
  return withUserContext(userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select id, business_id, type, name, opening_balance_centavos
       from accounts where business_id = $1 order by created_at`,
      [businessId]
    );
    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      type: r.type,
      name: r.name,
      openingBalance: toCentavos(r.opening_balance_centavos),
    }));
  });
}

export async function getLedgerEntries(userId: string, businessId: string): Promise<LedgerEntry[]> {
  return withUserContext(userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select id, business_id, type, account_id, amount_centavos, effective_at,
              created_at, created_by, source_document_id, reversal_of_id, note
       from ledger_entries where business_id = $1 order by effective_at`,
      [businessId]
    );
    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      type: r.type,
      accountId: r.account_id,
      amount: toCentavos(r.amount_centavos),
      effectiveAt: r.effective_at.toISOString(),
      createdAt: r.created_at.toISOString(),
      createdBy: r.created_by,
      sourceDocumentId: r.source_document_id,
      reversalOfId: r.reversal_of_id,
      note: r.note,
    }));
  });
}

export async function getUnpaidReceivables(userId: string, businessId: string): Promise<Receivable[]> {
  return withUserContext(userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select id, business_id, customer_id, order_id, total_owed_centavos,
              amount_paid_centavos, due_date, status
       from receivables where business_id = $1 and status != 'SETTLED'
       order by due_date nulls last`,
      [businessId]
    );
    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      customerId: r.customer_id,
      orderId: r.order_id,
      totalOwed: toCentavos(r.total_owed_centavos),
      amountPaid: toCentavos(r.amount_paid_centavos),
      dueDate: r.due_date ? r.due_date.toISOString() : null,
      status: r.status,
    }));
  });
}

export interface ReceivableWithCustomer extends Receivable {
  customerName: string;
}

/**
 * Same rows as getUnpaidReceivables, joined with the customer's name — for
 * the /utang UI, which needs to show "who owes what" rather than an opaque
 * customer_id. Kept as a separate query rather than changing the Receivable
 * type everywhere, since the pure engine functions in finance/receivables.ts
 * only need the amounts, not display data.
 */
export async function getUnpaidReceivablesWithCustomer(
  userId: string,
  businessId: string
): Promise<ReceivableWithCustomer[]> {
  return withUserContext(userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select r.id, r.business_id, r.customer_id, r.order_id, r.total_owed_centavos,
              r.amount_paid_centavos, r.due_date, r.status, c.name as customer_name
       from receivables r
       join customers c on c.id = r.customer_id
       where r.business_id = $1 and r.status != 'SETTLED'
       order by r.due_date nulls last, r.created_at`,
      [businessId]
    );
    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      customerId: r.customer_id,
      orderId: r.order_id,
      totalOwed: toCentavos(r.total_owed_centavos),
      amountPaid: toCentavos(r.amount_paid_centavos),
      dueDate: r.due_date ? r.due_date.toISOString() : null,
      status: r.status,
      customerName: r.customer_name,
    }));
  });
}

/**
 * Appends a new ledger entry. Insert-only, matching the append-only schema —
 * there is deliberately no updateLedgerEntry/deleteLedgerEntry export.
 * Corrections must call this again with type='REVERSAL' and reversalOfId set.
 */
export async function appendLedgerEntry(
  userId: string,
  entry: Omit<LedgerEntry, "id" | "createdAt">
): Promise<LedgerEntry> {
  return withUserContext(userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `insert into ledger_entries
         (business_id, type, account_id, amount_centavos, effective_at, created_by,
          source_document_id, reversal_of_id, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id, created_at`,
      [
        entry.businessId,
        entry.type,
        entry.accountId,
        entry.amount,
        entry.effectiveAt,
        entry.createdBy,
        entry.sourceDocumentId,
        entry.reversalOfId,
        entry.note,
      ]
    );
    return { ...entry, id: rows[0].id, createdAt: rows[0].created_at.toISOString() };
  });
}

// Committed obligations aren't in the schema as their own table yet in this
// scaffold (see KIRACASH_IMPLEMENTATION_PLAN.md) — returns [] until added.
export async function getCommittedObligations(
  _userId: string,
  _businessId: string
): Promise<CommittedObligation[]> {
  return [];
}

export interface GetOrdersOptions {
  since?: Date;
}

export async function getOrders(
  userId: string,
  businessId: string,
  options: GetOrdersOptions = {}
): Promise<Order[]> {
  return withUserContext(userId, async (client: PoolClient) => {
    const { rows: orderRows } = await client.query(
      `select id, business_id, customer_id, channel, payment_status, payment_method,
              pending_marketplace_settlement, created_at
       from orders
       where business_id = $1 and ($2::timestamptz is null or created_at >= $2)
       order by created_at`,
      [businessId, options.since ?? null]
    );
    if (orderRows.length === 0) return [];

    const { rows: itemRows } = await client.query(
      `select order_id, product_id, quantity, unit_price_centavos, unit_cogs_centavos
       from order_items where order_id = any($1::uuid[])`,
      [orderRows.map((r) => r.id)]
    );

    return orderRows.map((o) => ({
      id: o.id,
      businessId: o.business_id,
      customerId: o.customer_id,
      channel: o.channel,
      paymentStatus: o.payment_status,
      paymentMethod: o.payment_method,
      createdAt: o.created_at.toISOString(),
      pendingMarketplaceSettlement: o.pending_marketplace_settlement,
      items: itemRows
        .filter((i) => i.order_id === o.id)
        .map((i) => ({
          productId: i.product_id,
          quantity: i.quantity,
          unitPrice: toCentavos(i.unit_price_centavos),
          unitCogs: toCentavos(i.unit_cogs_centavos),
        })),
    }));
  });
}

export async function getExpenses(
  userId: string,
  businessId: string,
  options: GetOrdersOptions = {}
): Promise<Expense[]> {
  return withUserContext(userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select id, business_id, category, amount_centavos, account_id, created_at
       from expenses
       where business_id = $1 and ($2::timestamptz is null or created_at >= $2)
       order by created_at`,
      [businessId, options.since ?? null]
    );
    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      category: r.category,
      amount: toCentavos(r.amount_centavos),
      accountId: r.account_id,
      createdAt: r.created_at.toISOString(),
    }));
  });
}

export async function getProducts(userId: string, businessId: string): Promise<Product[]> {
  // Filters to active = true: this list feeds product resolution and quick-
  // sale flows, which should never match/sell a deactivated product. A
  // future "manage all products, including inactive" screen (Phase 3 —
  // Product Management) will need a separate query that doesn't filter this
  // way; this one intentionally stays narrow to its current callers.
  return withUserContext(userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select id, business_id, name, sku, unit_cogs_centavos, selling_price_centavos,
              stock_qty, reorder_threshold, active
       from products where business_id = $1 and active = true order by name`,
      [businessId]
    );
    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      name: r.name,
      sku: r.sku,
      unitCogs: toCentavos(r.unit_cogs_centavos),
      sellingPrice: toCentavos(r.selling_price_centavos),
      stockQty: r.stock_qty,
      reorderThreshold: r.reorder_threshold,
      active: r.active,
    }));
  });
}

export async function createProduct(
  userId: string,
  params: {
    businessId: string;
    name: string;
    sku: string | null;
    unitCogsCentavos: Centavos;
    sellingPriceCentavos: Centavos;
    initialStock: number;
    reorderThreshold: number;
  }
): Promise<Product> {
  return withUserContext(userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `insert into products
         (business_id, name, sku, unit_cogs_centavos, selling_price_centavos, stock_qty, reorder_threshold)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        params.businessId,
        params.name,
        params.sku,
        params.unitCogsCentavos,
        params.sellingPriceCentavos,
        params.initialStock,
        params.reorderThreshold,
      ]
    );
    return {
      id: rows[0].id,
      businessId: params.businessId,
      name: params.name,
      sku: params.sku,
      unitCogs: params.unitCogsCentavos,
      sellingPrice: params.sellingPriceCentavos,
      stockQty: params.initialStock,
      reorderThreshold: params.reorderThreshold,
      active: true,
    };
  });
}

/**
 * Adds stock to a product (a restock/reorder), optionally updating its
 * recorded unit cost at the same time (the price actually paid this time
 * may differ from before). Writes a matching product_stock_history row —
 * never silently mutates stock_qty.
 */
export async function restockProduct(
  userId: string,
  params: { businessId: string; productId: string; quantity: number; newUnitCogsCentavos?: Centavos; note?: string }
): Promise<{ newStockQty: number }> {
  if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
    throw new Error(`Restock quantity must be a positive whole number, got ${params.quantity}.`);
  }
  return withUserContext(userId, async (client: PoolClient) => {
    await client.query("begin");
    try {
      const { rows } = await client.query(
        `select stock_qty from products where id = $1 and business_id = $2 for update`,
        [params.productId, params.businessId]
      );
      if (rows.length === 0) {
        throw new Error(`Product ${params.productId} not found (or not visible to this business).`);
      }
      const previousQty = rows[0].stock_qty;
      const newQty = previousQty + params.quantity;

      if (params.newUnitCogsCentavos != null) {
        await client.query(`update products set stock_qty = $1, unit_cogs_centavos = $2 where id = $3`, [
          newQty,
          params.newUnitCogsCentavos,
          params.productId,
        ]);
      } else {
        await client.query(`update products set stock_qty = $1 where id = $2`, [newQty, params.productId]);
      }

      await client.query(
        `insert into product_stock_history
           (business_id, product_id, change_qty, previous_qty, new_qty, reason, note, created_by)
         values ($1, $2, $3, $4, $5, 'RESTOCK', $6, $7)`,
        [params.businessId, params.productId, params.quantity, previousQty, newQty, params.note ?? null, userId]
      );

      await client.query("commit");
      return { newStockQty: newQty };
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });
}

/**
 * Sets a product's stock to an exact new count (a physical recount, a
 * correction, shrinkage/damage, etc.) — never a silent change. A reason is
 * required so the history entry is actually meaningful, not just a number.
 */
export async function adjustProductStock(
  userId: string,
  params: { businessId: string; productId: string; newQuantity: number; reason: string }
): Promise<{ newStockQty: number }> {
  if (!Number.isInteger(params.newQuantity) || params.newQuantity < 0) {
    throw new Error(`Adjusted stock must be a non-negative whole number, got ${params.newQuantity}.`);
  }
  if (!params.reason.trim()) {
    throw new Error("A reason is required to adjust stock.");
  }
  return withUserContext(userId, async (client: PoolClient) => {
    await client.query("begin");
    try {
      const { rows } = await client.query(
        `select stock_qty from products where id = $1 and business_id = $2 for update`,
        [params.productId, params.businessId]
      );
      if (rows.length === 0) {
        throw new Error(`Product ${params.productId} not found (or not visible to this business).`);
      }
      const previousQty = rows[0].stock_qty;
      const changeQty = params.newQuantity - previousQty;

      await client.query(`update products set stock_qty = $1 where id = $2`, [params.newQuantity, params.productId]);

      if (changeQty !== 0) {
        await client.query(
          `insert into product_stock_history
             (business_id, product_id, change_qty, previous_qty, new_qty, reason, note, created_by)
           values ($1, $2, $3, $4, $5, 'ADJUSTMENT', $6, $7)`,
          [params.businessId, params.productId, changeQty, previousQty, params.newQuantity, params.reason, userId]
        );
      }

      await client.query("commit");
      return { newStockQty: params.newQuantity };
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });
}

/** Edits a product's own fields (name/price/cost/reorder threshold/SKU) — never touches stock_qty; use restockProduct/adjustProductStock for that. */
export async function updateProduct(
  userId: string,
  params: {
    businessId: string;
    productId: string;
    name?: string;
    sku?: string | null;
    unitCogsCentavos?: Centavos;
    sellingPriceCentavos?: Centavos;
    reorderThreshold?: number;
  }
): Promise<void> {
  return withUserContext(userId, async (client: PoolClient) => {
    const { rows } = await client.query(`select id from products where id = $1 and business_id = $2`, [
      params.productId,
      params.businessId,
    ]);
    if (rows.length === 0) {
      throw new Error(`Product ${params.productId} not found (or not visible to this business).`);
    }
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (params.name !== undefined) {
      sets.push(`name = $${i++}`);
      values.push(params.name);
    }
    if (params.sku !== undefined) {
      sets.push(`sku = $${i++}`);
      values.push(params.sku);
    }
    if (params.unitCogsCentavos !== undefined) {
      sets.push(`unit_cogs_centavos = $${i++}`);
      values.push(params.unitCogsCentavos);
    }
    if (params.sellingPriceCentavos !== undefined) {
      sets.push(`selling_price_centavos = $${i++}`);
      values.push(params.sellingPriceCentavos);
    }
    if (params.reorderThreshold !== undefined) {
      sets.push(`reorder_threshold = $${i++}`);
      values.push(params.reorderThreshold);
    }
    if (sets.length === 0) return;
    values.push(params.productId);
    await client.query(`update products set ${sets.join(", ")} where id = $${i}`, values);
  });
}

/**
 * Archives (or restores) a product without deleting it — its sales
 * history, order_items, and product_stock_history all reference this row,
 * so a real delete would either cascade away real transaction history or
 * be blocked by the FK. Archiving keeps everything, just hides it from
 * the active product list.
 */
export async function setProductActive(
  userId: string,
  params: { businessId: string; productId: string; active: boolean }
): Promise<void> {
  return withUserContext(userId, async (client: PoolClient) => {
    const { rows } = await client.query(`select id from products where id = $1 and business_id = $2`, [
      params.productId,
      params.businessId,
    ]);
    if (rows.length === 0) {
      throw new Error(`Product ${params.productId} not found (or not visible to this business).`);
    }
    await client.query(`update products set active = $1 where id = $2`, [params.active, params.productId]);
  });
}

export interface ProductStockHistoryEntry {
  id: string;
  productId: string;
  changeQty: number;
  previousQty: number;
  newQty: number;
  reason: "RESTOCK" | "SALE" | "ADJUSTMENT";
  note: string | null;
  createdAt: string;
}

export async function getProductStockHistory(
  userId: string,
  businessId: string,
  productId: string
): Promise<ProductStockHistoryEntry[]> {
  return withUserContext(userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select id, product_id, change_qty, previous_qty, new_qty, reason, note, created_at
       from product_stock_history
       where business_id = $1 and product_id = $2
       order by created_at desc`,
      [businessId, productId]
    );
    return rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      changeQty: r.change_qty,
      previousQty: r.previous_qty,
      newQty: r.new_qty,
      reason: r.reason,
      note: r.note,
      createdAt: r.created_at.toISOString(),
    }));
  });
}

/**
 * Resolves a free-text product query against this business's real products.
 * Thin wrapper around the pure resolveProduct() so callers (server actions)
 * don't need to fetch the product list themselves.
 */
export async function resolveProductForBusiness(
  userId: string,
  businessId: string,
  query: string
): Promise<ProductResolution> {
  const products = await getProducts(userId, businessId);
  return resolveProduct(query, products);
}

export class InsufficientStockError extends Error {
  constructor(
    public readonly productName: string,
    public readonly available: number,
    public readonly requested: number
  ) {
    super(`Insufficient stock for "${productName}": ${available} available, ${requested} requested.`);
  }
}

export interface SaleLineItem {
  productId: string;
  quantity: number;
}

/**
 * Finds an existing customer by exact case-insensitive name match, or
 * creates one. Runs on the given transactional client — NOT its own
 * withUserContext call — so it participates in the caller's transaction
 * (recordSale needs customer creation and receivable creation to succeed or
 * roll back together with the order/order_items/stock changes).
 *
 * SIMPLIFICATION, documented rather than hidden: exact-name matching only,
 * same as the "never guess" philosophy in productResolution.ts but without
 * that module's fuzzy-match/ambiguity UI — two customers named "Juan" become
 * one record. Acceptable for a solo micro-seller's contact list at this
 * stage; a real customer-resolution flow (phone number matching, etc.) is
 * future work, not built here.
 */
async function findOrCreateCustomerByName(
  client: PoolClient,
  businessId: string,
  name: string
): Promise<string> {
  const trimmed = name.trim();
  const { rows: existing } = await client.query(
    `select id from customers where business_id = $1 and lower(name) = lower($2) limit 1`,
    [businessId, trimmed]
  );
  if (existing.length > 0) return existing[0].id;

  const { rows: created } = await client.query(
    `insert into customers (business_id, name) values ($1, $2) returning id`,
    [businessId, trimmed]
  );
  return created[0].id;
}

/**
 * Records a real sale: locks each product row, verifies stock, creates the
 * order + order_items (with unitPrice/unitCogs snapshotted from the
 * product's CURRENT price at sale time — so later price changes don't
 * retroactively alter historical revenue/COGS), decrements stock, and
 * either:
 *   - PAID: appends a ledger entry for the cash effect (Spendable Cash
 *     increases immediately), or
 *   - UNPAID: creates NO ledger entry (cash hasn't moved) and instead
 *     creates a `receivables` row for `customerName` — this is the utang
 *     fix. Revenue/COGS are still real (order_items exist either way);
 *     only the cash side differs. `customerName` is REQUIRED for UNPAID
 *     sales — there is no such thing as anonymous utang, and this function
 *     refuses to guess who owes the money.
 *
 * All in one transaction — either everything commits or nothing does.
 * Overselling is rejected by default (InsufficientStockError); there is no
 * "allow overselling" flag in the schema yet.
 */
export async function recordSale(
  userId: string,
  params: {
    businessId: string;
    accountId: string;
    items: SaleLineItem[];
    channel: string;
    paymentStatus: "PAID" | "UNPAID";
    customerName?: string; // required when paymentStatus === "UNPAID"
    dueDate?: string | null; // ISO date, only meaningful for UNPAID
  }
): Promise<{
  orderId: string;
  ledgerEntryId: string | null;
  receivableId: string | null;
  totalRevenue: Centavos;
  totalCogs: Centavos;
}> {
  if (params.items.length === 0) {
    throw new Error("recordSale requires at least one line item.");
  }
  if (params.paymentStatus === "UNPAID" && !params.customerName?.trim()) {
    throw new Error(
      "customerName is required for an UNPAID (utang) sale — recordSale will not create an untraceable debt."
    );
  }
  return withUserContext(userId, async (client: PoolClient) => {
    await client.query("begin");
    try {
      // Lock the involved product rows so two concurrent sales can't both
      // read stale stock and both succeed when only one should.
      const { rows: lockedProducts } = await client.query(
        `select id, name, unit_cogs_centavos, selling_price_centavos, stock_qty
         from products where id = any($1::uuid[]) for update`,
        [params.items.map((i) => i.productId)]
      );
      const productById = new Map(lockedProducts.map((p) => [p.id, p]));

      let totalRevenue = 0;
      let totalCogs = 0;
      const lineData: { productId: string; quantity: number; unitPrice: number; unitCogs: number }[] = [];

      for (const item of params.items) {
        const product = productById.get(item.productId);
        if (!product) {
          throw new Error(`Product ${item.productId} not found (or not visible to this business).`);
        }
        if (product.stock_qty < item.quantity) {
          throw new InsufficientStockError(product.name, product.stock_qty, item.quantity);
        }
        const unitPrice = parseInt(product.selling_price_centavos, 10);
        const unitCogs = parseInt(product.unit_cogs_centavos, 10);
        totalRevenue += unitPrice * item.quantity;
        totalCogs += unitCogs * item.quantity;
        lineData.push({ productId: item.productId, quantity: item.quantity, unitPrice, unitCogs });
      }

      let customerId: string | null = null;
      if (params.paymentStatus === "UNPAID") {
        customerId = await findOrCreateCustomerByName(client, params.businessId, params.customerName!);
      }

      const { rows: orderRows } = await client.query(
        `insert into orders (business_id, customer_id, channel, payment_status, payment_method)
         values ($1, $2, $3, $4, (select type from accounts where id = $5))
         returning id`,
        [params.businessId, customerId, params.channel, params.paymentStatus, params.accountId]
      );
      const orderId = orderRows[0].id;

      // Track running stock per product locally (not just from the initial
      // lock read) so this stays correct even if the same product appears
      // in more than one line item within a single sale.
      const runningStock = new Map<string, number>();
      for (const line of lineData) {
        await client.query(
          `insert into order_items (order_id, product_id, quantity, unit_price_centavos, unit_cogs_centavos)
           values ($1, $2, $3, $4, $5)`,
          [orderId, line.productId, line.quantity, line.unitPrice, line.unitCogs]
        );
        const previousQty = runningStock.get(line.productId) ?? productById.get(line.productId)!.stock_qty;
        const newQty = previousQty - line.quantity;
        runningStock.set(line.productId, newQty);
        await client.query(`update products set stock_qty = stock_qty - $1 where id = $2`, [
          line.quantity,
          line.productId,
        ]);
        await client.query(
          `insert into product_stock_history
             (business_id, product_id, change_qty, previous_qty, new_qty, reason, note, created_by)
           values ($1, $2, $3, $4, $5, 'SALE', $6, $7)`,
          [params.businessId, line.productId, -line.quantity, previousQty, newQty, `Sale (order ${orderId})`, userId]
        );
      }

      let ledgerEntryId: string | null = null;
      let receivableId: string | null = null;

      if (params.paymentStatus === "PAID") {
        const { rows: ledgerRows } = await client.query(
          `insert into ledger_entries
             (business_id, type, account_id, amount_centavos, created_by, note)
           values ($1, 'SALE_CASH_IN', $2, $3, $4, $5)
           returning id`,
          [params.businessId, params.accountId, totalRevenue, userId, `Sale (order ${orderId})`]
        );
        ledgerEntryId = ledgerRows[0].id;
      } else {
        // UNPAID: no ledger entry (cash hasn't moved) — instead, a
        // receivable so this debt is tracked, not silently dropped.
        const { rows: receivableRows } = await client.query(
          `insert into receivables
             (business_id, customer_id, order_id, total_owed_centavos, amount_paid_centavos, due_date, status)
           values ($1, $2, $3, $4, 0, $5, 'UNPAID')
           returning id`,
          [params.businessId, customerId, orderId, totalRevenue, params.dueDate ?? null]
        );
        receivableId = receivableRows[0].id;
      }

      await client.query("commit");
      return {
        orderId,
        ledgerEntryId,
        receivableId,
        totalRevenue: centavos(totalRevenue),
        totalCogs: centavos(totalCogs),
      };
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });
}

/**
 * Records a payment against an existing receivable: increases the chosen
 * cash account (real ledger entry, type RECEIVABLE_PAYMENT), reduces the
 * receivable's remaining balance, and updates its status — all
 * transactionally. Overpayment is rejected (OverpaymentError), matching the
 * pure applyReceivablePayment() semantics in finance/receivables.ts, which
 * this function delegates the actual arithmetic/validation to rather than
 * re-implementing it in SQL.
 */
export async function recordReceivablePayment(
  userId: string,
  params: { businessId: string; receivableId: string; accountId: string; amountCentavos: Centavos; note?: string }
): Promise<{ ledgerEntryId: string; receivablePaymentId: string; remainingBalance: Centavos; status: string }> {
  return withUserContext(userId, async (client: PoolClient) => {
    await client.query("begin");
    try {
      const { rows: existingRows } = await client.query(
        `select id, business_id, customer_id, order_id, total_owed_centavos, amount_paid_centavos, due_date, status
         from receivables where id = $1 for update`,
        [params.receivableId]
      );
      if (existingRows.length === 0) {
        throw new Error(`Receivable ${params.receivableId} not found (or not visible to this business).`);
      }
      const row = existingRows[0];

      // Defense-in-depth (security-audit finding, Risk B): the ledger
      // insert below uses params.businessId, not row.business_id. Under
      // the CURRENT 1:1 user-to-business membership model these can never
      // actually differ — RLS on the SELECT above only returns rows where
      // is_business_member(receivables.business_id) is true for this
      // userId, and a user currently has exactly one membership, so
      // row.business_id must equal params.businessId whenever a row is
      // returned at all. This assertion costs nothing and fails loudly
      // the moment that assumption is ever weakened (e.g. multi-business
      // staff membership, Phase 3 of the roadmap) instead of silently
      // attributing a ledger entry to the wrong tenant.
      if (row.business_id !== params.businessId) {
        throw new Error(
          `Receivable ${params.receivableId} belongs to business ${row.business_id}, not the ` +
            `requested business ${params.businessId}. Refusing to record this payment.`
        );
      }

      const currentReceivable: Receivable = {
        id: row.id,
        businessId: row.business_id,
        customerId: row.customer_id,
        orderId: row.order_id,
        totalOwed: centavos(parseInt(row.total_owed_centavos, 10)),
        amountPaid: centavos(parseInt(row.amount_paid_centavos, 10)),
        dueDate: row.due_date ? row.due_date.toISOString() : null,
        status: row.status,
      };

      // Delegates to the pure, unit-tested function — throws OverpaymentError
      // on overpay, which propagates out and rolls back this transaction.
      const updated = applyReceivablePayment(currentReceivable, params.amountCentavos);

      const { rows: ledgerRows } = await client.query(
        `insert into ledger_entries
           (business_id, type, account_id, amount_centavos, created_by, note)
         values ($1, 'RECEIVABLE_PAYMENT', $2, $3, $4, $5)
         returning id`,
        [
          params.businessId,
          params.accountId,
          params.amountCentavos,
          userId,
          params.note ?? `Utang payment (receivable ${params.receivableId})`,
        ]
      );

      const { rows: paymentRows } = await client.query(
        `insert into receivable_payments (receivable_id, amount_centavos, ledger_entry_id, created_by)
         values ($1, $2, $3, $4)
         returning id`,
        [params.receivableId, params.amountCentavos, ledgerRows[0].id, userId]
      );

      await client.query(
        `update receivables set amount_paid_centavos = $1, status = $2 where id = $3`,
        [updated.amountPaid, updated.status, params.receivableId]
      );

      await client.query("commit");
      return {
        ledgerEntryId: ledgerRows[0].id,
        receivablePaymentId: paymentRows[0].id,
        remainingBalance: subtractCentavos(updated.totalOwed, updated.amountPaid),
        status: updated.status,
      };
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });
}

function subtractCentavos(a: Centavos, b: Centavos): Centavos {
  return centavos(a - b);
}

export async function recordQuickExpense(
  userId: string,
  params: { businessId: string; accountId: string; amountCentavos: Centavos; category: string; note: string }
): Promise<{ expenseId: string; ledgerEntryId: string }> {
  // Defense-in-depth: the schema layer (moneyAmountSchema in
  // src/lib/ai/schema.ts) should already guarantee a positive amount, but
  // this function's own logic below assumes it unconditionally when
  // negating for the ledger — so assert it again here rather than trust
  // every future caller to have gone through that schema.
  assertPositiveCentavos(params.amountCentavos, "Expense amount");
  return withUserContext(userId, async (client: PoolClient) => {
    await client.query("begin");
    try {
      const { rows: expenseRows } = await client.query(
        `insert into expenses (business_id, category, amount_centavos, account_id)
         values ($1, $2, $3, $4) returning id`,
        [params.businessId, params.category, params.amountCentavos, params.accountId]
      );
      // Expenses reduce cash, so the ledger amount is negative even though
      // the expense row itself stores a positive magnitude.
      const negativeAmount = centavos(-params.amountCentavos);
      const { rows: ledgerRows } = await client.query(
        `insert into ledger_entries
           (business_id, type, account_id, amount_centavos, created_by, note)
         values ($1, 'EXPENSE', $2, $3, $4, $5)
         returning id`,
        [params.businessId, params.accountId, negativeAmount, userId, params.note]
      );
      await client.query("commit");
      return { expenseId: expenseRows[0].id, ledgerEntryId: ledgerRows[0].id };
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });
}
