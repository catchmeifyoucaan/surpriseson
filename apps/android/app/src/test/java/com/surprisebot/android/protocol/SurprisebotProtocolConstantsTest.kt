package com.surprisebot.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class SurprisebotProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", SurprisebotCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", SurprisebotCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", SurprisebotCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", SurprisebotCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", SurprisebotCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", SurprisebotCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", SurprisebotCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", SurprisebotCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", SurprisebotCapability.Canvas.rawValue)
    assertEquals("camera", SurprisebotCapability.Camera.rawValue)
    assertEquals("screen", SurprisebotCapability.Screen.rawValue)
    assertEquals("voiceWake", SurprisebotCapability.VoiceWake.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", SurprisebotScreenCommand.Record.rawValue)
  }
}
