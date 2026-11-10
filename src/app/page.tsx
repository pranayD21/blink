import { DitherField } from "@/components/home/dither-field";
import { EnterBlink } from "@/components/home/enter-blink";

/** The mark, on a moving dither. Clicking the glass plate enters the product. */
export default function HomePage() {
  return (
    <main className="home-stage relative flex min-h-dvh items-center justify-center overflow-hidden">
      <DitherField />
      <EnterBlink />
    </main>
  );
}
