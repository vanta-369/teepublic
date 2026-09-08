import type { Metadata } from "next";
import { SiteShell } from "@/components/site/SiteShell";
import { PageHeader } from "@/components/site/PageBits";
import { ContactForm } from "@/components/site/ContactForm";
import { SocialConnect } from "@/components/ui/connect-with-us";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <SiteShell>
      <PageHeader
        eyebrow="Contact"
        title="Get in touch"
        subtitle="Questions about access, billing, or the extension? We're happy to help."
      />
      <section className="mx-auto max-w-2xl px-5 py-8">
        <ContactForm />
      </section>
      <SocialConnect />
    </SiteShell>
  );
}
