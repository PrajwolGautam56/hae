# Inventory and manufacturing model

This project uses one item master (`products`) with typed items and separate operational views.

| Business view | Item types | Meaning |
| --- | --- | --- |
| Inventory | `raw_material`, `packaging` | Inputs not directly offered for sale |
| Stock | `finished_good`, `resale_good` | Goods available for sales invoices |

## Posting rules

- A purchase bill posts the supplier ledger and increases the selected/new item's on-hand quantity.
- A new purchase line requires a destination classification: raw material, packaging, finished product, or resale product.
- A direct item entry can establish opening quantity without a purchase bill.
- A production batch consumes raw material/packaging and increases finished-product stock atomically.
- A sales invoice consumes only a selected inventory-master item and creates the party debit.
- Every quantity change is represented by a stock movement or production consumption record.

## References used

- LedgerSMB source: goods/parts, assemblies, inventory accounts, warehouse inventory, vendor invoice posting, last cost and sell price. The local GPLv2 source was used as an architectural reference only; no LedgerSMB code was copied.
- ERPNext Stock Entry: material receipt, material consumption, manufacture, repack, source/target stock movement.
- Odoo Manufacturing: product master, Bill of Materials components, manufacturing orders and finished-product inventory.

The current release implements manual production batches. Reusable Bills of Materials, warehouses, valuation/COGS, lots and serial numbers are deliberate future extensions.
