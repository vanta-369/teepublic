# Higgstee Canva page import (development integration)

This app runs inside the Canva editor. It asks Canva for a ZIP of PNG page
exports, opens Higgstee with a temporary export link in the URL fragment, and
lets the local Higgstee extension fetch the ZIP directly from Canva. The
dashboard expands it in memory and imports one image per page into its usual
device-local design storage. Nothing is saved to the Downloads folder or a
Higgstee server. Export settings, including transparency and selected pages,
are controlled by Canva; select **all pages** in the export panel.

## Enable and validate in Canva

1. Create a development app in the Canva Developer Portal using the Design
   Editor intent. This step requires access to the owner's Canva account.
2. Run `npm run build --workspace=@teepublic/canva` and upload `dist/app.js`
   as the app's JavaScript bundle in the portal. Enable the design export
   permission required by `requestExport`, and allow opening the Higgstee URL.
3. Sign in to Higgstee first. Rebuild/reload the Higgstee extension, accepting its new permission for
   `https://export-download.canva.com/*`. Configure its ID on the dashboard.
4. Preview the development app in an existing multi-page Canva design.
   Click **Grab all pages**, choose PNG and all pages, confirm the export,
   and allow the app to open Higgstee. Click **Grab all exported pages** there.
   Switch to **Generate with AI** before importing if you want to generate
   listings instead of matching a spreadsheet.
5. Verify page count, ordering, full dimensions, transparency settings, and
   spreadsheet filename matching. Test an abandoned export and an expired
   link. The transfer limit is 32 MB compressed; use smaller page batches
   above that limit. Expanded archives are capped at 128 MB and 1,000 entries.

Live Canva testing and app registration have not been performed by Codex.
The app is a development integration, not a published Canva Marketplace app.
Canva currently does not accept public export-only apps; a public release
needs an eligible workflow such as the Content Publisher intent and Canva
review. Private released apps also have plan/distribution requirements.

References:
- https://www.canva.dev/docs/apps/quickstart/
- https://www.canva.dev/docs/apps/exporting-designs/
- https://www.canva.dev/docs/apps/api/latest/design-request-export/
