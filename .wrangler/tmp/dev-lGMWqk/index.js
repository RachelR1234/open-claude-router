var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// formatRequest.ts
function validateOpenAIToolCalls(messages) {
  const validatedMessages = [];
  for (let i = 0; i < messages.length; i++) {
    const currentMessage = { ...messages[i] };
    if (currentMessage.role === "assistant" && currentMessage.tool_calls) {
      const validToolCalls = [];
      const removedToolCallIds = [];
      const immediateToolMessages = [];
      let j = i + 1;
      while (j < messages.length && messages[j].role === "tool") {
        immediateToolMessages.push(messages[j]);
        j++;
      }
      currentMessage.tool_calls.forEach((toolCall) => {
        const hasImmediateToolMessage = immediateToolMessages.some(
          (toolMsg) => toolMsg.tool_call_id === toolCall.id
        );
        if (hasImmediateToolMessage) {
          validToolCalls.push(toolCall);
        } else {
          removedToolCallIds.push(toolCall.id);
        }
      });
      if (validToolCalls.length > 0) {
        currentMessage.tool_calls = validToolCalls;
      } else {
        delete currentMessage.tool_calls;
      }
      if (currentMessage.content || currentMessage.tool_calls) {
        validatedMessages.push(currentMessage);
      }
    } else if (currentMessage.role === "tool") {
      let hasImmediateToolCall = false;
      if (i > 0) {
        const prevMessage = messages[i - 1];
        if (prevMessage.role === "assistant" && prevMessage.tool_calls) {
          hasImmediateToolCall = prevMessage.tool_calls.some(
            (toolCall) => toolCall.id === currentMessage.tool_call_id
          );
        } else if (prevMessage.role === "tool") {
          for (let k = i - 1; k >= 0; k--) {
            if (messages[k].role === "tool") continue;
            if (messages[k].role === "assistant" && messages[k].tool_calls) {
              hasImmediateToolCall = messages[k].tool_calls.some(
                (toolCall) => toolCall.id === currentMessage.tool_call_id
              );
            }
            break;
          }
        }
      }
      if (hasImmediateToolCall) {
        validatedMessages.push(currentMessage);
      }
    } else {
      validatedMessages.push(currentMessage);
    }
  }
  return validatedMessages;
}
__name(validateOpenAIToolCalls, "validateOpenAIToolCalls");
function mapModel(anthropicModel) {
  if (anthropicModel.includes("/")) {
    return anthropicModel;
  }
  if (anthropicModel.includes("haiku")) {
    return "anthropic/claude-3.5-haiku";
  } else if (anthropicModel.includes("sonnet")) {
    return "anthropic/claude-sonnet-4";
  } else if (anthropicModel.includes("opus")) {
    return "anthropic/claude-opus-4";
  }
  return anthropicModel;
}
__name(mapModel, "mapModel");
function formatAnthropicToOpenAI(body, modelOverride) {
  const { model, messages, system = [], temperature, tools, stream, reasoning, reasoning_effort, thinking } = body;
  const targetModel = modelOverride || mapModel(model);
  const openAIMessages = Array.isArray(messages) ? messages.flatMap((anthropicMessage) => {
    const openAiMessagesFromThisAnthropicMessage = [];
    if (!Array.isArray(anthropicMessage.content)) {
      if (typeof anthropicMessage.content === "string") {
        openAiMessagesFromThisAnthropicMessage.push({
          role: anthropicMessage.role,
          content: anthropicMessage.content
        });
      }
      return openAiMessagesFromThisAnthropicMessage;
    }
    if (anthropicMessage.role === "assistant") {
      const assistantMessage = {
        role: "assistant",
        content: null
      };
      let textContent = "";
      const toolCalls = [];
      anthropicMessage.content.forEach((contentPart) => {
        if (contentPart.type === "text") {
          textContent += (typeof contentPart.text === "string" ? contentPart.text : JSON.stringify(contentPart.text)) + "\n";
        } else if (contentPart.type === "tool_use") {
          toolCalls.push({
            id: contentPart.id,
            type: "function",
            function: {
              name: contentPart.name,
              arguments: JSON.stringify(contentPart.input)
            }
          });
        }
      });
      const trimmedTextContent = textContent.trim();
      if (trimmedTextContent.length > 0) {
        assistantMessage.content = trimmedTextContent;
      }
      if (toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls;
      }
      if (assistantMessage.content || assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        openAiMessagesFromThisAnthropicMessage.push(assistantMessage);
      }
    } else if (anthropicMessage.role === "user") {
      let userTextMessageContent = "";
      const subsequentToolMessages = [];
      anthropicMessage.content.forEach((contentPart) => {
        if (contentPart.type === "text") {
          userTextMessageContent += (typeof contentPart.text === "string" ? contentPart.text : JSON.stringify(contentPart.text)) + "\n";
        } else if (contentPart.type === "tool_result") {
          subsequentToolMessages.push({
            role: "tool",
            tool_call_id: contentPart.tool_use_id,
            content: typeof contentPart.content === "string" ? contentPart.content : JSON.stringify(contentPart.content)
          });
        }
      });
      const trimmedUserText = userTextMessageContent.trim();
      if (trimmedUserText.length > 0) {
        openAiMessagesFromThisAnthropicMessage.push({
          role: "user",
          content: trimmedUserText
        });
      }
      openAiMessagesFromThisAnthropicMessage.push(...subsequentToolMessages);
    }
    return openAiMessagesFromThisAnthropicMessage;
  }) : [];
  const systemMessages = Array.isArray(system) ? system.map((item) => {
    const content = {
      type: "text",
      text: item.text
    };
    if (targetModel.includes("claude")) {
      content.cache_control = { "type": "ephemeral" };
    }
    return {
      role: "system",
      content: [content]
    };
  }) : [{
    role: "system",
    content: [{
      type: "text",
      text: system,
      ...targetModel.includes("claude") ? { cache_control: { "type": "ephemeral" } } : {}
    }]
  }];
  const data = {
    model: targetModel,
    messages: [...systemMessages, ...openAIMessages],
    temperature,
    stream
  };
  if (reasoning) {
    data.reasoning = reasoning;
  } else if (thinking && thinking.type === "enabled") {
    data.reasoning = {
      max_tokens: thinking.budget_tokens
    };
  } else {
    data.reasoning = {
      effort: "high"
    };
  }
  if (reasoning_effort) {
    data.reasoning_effort = reasoning_effort;
  }
  if (tools) {
    data.tools = tools.map((item) => ({
      type: "function",
      function: {
        name: item.name,
        description: item.description,
        parameters: item.input_schema
      }
    }));
  }
  data.messages = [...systemMessages, ...validateOpenAIToolCalls(openAIMessages)];
  return data;
}
__name(formatAnthropicToOpenAI, "formatAnthropicToOpenAI");

// streamResponse.ts
function streamOpenAIToAnthropic(openaiStream, model, abortSignal) {
  const messageId = "msg_" + Date.now();
  let streamCancelled = false;
  const enqueueSSE = /* @__PURE__ */ __name((controller, eventType, data) => {
    if (streamCancelled) return;
    try {
      const sseMessage = `event: ${eventType}
data: ${JSON.stringify(data)}

`;
      controller.enqueue(new TextEncoder().encode(sseMessage));
    } catch (e) {
    }
  }, "enqueueSSE");
  return new ReadableStream({
    async start(controller) {
      const messageStart = {
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      };
      enqueueSSE(controller, "message_start", messageStart);
      let contentBlockIndex = 0;
      let hasStartedTextBlock = false;
      let hasStartedThinkingBlock = false;
      let isToolUse = false;
      let currentToolCallId = null;
      let toolCallJsonMap = /* @__PURE__ */ new Map();
      let usage = void 0;
      const reader = openaiStream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      if (abortSignal) {
        abortSignal.addEventListener("abort", () => {
          streamCancelled = true;
          try {
            reader.cancel();
          } catch (_) {
          }
          try {
            controller.close();
          } catch (_) {
          }
        }, { once: true });
      }
      try {
        while (!streamCancelled) {
          let result;
          try {
            result = await reader.read();
          } catch (readErr) {
            console.error("stream read error:", readErr?.message || readErr);
            break;
          }
          const { done, value } = result;
          if (done) {
            if (buffer.trim()) {
              const lines2 = buffer.split("\n");
              for (const line of lines2) {
                if (line.trim() && line.startsWith("data: ")) {
                  const data = line.slice(6).trim();
                  if (data === "[DONE]") continue;
                  try {
                    const parsed = JSON.parse(data);
                    if (parsed.usage) {
                      usage = parsed.usage;
                    }
                    const delta = parsed.choices?.[0]?.delta;
                    if (delta) {
                      processStreamDelta(delta);
                    }
                  } catch (e) {
                  }
                }
              }
            }
            break;
          }
          let chunk;
          try {
            chunk = decoder.decode(value, { stream: true });
          } catch (decodeErr) {
            console.error("stream decode error:", decodeErr?.message || decodeErr);
            continue;
          }
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.trim() && line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.usage) {
                  usage = parsed.usage;
                }
                const delta = parsed.choices?.[0]?.delta;
                if (delta) {
                  processStreamDelta(delta);
                }
              } catch (e) {
                continue;
              }
            }
          }
        }
      } catch (outerErr) {
        console.error("stream processing outer error:", outerErr?.message || outerErr);
        streamCancelled = true;
      } finally {
        try {
          reader.releaseLock();
        } catch (_) {
        }
      }
      function processStreamDelta(delta) {
        if (streamCancelled) return;
        if (delta.tool_calls?.length > 0) {
          for (const toolCall of delta.tool_calls) {
            const toolCallId = toolCall.id;
            if (toolCallId && toolCallId !== currentToolCallId) {
              if (isToolUse || hasStartedTextBlock || hasStartedThinkingBlock) {
                enqueueSSE(controller, "content_block_stop", {
                  type: "content_block_stop",
                  index: contentBlockIndex
                });
              }
              isToolUse = true;
              hasStartedTextBlock = false;
              hasStartedThinkingBlock = false;
              currentToolCallId = toolCallId;
              contentBlockIndex++;
              toolCallJsonMap.set(toolCallId, "");
              const toolBlock = {
                type: "tool_use",
                id: toolCallId,
                name: toolCall.function?.name,
                input: {}
              };
              enqueueSSE(controller, "content_block_start", {
                type: "content_block_start",
                index: contentBlockIndex,
                content_block: toolBlock
              });
            }
            if (toolCall.function?.arguments && currentToolCallId) {
              const currentJson = toolCallJsonMap.get(currentToolCallId) || "";
              toolCallJsonMap.set(currentToolCallId, currentJson + toolCall.function.arguments);
              enqueueSSE(controller, "content_block_delta", {
                type: "content_block_delta",
                index: contentBlockIndex,
                delta: {
                  type: "input_json_delta",
                  partial_json: toolCall.function.arguments
                }
              });
            }
          }
        } else if (delta.reasoning) {
          if (isToolUse || hasStartedTextBlock) {
            enqueueSSE(controller, "content_block_stop", {
              type: "content_block_stop",
              index: contentBlockIndex
            });
            isToolUse = false;
            hasStartedTextBlock = false;
            currentToolCallId = null;
            contentBlockIndex++;
          }
          if (!hasStartedThinkingBlock) {
            enqueueSSE(controller, "content_block_start", {
              type: "content_block_start",
              index: contentBlockIndex,
              content_block: {
                type: "thinking",
                thinking: "",
                signature: "openrouter-reasoning"
              }
            });
            hasStartedThinkingBlock = true;
          }
          enqueueSSE(controller, "content_block_delta", {
            type: "content_block_delta",
            index: contentBlockIndex,
            delta: {
              type: "thinking_delta",
              thinking: delta.reasoning
            }
          });
        } else if (delta.content) {
          if (isToolUse || hasStartedThinkingBlock) {
            enqueueSSE(controller, "content_block_stop", {
              type: "content_block_stop",
              index: contentBlockIndex
            });
            isToolUse = false;
            hasStartedThinkingBlock = false;
            currentToolCallId = null;
            contentBlockIndex++;
          }
          if (!hasStartedTextBlock) {
            enqueueSSE(controller, "content_block_start", {
              type: "content_block_start",
              index: contentBlockIndex,
              content_block: {
                type: "text",
                text: ""
              }
            });
            hasStartedTextBlock = true;
          }
          enqueueSSE(controller, "content_block_delta", {
            type: "content_block_delta",
            index: contentBlockIndex,
            delta: {
              type: "text_delta",
              text: delta.content
            }
          });
        }
      }
      __name(processStreamDelta, "processStreamDelta");
      if (!streamCancelled) {
        if (isToolUse || hasStartedTextBlock || hasStartedThinkingBlock) {
          enqueueSSE(controller, "content_block_stop", {
            type: "content_block_stop",
            index: contentBlockIndex
          });
        }
        enqueueSSE(controller, "message_delta", {
          type: "message_delta",
          delta: {
            stop_reason: isToolUse ? "tool_use" : "end_turn",
            stop_sequence: null
          },
          usage: {
            input_tokens: usage?.prompt_tokens || 0,
            output_tokens: usage?.completion_tokens || 0
          }
        });
        enqueueSSE(controller, "message_stop", {
          type: "message_stop"
        });
      }
      try {
        controller.close();
      } catch (_) {
      }
    },
    cancel(reason) {
      streamCancelled = true;
      console.error("stream cancelled by consumer:", reason);
    }
  });
}
__name(streamOpenAIToAnthropic, "streamOpenAIToAnthropic");

// formatResponse.ts
function formatOpenAIToAnthropic(completion, model) {
  const messageId = "msg_" + Date.now();
  let content = [];
  if (completion.choices[0].message.reasoning) {
    content.push({
      type: "thinking",
      thinking: completion.choices[0].message.reasoning,
      signature: "openrouter-reasoning"
      // Placeholder signature
    });
  }
  if (completion.choices[0].message.content) {
    content.push({ text: completion.choices[0].message.content, type: "text" });
  } else if (completion.choices[0].message.tool_calls) {
    const toolCalls = completion.choices[0].message.tool_calls.map((item) => {
      return {
        type: "tool_use",
        id: item.id,
        name: item.function?.name,
        input: item.function?.arguments ? JSON.parse(item.function.arguments) : {}
      };
    });
    content.push(...toolCalls);
  }
  const result = {
    id: messageId,
    type: "message",
    role: "assistant",
    content,
    stop_reason: completion.choices[0].finish_reason === "tool_calls" ? "tool_use" : "end_turn",
    stop_sequence: null,
    model,
    usage: completion.usage ? {
      input_tokens: completion.usage.prompt_tokens || 0,
      output_tokens: completion.usage.completion_tokens || 0
    } : { input_tokens: 0, output_tokens: 0 }
  };
  return result;
}
__name(formatOpenAIToAnthropic, "formatOpenAIToAnthropic");

// faviconServer.ts
function generateFaviconDataUrl() {
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#f3f4f6"/><text x="16" y="22" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#4285f4" text-anchor="middle">Y</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svgContent)}`;
}
__name(generateFaviconDataUrl, "generateFaviconDataUrl");
var faviconDataUrl = generateFaviconDataUrl();

// indexHtml.ts
var indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Open Claude Router (Local)</title>
    <link rel="shortcut icon" type="image/svg+xml" href="${faviconDataUrl}">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }

        .header {
            background: linear-gradient(45deg, #2c3e50, #3498db);
            color: white;
            text-align: center;
            padding: 40px 20px;
        }

        .header h1 {
            font-size: 2.2em;
            margin-bottom: 10px;
            font-weight: 300;
        }

        .header p {
            font-size: 1.1em;
            opacity: 0.9;
        }

        .content {
            padding: 40px;
        }

        .step {
            margin-bottom: 30px;
            padding: 20px;
            border-left: 4px solid #3498db;
            background: #f8f9fa;
            border-radius: 0 8px 8px 0;
        }

        .step h2 {
            color: #2c3e50;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            font-size: 1.3em;
        }

        .step-number {
            background: #3498db;
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 15px;
            font-weight: bold;
            font-size: 0.9em;
        }

        .code-block {
            background: #2c3e50;
            color: #ecf0f1;
            padding: 15px;
            border-radius: 6px;
            font-family: 'Monaco', 'Menlo', monospace;
            margin: 15px 0;
            overflow-x: auto;
            font-size: 0.9em;
            position: relative;
            white-space: pre;
        }

        .code-block-wrapper {
            position: relative;
        }

        .copy-button {
            position: absolute;
            top: 10px;
            right: 10px;
            background: #3498db;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8em;
            opacity: 0.8;
            transition: opacity 0.2s;
        }

        .copy-button:hover {
            opacity: 1;
            background: #2980b9;
        }

        .copy-button.copied {
            background: #27ae60;
        }

        .note {
            background: #e3f2fd;
            border: 1px solid #bbdefb;
            color: #1565c0;
            padding: 12px;
            border-radius: 6px;
            margin: 10px 0;
            font-size: 0.9em;
        }
        
        .footer-links {
            text-align: center;
            padding: 20px;
            background: #f8f9fa;
            border-top: 1px solid #e9ecef;
        }

        .footer-links a {
            color: #6c757d;
            text-decoration: none;
            margin: 0 15px;
            font-size: 0.9em;
        }

        .footer-links a:hover {
            color: #3498db;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>\u{1F680} Open Claude Router</h1>
            <p>Local Proxy for Claude Code + OpenRouter</p>
        </div>

        <div class="content">
            <div class="step">
                <h2><span class="step-number">1</span>Installation</h2>
                <p>Clone the repository and install dependencies:</p>
                <div class="code-block-wrapper">
                    <div class="code-block">git clone https://github.com/elusznik/open-claude-router.git
cd open-claude-router
npm install</div>
                    <button class="copy-button" onclick="copyToClipboard(this, 'git clone https://github.com/elusznik/open-claude-router.git\\ncd open-claude-router\\nnpm install')">Copy</button>
                </div>
            </div>

            <div class="step">
                <h2><span class="step-number">2</span>Configuration</h2>
                <p>Create a <code>.dev.vars</code> file in the project root:</p>
                <div class="code-block-wrapper">
                    <div class="code-block"># .dev.vars
MODEL_OVERRIDE="x-ai/grok-4.1-fast"
OPENROUTER_API_KEY="sk-or-..."</div>
                    <button class="copy-button" onclick="copyToClipboard(this, 'MODEL_OVERRIDE=&quot;x-ai/grok-4.1-fast&quot;\\nOPENROUTER_API_KEY=&quot;sk-or-...&quot;')">Copy</button>
                </div>
            </div>

            <div class="step">
                <h2><span class="step-number">3</span>Start Router</h2>
                <p>Run the start script to launch the router and automatically configure Claude Code:</p>
                <div class="code-block-wrapper">
                    <div class="code-block">./start-detached.sh</div>
                    <button class="copy-button" onclick="copyToClipboard(this, './start-detached.sh')">Copy</button>
                </div>
                <div class="note">This will backup your settings and point Claude Code to localhost.</div>
            </div>

            <div class="step">
                <h2><span class="step-number">4</span>Stop & Restore</h2>
                <p>When finished, stop the router to restore your original settings:</p>
                <div class="code-block-wrapper">
                    <div class="code-block">./stop-router.sh</div>
                    <button class="copy-button" onclick="copyToClipboard(this, './stop-router.sh')">Copy</button>
                </div>
                <div class="note"><strong>Important:</strong> Always use this script to ensure your config is restored!</div>
            </div>
        </div>

        <div class="footer-links">
            <a href="https://github.com/elusznik/open-claude-router" target="_blank">GitHub</a>
            <a href="https://openrouter.ai" target="_blank">OpenRouter</a>
            <a href="https://claude.ai/code" target="_blank">Claude Code</a>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
        </div>
    </div>

    <script>
        function copyToClipboard(button, text) {
            navigator.clipboard.writeText(text).then(function() {
                button.textContent = 'Copied!';
                button.classList.add('copied');
                setTimeout(function() {
                    button.textContent = 'Copy';
                    button.classList.remove('copied');
                }, 2000);
            }).catch(function(err) {
                console.error('Failed to copy: ', err);
            });
        }
    <\/script>
</body>
</html>`;

// termsHtml.ts
var termsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Terms of Service - open-claude-router</title>
    <link rel="shortcut icon" type="image/svg+xml" href="${faviconDataUrl}">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f8f9fa;
            padding: 20px;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            padding: 40px;
        }

        h1 {
            color: #2c3e50;
            margin-bottom: 10px;
            font-size: 2.5em;
            font-weight: 300;
        }

        .last-updated {
            color: #6c757d;
            margin-bottom: 30px;
            font-size: 0.9em;
        }

        h2 {
            color: #34495e;
            margin-top: 30px;
            margin-bottom: 15px;
            font-size: 1.4em;
        }

        h3 {
            color: #34495e;
            margin-top: 20px;
            margin-bottom: 10px;
            font-size: 1.1em;
        }

        p, li {
            margin-bottom: 10px;
            color: #555;
        }

        ul {
            padding-left: 20px;
        }

        .highlight {
            background: #e3f2fd;
            border-left: 4px solid #2196f3;
            padding: 15px;
            margin: 20px 0;
            border-radius: 0 8px 8px 0;
        }

        .contact {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            padding: 20px;
            border-radius: 8px;
            margin-top: 30px;
        }

        .nav {
            text-align: center;
            margin-bottom: 30px;
        }

        .nav a {
            color: #3498db;
            text-decoration: none;
            margin: 0 15px;
            padding: 5px 10px;
            border-radius: 4px;
            transition: background 0.3s;
        }

        .nav a:hover {
            background: #e3f2fd;
        }

        .footer {
            text-align: center;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #dee2e6;
            color: #6c757d;
            font-size: 0.9em;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="nav">
            <a href="/">Home</a>
            <a href="/terms">Terms of Service</a>
            <a href="/privacy">Privacy Policy</a>
        </div>

        <h1>Terms of Service</h1>
        <div class="last-updated">Last updated: July 12, 2025</div>

        <div class="highlight">
            <strong>Important:</strong> By using open-claude-router (cc.yovy.app), you acknowledge that this is a third-party service not affiliated with Anthropic, OpenAI, or OpenRouter. You use this service at your own risk.
        </div>

        <h2>1. Service Description</h2>
        <p>open-claude-router is an API translation service that converts requests between Anthropic's Claude API format and OpenAI-compatible API formats. The service acts as a proxy to enable compatibility between different API standards.</p>

        <h2>2. Acceptance of Terms</h2>
        <p>By accessing or using open-claude-router, you agree to be bound by these Terms of Service. If you do not agree to these terms, you must not use the service.</p>

        <h2>3. User Responsibilities</h2>
        <h3>3.1 API Key Management</h3>
        <ul>
            <li>You must provide your own valid API keys for third-party services</li>
            <li>You are solely responsible for the security and proper use of your API keys</li>
            <li>You are responsible for all costs and usage associated with your API keys</li>
        </ul>

        <h3>3.2 Compliance</h3>
        <ul>
            <li>You must comply with all applicable laws and regulations</li>
            <li>You must comply with the terms of service of all connected API providers</li>
            <li>You must not use the service for illegal, harmful, or malicious purposes</li>
        </ul>

        <h2>4. Service Limitations</h2>
        <ul>
            <li>open-claude-router is provided "as is" without warranties of any kind</li>
            <li>Service availability is not guaranteed</li>
            <li>We reserve the right to modify, suspend, or discontinue the service at any time</li>
            <li>Rate limits and usage restrictions may apply</li>
        </ul>

        <h2>5. Data and Privacy</h2>
        <ul>
            <li>open-claude-router processes requests in real-time and does not intentionally store user data</li>
            <li>Requests are forwarded to third-party API providers according to their own privacy policies</li>
            <li>You should review the privacy policies of all connected services</li>
        </ul>

        <h2>6. Limitation of Liability</h2>
        <p>open-claude-router, its operators, and contributors shall not be liable for any direct, indirect, incidental, special, or consequential damages resulting from the use or inability to use the service, including but not limited to:</p>
        <ul>
            <li>Data loss or corruption</li>
            <li>Service interruptions</li>
            <li>Cost overruns from API usage</li>
            <li>Violations of third-party terms of service</li>
            <li>Security breaches or unauthorized access</li>
        </ul>

        <h2>7. Indemnification</h2>
        <p>You agree to indemnify and hold harmless open-claude-router and its operators from any claims, damages, or expenses arising from your use of the service or violation of these terms.</p>

        <h2>8. Third-Party Services</h2>
        <p>open-claude-router integrates with third-party API services. Your use of these services through open-claude-router is subject to their respective terms of service and privacy policies. We are not responsible for the actions, policies, or content of third-party services.</p>

        <h2>9. Intellectual Property</h2>
        <p>open-claude-router is open-source software. All trademarks, service marks, and logos used in connection with third-party services are the property of their respective owners.</p>

        <h2>10. Modifications to Terms</h2>
        <p>We reserve the right to modify these terms at any time. Continued use of the service after modifications constitutes acceptance of the updated terms.</p>

        <h2>11. Termination</h2>
        <p>We may terminate or suspend access to the service immediately, without prior notice or liability, for any reason, including if you breach these terms.</p>

        <div class="contact">
            <h3>Contact Information</h3>
            <p>For questions about these Terms of Service, please contact us through the <a href="https://github.com/luohy15/open-claude-router" target="_blank">GitHub repository</a>.</p>
        </div>

        <div class="footer">
            <p>open-claude-router is an independent, open-source project.<br>
            Not affiliated with Anthropic, OpenAI, or OpenRouter.</p>
        </div>
    </div>
</body>
</html>`;

// privacyHtml.ts
var privacyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy - open-claude-router</title>
    <link rel="shortcut icon" type="image/svg+xml" href="${faviconDataUrl}">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f8f9fa;
            padding: 20px;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            padding: 40px;
        }

        h1 {
            color: #2c3e50;
            margin-bottom: 10px;
            font-size: 2.5em;
            font-weight: 300;
        }

        .last-updated {
            color: #6c757d;
            margin-bottom: 30px;
            font-size: 0.9em;
        }

        h2 {
            color: #34495e;
            margin-top: 30px;
            margin-bottom: 15px;
            font-size: 1.4em;
        }

        h3 {
            color: #34495e;
            margin-top: 20px;
            margin-bottom: 10px;
            font-size: 1.1em;
        }

        p, li {
            margin-bottom: 10px;
            color: #555;
        }

        ul {
            padding-left: 20px;
        }

        .highlight {
            background: #e8f5e8;
            border-left: 4px solid #4caf50;
            padding: 15px;
            margin: 20px 0;
            border-radius: 0 8px 8px 0;
        }

        .warning {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            border-radius: 0 8px 8px 0;
        }

        .contact {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            padding: 20px;
            border-radius: 8px;
            margin-top: 30px;
        }

        .nav {
            text-align: center;
            margin-bottom: 30px;
        }

        .nav a {
            color: #3498db;
            text-decoration: none;
            margin: 0 15px;
            padding: 5px 10px;
            border-radius: 4px;
            transition: background 0.3s;
        }

        .nav a:hover {
            background: #e3f2fd;
        }

        .footer {
            text-align: center;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #dee2e6;
            color: #6c757d;
            font-size: 0.9em;
        }

        .data-flow {
            background: #f1f8ff;
            border: 1px solid #c8e1ff;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="nav">
            <a href="/">Home</a>
            <a href="/terms">Terms of Service</a>
            <a href="/privacy">Privacy Policy</a>
        </div>

        <h1>Privacy Policy</h1>
        <div class="last-updated">Last updated: July 12, 2025</div>

        <div class="highlight">
            <strong>Privacy First:</strong> open-claude-router is designed to be a transparent proxy that does not store your data. However, your requests are processed by third-party API providers with their own privacy policies.
        </div>

        <h2>1. Information We Process</h2>
        
        <h3>1.1 What We Process</h3>
        <ul>
            <li>API requests and responses in transit</li>
            <li>Request metadata (timestamps, response codes) for operation</li>
            <li>Technical information required for API format conversion</li>
        </ul>

        <h3>1.2 What We Do NOT Store</h3>
        <ul>
            <li>Your API keys (these are forwarded directly to third-party providers)</li>
            <li>Your conversation content or prompts</li>
            <li>Personal identifying information</li>
            <li>Request history or logs beyond operational necessity</li>
        </ul>

        <h2>2. Data Flow</h2>
        <div class="data-flow">
            <h3>How Your Data Moves:</h3>
            <ol>
                <li><strong>Your Application</strong> \u2192 sends request to open-claude-router</li>
                <li><strong>open-claude-router</strong> \u2192 converts format and forwards to API provider (e.g., OpenRouter)</li>
                <li><strong>API Provider</strong> \u2192 processes request and returns response</li>
                <li><strong>open-claude-router</strong> \u2192 converts response format and returns to you</li>
            </ol>
            <p><em>open-claude-router acts as a pass-through service and does not retain data.</em></p>
        </div>

        <h2>3. Third-Party Services</h2>
        <p>When you use open-claude-router, your data is processed by third-party API providers. These services have their own privacy policies:</p>
        <ul>
            <li><strong>OpenRouter:</strong> <a href="https://openrouter.ai/privacy" target="_blank">Privacy Policy</a></li>
            <li><strong>Anthropic:</strong> <a href="https://www.anthropic.com/privacy" target="_blank">Privacy Policy</a></li>
            <li><strong>Other API Providers:</strong> Review their respective privacy policies</li>
        </ul>

        <div class="warning">
            <strong>Important:</strong> open-claude-router cannot control how third-party API providers handle your data. Please review their privacy policies carefully.
        </div>

        <h2>4. Technical Implementation</h2>
        
        <h3>4.1 Cloudflare Workers</h3>
        <p>open-claude-router runs on Cloudflare Workers, which may temporarily process requests in memory during execution. Cloudflare's privacy practices apply to the infrastructure layer.</p>

        <h3>4.2 No Persistent Storage</h3>
        <p>open-claude-router does not use databases or persistent storage for user data. All processing happens in real-time during request handling.</p>

        <h3>4.3 Logging</h3>
        <p>Minimal operational logs may be kept temporarily for:</p>
        <ul>
            <li>Error debugging and service improvement</li>
            <li>Performance monitoring</li>
            <li>Security and abuse prevention</li>
        </ul>
        <p>These logs do not contain your API keys or conversation content.</p>

        <h2>5. Your Rights and Choices</h2>
        
        <h3>5.1 Self-Hosting</h3>
        <p>For maximum privacy control, you can deploy open-claude-router yourself:</p>
        <ul>
            <li>Full control over your data processing</li>
            <li>No shared infrastructure</li>
            <li>Complete transparency through open-source code</li>
        </ul>

        <h3>5.2 API Key Security</h3>
        <p>Best practices for protecting your privacy:</p>
        <ul>
            <li>Use API keys with minimal necessary permissions</li>
            <li>Regularly rotate your API keys</li>
            <li>Monitor API usage through provider dashboards</li>
        </ul>

        <h2>6. Data Security</h2>
        
        <h3>6.1 In Transit</h3>
        <ul>
            <li>All communications use HTTPS encryption</li>
            <li>API keys are transmitted securely</li>
            <li>No data is cached or stored during transit</li>
        </ul>

        <h3>6.2 Service Security</h3>
        <ul>
            <li>Regular security updates to dependencies</li>
            <li>Minimal attack surface through simple proxy design</li>
            <li>No user authentication or session management</li>
        </ul>

        <h2>7. International Data Transfers</h2>
        <p>open-claude-router may process data in various geographic locations through Cloudflare's global network. Third-party API providers may also process data internationally according to their own policies.</p>

        <h2>8. Children's Privacy</h2>
        <p>open-claude-router is not intended for use by children under 13 years of age. We do not knowingly collect or process information from children.</p>

        <h2>9. Changes to This Policy</h2>
        <p>We may update this privacy policy periodically. Material changes will be reflected by updating the "Last updated" date. Your continued use of the service constitutes acceptance of any changes.</p>

        <h2>10. Compliance and Transparency</h2>
        <p>open-claude-router is designed with privacy-by-design principles:</p>
        <ul>
            <li>Minimize data processing</li>
            <li>Open-source transparency</li>
            <li>No unnecessary data collection</li>
            <li>User control through self-hosting options</li>
        </ul>

        <div class="contact">
            <h3>Contact Information</h3>
            <p>For privacy-related questions or concerns:</p>
            <ul>
                <li>GitHub Issues: <a href="https://github.com/luohy15/open-claude-router/issues" target="_blank">Report privacy concerns</a></li>
                <li>General inquiries: Through GitHub repository</li>
            </ul>
            <p><strong>Data Subject Requests:</strong> Since open-claude-router does not store personal data, most data subject requests should be directed to the relevant third-party API providers.</p>
        </div>

        <div class="footer">
            <p>open-claude-router is an independent, open-source project.<br>
            Not affiliated with Anthropic, OpenAI, or OpenRouter.</p>
        </div>
    </div>
</body>
</html>`;

// installSh.ts
var installSh = `#!/bin/bash

set -e

install_nodejs() {
    local platform=$(uname -s)
    
    case "$platform" in
        Linux|Darwin)
            echo "\u{1F680} Installing Node.js on Unix/Linux/macOS..."
            
            echo "\u{1F4E5} Downloading and installing nvm..."
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
            
            echo "\u{1F504} Loading nvm environment..."
            \\. "$HOME/.nvm/nvm.sh"
            
            echo "\u{1F4E6} Downloading and installing Node.js v22..."
            nvm install 22
            
            echo -n "\u2705 Node.js installation completed! Version: "
            node -v # Should print "v22.17.0".
            echo -n "\u2705 Current nvm version: "
            nvm current # Should print "v22.17.0".
            echo -n "\u2705 npm version: "
            npm -v # Should print "10.9.2".
            ;;
        *)
            echo "Unsupported platform: $platform"
            exit 1
            ;;
    esac
}

# Check if Node.js is already installed and version is >= 18
if command -v node >/dev/null 2>&1; then
    current_version=$(node -v | sed 's/v//')
    major_version=$(echo $current_version | cut -d. -f1)
    
    if [ "$major_version" -ge 18 ]; then
        echo "Node.js is already installed: v$current_version"
    else
        echo "Node.js v$current_version is installed but version < 18. Upgrading..."
        install_nodejs
    fi
else
    echo "Node.js not found. Installing..."
    install_nodejs
fi

# Check if Claude Code is already installed
if command -v claude >/dev/null 2>&1; then
    echo "Claude Code is already installed: $(claude --version)"
else
    echo "Claude Code not found. Installing..."
    npm install -g @anthropic-ai/claude-code
fi

# Configure Claude Code to skip onboarding
echo "Configuring Claude Code to skip onboarding..."
node --eval '
    const homeDir = os.homedir(); 
    const filePath = path.join(homeDir, ".claude.json");
    if (fs.existsSync(filePath)) {
        const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        fs.writeFileSync(filePath,JSON.stringify({ ...content, hasCompletedOnboarding: true }, 2), "utf-8");
    } else {
        fs.writeFileSync(filePath,JSON.stringify({ hasCompletedOnboarding: true }), "utf-8");
    }'

# Provider selection
echo "\u{1F527} Please select your AI provider:"
echo "1) OpenRouter (default)"
echo "2) Moonshot"
echo ""
read -p "Enter your choice [1]: " provider_choice
provider_choice=\${provider_choice:-1}
echo ""

case "$provider_choice" in
    1)
        provider="openrouter"
        default_base_url="http://localhost:8787"
        api_key_url="https://openrouter.ai/keys"
        default_model_main="anthropic/claude-sonnet-4"
        default_model_small="anthropic/claude-3.5-haiku"
        ;;
    2)
        provider="moonshot"
        echo "\u{1F527} Please select your Moonshot endpoint:"
        echo "1) Global (api.moonshot.ai)"
        echo "2) China (api.moonshot.cn)"
        echo ""
        read -p "Enter your choice [1]: " moonshot_endpoint_choice
        moonshot_endpoint_choice=\${moonshot_endpoint_choice:-1}
        
        case "$moonshot_endpoint_choice" in
            1)
                default_base_url="https://api.moonshot.ai/anthropic/"
                api_key_url="https://platform.moonshot.ai/console/api-keys"
                pricing_url="https://platform.moonshot.ai/docs/pricing/limits"
                ;;
            2)
                default_base_url="https://api.moonshot.cn/anthropic/"
                api_key_url="https://platform.moonshot.cn/console/api-keys"
                pricing_url="https://platform.moonshot.cn/docs/pricing/limits"
                ;;
            *)
                echo "\u26A0\uFE0F  Invalid choice. Using Global (.ai) endpoint as default."
                default_base_url="https://api.moonshot.ai/anthropic/"
                api_key_url="https://platform.moonshot.ai/console/api-keys"
                pricing_url="https://platform.moonshot.ai/docs/pricing/limits"
                ;;
        esac
        
        echo ""
        echo "\u26A0\uFE0F  Important: Moonshot requires account credit before use"
        echo "   You must add funds to your account first, otherwise you'll get rate limit errors"
        echo "   Pricing info: $pricing_url"
        echo ""
        
        default_model_main="kimi-k2-0711-preview"
        default_model_small="moonshot-v1-8k"
        ;;
    *)
        echo "\u26A0\uFE0F  Invalid choice. Please run the script again and select 1 or 2."
        exit 1
        ;;
esac

# Prompt for configuration with defaults
echo "\u2699\uFE0F  Configure your $provider settings (press Enter to use defaults):"
echo ""

read -p "Base URL [$default_base_url]: " base_url
echo ""
base_url=\${base_url:-$default_base_url}

echo "\u{1F511} Please enter your $provider API key:"
echo "   You can get your API key from: $api_key_url"
echo "   Note: The input is hidden for security. Please paste your API key directly."
echo ""
read -s api_key
echo "\u2705 API key received (\${#api_key} characters)"
echo ""

if [ -z "$api_key" ]; then
    echo "\u26A0\uFE0F  API key cannot be empty. Please run the script again."
    exit 1
fi

read -p "Main model [$default_model_main]: " model_main
model_main=\${model_main:-$default_model_main}

read -p "Small/fast model [$default_model_small]: " model_small
model_small=\${model_small:-$default_model_small}

# Identify rc files to update
rc_files=()
if [ -f "$HOME/.bashrc" ]; then
    rc_files+=("$HOME/.bashrc")
fi
if [ -f "$HOME/.zshrc" ]; then
    rc_files+=("$HOME/.zshrc")
fi

if [ \${#rc_files[@]} -eq 0 ]; then
    # Fallback to profile if no rc files found
    rc_files+=("$HOME/.profile")
fi

# Add environment variables to rc files
for rc_file in "\${rc_files[@]}"; do
    echo ""
    echo "\u{1F4DD} Configuring environment variables in $rc_file..."

    # Create backup if file exists
    if [ -f "$rc_file" ]; then
        cp "$rc_file" "\${rc_file}.backup.$(date +%Y%m%d_%H%M%S)"
    fi

    # Remove existing Claude Code environment variables
    if [ -f "$rc_file" ]; then
        # Use a temporary file to store content without Claude Code variables
        grep -v "^# Claude Code environment variables\\|^export ANTHROPIC_BASE_URL\\|^export ANTHROPIC_API_KEY\\|^export ANTHROPIC_MODEL\\|^export ANTHROPIC_SMALL_FAST_MODEL" "$rc_file" > "\${rc_file}.tmp" || true
        mv "\${rc_file}.tmp" "$rc_file"
    fi

    # Add new environment variables
    echo "" >> "$rc_file"
    echo "# Claude Code environment variables for $provider" >> "$rc_file"
    echo "export ANTHROPIC_BASE_URL=$base_url" >> "$rc_file"
    echo "export ANTHROPIC_API_KEY=$api_key" >> "$rc_file"
    echo "export ANTHROPIC_MODEL=$model_main" >> "$rc_file"
    echo "export ANTHROPIC_SMALL_FAST_MODEL=$model_small" >> "$rc_file"
    echo "\u2705 Environment variables configured in $rc_file"
done

echo ""
echo "\u{1F389} Installation completed successfully!"
echo ""
echo "\u{1F504} Please restart your terminal or run:"
if [[ " \${rc_files[*]} " =~ " $HOME/.zshrc " ]]; then
    echo "   source ~/.zshrc"
elif [[ " \${rc_files[*]} " =~ " $HOME/.bashrc " ]]; then
    echo "   source ~/.bashrc"
else
    echo "   source \${rc_files[0]}"
fi
echo ""
echo "\u{1F680} Then you can start using Claude Code with:"
echo "   claude"
echo ""
echo "\u{1F4A1} Tip: To maintain multiple configurations, use shell aliases:"
echo "   alias c1='ANTHROPIC_BASE_URL=\\"http://localhost:8787\\" ANTHROPIC_API_KEY=\\"key1\\" ANTHROPIC_MODEL=\\"moonshotai/kimi-k2\\" ANTHROPIC_SMALL_FAST_MODEL=\\"google/gemini-2.5-flash\\" claude'"
echo "   alias c2='ANTHROPIC_BASE_URL=\\"https://api.moonshot.ai/anthropic/\\" ANTHROPIC_API_KEY=\\"key2\\" ANTHROPIC_MODEL=\\"kimi-k2-0711-preview\\" ANTHROPIC_SMALL_FAST_MODEL=\\"moonshot-v1-8k\\" claude'"
`;

// index.ts
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html" }
      });
    }
    if (url.pathname === "/terms" && request.method === "GET") {
      return new Response(termsHtml, {
        headers: { "Content-Type": "text/html" }
      });
    }
    if (url.pathname === "/privacy" && request.method === "GET") {
      return new Response(privacyHtml, {
        headers: { "Content-Type": "text/html" }
      });
    }
    if (url.pathname === "/install.sh" && request.method === "GET") {
      return new Response(installSh, {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
    if (url.pathname === "/v1/messages" && request.method === "POST") {
      const anthropicRequest = await request.json();
      const openaiRequest = formatAnthropicToOpenAI(anthropicRequest, env.MODEL_OVERRIDE);
      const bearerToken = env.OPENROUTER_API_KEY || request.headers.get("X-Api-Key") || request.headers.get("Authorization")?.replace("Bearer ", "");
      if (!bearerToken) {
        return new Response(JSON.stringify({
          error: { type: "authentication_error", message: "No API key provided" }
        }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }
      const baseUrl = env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
      const abortController = new AbortController();
      const signal = abortController.signal;
      request.signal.addEventListener("abort", () => {
        abortController.abort();
      }, { once: true });
      let openaiResponse;
      try {
        openaiResponse = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${bearerToken}`
          },
          body: JSON.stringify(openaiRequest),
          signal
        });
      } catch (fetchErr) {
        console.error("fetch to OpenRouter failed:", fetchErr?.message || fetchErr);
        if (fetchErr?.name === "AbortError") {
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
        const errBody = await openaiResponse.text().catch(() => "unknown error");
        return new Response(errBody, { status: openaiResponse.status });
      }
      if (openaiRequest.stream) {
        try {
          const anthropicStream = streamOpenAIToAnthropic(
            openaiResponse.body,
            openaiRequest.model,
            signal
          );
          return new Response(anthropicStream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive"
            }
          });
        } catch (streamErr) {
          console.error("stream creation failed:", streamErr?.message || streamErr);
          return new Response(JSON.stringify({
            error: { type: "stream_error", message: streamErr?.message || "Stream processing failed" }
          }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      } else {
        let openaiData;
        try {
          openaiData = await openaiResponse.json();
        } catch (jsonErr) {
          console.error("failed to parse upstream JSON response:", jsonErr?.message || jsonErr);
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
    if (url.pathname === "/v1/messages/count_tokens" && request.method === "POST") {
      const body = await request.json();
      let charCount = 0;
      if (body.system) {
        if (typeof body.system === "string") charCount += body.system.length;
        else if (Array.isArray(body.system)) {
          charCount += body.system.reduce((acc, part) => acc + (part.text?.length || 0), 0);
        }
      }
      if (body.messages) {
        for (const msg of body.messages) {
          if (typeof msg.content === "string") charCount += msg.content.length;
          else if (Array.isArray(msg.content)) {
            charCount += msg.content.reduce((acc, part) => acc + (part.text?.length || 0), 0);
          }
        }
      }
      const input_tokens = Math.ceil(charCount / 4);
      return new Response(JSON.stringify({ input_tokens }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("Not Found", { status: 404 });
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-ahDlN9/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = index_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-ahDlN9/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
