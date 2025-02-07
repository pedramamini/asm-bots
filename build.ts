/// <reference lib="deno.ns" />

// Make this a module
export {};

const cmd = new Deno.Command("deno", {
  args: [
    "bundle",
    "--config", "deno.json",
    "src/web/components/index.ts",
    "public/js/bundle.js"
  ],
});

// Create public/js directory if it doesn't exist
try {
  await Deno.mkdir("public/js", { recursive: true });
} catch (error) {
  if (!(error instanceof Deno.errors.AlreadyExists)) {
    throw error;
  }
}

// Run the bundle command
const { code, stdout, stderr } = await cmd.output();

if (code === 0) {
  console.log("Bundle created successfully");
  console.log(new TextDecoder().decode(stdout));
} else {
  console.error("Bundle creation failed");
  console.error(new TextDecoder().decode(stderr));
  Deno.exit(1);
}