import Link from "next/link";
import { BlinkMark } from "@/components/home/blink-mark";
import { DitherField } from "@/components/home/dither-field";

/** The mark, on a moving dither. Clicking it enters the product. */
export default function HomePage() {
  return (
    <main className="home-stage relative flex min-h-dvh items-center justify-center overflow-hidden">
      <DitherField />
      <Link href="/cases" className="relative z-10" aria-label="Enter Blink" data-testid="enter-blink">
        <BlinkMark large />
      </Link>
    </main>
  );
}
