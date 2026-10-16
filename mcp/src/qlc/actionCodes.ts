/**
 * QLC+ 5 native protocol action codes.
 *
 * Mirrors `Tardis::ActionCodes` in qlcplus/qmlui/tardis/tardis.h. Codes are
 * grouped by editing area; each group starts at a fixed base and the server
 * maps every group to the access right a client must hold
 * (`NetworkManager::requiredAccessMask`).
 */

export const LIVE_ACTIONS_START_CODE = 0xf000;

export const Action = {
  /* Preview settings */
  EnvironmentSetSize: 0x0000,
  EnvironmentBackgroundImage: 0x0001,
  FixtureSetPosition: 0x0002,
  FixtureSetRotation: 0x0003,
  GenericItemSetPosition: 0x0004,
  GenericItemSetRotation: 0x0005,
  GenericItemSetScale: 0x0006,

  /* Input/Output mapping */
  IOAddUniverse: 0x0100,
  IORemoveUniverse: 0x0101,

  /* Fixtures */
  FixtureCreate: 0x0200,
  FixtureDelete: 0x0201,
  FixtureMove: 0x0202,
  FixtureSetName: 0x0203,
  FixtureSetChannelModifier: 0x0204,

  /* Fixture groups */
  FixtureGroupCreate: 0x0300,
  FixtureGroupDelete: 0x0301,

  /* Functions */
  FunctionCreate: 0x1000,
  FunctionDelete: 0x1001,
  FunctionSetName: 0x1002,
  FunctionSetPath: 0x1003,
  FunctionSetRunOrder: 0x1004,
  FunctionSetDirection: 0x1005,
  FunctionSetTempoType: 0x1006,
  FunctionSetFadeIn: 0x1007,
  FunctionSetFadeOut: 0x1008,
  FunctionSetDuration: 0x1009,

  /* Scenes */
  SceneSetChannelValue: 0x1100,
  SceneUnsetChannelValue: 0x1101,
  SceneAddFixture: 0x1102,
  SceneRemoveFixture: 0x1103,
  SceneAddFixtureGroup: 0x1104,
  SceneRemoveFixtureGroup: 0x1105,
  SceneAddPalette: 0x1106,
  SceneRemovePalette: 0x1107,

  /* Chasers */
  ChaserAddStep: 0x1200,
  ChaserRemoveStep: 0x1201,
  ChaserMoveStep: 0x1202,
  ChaserSetStepFadeIn: 0x1203,
  ChaserSetStepHold: 0x1204,
  ChaserSetStepFadeOut: 0x1205,
  ChaserSetStepDuration: 0x1206,

  /* EFX */
  EFXAddFixture: 0x1300,
  EFXRemoveFixture: 0x1301,
  EFXFixturePropagation: 0x1302,
  EFXSetAlgorithmIndex: 0x1303,
  EFXSetRelative: 0x1304,
  EFXSetWidth: 0x1305,
  EFXSetHeight: 0x1306,
  EFXSetXOffset: 0x1307,
  EFXSetYOffset: 0x1308,
  EFXSetRotation: 0x1309,
  EFXSetStartOffset: 0x130a,
  EFXSetXFrequency: 0x130b,
  EFXSetYFrequency: 0x130c,
  EFXSetXPhase: 0x130d,
  EFXSetYPhase: 0x130e,

  /* Collections */
  CollectionAddFunction: 0x1400,
  CollectionRemoveFunction: 0x1401,

  /* RGB Matrix */
  RGBMatrixSetFixtureGroup: 0x1500,
  RGBMatrixSetAlgorithmIndex: 0x1501,
  RGBMatrixSetColor1: 0x1502,
  RGBMatrixSetColor2: 0x1503,
  RGBMatrixSetColor3: 0x1504,
  RGBMatrixSetColor4: 0x1505,
  RGBMatrixSetColor5: 0x1506,
  RGBMatrixSetScriptIntValue: 0x1507,
  RGBMatrixSetScriptDoubleValue: 0x1508,
  RGBMatrixSetScriptStringValue: 0x1509,
  RGBMatrixSetText: 0x150a,
  RGBMatrixSetTextFont: 0x150b,
  RGBMatrixSetImage: 0x150c,
  RGBMatrixSetOffset: 0x150d,
  RGBMatrixSetAnimationStyle: 0x150e,

  /* Audio */
  AudioSetSource: 0x1600,
  AudioSetVolume: 0x1601,

  /* Video */
  VideoSetSource: 0x1700,
  VideoSetScreenIndex: 0x1701,
  VideoSetFullscreen: 0x1702,
  VideoSetGeometry: 0x1703,
  VideoSetRotation: 0x1704,
  VideoSetLayer: 0x1705,

  /* Show Manager */
  ShowManagerAddTrack: 0xb000,
  ShowManagerDeleteTrack: 0xb001,
  ShowManagerAddFunction: 0xb002,
  ShowManagerDeleteFunction: 0xb003,
  ShowManagerItemSetStartTime: 0xb004,
  ShowManagerItemSetDuration: 0xb005,
  ShowManagerItemSetTrack: 0xb006,

  /* Simple Desk */
  SimpleDeskSetChannel: 0xc000,
  SimpleDeskResetChannel: 0xc001,

  /* Virtual Console editing */
  VCWidgetCreate: 0xe000,
  VCWidgetDelete: 0xe001,
  VCWidgetGeometry: 0xe002,
  VCWidgetReparent: 0xe003,
  VCWidgetAllowResize: 0xe004,
  VCWidgetDisabled: 0xe005,
  VCWidgetVisible: 0xe006,
  VCWidgetCaption: 0xe007,
  VCWidgetBackgroundColor: 0xe008,
  VCWidgetBackgroundImage: 0xe009,
  VCWidgetForegroundColor: 0xe00a,
  VCWidgetFont: 0xe00b,
  VCWidgetPage: 0xe00c,
  VCWidgetZIndex: 0xe00d,

  VCButtonSetActionType: 0xe100,
  VCButtonSetFunctionID: 0xe101,
  VCButtonEnableStartupIntensity: 0xe102,
  VCButtonSetStartupIntensity: 0xe103,

  VCSliderSetMode: 0xe200,
  VCSliderSetWidgetStyle: 0xe201,
  VCSliderSetDisplayStyle: 0xe202,
  VCSliderSetInverted: 0xe203,
  VCSliderSetFunctionID: 0xe204,
  VCSliderSetControlledAttribute: 0xe205,
  VCSliderSetLowLimit: 0xe206,
  VCSliderSetHighLimit: 0xe207,

  VCCueListSetChaserID: 0xe300,

  /* Live actions */
  FixtureSetDumpValue: LIVE_ACTIONS_START_CODE,
  FixtureResetDumpValues: LIVE_ACTIONS_START_CODE + 0x001,

  FunctionStart: LIVE_ACTIONS_START_CODE + 0x100,
  FunctionStop: LIVE_ACTIONS_START_CODE + 0x101,

  VCButtonSetPressed: LIVE_ACTIONS_START_CODE + 0x200,

  VCSliderSetValue: LIVE_ACTIONS_START_CODE + 0x300,
  VCSliderButtonPress: LIVE_ACTIONS_START_CODE + 0x301,

  VCCueListPlayClicked: LIVE_ACTIONS_START_CODE + 0x400,
  VCCueListStopClicked: LIVE_ACTIONS_START_CODE + 0x401,
  VCCueListNextClicked: LIVE_ACTIONS_START_CODE + 0x402,
  VCCueListPreviousClicked: LIVE_ACTIONS_START_CODE + 0x403,
  VCCueListSetIndex: LIVE_ACTIONS_START_CODE + 0x404,
  VCCueListSideFaderLevel: LIVE_ACTIONS_START_CODE + 0x405,

  VCSpeedDialSetTime: LIVE_ACTIONS_START_CODE + 0x500,
  VCSpeedDialSetFactor: LIVE_ACTIONS_START_CODE + 0x501,
  VCSpeedDialApply: LIVE_ACTIONS_START_CODE + 0x502,

  VCXYPadSetPosition: LIVE_ACTIONS_START_CODE + 0x600,
  VCXYPadSetGeometry: LIVE_ACTIONS_START_CODE + 0x601,
  VCXYPadActivatePreset: LIVE_ACTIONS_START_CODE + 0x602,
  VCXYPadSetFloorPosition: LIVE_ACTIONS_START_CODE + 0x603,

  VCAudioTriggersSetCaptureEnabled: LIVE_ACTIONS_START_CODE + 0x700,
  VCAudioTriggersSetLevel: LIVE_ACTIONS_START_CODE + 0x701,

  VCClockSetEnabled: LIVE_ACTIONS_START_CODE + 0x800,
  VCClockReset: LIVE_ACTIONS_START_CODE + 0x801,

  VCAnimationSetFaderLevel: LIVE_ACTIONS_START_CODE + 0x900,
  VCAnimationSetAlgorithmIndex: LIVE_ACTIONS_START_CODE + 0x901,
  VCAnimationSetColor1: LIVE_ACTIONS_START_CODE + 0x902,
  VCAnimationSetColor2: LIVE_ACTIONS_START_CODE + 0x903,
  VCAnimationSetColor3: LIVE_ACTIONS_START_CODE + 0x904,
  VCAnimationSetColor4: LIVE_ACTIONS_START_CODE + 0x905,
  VCAnimationSetColor5: LIVE_ACTIONS_START_CODE + 0x906,
  VCAnimationActivatePreset: LIVE_ACTIONS_START_CODE + 0x907,

  /* Network protocol */
  NetAnnounce: 0xff00,
  NetAnnounceReply: 0xff01,
  NetAuthentication: 0xff02,
  NetAuthenticationReply: 0xff03,
  NetPoll: 0xff04,
  NetPollReply: 0xff05,
  NetProjectTransfer: 0xff06,
  NetProjectChanging: 0xff07,
  NetProjectLoaded: 0xff08,
  NetProjectRequest: 0xff09,

  /*
   * Extended API, available only on the QLC+ fork (branch
   * feat/native-api-ext). A stock QLC+ server silently drops these codes, so
   * the client probes for them with NetApiInfo before relying on any of them.
   */
  NetApiInfo: 0xff10,
  NetCommandResult: 0xff11,
  NetProjectSave: 0xff12,
  NetProjectNew: 0xff13,
  NetProjectLoadFile: 0xff14,
  NetProjectUpload: 0xff15,
  NetFixtureLibraryQuery: 0xff16,
  NetIOQuery: 0xff17,
  NetIOPatch: 0xff18,
  NetFixtureGroupDelete: 0xff19,
  NetVCPageAdd: 0xff1a,
  NetVCPageRemove: 0xff1b,
} as const;

export type ActionName = keyof typeof Action;
export type ActionCode = (typeof Action)[ActionName];

const NAMES = new Map<number, string>(
  Object.entries(Action).map(([name, code]) => [code, name]),
);

export function actionName(code: number): string {
  return NAMES.get(code) ?? `0x${code.toString(16)}`;
}

/** VCButton::ButtonAction */
export const ButtonActionType = {
  Toggle: 0,
  Flash: 1,
  Blackout: 2,
  StopAll: 3,
} as const;

/** Function::RunOrder */
export const RunOrder = { Loop: 0, SingleShot: 1, PingPong: 2, Random: 3 } as const;

/** Function::Direction */
export const Direction = { Forward: 0, Backward: 1 } as const;

/** VCSlider::SliderMode */
export const SliderModeCode = {
  Level: 0,
  Adjust: 1,
  Submaster: 2,
  GrandMaster: 3,
} as const;
