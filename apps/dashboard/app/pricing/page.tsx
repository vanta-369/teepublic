import type { Metadata } from "next";
import { SiteShell } from "@/components/site/SiteShell";
import { PricingSection } from "@/components/ui/pricing";

export const metadata: Metadata = { title: "Pricing" };

// NOTE: prices below are PLACEHOLDERS — swap in your real numbers. The pricing
// component renders `$<price>` per tier, so a Free plan uses 0 and the yearly
// figure drives the "% off" badge (here ~20% off an annual plan).
const PLANS = [
  {
    name: "Free", // keep this exact name — the component hides "/month" for "Free"
    info: "7-day trial",
    price: { monthly: 0, yearly: 0 },
    features: [
      { text: "Full uploader access" },
      {
        text: "AI listing generation",
        tooltip: "Generate titles, tags & descriptions with Gemini using your own API key",
      },
      { text: "TeePublic automation" },
      { text: "Community support" },
    ],
    btn: { text: "Start Free", href: "/signup" },
  },
  {
    highlighted: true,
    name: "Pro",
    info: "For active sellers",
    price: { monthly: 19, yearly: Math.round(19 * 12 * (1 - 0.2)) },
    features: [
      { text: "Everything in Free" },
      { text: "Unlimited uploads" },
      {
        text: "Bulk transfer & queue",
        tooltip: "Push large batches to the extension and upload them hands-free",
      },
      { text: "Priority support", tooltip: "Faster responses over email" },
      { text: "Early access to new platforms" },
    ],
    btn: { text: "Get Started", href: "/signup" },
  },
  {
    name: "Team",
    info: "For agencies & teams",
    price: { monthly: 49, yearly: Math.round(49 * 12 * (1 - 0.2)) },
    features: [
      { text: "Everything in Pro" },
      { text: "Multiple seats" },
      { text: "Shared design library" },
      { text: "Onboarding & dedicated support" },
    ],
    btn: { text: "Contact Sales", href: "/contact" },
  },
];

const STEPS = [
  { n: "1", title: "Request access", body: "Sign up with your email to get started." },
  { n: "2", title: "Verify your email", body: "Confirm your address so we know it's you." },
  { n: "3", title: "Get approved", body: "An admin reviews and approves your account." },
  { n: "4", title: "Trial starts", body: "Your 7-day free trial begins automatically." },
];

export default function PricingPage() {
  return (
    <SiteShell>
      <PricingSection
        className="pt-16 pb-6"
        heading="Simple access, no surprises"
        description="Request access to start. Your trial begins the moment an admin approves your account — upgrade to Pro whenever you're ready."
        plans={PLANS}
      />

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="surface-soft p-8">
          <h2 className="text-center text-xl font-bold text-zinc-900 dark:text-zinc-100">
            How access works
          </h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.n} className="flex flex-col items-center text-center">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-500 text-base font-bold text-zinc-950">
                  {s.n}
                </span>
                <p className="mt-4 font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</p>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
