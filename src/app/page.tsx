import Image from "next/image";
import { ButtonLink } from "@/components/ui/button";

// Temporary landing page. The staff shell (Today dashboard behind
// requireStaff) replaces it in a later Phase 0 step.
export default function Home() {
  const isDev = process.env.NODE_ENV === "development";
  return (
    <main className="gutter flex flex-1 flex-col justify-center gap-8 py-16">
      <Image
        src="/logo.svg"
        alt="BICII"
        width={2016}
        height={952}
        priority
        unoptimized
        className="h-10 w-auto self-start"
      />
      <div className="flex flex-col gap-3">
        <p className="eyebrow text-dust-500">Workshop · Inventory · Operations</p>
        <h1 className="text-5xl sm:text-7xl">BICII Admin</h1>
        <p className="measure text-dust-700">
          The staff app for intake, work orders, stock, consignment and reporting. Sign-in and the
          shop-floor shell arrive next.
        </p>
      </div>
      {isDev ? (
        <div>
          <ButtonLink href="/dev/ui" variant="outline">
            Primitives gallery
          </ButtonLink>
        </div>
      ) : null}
    </main>
  );
}
