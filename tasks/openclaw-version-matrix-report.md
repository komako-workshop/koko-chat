# OpenClaw Version Matrix for KokoChat

## Summary

- Test date: 2026-05-26 CST
- Alibaba Cloud region: `ap-southeast-1`
- Test ECS: `i-t4n683u9ip19ixdln0ll`
- Relay ECS kept running: `i-t4n1f6k2o43v4plfpgts` / `47.84.141.40`
- All OpenClaw test ECS instances were stopped after the run.
- Raw machine-readable result: `tasks/openclaw-version-matrix-results.json`

## Cloud State

After testing:

| Instance | Name | Status | Notes |
| --- | --- | --- | --- |
| `i-t4n683u9ip19ixdln0ll` | `kokochat-openclaw-oc415-20260520070824` | Stopped | Used for matrix, then stopped with `StopCharging` |
| `i-t4n9218qkxp36ya0asqf` | `kokochat-oc415-repro-20260520062843` | Stopped | Already stopped |
| `i-t4n4m0fobm7fmp3l8mas` | `kokochat-repro-20260520055202` | Stopped | Already stopped |
| `i-t4nf8z9jg901nvhxz3dq` | `kokochat-openclaw-latest-20260519-133354` | Stopped | Already stopped |
| `i-t4n0481v1pkop5imukas` | `kokochat-openclaw-20260519` | Stopped | Already stopped, old stale README target |
| `i-t4n1f6k2o43v4plfpgts` | `kokochat-relay-20260519` | Running | Not an OpenClaw test machine, preserved |

## Matrix

Each passing version was tested through the current KokoChat gateway protocol:

- Install or update `openclaw@<version>`.
- Reinstall KokoChat OpenClaw support from the repo.
- Restart remote gateway.
- Generate KokoChat pairing setup code through `kokochat-pairing`.
- Connect through the relay tunnel.
- Run Koko, Tavern recommendations, Tavern roleplay, and Deeply explore.

| OpenClaw version | Support install | Pairing | Gateway | Koko | Tavern recs | Roleplay | Deeply explore | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0.0.1` | FAIL | - | - | - | - | - | - | No `openclaw` bin after install |
| `2026.1.29` | FAIL | - | - | - | - | - | - | Config schema rejects `agents.list[*].skills` |
| `2026.4.15` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Oldest confirmed compatible |
| `2026.5.5` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Compatible |
| `2026.5.18` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Compatible |
| `2026.5.22` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Latest stable compatible |
| `2026.5.25-beta.1` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Latest beta compatible |

## Extra Latest-Beta Checks

Ran on `2026.5.25-beta.1`:

| Use case | Result | Notes |
| --- | --- | --- |
| Real Character Tavern card roleplay | PASS with quality concern | Used `https://character-tavern.com/character/corbinbear/juniper_harlow__detective`; response entered character, but began with a meta sentence about card binding |
| Deeply course research outline | PASS | Produced `koko.deeply.research.outline` fenced block for a 3-section course on `科学革命的结构` |

## Conclusions

- Practical compatibility floor is `openclaw@2026.4.15`.
- `0.0.1` is not a usable KokoChat target.
- `2026.1.29` is pre-KokoChat-support-era for this integration because it does not accept the skill allowlist shape now required by the mini-app ecosystem.
- `2026.4.15` through `2026.5.25-beta.1` all work with the current KokoChat pairing + relay + mini-app protocol.
- Gateway startup can take 10-25 seconds on ECS after restart; tests should wait for health in a loop rather than checking after a fixed 5 seconds.
- The old default regression target `47.237.5.255` should not be used; that ECS is stopped and has no current public IP.

## Follow-Ups

- Update `scripts/regression-openclaw-kokochat.mjs` to discover or accept the active ECS target instead of hardcoding stale `47.237.5.255`.
- Make the regression script fail loudly on SSH/remote-command failure instead of surfacing `Unexpected end of JSON input`.
- Treat `2026.4.15` as the minimum supported OpenClaw version unless there is a product reason to support older releases.
- Tighten Tavern roleplay instructions so the model never emits setup/meta narration like “角色卡已绑定”.

## Auto-Upgrade Probe

- Test date: 2026-05-27 CST
- Goal: check whether pre-`2026.4.15` OpenClaw/qclaw installs can self-upgrade before KokoChat support is installed.
- Environment: isolated npm prefixes and isolated `HOME`/`OPENCLAW_HOME` on local macOS. Tencent Cloud real-machine provisioning was not completed because CAM API key creation stopped at Tencent Cloud's interactive image verification.
- Target tag: `latest`, which resolved to `2026.5.22` during this test.

| Initial version | Upgrade command | Result | Notes |
| --- | --- | --- | --- |
| `0.0.1` | N/A | FAIL | Package has no `openclaw` bin, so it cannot self-upgrade. Needs package-manager reinstall. |
| `2026.1.29` | `openclaw update --yes --tag latest --no-restart --json` | PASS | Clean isolated home upgraded to `2026.5.22`. |
| `2026.2.22` | `openclaw update --yes --tag latest --no-restart --json` | PASS | Clean isolated home upgraded to `2026.5.22`. |
| `2026.3.22` | `openclaw update --yes --tag latest --no-restart --json` | PASS | Clean isolated home upgraded to `2026.5.22`, then ran `openclaw doctor --non-interactive`. |
| `2026.4.14` | `openclaw update --yes --tag latest --no-restart --json` | PARTIAL | Package changed to `2026.5.22`, but update JSON reported `status: error` because packaged runtime sidecar verification failed. Running `openclaw --version` afterwards confirmed the new version, and KokoChat support installation passed. |
| `2026.4.15` | `openclaw update --yes --tag latest --no-restart --json` | PASS | Upgraded to `2026.5.22`, then ran `openclaw doctor --non-interactive`. |

Additional findings:

- `openclaw update` can return `status: skipped` when the install is not recognized as a package-manager install. In isolated npm-prefix tests, setting `npm_config_prefix`/`NPM_CONFIG_PREFIX` made the updater correctly detect npm mode.
- `2026.1.29` can fail before upgrading if it reads a newer `~/.openclaw/openclaw.json` containing unsupported keys such as `agents.list[*].skills`. Therefore the KokoChat installer must upgrade OpenClaw before writing current KokoChat skill config.
- Upgrading first, then running `scripts/install-openclaw-support.mjs`, worked after starting from both `2026.1.29` and `2026.4.14`.

Product recommendation:

- KokoChat OpenClaw setup should perform a preflight version check before installing support files.
- If the detected version is below `2026.4.15`, run `openclaw update --yes --tag latest --no-restart --json` first.
- Treat `status: ok` as success. If update reports `status: error` but `after.version` and a fresh `openclaw --version` are at least `2026.4.15`, continue with a warning.
- If update reports `status: skipped` or the `openclaw` bin is missing, fall back to a package-manager reinstall such as `npm i -g openclaw@latest`.
- Only after the version is compatible should the installer write KokoChat agents, skills, and allowlists.

## Tencent Cloud QClaw Probe

- Test date: 2026-05-27 CST
- Region: Tencent Cloud `ap-hongkong`, zone `ap-hongkong-2`
- Instance: temporary CVM `ins-49xtb7zc`, `S2.MEDIUM2`, Ubuntu 22.04, hourly postpaid
- Access path: Tencent Cloud TAT automation. SSH port was reachable, but SSH banner exchange timed out from the local network, so the test used TAT for unattended commands.
- Cleanup: CVM, CVM key pair, security group, subnet, and VPC were deleted after the run. Local Tencent credential files and temporary SSH key were removed. The temporary CAM user was left with no policies because deleting/disabling its API key requires Tencent Cloud MFA/WeChat verification.

| Initial version | Result | Before | After | Update status | Notes |
| --- | --- | --- | --- | --- | --- |
| `2026.1.29` | PASS | `2026.1.29` | `OpenClaw 2026.5.22 (a374c3a)` | `ok` | Earliest tested real Tencent Cloud version upgraded cleanly. |
| `2026.2.22` | PASS | `2026.2.22` | `OpenClaw 2026.5.22 (a374c3a)` | `ok` | Upgraded cleanly. |
| `2026.4.14` | PASS with warning | `OpenClaw 2026.4.14 (323493f)` | `OpenClaw 2026.5.22 (a374c3a)` | `error`, reason `global install verify` | Same edge case as local: the package did upgrade, but updater JSON reported a verification error for missing bundled runtime sidecars. |
| `2026.4.15` | PASS | `OpenClaw 2026.4.15 (041266a)` | `OpenClaw 2026.5.22 (a374c3a)` | `ok` | Upgraded cleanly. |
| KokoChat support after `2026.1.29` upgrade | PASS | upgraded `2026.5.22` | support installed | N/A | `scripts/install-openclaw-support.mjs` installed agents, skills, allowlists, and exec approvals successfully. |

Tencent-specific findings:

- The subuser needed resource permission plus payment permission to create hourly CVM. `QCloudResourceFullAccess` alone failed with `UnauthorizedOperation: 无支付权限`.
- For an unattended product installer, do not require SSH if the cloud provider has a command runner. Tencent TAT was reliable enough to bootstrap and test even while SSH was unusable.
- First-time npm install of old OpenClaw versions can be slow on a small CVM. `2026.4.14` and `2026.4.15` spent several minutes in bundled-plugin postinstall. Timeouts for cloud bootstrap should be measured in tens of minutes, not seconds.
