# PlacementIQ Pilot Feature Flags

Use this file when you need to change pilot-visible surfaces quickly for a college demo or rollout.

## Client Flags

| Flag | Default | Layer | What it controls | Audience | Pilot recommendation |
| --- | --- | --- | --- | --- | --- |
| `studyGuides` | `false` | client | Shows or hides `Study Guides` in the student navbar. | student | Keep off |
| `studentAdvancedMetrics` | `false` | client | Shows richer dashboard signals like readiness, risk, and peer comparison. | student | Enable only after validation |
| `studentExpandedResources` | `false` | client | Switches Resources from the flat pilot library to a richer sectioned discovery view. | student | Keep off |
| `studentExpandedMockCatalog` | `false` | client | Switches Mock Tests from one filtered list to a sectioned discovery catalog. | student | Keep off |
| `studentProfileRecommended` | `false` | client | Adds the optional `Recommended` tab back into student profile. | student | Keep off |
| `studentAiStudyAssist` | `false` | client | Enables AI topic-help inside the Resources page. | student | Enable only after validation |
| `aiAssistant` | `false` | client | Exposes the broader AI assistant surface. | student / tpo | Keep off |
| `careerLab` | `false` | client | Exposes Career Lab routes and UI. | student | Keep off |
| `mastery` | `false` | client | Exposes mastery/topic-progress UI. | student | Keep off |
| `points` | `false` | client | Exposes points and leaderboard-style student surfaces. | student | Keep off |
| `vault` | `false` | client | Exposes Vault UI directly in the frontend. | student / tpo | Keep off |
| `tpoAdvancedInsights` | `false` | client | Exposes deeper TPO insight surfaces beyond the pilot core. | tpo | Keep off |
| `opsHub` | `false` | client | Exposes ops/internal TPO workflows. | internal | Keep off |
| `mentorship` | `false` | client | Exposes mentorship UI. | student | Keep off |
| `wallet` | `false` | client | Exposes wallet/payment-style UI. | student | Keep off |

## Server Flags

| Flag | Default | Layer | What it controls | Audience | Pilot recommendation |
| --- | --- | --- | --- | --- | --- |
| `studyGuides` | `false` | server | Enables or blocks `/api/v1/study-guides` on the backend. Must match the client flag before turning Study Guides on. | student | Keep off |
| `aiAssistant` | `false` | server | Enables or blocks AI assistant APIs. | student / tpo | Keep off |
| `careerLab` | `false` | server | Enables or blocks Career Lab APIs. | student | Keep off |
| `mastery` | `false` | server | Enables or blocks topic mastery APIs. | student | Keep off |
| `points` | `false` | server | Enables or blocks points/leaderboard APIs. | student | Keep off |
| `tpoAdvancedInsights` | `false` | server | Enables or blocks advanced TPO insight APIs. | tpo | Keep off |
| `opsHub` | `false` | server | Enables or blocks ops/internal APIs. | internal | Keep off |
| `vault` | `true` | server | Keeps Vault APIs available. This stays on in pilot because Mock Tests uses the vault company list for filters. | internal / student dependency | Safe to enable |
| `analytics` | `false` | server | Enables or blocks broader analytics APIs. | tpo | Keep off |
| `tenantAdmin` | `false` | server | Enables tenant-admin-only APIs. | admin | Keep off |
| `mentorship` | `false` | server | Enables mentorship APIs. | student | Keep off |
| `wallet` | `false` | server | Enables wallet/payment APIs. | student | Keep off |

## Plain-Language Notes

- `studyGuides: false`
  Student navbar does not show Study Guides during pilot, and the study-guide backend stays off.
- `studentAdvancedMetrics: false`
  Student dashboard hides readiness, risk, and peer-comparison numbers.
- `studentExpandedResources: false`
  Resources stays as a simple search + filter + continue-reading library.
- `studentExpandedMockCatalog: false`
  Mock Tests stays as one filtered list instead of sectioned discovery.
- `studentProfileRecommended: false`
  The `Recommended` tab stays hidden in student profile.
- `studentAiStudyAssist: false`
  The AI topic-help button inside Resources stays hidden.
- `vault`
  This is intentionally different today: server is `true`, client is `false`. The UI stays hidden, but the backend endpoint remains available because Mock Tests still needs vault company data.

## Common Pilot Toggles

- To bring back Study Guides for a college demo:
  set `studyGuides` to `true` in both `client/src/config/features.ts` and `server/src/config/features.ts`.
- To restore richer student resources:
  set `studentExpandedResources` to `true`.
- To restore richer student mock test sections:
  set `studentExpandedMockCatalog` to `true`.
- To bring back the profile `Recommended` tab:
  set `studentProfileRecommended` to `true`.
- Do not enable `studentAdvancedMetrics` unless the TPO is aligned on how readiness/risk numbers are calculated and explained.
