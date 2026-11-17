import { requestExport } from "@canva/design";
import { requestOpenExternalUrl } from "@canva/platform";
import { prepareDesignEditor } from "@canva/intents/design";
import { CANVA_EXPORT_HASH, validateCanvaExportUrl } from "@teepublic/shared";

// Runs INSIDE a registered Canva app, not inside the dashboard or an injected
// script. Canva renders the original artwork and enforces its export settings.
prepareDesignEditor({ render: async () => {
  const root = document.createElement("main");
  root.style.cssText = "font:14px/1.5 system-ui;padding:20px;color:#242424";
  const heading = document.createElement("h2");
  heading.textContent = "Send pages to Higgstee";
  const help = document.createElement("p");
  help.textContent = "Choose PNG and select all pages in the Canva export panel. Each page becomes a separate design in Higgstee. No file is saved to Downloads.";
  const button = document.createElement("button");
  button.textContent = "Grab all pages";
  button.style.cssText = "padding:12px 18px;background:#7c3aed;color:white;border:0;border-radius:8px;cursor:pointer";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  let handoffUrl: string | null = null;

  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Preparing your pages...";
    try {
      if (!handoffUrl) {
        const result = await requestExport({ acceptedFileTypes: [{ type: "png", zipped: "always" }] });
        if (result.status === "aborted") { status.textContent = "Export cancelled."; return; }
        if (result.exportBlobs.length !== 1) throw new Error("Expected one ZIP containing the selected pages.");
        const url = validateCanvaExportUrl(result.exportBlobs[0].url);
        const target = new URL("https://www.higgstee.com/dashboard/create");
        target.hash = CANVA_EXPORT_HASH + encodeURIComponent(JSON.stringify({ url, title: result.title ?? "Canva design" }));
        handoffUrl = target.href;
      }
      const opened = await requestOpenExternalUrl({ url: handoffUrl });
      status.textContent = opened.status === "completed"
        ? "In Higgstee, click Grab all exported pages to finish importing."
        : "Click again to open Higgstee with the prepared pages.";
      button.textContent = "Open Higgstee";
    } catch (error) {
      // Never display signed export URLs in errors or logs.
      status.textContent = error instanceof Error && error.message === "Expected one ZIP containing the selected pages."
        ? error.message : "Could not send the pages. Try exporting again.";
      handoffUrl = null;
      button.textContent = "Grab all pages";
    } finally {
      button.disabled = false;
    }
  });
  root.append(heading, help, button, status);
  document.body.append(root);
} });
