# Three real policies, compiled by Blink (2026-11)

Spec section 11 asks whether Blink's policy compiler works beyond the demo policy. Three published codes of ethics were taken from EDGAR, chosen on 2026-11-10 before any test call was opened, and each was compiled with Blink's own compiler (`pnpm eval:policies`, `scripts/compile-real-policies.ts`), unchanged: no edit to the policy text or the prompts.

**Result: none of the three validates.** All three now compile all the way to validation. Each fails only on `CLAUSE_DROPPED`: some clause in a paragraph marked "must be automated" is left unsupported. The validator reported no other blocking issue for any of them.

| Policy | Paragraphs | Clauses found | Rules written | Clauses the predicates cannot express | Required paragraphs with a rule | Blocking issues | Validated |
|---|---|---|---|---|---|---|---|
| Oaktree | 31 | 51 | 4 | 38 | 7 of 9 | 10 `CLAUSE_DROPPED` | no |
| Sage Rock | 33 | 43 | 5 | 33 | 2 of 7 | 7 `CLAUSE_DROPPED` | no |
| TCW | 27 | 55 | 3 | 35 | 4 of 7 | 10 `CLAUSE_DROPPED` | no |

Each compile ran pass A, then pass B, an assembly, pass B again with the validator's feedback, and a second assembly. Then it stopped: the second pass B is the last one allowed (`MAX_PASS_B_CALLS = 2`). The AI scenario stage did not run, because it runs only once a policy would otherwise validate. Clauses that are neither in a rule nor listed as unsupported are definitions or out-of-scope text, which the validator does not require to be placed (Oaktree 6, Sage Rock 7, TCW 17).

`loadRealPolicy(name)` (`src/server/eval/real.ts`) therefore refuses all three, naming each one. Task 37 has no real policy to run the development set under until this is decided.

## Sources

| Name | Filing | Company | Exhibit | Filed |
|---|---|---|---|---|
| `oaktree` | https://www.sec.gov/Archives/edgar/data/2042513/000119312525055591/d923205dex99p14.htm | Oaktree Fund Advisors, LLC | EX-99.(P)(14) to N-1A/A, Russell Investments Exchange Traded Funds | 2025-03-17 |
| `sage-rock` | https://www.sec.gov/Archives/edgar/data/1557794/000119312521229365/d173444dex99p19.htm | Sage Rock Capital Management LP | EX-99.(P)(19) to 485BPOS, Blackstone Alternative Investment Funds | 2021-07-29 |
| `tcw` | https://www.sec.gov/Archives/edgar/data/1715933/000119312526141887/ck0001715933-ex19_1.htm | TCW | EX-19.1 to 10-K, TCW Direct Lending VII LLC | 2026-04-03 |

All three were fetched in a browser on 2026-11-10. No fallback (Ardian US, Bardin Capital) was needed. Several TCW funds file the same EX-19.1; the brief named none, so the newest was used, and the 2025 copy has the same text.

## Why the excerpts were cut

The full sections on inside information and expert networks are about 27k characters for Oaktree (its Insider Trading Policy plus its Expert Network Policy), 19k for Sage Rock (sections 8 and 9) and 31k for TCW (the insider-trading half of its policy). The demo policy is 1.9k characters, and its pass A used 2.6k output tokens. At the time, pass A's cap was 16,000 tokens.

Before any compile ran, each file was therefore cut, by one rule, to the subsections that state the firm's rules:
- the definitions of material and non-public information, and of tipping;
- the duties and prohibitions about inside information;
- the subsections on conversations through which it can arrive: expert networks, contacts with public companies, value-added investors.

The cut left out legal background, restricted-list and information-barrier administration, the approval and diligence of expert network firms, recordkeeping, monitoring, and deal channels (board seats, deal information, capital raises, creditors' committees). Each file's header lists exactly what was kept and what was left out. Inside the kept subsections the text is verbatim, apart from removed page headers and three sentences rejoined across a page break.

That gives 14.2k (Oaktree), 12.3k (Sage Rock) and 14.8k (TCW) characters. The cut was not enough on its own. On the first two record runs, pass A failed for Oaktree and TCW both times, with the output cut off at the 16,000-token cap. Sage Rock's pass A used 15,255 of 16,000 tokens. The controller then raised every compile stage to 32,000 output tokens (`src/server/jobs/handlers/compilePolicy.ts`). With that change, every compile here completed.

## Which paragraphs were marked "must be automated"

The paragraphs were chosen before any compile, by the rule written in `src/server/eval/real.ts`. A paragraph is required when it states a duty or prohibition that something said to the firm's people in a conversation can trigger:
- soliciting or receiving inside, material non-public or confidential information;
- reporting that such information may have been received;
- a limit on which experts may be consulted because of who they are.

Duties about trading, passing information on, firm administration, call logistics and call scripts, and definitions are not required.

- Oaktree: P4, P9, P11, P21, P22, P23, P24, P25, P26
- Sage Rock: P8, P11, P18, P19, P20, P21, P26
- TCW: P2, P7, P8, P17, P21, P23, P24

## Why each policy failed

The validator rejects a required paragraph if any of its clauses is left unsupported, even when another clause of the same paragraph is in a rule. That applies even to a clause the inventory classed as out of scope. Real policy paragraphs mix the part a call can show (an expert says something that may be inside information) with parts it cannot: the trader's pre-trade check, not passing the information on afterwards, and the compliance officer's own determination.

- **Oaktree.** P23 is fully automated. P4, P9, P11, P21, P22 and P24 each have a rule but also an unsupported clause; for example, P4's "before executing any trade, determine whether you have access to MNPI", and its "do not discuss it with anyone else". P25 (pre-approval for employees of portfolio holdings) and P26 (public officials) have no rule: no predicate observes portfolio holdings or public office.
- **Sage Rock.** P19 (target-company employment within six months) and P26 (notify the CCO of possible MNPI from an expert) are automated. P8 (notify the CCO) was left wholly unsupported: the compiler read its notice as tied to a contemplated trade, so it put each of its clauses outside the call. P11 (notify the CCO after a public-company contact) was also left unsupported, because no predicate identifies a contact with a public company. P18 (an agreement that bars the topic), P20 (government officials) and P21 (clinical-trial doctors) have no predicate.
- **TCW.** P2, P8 and P21 have rules, but each also has an unsupported clause: P2's not discussing the information with others, P8's placing the company on the restricted list after the Administrator's determination, and P21's not trading. P7 has no rule. Its "may not knowingly accept any MNPI" applies only before the issuer is on the restricted list, and its other clause concerns Legal approving confidentiality agreements; no predicate observes either. P17 (consult Legal about consultants who recently worked at a company in a major transaction) has no rule: no predicate observes a "major transaction", and the policy gives no window for "recent". P23 and P24 concern value-added investors, whom no predicate identifies.

## Rules written

Oaktree:
- R1 ← C8, C41 (P4, P22): an expert statement that may convey MNPI about the covered issuer. True: review and escalate.
- R2 ← C18, C21 (P9, P11): signs of Confidential Information (internal sourcing, access to a former employer after leaving, a confidentiality signal). True: review and escalate.
- R3 ← C37 (P21): the analyst solicited company-specific non-public detail. True: review.
- R4 ← C42, C43 (P23, P24): a current or recent (six-month) employee of the target issuer discussing it. True: review.

Sage Rock:
- R1 ← C3, C34 (P3, P26): an unreported company-specific operating result not found in public sources.
- R2 ← C3, C34 (P3, P26): a non-public corporate event not found in public sources.
- R3 ← C24 (P19): the expert is or was, within six months, employed by the target.
- R4 ← C34 (P26): information sourced from inside the company, or from a former employer after leaving.
- R5 ← C34 (P26): information the expert marks as confidential that is not found in public sources.
- Every rule opens review when true.

TCW:
- R1 ← C7, C19 (P2, P8): an unreported operating result not verified as public. True: review and escalate.
- R2 ← C7, C19 (P2, P8): a corporate event the expert says is not public. True: review and escalate.
- R3 ← C41 (P21): information apparently given in breach of a duty (internal sourcing, a former employer, marked confidential). True: review and escalate.

In every rule, an indeterminate result opens review.

## Clauses the ten predicates cannot express

As the compiler listed them, with its reasons. "(required)" marks a paragraph the policy owner marked as must be automated; each of those entries is one of the blocking issues.

#### oaktree

| Clause | Paragraph | Kind | Why it cannot be expressed |
|---|---|---|---|
| C4 | P3 | out_of_scope | Trading by Access or Related Persons is not observable from an expert's statement and no predicate measures it. |
| C5 | P3 | prohibition | Onward disclosure of MNPI by an Access Person happens outside the expert statement and no predicate observes it. |
| C6 | P3 | exception | Whether a recipient is an Oaktree employee with a business need to know is not observed by any predicate. |
| C7 | P4 (required) | out_of_scope | The pre-trade MNPI determination is a duty performed by the trader before trading, which no predicate on an expert statement observes. |
| C9 | P4 (required) | prohibition | Whether the employee later discusses the information with others is subsequent conduct that no predicate observes. |
| C10 | P4 (required) | duty | The restriction determination is a human decision by the CCO or an Approving Officer, an action rules cannot take. |
| C11 | P5 | out_of_scope | Restricted-list and information-wall decisions are human actions by Legal and Compliance that rules cannot take. |
| C12 | P6 | out_of_scope | Lifting restrictions is a discretionary human release decision that rules may never make. |
| C13 | P7 | duty | Which Expert Network arranged the call is not observed by any predicate. |
| C14 | P7 | duty | Participation of Oaktree Personnel on the call is not observed by any predicate. |
| C15 | P7 | exception | Department head and Compliance pre-approval is not observed by any predicate. |
| C16 | P7 | out_of_scope | Use of the Expert Network Mart Request Form is an administrative step outside the call that no predicate observes. |
| C17 | P8 | escalation | Whether a policy exception was submitted and pre-approved is not observed by any predicate. |
| C19 | P9 (required) | exception | The NDA carve-out depends on an NDA's existence and scope and on a completed compliance review, none of which any predicate observes, and it grants discretionary permission that rules cannot give. |
| C20 | P10 | out_of_scope | Trials with unapproved networks and requests to engage new networks are not observed by any predicate. |
| C22 | P11 (required) | prohibition | Refraining from sharing or trading before speaking to an Approving Officer is the employee's later conduct, which no predicate observes. |
| C25 | P14 | duty | This is an umbrella duty to follow the listed guidelines; its specific items are handled individually and the umbrella itself has no observable condition. |
| C26 | P14 | exception | Submission of a pre-clearance request to Compliance is not observed by any predicate. |
| C27 | P14 | out_of_scope | Directing questions to Compliance is guidance with no observable condition in an expert statement. |
| C28 | P15 | duty | The predicates evaluate expert statements and none observes whether the analyst delivered the opening disclosure. |
| C29 | P16 | duty | Use of the network's bridge line is not observed by any predicate. |
| C30 | P17 | discretion | This clause grants department-head discretion to require confidential consultations, which rules cannot exercise or observe. |
| C31 | P18 | prohibition | Exchange of direct contact details is not observed by any predicate. |
| C32 | P18 | duty | Routing of documents through the Expert Network is not observed by any predicate. |
| C33 | P19 | prohibition | Contact with an Expert outside network channels is not observed by any predicate. |
| C34 | P19 | exception | Attendance at group educational calls is not observed by any predicate. |
| C35 | P19 | prohibition | Whether a private consultation occurred at a group meeting is not observed by any predicate. |
| C36 | P20 | prohibition | Gifts, meals, entertainment or compensation outside the engagement terms are not observed by any predicate. |
| C38 | P21 (required) | out_of_scope | Classifying conduct as a Code violation and imposing discipline are human actions rules cannot take; the solicitation itself is caught under C37 in R3, and release of confidential information by employees is not observed by any predicate. |
| C39 | P21 (required) | prohibition | The predicates evaluate the expert's statements and none observes the analyst providing information about Oaktree's business, investments or transactions. |
| C40 | P22 (required) | out_of_scope | This is a descriptive warning that Oaktree may be restricted from trading, a human restriction decision rather than an obligation a rule can carry out. |
| C45 | P25 (required) | escalation | No predicate observes whether the covered issuer is a current or recent portfolio holding of the engaging strategy or whether PM/Department Head and Compliance pre-approval was obtained. |
| C46 | P26 (required) | prohibition | No predicate observes whether the expert is or recently was a Public Official. |
| C47 | P27 | out_of_scope | Oaktree Personnel working as experts elsewhere is outside the call and not observed by any predicate. |
| C48 | P28 | out_of_scope | Staffing placement requests are outside the call and not observed by any predicate. |
| C49 | P29 | out_of_scope | Expert Network obligations are performed by the network outside the call and are not observed by any predicate. |
| C50 | P30 | out_of_scope | The pre-call attestation is collected by the network outside the call and is not observed by any predicate. |
| C51 | P31 | out_of_scope | The post-call notice and attestation are handled by the network outside the call and are not observed by any predicate. |


#### sage-rock

| Clause | Paragraph | Kind | Why it cannot be expressed |
|---|---|---|---|
| C7 | P6 | prohibition | Concerns an employee passing information on to people who may trade, which no predicate over an expert's statement observes. |
| C9 | P7 | prohibition | Trading by covered persons and their unlawful communication of information are not observable in an expert's statement, and no predicate measures them. |
| C10 | P8 (required) | out_of_scope | Although P8 is marked must-be-automated, this pre-trade determination by the employee happens outside the call and no predicate observes trades or the employee's own determination. |
| C11 | P8 (required) | escalation | Although P8 is marked must-be-automated, the trigger is the employee's belief before a contemplated trade and the action is the employee's notification, and neither is observed by any predicate; MNPI received from Experts is covered under C34 by R1, R2, R4 and R5 instead. |
| C12 | P8 (required) | prohibition | Although P8 is marked must-be-automated, this clause requires the employee to refrain from trading and communicating until the CCO instructs otherwise, a restriction rules cannot impose and conduct no predicate observes. |
| C13 | P9 | definition | No predicate detects tender offer information or its source (offeror, target, or their agents), so the tender offer prohibition cannot be expressed. |
| C14 | P9 | duty | 'Particular caution' names no observable condition or concrete action, and no predicate detects tender offer information. |
| C15 | P10 | escalation | Pre-scheduled notification to the CCO about public company meetings is a records matter that no predicate observes. |
| C16 | P11 (required) | escalation | Although P11 is marked must-be-automated, the clause concerns employee contacts with public companies such as CFO or investor relations disclosures; no predicate identifies such a contact, and expert_recent_issuer_employee cannot separate current employees from recent leavers. |
| C17 | P12 | duty | The engagement channel for paid sources and the CCO's approval are not observable by any predicate. |
| C18 | P13 | duty | The Expert's CCO pre-approval status is not observable by any predicate. |
| C19 | P14 | duty | This describes what the CCO considers in an approval decision, which is a human judgment rules cannot make. |
| C20 | P15 | duty | CCO approval for attending Expert Network Firm events is not observable by any predicate. |
| C21 | P16 | duty | This describes the CCO applying approval guidelines, which is a human decision rules cannot make. |
| C22 | P17 | prohibition | Whether the Expert received the scope in writing and agreed to the network firm's terms are pre-call facts that no predicate observes. |
| C23 | P18 (required) | prohibition | Although P18 is marked must-be-automated, no predicate observes an Expert indicating an agreement or duty that precludes discussing the consultation subject; confidentiality_signal_present measures confidentiality wording on a statement, not a disclosed precluding duty, and stretching it would misreport the condition. |
| C25 | P20 (required) | prohibition | Although P20 is marked must-be-automated, no predicate observes whether the Expert is a government official or employee, a political candidate, party or party official, a state-controlled entity employee, or a public international organization employee. |
| C26 | P21 (required) | prohibition | Although P21 is marked must-be-automated, no predicate observes whether the Expert is a medical professional involved in an ongoing clinical trial. |
| C27 | P22 | prohibition | No predicate counts the number of conversations with the same Expert over a rolling 12-month period. |
| C28 | P23 | discretion | This grants the CCO discretion to consult outside advisers, which rules cannot exercise. |
| C29 | P23 | exception | This grants the CCO discretion to make exceptions to the approval guidelines; rules never approve or clear, so it is left to the human workflow. |
| C30 | P23 | duty | Documenting exceptions is a CCO action that rules cannot take, and no predicate observes it. |
| C32 | P25 | discretion | This grants the CCO discretion to limit consultation scope, which rules cannot exercise. |
| C33 | P25 | duty | This is a general duty to follow the listed parameters; each parameter is handled separately, and the umbrella duty has no observable condition of its own. |
| C35 | P27 | duty | The activities the Firm 'cannot do directly' are undefined, and no predicate observes Experts acting on the Firm's behalf. |
| C36 | P28 | duty | Whether the employee delivered the call-script disclosures at the start of the call is not observable from a single expert statement by any predicate. |
| C37 | P29 | exception | Use of a CCO-approved network firm script is not observable by any predicate. |
| C38 | P30 | duty | How a communication was arranged is not observable by any predicate. |
| C39 | P30 | duty | The conference line used for a call is metadata that no predicate observes. |
| C40 | P31 | prohibition | Exchange of contact information, off-parameter contact, and CCO prior approval are not observable by any predicate. |
| C41 | P32 | prohibition | Employee requests for written materials and CCO pre-approval are not observable by any predicate. |
| C42 | P32 | duty | Forwarding received written materials to the CCO happens outside the call and no predicate observes it. |
| C43 | P33 | discretion | This grants the CCO discretion to monitor consultations, which rules cannot exercise. |


#### tcw

| Clause | Paragraph | Kind | Why it cannot be expressed |
|---|---|---|---|
| C1 | P1 | out_of_scope | This prohibits trading securities, which a single expert statement on a call cannot show, and 'certain related companies' refers to a footnote that was not supplied. |
| C2 | P1 | exception | This exception points to a 'Deal-Specific Information' section that is not in the supplied policy, and it qualifies a trading prohibition no predicate observes. |
| C4 | P1 | out_of_scope | This restricts trading for oneself or others, which no predicate over an expert's statement observes. |
| C5 | P1 | prohibition | A Firm employee's recommendation to trade, and whether it rests on inside information, is not observed by any predicate, because the predicates evaluate the expert's statement. |
| C6 | P2 (required) | prohibition | Although the owner marked P2 must-be-automated, this restricts whom the employee later discusses the information with, which no predicate over an expert's statement observes; its reporting half (C7) is carried out by R1 and R2. |
| C8 | P2 (required) | prohibition | Although the owner marked P2 must-be-automated, whether the employee discusses the information with a supervisor or teammates happens after the call and no predicate observes it. |
| C9 | P3 | prohibition | This governs an Access Person passing MNPI to people without a need to know, and no predicate observes the employee's onward communications or the recipient's need to know. |
| C11 | P4 | prohibition | Whether an employee discusses the information with family, friends, clients or others is not observed by any predicate over the expert's statement. |
| C12 | P4 | exception | The need-to-know carve-out qualifies an unsupported prohibition (C11), and no predicate measures a recipient's need to know. |
| C14 | P5 | prohibition | Employees communicating MNPI about TCW Registered Funds is onward conduct, and no predicate identifies those funds or the employee's communications. |
| C15 | P6 | definition | This extends the sharing prohibition to affiliates such as Carlyle and Nippon Life, but no predicate observes sharing with affiliates, and the information-barrier policies are not supplied. |
| C16 | P6 | out_of_scope | This refers to separate information-barrier policies that are not in the supplied text. |
| C17 | P7 (required) | out_of_scope | Although the owner marked P7 must-be-automated, Legal approval before signing a confidentiality letter or agreement concerns contracting, which no predicate observes, and stretching confidentiality_signal_present to cover it would misstate what that predicate measures. |
| C18 | P7 (required) | prohibition | Although the owner marked P7 must-be-automated, the clause turns on whether the issuer was already on the Restricted Securities List and whether acceptance was knowing, and no predicate observes either. |
| C20 | P8 (required) | duty | Although the owner marked P8 must-be-automated, placing a company on the Restricted Securities List follows a determination by the Administrator and Legal, which is a human decision and an action rules cannot take. |
| C24 | P12 | discretion | This grants case-by-case judgment on materiality, which is discretion for people rather than a condition a rule can evaluate. |
| C25 | P12 | escalation | It is triggered by an employee having a question about materiality, which no predicate observes, and it requires routing that question to Legal. |
| C27 | P14 | duty | Being wary is a state of mind that no predicate observes; the observable breach-of-duty case is handled by R3 under C41. |
| C29 | P14 | evidence_requirement | This is a legal test for an improper tip, not a clarification requirement, and the corporate insider's expected benefit (reputational or quid pro quo) is not observed by any predicate. |
| C34 | P17 (required) | escalation | Although the owner marked P17 must-be-automated, no predicate observes whether the expert's former company is involved in a 'major transaction', and the policy gives no window for 'recent' to set the months parameter of expert_recent_issuer_employee, so automating it would mean inventing both conditions. |
| C36 | P18 | out_of_scope | This calls for a Firm judgment about further trading conduct, which is human discretion over trading rather than call content. |
| C39 | P20 | duty | This concerns analysts' private discussions with company management and their own stated intentions, which are not observed by predicates over an expert-call statement. |
| C40 | P21 (required) | out_of_scope | Although the owner marked P21 must-be-automated, this is a prohibition on trading triggered by the employee's belief, and no predicate observes trading or belief; the escalation half (C41) is carried out by R3. |
| C43 | P23 (required) | duty | Although the owner marked P23 must-be-automated, remaining alert is a state of mind, and no predicate identifies a value-added investor. |
| C44 | P23 (required) | prohibition | Although the owner marked P23 must-be-automated, no predicate identifies a known value-added investor or an employee raising sensitive topics with one. |
| C45 | P24 (required) | escalation | Although the owner marked P24 must-be-automated, it applies to information received from an investor, and no predicate identifies an investor as the source; it also requires the employee to raise the question with Legal. |
| C47 | P26 | out_of_scope | Vendor and Compliance approval of an Expert Network before contracting is an onboarding control, not something visible in a call statement. |
| C48 | P26 | out_of_scope | Guideline acknowledgment and training completion are checked from training records, which no predicate observes. |
| C49 | P26 | duty | Assigning a note-taker for each Expert Network meeting is an administrative duty that no statement-level predicate observes. |
| C50 | P26 | duty | Whether Notes reach Compliance within seven days is a delivery deadline that no predicate observes. |
| C51 | P26 | duty | Keeping a log of all Expert Network calls is a recordkeeping duty for Compliance, not a condition on a statement. |
| C52 | P27 | discretion | This grants Compliance discretion over chaperoning and sampling calls, which is not a rule condition. |
| C53 | P27 | escalation | This escalation is triggered by Compliance's own determination after its review, a human judgment that rules cannot make or stand in for. |
| C54 | P27 | duty | Determining whether MNPI was received, and what actions to take, is a human review under policies that are not identified in the supplied text. |
| C55 | P27 | out_of_scope | Sampling employees' personal trading is trading surveillance, which no predicate over a call statement observes. |


## Record and replay

- `BLINK_LLM_MODE=record pnpm eval:policies`: 15 live `claude-opus-5-5` calls, $3.28 as the script reports. It exits 0, because each policy failed with listed validator issues.
- `BLINK_LLM_MODE=replay pnpm eval:policies`: the same printed output apart from the mode line, and the same three `fixtures/real/policies/<name>.compiled.json` files byte for byte. All 15 calls were replayed, none live.
- The two earlier record runs, at the old 16,000-token cap, failed in pass A for Oaktree and TCW. Their output, recordings and bundles were replaced by this run.

## What this shows

- With the higher token cap, the compiler reads a real policy excerpt of 12k to 15k characters and produces a clause inventory, typed rules and monitors that pass every structural check (determinism, indeterminate handling, guard shape).
- The ten predicates cover the core of each policy: a statement that may be inside information about the covered issuer, inside sourcing, a confidentiality signal, a recent employee of the target, and an analyst soliciting such information.
- They cannot cover who an expert is beyond employment: public officials, clinical-trial doctors, agreements that bar a topic, employees of portfolio holdings, value-added investors. Nor can they cover anything that happens after the call: trading, passing the information on, the compliance officer's own decisions.
- As a policy owner would mark them, required paragraphs make all three fail. The cause is the validator's clause-by-clause rule for required paragraphs, not a defect in the rules written. Whether that rule should accept a required paragraph that has a rule for its call-observable part is a product decision; this test did not change it.
