import Foundation
import Testing
@testable import Surprisebot

@Suite struct VoiceWakePreferencesTests {
    @Test func sanitizeTriggerWordsTrimsAndDropsEmpty() {
        #expect(VoiceWakePreferences.sanitizeTriggerWords([" surprisebot ", "", " \nclaude\t"]) == ["surprisebot", "claude"])
    }

    @Test func sanitizeTriggerWordsFallsBackToDefaultsWhenEmpty() {
        #expect(VoiceWakePreferences.sanitizeTriggerWords(["", "  "]) == VoiceWakePreferences.defaultTriggerWords)
    }

    @Test func displayStringUsesSanitizedWords() {
        #expect(VoiceWakePreferences.displayString(for: ["", " "]) == "surprisebot, claude")
    }

    @Test func loadAndSaveTriggerWordsRoundTrip() {
        let suiteName = "VoiceWakePreferencesTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!

        #expect(VoiceWakePreferences.loadTriggerWords(defaults: defaults) == VoiceWakePreferences.defaultTriggerWords)
        VoiceWakePreferences.saveTriggerWords(["computer"], defaults: defaults)
        #expect(VoiceWakePreferences.loadTriggerWords(defaults: defaults) == ["computer"])
    }
}
