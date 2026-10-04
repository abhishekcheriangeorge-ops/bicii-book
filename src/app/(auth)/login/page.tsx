import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/redirect";
import { getSession } from "@/lib/auth/session";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);
  // Already signed in: go where they were heading.
  if (await getSession()) redirect(nextPath);

  return (
    <div className="flex w-full max-w-sm flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Image
          src="/logo.svg"
          alt="BICII"
          width={2016}
          height={952}
          unoptimized
          priority
          className="h-9 w-auto self-start"
        />
        <div className="flex flex-col gap-2">
          <p className="eyebrow text-dust-500">Workshop · Inventory · Operations</p>
          <h1 className="text-4xl">Staff sign in</h1>
        </div>
      </div>
      <LoginForm next={nextPath === "/" ? undefined : nextPath} />
      <p className="text-sm text-dust-500">
        No account? Ask an admin to invite you from Settings → Staff.
      </p>
    </div>
  );
}
