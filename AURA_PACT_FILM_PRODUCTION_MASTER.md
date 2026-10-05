# AURA / PACT FILM PRODUCTION MASTER

## Production Shot List + Implementation Requirements + DaVinci Resolve Instructions

**Version:** 1.1 --- Competition Production Lock（功能完善與繁體中文介面）\
**Date:** 2026-10-05\
**Target:** 2026 AI 座艙感知與視覺化 Hackathon\
**Deliverable:** 60--75 秒 1080p / 16:9 展示影片\
**Production principle:** **AI 生成攝影棚；AURA 程式生成產品；DaVinci
生成電影。**

------------------------------------------------------------------------

# 0. PRODUCTION LOCK

以下方向正式鎖定，除非遇到無法完成的技術阻塞，不再更換故事：

-   Vehicle: **Premium Flagship Executive Sedan**
-   Experience: **Premium Executive Travel**
-   Product philosophy: **Quiet Intelligence**
-   Main passenger: **Rear VIP**
-   Driver: Driver authority / safety-critical interaction
-   Front Passenger: supporting display；本 Scenario 不強迫使用
-   Spatial interaction: **Smart Window → Journey Point → Add to
    Journey**
-   Shared-resource decision: **Rear VIP → Shared Journey → Driver
    Authority**
-   High driver load: **DEFER**
-   Safe timing: **ASK**
-   Driver confirmation surface: **Center**
-   Cloud-only capability: **Live Journey Intelligence**
-   Offline-local capability: **Quiet Mode**
-   Cloud recovery: data may recover, but **Quiet Mode remains active**
-   Five-screen principle: **五屏協同不等於五屏同時顯示資訊**
-   Passenger Screen: mostly background / passive shared journey context
-   No exterior shooting
-   No actors
-   No physical-car shooting
-   No fake RJ45 shot
-   No parking scenario
-   No dinner-choice storyline
-   No bird/ecology storyline

影片中的核心 system behavior 必須能在現場 Demo 重現。

------------------------------------------------------------------------

# 1. PRODUCT STORY

一台 Premium Flagship Executive Sedan 正執行高階商務／觀光旅程。

Rear VIP 從 Smart Window 發現一個 Journey Point，提出 `Add to Journey`。

PACT 判斷這是 Passenger 對 Shared Journey 的修改，Driver 擁有
authority。此時 Driver Load 高，因此不立刻打擾駕駛，而是 `DEFER`。

道路負荷降低後，PACT 將 deferred request 轉成 `ASK`，在 Center
顯示低干擾確認。Driver 接受後，Journey
更新；Cluster、Center、Rear、Window 各自取得符合角色的 presentation。

旅程進入 connectivity-limited area，Cloud Enhanced Services
暫時失效。Live Journey Intelligence unavailable，但 Local
Core、Permission、Policy、Attention、Journey state 與 Local Experience
仍然存在。

Rear VIP 啟動 `Quiet Mode`。PACT 在本地 `EXECUTE`，Rear + Window
進入低干擾模式。

Cloud 恢復後，Live Journey Intelligence 回來，但 PACT 尊重 Rear Zone
仍處於 Quiet Mode，不立即把資訊彈回來。VIP 主動 Resume 後才重新呈現。

核心訊息：

> **AURA / PACT does not simply answer commands. It coordinates people,
> authority, attention, displays and connectivity.**

------------------------------------------------------------------------

# 2. DISPLAY ROLES

## Cluster

**Role:** Driver Operations

顯示： - speed - navigation cue - safety-critical information - Focus
Mode

不顯示： - VIP POI card - restaurant-like cards - passenger
notifications - Cloud engineering status

## Center

**Role:** Shared Journey

顯示： - navigation - shared journey - driver confirmation - journey
update

這是 Driver 對 Shared Resource 做 confirmation 的主要 surface。

## Passenger

**Role:** Companion / Passive Journey

本影片不是主角。

維持： - shared journey context - optional ambient/trip information

不要為了證明五屏而塞額外功能。

## Rear

**Role:** VIP Personal Experience

顯示： - journey summary - Live Journey Intelligence - Quiet Mode -
personal-zone state

## Window

**Role:** Spatial Journey Interface

不是「貼在窗戶上的平板」。

Normal: - very low information density - journey point - minimal
time/weather if needed

Interaction: - POI → minimal card → Add to Journey

Quiet: - information fades substantially

------------------------------------------------------------------------

# 3. REAL / SIMULATED / POST-PRODUCTION

## REAL / IMPLEMENTED TARGET

以下應由 AURA runtime 真正驅動：

-   occupant / role
-   intent
-   shared-resource classification
-   authority / permission
-   PACT decision
-   DEFER
-   ASK
-   driver consent
-   display presentation state
-   Quiet Mode state
-   connectivity state
-   cloud capability availability
-   deferred / held task state
-   recovery / resume behavior

## SIMULATED

允許 Scenario Runner 模擬：

-   vehicle motion
-   driver load
-   road complexity
-   location / journey context
-   Donghu journey point
-   ETA impact
-   connectivity loss
-   occupant input
-   cloud outage

畫面需要時標：

`SIMULATED VEHICLE CONTEXT`

## POST-PRODUCTION

允許：

-   Luxury Cabin
-   virtual camera
-   compositing
-   screen perspective
-   reflection
-   subtitles
-   voiceover
-   music
-   sound effects
-   cinematic transitions
-   PACT X-Ray presentation animation

禁止用後製改掉真正 decision result。

------------------------------------------------------------------------

# 4. MASTER CABIN ART DIRECTION

**Vehicle:** Premium Flagship Executive Sedan

Characteristics: - slightly long-wheelbase feeling - spacious rear
cabin - realistic production-feasible interior - no brand logo - no
limousine exaggeration - no cyberpunk - dark graphite / black leather -
matte metal - glass - subtle warm ambient illumination - restrained
premium design

Front: - Cluster - Center - Passenger

Rear: - Rear display - Smart Window

重要：

Master Cabin 只需要讓 display placement 可信。

Close-up 時使用 **Screen Takeover** 轉入真正 AURA UI，不要求在 Wide Shot
中所有 UI 文字都可讀。

------------------------------------------------------------------------

# 5. PACT X-RAY

PACT X-Ray 不是第六個 production display。

它是影片／Demo 的 explainability layer。

只顯示結構化 decision state，不顯示 chain-of-thought。

Allowed fields:

-   OCCUPANT
-   INTENT
-   RESOURCE
-   AUTHORITY
-   DRIVER LOAD
-   CONNECTIVITY
-   DECISION
-   TARGET
-   REASON CODE

Example:

``` text
OCCUPANT     REAR VIP
INTENT       ADD JOURNEY STOP
RESOURCE     SHARED JOURNEY
AUTHORITY    DRIVER
DRIVER LOAD  HIGH
DECISION     DEFER
```

X-Ray 單次通常 0.8--1.5 秒。

影片總佔比不超過約 20%。

------------------------------------------------------------------------

# 6. FILM STRUCTURE

Target duration: **約 72 秒**

-   Act 1 --- Establish Experience: 0--9s
-   Act 2 --- Journey Intent: 9--23s
-   Act 3 --- PACT Arbitration: 23--38s
-   Act 4 --- Hybrid AI / Offline: 38--59s
-   Act 5 --- Quiet Recovery: 59--68s
-   Brand End: 68--72s

------------------------------------------------------------------------

# 7. SHOT LIST

## SHOT 01 --- Cabin Awakens

**TC:** 00:00--00:03.5\
**Duration:** 3.5s\
**Source:** Luxury Cabin Master / front cabin

Camera: - slow push-in - start scale 100% - end scale 106% - no
aggressive pan

Visual: Premium sedan cabin fades from dark. Cluster / Center /
Passenger active but restrained.

Title: `AURA / PACT`

Small: `Interactive Prototype`

VO: 「真正高階的座艙 AI，不只是回答指令。」

SFX: subtle cabin wake tone

DaVinci: - Cross Dissolve from black \~10--12 frames - Dynamic Zoom OFF;
use Inspector keyframes - Ease In/Out

Classification: POST + REAL UI composite

------------------------------------------------------------------------

## SHOT 02 --- Rear VIP World

**TC:** 00:03.5--00:07\
**Duration:** 3.5s\
**Source:** rear cabin master

Camera: - cut to rear - very slow lateral movement toward Window

Visual: Rear + Window visible. Window information is sparse.

Window: `DONGHU` `Scenic Experience`

VO: 「PACT 在背景理解每一位乘員、每一個區域，以及當下的旅程。」

Classification: POST + REAL UI

------------------------------------------------------------------------

## SHOT 03 --- Spatial Discovery

**TC:** 00:07--00:10\
**Duration:** 3s

Camera: - push toward Smart Window - Screen Takeover near final 0.5s

Window: minimal POI expands:

`DONGHU` `Scenic lakeside stop` `+12 min to journey` `ADD TO JOURNEY`

Note: `+12 min` is scenario fixture, not live routing.

Small disclosure if visible: `SIMULATED JOURNEY CONTEXT`

VO: none or continue previous line

------------------------------------------------------------------------

## SHOT 04 --- Add to Journey

**TC:** 00:10--00:12.5\
**Duration:** 2.5s

UI event: VIP taps `ADD TO JOURNEY`.

Window: `Journey request sent`

Do NOT show `Navigation updated`.

SFX: single premium soft tap

GitHub dependency: window intent event → Core

REAL/SIM: interaction/decision path REAL; POI context SIMULATED

------------------------------------------------------------------------

## SHOT 05 --- PACT X-Ray / Authority

**TC:** 00:12.5--00:15\
**Duration:** 2.5s

Visual: Cabin darkens slightly. X-Ray appears.

``` text
REAR VIP
ADD JOURNEY STOP
SHARED JOURNEY
DRIVER AUTHORITY
```

Camera: almost static

VO: 「但共享行程，不由乘客直接改寫。」

------------------------------------------------------------------------

## SHOT 06 --- Attention Decision

**TC:** 00:15--00:18\
**Duration:** 3s

X-Ray extends:

``` text
DRIVER LOAD   HIGH
DECISION      DEFER
```

Small: `Driver interruption suppressed`

Do not show giant red warning.

VO: 「當駕駛負荷升高，PACT 選擇延後，而不是打擾。」

GitHub dependency: Attention/Cognitive Load → Action Gate / policy →
DEFER

------------------------------------------------------------------------

## SHOT 07 --- Focus Mode

**TC:** 00:18--00:21.5\
**Duration:** 3.5s

Camera: transition from X-Ray into Cluster Screen Takeover.

Cluster: Normal → Focus Mode

Retain: - speed - navigation - safety

Remove/reduce: - secondary information

Passenger/Rear do not need to visibly react.

VO: none

SFX: very subtle reduction / low-pass transition

------------------------------------------------------------------------

## SHOT 08 --- Load Recovery

**TC:** 00:21.5--00:24\
**Duration:** 2.5s

Visual: road load simulated normal.

Developer state not shown directly.

Internal: `HIGH → NORMAL`

Deferred request: `DEFERRED → READY`

Camera: pull slightly out from Cluster toward Center.

------------------------------------------------------------------------

## SHOT 09 --- ASK Driver

**TC:** 00:24--00:27.5\
**Duration:** 3.5s

Center Screen Takeover.

Center: `Journey update available` `Donghu · +12 min`

Buttons: `ACCEPT` `KEEP ROUTE`

PACT small X-Ray strip: `DEFER → ASK`

VO: 「在安全時機，才把需要駕駛決定的事情交給駕駛。」

GitHub dependency: deferred task release → Consent Manager

------------------------------------------------------------------------

## SHOT 10 --- Driver Accept

**TC:** 00:27.5--00:30\
**Duration:** 2.5s

Action: `ACCEPT`

Center: `Journey updated`

SFX: subtle confirmation

No celebration animation.

------------------------------------------------------------------------

## SHOT 11 --- Experience Orchestration

**TC:** 00:30--00:35\
**Duration:** 5s

Camera: quick but smooth sequence: Center → Cluster → Rear → Window

Presentation:

Cluster: next necessary navigation cue

Center: shared route updated

Rear: `Donghu added`

Window: `DONGHU · NEXT STOP`

Passenger: unchanged / passive

VO: 「同一個決策，在不同螢幕上，只呈現各自真正需要的資訊。」

Key message: Five-screen coordination ≠ five screens showing the same
notification.

------------------------------------------------------------------------

## SHOT 12 --- Live Journey Intelligence

**TC:** 00:35--00:39\
**Duration:** 4s

Rear Screen Takeover.

Rear: `DONGHU` `Next Stop`

`Live Journey Intelligence` `Arrival 14:26` `Route Status Optimal`

If values are fixtures: small `DEMO DATA`

VO: 「連網時，雲端提供即時旅程資訊與進階能力。」

------------------------------------------------------------------------

## SHOT 13 --- Connectivity Loss

**TC:** 00:39--00:42\
**Duration:** 3s

Do not show fake RJ45.

UI status: `Cloud Connected` → `Cloud Unavailable`

Small: `SIMULATED CLOUD OUTAGE`

Rear Live Journey Intelligence: `Temporarily unavailable`

Journey itself remains.

SFX: soft low-frequency transition, not alarm

------------------------------------------------------------------------

## SHOT 14 --- Offline Capability X-Ray

**TC:** 00:42--00:46\
**Duration:** 4s

Cabin remains visually stable.

PACT X-Ray:

``` text
LOCAL CORE
Intent        ACTIVE
Permission    ACTIVE
Policy        ACTIVE
Attention     ACTIVE
Cabin State   ACTIVE

CLOUD ENHANCED
UNAVAILABLE
```

VO: 「失去雲端，不代表失去座艙智慧。」

Important: Only show capabilities actually implemented.

------------------------------------------------------------------------

## SHOT 15 --- Quiet Mode Request

**TC:** 00:46--00:49\
**Duration:** 3s

Rear Screen.

VIP taps: `QUIET MODE`

No voice assistant requirement.

GitHub dependency: rear personal-zone action

------------------------------------------------------------------------

## SHOT 16 --- Local EXECUTE

**TC:** 00:49--00:52\
**Duration:** 3s

PACT X-Ray:

``` text
REAR VIP
PERSONAL ZONE
CLOUD REQUIRED  NO
DECISION        EXECUTE
```

VO: 「地端核心仍能處理權限、策略與個人座艙體驗。」

------------------------------------------------------------------------

## SHOT 17 --- Quiet Experience

**TC:** 00:52--00:57\
**Duration:** 5s

Camera: Rear → Window

Rear: information density reduces.

Example: `14:19` `QUIET MODE` `Donghu · 18 min`

Window: journey overlays fade. Only minimal: `14:19` optional
`DONGHU · NEXT STOP`

Internal policy: non-critical notifications suppressed

Do NOT claim physical ANC / lighting / window tint / HVAC unless
implemented.

------------------------------------------------------------------------

## SHOT 18 --- Cloud Restored, No Interruption

**TC:** 00:57--01:02\
**Duration:** 5s

Connectivity: `Cloud Restored`

Internal: Live Journey Intelligence available again.

But Rear remains: `QUIET MODE`

Do not pop large card.

PACT X-Ray small:

``` text
CLOUD DATA RESTORED
REAR ZONE: QUIET
PRESENTATION: HELD
```

VO: 「連線恢復後，PACT 也不急著打斷乘員。」

This is the key Quiet Intelligence moment.

------------------------------------------------------------------------

## SHOT 19 --- Resume

**TC:** 01:02--01:06\
**Duration:** 4s

VIP taps: `RESUME`

Rear: Live Journey Intelligence returns smoothly.

Window: minimal journey context returns.

No abrupt animation.

VO: 「資訊回來了，但呈現的時機仍由體驗決策。」

------------------------------------------------------------------------

## SHOT 20 --- Hero End

**TC:** 01:06--01:12\
**Duration:** 6s

Camera: slow pull-out to premium cabin composition.

Show front + rear through cinematic edit/composite; do not force all
five screens readable.

Title:

`AURA / PACT`

`One Cabin. Many People. One AI.`

Second line: `Offline First. Cloud Enhanced.`

Optional: `Passenger-Aware Arbitration & Coordination Technology`

Fade to black.

Music: resolve, no dramatic trailer hit.

------------------------------------------------------------------------

# 8. VOICEOVER MASTER

建議總旁白保持簡短：

> 「真正高階的座艙 AI，不只是回答指令。」

> 「PACT 在背景理解每一位乘員、每一個區域，以及當下的旅程。」

> 「但共享行程，不由乘客直接改寫。」

> 「當駕駛負荷升高，PACT 選擇延後，而不是打擾。」

> 「在安全時機，才把需要駕駛決定的事情交給駕駛。」

> 「同一個決策，在不同螢幕上，只呈現各自真正需要的資訊。」

> 「連網時，雲端提供即時旅程資訊與進階能力。」

> 「失去雲端，不代表失去座艙智慧。」

> 「地端核心仍能處理權限、策略與個人座艙體驗。」

> 「連線恢復後，PACT 也不急著打斷乘員。」

> 「資訊回來了，但呈現的時機仍由體驗決策。」

避免每秒都有旁白。讓畫面有呼吸。

------------------------------------------------------------------------

# 9. GITHUB IMPLEMENTATION REQUIREMENTS

## P0 --- Do Not Rebuild AURA

開始前閱讀： - `AGENTS.md` - current master spec - existing HMI handoff
/ Codex instructions - current five-display implementations - current
Scenario Runner - current Action Gate / Consent - current Connectivity
Monitor - current Experience Orchestrator - current Shared State / Event
Bus

最大化 reuse。

------------------------------------------------------------------------

## P1 --- Competition Scenario

建立或更新：

`scenarios/competition-premium-journey.yaml`

至少包含：

1.  normal journey
2.  Donghu POI fixture
3.  rear VIP Add Journey intent
4.  driver load HIGH
5.  DEFER
6.  driver load NORMAL
7.  ASK
8.  driver ACCEPT
9.  journey updated
10. live journey intelligence available
11. simulated cloud outage
12. live intelligence unavailable
13. Quiet Mode request
14. local EXECUTE
15. cloud restored
16. presentation held because Quiet Mode
17. Resume
18. information presentation restored

必須使用現有 Scenario Runner schema。

------------------------------------------------------------------------

## P2 --- Shared State Minimum

需要能表示：

``` text
occupants
rearVip
journey
journeyRequest
driverLoad
consent
connectivity
cloudCapabilities
rearZoneMode
deferredTasks
displayPresentation
```

不要為影片重寫整個 state model。

------------------------------------------------------------------------

## P3 --- Decision Outputs

至少需要：

-   `ROUTE`
-   `ASK`
-   `DEFER`
-   `EXECUTE`

REJECT 不必為影片硬塞。

Decision event 最少提供：

``` text
actor
intent
resource
authority
load
decision
target
reasonCode
traceId
```

------------------------------------------------------------------------

## P4 --- Deferred Journey Request

Required behavior:

Rear VIP requests shared journey modification while load HIGH:

`DEFER`

Request must remain stored.

When load returns NORMAL:

`DEFERRED → READY → ASK`

Do not lose request.

------------------------------------------------------------------------

## P5 --- Consent

Center must show:

`Journey update available`

Driver: `ACCEPT / KEEP ROUTE`

ACCEPT updates shared journey.

Rear / Window receive role-specific presentation.

------------------------------------------------------------------------

## P6 --- Connectivity Capability Boundary

Offline must not simply be a boolean badge.

Capability state must distinguish:

Local: - intent - permission - policy - attention - local experience

Cloud: - live journey intelligence - external services - advanced
reasoning where applicable

When offline: Cloud capability unavailable.

Do not claim a capability that is not actually wired.

------------------------------------------------------------------------

## P7 --- Quiet Mode

Quiet Mode scope:

`REAR VIP ZONE`

MVP effects:

-   reduce Rear information density
-   suppress non-critical Rear notifications
-   reduce Window overlays
-   preserve essential journey context
-   persist across cloud reconnect

No requirement for: - physical tint - HVAC - ANC - seat control - cabin
lighting hardware

------------------------------------------------------------------------

## P8 --- Cloud Recovery + Presentation Hold

When Cloud restores:

-   capability becomes available
-   journey state remains
-   session remains
-   Quiet Mode remains
-   recovered cloud information must NOT immediately interrupt VIP

Use state such as:

`available_but_held`

On Resume:

`held → presented`

This behavior is important for the film.

------------------------------------------------------------------------

## P9 --- Display Presentation

Cluster: driver-critical only.

Center: shared journey + consent.

Passenger: passive/supporting; no new feature required.

Rear: VIP state + live intelligence + Quiet Mode.

Window: spatial POI + minimal journey status.

------------------------------------------------------------------------

## P10 --- Decision Observatory

Reuse existing Developer Console if possible.

Add a recording-friendly panel, not a new production HMI.

Show:

-   occupant
-   intent
-   resource
-   authority
-   driver load
-   connectivity
-   decision
-   target
-   reason code

Must be deterministic and trace-backed.

------------------------------------------------------------------------

## P11 --- Demo Director

Minimum controls:

-   RESET
-   JOURNEY REQUEST
-   LOAD HIGH
-   LOAD NORMAL
-   DRIVER ACCEPT
-   CLOUD OFFLINE
-   QUIET MODE
-   CLOUD RESTORE
-   RESUME

Also desirable: `AUTO PLAY`

The goal is reliable recording and live demo repetition.

------------------------------------------------------------------------

# 10. IMPLEMENTATION ACCEPTANCE TEST

The competition flow is DONE only if it can be repeated three times:

1.  Reset
2.  Five displays load
3.  Rear VIP Add Journey
4.  PACT DEFER because driver load HIGH
5.  Load NORMAL
6.  PACT ASK
7.  Center consent visible
8.  ACCEPT
9.  Journey updated
10. role-specific multi-display presentation
11. Cloud OFFLINE
12. Live Journey Intelligence unavailable
13. Local Core remains active
14. Quiet Mode EXECUTE
15. Rear + Window simplify
16. Cloud RESTORE
17. Quiet Mode persists
18. recovered data held
19. Resume
20. data presentation returns

No manual code edit between runs.

------------------------------------------------------------------------

# 11. DAVINCI RESOLVE PROJECT SETUP

## Timeline

Resolution: `1920 × 1080`

Frame rate: use one fixed project rate; recommended `30 fps` if all UI
recordings are 30 fps.

Duration: \~72s

## Track Layout

``` text
V7  Titles / final brand
V6  Chinese subtitles
V5  PACT X-Ray / overlays
V4  Real AURA HMI screen recordings
V3  screen glass/reflection integration
V2  Luxury Cabin master / generated scene
V1  background / optional atmosphere

A4  UI SFX
A3  ambience
A2  music
A1  voiceover
```

------------------------------------------------------------------------

# 12. DAVINCI COMPOSITING RULES

## Screen integration

For Cabin wide shots: - use Corner Position / perspective transform as
needed - add only subtle reflection - do not blur UI until unreadable -
match screen luminance to cabin - avoid oversaturated screens

For close-up: transition to Screen Takeover.

Recommended transition: Cabin screen fills \~70--80% of frame → 4--8
frame masked/perspective transition → clean 2D UI fills frame

This avoids needing perfect perspective throughout every close-up.

------------------------------------------------------------------------

# 13. VIRTUAL CAMERA RULES

Do not use random zooms.

Three movement families only:

### PUSH-IN

Used for: - discovery - decision focus - screen takeover

Typical: 100% → 106--115% on cabin master.

### PAN / LATERAL MOVE

Used for: - Front → Rear relationship - Rear → Window - Center → Cluster

Movement must be slow and eased.

### PULL-OUT

Used for: - showing orchestration - ending

Avoid: - whip pan - shaky camera - rapid zoom - handheld simulation

This is Premium Executive Travel, not action advertising.

------------------------------------------------------------------------

# 14. MOTION LANGUAGE

UI transitions: \~200--500ms.

PACT X-Ray: \~250ms fade/slide in. Hold \~0.8--1.2s. \~200ms fade out.

Quiet Mode: slow \~500--900ms information fade.

Cloud offline: no alarm. \~300--500ms status transition.

Cloud recovery: subtle.

Driver confirmation: clear but low interruption.

------------------------------------------------------------------------

# 15. SOUND DESIGN

Music: minimal premium electronic / ambient.

Do not use: - epic trailer - EDM drop - aggressive cyberpunk - loud
glitch

SFX: - soft interaction tap - subtle decision cue - low connectivity
transition - quiet confirmation

Offline should feel controlled, not catastrophic.

------------------------------------------------------------------------

# 16. SUBTITLE STYLE

Chinese subtitles embedded.

Rules: - maximum two lines - short - do not duplicate every UI label -
keep away from HMI critical text - consistent position - no karaoke
animation

依使用者 2026-10-05 最新指示，Production HMI 與 Scenario Control 使用繁體中文。品牌、標準單位、協定值、原因碼及 trace ID 保持原值；此更新不改版面、故事、PACT 規則或核心架構。

------------------------------------------------------------------------

# 17. ASSET LIST

Required:

### Generated

-   `cabin_front_master.png`
-   `cabin_rear_master.png`
-   optional `cabin_hero_master.png`

### AURA Recordings

-   `cluster_focus.mp4`
-   `center_journey_consent.mp4`
-   `center_journey_updated.mp4`
-   `rear_live_journey.mp4`
-   `rear_quiet_mode.mp4`
-   `window_journey_point.mp4`
-   `window_quiet_mode.mp4`
-   `cloud_offline_state.mp4`
-   `cloud_recovery_hold.mp4`
-   `pact_decision_xray.mp4` or transparent overlay capture

### Audio

-   `voiceover.wav`
-   `music.wav`
-   UI SFX

------------------------------------------------------------------------

# 18. WHAT NOT TO SPEND TIME ON

Before 10/7 do not prioritize:

-   perfect exterior car animation
-   realistic moving scenery
-   AI-generated full video
-   new POI provider
-   real live traffic API
-   new routing provider
-   parking
-   emotion detection
-   full Android migration
-   SFT / LoRA
-   physical Micro LED integration
-   all five displays redesigned from scratch
-   extra feature scenes

Priority:

**Decision correctness → Scenario reliability → Hero UI → Recording →
Edit.**

------------------------------------------------------------------------

# 19. PPT BUSINESS EXTENSION --- NOT IN FILM

Do not add these use cases to the 72s film.

PPT may show PACT platform extension:

-   Premium private vehicle
-   Executive sedan
-   Hotel / resort shuttle
-   Premium taxi
-   Ride-hailing / Uber-like service
-   Guided tourism vehicle
-   Chauffeur service

Key business logic:

In taxi / ride-hailing scenarios, Driver and Passenger are often
unrelated users with different authority, privacy, destination,
entertainment and cabin-control needs.

This makes role-aware arbitration and zone-aware experience
orchestration especially relevant.

Keep this as scalability / commercialization material, not a second film
story.

------------------------------------------------------------------------

# 20. FINAL PRODUCTION PRINCIPLE

The film must make the audience feel:

> **"I want this cabin experience."**

The PPT must make the judges understand:

> **"I understand why this architecture is different."**

The live demo must prove:

> **"The decisions shown in the film are actually implemented."**

Final message:

# One Cabin. Many People. One AI.

## Offline First. Cloud Enhanced.

### Quiet Intelligence for the software-defined cabin.
