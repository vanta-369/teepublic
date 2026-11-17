// Product switches shared by the dashboard and the extension.
//
// GEMINI_BROWSER_JOBS - listing generation through the user's own Google
// accounts on gemini.google.com (the extension drives Gemini tabs; see
// services/geminiJobs.ts). OFF for the Chrome Web Store release 1.1.0: it needs
// the "debugger" permission and access to gemini.google.com, both high-risk in
// store review, and the owner chose to launch without it. With it off:
//   - the extension's manifest asks for neither (build.mjs adds them back only
//     when this is true) and the Gemini content scripts aren't built;
//   - the worker answers every Gemini-job message with "not available";
//   - the dashboard hides "Google account" in Generate with AI and the
//     Connect account page. "API key" generation (lib/gemini.ts) is unaffected.
// To bring it back: set to true, rebuild, and re-add the manifest/test entries
// noted in tests/gemini-browser.test.ts.
export const GEMINI_BROWSER_JOBS: boolean = false;
