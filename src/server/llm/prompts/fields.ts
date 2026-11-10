/**
 * The "# Fields" section of the claim schema, shared by every reader that fills
 * claim fields (the after-call extractor and the live reader). Any edit changes
 * each prompt that embeds it, so bump those prompts' versions and re-record.
 */
export const FIELD_GUIDE = `# Fields

The output is flat. A text field that does not apply is the empty string "", a year or quarter that is not stated is 0, and a category that does not apply is "none". Never write the word "null" or "n/a" into a text field.

summary: one neutral sentence stating the claim. No judgment about whether it is a problem.

speaker: "expert" for everything you extract unless the analyst asserts a fact of their own.

subject_kind and subject_name (supports_fields name: subject_entity): the company the fact is about.
- "issuer": the covered issuer named in the case packet (by name or alias). When the fact is about the covered issuer's dealings with a customer or competitor, such as winning or losing a contract, the subject is the covered issuer.
- "competitor" or "customer": another named company.
- "industry": the market, a sector, or a group of companies ("airlines", "resellers", "the whole sector").
- "unknown": a specific company is meant but the expert has not said which.
- subject_name: the company as the expert said it, or "" when no company is named.

metric_category and metric_label (supports_fields name: metric): the measured quantity. Categories: orders, bookings, revenue, margin, pricing, inventory, headcount, customer_contract, guidance, capex, input_costs, other. metric_label is a short phrase for it ("Q1 subscription revenue"). Use category "none" with label "" when the claim describes an event rather than a quantity.

event_kind: "none" unless the claim describes a discrete corporate event: contract_change (winning, losing, or renewing a contract), m_and_a, litigation, regulatory, product (launch, recall), leadership, other.

The period fields (supports_fields name: period) say when the fact applies.
- period_label: the expert's own words ("this half", "Q1", "the year before I joined"), or "".
- fiscal_year and fiscal_quarter: fill these when the expert names a quarter of the company in fiscal or unqualified terms ("Q1 subscription revenue", "the Q4 results"). Use the fiscal calendar in the case packet and the call date to choose the fiscal year. Otherwise 0.
- calendar_year and calendar_quarter: fill these ONLY when the expert explicitly speaks in calendar terms ("the first calendar quarter"). Otherwise 0. Do not convert calendar periods to fiscal ones or the reverse; code does that.
- period_relative: "current" for the present or ongoing period at the time of the call ("this month", "currently", "these days"); "prior" for a period that has ended; "future"; "unspecified" when no period is stated.

The value fields (supports_fields name: value) give the amount.
- value_number: the number as spoken ("thirty-five percent" is 35). null when no number is given, including for a qualitative amount ("low double digits"); record such a phrase in qualifications.
- value_unit: percent, usd, or units; "none" when there is no amount.
- value_direction: up, down, or flat; "none" when no direction is given.
- value_baseline: what it is compared with ("against the 2019 peak"), or "".

scope: how much of the world the fact covers.
- company_wide: one company as a whole.
- segment_or_region: a region, division, product line, or end market of one company.
- single_customer: one customer relationship or contract.
- industry_aggregate: the industry or market as a whole.
- sample: a set of companies the expert observed, or a survey sample.
- unspecified: not stated.
scope_detail: the specific region, segment, or customer ("Nordic routes"), or "".

knowledge_basis: how the expert says they know this. Record what the expert said, not what you can guess from their biography.
- internal_system: a company's internal systems (reporting tools, CRM, ERP).
- internal_document: internal decks, memos, reports, board materials.
- insider_conversation: told by people inside the company.
- personal_observation: what the expert saw from outside the company, as a customer, supplier, reseller, competitor, or industry participant. Knowledge from having worked inside a company is not personal_observation: use an internal_* value if the expert names the internal source, otherwise unstated.
- public_source: filings, earnings calls, news, things the expert read.
- industry_survey: a survey or index.
- speculation: the expert is guessing.
- unstated: the expert does not say how they know.

access_timing: when the expert obtained information that comes from a current or former employer.
- during_employment: it dates from when they worked there.
- after_employment: they say they accessed or received it after leaving.
- unknown: the claim is company-specific inside information, or the expert signals it is confidential, but the expert does not say when or how they got it.
- not_applicable: everything else — public sources, surveys, outside observation, general industry commentary.

confidentiality_signals: verbatim phrases showing the expert treats the information as secret or unreleased ("off the record", "not public until the launch", "don't repeat this"). Empty when there are none.

qualifications: the expert's hedges and caveats, verbatim ("roughly", "as far as I know", "I think").

is_correction_of: the logical_key of the earlier claim this one corrects, or "".`;
