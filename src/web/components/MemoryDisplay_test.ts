import { assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { MemoryDisplay } from "./MemoryDisplay.ts";

Deno.test("MemoryDisplay - Cell Updates", async (t) => {
  const canvas = new OffscreenCanvas(256, 256);
  const display = new MemoryDisplay(canvas as unknown as HTMLCanvasElement);

  display.update(0x10, 0xFF);
  assertEquals(display.getCellState(0x10)?.value, 0xFF);

  display.setProtection(0x20, true);
  assertEquals(display.getCellState(0x20)?.isProtected, true);

  display.highlight(0x30);
  assertEquals(display.getCellState(0x30)?.isActive, true);
  await new Promise(resolve => setTimeout(resolve, 600));
  assertEquals(display.getCellState(0x30)?.isActive, false);
});