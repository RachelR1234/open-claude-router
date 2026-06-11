#!/bin/bash

# Interactive launcher for open-claude-router
# Usage: source ./start.sh
# Provides a menu to select provider (OpenRouter / LM Studio) and model.
# Compatible with both bash and zsh.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Helper: portable "read with prompt" that works in both bash and zsh
read_prompt() {
  local prompt="$1"
  local varname="$2"
  printf "%s " "$prompt"
  read -r "$varname"
}

# ────────────────────────────────────────────────────────────────────
# 1. Provider selection
# ────────────────────────────────────────────────────────────────────
echo "🔌 Select provider:"
echo "  1) OpenRouter  (cloud, requires API key)"
echo "  2) LM Studio   (local, http://127.0.0.1:1234)"
echo ""
read_prompt "Enter choice [1]:" provider_choice
provider_choice=${provider_choice:-1}
echo ""

case "$provider_choice" in
  1)
    PROVIDER="openrouter"
    ;;
  2)
    PROVIDER="lm-studio"
    ;;
  *)
    echo "⚠️  Invalid choice, defaulting to OpenRouter."
    PROVIDER="openrouter"
    ;;
esac

# ────────────────────────────────────────────────────────────────────
# 2. Model selection
# ────────────────────────────────────────────────────────────────────
MODEL=""

if [ "$PROVIDER" = "openrouter" ]; then
  # OpenRouter: pick model from models.json
  echo "📦 Loading OpenRouter models..."

  # Ask paid or free
  echo "💵 Select model tier:"
  echo "  1) Paid models (default)"
  echo "  2) Free models only"
  echo ""
  read_prompt "Enter choice [1]:" tier_choice
  tier_choice=${tier_choice:-1}
  echo ""

  if [ "$tier_choice" = "2" ]; then
    # Only show free models known to work with Claude Code
    node -e "
const data = require('./models.json');
const free = data.data.filter(m => m.id.endsWith(':free'));
console.log('\\nFree models (' + free.length + ' available):');
free.forEach((m, i) => console.log('  ' + (i+1) + ') ' + m.name));
console.log('  a) Enter custom model ID');
" 2>/dev/null
    FREE_COUNT=$(node -p "require('./models.json').data.filter(m=>m.id.endsWith(':free')).length" 2>/dev/null)
  else
    # Paid curated shortlist — sorted by price from lowest to highest
    node -e "
const data = require('./models.json');
const curated = [
  'openai/gpt-oss-20b',
  'amazon/nova-micro-v1',
  'google/gemma-3-12b-it',
  'qwen/qwen3-30b-a3b',
  'mistralai/mistral-small-3.2-24b-instruct',
  'deepseek/deepseek-v3.2-exp',
  'qwen/qwen3-coder-flash',
  'google/gemini-2.5-flash',
  'openai/gpt-5.1-codex-mini',
  'qwen/qwen3-coder-plus',
  'openai/gpt-5.1-codex',
  'google/gemini-2.5-pro',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-haiku-4.5',
];
// Sort by actual price
const models = data.data;
const withPrice = curated.map(id => {
  const m = models.find(x => x.id === id);
  return { id, name: m ? m.name : id, price: parseFloat(m?.pricing?.prompt || 0) + parseFloat(m?.pricing?.completion || 0) };
});
withPrice.sort((a, b) => a.price - b.price);
console.log('\\nQuick picks (sorted by price, cheapest first):');
withPrice.forEach((m, i) => console.log('  ' + (i+1) + ') [' + m.price.toFixed(7) + '/tok] ' + m.name));
console.log('  0) Show all models');
console.log('  a) Enter custom model ID');
" 2>/dev/null
  fi

  read_prompt "Select model [1]:" model_pick
  model_pick=${model_pick:-1}
  echo ""

  # Determine curated list size
  CURATED_SIZE=14
  if [ "$tier_choice" = "2" ]; then CURATED_SIZE=${FREE_COUNT:-0}; fi

  # If number out of curated range, treat as "show all"
  if [ "$model_pick" != "a" ] && [ "$model_pick" != "0" ] && [ "$model_pick" -gt "$CURATED_SIZE" ] 2>/dev/null; then
    model_pick="0"
  fi

  if [ "$model_pick" = "a" ]; then
    read_prompt "Enter custom model ID (e.g. anthropic/claude-sonnet-4):" MODEL
  elif [ "$model_pick" = "0" ]; then
    if [ "$tier_choice" = "2" ]; then
      node -p "
const data = require('./models.json');
data.data.filter(m => m.id.endsWith(':free')).map((m, i) => (i+1) + ') ' + m.name + ' (' + m.id + ')').join('\n');
" 2>/dev/null
    else
      node -p "
const data = require('./models.json');
data.data.map((m, i) => (i+1) + ') ' + m.id + '  —  ' + m.name).join('\n');
" 2>/dev/null
    fi
    echo ""
    read_prompt "Enter the number of the model you want:" model_num
    MODEL=$(node -p "
const data = require('./models.json');
const all = data.data;
const filtered = '${tier_choice}' === '2' ? all.filter(m => m.id.endsWith(':free')) : all;
const idx = parseInt('${model_num}') - 1;
filtered[idx] ? filtered[idx].id : '';
" 2>/dev/null)
  else
    if [ "$tier_choice" = "2" ]; then
      MODEL=$(node -p "
const data = require('./models.json');
const free = data.data.filter(m => m.id.endsWith(':free'));
const idx = parseInt('${model_pick}') - 1;
(free[idx] || free[0]).id;
" 2>/dev/null)
    else
      MODEL=$(node -p "
const data = require('./models.json');
const all = data.data;
const curated = [
  'openai/gpt-oss-20b',
  'amazon/nova-micro-v1',
  'google/gemma-3-12b-it',
  'qwen/qwen3-30b-a3b',
  'mistralai/mistral-small-3.2-24b-instruct',
  'deepseek/deepseek-v3.2-exp',
  'qwen/qwen3-coder-flash',
  'google/gemini-2.5-flash',
  'openai/gpt-5.1-codex-mini',
  'qwen/qwen3-coder-plus',
  'openai/gpt-5.1-codex',
  'google/gemini-2.5-pro',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-haiku-4.5',
];
const withPrice = curated.map(id => {
  const m = all.find(x => x.id === id);
  return { id, price: parseFloat(m?.pricing?.prompt || 0) + parseFloat(m?.pricing?.completion || 0) };
});
withPrice.sort((a, b) => a.price - b.price);
const idx = parseInt('${model_pick}') - 1;
(withPrice[idx] || withPrice[0]).id;
" 2>/dev/null)
    fi
  fi

  if [ -z "$MODEL" ]; then
    MODEL="openai/gpt-5.1-codex"
  fi

# Strip :free suffix — OpenRouter uses it for routing, but the actual model id has no suffix
MODEL="${MODEL%:free}"

  # API key — use existing env var or prompt
  if [ -z "$OPENROUTER_API_KEY" ]; then
    echo "🔑 No OPENROUTER_API_KEY set in environment."
    echo "   Enter your OpenRouter API key:"
    echo "   (Get one at https://openrouter.ai/keys)"
    read_prompt "API key:" api_key
    echo ""
    if [ -n "$api_key" ]; then
      export OPENROUTER_API_KEY="$api_key"
    fi
  else
    echo "🔑 Using OPENROUTER_API_KEY from environment"
  fi

else
  # LM Studio
  echo "🌐 LM Studio server address:"
  read_prompt "Base URL [http://127.0.0.1:1234]:" lm_base
  lm_base=${lm_base:-"http://127.0.0.1:1234"}
  export LM_STUDIO_BASE_URL="$lm_base"

  echo ""
  echo "🤖 Enter the model name loaded in LM Studio"
  echo "   (leave empty to use whatever LM Studio has as default)"
  read_prompt "Model:" lm_model
  if [ -n "$lm_model" ]; then
    MODEL="$lm_model"
    export LM_STUDIO_MODEL="$lm_model"
  fi
fi

# ────────────────────────────────────────────────────────────────────
# 3. Stop any existing router
# ────────────────────────────────────────────────────────────────────
if [ -f router.pid ]; then
    OLD_PID=$(cat router.pid)
    if ps -p $OLD_PID > /dev/null 2>&1; then
        echo "🛑 Stopping existing router (PID: $OLD_PID)..."
        kill $OLD_PID 2>/dev/null
        sleep 1
    fi
    rm -f router.pid
fi

# ────────────────────────────────────────────────────────────────────
# 4. Start the router with the chosen config
# ────────────────────────────────────────────────────────────────────
export PROVIDER
export MODEL_OVERRIDE="$MODEL"

echo ""
echo "🚀 Starting router..."
echo "   Provider:     $PROVIDER"
echo "   Model:        ${MODEL:-"(default)"}"
if [ "$PROVIDER" = "lm-studio" ]; then
  echo "   LM Studio:    $LM_STUDIO_BASE_URL"
fi

nohup npm run server > router.log 2>&1 &
echo $! > router.pid
echo "✅ Router started (PID: $(cat router.pid))"

# ────────────────────────────────────────────────────────────────────
# 5. Update ~/.claude/settings.json with the selected model
# ────────────────────────────────────────────────────────────────────
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
if [ -f "$CLAUDE_SETTINGS" ]; then
  node -e "
const fs = require('fs');
const p = '$CLAUDE_SETTINGS';
let c = JSON.parse(fs.readFileSync(p, 'utf-8'));
if (!c.env) c.env = {};
c.env.ANTHROPIC_BASE_URL = 'http://localhost:8787';
if ('$MODEL') {
  c.env.ANTHROPIC_MODEL = '$MODEL';
} else {
  delete c.env.ANTHROPIC_MODEL;
}
fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
" 2>/dev/null
  if [ -n "$MODEL" ]; then
    echo "📝 Updated ~/.claude/settings.json with model: $MODEL"
  fi
fi

# Also set env vars for this shell session
export ANTHROPIC_BASE_URL="http://localhost:8787"
if [ -n "$MODEL" ]; then
    export ANTHROPIC_MODEL="$MODEL"
    echo "🔗 Set ANTHROPIC_MODEL=$MODEL"
fi

# ────────────────────────────────────────────────────────────────────
# 6. Define deactivate function (zsh-compatible)
# ────────────────────────────────────────────────────────────────────
deactivate_router() {
    if [ -f router.pid ]; then
        PID=$(cat router.pid)
        if ps -p $PID > /dev/null 2>&1; then
            kill $PID
            echo "🛑 Router stopped (PID: $PID)"
        fi
        rm -f router.pid
    fi

    unset ANTHROPIC_BASE_URL
    unset ANTHROPIC_MODEL
    unset PROVIDER
    unset MODEL_OVERRIDE
    unset OPENROUTER_API_KEY
    unset LM_STUDIO_BASE_URL
    unset LM_STUDIO_MODEL

    # Restore original settings.json
    if [ -f "$CLAUDE_SETTINGS" ]; then
      node -e "
const fs = require('fs');
const p = '$CLAUDE_SETTINGS';
let c = JSON.parse(fs.readFileSync(p, 'utf-8'));
if (c.env) {
  delete c.env.ANTHROPIC_BASE_URL;
  delete c.env.ANTHROPIC_MODEL;
}
fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
" 2>/dev/null
    fi

    # zsh and bash differ on unset -f; this works in both
    unset deactivate_router 2>/dev/null || true

    echo "🔙 Environment restored."
}

echo ""
echo "🌟 Ready! Run 'claude' to start Claude Code with the selected config."
echo "   Run 'deactivate_router' to stop the router and restore settings."
