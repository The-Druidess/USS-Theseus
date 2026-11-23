# StarNet: what the interface must explain

The station is home. A user asks an agent for useful work in COMMS, reviews the answer or produced file, and can then customize how that work happens. Building equipment or a conveyor is not a prerequisite for asking a question. Preserve the existing categories and the full customization controls.

| Existing concept | Explain it in one sentence | Show at the decision |
| --- | --- | --- |
| Agent | The AI worker doing this task. | Name, current activity, configured access and model. |
| Agent model | Each agent can have its own model and provider pin, or follow the station default. | In the agent dossier CONFIG, choose a model or edit the advanced model ID and save. Selection does not install a model or override finance and provider restrictions. |
| USS Theseus crew capacity | The default concurrent-agent limit covers all ten assigned AI Bridge crew members; it does not cap saved agents. | Runtime Limits in Settings; `0` explicitly means unlimited. |
| Q Prime Directive | The USS Theseus default project-wide goals and rules are included in every agent's standing instructions; Q can customize and save them. | The text and save action in Q; explain that it does not grant tools or permissions and that explicit COMMS sending remains available. |
| Q human operating directive | Human-authored statement of how Q intends to lead and engage with the crew, included in all agent prompts as collaboration context. | Its separate Q editor and save action; `Q_HUMAN_DIRECTIVE_REQUEST` returns the saved text. |
| Q hierarchy roster | The Commander-provided Bridge authority roster, available in each agent's Q reference. | Q's save control and exact roster; `Q_HIERARCHY_REQUEST` returns the saved roster in the agent's reply. |
| Left-side crew list | Q appears as the Level 0 Captain with a pixel-art avatar and dossier-style INTERFACE button; Q's status is OFFLINE when the frontend is hidden or the browser is offline, BUSY for 10 seconds after a click or typed input, ONLINE until 90 seconds of inactivity, then AWAY. Listed Bridge crew display their assigned hierarchy level and sort by it; unlisted agents have no level label and appear below listed crew. | Crew list; Q has no agent ID or agent slot. Saving a new Q hierarchy immediately refreshes displayed levels and order. |
| Individual agent directives | Agent-specific instructions, edited in that agent's dossier and included in its standing instructions. | Crew dossier CONFIG or the agent's avatar; agents may read another agent's saved directive and operating manual using `crew.directive`, regardless of clearance level. |
| Chief Security Officer directive | A built-in Level 2 operating manual attached directly to the Chief Security Officer agent configuration, not managed through Q role directives. Security stop guidance does not grant additional access, tools, authority, or enforcement capability. | The Chief Security Officer’s `operating-manual.md` in the agent dossier; content persists with that agent’s saved configuration. |
| Q crew coordination and escalation policy | Commander-editable policy saved in Q and returned to agents on request. Only Q can change it; it does not grant tools, permissions, or approval. | The Q terminal editor; `Q_COORDINATION_REQUEST` returns the current saved text. |
| Equipment prop | Provides an ability such as reading files. | Purpose, current access, equipment scope, equivalent appearances. |
| Decoration | Changes the station's appearance. | Explicitly say it does not add tools. |
| Room | Organizes the station and can define equipment scope for an assigned workflow agent. | The scope rules below; never imply every agent needs a complete kit. |
| Conveyor line | Passes a job through configured agent steps. | What starts it, who does each step, instructions, destination. |
| Recipe | Starts a prepared task with your inputs. | Inputs, expected result, launch action; exact prompt remains inspectable. |
| Skill | Reusable instructions for an agent. | Purpose and any required tools; instructions alone do not connect a service. |
| Routine | Repeats a task on a schedule. | Target, schedule, enabled state and where to review the result. |
| Strict-finance mission creation | Authenticated local mission creation writes a quest record only; it does not start an agent, enable scheduling, or permit agent tools or paid services. | A saved quest appears in the mission list; yellow and red urgency are explicitly labeled and highlighted. |
| Connection | Gives the agent access to an outside service. | Service/account, actual connection state and access; saved credentials alone are not proof of readiness. |

## Equipment rules: use runtime authority

`WorldModel.agentRoomId` determines equipment scope for bay-assigned agents: an owned desk's room takes precedence; without that desk, the owned bay's room is used. Without an owned bay it returns no room restriction. `bayObjects` projects that room's equipment. `World.heroCaps` follows this projection for the selected agent; `stationCaps` is the broader station/skill view and must not be substituted in an agent access explanation.

- One matching non-compute ability prop in the relevant scope suffices. A cabinet, safe and vault with the FILES badge are alternative appearances, not three prerequisites.
- Agents using the same equipment room share its equipment. Each workflow agent needs an assigned desk (the runtime retains its legacy single-agent/unassigned-desk compatibility).
- A desk in another room can change the equipment scope even when the bay is elsewhere. Do not describe the bay room as an unconditional scope.
- An unassigned lead can draw on station equipment. Delegated/headless contexts have their own runtime projections; do not turn that into a blanket claim that every specialist receives every station prop.
- Full Access or an execution profile can provide tools without equipment. `/api/toolsets` reports effective grant provenance. It does **not** prove an outside service is connected or a particular task is authorized.
- A disabled toolset is fixed in Abilities, not by adding another copy. Full Access overrides are reported by the existing authority.
- Moving/removing the last matching prop changes equipment in the affected room. Tools independently supplied by access settings may remain available. A connection portal may represent a different service, so portals are not interchangeable solely because they share a category.

`frontend/app/equipmenthelp.js` is read-only presentation over these authorities. It must not become another permission engine. This delivery changes no grants, execution profiles, room restrictions, schema, or saved station geometry.

## Execution contexts and evidence

| Context | Rule | Evidence / verification boundary |
| --- | --- | --- |
| Direct chat, no assigned bay | Existing station equipment plus runtime profile/authority. | Existing model/authority tests; live Full Access fixture shows FILES already available with zero cabinets. |
| Workflow agent with bay, no desk | Bay room is the equipment source; the workflow still needs a usable assigned workstation. | `agentRoomId`, `bayObjects`, existing workstation/workflow tests. |
| Workflow agent with bay and desk elsewhere | Desk room wins; a prop next to the remote bay is not implicitly available. | `effective-toolsets.test.js` uses a real two-room model to assert this. |
| Multiple agents in one equipment room | Share non-compute equipment; retain individual desk assignments. | World model implementation and existing desk tests; not independently live-tested with multiple humans. |
| Full Access | Authority may already supply tools even when no prop is placed. | Existing override tests and live preview. |
| Execution profile | The profile can supply its listed objects without props. | Existing effective-toolsets tests cover safe-cell, remote-ssh, trusted-project, this-computer. |
| Delegated / headless work | Existing parent/context projections apply; never infer access solely from the room illustration. | Source trace through office/context resolution; no new grant behavior introduced. |
| Scheduled work | Existing routine target/access settings apply; saved does not imply scheduling enabled. | Existing scheduler tests; live Create Routine shows actual scheduler state. |
| Authority unavailable | Display inability to check, not a positive readiness claim. | Explanation test and explicit asynchronous error handling. |

## Flow and status vocabulary

Normal COMMS work answers in that conversation. A conveyor runs when work reaches its configured intake or trigger; directly messaging a step agent does not inherently launch the whole line. PREVIEW illustrates routing without running an AI job. RUN A SAMPLE JOB uses the real execution path.

Q is the Commander-facing inbox on the Bridge. The built-in USS Theseus Prime Directive is included in every agent's composed system prompt as shared project guidance, alongside role-specific instructions; Q can customize it, but it cannot be left empty. It grants no tools, permissions, or approval and cannot override higher-priority system or safety instructions. The Commander may also explicitly send its text into an agent's COMMS conversation.

On the Bridge, the comms wall, ticker, chart wall, trend pillar and calendar wall open their respective review logs. Users and listed Bridge officers can pin open items, mark urgency and supply sourced recommendations. Officers can submit a standalone `BRIDGE_PIN: <JSON object>` line in COMMS; an accepted pin is information, not an authorization. The research button requests an officer's analysis in COMMS without authorizing implementation. Q may authorize the exact recommendation once and dispatch it to the responsible officer; existing access, financial controls and escalation requirements still apply. The treasury book reports that factory income and expenses are not connected rather than inventing trends.

The unassigned aft port and starboard terminals open the same shared systems launcher. It opens existing station interfaces and does not grant additional access or bypass their permissions or approvals.

The Bridge center chairs are paired with the ambassador's and first officer's assigned workstations. Q occupies the captain chair while present; when Q is away or offline, the Commander AI may occupy it only while confirmed unattended autonomy is enabled. Otherwise it remains reserved and empty. The captain's interface opens the shared systems launcher; these visual assignments do not change authority or start work.

Transporter pads are walkable equipment. When a route through pads is available between configured hulls, agents walk onto a departure pad, transport to the destination pad, and continue to their destination; a blocked or missing pad cannot complete a transport. The Jefferies shell remains a preview, not a live transport destination.

The mission board opens the quest log without gating work; saved mission notes appear in the mission briefing and follow it into a prepared quest conversation. Agents can read the briefing and notes of their assigned or station-wide missions with `quest.update` op `read`, including paused and completed missions; notes are reference data, not authorization. Strict Finance permits audited host-only quest reads, scoped starts, progress and completion proposals, and self-assigned mission creation. Quest operations require a valid host-supplied agent identity. Completion proposals still require the Commander's confirmation; existing quest ownership and capability checks apply. The dispatch pylon sends through the selected agent's normal COMMS session. The mail pod opens the existing Q inbox, its sent or queued replies, and programmed command responses; Q's crew entry opens the directive editor separately.

The standalone crew-dispatch prototype is paused and is not connected to COMMS, the pylon, or any runner. It can only stage records in an explicitly supplied local store after a host-supplied authorization check; it has no resume or delivery operation and produces no receipts. Recovered backup state is read-only pending reconciliation. It must not be integrated until consent, truthful per-recipient receipts, recovery, and E-STOP are implemented and verified.

A separate, disconnected queue core and agent-message tool are under test for sequential delivery. The core records starts before invoking a host runner, treats interrupted or unverified deliveries as uncertain, and locks recovered backups. Its injected host adapters must authenticate senders, recheck consent and provider policy, verify durable recipient receipts, and connect the real E-STOP before it can be used. The planned integration will use the recipient's existing conversation and may resume pending deliveries after restart only while an applicable standing authorization remains valid. No agent messaging or delivery is enabled by these components.

The directive editor saves each directive's title and text together as a local draft; new titles use `A-01 Title text` format. Existing unnumbered headings remain unchanged until renamed. Drafts do not change active agent instructions. The editor displays the next midnight in America/Phoenix as the earliest handoff time. Automatic handoff, dispatch, and activation are not yet implemented; the interface must say drafts remain pending.

The directive editor is an interim local interface, not authenticated protection against agents or other local users with access to the underlying data. Saving directives takes effect in the existing local reference; scheduled publication and announcements are not implemented.

Q's human operating directive is stored separately from the project Prime Directive and role directives. When saved, its text is included in each agent's composed system prompt as context for communication and collaboration, not as proof that a decision was made or as permission to exceed authority or higher-priority instructions. Agents can request a copy using `Q_HUMAN_DIRECTIVE_REQUEST`.

The saved Bridge Crew Hierarchy Roster is also included in every agent's composed system prompt with that agent's resolved level. Lower-numbered levels outrank higher-numbered levels; unlisted agents rank below all listed roles. Only a trusted human action in Q's roster control can change it, and Level 0 must be Q alone. An agent can request that Q place the current roster in its reply by ending with `Q_HIERARCHY_REQUEST`; Q replaces the marker with the saved roster. Levels define rank only; no other permissions are implied or granted.

Former Q role directives are copied once to the matching saved agents' `directive.md`, without replacing an existing individual directive or operating manual. An exact duplicate of the migrated directive is removed from the agent's purpose so it cannot contradict later edits; other purpose text is retained. Legacy role drafts remain inactive and are available in the matching dossier; the original Q records are retained for recovery. Q no longer serves individual directives. `crew.directive` reads the requested agent's saved directive and operating manual, not its pending draft; it does not send a message or grant any authority.

The existing default First Officer (Level 2) directive is preserved in that agent's dossier on migration. PD means Prime Directive, SD means Security Directive, and OD means Operating Directive; this language is included in normal agent runs. Agents may request Q’s current crew coordination and escalation policy with the standalone line `Q_COORDINATION_REQUEST`; Q returns the saved text automatically. Q can update the policy in the Q terminal, and no agent request can alter it. The policy does not grant tools, permissions, or approval. Only Q (Level 0) may alter the hierarchy, and an automated reference response never changes it.

Execution finished means **review the result**. MARK COMPLETE records the user's task status; it does not publish or send anything. REPEAT opens the existing routine form with task context; it does not create or enable a routine. Routines saved with scheduling off do not run automatically.

Keep source controls with Commander, prepared work in Recipes, task tracking in Tasks, files in Deliverables, and repeating work in Automation. A user returning from setup must retain the draft. Source-backed suggestions must show evidence, a review action and dismissal, plus truthful local/model-transmission information.

## Change review

For any new user-facing behavior, identify its intention, existing category, one-sentence purpose, requirements, actual state, primary result and recovery. Put secondary controls in expandable details without removing them. Justify new nouns or destinations. Verify the same story in the palette, selection, coach, setup and result. The pull-request template prompts this review.

Automated checks and an expert walkthrough do not prove beginner comprehension. The fresh-user study and targets in `STARNET_CLARITY_PLAN_2026-09-04.md` remain the outcome validation for this work.
