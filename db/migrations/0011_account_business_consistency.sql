-- Defense-in-depth fix — data-integrity risk identified during the
-- security audit, NOT currently exploitable for financial corruption
-- through any existing app code path (getLedgerEntries/getCashAccounts
-- are always scoped to the caller's own business_id, so a mismatched
-- account_id becomes an orphan no balance calculation ever reads), but
-- LIVE-REPRODUCED as a real write that should never have been allowed:
--
--   -- as a genuine member of Business A (no fake membership needed):
--   insert into ledger_entries (business_id, type, account_id, ...)
--   values ('<business A>', 'ADJUSTMENT', '<a real account belonging to
--            Business B>', ...);
--   -- succeeded. RLS only checked that the caller is a member of
--   -- business_id (A); nothing checked that account_id actually
--   -- belongs to that same business.
--
-- Both ledger_entries.account_id and expenses.account_id have this shape
-- (nullable FK to accounts, no business-consistency check). A CHECK
-- constraint can't reference another table in Postgres, so this uses a
-- BEFORE INSERT trigger on each. UPDATE is intentionally not covered on
-- ledger_entries — prevent_ledger_mutation() already unconditionally
-- rejects every UPDATE on that table, so an account_id mismatch could
-- never be introduced via UPDATE there. expenses IS updatable and has no
-- such blanket trigger, so it gets both INSERT and UPDATE coverage.
create function account_matches_business() returns trigger
language plpgsql as $$
begin
  if NEW.account_id is not null and not exists (
    select 1 from accounts where accounts.id = NEW.account_id and accounts.business_id = NEW.business_id
  ) then
    raise exception 'account_id % does not belong to business_id % (cross-tenant account reference rejected)',
      NEW.account_id, NEW.business_id;
  end if;
  return NEW;
end;
$$;

create trigger ledger_entries_account_matches_business
  before insert on ledger_entries
  for each row execute function account_matches_business();

create trigger expenses_account_matches_business
  before insert or update on expenses
  for each row execute function account_matches_business();
