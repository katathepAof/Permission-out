# MOD 2 Excel update flow

## Source contract

- Accept one `.xlsx` file per version.
- Read only the worksheet named `Total Site`.
- Require 70 non-empty headers and `Site Code` in column A.
- Reject blank or duplicate Site Codes.
- Store every source column in `mod2_sites.raw_data` using the original header.
- Sites without a valid L/M coordinate remain queryable in the database with
  `latitude`, `longitude`, and `geom` set to `NULL`; they are not map markers.

## Popup contract

The initial popup exposes only:

- E — Site grade
- K — Contract Expired
- W — SDH : Topology
- X — LSW : Topology
- Y — DSLAM : Topology
- AC — Site Type
- V — Total OPEX (Yearly), Admin only

The Worker removes both the normalized `opex` property and the original Total
OPEX field from `raw_data` for non-Admin sessions.

## Admin workflow

1. Select **Site Facility — Excel / Total Site**.
2. Drop or select one `.xlsx` file.
3. Browser validates workbook structure, row count, duplicate Site Codes, and
   coordinates before upload.
4. The original workbook is stored in the private MOD 2 bucket.
5. Rows are imported in batches into an immutable Staging version.
6. The screen reports New, Updated, Removed, Unchanged, and sites without map
   coordinates.
7. Existing production data remains active until an authorized user presses
   **Publish**.
8. Publishing archives the previous version; an archived version can be used
   for rollback.

## Deployment order

1. Apply `supabase/migrations/20260814150000_mod2_total_site_excel.sql`.
2. Deploy the Worker and static application.
3. Upload `Node Database As of 06082026.xlsx` through Admin data management.
4. Reconcile the Staging counts and verify a normal-user and Admin popup.
5. Press Publish only after reconciliation.
