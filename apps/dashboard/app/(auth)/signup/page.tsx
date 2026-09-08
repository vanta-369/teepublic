import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Request Access" };

export default function SignUpPage() {
  return <AuthForm mode="register" />;
}
