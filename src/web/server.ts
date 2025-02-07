import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const port = 8000;

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  console.log(`Serving ${url.pathname}`);

  try {
    // Add CORS headers
    const headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });

    // Serve index.html
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await Deno.readTextFile("/app/src/web/index.html");
      headers.set("content-type", "text/html; charset=utf-8");
      return new Response(html, { headers });
    }

    // Serve app.js
    if (url.pathname === "/app.js") {
      const js = await Deno.readTextFile("/app/src/web/app.js");
      headers.set("content-type", "application/javascript");
      return new Response(js, { headers });
    }

    // 404 for everything else
    return new Response("Not Found", { status: 404 });
  } catch (error) {
    console.error(`Error handling request:`, error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

console.log(`HTTP webserver running at http://localhost:${port}/`);
await serve(handler, { port });