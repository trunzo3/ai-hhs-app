# RICECO Framework

RICECO is the IQmeetEQ prompt engineering framework for getting high-quality AI outputs. It stands for Role, Instruction, Context, Examples, Constraints, and Output format. But RICECO is not a checklist to fill out every time — it's a toolkit. For every task, you assess which elements would actually improve the output and apply only those.

## The Six Elements

**Role** — Who should the AI be? This sets the perspective, expertise, and tone. Use Role when it genuinely changes the quality of the output. "Act as a senior CPS supervisor reviewing this case plan" produces different output than no role at all. Don't use Role for simple tasks where it adds friction without adding value.

**Instruction** — What exactly do you want? This is the most important element. Be specific, use active verbs, break complex tasks into steps. "Summarize this ACL in plain language, flag all action items with deadlines, and highlight any ambiguous requirements" is far better than "summarize this ACL."

**Context** — What does the AI need to know to do this well? Background on your situation, your audience, your constraints. The AI has no context about your specific county, your team, your history, or your goals unless you provide it. Context is often what separates a generic response from a useful one.

**Examples** — What does good look like? Examples anchor the AI to your actual standards. If you've seen a strong case plan narrative before, showing it produces better outputs than describing what you want. Examples are most powerful when the first output missed the mark.

**Constraints** — What can't you do? Constraints include word limits, format restrictions, what to avoid, what to exclude. "No more than one page. No jargon. Assume the reader hasn't seen the original document."

**Output format** — How should the result be structured? Table, bulleted list, paragraph, email format, numbered steps. When the default format doesn't match what you need, specify it.

## When to Apply Each Element

Most tasks only need Instruction + Context + Constraints. Start there and see what you get.

Layer in Role when perspective or tone matters — drafting for a board vs. drafting for frontline staff.

Layer in Examples when the first output missed the mark, or when you need to show what "good" looks like in your specific context.

Layer in Output format when the AI defaults to paragraphs but you need a table, or vice versa.

Never walk through all six elements unless the user explicitly asks you to teach the framework. The goal is to get good output, not to perform the methodology.

## The Minimum Viable Prompt

Figure out the minimum input required to produce something useful, produce it, then refine from there. Asking one or two clarifying questions is better than demanding a full brief before you start. Get something in front of the user fast, then improve it.
