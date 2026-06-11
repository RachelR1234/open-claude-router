import { Env } from './env';
import { formatAnthropicToOpenAI } from './formatRequest';
import { streamOpenAIToAnthropic } from './streamResponse';
import { formatOpenAIToAnthropic } from './formatResponse';
import { indexHtml } from './indexHtml';
import { termsHtml } from './termsHtml';
import { privacyHtml } from './privacyHtml';
import { installSh } from './installSh';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
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
      const openaiRequest = formatAnthropicToOpenAI(anthropicRequest, env.MODEL_OVERRIDE);
      const bearerToken = env.OPENROUTER_API_KEY || request.headers.get("X-Api-Key") || 
        request.headers.get("Authorization")?.replace("Bearer ", "");

      if (!bearerToken) {
        return new Response(JSON.stringify({
          error: { type: "authentication_error", message: "No API key provided" }
        }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }

      const baseUrl = env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
      
      // Create an AbortController tied to the incoming request
      const abortController = new AbortController();
      const signal = abortController.signal;
      
      // If the client disconnects, abort the upstream fetch
      request.signal.addEventListener('abort', () => {
        abortController.abort();
      }, { once: true });

      let openaiResponse: Response;
      try {
        openaiResponse = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${bearerToken}`,
          },
          body: JSON.stringify(openaiRequest),
          signal,
        });
      } catch (fetchErr: any) {
        console.error('fetch to OpenRouter failed:', fetchErr?.message || fetchErr);
        if (fetchErr?.name === 'AbortError') {
          return new Response(JSON.stringify({
            error: { type: "request_aborted", message: "Request was aborted" }
          }), {
            status: 499,
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify({
          error: { type: "upstream_error", message: fetchErr?.message || "Upstream fetch failed" }
        }), {
          status: 502,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (!openaiResponse.ok) {
        const errBody = await openaiResponse.text().catch(() => 'unknown error');
        return new Response(errBody, { status: openaiResponse.status });
      }

      if (openaiRequest.stream) {
        try {
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
        } catch (streamErr: any) {
          console.error('stream creation failed:', streamErr?.message || streamErr);
          return new Response(JSON.stringify({
            error: { type: "stream_error", message: streamErr?.message || "Stream processing failed" }
          }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      } else {
        let openaiData: any;
        try {
          openaiData = await openaiResponse.json();
        } catch (jsonErr: any) {
          console.error('failed to parse upstream JSON response:', jsonErr?.message || jsonErr);
          return new Response(JSON.stringify({
            error: { type: "parse_error", message: "Failed to parse upstream response" }
          }), {
            status: 502,
            headers: { "Content-Type": "application/json" }
          });
        }
        const anthropicResponse = formatOpenAIToAnthropic(openaiData, openaiRequest.model);
        return new Response(JSON.stringify(anthropicResponse), {
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    
    if (url.pathname === '/v1/messages/count_tokens' && request.method === 'POST') {
      const body = await request.json();
      // Simple estimation: ~4 chars per token. 
      // This is not perfect but better than 404 and sufficient for context management.
      // We count system prompt + messages content.
      let charCount = 0;
      
      if (body.system) {
        if (typeof body.system === 'string') charCount += body.system.length;
        else if (Array.isArray(body.system)) {
            charCount += body.system.reduce((acc: number, part: any) => acc + (part.text?.length || 0), 0);
        }
      }
      
      if (body.messages) {
        for (const msg of body.messages) {
          if (typeof msg.content === 'string') charCount += msg.content.length;
          else if (Array.isArray(msg.content)) {
            charCount += msg.content.reduce((acc: number, part: any) => acc + (part.text?.length || 0), 0);
          }
        }
      }
      
      const input_tokens = Math.ceil(charCount / 4);
      
      return new Response(JSON.stringify({ input_tokens }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
}