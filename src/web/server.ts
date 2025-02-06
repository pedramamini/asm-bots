import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.208.0/http/file_server.ts";

const port = 8000;

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Serve static files from public directory
  if (url.pathname.startsWith("/static/")) {
    return await serveDir(request, {
      fsRoot: "public",
      urlRoot: "static",
    });
  }

  // Serve main HTML page
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await Deno.readTextFile("src/web/index.html");
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new Response("Not Found", { status: 404 });
}

console.log(`HTTP webserver running at http://localhost:${port}/`);
await serve(handleRequest, { port });