import { Env } from './env';
import { formatAnthropicToOpenAI } from './formatRequest';
import { streamOpenAIToAnthropic } from './streamResponse';
import { formatOpenAIToAnthropic } from './formatResponse';
import { indexHtml } from './indexHtml';
import { termsHtml } from './termsHtml';
import { privacyHtml } from './privacyHtml';
import { installSh } from './installSh';

function buildUpstreamRequest(anthropicRequest: any, env: Env, bearerToken?: string) {
  const provider = env.PROVIDER || 'openrouter';
  const openaiRequest = formatAnthropicToOpenAI(anthropicRequest, env.MODEL_OVERRIDE);

  if (provider === 'lm-studio') {
    const baseUrl = env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234';
    const modelOverride = env.LM_STUDIO_MODEL;
    if (modelOverride) {
      openaiRequest.model = modelOverride;
    }
    return {
      url: `${baseUrl}/v1/chat/completions`,
      headers: { "Content-Type": "application/json" } as Record<string, string>,
      body: openaiRequest,
    };
  }

  // Default: OpenRouter
  const baseUrl = env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  return {
    url: `${baseUrl}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${bearerToken}`,
    },
    body: openaiRequest,
  };
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const env: Env = {
    PROVIDER: (process.env.PROVIDER as Env['PROVIDER']) || 'openrouter',
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    MODEL_OVERRIDE: process.env.MODEL_OVERRIDE,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    LM_STUDIO_BASE_URL: process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234',
    LM_STUDIO_MODEL: process.env.LM_STUDIO_MODEL,
  };

  if (url.pathname === '/' && request.method === 'GET') {
    return new Response(indexHtml, {
      headers: { "Content-Type": "text/html" }
    });
  }

  if (url.pathname === '/terms' && request.method === 'GET') {
    return new Response(termsHtml, {
      headers: { "Content-Type": "text/html" }
    });
  }

  if (url.pathname === '/privacy' && request.method === 'GET') {
    return new Response(privacyHtml, {
      headers: { "Content-Type": "text/html" }
    });
  }

  if (url.pathname === '/install.sh' && request.method === 'GET') {
    return new Response(installSh, {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  if (url.pathname === '/v1/messages' && request.method === 'POST') {
    const anthropicRequest = await request.json();
    const bearerToken = env.OPENROUTER_API_KEY || request.headers.get("X-Api-Key") ||
      request.headers.get("Authorization")?.replace("Bearer ", "");

    // Auth check: only require API key for OpenRouter, not for local LM Studio
    if (env.PROVIDER !== 'lm-studio' && !bearerToken) {
      return new Response(JSON.stringify({
        error: { type: "authentication_error", message: "No API key provided" }
      }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const { url: upstreamUrl, headers: upstreamHeaders, body: openaiRequest } = buildUpstreamRequest(anthropicRequest, env, bearerToken);

    const abortController = new AbortController();
    const signal = abortController.signal;
    request.signal.addEventListener('abort', () => {
      abortController.abort();
    }, { once: true });

    const openaiResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(openaiRequest),
      signal,
    });

    if (!openaiResponse.ok) {
      const errBody = await openaiResponse.text().catch(() => 'unknown error');
      return new Response(errBody, { status: openaiResponse.status });
    }

    if (openaiRequest.stream) {
      const anthropicStream = streamOpenAIToAnthropic(
        openaiResponse.body as ReadableStream,
        openaiRequest.model,
        signal,
      );
      return new Response(anthropicStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    } else {
      const openaiData = await openaiResponse.json();
      const anthropicResponse = formatOpenAIToAnthropic(openaiData, openaiRequest.model);
      return new Response(JSON.stringify(anthropicResponse), {
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  return new Response('Not Found', { status: 404 });
}

async function main() {
  const { createServer } = await import('http');

  const server = createServer(async (req, res) => {
    try {
      // Convert Node.js IncomingMessage to Web Request
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString();

      const webUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      const webRequest = new Request(webUrl.toString(), {
        method: req.method,
        headers: Object.entries(req.headers)
          .filter(([_, v]) => v !== undefined)
          .flatMap(([k, v]) => Array.isArray(v) ? v.map(vv => [k, vv]) : [[k, v as string]]),
        body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : body,
      });

      const webResponse = await handleRequest(webRequest);

      res.writeHead(webResponse.status, webResponse.statusText, Object.fromEntries(webResponse.headers.entries()));

      if (webResponse.body) {
        const reader = webResponse.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
        } finally {
          reader.releaseLock();
        }
      }

      res.end();
    } catch (err: any) {
      console.error('Request handler error:', err?.message || err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { type: "server_error", message: err?.message || "Internal error" } }));
      } else {
        res.end();
      }
    }
  });

  const port = parseInt(process.env.PORT || '8787', 10);
  server.listen(port, '0.0.0.0', () => {
    console.log(`🌍 open-claude-router running on http://0.0.0.0:${port}`);
  });
}

main().catch(console.error);
