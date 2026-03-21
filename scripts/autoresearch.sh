#!/bin/bash
# WiseChef AutoResearch — Self-improving agent prompts
# Evaluates task completion rate, mutates prompts, logs changes
# Runs daily via cron
set -euo pipefail

WORKSPACE="${WORKSPACE:-/opt/wisechef/clawd}"
BOARD_URL="${BOARD_URL:-http://localhost:3333}"
LOG_DIR="$WORKSPACE/autoresearch"
SOUL_FILE="$WORKSPACE/SOUL.md"
HISTORY="$LOG_DIR/research-log.jsonl"
EVALS="$LOG_DIR/evals.json"

mkdir -p "$LOG_DIR"

echo "[$(date -Iseconds)] AutoResearch run starting"

# Step 1: Pull completion rate from Paperclip
COMPLETION=$(curl -s "$BOARD_URL/api/tasks/completion-rate" 2>/dev/null || echo '{}')
RATE=$(echo "$COMPLETION" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('rate', 0))" 2>/dev/null || echo "0")
RUNS_RATE=$(echo "$COMPLETION" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('runs',{}).get('rate', 0))" 2>/dev/null || echo "0")

echo "  Task completion rate: ${RATE}%"
echo "  Run success rate: ${RUNS_RATE}%"

# Step 2: Binary eval — 10 yes/no questions about the current SOUL.md
if [ ! -f "$SOUL_FILE" ]; then
  echo "  ⚠️ No SOUL.md found, skipping eval"
  exit 0
fi

SOUL_CONTENT=$(cat "$SOUL_FILE")

# Generate eval via OpenRouter (minimax or gpt-4o)
EVAL_RESULT=$(curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY:-}" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
soul = open('$SOUL_FILE').read()
prompt = '''Rate this AI agent SOUL.md on these 10 binary criteria. Answer ONLY with a JSON object: {\"q1\": true/false, ..., \"q10\": true/false, \"score\": <0-10>}

Questions:
1. Does it define a clear role/identity?
2. Does it specify communication style?
3. Does it mention task execution patterns?
4. Does it include error handling guidance?
5. Does it mention proactive behavior?
6. Does it reference knowledge management (memory/Cognee)?
7. Does it mention channel awareness (messaging platforms)?
8. Does it include self-improvement directives?
9. Does it specify boundaries/safety rules?
10. Does it mention team coordination (multi-agent)?

SOUL.md content:
\"\"\"
''' + soul[:3000] + '''
\"\"\"

Respond with ONLY the JSON object.'''

payload = {
    'model': 'openai/gpt-4o',
    'messages': [{'role': 'user', 'content': prompt}],
    'temperature': 0.1,
    'max_tokens': 200,
}
print(json.dumps(payload))
")" 2>/dev/null | python3 -c "
import sys, json
try:
    resp = json.load(sys.stdin)
    content = resp['choices'][0]['message']['content']
    # Extract JSON from potential markdown wrapping
    tick = chr(96) * 3
    if tick in content:
        content = content.split(tick)[1].split(tick)[0]
        if content.startswith('json'):
            content = content[4:]
    print(content.strip())
except:
    print('{}')
" 2>/dev/null || echo '{}')

echo "  Eval result: $EVAL_RESULT"

# Step 3: Log the run
TIMESTAMP=$(date -Iseconds)
echo "{\"timestamp\":\"$TIMESTAMP\",\"completion_rate\":$RATE,\"runs_rate\":$RUNS_RATE,\"eval\":$EVAL_RESULT}" >> "$HISTORY"

# Step 4: Check if we should mutate
SCORE=$(echo "$EVAL_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('score',5))" 2>/dev/null || echo "5")

if [ "$SCORE" -lt 7 ] || [ "$RATE" -lt 60 ]; then
  echo "  📝 Score $SCORE/10 or completion $RATE% < threshold — generating improvement suggestions"
  
  # Get last 5 runs for context
  RECENT=$(tail -5 "$HISTORY" 2>/dev/null || echo "[]")
  
  SUGGESTIONS=$(curl -s https://openrouter.ai/api/v1/chat/completions \
    -H "Authorization: Bearer ${OPENROUTER_API_KEY:-}" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json
soul = open('$SOUL_FILE').read()
prompt = '''You are an AI prompt optimizer. Based on these metrics and the current SOUL.md, suggest 3 specific improvements.

Current metrics:
- Task completion rate: ${RATE}%
- Eval score: ${SCORE}/10
- Recent history: $RECENT

Current SOUL.md:
\"\"\"
''' + soul[:2000] + '''
\"\"\"

Output exactly 3 bullet points of concrete changes. Be specific about what text to add/change.'''

payload = {
    'model': 'openai/gpt-4o',
    'messages': [{'role': 'user', 'content': prompt}],
    'temperature': 0.7,
    'max_tokens': 500,
}
print(json.dumps(payload))
")" 2>/dev/null | python3 -c "
import sys, json
try:
    resp = json.load(sys.stdin)
    print(resp['choices'][0]['message']['content'])
except:
    print('No suggestions available')
" 2>/dev/null || echo "No suggestions")

  echo "$SUGGESTIONS"
  
  # Save suggestions for manual review
  echo "---" >> "$LOG_DIR/suggestions.md"
  echo "## $(date '+%Y-%m-%d %H:%M') — Score: $SCORE/10, Completion: $RATE%" >> "$LOG_DIR/suggestions.md"
  echo "$SUGGESTIONS" >> "$LOG_DIR/suggestions.md"
  echo "" >> "$LOG_DIR/suggestions.md"
else
  echo "  ✅ Score $SCORE/10 and completion $RATE% — no changes needed"
fi

echo "[$(date -Iseconds)] AutoResearch run complete"
