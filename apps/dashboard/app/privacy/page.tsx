// The public Privacy Policy. Stays at /privacy, stays reachable without an
// account (see PUBLIC_PREFIXES in lib/supabase/middleware.ts), and keeps the
// site's design.
//
// EVERY CLAIM ON THIS PAGE IS ENFORCED SOMEWHERE IN THE CODE. If you change
// what the product does, change this page in the same commit — and expect the
// tests to tell you when the two have drifted:
//
//   "images stay on your device"          -> lib/localDb.ts, tests/local-store
//   "we cannot receive them"              -> lib/supabase/guardedFetch.ts,
//                                            tests/privacy-guards
//   "only a total upload count"           -> supabase/migrations/0009,
//                                            tests/schema, tests/upload-counter
//   "no /api/files, no Storage uploads"   -> tests/no-server-storage
//   "the Gemini key never reaches us"     -> lib/aiSettings.ts, tests/gemini
//   "no cookies or browsing history"      -> manifest.json, tests/no-server-storage
//
// Nothing here is aspirational. Where a protection has a limit, the limit is
// stated rather than smoothed over.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/SiteShell";
import { PageHeader } from "@/components/site/PageBits";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Higgstee stores and what it does not. Your designs, listings and artwork stay on your device; we keep your account details and a single upload count.",
};

const SUPPORT_EMAIL = "support@higgstee.com";
const LAST_UPDATED = "September 20, 2026";

/** Every place your data can go, and what goes there. */
const DATA_FLOWS: { data: string; where: string; when: string }[] = [
  {
    data: "Email address, user ID, password (hashed)",
    where: "Higgstee's database (Supabase)",
    when: "When you create an account or sign in",
  },
  {
    data: "Account status: approval, trial dates, plan, subscription state, administrator flag",
    where: "Higgstee's database (Supabase)",
    when: "Set by us, to run your account and your access",
  },
  {
    data: "Total number of listings you have successfully published",
    where: "Higgstee's database (Supabase) — a single number per account",
    when: "Increased by one each time an upload is confirmed",
  },
  {
    data: "Design images",
    where: "Your device (IndexedDB)",
    when: "As soon as you add them, and they stay there",
  },
  {
    data: "Titles, descriptions, tags, filenames, prices, product and colour settings",
    where: "Your device (IndexedDB)",
    when: "As you create and edit them, and they stay there",
  },
  {
    data: "Your TeePublic earnings export, if you upload one",
    where: "Your device (IndexedDB)",
    when: "When you drop the file on the Sales & Earnings page",
  },
  {
    data: "Your Gemini API key",
    where: "Your browser (local storage on this device)",
    when: "When you paste it into the AI panel",
  },
  {
    data: "A design image and your listing details",
    where: "The marketplace you chose (e.g. TeePublic), directly from your browser",
    when: "Only after you press Send / Start an upload",
  },
  {
    data: "A design image and your prompt",
    where: "Google Gemini, directly from your browser",
    when: "Only after you press Generate",
  },
];

export default function PrivacyPage() {
  return (
    <SiteShell>
      <PageHeader
        title="Privacy Policy"
        subtitle={`Last updated: ${LAST_UPDATED}`}
      />

      <section className="mx-auto max-w-3xl px-5 py-8 space-y-10">
        {/* ── Summary ─────────────────────────────────────────────────── */}
        <div className="surface p-5">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            The short version
          </h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            <li>
              <strong className="font-semibold text-zinc-900 dark:text-zinc-200">
                Your designs and listings stay on your device.
              </strong>{" "}
              Images, titles, descriptions, tags, filenames, prices and product settings are
              stored in your own browser. Higgstee&apos;s servers do not receive them and do not
              store them.
            </li>
            <li>
              <strong className="font-semibold text-zinc-900 dark:text-zinc-200">
                We store your account, and one number.
              </strong>{" "}
              Your email address, your user ID, your account and access status, and a running
              total of how many listings you have published. Nothing about what any of them were.
            </li>
            <li>
              <strong className="font-semibold text-zinc-900 dark:text-zinc-200">
                Your work leaves your device only when you tell it to.
              </strong>{" "}
              It goes straight from your browser to the marketplace you picked, or to Google
              Gemini if you use the AI feature. It never passes through us on the way.
            </li>
            <li>
              <strong className="font-semibold text-zinc-900 dark:text-zinc-200">
                We never see your marketplace password.
              </strong>{" "}
              The extension uses the session you are already signed into, in your own browser.
            </li>
            <li>
              <strong className="font-semibold text-zinc-900 dark:text-zinc-200">
                We do not sell your data
              </strong>{" "}
              and do not use it for advertising, retargeting or profiling.
            </li>
          </ul>
        </div>

        <Section title="Who this covers">
          <P>
            This policy covers the Higgstee website and dashboard at higgstee.com and the
            Higgstee Chrome extension. &quot;We&quot; and &quot;Higgstee&quot; mean the operator
            of that service. If you have questions about anything below, the contact details are
            at the end.
          </P>
        </Section>

        {/* ── 1. What we store ─────────────────────────────────────────── */}
        <Section title="1. What we store about you">
          <P>
            Higgstee&apos;s database holds only what is needed to run your account and decide
            whether you may use the service:
          </P>
          <Bullets
            items={[
              "Your authenticated user ID.",
              "Your email address.",
              "Your password, stored as a salted hash by our authentication provider. We never see it in readable form.",
              "Your account and access status: whether your account is approved, when your trial started and ends, your plan and subscription state, and whether the account is active, pending, expired or suspended.",
              "Whether the account is an administrator, where that is needed to run the service.",
              "A single total: the number of listings you have successfully published. See section 4.",
              "Basic account activity for security and support — for example sign-ins, approvals and plan changes, recorded with a timestamp.",
            ]}
          />
          <P>
            Like any website, our hosting and infrastructure providers process technical request
            data such as IP addresses and browser user-agent strings in order to serve pages and
            to protect against abuse. We do not combine that with your designs or listings,
            because we do not have your designs or listings.
          </P>
        </Section>

        {/* ── 2. Design images ────────────────────────────────────────── */}
        <Section title="2. Your design images stay on your device">
          <P>
            Every image you add to Higgstee — uploaded, dropped in, or generated — is stored in
            your own browser, in a local database (IndexedDB) that belongs to your browser
            profile on your computer. It is not uploaded to Higgstee. We do not have a copy,
            cannot retrieve one, and store no image files, no image data and no links to images
            anywhere on our servers.
          </P>
          <P>An image leaves your device in exactly two situations, both of which you start:</P>
          <Bullets
            items={[
              "When you send designs to the extension and start an upload, the image goes from your browser to the marketplace you selected.",
              "When you use an AI feature, the image goes from your browser to Google Gemini. See section 6.",
            ]}
          />
          <P>
            In both cases the transfer is direct. The image does not pass through a Higgstee
            server on the way, and is not copied, cached or logged by us.
          </P>
          <P className="text-zinc-500 dark:text-zinc-500">
            Because this storage lives in your browser profile, it is tied to that browser on
            that computer. Clearing your browsing data, using a private window, or switching to
            another machine will not show you the same designs. Section 9 explains how to move
            work between devices.
          </P>
        </Section>

        {/* ── 3. Listing content ──────────────────────────────────────── */}
        <Section title="3. Your listing content stays on your device">
          <P>
            The same is true of everything you write and configure around a design: titles,
            descriptions, tags, filenames, prices, product selections, colour choices, the rows
            of any spreadsheet you import, and any TeePublic earnings export you upload to see
            your sales. All of it is stored locally in your browser and none of it is sent to
            Higgstee.
          </P>
          <P>
            Previewing, editing, reordering, bulk-retitling and queueing all run against that
            local copy. A listing is submitted to a marketplace only after you take an explicit
            action to upload it, and it goes straight from your browser to that marketplace.
          </P>
        </Section>

        {/* ── 4. Upload statistics ────────────────────────────────────── */}
        <Section title="4. Upload statistics: one number, nothing else">
          <P>
            When an upload is confirmed successful, your account&apos;s total upload count goes
            up by one. That total is the only upload statistic we keep. The record consists of
            your user ID, the count, and when the count last changed.
          </P>
          <P>We do not store, and do not receive:</P>
          <Bullets
            items={[
              "the design's ID or filename",
              "the listing's title, description or tags",
              "the published listing's URL",
              "the image",
              "the product or colour configuration",
              "any content from the marketplace page",
              "a per-upload history, or the time of any individual upload",
            ]}
          />
          <P>
            The request that increases the count carries no arguments at all — the server works
            out which account it belongs to from your signed-in session. Repeat confirmations and
            retries of the same design are filtered out on your own device, so that no listing
            detail has to be stored on our side in order to avoid counting something twice.
          </P>
        </Section>

        {/* ── 5. Marketplace uploads ──────────────────────────────────── */}
        <Section title="5. Uploading to a marketplace">
          <P>
            Uploads run in your browser, through the Higgstee extension, on the marketplace&apos;s
            own site. The extension fills in the marketplace&apos;s forms and attaches your
            artwork using the session you are already signed into. Nothing is submitted until you
            start the upload.
          </P>
          <P>
            The marketplace receives your design and listing details because that is what you
            asked it to publish. What it then does with them is governed by that
            marketplace&apos;s own privacy policy, not this one.
          </P>
        </Section>

        {/* ── 6. Gemini ───────────────────────────────────────────────── */}
        <Section title="6. Google Gemini (the AI listing feature)">
          <P>
            The AI feature is optional and runs on your own Google Gemini API key. When you press
            Generate, your browser sends the design image and your prompt{" "}
            <strong className="font-semibold text-zinc-900 dark:text-zinc-200">
              directly to Google&apos;s Gemini API
            </strong>
            , authenticated with your key. Nothing is sent before you press Generate, and nothing
            is sent if you never enter a key.
          </P>
          <Bullets
            items={[
              "Higgstee does not proxy, receive, store or log the image, the prompt, or the listing text Gemini returns.",
              "Your Gemini API key is stored only in your own browser. It is never sent to Higgstee's servers and it is never included in the body of any request other than the authenticated call to Google.",
              "Google's handling of the image and prompt is covered by Google's own terms and privacy policy for the Gemini API.",
            ]}
          />
          <P>
            Anyone with access to your computer and browser profile can read a key stored there,
            the same as any other credential saved in a browser. You can remove it at any time by
            clearing the key field in the AI panel.
          </P>
        </Section>

        {/* ── 7. What we never collect ────────────────────────────────── */}
        <Section title="7. What we never collect">
          <Bullets
            items={[
              "Your marketplace passwords. You never type them into Higgstee.",
              "Any other marketplace credentials, API tokens or login details.",
              "Your authentication cookies or session tokens for any marketplace.",
              "Your general browsing history. The extension only runs on the marketplace pages it needs in order to upload for you.",
            ]}
          />
          <P>
            The extension asks Chrome only for the permissions it needs to do this: local
            storage, the ability to open and drive the upload tab, and access limited to
            higgstee.com, our authentication provider, and teepublic.com. It requests no
            permission to read cookies, history or browsing activity.
          </P>
        </Section>

        {/* ── 8. Data flow table ──────────────────────────────────────── */}
        <Section title="8. Where each piece of data goes">
          <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 dark:border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 dark:bg-white/5">
                <tr className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  <th scope="col" className="px-4 py-3 font-semibold">Data</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Where it goes</th>
                  <th scope="col" className="px-4 py-3 font-semibold">When</th>
                </tr>
              </thead>
              <tbody>
                {DATA_FLOWS.map((row) => (
                  <tr
                    key={row.data}
                    className="border-t border-zinc-200 align-top dark:border-white/10"
                  >
                    <td className="px-4 py-3 text-zinc-900 dark:text-zinc-200">{row.data}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{row.where}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{row.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ── 9. Retention & deletion ─────────────────────────────────── */}
        <Section title="9. Keeping and deleting your data">
          <P>
            <strong className="font-semibold text-zinc-900 dark:text-zinc-200">
              On your device.
            </strong>{" "}
            Your designs and listings stay in your browser until you delete them in Higgstee, or
            clear your browser&apos;s site data. Deleting a design also deletes its artwork. Because
            the data is local, deleting your Higgstee account does not delete it — and signing out
            does not protect it. If you are handing the computer on, clear the site data for
            higgstee.com and remove the extension.
          </P>
          <P>
            <strong className="font-semibold text-zinc-900 dark:text-zinc-200">
              Moving between devices.
            </strong>{" "}
            Because nothing is stored on our side, your work does not follow your account to
            another browser or machine. Use the export and import buttons on the Uploads page to
            move a batch yourself; the exported file stays under your control.
          </P>
          <P>
            <strong className="font-semibold text-zinc-900 dark:text-zinc-200">
              On our servers.
            </strong>{" "}
            We keep your account record and your upload count for as long as your account exists.
            When you ask us to delete your account, we delete your account record, your upload
            count and the associated activity log. We may keep the minimum required for legal,
            tax or fraud-prevention reasons, and backups roll off on our provider&apos;s ordinary
            schedule.
          </P>
          <P>
            <strong className="font-semibold text-zinc-900 dark:text-zinc-200">
              Earlier versions of Higgstee.
            </strong>{" "}
            Before this release, Higgstee stored designs, listings and artwork on its servers so
            they could follow your account between browsers. That is no longer how the product
            works. Those stores have been made read-only and are being reviewed and removed; the
            application no longer reads or writes them. If you want the copy held for your account
            deleted straight away, email us and we will do it.
          </P>
        </Section>

        {/* ── 10. Your rights ─────────────────────────────────────────── */}
        <Section title="10. Your rights">
          <P>
            You can ask us for a copy of the account data we hold about you, ask us to correct it,
            ask us to delete it, or ask us to restrict or stop processing it. Where the law gives
            you a right to object or to data portability, you have that too. Email{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-accent-500 hover:text-accent-400"
            >
              {SUPPORT_EMAIL}
            </a>{" "}
            and we will respond within 30 days.
          </P>
          <P>
            Your designs and listings are not part of such a request, because we do not hold them.
            They are already in your hands.
          </P>
          <P>
            We process your account data to provide the service you asked for and to keep it
            secure. Our database and authentication are provided by Supabase and our site is
            hosted on Vercel; both act as processors on our behalf and may store data outside
            your country.
          </P>
        </Section>

        {/* ── 11. Security ────────────────────────────────────────────── */}
        <Section title="11. Security">
          <P>
            Account data is protected by database row-level security, so a signed-in account can
            read only its own record. Sensitive fields — approval, plan, trial and account status
            — cannot be written by a user at all; they are changed only by administrative
            operations on the server. Your upload count is likewise readable only by you and
            writable only by the server-side operation that increases it. All traffic runs over
            HTTPS.
          </P>
          <P>
            Your local designs and listings are protected by your own device and browser profile.
            Anyone with access to your unlocked computer and browser can open them, as with any
            file on that machine. No system is perfectly secure, and we cannot guarantee absolute
            security.
          </P>
        </Section>

        {/* ── 12. No selling, no ads ──────────────────────────────────── */}
        <Section title="12. We do not sell your data or advertise to you">
          <P>
            We do not sell or rent your personal information. We do not use it for personalised
            advertising, retargeting, ad networks, data brokering, or building profiles unrelated
            to running your account. We do not use your designs or listings to train machine
            learning models — we do not have them.
          </P>
        </Section>

        {/* ── 13. Chrome Web Store ────────────────────────────────────── */}
        <Section title="13. Chrome Web Store compliance">
          <P>
            The Higgstee extension complies with the{" "}
            <a
              href="https://developer.chrome.com/docs/webstore/program-policies/user-data-faq"
              target="_blank"
              rel="noreferrer"
              className="text-accent-500 hover:text-accent-400"
            >
              Chrome Web Store User Data Policy
            </a>
            , including the Limited Use requirements. Specifically:
          </P>
          <Bullets
            items={[
              "The extension collects and uses data only to provide the single purpose stated on its store listing: preparing and submitting your own product listings to supported marketplaces.",
              "It does not transfer user data to third parties except as needed to provide that purpose — that is, to the marketplace you chose to upload to, and to Google Gemini when you invoke the AI feature with your own key.",
              "It does not sell user data, and does not use or transfer it for advertising, retargeting or creditworthiness purposes.",
              "It does not use or transfer user data to determine anything unrelated to the extension's stated purpose.",
              "Humans do not read your data. We hold no design, listing or browsing data to read.",
            ]}
          />
        </Section>

        {/* ── 14. Children ────────────────────────────────────────────── */}
        <Section title="14. Children">
          <P>
            Higgstee is a tool for sellers and is not directed at children. We do not knowingly
            collect personal information from anyone under 16. If you believe a child has created
            an account, email us and we will remove it.
          </P>
        </Section>

        {/* ── 15. Changes ─────────────────────────────────────────────── */}
        <Section title="15. Changes to this policy">
          <P>
            If we change what we store or where it goes, we will update this page and change the
            date at the top. Material changes will also be announced in the dashboard. Continuing
            to use Higgstee after a change means you accept the updated policy.
          </P>
        </Section>

        {/* ── 16. Contact ─────────────────────────────────────────────── */}
        <Section title="16. Contact us">
          <P>
            Email{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-accent-500 hover:text-accent-400"
            >
              {SUPPORT_EMAIL}
            </a>{" "}
            with any privacy question, or use the{" "}
            <Link href="/contact" className="text-accent-500 hover:text-accent-400">
              contact page
            </Link>
            . For account deletion, email from the address on the account and we will confirm once
            it is done.
          </P>
        </Section>
      </section>
    </SiteShell>
  );
}

/* ── Small presentational helpers, to keep the sections above readable ───── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </div>
  );
}

function P({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 ${className}`}>
      {children}
    </p>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
