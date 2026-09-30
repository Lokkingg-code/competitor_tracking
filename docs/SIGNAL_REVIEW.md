# Signal Capture and Focus Review

Draft for analyst review, 29 September 2026. These are proposed editorial labels, not a trained model or approved ground truth. Source excerpts come from the saved [LinkedIn capture](../data/raw/linkedin_latest.json) and [feed](../data/signals.json). IDs identify records within the stated file; use the excerpt too, because earlier captures contained incorrect post/link pairings.

## Decision Order

1. Eligibility: does the post contain substantive competitor/product/customer information? Recruitment is omitted even when it names a watched product.
2. Focus: identify the product and operational workflow, then use a watchlist default if the evidence is otherwise unclear.
3. Event type: distinguish adoption, deployment, product change, and customer experience. A testimonial is not evidence of a new win; "collaboration" alone is not evidence of a new partnership.
4. Evidence: check source alignment and publication date. Incomplete or ambiguous evidence goes to review.
5. Duplicates: keep multiple sources as evidence for the same development rather than treating them as multiple wins.

## EFF Watchlist

Strong default EFF indicators supplied by the user:

- Aviobook
- Boeing FlightFolder
- Bytron Skybook
- CAE eFlightManager
- Flightman
- ForeFlight
- Lido mBriefing
- Logipad
- Mission+
- Topwing / TopWings
- IFS EFBOne

These indicate likely relevance to the EFF watchlist, not proof that every mentioned capability is an electronic flight folder. The existing specific product exceptions remain: FliteDeck Pro, Mission+ FLIGHT, and explicit AvioBook EFB are EFB; AvioBook Connect is adjacent operations. Explicit EFBOne electronic-flight-bag adoption remains EFB, while a generic EFBOne mention defaults to EFF. This precedence needs analyst confirmation before a broader reclassification.

Generic ForeFlight and Mission+ now default to EFF only after specific product/domain checks; clear corporate or insurance context does not become EFF merely because ForeFlight is named. Product classification is not permission to include recruitment or other noise.

## Proposed Review Set

Shortened excerpts below are identifying labels, not replacements for the original text. All decisions remain **proposed** except the user-confirmed exclusion of recruitment and the EFF watchlist defaults. "Customer experience," "account expansion," and "capability coverage" are proposed editorial types, not new implemented UI categories.

| # | Actual excerpt / competitor | Decision | Proposed focus | Proposed type / reason | Source record |
| --- | --- | --- | --- | --- | --- |
| 1 | New opportunities at AvioBook! | Omit | Not applicable | Job vacancies and open roles, not product news | Raw: `browser-1a1be9df90b0` |
| 2 | We're hiring at AvioBook! | Omit | Not applicable | Recruitment remains noise despite software keywords | Raw: `browser-c2a986e9925f` |
| 3 | Interview experience: Senior Software Engineer at Lufthansa Systems | Omit | Not applicable | Candidate interview report, not a competitor movement | Feed: `cap-edc21be15f43` |
| 4 | Go Green Week at FarmFun / AvioBook | Omit | Not applicable | Team-building activity | Raw: `browser-c39532e36687` |
| 5 | Our footprint on the ground / AvioBook | Omit | Not applicable | Employee sustainability activity, not an operational product development | Raw: `browser-d710158d3938` |
| 6 | One more sleep. Connect 3.0 webinar tomorrow | Omit | Not applicable | Countdown/promotion; a product name alone is insufficient | Raw: `browser-8e5caf004003` |
| 7 | Explore the newest features in ForeFlight | Review | EFF default | Keep only if the full source describes specific capabilities; teaser alone is insufficient | Raw: `browser-93c58839e2f1` |
| 8 | ForeFlight Insurance Marketplace | Review | Other | Specific product launch, but outside flight-operations scope; decide whether to monitor diversification | Raw: `browser-736d3db6d940` |
| 9 | Matthias Dolderer and the Red Bull Air Race | Omit | Not applicable | Sporting/profile story without a demonstrated relevant product change | Raw: `browser-5200956e93ce` |
| 10 | Weather shifts, GNSS interference / AvioBook Enhanced Awareness | Include | EFF default; confirm mixed operational functions | Capability coverage, not a newly announced partnership | Raw: `browser-3ee4c1311791` |
| 11 | FLYINGGROUP has been using AvioBook | Include | EFB where the full source confirms that workflow | Customer experience; already using the product is not a new win | Raw: `browser-f6f7f370cf0d` |
| 12 | Close to airlines' day-to-day operations / ASL Belgium | Include | EFB | Customer experience and operational support, not a new partnership | Raw: `browser-a0c99ebe5824` |
| 13 | Data sitting on every aircraft after a flight / AvioBook | Review | Adjacent operations candidate | Aircraft-data analysis and troubleshooting; confirm named product and scope | Raw: `browser-b8f49628138c` |
| 14 | Rethinking how pairings are created / Eurowings | Include | Adjacent operations | Customer experience in crew pairing; neither EFF nor a new customer win | Raw: `browser-7d8392514ccb` |
| 15 | It feels like a partnership / KLM and Lufthansa Systems | Include | Adjacent operations | Existing customer experience with dispatch workflows | Feed: `browser-0384fbd2ed67` |
| 16 | How quickly can your airline respond to a market shift? | Include once | Adjacent operations | NetLine Plan capability coverage; multiple captures are not separate partnerships | Feed: `browser-03fd811a120c` and `browser-631773759920` |
| 17 | Lido mPilot 7.3 enhances the Airport Moving Map | Include | EFB | Specific feature change; verify publication date | Feed: `browser-16f3824401f5` |
| 18 | Viva takes the next step with Lido mPilot | Include | EFB | Implementation evidence, not automatically a partnership announcement | Feed: `browser-88d9d3627aee` |
| 19 | 40 Lido Talks | Omit | Not applicable | Internal knowledge-sharing milestone, not a product launch | Feed: `cap-4c94bfb370a8` |
| 20 | Airline Forum 2026: Together as One | Review | Adjacent operations candidate | Keep an actual product announcement if substantiated; omit generic event recap | Raw: `browser-d4ccb5242dd9` |
| 21 | TransNusa adds Core X2 and Fleet Performance+ | Include once | Adjacent operations | Expansion of an existing customer relationship; multiple sources are one development | Feed: `browser-cc81837bbf5f` |
| 22 | Welcome MY FREIGHTER to EFBOne | Include once | EFB when explicit workflow is stated; otherwise EFF default | Customer win; reconcile repeated captures, not separate wins | Feed: `browser-cb2fca77cee3` and `cap-541011120c72` |
| 23 | fastjet selects EFBOne, replacing a legacy system | Include | EFB | Customer win with replacement evidence | Feed: `browser-9a9036fcf9da` |
| 24 | Instant messaging to skybook EFB during flight briefings | Include | EFF briefing workflow | Capability coverage; do not claim a new launch unless the source says it is new | Feed: `cap-d0ca361f6e7a` |

## Implemented Versus Pending

Implemented: EFF default tests for all eleven names; generic ForeFlight/Mission+ defaults with contextual exceptions; normalized Unicode text for Python focus and noise checks; recruitment variants including open roles and hiring hashtags; removal of auto-captured recruitment from the next archive merge. Raw captures are retained for audit. Manually curated records are not automatically deleted.

Pending analyst review: the 24 proposed labels, broader event/culture exclusions, new editorial types, historical event reclassification, and same-story consolidation. No bulk relabeling is justified by these proposals yet. The existing dashboard summary is still heuristic and should not be treated as an approved analyst briefing.

After review, convert the agreed examples into executable eligibility/focus/type tests, evaluate missed relevant posts as well as false positives, then apply the approved rules to the archived feed. Record source-ID pairs and reasons for every reviewed exclusion or label change.