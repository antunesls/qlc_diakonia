# QLC+ Cockpit API (`cockpit-1`)

Retrocompatible extension of the QLC+ 5 Web Access, used by the QLC+ Cockpit
Android app. All the upstream commands keep working unchanged.

Start QLC+ 5 with web access enabled: `qlcplus-qml -w` (port 9999) or
`-wa` for authenticated access. Code: `webaccess/src/webaccesscockpit.cpp`.

## HTTP (JSON, requires VC_ONLY level)

| Path | Content |
|---|---|
| `/api/info.json` | `apiVersion`, `appName`, `appVersion`, `workspace`, `blackout`, `grandMaster`, `universes[{id,name}]` |
| `/api/fixtures.json` | `fixtures[{id,name,type,universe,address(0-based),channelsCount,heads,manufacturer,model,mode,channels[{index,name,group,groupId,colour,controlByte,default,capabilities[{min,max,name,presetType,color1?,color2?}]}]}]` |
| `/api/groups.json` | `fixtureGroups[{id,name,width,height,heads[{x,y,fixtureId,head}]}]`, `channelsGroups[{id,name,channels[{fixtureId,channel}]}]` |
| `/api/functions.json` | `functions[{id,name,type,typeId,path,running,paused,fadeIn,fadeOut,duration,totalDuration, ...}]`. Chaser/Sequence add `currentStep`, `steps[{index,functionId,functionName,fadeIn,hold,fadeOut,duration,note}]` (Sequence: `boundSceneId`). Collection adds `functions[]`. Show adds `elapsed`, `tracks[{id,name,functions[{functionId,functionName,startTime,duration}]}]` |
| `/vc.json` | upstream: full Virtual Console tree. **Request it once per session**: it also enables the widget push messages |

## WebSocket `ws://host:9999/qlcplusWS` (client → server)

| Message | Notes |
|---|---|
| `QLC+API\|getApiVersion` | reply `QLC+API\|getApiVersion\|cockpit-1` (upstream QLC+ sends no reply) |
| `QLC+API\|setFixtureChannel\|<fxId>\|<chIdx>\|<0-255>` | Simple Desk override on the fixture channel |
| `QLC+API\|setFixtureChannels\|<fxId>\|<ch>:<v>,<ch>:<v>...` | several channels at once |
| `QLC+API\|releaseFixture\|<fxId>` | remove the overrides of the fixture |
| `QLC+API\|subscribeUniverse\|<uni 0-based>\|<0/1>` | start/stop the `UNIVERSE` push |
| `QLC+API\|setFunctionIntensity\|<fid>\|<0-255>` | intensity attribute override |
| `QLC+API\|pauseFunction\|<fid>\|<0/1>` | pause/resume a running function |
| `QLC+API\|seekFunction\|<fid>\|<ms>` | (re)start a function (e.g. a Show) from the given time |
| `QLC+API\|chaserStep\|<fid>\|NEXT\|PREV\|<index>` | chaser/sequence step control; starts the chaser if stopped |
| `QLC+API\|stopAllFunctions` | panic stop |
| `QLC+API\|blackout[\|<0/1>]` | set blackout; without an argument it replies `BLACKOUT\|<0/1>` |

DMX commands require the `SIMPLE_DESK_AND_VC_LEVEL` when authentication is enabled.

## Pushes (server → client)

| Message | When |
|---|---|
| `UNIVERSE\|<uni>\|<base64 of 512 bytes>` | up to 25 Hz, only for subscribed universes and only when values changed (post Grand Master output) |
| `CHASER_STEP\|<fid>\|<index>` | a chaser/sequence step changed |
| `SHOW_TIME\|<fid>\|<elapsed ms>\|<paused 0/1>` | 4 Hz while a Show is running |
| `BLACKOUT\|<0/1>` | blackout changed |
| `DOC_CHANGED` | project loaded or fixtures/groups/functions changed; reload the JSON resources |

Upstream pushes (`FUNCTION|id|Running/Stopped`, `GM_VALUE`, `VC_PAGE`, `<wid>|BUTTON|...`,
`<wid>|SLIDER|...`, `<wid>|CUE_STATE|...`, ...) are unchanged.

## Quick test

```sh
curl http://localhost:9999/api/fixtures.json
websocat ws://localhost:9999/qlcplusWS
> QLC+API|getApiVersion
> QLC+API|setFixtureChannel|0|0|255
> QLC+API|subscribeUniverse|0|1
```
