# Task Chain: Breaking Down an ACL or Policy Letter

## Task Type
Distill

## Purpose
All-County Letters (ACLs) from CDSS are dense, regulatory documents written for compliance purposes, not for operational use. They typically contain implementation requirements, deadlines, regulatory citations, and technical guidance that frontline supervisors and managers need to act on — but can't easily extract from the original document. This task chain helps HHS managers convert an ACL into actionable plain-language guidance.

## Intake Question
"Upload the ACL below, or paste the text. I'll break it into plain language with action items and deadlines flagged."

## Full Prompt Chain

**Role:** Act as a policy analyst and HHS operations expert who specializes in translating regulatory documents into operational guidance.

**Instruction:** Read this ACL carefully and produce the following:
1. One-paragraph plain-language summary (what this letter is about and why it matters)
2. List of required actions (what the county must do)
3. List of deadlines (specific dates and what triggers them)
4. List of ambiguous or unclear requirements (things that might need legal or policy clarification)
5. Key terms defined in plain language

**Context:** The audience is HHS supervisors and managers who need to understand what they must do and by when, without reading the full document.

**Constraints:** Use plain language. No regulatory jargon without definition. Separate the action items clearly. Flag anything that seems unclear or that might require legal interpretation.

**Output format:** Structured document with labeled sections for Summary, Required Actions, Deadlines, Ambiguities, and Key Terms.

## Power Follow-Up Options
- "Simplify this further for frontline staff"
- "Turn the action items into a checklist"
- "Which of these deadlines is most urgent?"
- "Draft an email to my team explaining these changes"

## Common Variations
- "We got an ACL and I need to brief my supervisor on it" → focus on the executive summary
- "I need to train staff on this change" → pivot to policy simplification task chain
- "There's a deadline and I'm not sure we'll make it" → pivot to case-for-change task chain to build an extension request
