#!/bin/bash

# This script should be sourced: source ./activate-lm-studio.sh
# It configures Claude Code to use a local LM Studio server as the backend.

# 1. Start the router if not already running
if [ ! -f router.pid ]; then
    echo "🚀 Starting router in LM Studio mode..."
    PROVIDER=lm-studio LM_STUDIO_BASE_URL="http://127.0.0.1:1234" nohup npm run server > router.log 2>&1 &
    echo $! > router.pid
    echo "✅ Router started (PID: $(cat router.pid))"
else
    echo "ℹ️  Router is already running (PID: $(cat router.pid))"
fi

# 2. Read configuration from .dev.vars
OVERRIDE_MODEL=""
if [ -f .dev.vars ]; then
    OVERRIDE_MODEL=$(grep "^LM_STUDIO_MODEL=" .dev.vars | sed -E 's/LM_STUDIO_MODEL="(.*)"/\1/')
fi

# 3. Set Environment Variables
export ANTHROPIC_BASE_URL="http://localhost:8787"
echo "🔗 Set ANTHROPIC_BASE_URL to http://localhost:8787"

# Claude Code does not need an API key for local LM Studio
echo "🔑 No API key needed (local LM Studio)"

if [ -n "$OVERRIDE_MODEL" ]; then
    export ANTHROPIC_MODEL="$OVERRIDE_MODEL"
    echo "🎭 Set ANTHROPIC_MODEL to $OVERRIDE_MODEL (from .dev.vars)"
else
    echo "💡 Tip: Set LM_STUDIO_MODEL=\"model-name\" in .dev.vars to pick a model"
fi

# 4. Define a deactivate function
deactivate_router() {
    if [ -f router.pid ]; then
        PID=$(cat router.pid)
        if ps -p $PID > /dev/null; then
            kill $PID
            echo "🛑 Router stopped (PID: $PID)"
        fi
        rm router.pid
    fi

    unset ANTHROPIC_BASE_URL
    unset ANTHROPIC_MODEL

    unset -f deactivate_router

    echo "🔙 Environment restored to stock."
}

echo ""
echo "🌟 LM Studio router environment activated!"
echo "   Make sure LM Studio is running on http://127.0.0.1:1234"
echo "   Run 'claude' to use the local model."
echo "   Run 'deactivate_router' to stop the router and restore settings."
