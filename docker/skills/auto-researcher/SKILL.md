---
name: auto-researcher
description: >
  Autonomous deep research on any topic. Combines web search, content extraction,
  and synthesis into structured research reports. Use when: user wants to research
  a topic, investigate a competitor, prepare a market analysis, or gather information
  from multiple sources. Outputs: structured research report with citations.
---

# Auto-Researcher

Autonomous deep research agent. Give it a topic → get a structured report with sources.

## How It Works

The research loop:
1. **Formulate queries** — Break the topic into 3-5 specific search queries
2. **Search** — Run each query via web search
3. **Extract** — Fetch and extract content from top results
4. **Synthesize** — Combine findings into a structured report
5. **Identify gaps** — Find unanswered questions → loop back to step 1
6. **Output** — Final report with sections, findings, and citations

## Usage

When asked to research something, follow this protocol:

### Step 1: Scope the Research
Ask (or infer):
- **Topic**: What exactly to research
- **Depth**: Quick overview (5 min) or deep dive (30+ min)
- **Focus**: Specific angles to cover
- **Output format**: Report, bullet points, comparison table

### Step 2: Generate Search Queries
Break the topic into 3-5 specific queries. Good queries:
- Include specific terms, not vague ones
- Cover different angles (definition, comparison, recent news, expert opinions)
- Use operators when helpful ("X vs Y", "best X for Y", "X problems 2026")

### Step 3: Search and Extract
For each query:
1. Use `web_search` to find relevant results
2. Pick the top 2-3 most relevant URLs
3. Use `web_fetch` to extract content from each
4. If web_fetch fails (JS-heavy page), try `scrapling` skill
5. Save key findings with source URL

### Step 4: Synthesize
Combine all findings into structured output:
```markdown
# Research Report: [Topic]
**Date:** [date]
**Depth:** [quick/deep]

## Executive Summary
[2-3 sentence overview]

## Key Findings
### [Finding 1]
[details with inline citations]

### [Finding 2]
[details with inline citations]

## Comparison Table (if applicable)
| Aspect | Option A | Option B |
|--------|----------|----------|

## Gaps & Unknowns
- [things that couldn't be confirmed]

## Sources
1. [URL] — [what it contributed]
2. [URL] — [what it contributed]
```

### Step 5: Gap Analysis
After initial synthesis, identify:
- Contradictions between sources
- Missing perspectives
- Questions raised but not answered

For deep research: run another search cycle targeting gaps.

## Best Practices
- **Cite everything** — no unsourced claims
- **Note contradictions** — when sources disagree, note both sides
- **Date-stamp findings** — information freshness matters
- **Prefer primary sources** — official docs > blog posts > forums
- **Cross-reference** — verify claims across 2+ sources
- **Save to file** — write report to `research/[topic]-[date].md`

## Integration with WiseChef
- Research results saved to workspace for agent memory
- Can be triggered via task board or direct request
- Integrates with Cognee knowledge graph for persistent storage
- Use `scrapling` for JS-heavy sites (X/Twitter, SPAs)
