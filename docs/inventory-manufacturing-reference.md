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

## Bulk product-name import

Stock and Inventory include **Import product names · Excel** for administrators, managers and accountants. Upload an `.xlsx` workbook with one `Product Name` column, preview the first worksheet, choose the item type, then confirm the import. Each pack size should have its own full product name. The blank template is available in the panel.

Imports create only new item-master records: quantity, purchase price, sale price and MRP start at zero, with unit `pcs` (one pack/item). They do not create purchases, production, stock movements or accounting entries. Receive stock afterwards through the existing workflows; edit product details to set prices or a different unit.

The preview skips repeated names and existing company names, including inactive items. Existing stock, rates and classifications are never updated by an import. A single batch insert uses `ON CONFLICT DO NOTHING`, so retrying the same workbook after a lost response cannot duplicate identical names. Invalid rows block the whole import. Limits: 1,000 names, a 2 MB upload and a 16 MB expanded workbook. The server derives the authorized company from the session and rejects a changed company or preview before writing. No schema migration is required.

## References used

- LedgerSMB source: goods/parts, assemblies, inventory accounts, warehouse inventory, vendor invoice posting, last cost and sell price. The local GPLv2 source was used as an architectural reference only; no LedgerSMB code was copied.
- ERPNext Stock Entry: material receipt, material consumption, manufacture, repack, source/target stock movement.
- Odoo Manufacturing: product master, Bill of Materials components, manufacturing orders and finished-product inventory.

The current release implements manual production batches. Reusable Bills of Materials, warehouses, valuation/COGS, lots and serial numbers are deliberate future extensions.
